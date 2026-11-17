import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { coachLevelOf } from '../auth/jwt.guard';
import type { JwtPayload } from '../auth/jwt.util';
import {
  LIFTING_CATALOG, LiftingConfig, TEST_CODE_RE, defaultLiftingConfig, mergeCatalog, validateLiftingConfig, validateMetrics, validatePlayerIds,
} from './lifting-catalog';

/* ─────────────────────────────────────────────────────────────────────────
   Lifting Dashboard: the default layout (AppSetting "liftingDashboard"),
   athletes' own layouts (LiftingLayout -- replaces the default for that
   athlete), test results (LiftingTest) and who may edit layouts (Admins,
   plus coaches switched on as Lifting editors).
   ───────────────────────────────────────────────────────────────────────── */

const CONFIG_KEY = 'liftingDashboard';

@Injectable()
export class LiftingService {
  constructor(private prisma: PrismaService) {}

  // ── Layout ────────────────────────────────────────────────────────────

  async getConfig(user?: JwtPayload) {
    const row = await this.prisma.appSetting.findUnique({ where: { key: CONFIG_KEY } });
    let config: LiftingConfig | null = null;
    if (row?.value) {
      try { config = validateLiftingConfig(JSON.parse(row.value)); } catch { config = null; }
    }
    return {
      config: config ?? defaultLiftingConfig(),
      isDefault: !config,
      catalog: user && coachLevelOf(user) ? await this.catalog() : LIFTING_CATALOG,
      canEdit: user ? await this.canEdit(user) : false,
    };
  }

  /** The catalog plus every test / metric that saved results hold (so any
   *  result VALD sends can be put in a box). Recent results are enough --
   *  a metric VALD reports shows up on every test of that kind. */
  private async catalog() {
    const rows = await this.prisma.liftingTest.findMany({
      orderBy: { recordedAt: 'desc' },
      take: 3000,
      select: { testType: true, metrics: true },
    });
    const seen = new Map<string, Set<string>>();
    for (const r of rows) {
      const keys = seen.get(r.testType) ?? new Set<string>();
      for (const k of Object.keys(parseMetrics(r.metrics))) keys.add(k);
      seen.set(r.testType, keys);
    }
    return mergeCatalog(LIFTING_CATALOG, seen);
  }

  // ── An athlete's own layout ───────────────────────────────────────────

  /** What this athlete's dashboard shows: their own layout when they have
   *  one, else the default. */
  async getPlayerLayout(playerId: string, user?: JwtPayload) {
    const [base, row] = await Promise.all([
      this.getConfig(user),
      this.prisma.liftingLayout.findUnique({ where: { playerId }, select: { config: true, updatedAt: true } }),
    ]);
    let own: LiftingConfig | null = null;
    if (row?.config) {
      try { own = validateLiftingConfig(JSON.parse(row.config)); } catch { own = null; }
    }
    return { ...base, config: own ?? base.config, personal: !!own, updatedAt: own ? row!.updatedAt : null };
  }

  async savePlayerLayout(playerId: string, raw: unknown, user: JwtPayload) {
    await this.assertEditor(user);
    const player = await this.prisma.player.findUnique({ where: { id: playerId }, select: { id: true } });
    if (!player) throw new NotFoundException('Athlete not found');
    let config: LiftingConfig;
    try { config = validateLiftingConfig(raw); } catch (err: any) { throw new BadRequestException(err?.message || 'Invalid layout'); }
    const value = JSON.stringify(config);
    await this.prisma.liftingLayout.upsert({
      where: { playerId },
      create: { playerId, config: value, updatedById: user.sub },
      update: { config: value, updatedById: user.sub },
    });
    return this.getPlayerLayout(playerId, user);
  }

  /** Back to the default layout. */
  async resetPlayerLayout(playerId: string, user: JwtPayload) {
    await this.assertEditor(user);
    await this.prisma.liftingLayout.deleteMany({ where: { playerId } });
    return this.getPlayerLayout(playerId, user);
  }

  /** Athletes who have their own layout, with it. */
  async listPlayerLayouts() {
    const rows = await this.prisma.liftingLayout.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { playerId: true, updatedAt: true, config: true, player: { select: { firstName: true, lastName: true } } },
    });
    return rows.flatMap((r) => {
      let config: LiftingConfig;
      try { config = validateLiftingConfig(JSON.parse(r.config)); } catch { return []; }
      return [{ playerId: r.playerId, name: `${r.player.firstName} ${r.player.lastName}`.trim(), updatedAt: r.updatedAt, config }];
    });
  }

  /** One layout for several athletes at once (Settings -> Athlete
   *  Dashboards with more than one athlete picked). */
  async savePlayerLayouts(dto: { playerIds?: unknown; config?: unknown }, user: JwtPayload) {
    await this.assertEditor(user);
    let playerIds: string[];
    let config: LiftingConfig;
    try {
      playerIds = validatePlayerIds(dto?.playerIds);
      config = validateLiftingConfig(dto?.config);
    } catch (err: any) { throw new BadRequestException(err?.message || 'Invalid layout'); }
    const found = await this.prisma.player.count({ where: { id: { in: playerIds } } });
    if (found !== playerIds.length) throw new NotFoundException('Athlete not found');
    const value = JSON.stringify(config);
    await this.prisma.$transaction(playerIds.map((playerId) => this.prisma.liftingLayout.upsert({
      where: { playerId },
      create: { playerId, config: value, updatedById: user.sub },
      update: { config: value, updatedById: user.sub },
    })));
    return this.listPlayerLayouts();
  }

  /** Put several athletes back on the default layout. */
  async resetPlayerLayouts(dto: { playerIds?: unknown }, user: JwtPayload) {
    await this.assertEditor(user);
    let playerIds: string[];
    try { playerIds = validatePlayerIds(dto?.playerIds); } catch (err: any) { throw new BadRequestException(err?.message); }
    await this.prisma.liftingLayout.deleteMany({ where: { playerId: { in: playerIds } } });
    return this.listPlayerLayouts();
  }

  /** Admins, plus coaches switched on as Lifting editors (never Viewers). */
  async canEdit(user: JwtPayload): Promise<boolean> {
    const level = coachLevelOf(user);
    if (!level || level === 'VIEWER') return false;
    if (level === 'ADMIN') return true;
    const u = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { liftingEditor: true } });
    return !!u?.liftingEditor;
  }

  private async assertEditor(user: JwtPayload) {
    if (!(await this.canEdit(user))) throw new ForbiddenException('Only Admins and Lifting editors can change the dashboard');
  }

  async saveConfig(raw: unknown, user: JwtPayload) {
    await this.assertEditor(user);
    let config: LiftingConfig;
    try { config = validateLiftingConfig(raw); } catch (err: any) { throw new BadRequestException(err?.message || 'Invalid layout'); }
    const value = JSON.stringify(config);
    await this.prisma.appSetting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value }, update: { value } });
    return this.getConfig(user);
  }

  async resetConfig(user: JwtPayload) {
    await this.assertEditor(user);
    await this.prisma.appSetting.deleteMany({ where: { key: CONFIG_KEY } });
    return this.getConfig(user);
  }

  // ── Editors (Admin) ───────────────────────────────────────────────────

  async listEditors() {
    const rows = await this.prisma.user.findMany({
      where: { role: 'COACH' },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      select: { id: true, name: true, email: true, coachLevel: true, liftingEditor: true },
    });
    return rows.map((r) => ({
      id: r.id, name: r.name || r.email, level: r.coachLevel || 'ADMIN', liftingEditor: r.liftingEditor,
    }));
  }

  async setEditor(userId: string, on: unknown) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!u || u.role !== 'COACH') throw new NotFoundException('Coach not found');
    await this.prisma.user.update({ where: { id: userId }, data: { liftingEditor: on === true } });
    return { ok: true };
  }

  // ── Results ───────────────────────────────────────────────────────────

  async listTests(playerId: string) {
    const rows = await this.prisma.liftingTest.findMany({
      where: { playerId },
      orderBy: { recordedAt: 'desc' },
      take: 1000,
      select: { id: true, source: true, testType: true, recordedAt: true, metrics: true, notes: true },
    });
    return rows.map((r) => ({ ...r, metrics: parseMetrics(r.metrics) }));
  }

  /** A coach types a result in (med ball velocity, or a test before VALD
   *  is connected). Values arrive in the stored units. */
  async addTest(playerId: string, dto: { testType?: unknown; recordedAt?: unknown; metrics?: unknown; notes?: unknown }, actorId?: string) {
    const player = await this.prisma.player.findUnique({ where: { id: playerId }, select: { id: true } });
    if (!player) throw new NotFoundException('Athlete not found');
    const testType = typeof dto?.testType === 'string' ? dto.testType.trim().toUpperCase() : '';
    if (!TEST_CODE_RE.test(testType)) throw new BadRequestException('Pick a test');
    const when = typeof dto?.recordedAt === 'string' ? Date.parse(dto.recordedAt) : NaN;
    if (Number.isNaN(when)) throw new BadRequestException('Pick a date');
    if (when > Date.now() + 86_400_000) throw new BadRequestException('That date is in the future');
    let metrics: Record<string, number>;
    try { metrics = validateMetrics(dto?.metrics); } catch (err: any) { throw new BadRequestException(err?.message); }
    const notes = typeof dto?.notes === 'string' ? dto.notes.trim().slice(0, 500) || null : null;
    const row = await this.prisma.liftingTest.create({
      data: { playerId, source: 'manual', testType, recordedAt: new Date(when), metrics: JSON.stringify(metrics), notes, createdById: actorId ?? null },
      select: { id: true, source: true, testType: true, recordedAt: true, metrics: true, notes: true },
    });
    return { ...row, metrics: parseMetrics(row.metrics) };
  }

  /** Coaches remove typed results; VALD results come back on the next sync,
   *  so only Admins may remove those. */
  async deleteTest(id: string, user: JwtPayload) {
    const row = await this.prisma.liftingTest.findUnique({ where: { id }, select: { id: true, source: true } });
    if (!row) throw new NotFoundException('Result not found');
    if (row.source !== 'manual' && coachLevelOf(user) !== 'ADMIN') {
      throw new ForbiddenException('Only Admins can remove VALD results');
    }
    await this.prisma.liftingTest.delete({ where: { id } });
    return { ok: true };
  }

  /** Coach page: each athlete's latest two results per test. */
  async team() {
    const rows = await this.prisma.liftingTest.findMany({
      orderBy: { recordedAt: 'desc' },
      select: { playerId: true, testType: true, recordedAt: true, metrics: true },
      take: 20_000,
    });
    const kept = new Map<string, number>();
    const out: { playerId: string; testType: string; recordedAt: Date; metrics: Record<string, number> }[] = [];
    for (const r of rows) {
      const k = `${r.playerId}|${r.testType}`;
      const n = kept.get(k) ?? 0;
      if (n >= 2) continue;
      kept.set(k, n + 1);
      out.push({ ...r, metrics: parseMetrics(r.metrics) });
    }
    return out;
  }
}

function parseMetrics(raw: string): Record<string, number> {
  try {
    const m = JSON.parse(raw);
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}
