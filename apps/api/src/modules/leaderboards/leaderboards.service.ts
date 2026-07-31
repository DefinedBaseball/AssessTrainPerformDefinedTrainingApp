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

  /**
   * Rebuild the leaderboards. Scoped to one grad year when given, otherwise
   * every class on file. The "All Ages" board is always rebuilt too so it
   * stays in step with whatever changed.
   *
   * Query cost: this used to run `year x metric` iterations with three
   * statements each (findMany + deleteMany + createMany). With 11 metrics
   * that was ~33 sequential round trips per class, plus another ~33 for All
   * Ages, on every report save and CSV import. It is now a fixed 2 round
   * trips per board regardless of how many metrics the list grows to.
   */
  async recompute(gradYear?: number) {
    const gradYears = gradYear
      ? [gradYear]
      : await this.prisma.player
          .findMany({ select: { gradYear: true }, distinct: ['gradYear'] })
          .then(rows => rows.map(r => r.gradYear).filter((y): y is number => y !== null));

    for (const year of gradYears) {
      await this.rebuildBoard(year);
    }
    /* "All Ages" (sentinel gradYear = 0) ranks every player across all
       classes, matching the leaderboard page's "All Ages" filter option. */
    await this.rebuildBoard(0);

    return { status: 'ok', gradYears };
  }

  /**
   * Rebuild every metric board for a single class in two round trips.
   * `year === 0` is the All Ages sentinel — no class filter, every player.
   */
  private async rebuildBoard(year: number) {
    const allAges = year === 0;

    /* ONE grouped aggregate covers every metric. Both extremes are pulled so
       lower-is-better boards (pop time, sprints) and higher-is-better boards
       read from the same result set instead of needing a query each.

       The filters mirror the old per-metric query exactly:
         - value > 0       drops failed sensor reads (Velo=0 takes, blank pop
                           times); 0 is also non-physical for a sprint.
         - source REPORT_* per-report aggregated points only, so the board
                           ranks players on the SAME values their profile
                           shows — never seeded or raw-CSV rows.
       The class filter goes through the `player` relation, which avoids a
       separate query just to build a list of player ids. */
    const grouped = await this.prisma.metric.groupBy({
      by: ['playerId', 'metricType'],
      where: {
        metricType: { in: LEADERBOARD_METRICS },
        value: { gt: 0 },
        source: { startsWith: 'REPORT_' },
        ...(allAges ? {} : { player: { gradYear: year } }),
      },
      _max: { value: true },
      _min: { value: true },
    });

    const rows: {
      gradYear: number;
      metricType: string;
      playerId: string;
      value: number;
      rank: number;
    }[] = [];

    for (const metricType of LEADERBOARD_METRICS) {
      const lowerIsBetter = LOWER_IS_BETTER.has(metricType);
      grouped
        .filter(g => g.metricType === metricType)
        .map(g => ({
          playerId: g.playerId,
          value: (lowerIsBetter ? g._min.value : g._max.value) ?? 0,
        }))
        /* Defensive double-check — a sensor can emit a finite but clearly
           bogus reading that slips past the `value > 0` filter above. */
        .filter(e => Number.isFinite(e.value) && e.value > 0)
        /* Tie-break on playerId so ranks are DETERMINISTIC. Two players on the
           same value used to land in whatever order the rows happened to come
           back in, and because these ranks are persisted that meant a tied
           player's rank could flip between one recompute and the next with no
           underlying change. Ordering among equals is arbitrary either way —
           this just makes it stable. */
        .sort((a, b) =>
          (lowerIsBetter ? a.value - b.value : b.value - a.value) ||
          a.playerId.localeCompare(b.playerId),
        )
        .slice(0, 15)
        .forEach((e, i) =>
          rows.push({
            gradYear: year,
            metricType,
            playerId: e.playerId,
            value: e.value,
            rank: i + 1,
          }),
        );
    }

    /* Swap the whole board in ONE transaction. The delete and the insert used
       to be separate awaits per metric, so a reader hitting the API mid-
       recompute could catch the board empty. */
    await this.prisma.$transaction([
      this.prisma.leaderboardEntry.deleteMany({
        where: { gradYear: year, metricType: { in: LEADERBOARD_METRICS } },
      }),
      ...(rows.length > 0
        ? [this.prisma.leaderboardEntry.createMany({ data: rows })]
        : []),
    ]);
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
