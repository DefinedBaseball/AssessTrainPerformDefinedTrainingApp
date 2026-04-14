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
  'sixty_yard',
];

/**
 * Metrics where a LOWER value = better performance.
 * These sort ascending instead of descending.
 */
const LOWER_IS_BETTER = new Set(['pop_time', 'sixty_yard']);

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

  async recompute(gradYear?: number) {
    const gradYears = gradYear
      ? [gradYear]
      : await this.prisma.player
          .findMany({ select: { gradYear: true }, distinct: ['gradYear'] })
          .then(rows => rows.map(r => r.gradYear).filter((y): y is number => y !== null));

    for (const year of gradYears) {
      for (const metricType of LEADERBOARD_METRICS) {
        const lowerIsBetter = LOWER_IS_BETTER.has(metricType);

        // Get best value per player for this metric
        // For "lower is better" metrics, we want the LOWEST value (ascending)
        const players = await this.prisma.player.findMany({
          where: { gradYear: year },
          include: {
            metrics: {
              where: { metricType },
              orderBy: { value: lowerIsBetter ? 'asc' : 'desc' },
              take: 1,
            },
          },
        });

        const ranked = players
          .filter(p => p.metrics.length > 0)
          .map(p => ({ playerId: p.id, value: p.metrics[0].value }))
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

    return { status: 'ok', gradYears };
  }
}
