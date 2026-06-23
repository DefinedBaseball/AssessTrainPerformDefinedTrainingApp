import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PlayersService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    userId: string;
    firstName: string;
    lastName: string;
    positions: string;
    heightInches?: number;
    weightLbs?: number;
    gradYear?: number;
  }) {
    return this.prisma.player.create({ data });
  }

  async findAll(filters?: { gradYear?: number; position?: string }) {
    const where: any = {};
    if (filters?.gradYear) where.gradYear = filters.gradYear;
    if (filters?.position) where.positions = { contains: filters.position };

    return this.prisma.player.findMany({
      where,
      orderBy: { firstName: 'asc' },
      include: { user: { select: { email: true, role: true } } },
    });
  }

  async findOne(id: string) {
    const player = await this.prisma.player.findUnique({
      where: { id },
      include: {
        user: { select: { email: true, role: true } },
        metrics: { orderBy: { recordedAt: 'desc' }, take: 50 },
        videos: { orderBy: { createdAt: 'desc' }, take: 20 },
        leaderboardEntries: true,
      },
    });
    if (!player) throw new NotFoundException('Player not found');
    return player;
  }

  async findByUserId(userId: string) {
    return this.prisma.player.findUnique({ where: { userId } });
  }

  async update(id: string, data: {
    firstName?: string;
    lastName?: string;
    positions?: string;
    profilePhoto?: string;
    heightInches?: number | null;
    weightLbs?: number | null;
    gradYear?: number | null;
    bats?: string | null;
    throws?: string | null;
    birthDate?: string | null;
    highSchool?: string | null;
    clubTeam?: string | null;
    collegeCommit?: string | null;
    pbrNational?: number | null;
    pbrState?: number | null;
    pbrPosition?: number | null;
    pgScore?: number | null;
    developmentNotes?: string | null;
    playingLevelGoal?: string | null;
    goals?: string | null;
  }) {
    return this.prisma.player.update({ where: { id }, data });
  }

  async getTopMetrics(playerId: string) {
    // Get every metric for the player (sorted newest-first).
    const metrics = await this.prisma.metric.findMany({
      where: { playerId },
      orderBy: { recordedAt: 'desc' },
    });

    /* Bucket by metric_type so we can aggregate across every row of the
       same type — handles parsers that emit one row per batted ball
       (Full Swing, Blast) the same as parsers that emit a single
       session summary (HitTrax). */
    const grouped = new Map<string, typeof metrics>();
    for (const m of metrics) {
      const arr = grouped.get(m.metricType);
      if (arr) arr.push(m);
      else grouped.set(m.metricType, [m]);
    }

    /* Aggregation rule per metric_type, deduced from the name:
         - starts with `max_*` or ends with `_max`  → MAX
         - starts with `avg_*` or ends with `_avg`  → AVG
         - ends with `_pct`                          → AVG (per-row 0/100 flags average to a percentage)
         - explicit AVG metrics (launch_angle, distance, etc.)
         - everything else                           → latest (default, prior behavior)
       Coach-graded scouting numbers (manual entries) keep "latest" so
       the most recent grade wins, not an average across history. */
    const AVG_METRICS = new Set([
      'launch_angle', 'distance', 'spray_angle', 'pitch_speed',
      'bat_speed', 'attack_angle', 'plane_angle',
      'time_to_contact', 'on_plane_efficiency',
      'connection_at_contact', 'rotational_acceleration',
      'smash_factor',
    ]);

    const aggregateForType = (metricType: string): 'max' | 'avg' | 'latest' => {
      if (metricType.startsWith('max_') || metricType.endsWith('_max')) return 'max';
      if (metricType.startsWith('avg_') || metricType.endsWith('_avg')) return 'avg';
      if (metricType.endsWith('_pct')) return 'avg';
      if (AVG_METRICS.has(metricType)) return 'avg';
      return 'latest';
    };

    const out: Record<string, { value: number; unit: string; recordedAt: Date }> = {};
    grouped.forEach((rows, metricType) => {
      const mode = aggregateForType(metricType);
      const latest = rows[0]; // grouped insertion preserves desc order from the query
      const values = rows.map(r => r.value);
      let value: number;
      if (mode === 'max') value = Math.max(...values);
      else if (mode === 'avg') value = values.reduce((s, n) => s + n, 0) / values.length;
      else value = latest.value;
      out[metricType] = {
        value: Math.round(value * 100) / 100,
        unit: latest.unit,
        recordedAt: latest.recordedAt,
      };
    });

    /* ── Synthesized companions ──────────────────────────────────────
       Both the Full Swing parser (`ExitSpeed`) and the legacy HitTrax
       parser map per-batted-ball exit velo to `max_exit_velo`, so
       `avg_exit_velo` may not exist as its own row even though the raw
       data is sitting right there. Derive it from the per-row average
       of `max_exit_velo` so the Hitting tab's "Avg Exit Velo" KPI
       lights up regardless of which parser ingested the file. */
    const exitVeloRows = grouped.get('max_exit_velo');
    if (exitVeloRows && exitVeloRows.length > 0 && !out.avg_exit_velo) {
      const avg = exitVeloRows.reduce((s, r) => s + r.value, 0) / exitVeloRows.length;
      out.avg_exit_velo = {
        value: Math.round(avg * 100) / 100,
        unit: exitVeloRows[0].unit,
        recordedAt: exitVeloRows[0].recordedAt,
      };
    }

    return out;
  }
}
