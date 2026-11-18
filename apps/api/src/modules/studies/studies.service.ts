import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { coachLevelOf } from '../auth/jwt.guard';
import type { JwtPayload } from '../auth/jwt.util';
import { LiftingService } from '../lifting/lifting.service';
import { ValdService } from '../lifting/vald.service';
import { BODYWEIGHT_TEST } from '../lifting/lifting-catalog';
import { OTHER_MEASURES, REPORT_MEASURES, StudyMeasure, cleanDataRequest, cleanStudy, parseMeasureId } from './study-measures';

/* ─────────────────────────────────────────────────────────────────────────
   Studies (coach-only): the measure list, every athlete's raw points for
   the chosen measures, and saved studies (shared by all coaches -- a saved
   study is its settings, so it recalculates with the newest data whenever
   it's opened).
   ───────────────────────────────────────────────────────────────────────── */

const SOURCE_GROUP: Record<string, string> = {
  'vald:forcedecks': 'VALD ForceDecks',
  'vald:dynamo': 'VALD DynaMo',
  'vald:smartspeed': 'VALD SmartSpeed',
  manual: 'Lifting (typed in)',
  other: 'Lifting',
};

/** [athlete index, "YYYY-MM-DD", value] */
type Point = [number, string, number];

@Injectable()
export class StudiesService {
  constructor(private prisma: PrismaService, private lifting: LiftingService, private vald: ValdService) {}

  /**
   * VALD groups and ForceDecks tags as athlete filters: each with the app
   * athletes in it (VALD athletes matched by External ID, else name +
   * birthday; unmatched ones can't be filtered on). A tag's athletes = the
   * ones with at least one test carrying it. Empty when VALD isn't connected.
   */
  async valdFilters(refresh = false) {
    if (!this.vald.configured()) return { configured: false, groups: [], tags: [] };
    const [h, toPlayer] = await Promise.all([this.vald.history(refresh), this.vald.profileToPlayer()]);
    const players = (ids: string[]) => [...new Set(ids.map((p) => toPlayer.get(p)).filter((x): x is string => !!x))];
    return {
      configured: true,
      groups: h.groups.map((g) => ({ id: g.id, name: g.name, category: g.category, playerIds: players(g.profileIds) })),
      tags: h.tags.map((t) => ({ id: t.id, name: t.name, type: t.type, playerIds: players(t.profileIds) })),
    };
  }

  /** Every measure that has data, grouped for the picker. */
  async measures(user: JwtPayload): Promise<StudyMeasure[]> {
    const [reportKeys, liftTests, { catalog }] = await Promise.all([
      this.prisma.metric.groupBy({ by: ['metricType'], where: { source: { startsWith: 'REPORT_' } } }),
      this.prisma.liftingTest.findMany({ distinct: ['testType'], select: { testType: true } }),
      this.lifting.getConfig(user),
    ]);
    const haveReport = new Set(reportKeys.map((r) => r.metricType));
    const out: StudyMeasure[] = REPORT_MEASURES.filter((m) => haveReport.has(m.key))
      .map((m) => ({ id: `report:${m.key}`, label: m.label, unit: m.unit, group: m.group, better: m.better, digits: m.digits }));
    out.push(...OTHER_MEASURES);
    const tested = new Set(liftTests.map((t) => t.testType));
    for (const t of catalog) {
      if (t.code === BODYWEIGHT_TEST || !tested.has(t.code)) continue;
      const group = `${SOURCE_GROUP[t.source] ?? 'Lifting'} · ${t.label}`;
      for (const m of t.metrics) {
        out.push({ id: `lift:${t.code}:${m.key}`, label: m.label, unit: m.unit, group, better: m.better ?? null, digits: m.digits ?? 1 });
      }
    }
    return out;
  }

  /** The roster (for grouping / filtering on the page) and each measure's points. */
  async data(raw: any) {
    let req: ReturnType<typeof cleanDataRequest>;
    try { req = cleanDataRequest(raw); } catch (e: any) { throw new BadRequestException(e?.message); }
    const players = await this.prisma.player.findMany({
      select: { id: true, firstName: true, lastName: true, gradYear: true, positions: true, athleteTypes: true, profilePhoto: true, seasonStats: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const index = new Map(players.map((p, i) => [p.id, i]));
    const dateRange: { gte?: Date; lt?: Date } = {
      ...(req.from ? { gte: new Date(`${req.from}T00:00:00.000Z`) } : {}),
      ...(req.to ? { lt: new Date(new Date(`${req.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
    };
    const dayRange: { gte?: string; lte?: string } = { ...(req.from ? { gte: req.from } : {}), ...(req.to ? { lte: req.to } : {}) };
    const hasRange = !!(req.from || req.to);
    const wantsStats = req.ids.some((id) => id.startsWith('stat:'));
    const liftCache = new Map<string, { playerId: string; recordedAt: Date; metrics: Record<string, number> }[]>();
    const series: Record<string, Point[]> = {};

    for (const id of req.ids) {
      const m = parseMeasureId(id)!;
      const pts: Point[] = [];
      const add = (playerId: string, day: string, value: unknown) => {
        const i = index.get(playerId);
        if (i === undefined || typeof value !== 'number' || !Number.isFinite(value)) return;
        pts.push([i, day, value]);
      };
      if (m.kind === 'stat') { series[id] = []; continue; }
      if (m.kind === 'report') {
        const rows = await this.prisma.metric.findMany({
          where: { metricType: m.key, source: { startsWith: 'REPORT_' }, ...(hasRange ? { recordedAt: dateRange } : {}) },
          select: { playerId: true, recordedAt: true, value: true },
        });
        for (const r of rows) add(r.playerId, r.recordedAt.toISOString().slice(0, 10), r.value);
      } else if (m.kind === 'lift') {
        let rows = liftCache.get(m.test);
        if (!rows) {
          const raw = await this.prisma.liftingTest.findMany({
            where: { testType: m.test, ...(hasRange ? { recordedAt: dateRange } : {}) },
            select: { playerId: true, recordedAt: true, metrics: true },
          });
          rows = raw.map((r) => { let metrics: Record<string, number> = {}; try { metrics = JSON.parse(r.metrics) || {}; } catch { /* skip */ } return { playerId: r.playerId, recordedAt: r.recordedAt, metrics }; });
          liftCache.set(m.test, rows);
        }
        for (const r of rows) add(r.playerId, r.recordedAt.toISOString().slice(0, 10), r.metrics[m.avg ? `${m.key}__avg` : m.key]);
      } else if (m.kind === 'weight') {
        const rows = await this.prisma.weightEntry.findMany({
          where: hasRange ? { recordedOn: dayRange } : {},
          select: { playerId: true, recordedOn: true, weightLbs: true },
        });
        for (const r of rows) add(r.playerId, r.recordedOn, r.weightLbs);
      } else {
        const rows = await this.prisma.drillCheckIn.findMany({
          where: { [m.field]: { not: null }, ...(hasRange ? { date: dayRange } : {}) },
          select: { playerId: true, date: true, [m.field]: true } as any,
        });
        for (const r of rows as any[]) add(r.playerId, r.date, r[m.field]);
      }
      pts.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
      series[id] = pts;
    }
    return {
      athletes: players.map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`.trim(),
        gradYear: p.gradYear,
        positions: (p.positions || '').split(',').map((s) => s.trim()).filter(Boolean),
        athleteTypes: (p.athleteTypes || '').split(',').map((s) => s.trim()).filter(Boolean),
        photo: p.profilePhoto,
        /* Season Stats sheets, only when a stat measure was asked for. */
        ...(wantsStats ? { seasonStats: p.seasonStats } : {}),
      })),
      series,
    };
  }

  // ── Saved studies ─────────────────────────────────────────────────────

  async list() {
    const rows = await this.prisma.study.findMany({ orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }] });
    const people = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))] } },
      select: { id: true, name: true, email: true },
    });
    const who = new Map(people.map((u) => [u.id, u.name || u.email]));
    return rows.map((r) => this.out(r, who.get(r.createdById || '') ?? null));
  }

  private out(r: { id: string; title: string; type: string; config: string; conclusion: string | null; pinned: boolean; createdById: string | null; createdAt: Date; updatedAt: Date }, by: string | null) {
    let config: unknown = {};
    try { config = JSON.parse(r.config); } catch { config = {}; }
    return { id: r.id, title: r.title, type: r.type, config, conclusion: r.conclusion, pinned: r.pinned, createdById: r.createdById, createdBy: by, createdAt: r.createdAt, updatedAt: r.updatedAt };
  }

  async create(raw: any, user: JwtPayload) {
    let s: ReturnType<typeof cleanStudy>;
    try { s = cleanStudy(raw); } catch (e: any) { throw new BadRequestException(e?.message); }
    const r = await this.prisma.study.create({ data: { ...s, pinned: raw?.pinned === true, createdById: user.sub } });
    return this.out(r, null);
  }

  /** The coach who made it, or an Admin. */
  private async own(id: string, user: JwtPayload) {
    const r = await this.prisma.study.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Study not found');
    if (r.createdById !== user.sub && coachLevelOf(user) !== 'ADMIN') throw new ForbiddenException('Only the coach who made this study (or an Admin) can change it');
    return r;
  }

  async update(id: string, raw: any, user: JwtPayload) {
    await this.own(id, user);
    let s: ReturnType<typeof cleanStudy>;
    try { s = cleanStudy(raw); } catch (e: any) { throw new BadRequestException(e?.message); }
    const r = await this.prisma.study.update({ where: { id }, data: { ...s, ...(typeof raw?.pinned === 'boolean' ? { pinned: raw.pinned } : {}) } });
    return this.out(r, null);
  }

  async remove(id: string, user: JwtPayload) {
    await this.own(id, user);
    await this.prisma.study.delete({ where: { id } });
    return { ok: true };
  }
}
