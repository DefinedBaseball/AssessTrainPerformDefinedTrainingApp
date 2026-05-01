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
      orderBy: { lastName: 'asc' },
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
  }) {
    return this.prisma.player.update({ where: { id }, data });
  }

  async getTopMetrics(playerId: string) {
    // Get the latest value for each metric type
    const metrics = await this.prisma.metric.findMany({
      where: { playerId },
      orderBy: { recordedAt: 'desc' },
    });

    // Group by metric type — keep the most recent value
    const latest = new Map<string, { value: number; unit: string; recordedAt: Date }>();
    for (const m of metrics) {
      if (!latest.has(m.metricType)) {
        latest.set(m.metricType, { value: m.value, unit: m.unit, recordedAt: m.recordedAt });
      }
    }

    return Object.fromEntries(latest);
  }
}
