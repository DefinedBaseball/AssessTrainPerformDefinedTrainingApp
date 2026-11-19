import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt.util';
import { LiftingService } from '../lifting/lifting.service';
import { BODYWEIGHT_TEST } from '../lifting/lifting-catalog';
import { REPORT_MEASURES } from '../studies/study-measures';

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
  /** "REPORTS" | "VALD" (which data set the columns come from). */
  dataset?: 'REPORTS' | 'VALD' | null;
  /** One point per day: average or max of that day's readings. */
  dailyAgg?: 'AVG' | 'MAX' | null;
}

const cleanDataset = (v: unknown) => (v === 'REPORTS' || v === 'VALD' ? v : null);
const cleanDailyAgg = (v: unknown) => (v === 'AVG' || v === 'MAX' ? v : null);

/** One point per day (UTC date, plotted at noon): the day's average or max. */
export function aggregateDaily(points: { date: string; value: number }[], how: 'AVG' | 'MAX' | null | undefined) {
  if (!how) return points;
  const byDay = new Map<string, number[]>();
  for (const p of points) {
    const d = p.date.slice(0, 10);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(p.value);
  }
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({
    date: `${d}T12:00:00.000Z`,
    value: how === 'MAX' ? Math.max(...v) : v.reduce((a, b) => a + b, 0) / v.length,
  }));
}

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

  /** The Chart Builder's columns: Athlete Reports (each report metric once,
   *  named) + body weight, and VALD (Lifting Report results). */
  async builderColumns(user?: JwtPayload) {
    const reportKeys = await this.prisma.metric.groupBy({ by: ['metricType'], where: { source: { startsWith: 'REPORT_' } } });
    const have = new Set(reportKeys.map((r) => r.metricType));
    const out: { source: string; metricType: string; unit: string; label: string; group: string; dataset: 'REPORTS' | 'VALD' }[] = REPORT_MEASURES
      .filter((m) => have.has(m.key))
      .map((m) => ({ source: REPORTS_SOURCE, metricType: m.key, unit: m.unit, label: m.label, group: m.group, dataset: 'REPORTS' as const }));
    out.push({ source: WEIGHT_SOURCE, metricType: 'weight', unit: 'lb', label: 'Body Weight', group: 'Body', dataset: 'REPORTS' });
    for (const c of await this.liftingColumns(user)) out.push({ ...c, dataset: 'VALD' });
    return out;
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

    const daily = cleanDailyAgg((config as any).dailyAgg);
    return { config, series: series.map((s) => ({ ...s, points: aggregateDaily(s.points, daily) })).concat(cohortSeries) };
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
      series: series.map((s) => ({ ...s, points: aggregateDaily(s.points, cleanDailyAgg(dto.dailyAgg)) })).concat(cohortSeries as any[]),
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
