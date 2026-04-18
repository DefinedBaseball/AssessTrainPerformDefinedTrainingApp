import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
}

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async listColumns() {
    const rows = await this.prisma.metric.findMany({
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

    return [...rows, ...reportScoreFields];
  }

  async listConfigs(userId: string, section?: string) {
    const where: any = {
      OR: [{ scope: 'GLOBAL' }, { createdById: userId, scope: 'PRIVATE' }],
    };
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
      },
    });
  }

  async update(id: string, userId: string, dto: Partial<ChartConfigDto>) {
    const existing = await this.prisma.chartConfig.findUnique({ where: { id } });
    if (!existing) return null;
    if (existing.scope === 'PRIVATE' && existing.createdById !== userId) return null;

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

    return this.prisma.chartConfig.update({ where: { id }, data });
  }

  async delete(id: string, userId: string) {
    const existing = await this.prisma.chartConfig.findUnique({ where: { id } });
    if (!existing) return null;
    if (existing.scope === 'PRIVATE' && existing.createdById !== userId) return null;
    return this.prisma.chartConfig.delete({ where: { id } });
  }

  async evaluate(configId: string, playerId: string) {
    const config = await this.prisma.chartConfig.findUnique({ where: { id: configId } });
    if (!config) return null;

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
    return { config, series };
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
      },
      series,
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
