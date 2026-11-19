import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt.util';
import { LiftingService } from '../lifting/lifting.service';
import { BODYWEIGHT_TEST } from '../lifting/lifting-catalog';
import {
  BATTED_BALL_SKIP, BATTED_BALL_SOURCES, TM_FIELDS, aggregateDaily, cleanDataSet, metricLabel, pitchTypeLabel, tmPitchValue,
  type DataSetColumn, type DataSetRow,
} from './player-data';

export { aggregateDaily } from './player-data';

/* Chart Builder sources beyond the Metric table:
     LIFTING      metricType "<TEST>:<KEY>" (session best) or "<TEST>:<KEY>:avg"
                  -- Lifting Report results (VALD ForceDecks / DynaMo /
                  SmartSpeed and typed results)
     BODY_WEIGHT  metricType "weight" -- the weight history (typed + VALD)
     REPORTS      metricType = a report metric key (max_exit_velo ...) -- one
                  value per saved report (the Player Summary trend points),
                  instead of every raw swing / pitch row.

   The Chart Builder lists two data sets (dataset on each column): Athlete
   Reports (REPORTS + body weight) and VALD (LIFTING). The per-report
   REPORT_<id> sources are never listed as columns -- there's one per saved
   report, which repeated every metric (Blast, Full Swing ...) dozens of times.

   Visibility: PRIVATE = coaches only (every coach sees it on the athletes
   it applies to; athletes / parents never do), GLOBAL = athletes too. */
const REPORTS_SOURCE = 'REPORTS';
/* Player Data (the Chart Builder's default data source) -- see player-data.ts. */
const TM_SOURCE = 'TM_PITCH';
const BATTED_SOURCE = 'BATTED_BALL';
const LIFT_SOURCE = 'LIFTING';
const WEIGHT_SOURCE = 'BODY_WEIGHT';
const LIFT_GROUP: Record<string, string> = {
  'vald:forcedecks': 'VALD ForceDecks',
  'vald:dynamo': 'VALD DynaMo',
  'vald:smartspeed': 'VALD SmartSpeed',
  manual: 'Lifting (typed in)',
};

export interface ChartConfigDto {
  scope?: 'PRIVATE' | 'GLOBAL';
  section: string;
  chartType: string;
  title: string;
  dataSources: Array<{ source: string; metricType: string; label?: string; color?: string }>;
  dateMode?: 'ALL_TIME' | 'RANGE' | 'LAST_N_DAYS';
  dateFrom?: string | null;
  dateTo?: string | null;
  lastNDays?: number | null;
  playerScope?: 'ALL' | 'INDIVIDUAL' | string;
  playerIds?: string[] | null;
  dataMode?: 'DATE_RANGE' | 'REPORTS';
  reportIds?: string[] | null;
  sortOrder?: number;
  // Advanced chart-specific options (all optional)
  rollingWindow?: number | null;
  rollingMode?: 'SMA' | 'EMA' | null;
  targetMin?: number | null;
  targetMax?: number | null;
  pbDirection?: 'MAX' | 'MIN' | null;
  zoneGrid?: '3x3' | '5x5' | null;
  zoneMetric?: 'COUNT' | 'AVG' | 'WHIFF' | null;
  // Optional cohort overlay — when enabled, a parallel "class average" series
  // is appended to every primary series. cohortMode controls which peers count.
  cohortEnabled?: boolean | null;
  cohortMode?: 'GRAD_YEAR' | 'POSITION' | 'ALL' | null;
  /** "PLAYER" | "ds:<DataSet id>" (older charts: "REPORTS" | "VALD"). */
  dataset?: string | null;
  /** Benchmark line from a Data Set row. */
  benchmark?: { dataSetId: string; row: string } | null;
  /** One point per day: average or max of that day's readings. */
  dailyAgg?: 'AVG' | 'MAX' | null;
}

const cleanDataset = (v: unknown) =>
  (v === 'PLAYER' || v === 'REPORTS' || v === 'VALD' || (typeof v === 'string' && /^ds:[A-Za-z0-9-]{1,64}$/.test(v)) ? (v as string) : null);
const cleanDailyAgg = (v: unknown) => (v === 'AVG' || v === 'MAX' ? v : null);
const cleanBenchmark = (v: any) =>
  v && typeof v.dataSetId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v.dataSetId) && typeof v.row === 'string' && v.row.trim()
    ? JSON.stringify({ dataSetId: v.dataSetId, row: v.row.trim().slice(0, 100) }) : null;
const parseBenchmark = (v: string | null | undefined): { dataSetId: string; row: string } | null => {
  try { const b = v ? JSON.parse(v) : null; return b?.dataSetId && b?.row ? b : null; } catch { return null; }
};

type Series = { source: string; metricType: string; label: string; points: { date: string; value: number }[]; benchmark?: boolean; athlete?: boolean; cohort?: boolean };

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService, private lifting: LiftingService) {}

  /** Points of a Lifting / Body Weight source for some athletes (null = not one of those sources). */
  private async extraPoints(playerIds: string[], s: { source: string; metricType: string }, dateFilter: { gte?: Date; lte?: Date } | null): Promise<{ playerId: string; date: Date; value: number }[] | null> {
    if (s.source === WEIGHT_SOURCE) {
      const day = (d?: Date) => (d ? d.toISOString().slice(0, 10) : undefined);
      const rows = await this.prisma.weightEntry.findMany({
        where: {
          playerId: { in: playerIds },
          ...(dateFilter ? { recordedOn: { ...(dateFilter.gte ? { gte: day(dateFilter.gte) } : {}), ...(dateFilter.lte ? { lte: day(dateFilter.lte) } : {}) } } : {}),
        },
        orderBy: [{ recordedOn: 'asc' }, { createdAt: 'asc' }],
        select: { playerId: true, recordedOn: true, weightLbs: true },
      });
      return rows.map((r) => ({ playerId: r.playerId, date: new Date(`${r.recordedOn}T12:00:00.000Z`), value: r.weightLbs }));
    }
    if (s.source === TM_SOURCE) {
      const rows = await this.prisma.metric.findMany({
        where: { playerId: { in: playerIds }, source: 'TRACKMAN', metricType: 'trackman_pitch', ...(dateFilter ? { recordedAt: dateFilter } : {}) },
        orderBy: { recordedAt: 'asc' },
        select: { playerId: true, recordedAt: true, rawData: true },
      });
      const out: { playerId: string; date: Date; value: number }[] = [];
      for (const r of rows) {
        let raw: Record<string, unknown> | null = null;
        try { raw = r.rawData ? JSON.parse(r.rawData) : null; } catch { raw = null; }
        const v = tmPitchValue(raw, s.metricType);
        if (v != null) out.push({ playerId: r.playerId, date: r.recordedAt, value: v });
      }
      return out;
    }
    if (s.source === BATTED_SOURCE) {
      const rows = await this.prisma.metric.findMany({
        where: { playerId: { in: playerIds }, source: { in: BATTED_BALL_SOURCES }, metricType: s.metricType, ...(dateFilter ? { recordedAt: dateFilter } : {}) },
        orderBy: { recordedAt: 'asc' },
        select: { playerId: true, recordedAt: true, value: true },
      });
      return rows.map((r) => ({ playerId: r.playerId, date: r.recordedAt, value: r.value }));
    }
    if (s.source === REPORTS_SOURCE) {
      const rows = await this.prisma.metric.findMany({
        where: { playerId: { in: playerIds }, metricType: s.metricType, source: { startsWith: 'REPORT_' }, ...(dateFilter ? { recordedAt: dateFilter } : {}) },
        orderBy: { recordedAt: 'asc' },
        select: { playerId: true, recordedAt: true, value: true },
      });
      return rows.map((r) => ({ playerId: r.playerId, date: r.recordedAt, value: r.value }));
    }
    if (s.source !== LIFT_SOURCE) return null;
    const [test, key, avg] = String(s.metricType).split(':');
    if (!test || !key) return [];
    const rows = await this.prisma.liftingTest.findMany({
      where: { playerId: { in: playerIds }, testType: test, ...(dateFilter ? { recordedAt: dateFilter } : {}) },
      orderBy: { recordedAt: 'asc' },
      select: { playerId: true, recordedAt: true, metrics: true },
    });
    const field = avg === 'avg' ? `${key}__avg` : key;
    const out: { playerId: string; date: Date; value: number }[] = [];
    for (const r of rows) {
      let m: Record<string, unknown> = {};
      try { m = JSON.parse(r.metrics) || {}; } catch { /* skip */ }
      const v = m[field];
      if (typeof v === 'number' && Number.isFinite(v)) out.push({ playerId: r.playerId, date: r.recordedAt, value: v });
    }
    return out;
  }

  private pitchTypes: { at: number; types: string[] } | null = null;

  /** TrackMan pitch types that have pitches (most pitches first), cached 10 minutes. */
  private async trackmanPitchTypes(): Promise<string[]> {
    if (this.pitchTypes && Date.now() - this.pitchTypes.at < 10 * 60_000) return this.pitchTypes.types;
    const rows = await this.prisma.metric.findMany({
      where: { source: 'TRACKMAN', metricType: 'trackman_pitch' },
      orderBy: { recordedAt: 'desc' },
      select: { rawData: true },
      take: 20_000,
    });
    const count = new Map<string, number>();
    for (const r of rows) {
      try { const t = JSON.parse(r.rawData || '{}').pitchType; if (t && t !== 'Unknown') count.set(String(t), (count.get(String(t)) ?? 0) + 1); } catch { /* skip */ }
    }
    const types = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    this.pitchTypes = { at: Date.now(), types };
    return types;
  }

  /** The Chart Builder's Player Data columns, grouped by device: TrackMan
   *  (per pitch type), Blast Motion, HitTrax / Full Swing (pooled), typed
   *  report values, VALD and body weight. Every reading counts; the chart's
   *  Daily Value turns a day into one point. */
  async builderColumns(user?: JwtPayload) {
    type Col = { source: string; metricType: string; unit: string; label: string; group: string; dataset: 'PLAYER' };
    const out: Col[] = [];
    const types = await this.trackmanPitchTypes();
    if (types.length) {
      for (const t of ['ALL', ...types]) {
        for (const f of TM_FIELDS) out.push({ source: TM_SOURCE, metricType: `${f.field}|${t}`, unit: f.unit, label: `${f.label}${t === 'ALL' ? '' : ` (${pitchTypeLabel(t)})`}`, group: `TrackMan · ${pitchTypeLabel(t)}`, dataset: 'PLAYER' });
      }
    }
    const kinds = await this.prisma.metric.groupBy({
      by: ['source', 'metricType', 'unit'],
      where: { source: { in: ['BLAST_MOTION', 'MANUAL', ...BATTED_BALL_SOURCES] } },
    });
    const blast = kinds.filter((k) => k.source === 'BLAST_MOTION');
    for (const k of blast.sort((a, b) => metricLabel(a.metricType).localeCompare(metricLabel(b.metricType)))) {
      out.push({ source: 'BLAST_MOTION', metricType: k.metricType, unit: k.unit, label: metricLabel(k.metricType), group: 'Blast Motion', dataset: 'PLAYER' });
    }
    const batted = new Map<string, string>();
    for (const k of kinds) if (BATTED_BALL_SOURCES.includes(k.source) && !BATTED_BALL_SKIP.has(k.metricType)) batted.set(k.metricType, k.unit);
    for (const [key, unit] of [...batted.entries()].sort((a, b) => metricLabel(a[0]).localeCompare(metricLabel(b[0])))) {
      out.push({ source: BATTED_SOURCE, metricType: key, unit, label: metricLabel(key), group: 'HitTrax / Full Swing', dataset: 'PLAYER' });
    }
    for (const k of kinds.filter((x) => x.source === 'MANUAL')) {
      out.push({ source: 'MANUAL', metricType: k.metricType, unit: k.unit, label: metricLabel(k.metricType), group: 'Typed in reports (defense / speed)', dataset: 'PLAYER' });
    }
    for (const c of await this.liftingColumns(user)) out.push({ ...c, dataset: 'PLAYER' });
    out.push({ source: WEIGHT_SOURCE, metricType: 'weight', unit: 'lb', label: 'Body Weight', group: 'Body Weight', dataset: 'PLAYER' });
    return out;
  }

  // ── Connections (Settings -> Integrations) ──────────────────────────

  /**
   * Every outside data source and how it's doing, for the Connections list:
   * VALD (pulled), MOVE (sends to us with an API key) and the devices whose
   * files are uploaded on reports (TrackMan, Blast Motion, HitTrax, Full
   * Swing). Status only -- no keys, payloads or athlete data.
   */
  async connections(vald: { configured: boolean; settings: any; last: any; job: any } | null) {
    const devices = ['TRACKMAN', 'BLAST_MOTION', 'HITTRAX', 'FULL_SWING'];
    const [metricLast, keys, lastMove, moveUnmatched] = await Promise.all([
      this.prisma.metric.groupBy({ by: ['source'], where: { source: { in: [...devices, 'HITTRAX_POI'] } }, _max: { createdAt: true }, _count: { _all: true } }),
      this.prisma.integrationKey.findMany({ where: { provider: 'move', revokedAt: null }, select: { mode: true } }),
      this.prisma.integrationDelivery.findFirst({ where: { provider: 'move' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, mode: true } }),
      this.prisma.integrationDelivery.count({ where: { provider: 'move', status: 'unmatched' } }),
    ]);
    const byDevice = new Map(metricLast.map((m) => [m.source, { last: m._max.createdAt, readings: m._count._all }]));
    const poi = byDevice.get('HITTRAX_POI');
    const hittrax = byDevice.get('HITTRAX');
    if (poi) byDevice.set('HITTRAX', {
      last: [hittrax?.last, poi.last].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
      readings: (hittrax?.readings ?? 0) + poi.readings,
    });
    const lastRun = vald?.job?.running ? vald.job : vald?.last;
    return {
      vald: vald ? {
        configured: vald.configured,
        running: !!vald.job?.running,
        autoEnabled: !!vald.settings?.auto?.enabled,
        everyDays: vald.settings?.auto?.everyDays ?? null,
        lastAt: lastRun?.finishedAt ?? null,
        lastAdded: lastRun?.added ?? 0,
        lastReplaced: lastRun?.replaced ?? 0,
        lastError: vald.last?.error ?? null,
        unmatched: vald.last?.unmatched?.length ?? 0,
      } : null,
      move: {
        liveKeys: keys.filter((k) => k.mode === 'live').length,
        testKeys: keys.filter((k) => k.mode !== 'live').length,
        lastAt: lastMove?.createdAt ?? null,
        lastMode: lastMove?.mode ?? null,
        unmatched: moveUnmatched,
      },
      devices: devices.map((d) => ({ source: d, lastAt: byDevice.get(d)?.last ?? null, readings: byDevice.get(d)?.readings ?? 0 })),
    };
  }

  // ── Data Sets (reference tables) ─────────────────────────────────────

  private dataSetOut(r: { id: string; name: string; description: string | null; source: string | null; labelColumn: string; columns: string; rows: string; createdAt: Date; updatedAt: Date }, withRows: boolean) {
    let columns: DataSetColumn[] = [];
    let rows: DataSetRow[] = [];
    try { columns = JSON.parse(r.columns); } catch { columns = []; }
    try { rows = JSON.parse(r.rows); } catch { rows = []; }
    return {
      id: r.id, name: r.name, description: r.description, source: r.source, labelColumn: r.labelColumn, columns,
      rowLabels: rows.map((x) => x.label), rowCount: rows.length,
      ...(withRows ? { rows } : {}),
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
  }

  async listDataSets() {
    const rows = await this.prisma.dataSet.findMany({ orderBy: { name: 'asc' } });
    return rows.map((r) => this.dataSetOut(r, false));
  }

  async getDataSet(id: string) {
    const r = await this.prisma.dataSet.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Data set not found');
    return this.dataSetOut(r, true);
  }

  async saveDataSet(raw: any, userId: string, id?: string) {
    let d: ReturnType<typeof cleanDataSet>;
    try { d = cleanDataSet(raw); } catch (e: any) { throw new BadRequestException(e?.message); }
    const data = { name: d.name, description: d.description, source: d.source, labelColumn: d.labelColumn, columns: JSON.stringify(d.columns), rows: JSON.stringify(d.rows) };
    if (data.rows.length > 3_000_000) throw new BadRequestException('That data set is too large');
    if (id) {
      const found = await this.prisma.dataSet.findUnique({ where: { id }, select: { id: true } });
      if (!found) throw new NotFoundException('Data set not found');
      return this.dataSetOut(await this.prisma.dataSet.update({ where: { id }, data }), true);
    }
    return this.dataSetOut(await this.prisma.dataSet.create({ data: { ...data, createdById: userId } }), true);
  }

  async deleteDataSet(id: string) {
    await this.prisma.dataSet.deleteMany({ where: { id } });
    return { ok: true };
  }

  private async loadDataSet(id: string) {
    const r = await this.prisma.dataSet.findUnique({ where: { id } });
    if (!r) return null;
    try { return { name: r.name, columns: JSON.parse(r.columns) as DataSetColumn[], rows: JSON.parse(r.rows) as DataSetRow[] }; } catch { return null; }
  }

  /**
   * The finishing step shared by evaluate + preview:
   *  - a Data Set chart: one bar per group (row) for each chosen column, and
   *    this athlete's value beside them (their readings in the date range,
   *    averaged or the max per Daily Value) when the column is linked;
   *  - a Player Data chart: one point per day (Daily Value), plus a dashed
   *    benchmark line for each column a chosen Data Set row is linked to.
   */
  private async finishSeries(
    playerId: string,
    cfg: { dataset: string | null; dailyAgg: 'AVG' | 'MAX' | null; benchmark: { dataSetId: string; row: string } | null },
    sources: Array<{ source: string; metricType: string; label?: string }>,
    series: Series[],
    dateFilter: { gte?: Date; lte?: Date } | null,
  ): Promise<Series[]> {
    if (cfg.dataset?.startsWith('ds:')) {
      const ds = await this.loadDataSet(cfg.dataset.slice(3));
      if (!ds) return [];
      const out: Series[] = [];
      const cols = sources.map((s) => ds.columns.find((c) => c.key === s.metricType)).filter((c): c is DataSetColumn => !!c);
      const many = cols.length > 1;
      for (const c of cols) {
        if (c.link) {
          const [own] = await this.buildSeries(playerId, [{ source: c.link.source, metricType: c.link.metricType, label: c.name }], dateFilter);
          const vals = own.points.map((p) => p.value);
          if (vals.length) {
            const v = cfg.dailyAgg === 'MAX' ? Math.max(...vals) : vals.reduce((a, b) => a + b, 0) / vals.length;
            out.push({ source: 'ATHLETE', metricType: c.key, label: many ? `This athlete · ${c.name}` : 'This athlete', athlete: true, points: [{ date: new Date().toISOString(), value: v }] });
          }
        }
        for (const r of ds.rows) {
          const v = r.values[c.key];
          if (typeof v === 'number') out.push({ source: 'DATASET', metricType: c.key, label: many ? `${r.label} · ${c.name}` : r.label, points: [{ date: new Date().toISOString(), value: v }] });
        }
      }
      return out;
    }
    const daily = series.map((s) => ({ ...s, points: aggregateDaily(s.points, cfg.dailyAgg) }));
    if (!cfg.benchmark) return daily;
    const ds = await this.loadDataSet(cfg.benchmark.dataSetId);
    const row = ds?.rows.find((r) => r.label === cfg.benchmark!.row);
    if (!ds || !row) return daily;
    const lines: Series[] = [];
    for (const s of daily) {
      if (!s.points.length) continue;
      const col = ds.columns.find((c) => c.link && c.link.source === s.source && c.link.metricType === s.metricType);
      const v = col ? row.values[col.key] : null;
      if (typeof v !== 'number') continue;
      lines.push({ source: 'BENCHMARK', metricType: col!.key, label: `${row.label} (${ds.name})`, benchmark: true, points: [{ date: s.points[0].date, value: v }, { date: s.points[s.points.length - 1].date, value: v }] });
    }
    return [...daily, ...lines];
  }

  private async liftingColumns(user?: JwtPayload) {
    const [tested, { catalog }] = await Promise.all([
      this.prisma.liftingTest.findMany({ distinct: ['testType'], select: { testType: true } }),
      this.lifting.getConfig(user),
    ]);
    const have = new Set(tested.map((t) => t.testType));
    const out: { source: string; metricType: string; unit: string; label: string; group: string }[] = [];
    for (const t of catalog) {
      if (t.code === BODYWEIGHT_TEST || !have.has(t.code)) continue;
      const group = `${LIFT_GROUP[t.source] ?? 'Lifting'} · ${t.label}`;
      for (const m of t.metrics) out.push({ source: LIFT_SOURCE, metricType: `${t.code}:${m.key}`, unit: m.unit, label: m.label, group });
    }
    return out;
  }

  async listColumns(user?: JwtPayload) {
    const rows = await this.prisma.metric.findMany({
      /* Device rows only: REPORT_<id> sources (one per saved report) would
         list every metric again for each report. */
      where: { NOT: { source: { startsWith: 'REPORT_' } } },
      select: { source: true, metricType: true, unit: true },
      distinct: ['source', 'metricType'],
      orderBy: [{ source: 'asc' }, { metricType: 'asc' }],
    });

    const reportScoreFields = [
      { source: 'REPORT', metricType: 'hitting_score', unit: 'score' },
      { source: 'REPORT', metricType: 'pitching_score', unit: 'score' },
      { source: 'REPORT', metricType: 'defense_score', unit: 'score' },
      { source: 'REPORT', metricType: 'catching_score', unit: 'score' },
      { source: 'REPORT', metricType: 'overall_score', unit: 'score' },
    ];

    /* Lifting Report results for every test with saved results (VALD's
       names / units), plus body weight. `group` / `label` are for the picker. */
    const extra: { source: string; metricType: string; unit: string; label: string; group: string }[] = [
      { source: WEIGHT_SOURCE, metricType: 'weight', unit: 'lb', label: 'Body Weight', group: 'Body Weight' },
    ];
    extra.push(...(await this.liftingColumns(user)));
    return [...rows, ...reportScoreFields, ...extra];
  }

  /** Coaches see every chart (Private = for coaches); athletes / parents only the GLOBAL ones. */
  async listConfigs(user: JwtPayload, section?: string) {
    const where: any = user.role === 'COACH' ? {} : { scope: 'GLOBAL' };
    if (section) where.section = section;
    return this.prisma.chartConfig.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(userId: string, dto: ChartConfigDto) {
    return this.prisma.chartConfig.create({
      data: {
        createdById: userId,
        scope: dto.scope || 'PRIVATE',
        section: dto.section,
        chartType: dto.chartType,
        title: dto.title,
        dataSources: JSON.stringify(dto.dataSources || []),
        dateMode: dto.dateMode || 'ALL_TIME',
        dateFrom: dto.dateFrom || null,
        dateTo: dto.dateTo || null,
        lastNDays: dto.lastNDays || null,
        playerScope: dto.playerScope || 'ALL',
        playerIds: dto.playerIds && dto.playerIds.length > 0 ? JSON.stringify(dto.playerIds) : null,
        dataMode: dto.dataMode || 'DATE_RANGE',
        reportIds: dto.reportIds && dto.reportIds.length > 0 ? JSON.stringify(dto.reportIds) : null,
        sortOrder: dto.sortOrder || 0,
        rollingWindow: dto.rollingWindow ?? null,
        rollingMode: dto.rollingMode ?? null,
        targetMin: dto.targetMin ?? null,
        targetMax: dto.targetMax ?? null,
        pbDirection: dto.pbDirection ?? null,
        zoneGrid: dto.zoneGrid ?? null,
        zoneMetric: dto.zoneMetric ?? null,
        cohortEnabled: dto.cohortEnabled ?? false,
        cohortMode: dto.cohortMode ?? null,
        dataset: cleanDataset(dto.dataset),
        dailyAgg: cleanDailyAgg(dto.dailyAgg),
        benchmark: cleanBenchmark(dto.benchmark),
      },
    });
  }

  /* Any coach can edit or delete a chart (Private charts are shared by the coaches). */
  async update(id: string, _userId: string, dto: Partial<ChartConfigDto>) {
    const existing = await this.prisma.chartConfig.findUnique({ where: { id } });
    if (!existing) return null;

    const data: any = {};
    if (dto.scope) data.scope = dto.scope;
    if (dto.section) data.section = dto.section;
    if (dto.chartType) data.chartType = dto.chartType;
    if (dto.title) data.title = dto.title;
    if (dto.dataSources) data.dataSources = JSON.stringify(dto.dataSources);
    if (dto.dateMode) data.dateMode = dto.dateMode;
    if (dto.dateFrom !== undefined) data.dateFrom = dto.dateFrom;
    if (dto.dateTo !== undefined) data.dateTo = dto.dateTo;
    if (dto.lastNDays !== undefined) data.lastNDays = dto.lastNDays;
    if (dto.playerScope) data.playerScope = dto.playerScope;
    if (dto.playerIds !== undefined) {
      data.playerIds = dto.playerIds && dto.playerIds.length > 0 ? JSON.stringify(dto.playerIds) : null;
    }
    if (dto.dataMode) data.dataMode = dto.dataMode;
    if (dto.reportIds !== undefined) {
      data.reportIds = dto.reportIds && dto.reportIds.length > 0 ? JSON.stringify(dto.reportIds) : null;
    }
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.rollingWindow !== undefined) data.rollingWindow = dto.rollingWindow;
    if (dto.rollingMode !== undefined) data.rollingMode = dto.rollingMode;
    if (dto.targetMin !== undefined) data.targetMin = dto.targetMin;
    if (dto.targetMax !== undefined) data.targetMax = dto.targetMax;
    if (dto.pbDirection !== undefined) data.pbDirection = dto.pbDirection;
    if (dto.zoneGrid !== undefined) data.zoneGrid = dto.zoneGrid;
    if (dto.zoneMetric !== undefined) data.zoneMetric = dto.zoneMetric;
    if (dto.cohortEnabled !== undefined) data.cohortEnabled = dto.cohortEnabled;
    if (dto.cohortMode !== undefined) data.cohortMode = dto.cohortMode;
    if (dto.dataset !== undefined) data.dataset = cleanDataset(dto.dataset);
    if (dto.benchmark !== undefined) data.benchmark = cleanBenchmark(dto.benchmark);
    if (dto.dailyAgg !== undefined) data.dailyAgg = cleanDailyAgg(dto.dailyAgg);

    return this.prisma.chartConfig.update({ where: { id }, data });
  }

  async delete(id: string, _userId: string) {
    const existing = await this.prisma.chartConfig.findUnique({ where: { id } });
    if (!existing) return null;
    return this.prisma.chartConfig.delete({ where: { id } });
  }

  async evaluate(configId: string, playerId: string, user?: JwtPayload) {
    const config = await this.prisma.chartConfig.findUnique({ where: { id: configId } });
    if (!config) return null;
    /* A coaches-only chart is never shown to an athlete or parent. */
    if (config.scope === 'PRIVATE' && user && user.role !== 'COACH') return null;

    const sources = JSON.parse(config.dataSources) as Array<{ source: string; metricType: string; label?: string }>;
    const reportIds = this.parseJsonArray(config.reportIds);
    const dataMode = (config.dataMode as 'DATE_RANGE' | 'REPORTS') || 'DATE_RANGE';

    const dateFilter = dataMode === 'REPORTS'
      ? await this.buildReportDateFilter(playerId, reportIds)
      : this.buildDateFilter(config);

    const series = await this.buildSeries(playerId, sources, dateFilter, {
      dataMode,
      reportIds,
    });

    let cohortSeries: any[] = [];
    if ((config as any).cohortEnabled) {
      cohortSeries = await this.buildCohortSeries(
        playerId,
        sources,
        dateFilter,
        ((config as any).cohortMode as 'GRAD_YEAR' | 'POSITION' | 'ALL') || 'GRAD_YEAR',
      );
    }

    const finished = await this.finishSeries(playerId, {
      dataset: cleanDataset((config as any).dataset),
      dailyAgg: cleanDailyAgg((config as any).dailyAgg),
      benchmark: parseBenchmark((config as any).benchmark),
    }, sources, series as Series[], dateFilter);
    return { config, series: [...finished, ...(String((config as any).dataset || '').startsWith('ds:') ? [] : cohortSeries)] };
  }

  /**
   * Preview: evaluate a (possibly unsaved) chart config for a given player
   * without persisting anything. Accepts the same DTO shape as create().
   */
  async preview(dto: ChartConfigDto, playerId: string) {
    const dataMode = dto.dataMode || 'DATE_RANGE';
    const reportIds = dto.reportIds || [];

    const dateFilter = dataMode === 'REPORTS'
      ? await this.buildReportDateFilter(playerId, reportIds)
      : this.buildDateFilter({
          dateMode: dto.dateMode,
          dateFrom: dto.dateFrom,
          dateTo: dto.dateTo,
          lastNDays: dto.lastNDays,
        });

    const sources = dto.dataSources || [];
    const series = await this.buildSeries(playerId, sources, dateFilter, {
      dataMode,
      reportIds,
    });

    let cohortSeries: any[] = [];
    if (dto.cohortEnabled) {
      cohortSeries = await this.buildCohortSeries(
        playerId,
        sources,
        dateFilter,
        dto.cohortMode || 'GRAD_YEAR',
      );
    }

    return {
      config: {
        id: 'preview',
        title: dto.title,
        section: dto.section,
        chartType: dto.chartType,
        scope: dto.scope || 'PRIVATE',
        dataSources: JSON.stringify(sources),
        dateMode: dto.dateMode || 'ALL_TIME',
        dateFrom: dto.dateFrom || null,
        dateTo: dto.dateTo || null,
        lastNDays: dto.lastNDays || null,
        playerScope: dto.playerScope || 'ALL',
        playerIds: dto.playerIds && dto.playerIds.length ? JSON.stringify(dto.playerIds) : null,
        dataMode,
        reportIds: reportIds.length ? JSON.stringify(reportIds) : null,
        rollingWindow: dto.rollingWindow ?? null,
        rollingMode: dto.rollingMode ?? null,
        targetMin: dto.targetMin ?? null,
        targetMax: dto.targetMax ?? null,
        pbDirection: dto.pbDirection ?? null,
        zoneGrid: dto.zoneGrid ?? null,
        zoneMetric: dto.zoneMetric ?? null,
        cohortEnabled: dto.cohortEnabled ?? false,
        cohortMode: dto.cohortMode ?? null,
        dataset: cleanDataset(dto.dataset),
        dailyAgg: cleanDailyAgg(dto.dailyAgg),
      },
      series: [
        ...(await this.finishSeries(playerId, {
          dataset: cleanDataset(dto.dataset),
          dailyAgg: cleanDailyAgg(dto.dailyAgg),
          benchmark: parseBenchmark(cleanBenchmark(dto.benchmark)),
        }, sources, series as Series[], dateFilter)),
        ...(String(dto.dataset || '').startsWith('ds:') ? [] : (cohortSeries as Series[])),
      ],
    };
  }

  private async buildSeries(
    playerId: string,
    sources: Array<{ source: string; metricType: string; label?: string }>,
    dateFilter: { gte?: Date; lte?: Date } | null,
    opts?: { dataMode?: 'DATE_RANGE' | 'REPORTS'; reportIds?: string[] },
  ) {
    const dataMode = opts?.dataMode || 'DATE_RANGE';
    const reportIds = opts?.reportIds || [];

    return Promise.all(
      sources.map(async (s) => {
        if (s.source === 'REPORT') {
          const reportType = s.metricType.replace('_score', '').toUpperCase();
          const where: any = { playerId, reportType };
          if (dataMode === 'REPORTS' && reportIds.length > 0) {
            where.id = { in: reportIds };
          } else if (dateFilter) {
            where.createdAt = dateFilter;
          }
          const reports = await this.prisma.report.findMany({
            where,
            orderBy: { createdAt: 'asc' },
          });
          const points = reports
            .map((r) => {
              try {
                const c = JSON.parse(r.content);
                const score = c.overallScore ?? c.score ?? null;
                return score != null ? { date: r.createdAt.toISOString(), value: Number(score) } : null;
              } catch {
                return null;
              }
            })
            .filter(Boolean) as Array<{ date: string; value: number }>;
          return { source: s.source, metricType: s.metricType, label: s.label || s.metricType, points };
        }

        const extra = await this.extraPoints([playerId], s, dateFilter);
        if (extra) {
          return { source: s.source, metricType: s.metricType, label: s.label || s.metricType, points: extra.map((p) => ({ date: p.date.toISOString(), value: p.value })) };
        }

        // Metric source: respect dateFilter (which in REPORTS mode is derived
        // from the selected reports' createdAt span, see buildReportDateFilter).
        const metrics = await this.prisma.metric.findMany({
          where: {
            playerId,
            source: s.source,
            metricType: s.metricType,
            ...(dateFilter ? { recordedAt: dateFilter } : {}),
          },
          orderBy: { recordedAt: 'asc' },
        });
        return {
          source: s.source,
          metricType: s.metricType,
          label: s.label || s.metricType,
          points: metrics.map((m) => ({ date: m.recordedAt.toISOString(), value: m.value })),
        };
      }),
    );
  }

  /**
   * Build a "class average" overlay series — one per primary data source.
   * Aggregates peer values into a daily mean within the same date window
   * the primary series uses. Peers are scoped by cohortMode: same gradYear,
   * same position(s), or all athletes.
   *
   * Returned series are tagged with a "(class avg)" label and `cohort: true`
   * so the frontend can style them differently (dashed line, muted color).
   */
  private async buildCohortSeries(
    playerId: string,
    sources: Array<{ source: string; metricType: string; label?: string }>,
    dateFilter: { gte?: Date; lte?: Date } | null,
    cohortMode: 'GRAD_YEAR' | 'POSITION' | 'ALL',
  ) {
    const me = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { gradYear: true, positions: true },
    });
    if (!me) return [];

    // Build the peer scope. Always exclude the focal athlete so the cohort
    // line is a true comparison, not an inflated self-mix.
    const peerWhere: any = { id: { not: playerId } };
    if (cohortMode === 'GRAD_YEAR' && me.gradYear != null) {
      peerWhere.gradYear = me.gradYear;
    } else if (cohortMode === 'POSITION' && me.positions) {
      // Player.positions is a comma-separated string. Match peers who share
      // ANY listed position. SQLite has no array contains, so we OR each.
      const myPositions = me.positions
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (myPositions.length > 0) {
        peerWhere.OR = myPositions.map((p) => ({ positions: { contains: p } }));
      }
    }
    // cohortMode === 'ALL' falls through with just the id-not-self filter.

    const peers = await this.prisma.player.findMany({
      where: peerWhere,
      select: { id: true },
    });
    const peerIds = peers.map((p) => p.id);
    if (peerIds.length === 0) return [];

    return Promise.all(
      sources.map(async (s) => {
        if (s.source === 'REPORT') {
          // Reports don't aggregate cleanly across cohorts (the score is a
          // composite per-athlete number). Emit an empty cohort series so
          // the chart's primary line still renders alone.
          return {
            source: s.source,
            metricType: s.metricType,
            label: `${s.label || s.metricType} · class avg`,
            cohort: true,
            points: [],
          };
        }

        const extra = await this.extraPoints(peerIds, s, dateFilter);
        const metrics = extra
          ? extra.map((p) => ({ recordedAt: p.date, value: p.value }))
          : await this.prisma.metric.findMany({
            where: {
              playerId: { in: peerIds },
              source: s.source,
              metricType: s.metricType,
              ...(dateFilter ? { recordedAt: dateFilter } : {}),
            },
            select: { recordedAt: true, value: true },
          });

        // Bucket by calendar day, then average — collapses multiple peers
        // and multiple per-peer reads on a given day into one comparison
        // point.
        const byDay = new Map<string, { sum: number; n: number }>();
        for (const m of metrics) {
          const dayKey = m.recordedAt.toISOString().slice(0, 10);
          const cell = byDay.get(dayKey) || { sum: 0, n: 0 };
          cell.sum += m.value;
          cell.n += 1;
          byDay.set(dayKey, cell);
        }

        const points = Array.from(byDay.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([day, { sum, n }]) => ({
            date: new Date(`${day}T00:00:00.000Z`).toISOString(),
            value: sum / n,
          }));

        return {
          source: s.source,
          metricType: s.metricType,
          label: `${s.label || s.metricType} · class avg`,
          cohort: true,
          points,
        };
      }),
    );
  }

  /**
   * When the chart is in REPORTS mode, derive a date filter that spans the
   * min-to-max createdAt of the selected reports for this player. Metric
   * sources will then be scoped to that window. Report sources are filtered
   * by id directly (see buildSeries).
   */
  private async buildReportDateFilter(
    playerId: string,
    reportIds: string[],
  ): Promise<{ gte?: Date; lte?: Date } | null> {
    if (!reportIds || reportIds.length === 0) return null;
    const reports = await this.prisma.report.findMany({
      where: { playerId, id: { in: reportIds } },
      select: { createdAt: true },
    });
    if (reports.length === 0) return null;
    const times = reports.map((r) => r.createdAt.getTime());
    return {
      gte: new Date(Math.min(...times)),
      lte: new Date(Math.max(...times)),
    };
  }

  private parseJsonArray(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private buildDateFilter(config: any): { gte?: Date; lte?: Date } | null {
    if (config.dateMode === 'ALL_TIME') return null;
    if (config.dateMode === 'RANGE') {
      const f: any = {};
      if (config.dateFrom) f.gte = new Date(config.dateFrom);
      if (config.dateTo) f.lte = new Date(config.dateTo);
      return Object.keys(f).length ? f : null;
    }
    if (config.dateMode === 'LAST_N_DAYS' && config.lastNDays) {
      const d = new Date();
      d.setDate(d.getDate() - config.lastNDays);
      return { gte: d };
    }
    return null;
  }
}
