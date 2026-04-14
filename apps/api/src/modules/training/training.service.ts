import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TrainingService {
  constructor(private prisma: PrismaService) {}

  // ─── Drill Library ─────────────────────────────────────────────

  async getAllDrills(tab?: string) {
    return this.prisma.drill.findMany({
      where: tab ? { tab } : undefined,
      orderBy: [{ tab: 'asc' }, { category: 'asc' }, { name: 'asc' }],
    });
  }

  async searchDrills(query: string, tab?: string) {
    const where: any = {
      name: { contains: query },
    };
    if (tab) where.tab = tab;

    return this.prisma.drill.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 20,
    });
  }

  async getDrill(id: string) {
    const drill = await this.prisma.drill.findUnique({ where: { id } });
    if (!drill) throw new NotFoundException('Drill not found');
    return drill;
  }

  async createDrill(data: {
    name: string;
    tab: string;
    category: string;
    description?: string;
    videoUrl?: string;
  }) {
    return this.prisma.drill.create({ data });
  }

  async updateDrill(id: string, data: {
    name?: string;
    tab?: string;
    category?: string;
    description?: string;
    videoUrl?: string;
  }) {
    return this.prisma.drill.update({ where: { id }, data });
  }

  async deleteDrill(id: string) {
    return this.prisma.drill.delete({ where: { id } });
  }

  // ─── Scheduled Drills (Calendar) ───────────────────────────────

  async getScheduledDrills(playerId: string, date?: string, tab?: string) {
    const where: any = { playerId };
    if (date) where.date = date;
    if (tab) where.tab = tab;

    return this.prisma.scheduledDrill.findMany({
      where,
      include: { drill: true },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
    });
  }

  async getScheduledDrillsForRange(playerId: string, startDate: string, endDate: string, tab?: string) {
    const where: any = {
      playerId,
      date: { gte: startDate, lte: endDate },
    };
    if (tab) where.tab = tab;

    return this.prisma.scheduledDrill.findMany({
      where,
      include: { drill: true },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
    });
  }

  async createScheduledDrill(data: {
    playerId: string;
    drillId?: string;
    tab: string;
    category: string;
    name: string;
    date: string;
    time: string;
    duration: number;
    notes?: string;
  }) {
    return this.prisma.scheduledDrill.create({
      data,
      include: { drill: true },
    });
  }

  async createScheduledDrillsBatch(items: {
    playerId: string;
    drillId?: string;
    tab: string;
    category: string;
    name: string;
    date: string;
    time: string;
    duration: number;
    notes?: string;
  }[]) {
    // Create all in a transaction and return with drill data
    const results: any[] = [];
    for (const item of items) {
      const created = await this.prisma.scheduledDrill.create({
        data: item,
        include: { drill: true },
      });
      results.push(created);
    }
    return results;
  }

  async updateScheduledDrill(id: string, data: {
    drillId?: string;
    tab?: string;
    category?: string;
    name?: string;
    date?: string;
    time?: string;
    duration?: number;
    notes?: string;
  }) {
    return this.prisma.scheduledDrill.update({
      where: { id },
      data,
      include: { drill: true },
    });
  }

  async deleteScheduledDrill(id: string) {
    return this.prisma.scheduledDrill.delete({ where: { id } });
  }

  // ─── Legacy Training Programs (kept for backward compat) ──────

  async createProgram(data: {
    playerId: string;
    name: string;
    startDate: Date;
    endDate: Date;
  }) {
    return this.prisma.trainingProgram.create({ data });
  }

  async getProgram(id: string) {
    const program = await this.prisma.trainingProgram.findUnique({
      where: { id },
      include: {
        days: {
          orderBy: { date: 'asc' },
          include: {
            exercises: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });
    if (!program) throw new NotFoundException('Training program not found');
    return program;
  }

  async getPlayerPrograms(playerId: string) {
    return this.prisma.trainingProgram.findMany({
      where: { playerId },
      orderBy: { startDate: 'desc' },
      include: {
        days: {
          orderBy: { date: 'asc' },
          include: { exercises: { select: { category: true } } },
        },
      },
    });
  }

  async addDay(programId: string, date: Date) {
    return this.prisma.trainingDay.create({
      data: { programId, date },
    });
  }

  async addExercise(dayId: string, data: {
    category: string;
    name: string;
    description?: string;
    demoVideoUrl?: string;
    sortOrder?: number;
  }) {
    return this.prisma.trainingExercise.create({
      data: { dayId, ...data },
    });
  }
}
