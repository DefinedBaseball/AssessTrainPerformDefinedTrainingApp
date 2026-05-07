import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LeaderboardsService } from '../leaderboards/leaderboards.service';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    private prisma: PrismaService,
    private leaderboardsService: LeaderboardsService,
  ) {}

  async create(data: {
    playerId: string;
    source: string;
    metricType: string;
    value: number;
    unit: string;
    recordedAt: Date;
    rawData?: string;
  }) {
    const metric = await this.prisma.metric.create({ data });

    // Auto-recompute leaderboard for this player's grad year
    this.triggerLeaderboardRecompute([data.playerId]).catch(() => {});

    return metric;
  }

  async createMany(metrics: {
    playerId: string;
    source: string;
    metricType: string;
    value: number;
    unit: string;
    recordedAt: Date;
    rawData?: string;
  }[]) {
    const result = await this.prisma.metric.createMany({ data: metrics });

    // Auto-recompute leaderboard for all affected players' grad years
    const playerIds = [...new Set(metrics.map(m => m.playerId))];
    this.triggerLeaderboardRecompute(playerIds).catch(() => {});

    return result;
  }

  /**
   * Look up the grad years for given player IDs and recompute their leaderboards.
   * Runs async (fire-and-forget) so it doesn't slow down the main response.
   */
  private async triggerLeaderboardRecompute(playerIds: string[]) {
    try {
      const players = await this.prisma.player.findMany({
        where: { id: { in: playerIds } },
        select: { gradYear: true },
      });
      const gradYears = [...new Set(
        players.map(p => p.gradYear).filter((y): y is number => y !== null),
      )];

      for (const year of gradYears) {
        await this.leaderboardsService.recompute(year);
      }

      if (gradYears.length > 0) {
        this.logger.log(`Leaderboard auto-recomputed for grad years: ${gradYears.join(', ')}`);
      }
    } catch (err) {
      this.logger.warn(`Leaderboard auto-recompute failed: ${err}`);
    }
  }

  async findByPlayer(
    playerId: string,
    options?: {
      source?: string;
      date?: string;      // specific date YYYY-MM-DD
      month?: string;     // YYYY-MM
      latest?: boolean;
      from?: string;
      to?: string;
      uploadIds?: string[];
    },
  ) {
    const where: any = { playerId };

    if (options?.source) where.source = options.source;

    if (options?.uploadIds?.length) {
      where.uploadId = { in: options.uploadIds };
    }

    if (options?.date) {
      const start = new Date(options.date);
      const end = new Date(options.date);
      end.setDate(end.getDate() + 1);
      where.recordedAt = { gte: start, lt: end };
    } else if (options?.month) {
      const [year, month] = options.month.split('-').map(Number);
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 1);
      where.recordedAt = { gte: start, lt: end };
    } else if (options?.from && options?.to) {
      where.recordedAt = { gte: new Date(options.from), lte: new Date(options.to) };
    }

    const metrics = await this.prisma.metric.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take: options?.latest ? 1 : undefined,
    });

    return metrics;
  }

  async getProgressData(playerId: string, metricType: string, source?: string) {
    /* Optional `source` filter — when set, only metrics ingested by that
       parser (e.g. 'HITTRAX' vs 'FULL_SWING') are returned. Lets the
       Hitting tab read HitTrax-only progress for the HitTrax section
       and Full Swing-only progress for the Full Swing section, even
       though both vendors store the same metric_type names. */
    return this.prisma.metric.findMany({
      where: { playerId, metricType, ...(source ? { source } : {}) },
      orderBy: { recordedAt: 'asc' },
      select: { value: true, recordedAt: true },
    });
  }

  async getAvailableDates(playerId: string, source: string) {
    const metrics = await this.prisma.metric.findMany({
      where: { playerId, source },
      select: { recordedAt: true },
      distinct: ['recordedAt'],
      orderBy: { recordedAt: 'desc' },
    });
    return metrics.map(m => m.recordedAt);
  }

  /**
   * Get session-level batted ball data for spray charts.
   * Returns all individual data points (not aggregated) for the given metric types.
   */
  async getSessionData(
    playerId: string,
    source: string,
    metricTypes: string[],
    options?: { date?: string; from?: string; to?: string; uploadIds?: string[] },
  ) {
    const where: any = { playerId, source, metricType: { in: metricTypes } };
    if (options?.uploadIds?.length) {
      where.uploadId = { in: options.uploadIds };
    }
    if (options?.date) {
      const start = new Date(options.date);
      const end = new Date(options.date);
      end.setDate(end.getDate() + 1);
      where.recordedAt = { gte: start, lt: end };
    } else if (options?.from && options?.to) {
      where.recordedAt = { gte: new Date(options.from), lte: new Date(options.to) };
    }
    return this.prisma.metric.findMany({
      where,
      orderBy: { recordedAt: 'asc' },
      select: { metricType: true, value: true, unit: true, recordedAt: true, rawData: true },
    });
  }

  /**
   * Get all Trackman pitch-level data for a player.
   * Returns parsed rawData for each pitch for visualization.
   */
  async getTrackmanPitches(playerId: string, options?: { from?: string; to?: string; uploadIds?: string[] }) {
    const where: any = { playerId, source: 'TRACKMAN', metricType: 'trackman_pitch' };
    if (options?.uploadIds?.length) {
      where.uploadId = { in: options.uploadIds };
    }
    if (options?.from && options?.to) {
      where.recordedAt = { gte: new Date(options.from), lte: new Date(options.to) };
    }

    const metrics = await this.prisma.metric.findMany({
      where,
      orderBy: { recordedAt: 'asc' },
      select: { id: true, value: true, recordedAt: true, rawData: true },
    });

    return metrics.map(m => {
      let pitchData: any = {};
      try {
        pitchData = m.rawData ? JSON.parse(m.rawData) : {};
      } catch { /* ignore parse errors */ }
      return {
        id: m.id,
        velocity: m.value,
        recordedAt: m.recordedAt,
        ...pitchData,
      };
    });
  }

  /**
   * Get computed session averages & max values for batted ball metrics.
   * Groups all individual data points and computes aggregate stats.
   */
  async getBattedBallSummary(playerId: string, source?: string, uploadIds?: string[]) {
    const where: any = {
      playerId,
      metricType: { in: [
        // Full Swing metrics
        'max_exit_velo', 'launch_angle', 'bat_speed', 'distance', 'smash_factor', 'squared_up_pct', 'spray_angle',
        // Blast Motion metrics
        'max_bat_speed', 'avg_bat_speed', 'peak_hand_speed', 'attack_angle',
        'time_to_contact', 'vertical_bat_angle', 'on_plane_efficiency',
        'rotational_accel', 'early_connection', 'connection_at_impact',
        'power_output', 'plane_angle',
      ] },
    };
    if (source) where.source = source;
    if (uploadIds?.length) where.uploadId = { in: uploadIds };

    const metrics = await this.prisma.metric.findMany({ where });

    // Group by metricType → compute avg, max, count
    const grouped: Record<string, number[]> = {};
    for (const m of metrics) {
      if (!grouped[m.metricType]) grouped[m.metricType] = [];
      grouped[m.metricType].push(m.value);
    }

    const summary: Record<string, { avg: number; max: number; min: number; count: number }> = {};
    for (const [key, values] of Object.entries(grouped)) {
      const sum = values.reduce((a, b) => a + b, 0);
      summary[key] = {
        avg: Math.round((sum / values.length) * 100) / 100,
        max: Math.round(Math.max(...values) * 100) / 100,
        min: Math.round(Math.min(...values) * 100) / 100,
        count: values.length,
      };
    }
    return summary;
  }
}
