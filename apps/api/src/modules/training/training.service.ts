import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TrainingService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /** When a Drill carries a videoUrl that points at our local upload
   *  directory, delete the underlying file so it doesn't orphan on
   *  disk after the Drill row is removed. URLs like "/api/videos/file/
   *  abc.mp4" map to "uploads/videos/abc.mp4" relative to cwd. Falls
   *  back to a no-op if the URL is external (e.g. YouTube embed) or
   *  the file is already gone. */
  private cleanupDrillVideoFile(videoUrl: string | null | undefined) {
    if (!videoUrl) return;
    const FILE_PREFIX = '/api/videos/file/';
    if (!videoUrl.startsWith(FILE_PREFIX)) return;
    const filename = videoUrl.slice(FILE_PREFIX.length);
    if (!filename || filename.includes('/') || filename.includes('..')) return; // guard against path traversal
    const filePath = path.join(process.cwd(), 'uploads', 'videos', filename);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Already gone or never existed — fine.
    }
  }

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
    /* If a coach replaces the drill's video, the previous file becomes
       orphaned on disk. Look up the existing drill, compare URLs, and
       delete the old file when it changes. */
    if (data.videoUrl !== undefined) {
      const prev = await this.prisma.drill.findUnique({ where: { id }, select: { videoUrl: true } });
      if (prev && prev.videoUrl && prev.videoUrl !== data.videoUrl) {
        this.cleanupDrillVideoFile(prev.videoUrl);
      }
    }
    return this.prisma.drill.update({ where: { id }, data });
  }

  async deleteDrill(id: string) {
    /* Read the drill first so we can clean up its videoUrl file before
       the row is gone. ScheduledDrill rows pointing here have an
       onDelete: SetNull rule (see schema.prisma) so they survive but
       lose the FK link — which is the right behaviour because the
       calendar slot itself shouldn't disappear when the Drill template
       is removed. */
    const drill = await this.prisma.drill.findUnique({
      where: { id }, select: { videoUrl: true },
    });
    const result = await this.prisma.drill.delete({ where: { id } });
    if (drill?.videoUrl) this.cleanupDrillVideoFile(drill.videoUrl);
    return result;
  }

  // ─── Scheduled Drills (Calendar) ───────────────────────────────

  async getScheduledDrills(playerId: string, date?: string, tab?: string) {
    const where: any = { playerId };
    if (date) where.date = date;
    if (tab) where.tab = tab;

    return this.prisma.scheduledDrill.findMany({
      where,
      include: { drill: true },
      // sectionOrder + order carry coach drag-reorder; both default 0 so an
      // un-reordered day still falls back to time order (matches old output).
      orderBy: [{ date: 'asc' }, { sectionOrder: 'asc' }, { order: 'asc' }, { time: 'asc' }],
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
      orderBy: [{ date: 'asc' }, { sectionOrder: 'asc' }, { order: 'asc' }, { time: 'asc' }],
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
    order?: number;
    sectionOrder?: number;
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
    order?: number;
    sectionOrder?: number;
  }[]) {
    // One real transaction (single batched round-trip) instead of the old
    // sequential per-item awaits — template applies create dozens of rows,
    // and all-or-nothing semantics beat a half-created day on failure.
    const results = await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.scheduledDrill.create({
          data: item,
          include: { drill: true },
        }),
      ),
    );
    // One "new training scheduled" notification per unique player in the
    // batch (a schedule upload) — not one per drill, which would spam.
    void this.notifyScheduledPlayers([...new Set(items.map((i) => i.playerId))]);
    return results;
  }

  /** Notify each given player once that new training hit their calendar. */
  private async notifyScheduledPlayers(playerIds: string[]) {
    const players = await this.prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { userId: true },
    });
    await this.notifications.notifyMany(
      players.map((p) => p.userId).filter((id): id is string => !!id),
      {
        type: 'SCHEDULE',
        title: 'New training scheduled',
        body: 'Your coach added new training to your calendar.',
        linkUrl: '/training',
      },
    );
  }

  async updateScheduledDrill(id: string, data: {
    /* playerId is included so the program-board's drag-drop flow can
       reassign a scheduled drill from one athlete to another with a
       single PATCH (rather than delete+recreate). */
    playerId?: string;
    drillId?: string;
    tab?: string;
    category?: string;
    name?: string;
    date?: string;
    time?: string;
    duration?: number;
    notes?: string | null;
    order?: number;
    sectionOrder?: number;
  }) {
    return this.prisma.scheduledDrill.update({
      where: { id },
      data,
      include: { drill: true },
    });
  }

  /**
   * Coach drag-to-reorder. Persists new `order` (drill rank within its
   * section) and `sectionOrder` (the section's rank) for a set of drills in
   * one transaction. May also carry `playerId` / `category` so the same call
   * covers a cross-athlete reassign on the /program board (drop a drill onto
   * another athlete's column). Each item only writes the fields it provides.
   */
  async reorderScheduledDrills(items: {
    id: string;
    order?: number;
    sectionOrder?: number;
    playerId?: string;
    category?: string;
  }[]) {
    if (!items?.length) return { updated: 0 };
    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.scheduledDrill.update({
          where: { id: it.id },
          data: {
            ...(it.order !== undefined ? { order: it.order } : {}),
            ...(it.sectionOrder !== undefined ? { sectionOrder: it.sectionOrder } : {}),
            ...(it.playerId !== undefined ? { playerId: it.playerId } : {}),
            ...(it.category !== undefined ? { category: it.category } : {}),
          },
        }),
      ),
    );
    return { updated: items.length };
  }

  async deleteScheduledDrill(id: string) {
    return this.prisma.scheduledDrill.delete({ where: { id } });
  }

  // ─── Schedule Templates (named, reusable day plans) ───────────
  // Items are stored as a JSON string snapshot; the service validates it
  // parses to an array before writing so a bad client can't store junk
  // that later breaks every picker render. Applying a template happens
  // client-side via the existing createScheduledDrillsBatch.

  private assertTemplateItems(items: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(items);
    } catch {
      throw new BadRequestException('items must be a JSON array');
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new BadRequestException('items must be a non-empty JSON array');
    }
  }

  async listScheduleTemplates(tab?: string) {
    return this.prisma.scheduleTemplate.findMany({
      where: tab ? { tab } : undefined,
      orderBy: [{ tab: 'asc' }, { name: 'asc' }],
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
  }

  async createScheduleTemplate(data: { name: string; tab: string; items: string; createdById?: string }) {
    const { name, tab, items, createdById } = data;
    if (!name?.trim()) throw new BadRequestException('name is required');
    if (!tab?.trim()) throw new BadRequestException('tab is required');
    this.assertTemplateItems(items);
    return this.prisma.scheduleTemplate.create({
      data: { name: name.trim(), tab, items, createdById },
    });
  }

  async updateScheduleTemplate(id: string, data: { name?: string; items?: string }) {
    const existing = await this.prisma.scheduleTemplate.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Template not found');
    if (data.items !== undefined) this.assertTemplateItems(data.items);
    return this.prisma.scheduleTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.items !== undefined ? { items: data.items } : {}),
      },
    });
  }

  async deleteScheduleTemplate(id: string) {
    const existing = await this.prisma.scheduleTemplate.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Template not found');
    return this.prisma.scheduleTemplate.delete({ where: { id } });
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
