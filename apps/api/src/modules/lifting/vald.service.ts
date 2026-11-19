import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt.util';
import { LiftingService } from './lifting.service';
import { AcademyService } from '../academy/academy.service';
import { ValdClient } from './vald-client';
import type { ValdMeta } from './lifting-catalog';
import {
  FD_TEST_LABELS, FdResultDef, KNOWN_DYNAMO_CODES, MatchResult, RosterPlayer, SmartSpeedRep, TestMeta, VALD_DEVICES, ValdFilters, ValdProfile,
  aggregateDynamo, aggregateForceDecks, aggregateSmartSpeed, cleanFilters, dayAtOffset, dynamoCodesOf, dynamoTestLabel, emptyFilters, ianaFromVald, localDay, matchProfile, passesTags,
  smartSpeedTestCode, weighInLbs,
} from './vald-mapping';

/* ─────────────────────────────────────────────────────────────────────────
   VALD import: settings, the PULL button and the automatic pull.

   Settings (AppSetting "valdImport"): what a manual pull takes (date range +
   filters) and what the automatic pull takes (filters + every N days).
   Filters: devices (ForceDecks / DynaMo / SmartSpeed), test types (all by
   default), sports + groups (VALD groups -- athlete in any chosen one of
   each), tags (ForceDecks only; DynaMo and SmartSpeed tests can't carry
   tags so they're pulled regardless), and specific athletes.

   ForceDecks weigh-ins (every ForceDecks test records bodyweight) go into
   the athlete's weight history -- one per day, never over a weight a
   person typed for that day -- and the newest becomes their weight.

   A pull matches VALD profiles to the roster (VALD External ID = Athlete
   ID, else first + last name AND birthday), then saves each session as one
   LiftingTest (source + VALD test id are unique, so pulling the same
   session again replaces its numbers; new sessions become the latest, the
   older ones stay in History). VALD athletes with tests but no match are
   listed so a coach can fix the name / birthday. Read-only towards VALD.
   ───────────────────────────────────────────────────────────────────────── */

const SETTINGS_KEY = 'valdImport';
const META_KEY = 'valdMetricMeta';
const LAST_KEY = 'valdLastPull';
const DAY = 86_400_000;
const PAUSE_MS = 400; // between VALD calls -- well inside its rate limit

export interface ImportSettings {
  manual: ValdFilters & { from: string; to: string };
  auto: ValdFilters & { enabled: boolean; everyDays: number; lastRunAt: string | null };
}

export interface ValdHistory {
  groups: { id: string; name: string; category: string; profileIds: string[] }[];
  tags: { id: string; name: string; type: string; profileIds: string[] }[];
  testTypes: { code: string; label: string; device: string }[];
}

export interface PullReport {
  kind: 'manual' | 'auto';
  from: string;
  to: string;
  startedAt: string;
  finishedAt: string | null;
  running: boolean;
  phase: string;
  /** Sessions saved for the first time / replaced (same session pulled again). */
  added: number;
  replaced: number;
  /** Tests left out by the filters. */
  filteredOut: number;
  /** Athletes whose Physical tab was turned on (a new session landed for them). */
  physicalShown: number;
  /** ForceDecks weigh-ins saved to athletes' weight history. */
  weighIns: number;
  /** VALD athletes with tests in range but no roster match (name + birthday). */
  unmatched: { name: string; birthday: string | null; reason: string; tests: number }[];
  error: string | null;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function defaultSettings(): ImportSettings {
  const now = new Date();
  return {
    manual: { ...emptyFilters(), from: isoDay(new Date(now.getTime() - 90 * DAY)), to: isoDay(now) },
    auto: { ...emptyFilters(), enabled: false, everyDays: 14, lastRunAt: null },
  };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/* Tabs hidden on an athlete who has no saved choice -- the same list as the
   web's DEFAULT_HIDDEN_TABS (apps/web/src/app/athletes/[id]/helpers.ts).
   "strength" = the Physical tab. */
const DEFAULT_HIDDEN_TABS = ['catching', 'infield', 'outfield', 'strength'];
/* Settings saved before SmartSpeed was imported (v1) get it switched on:
   the academy uses ForceDecks, DynaMo AND SmartSpeed. */
const SETTINGS_VERSION = 2;
const withSmartSpeed = (f: ValdFilters, raw: any): ValdFilters =>
  (raw?.v ?? 1) < SETTINGS_VERSION && !f.devices.includes('smartspeed') ? { ...f, devices: [...f.devices, 'smartspeed'] } : f;

@Injectable()
export class ValdService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ValdService.name);
  private job: PullReport | null = null;
  private timer: NodeJS.Timeout | null = null;
  private optionsCache: { at: number; data: any } | null = null;
  private historyCache: { at: number; data: ValdHistory } | null = null;
  private physicalShownThisRun = new Set<string>();

  constructor(private prisma: PrismaService, private vald: ValdClient, private lifting: LiftingService, private academy: AcademyService) {}

  /* ── Automatic pull ────────────────────────────────────────────────── */

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || !this.vald.isConfigured()) return;
    const tick = () => void this.autoTick().catch((e) => this.logger.warn(`VALD auto pull: ${e?.message || e}`));
    setTimeout(tick, 2 * 60_000).unref?.();
    this.timer = setInterval(tick, 60 * 60_000); // hourly check; pulls every N days
    this.timer.unref?.();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async autoTick() {
    const s = await this.settings();
    if (!s.auto.enabled || this.job?.running) return;
    const last = s.auto.lastRunAt ? Date.parse(s.auto.lastRunAt) : NaN;
    if (!Number.isNaN(last) && Date.now() - last < s.auto.everyDays * DAY) return;
    const startedAt = new Date();
    const from = Number.isNaN(last) ? new Date(startedAt.getTime() - s.auto.everyDays * DAY) : new Date(last);
    const report = await this.run('auto', s.auto, from, startedAt);
    if (!report.error) {
      const fresh = await this.settings();
      fresh.auto.lastRunAt = startedAt.toISOString();
      await this.writeSettings(fresh);
    }
  }

  /* ── Settings ──────────────────────────────────────────────────────── */

  private async assertEditor(user: JwtPayload) {
    if (!(await this.lifting.canEdit(user))) throw new ForbiddenException('Only Admins and Lifting editors can manage the VALD import');
  }

  async settings(): Promise<ImportSettings> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
    const base = defaultSettings();
    if (!row?.value) return base;
    try {
      const raw = JSON.parse(row.value);
      return {
        manual: { ...base.manual, ...withSmartSpeed(cleanFilters(raw?.manual), raw), from: DAY_RE.test(raw?.manual?.from) ? raw.manual.from : base.manual.from, to: DAY_RE.test(raw?.manual?.to) ? raw.manual.to : base.manual.to },
        auto: {
          ...base.auto, ...withSmartSpeed(cleanFilters(raw?.auto), raw),
          enabled: raw?.auto?.enabled === true,
          everyDays: Number.isInteger(raw?.auto?.everyDays) && raw.auto.everyDays >= 1 && raw.auto.everyDays <= 90 ? raw.auto.everyDays : 14,
          lastRunAt: typeof raw?.auto?.lastRunAt === 'string' ? raw.auto.lastRunAt : null,
        },
      };
    } catch { return base; }
  }

  private async writeSettings(s: ImportSettings) {
    const value = JSON.stringify({ ...s, v: SETTINGS_VERSION });
    await this.prisma.appSetting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value }, update: { value } });
  }

  async saveSettings(raw: any, user: JwtPayload) {
    await this.assertEditor(user);
    const cur = await this.settings();
    const next: ImportSettings = {
      manual: {
        ...cleanFilters(raw?.manual ?? cur.manual),
        from: DAY_RE.test(raw?.manual?.from) ? raw.manual.from : cur.manual.from,
        to: DAY_RE.test(raw?.manual?.to) ? raw.manual.to : cur.manual.to,
      },
      auto: {
        ...cleanFilters(raw?.auto ?? cur.auto),
        enabled: typeof raw?.auto?.enabled === 'boolean' ? raw.auto.enabled : cur.auto.enabled,
        everyDays: Number.isInteger(raw?.auto?.everyDays) && raw.auto.everyDays >= 1 && raw.auto.everyDays <= 90 ? raw.auto.everyDays : cur.auto.everyDays,
        lastRunAt: cur.auto.lastRunAt,
      },
    };
    if (next.manual.from > next.manual.to) throw new BadRequestException('The start date is after the end date');
    await this.writeSettings(next);
    return this.status(user);
  }

  async status(user: JwtPayload) {
    await this.assertEditor(user);
    const s = await this.settings();
    const lastRow = await this.prisma.appSetting.findUnique({ where: { key: LAST_KEY } });
    let last: PullReport | null = null;
    try { last = lastRow?.value ? JSON.parse(lastRow.value) : null; } catch { last = null; }
    const nextAuto = s.auto.enabled
      ? new Date((s.auto.lastRunAt ? Date.parse(s.auto.lastRunAt) : Date.now()) + (s.auto.lastRunAt ? s.auto.everyDays * DAY : 2 * 60_000)).toISOString()
      : null;
    return { configured: this.vald.isConfigured(), settings: s, job: this.job, last, nextAutoAt: nextAuto };
  }

  /* ── What can be filtered on (from VALD) ───────────────────────────── */

  async options(user: JwtPayload, refresh = false) {
    await this.assertEditor(user);
    if (!this.vald.isConfigured()) return { configured: false, sports: [], groups: [], tags: [], testTypes: [], athletes: [] };
    if (!refresh && this.optionsCache && Date.now() - this.optionsCache.at < 30 * 60_000) {
      return { ...this.optionsCache.data, athletes: await this.athletes() };
    }
    const h = await this.history(refresh);
    const meta = await this.meta();
    /* Every test type VALD actually has (all time), plus the well-known ones
       and any already pulled -- so a type is choosable before its first pull. */
    const testTypes = new Map<string, { code: string; label: string; device: string }>();
    for (const t of h.testTypes) testTypes.set(t.code, t);
    for (const [code, label] of Object.entries(FD_TEST_LABELS)) if (!testTypes.has(code)) testTypes.set(code, { code, label, device: 'forcedecks' });
    for (const code of KNOWN_DYNAMO_CODES) if (!testTypes.has(code)) testTypes.set(code, { code, label: dynamoTestLabel(code), device: 'dynamo' });
    for (const [code, t] of Object.entries(meta.tests)) {
      const device = t.source === 'vald:dynamo' ? 'dynamo' : t.source === 'vald:smartspeed' ? 'smartspeed' : 'forcedecks';
      if (!testTypes.has(code)) testTypes.set(code, { code, label: t.label, device });
    }
    const data = {
      configured: true,
      sports: h.groups.filter((g) => g.category === 'Sport').map(({ profileIds: _p, ...g }) => g),
      groups: h.groups.filter((g) => g.category !== 'Sport').map(({ profileIds: _p, ...g }) => g),
      tags: h.tags.map(({ profileIds: _p, ...t }) => t),
      testTypes: [...testTypes.values()].sort((a, b) => VALD_DEVICES.indexOf(a.device) - VALD_DEVICES.indexOf(b.device) || a.label.localeCompare(b.label)),
    };
    this.optionsCache = { at: Date.now(), data };
    return { ...data, athletes: await this.athletes() };
  }

  /**
   * Everything in VALD's history (all time): groups with their members,
   * ForceDecks tags with the athletes tested under them, and every test
   * type of each device. Read-only, cached 30 minutes. Used by the import
   * filters and by Data -> Studies (VALD groups / tags as athlete filters).
   */
  async history(refresh = false): Promise<ValdHistory> {
    if (!refresh && this.historyCache && Date.now() - this.historyCache.at < 30 * 60_000) return this.historyCache.data;
    const T = this.vald.tenantId;
    const cats = (await this.vald.get<any>('externaltenants', `/categories?TenantId=${T}`))?.categories ?? [];
    const groupsRaw = (await this.vald.get<any>('externaltenants', `/groups?TenantId=${T}`))?.groups ?? [];
    const catName = new Map<string, string>(cats.map((c: any) => [c.id, c.name]));
    const groups: ValdHistory['groups'] = [];
    for (const g of groupsRaw) {
      const members = (await this.vald.get<any>('externalprofile', `/profiles?TenantId=${T}&GroupId=${g.id}`))?.profiles ?? [];
      groups.push({ id: g.id, name: g.name, category: catName.get(g.categoryId) ?? '', profileIds: members.map((p: any) => p.profileId) });
      await sleep(PAUSE_MS);
    }
    groups.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    const testTypes = new Map<string, { code: string; label: string; device: string }>();
    const tags = new Map<string, { id: string; name: string; type: string; profileIds: Set<string> }>();
    let cursor = '2000-01-01T00:00:00.000Z';
    const seen = new Set<string>();
    for (let page = 0; page < 400; page++) {
      const batch = (await this.vald.get<any>('extforcedecks', `/tests?TenantId=${T}&ModifiedFromUtc=${encodeURIComponent(cursor)}`))?.tests ?? [];
      let fresh = 0;
      for (const t of batch) {
        if (seen.has(t.testId)) continue;
        seen.add(t.testId);
        fresh += 1;
        const code = String(t.testType || '').toUpperCase().slice(0, 30);
        if (code && !testTypes.has(code)) testTypes.set(code, { code, label: FD_TEST_LABELS[code] ?? code, device: 'forcedecks' });
        for (const a of t.attributes || []) {
          if (!a?.attributeValueId) continue;
          const tag = tags.get(a.attributeValueId) ?? { id: a.attributeValueId, name: a.attributeValueName ?? '', type: a.attributeTypeName ?? 'Tag', profileIds: new Set<string>() };
          if (t.profileId) tag.profileIds.add(t.profileId);
          tags.set(a.attributeValueId, tag);
        }
      }
      if (batch.length < 50 || !fresh) break;
      const last = batch[batch.length - 1].modifiedDateUtc;
      if (!last || last === cursor) break;
      cursor = last;
      await sleep(PAUSE_MS);
    }
    const q = `testFromUTC=${encodeURIComponent('2000-01-01T00:00:00.000Z')}&testToUTC=${encodeURIComponent(new Date(Date.now() + DAY).toISOString())}`;
    for (let page = 1; page <= 200; page++) {
      const j = await this.vald.get<any>('extdynamo', `/v2022q2/teams/${T}/tests?${q}&page=${page}`);
      for (const t of j?.items ?? []) for (const c of dynamoCodesOf(t)) if (!testTypes.has(c.code)) testTypes.set(c.code, { ...c, device: 'dynamo' });
      if (!(j?.items ?? []).length || (j?.totalPages && page >= j.totalPages)) break;
      await sleep(PAUSE_MS);
    }
    for (const rep of await this.smartSpeedReps(new Date('2000-01-01T00:00:00.000Z'), new Date(Date.now() + DAY))) {
      const code = smartSpeedTestCode(rep.testName);
      if (!testTypes.has(code)) testTypes.set(code, { code, label: String(rep.testName || code), device: 'smartspeed' });
    }
    const data: ValdHistory = {
      groups,
      tags: [...tags.values()].map((t) => ({ ...t, profileIds: [...t.profileIds] })).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)),
      testTypes: [...testTypes.values()],
    };
    this.historyCache = { at: Date.now(), data };
    return data;
  }

  configured(): boolean { return this.vald.isConfigured(); }

  /** VALD profile -> app athlete (External ID, else name + birthday). */
  async profileToPlayer(): Promise<Map<string, string>> {
    const T = this.vald.tenantId;
    const roster: RosterPlayer[] = await this.prisma.player.findMany({ select: { id: true, firstName: true, lastName: true, birthDate: true, athleteCode: true } });
    const profiles: ValdProfile[] = (await this.vald.get<any>('externalprofile', `/profiles?TenantId=${T}`))?.profiles ?? [];
    const out = new Map<string, string>();
    for (const p of profiles) { const m = matchProfile(p, roster); if (m.playerId) out.set(p.profileId, m.playerId); }
    return out;
  }

  private async athletes() {
    const rows = await this.prisma.player.findMany({ select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
    return rows.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}`.trim() }));
  }

  /* ── Pull ──────────────────────────────────────────────────────────── */

  /** PULL button: saves what was chosen as the manual settings, then pulls in the background. */
  async startManualPull(raw: any, user: JwtPayload) {
    await this.assertEditor(user);
    if (!this.vald.isConfigured()) throw new BadRequestException('VALD is not connected');
    if (this.job?.running) throw new ConflictException('A VALD pull is already running');
    const saved = await this.saveSettings({ manual: raw, auto: undefined }, user);
    const m = saved.settings.manual;
    const from = new Date(`${m.from}T00:00:00.000Z`);
    const to = new Date(new Date(`${m.to}T00:00:00.000Z`).getTime() + DAY); // whole end day
    void this.run('manual', m, from, to).catch((e) => this.logger.warn(`VALD pull failed: ${e?.message || e}`));
    return this.status(user);
  }

  /**
   * A NEW VALD session for an athlete turns their profile's Physical tab on
   * (where the Lifting Report lives) -- it starts hidden for every athlete.
   * Pulling the same session again doesn't, so a coach who hides the tab
   * afterwards keeps it hidden until a new session arrives. Returns true
   * when the tab was turned on.
   */
  private async showPhysicalTab(playerId: string): Promise<boolean> {
    if (this.physicalShownThisRun.has(playerId)) return false;
    this.physicalShownThisRun.add(playerId);
    const p = await this.prisma.player.findUnique({ where: { id: playerId }, select: { hiddenTabs: true } });
    if (!p) return false;
    let hidden: string[];
    try {
      const parsed = p.hiddenTabs ? JSON.parse(p.hiddenTabs) : null;
      hidden = Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [...DEFAULT_HIDDEN_TABS];
    } catch { hidden = [...DEFAULT_HIDDEN_TABS]; }
    if (!hidden.includes('strength')) return false;
    await this.prisma.player.update({ where: { id: playerId }, data: { hiddenTabs: JSON.stringify(hidden.filter((t) => t !== 'strength')) } });
    return true;
  }

  /** SmartSpeed reps (each test is one rep) recorded in [from, to). */
  private async smartSpeedReps(from: Date, to: Date): Promise<SmartSpeedRep[]> {
    const T = this.vald.tenantId;
    const out: SmartSpeedRep[] = [];
    const q = `TestFromUtc=${encodeURIComponent(from.toISOString())}&TestToUtc=${encodeURIComponent(to.toISOString())}`;
    for (let page = 1; page <= 200; page++) {
      const batch = (await this.vald.get<SmartSpeedRep[]>('extsmartspeed', `/v1/team/${T}/tests?${q}&Page=${page}`)) ?? [];
      out.push(...(Array.isArray(batch) ? batch : []));
      if (!Array.isArray(batch) || batch.length < 50) break;
      await sleep(PAUSE_MS);
    }
    return out;
  }

  /**
   * ForceDecks weigh-ins -> weight history: one entry per athlete per day
   * (the day's last weigh-in), marked as from VALD. A weight a person typed
   * for that day wins and is left alone. Each athlete's weight then follows
   * their newest entry (what the name bubble shows).
   */
  private async saveWeighIns(weighIns: Map<string, Map<string, { lbs: number; at: number }>>): Promise<number> {
    let saved = 0;
    for (const [playerId, days] of weighIns) {
      const player = await this.prisma.player.findUnique({ where: { id: playerId }, select: { weightLbs: true, updatedAt: true } });
      if (!player) continue;
      const existing = await this.prisma.weightEntry.findMany({ where: { playerId }, select: { id: true, recordedOn: true, source: true, weightLbs: true } });
      /* An athlete who only had the old single weight keeps it as their first entry. */
      if (!existing.length && player.weightLbs != null) {
        await this.prisma.weightEntry.create({ data: { playerId, weightLbs: player.weightLbs, recordedOn: player.updatedAt.toISOString().slice(0, 10) } });
      }
      let changed = false;
      for (const [day, w] of days) {
        const sameDay = existing.filter((e) => e.recordedOn === day);
        if (sameDay.some((e) => e.source !== 'vald')) continue;
        const mine = sameDay.find((e) => e.source === 'vald');
        if (mine) {
          if (mine.weightLbs !== w.lbs) { await this.prisma.weightEntry.update({ where: { id: mine.id }, data: { weightLbs: w.lbs } }); changed = true; saved += 1; }
        } else {
          await this.prisma.weightEntry.create({ data: { playerId, weightLbs: w.lbs, recordedOn: day, source: 'vald' } });
          changed = true;
          saved += 1;
        }
      }
      if (changed) {
        const latest = await this.prisma.weightEntry.findFirst({ where: { playerId }, orderBy: [{ recordedOn: 'desc' }, { createdAt: 'desc' }], select: { weightLbs: true } });
        if (latest) await this.prisma.player.update({ where: { id: playerId }, data: { weightLbs: latest.weightLbs } });
      }
    }
    return saved;
  }

  private async meta(): Promise<ValdMeta> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: META_KEY } });
    try { const m = row?.value ? JSON.parse(row.value) : null; if (m?.tests) return m; } catch { /* fresh */ }
    return { tests: {} };
  }

  private async run(kind: 'manual' | 'auto', f: ValdFilters, from: Date, to: Date): Promise<PullReport> {
    const report: PullReport = {
      kind, from: from.toISOString(), to: to.toISOString(), startedAt: new Date().toISOString(), finishedAt: null,
      running: true, phase: 'Signing in to VALD', added: 0, replaced: 0, filteredOut: 0, physicalShown: 0, weighIns: 0, unmatched: [], error: null,
    };
    this.job = report;
    this.physicalShownThisRun = new Set();
    const T = this.vald.tenantId;
    const newMeta: Record<string, TestMeta> = {};
    const unmatched = new Map<string, PullReport['unmatched'][number]>();
    /* Days (SmartSpeed sessions, weigh-ins) are local days: the academy's
       time zone (Settings -> Academy), else the one VALD recorded the
       ForceDecks tests in, else UTC. Weigh-ins use each test's own offset. */
    let timeZone = (await this.academy.get().catch(() => null))?.timeZone || undefined;
    /* player -> day -> the day's last ForceDecks weigh-in. */
    const weighIns = new Map<string, Map<string, { lbs: number; at: number }>>();
    try {
      /* Athletes: VALD profiles -> roster. */
      report.phase = 'Matching VALD athletes';
      const roster: RosterPlayer[] = await this.prisma.player.findMany({ select: { id: true, firstName: true, lastName: true, birthDate: true, athleteCode: true } });
      const profiles: ValdProfile[] = (await this.vald.get<any>('externalprofile', `/profiles?TenantId=${T}`))?.profiles ?? [];
      const profileById = new Map(profiles.map((p) => [p.profileId, p]));
      const matches = new Map<string, MatchResult>(profiles.map((p) => [p.profileId, matchProfile(p, roster)]));

      /* Sports / groups: athlete in any chosen sport AND any chosen group. */
      const members = async (groupIds: string[]) => {
        const set = new Set<string>();
        for (const g of groupIds) {
          const list = (await this.vald.get<any>('externalprofile', `/profiles?TenantId=${T}&GroupId=${g}`))?.profiles ?? [];
          for (const p of list) set.add(p.profileId);
          await sleep(PAUSE_MS);
        }
        return set;
      };
      const inSport = f.sportIds.length ? await members(f.sportIds) : null;
      const inGroup = f.groupIds.length ? await members(f.groupIds) : null;
      const chosenPlayers = f.playerIds.length ? new Set(f.playerIds) : null;
      const allowedProfile = (profileId: string) => {
        if (inSport && !inSport.has(profileId)) return false;
        if (inGroup && !inGroup.has(profileId)) return false;
        if (chosenPlayers) {
          const m = matches.get(profileId);
          if (!m?.playerId || !chosenPlayers.has(m.playerId)) return false;
        }
        return true;
      };
      const noteUnmatched = (profileId: string) => {
        const m = matches.get(profileId);
        const p = profileById.get(profileId);
        const entry = unmatched.get(profileId) ?? {
          name: p ? `${p.givenName ?? ''} ${p.familyName ?? ''}`.trim() || 'Unnamed VALD athlete' : 'Unknown VALD athlete',
          birthday: p?.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : null,
          reason: m && m.playerId === null ? m.reason : 'no-match',
          tests: 0,
        };
        entry.tests += 1;
        unmatched.set(profileId, entry);
      };
      const save = async (source: string, externalId: string, playerId: string, testType: string, recordedAt: Date, metrics: Record<string, number>) => {
        const existing = await this.prisma.liftingTest.findUnique({ where: { source_externalId: { source, externalId } }, select: { id: true } });
        const data = { playerId, testType, recordedAt, metrics: JSON.stringify(metrics) };
        if (existing) {
          await this.prisma.liftingTest.update({ where: { id: existing.id }, data });
          report.replaced += 1;
        } else {
          await this.prisma.liftingTest.create({ data: { ...data, source, externalId } });
          report.added += 1;
          if (await this.showPhysicalTab(playerId)) report.physicalShown += 1;
        }
      };
      const excluded = new Set(f.excludedTestTypes);

      /* ForceDecks. */
      if (f.devices.includes('forcedecks')) {
        report.phase = 'Reading ForceDecks tests';
        const defsRaw = (await this.vald.get<any>('extforcedecks', '/resultdefinitions'))?.resultDefinitions ?? [];
        const defs = new Map<string, FdResultDef>(defsRaw.map((d: FdResultDef) => [d.resultIdString, d]));
        const tests: any[] = [];
        const seen = new Set<string>();
        let cursor = from.toISOString();
        for (let page = 0; page < 400; page++) {
          const batch = (await this.vald.get<any>('extforcedecks', `/tests?TenantId=${T}&ModifiedFromUtc=${encodeURIComponent(cursor)}`))?.tests ?? [];
          let fresh = 0;
          for (const t of batch) if (!seen.has(t.testId)) { seen.add(t.testId); tests.push(t); fresh++; }
          if (batch.length < 50 || !fresh) break;
          const last = batch[batch.length - 1].modifiedDateUtc;
          if (!last || last === cursor) break;
          cursor = last;
          await sleep(PAUSE_MS);
        }
        if (!timeZone) {
          const count = new Map<string, number>();
          for (const t of tests) { const z = ianaFromVald(t.recordedDateTimezone); if (z) count.set(z, (count.get(z) ?? 0) + 1); }
          timeZone = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        }
        const inRange = tests.filter((t) => {
          const at = Date.parse(t.recordedDateUtc);
          return at >= from.getTime() && at < to.getTime();
        });
        let n = 0;
        for (const t of inRange) {
          n += 1;
          report.phase = `ForceDecks ${n} of ${inRange.length}`;
          const code = String(t.testType || '').toUpperCase().slice(0, 30);
          const m = matches.get(t.profileId);
          /* The weigh-in counts whatever the test (test type / tag filters
             are about which results to show, not the athlete's weight). */
          const lbs = weighInLbs(t.weight, code);
          if (lbs != null && m?.playerId && allowedProfile(t.profileId)) {
            const at = Date.parse(t.recordedDateUtc);
            const day = typeof t.recordedDateOffset === 'number' ? dayAtOffset(t.recordedDateUtc, t.recordedDateOffset) : localDay(new Date(at), timeZone);
            const days = weighIns.get(m.playerId) ?? weighIns.set(m.playerId, new Map()).get(m.playerId)!;
            const cur = days.get(day);
            if (!cur || at > cur.at) days.set(day, { lbs, at });
          }
          if (!code || excluded.has(code) || !allowedProfile(t.profileId) || !passesTags(t.attributes, f.tagIds)) { report.filteredOut += 1; continue; }
          if (!m?.playerId) { noteUnmatched(t.profileId); continue; }
          const trials = (await this.vald.get<any[]>('extforcedecks', `/v2019q3/teams/${T}/tests/${t.testId}/trials`)) ?? [];
          const { metrics, meta } = aggregateForceDecks(trials, defs);
          if (Object.keys(metrics).length) {
            await save('vald:forcedecks', t.testId, m.playerId, code, new Date(t.recordedDateUtc), metrics);
            const tm = newMeta[code] ?? (newMeta[code] = { label: FD_TEST_LABELS[code] ?? code, source: 'vald:forcedecks', metrics: {} });
            Object.assign(tm.metrics, meta);
          }
          await sleep(PAUSE_MS);
        }
      }

      if (weighIns.size) {
        report.phase = 'Saving weigh-ins';
        report.weighIns = await this.saveWeighIns(weighIns);
      }

      /* DynaMo (no tags -- pulled whatever tags are chosen). */
      if (f.devices.includes('dynamo')) {
        report.phase = 'Reading DynaMo tests';
        const q = `testFromUTC=${encodeURIComponent(from.toISOString())}&testToUTC=${encodeURIComponent(to.toISOString())}&includeRepSummaries=true`;
        for (let page = 1; page <= 200; page++) {
          const j = await this.vald.get<any>('extdynamo', `/v2022q2/teams/${T}/tests?${q}&page=${page}`);
          const items: any[] = j?.items ?? [];
          for (const t of items) {
            if (!allowedProfile(t.athleteId)) { report.filteredOut += 1; continue; }
            const m = matches.get(t.athleteId);
            if (!m?.playerId) { noteUnmatched(t.athleteId); continue; }
            const sessions = aggregateDynamo(t);
            /* A combined IR + ER test is saved as two sessions (id:IR, id:ER);
               an earlier import kept it as one -- that one goes. */
            if (sessions.some((x) => x.idSuffix)) {
              await this.prisma.liftingTest.deleteMany({ where: { source: 'vald:dynamo', externalId: t.id } });
            }
            for (const x of sessions) {
              if (excluded.has(x.code)) { report.filteredOut += 1; continue; }
              if (!Object.keys(x.metrics).length) continue;
              await save('vald:dynamo', t.id + x.idSuffix, m.playerId, x.code, new Date(t.startTimeUTC || t.analysedDateUTC), x.metrics);
              const tm = newMeta[x.code] ?? (newMeta[x.code] = { label: x.label, source: 'vald:dynamo', metrics: {} });
              Object.assign(tm.metrics, x.meta);
            }
          }
          report.phase = `DynaMo page ${page}`;
          if (!items.length || (j?.totalPages && page >= j.totalPages)) break;
          await sleep(PAUSE_MS);
        }
      }

      /* SmartSpeed (no tags). Each test is one rep, so a session = one
         athlete's reps of one drill on one day (academy time zone). Reps are
         read from 2 days before to 1 day after the range, so a day at
         either end is never saved half-read (a re-pull replaces it). */
      if (f.devices.includes('smartspeed')) {
        report.phase = 'Reading SmartSpeed tests';
        const firstDay = localDay(new Date(from.getTime() - DAY), timeZone);
        const reps = (await this.smartSpeedReps(new Date(from.getTime() - 2 * DAY), new Date(to.getTime() + DAY))).filter((r) => r?.profileId && r.testDateUtc);
        const sessions = new Map<string, SmartSpeedRep[]>();
        for (const r of reps) {
          const at = new Date(r.testDateUtc.endsWith('Z') ? r.testDateUtc : `${r.testDateUtc}Z`);
          const key = `${r.profileId}|${smartSpeedTestCode(r.testName)}|${localDay(at, timeZone)}`;
          (sessions.get(key) ?? sessions.set(key, []).get(key)!).push(r);
        }
        let n = 0;
        for (const [key, list] of sessions) {
          n += 1;
          report.phase = `SmartSpeed ${n} of ${sessions.size}`;
          const [profileId, code, day] = key.split('|');
          const first = list.map((r) => Date.parse(r.testDateUtc.endsWith('Z') ? r.testDateUtc : `${r.testDateUtc}Z`)).sort((a, b) => a - b)[0];
          if (day < firstDay || first >= to.getTime()) continue;
          if (excluded.has(code) || !allowedProfile(profileId)) { report.filteredOut += 1; continue; }
          const m = matches.get(profileId);
          if (!m?.playerId) { noteUnmatched(profileId); continue; }
          const { metrics, meta } = aggregateSmartSpeed(list);
          if (!Object.keys(metrics).length) continue;
          await save('vald:smartspeed', `ss:${profileId}:${code}:${day}`, m.playerId, code, new Date(first), metrics);
          const tm = newMeta[code] ?? (newMeta[code] = { label: String(list[0].testName || code), source: 'vald:smartspeed', metrics: {} });
          Object.assign(tm.metrics, meta);
        }
      }

      /* VALD's names / units for the box editor. */
      if (Object.keys(newMeta).length) {
        const meta = await this.meta();
        for (const [code, tm] of Object.entries(newMeta)) {
          const cur = meta.tests[code] ?? { label: tm.label, source: tm.source, metrics: {} };
          cur.label = tm.label;
          Object.assign(cur.metrics, tm.metrics);
          meta.tests[code] = cur;
        }
        const stored = new Set((await this.prisma.liftingTest.findMany({ where: { source: { startsWith: 'vald:' } }, distinct: ['testType'], select: { testType: true } })).map((r) => r.testType));
        for (const code of Object.keys(meta.tests)) if (!stored.has(code)) delete meta.tests[code];
        const value = JSON.stringify(meta);
        await this.prisma.appSetting.upsert({ where: { key: META_KEY }, create: { key: META_KEY, value }, update: { value } });
      }
      report.phase = 'Done';
    } catch (e: any) {
      report.error = e?.message || String(e);
      report.phase = 'Stopped';
      this.logger.warn(`VALD ${kind} pull stopped: ${report.error}`);
    } finally {
      report.unmatched = [...unmatched.values()].sort((a, b) => b.tests - a.tests || a.name.localeCompare(b.name));
      report.running = false;
      report.finishedAt = new Date().toISOString();
      const value = JSON.stringify(report);
      await this.prisma.appSetting.upsert({ where: { key: LAST_KEY }, create: { key: LAST_KEY, value }, update: { value } }).catch(() => undefined);
      this.logger.log(`VALD ${kind} pull: ${report.added} added, ${report.replaced} replaced, ${report.weighIns} weigh-ins, ${report.unmatched.length} unmatched athletes${report.error ? ` (error: ${report.error})` : ''}`);
    }
    return report;
  }
}
