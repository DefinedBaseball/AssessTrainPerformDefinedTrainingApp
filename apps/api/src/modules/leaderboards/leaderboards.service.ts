import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * All metric types that appear on the leaderboard.
 * Must stay in sync with the frontend METRIC_TYPES list.
 */
const LEADERBOARD_METRICS = [
  'max_exit_velo',
  'avg_exit_velo',
  'max_bat_speed',
  'fb_max_velo',
  'infield_velo',
  'outfield_velo',
  'catcher_velo',
  'pop_time',
  'jump_height',
  // Speed keys MUST match what reports/profiles write. Was 'sixty_yard',
  // which reports never emit — leaving that leaderboard permanently empty
  // and disconnected from the profile's 60-yard time.
  'sprint_60',
  'sprint_10',
];

/**
 * Metrics where a LOWER value = better performance.
 * These sort ascending instead of descending.
 */
const LOWER_IS_BETTER = new Set(['pop_time', 'sprint_60', 'sprint_10']);

@Injectable()
export class LeaderboardsService {
  constructor(private prisma: PrismaService) {}

  async getLeaderboard(gradYear: number, metricType: string, limit = 15) {
    const entries = await this.prisma.leaderboardEntry.findMany({
      where: { gradYear, metricType },
      orderBy: { rank: 'asc' },
      take: limit,
      include: {
        player: {
          select: {
            firstName: true,
            lastName: true,
            profilePhoto: true,
            positions: true,
            collegeCommit: true,
            gradYear: true,
          },
        },
      },
    });
    return entries;
  }

  /** Distinct grad years present across players (non-null), ascending — just
   *  the year numbers (no player PII), so the leaderboard filter dropdown can
   *  be built by PLAYERS too (the player-list endpoint is coach-only, which
   *  otherwise left a player's leaderboard with no grad years and blank). */
  async getGradYears(): Promise<number[]> {
    const rows = await this.prisma.player.findMany({
      where: { gradYear: { not: null } },
      select: { gradYear: true },
      distinct: ['gradYear'],
      orderBy: { gradYear: 'asc' },
    });
    return rows
      .map(r => r.gradYear)
      .filter((y): y is number => y !== null);
  }

  async recompute(gradYear?: number) {
    const gradYears = gradYear
      ? [gradYear]
      : await this.prisma.player
          .findMany({ select: { gradYear: true }, distinct: ['gradYear'] })
          .then(rows => rows.map(r => r.gradYear).filter((y): y is number => y !== null));

    for (const year of gradYears) {
      for (const metricType of LEADERBOARD_METRICS) {
        const lowerIsBetter = LOWER_IS_BETTER.has(metricType);

        // Get best value per player for this metric.
        // For "lower-is-better" metrics, we want the LOWEST value
        // (ascending). Filter zero/negative values out of the source
        // pool so failed sensor reads (Velo=0 takes / non-contact
        // swings, blank pop-times, etc.) can't leaderboard-rank a
        // player on what is effectively a missing measurement. For
        // lower-is-better metrics 0 is also non-physical (you can't
        // run a 0.0s 60-yard dash).
        const players = await this.prisma.player.findMany({
          where: { gradYear: year },
          include: {
            metrics: {
              // Only per-report aggregated points (`REPORT_<id>`) — so the
              // leaderboard ranks players on the SAME values their profile
              // shows (one per report), never seeded / raw-CSV demo metrics.
              where: { metricType, value: { gt: 0 }, source: { startsWith: 'REPORT_' } },
              orderBy: { value: lowerIsBetter ? 'asc' : 'desc' },
              take: 1,
            },
          },
        });

        const ranked = players
          .filter(p => p.metrics.length > 0)
          .map(p => ({ playerId: p.id, value: p.metrics[0].value }))
          // Defensive double-check — sometimes a sensor produces a
          // very small but finite reading that's clearly noise; the
          // value > 0 filter above catches the obvious case.
          .filter(p => Number.isFinite(p.value) && p.value > 0)
          .sort((a, b) => lowerIsBetter ? a.value - b.value : b.value - a.value)
          .slice(0, 15)
          .map((entry, i) => ({
            gradYear: year,
            metricType,
            playerId: entry.playerId,
            value: entry.value,
            rank: i + 1,
          }));

        // Clear existing entries for this grad year + metric
        await this.prisma.leaderboardEntry.deleteMany({
          where: { gradYear: year, metricType },
        });

        if (ranked.length > 0) {
          await this.prisma.leaderboardEntry.createMany({ data: ranked });
        }
      }
    }

    // "All Ages" board (sentinel gradYear=0) — ranks every player across all
    // classes. Recomputed on any recompute so it always reflects the full
    // player pool, matching the leaderboard's "All Ages" filter option.
    for (const metricType of LEADERBOARD_METRICS) {
      const lowerIsBetter = LOWER_IS_BETTER.has(metricType);
      const players = await this.prisma.player.findMany({
        include: {
          metrics: {
            where: { metricType, value: { gt: 0 }, source: { startsWith: 'REPORT_' } },
            orderBy: { value: lowerIsBetter ? 'asc' : 'desc' },
            take: 1,
          },
        },
      });
      const ranked = players
        .filter(p => p.metrics.length > 0)
        .map(p => ({ playerId: p.id, value: p.metrics[0].value }))
        .filter(p => Number.isFinite(p.value) && p.value > 0)
        .sort((a, b) => lowerIsBetter ? a.value - b.value : b.value - a.value)
        .slice(0, 15)
        .map((entry, i) => ({
          gradYear: 0,
          metricType,
          playerId: entry.playerId,
          value: entry.value,
          rank: i + 1,
        }));
      await this.prisma.leaderboardEntry.deleteMany({ where: { gradYear: 0, metricType } });
      if (ranked.length > 0) {
        await this.prisma.leaderboardEntry.createMany({ data: ranked });
      }
    }

    return { status: 'ok', gradYears };
  }

  /**
   * Returns the player's rank (and class size) for every leaderboard
   * metric they qualify for. Used by the player-profile widget that
   * shows lines like "#3 of 27 — Max Exit Velo · Class of 2027".
   *
   * Rank-out-of comes from the COUNT of LeaderboardEntry rows in the
   * same gradYear+metric — same source of truth the leaderboard page
   * uses, so the numbers always agree.
   */
  async getPlayerRank(playerId: string) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true, gradYear: true },
    });
    if (!player || player.gradYear == null) return [];

    const entries = await this.prisma.leaderboardEntry.findMany({
      where: { playerId, gradYear: player.gradYear },
      orderBy: { rank: 'asc' },
    });
    if (entries.length === 0) return [];

    // Look up class size per metric in one batch — group by metric
    // type and count.
    const metricTypes = entries.map(e => e.metricType);
    const counts = await this.prisma.leaderboardEntry.groupBy({
      by: ['metricType'],
      where: { gradYear: player.gradYear, metricType: { in: metricTypes } },
      _count: { _all: true },
    });
    const classSize = new Map<string, number>(
      counts.map(c => [c.metricType, c._count._all]),
    );

    return entries.map(e => ({
      metricType: e.metricType,
      value: e.value,
      rank: e.rank,
      outOf: classSize.get(e.metricType) ?? 0,
      gradYear: e.gradYear,
    }));
  }
}
