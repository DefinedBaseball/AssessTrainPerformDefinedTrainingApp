import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt.util';

/* Coach Tasks board (coach dashboard). Admins create and delete tasks; any
   coach assigned to a task checks it off for themselves. Every coach sees
   every task. The board shows one column per coach and colours tasks by
   type; admins choose which coaches get a column and the four type colours
   (board settings, shared by everyone). */

/* Task TYPE (stored in the `column` field): sets the task's colour on the
   board, whose columns are now one per coach. */
export const TASK_COLUMNS = ['URGENT', 'PRIORITY', 'GENERAL', 'REMINDER'] as const;
export type TaskColumn = (typeof TASK_COLUMNS)[number];

/* The board's first version used time-based columns. Existing tasks are
   converted once at startup (idempotent): Long Term → General Task,
   Daily / Weekly → Reminder. Urgent stays Urgent. */
const LEGACY_TYPES: Record<string, TaskColumn> = { LONG_TERM: 'GENERAL', DAILY: 'REMINDER', WEEKLY: 'REMINDER' };

const MAX_TITLE = 200;

/* Board settings, one shared record in AppSetting. Coaches are HIDDEN by
   listing them, so a newly added coach gets a column by default. */
const SETTINGS_KEY = 'coachTaskBoard';
export const DEFAULT_TASK_COLORS: Record<TaskColumn, string> = {
  URGENT: '#c8102e',
  PRIORITY: '#e8700f',
  GENERAL: '#15803d',
  REMINDER: '#2563eb',
};
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/* Admin-created task types, after the four built-ins. Keys are generated
   (T_ + hex) and stored in a task's `column`; removing a type moves its
   tasks to General Task. */
const CUSTOM_KEY = /^T_[0-9a-f]{8,16}$/;
const MAX_CUSTOM_TYPES = 12;
const MAX_TYPE_NAME = 30;
export interface CustomTaskType { key: string; label: string }

export interface TaskBoardSettings {
  hiddenCoachIds: string[];
  /** Colour per type key -- the built-ins and every custom type. */
  colors: Record<string, string>;
  customTypes: CustomTaskType[];
}

@Injectable()
export class CoachTasksService implements OnModuleInit {
  private readonly logger = new Logger(CoachTasksService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    try {
      for (const [from, to] of Object.entries(LEGACY_TYPES)) {
        const r = await this.prisma.coachTask.updateMany({ where: { column: from }, data: { column: to } });
        if (r.count) this.logger.log(`Converted ${r.count} To Do task(s) ${from} → ${to}`);
      }
    } catch (err) {
      this.logger.warn(`To Do type conversion skipped: ${err}`);
    }
  }

  async getSettings(): Promise<TaskBoardSettings> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
    let saved: any = {};
    try { saved = row ? JSON.parse(row.value) : {}; } catch { saved = {}; }
    const hidden = Array.isArray(saved?.hiddenCoachIds)
      ? saved.hiddenCoachIds.filter((v: unknown): v is string => typeof v === 'string')
      : [];
    const customTypes: CustomTaskType[] = Array.isArray(saved?.customTypes)
      ? saved.customTypes
          .filter((t: any) => t && typeof t.key === 'string' && CUSTOM_KEY.test(t.key) && typeof t.label === 'string' && t.label.trim())
          .map((t: any) => ({ key: t.key, label: String(t.label).trim().slice(0, MAX_TYPE_NAME) }))
      : [];
    const colors: Record<string, string> = { ...DEFAULT_TASK_COLORS };
    for (const key of [...TASK_COLUMNS, ...customTypes.map((t) => t.key)]) {
      const c = saved?.colors?.[key];
      if (typeof c === 'string' && HEX_COLOR.test(c)) colors[key] = c.toLowerCase();
      else if (!colors[key]) colors[key] = '#6b7280';
    }
    return { hiddenCoachIds: hidden, colors, customTypes };
  }

  /** Built-in + custom type keys a task may use. */
  private async typeKeys(): Promise<string[]> {
    const s = await this.getSettings();
    return [...TASK_COLUMNS, ...s.customTypes.map((t) => t.key)];
  }

  /** Admin: which coaches get a column + the type colours. Named fields only. */
  async saveSettings(input: unknown) {
    const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    if (!Array.isArray(b.hiddenCoachIds) || b.hiddenCoachIds.some((v) => typeof v !== 'string'))
      throw new BadRequestException('Choose which coaches have a column');
    const hiddenCoachIds = [...new Set(b.hiddenCoachIds as string[])].slice(0, 200);

    /* Custom types: existing ones keep their key; new ones (no key) get one. */
    const before = await this.getSettings();
    const rawTypes = Array.isArray(b.customTypes) ? b.customTypes : [];
    if (rawTypes.length > MAX_CUSTOM_TYPES) throw new BadRequestException(`Up to ${MAX_CUSTOM_TYPES} custom task types`);
    const customTypes: CustomTaskType[] = [];
    const rowColors: Record<string, string> = {};
    const seen = new Set(['urgent', 'priority', 'general task', 'reminder']);
    for (const raw of rawTypes) {
      const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const label = typeof t.label === 'string' ? t.label.replace(/\s+/g, ' ').trim() : '';
      if (!label) throw new BadRequestException('Give every task type a name');
      if (label.length > MAX_TYPE_NAME) throw new BadRequestException(`Task type names are up to ${MAX_TYPE_NAME} characters`);
      if (seen.has(label.toLowerCase())) throw new BadRequestException(`There's already a task type called "${label}"`);
      seen.add(label.toLowerCase());
      const key = typeof t.key === 'string' && before.customTypes.some((c) => c.key === t.key)
        ? t.key
        : `T_${randomBytes(6).toString('hex')}`;
      customTypes.push({ key, label });
      /* Each custom type carries its own colour (a new one has no key yet). */
      if (typeof t.color !== 'string' || !HEX_COLOR.test(t.color))
        throw new BadRequestException(`Pick a valid colour for ${label}`);
      rowColors[key] = t.color.toLowerCase();
    }

    const rawColors = (b.colors && typeof b.colors === 'object' ? b.colors : {}) as Record<string, unknown>;
    const colors: Record<string, string> = { ...DEFAULT_TASK_COLORS, ...rowColors };
    for (const key of TASK_COLUMNS) {
      const c = rawColors[key];
      if (c === undefined) continue;
      if (typeof c !== 'string' || !HEX_COLOR.test(c)) throw new BadRequestException('Pick a valid colour for every task type');
      colors[key] = c.toLowerCase();
    }

    /* Removed custom types: their tasks become General Task. */
    const removed = before.customTypes.map((t) => t.key).filter((k) => !customTypes.some((t) => t.key === k));
    if (removed.length) {
      await this.prisma.coachTask.updateMany({ where: { column: { in: removed } }, data: { column: 'GENERAL' } });
    }

    const value = JSON.stringify({ hiddenCoachIds, colors, customTypes });
    await this.prisma.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value },
      update: { value },
    });
    return this.list();
  }

  /** Active coaches -- who "All Coaches" means, and the assign picker. */
  private activeCoaches() {
    return this.prisma.user.findMany({
      where: { role: 'COACH', status: 'ACTIVE' },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async list() {
    const [tasks, coaches, settings] = await Promise.all([
      this.prisma.coachTask.findMany({
        orderBy: { createdAt: 'asc' },
        include: {
          assignees: { select: { userId: true } },
          completions: { select: { userId: true, completedAt: true } },
        },
      }),
      this.activeCoaches(),
      this.getSettings(),
    ]);
    return {
      coaches,
      settings,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        column: t.column,
        allCoaches: t.allCoaches,
        assigneeIds: t.assignees.map((a) => a.userId),
        completions: t.completions,
        createdAt: t.createdAt,
      })),
    };
  }

  /** Named fields only -- never spread the body. */
  async create(actor: JwtPayload, input: unknown) {
    const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const title = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim() : '';
    if (!title) throw new BadRequestException('Give the task a name');
    if (title.length > MAX_TITLE) throw new BadRequestException('Task name is too long');

    const column = typeof b.column === 'string' ? b.column : '';
    if (!(await this.typeKeys()).includes(column)) throw new BadRequestException('Choose a task type');

    const allCoaches = b.allCoaches === true;
    let assigneeIds: string[] = [];
    if (!allCoaches) {
      if (!Array.isArray(b.assigneeIds) || b.assigneeIds.some((v) => typeof v !== 'string'))
        throw new BadRequestException('Choose who the task is for');
      assigneeIds = [...new Set(b.assigneeIds as string[])];
      if (!assigneeIds.length) throw new BadRequestException('Choose who the task is for');
      const valid = await this.prisma.user.count({
        where: { id: { in: assigneeIds }, role: 'COACH', status: 'ACTIVE' },
      });
      if (valid !== assigneeIds.length) throw new BadRequestException('Tasks can only be assigned to active coaches');
    }

    await this.prisma.coachTask.create({
      data: {
        title,
        column,
        allCoaches,
        createdById: actor.sub,
        assignees: { create: assigneeIds.map((userId) => ({ userId })) },
      },
    });
    return this.list();
  }

  async remove(id: string) {
    const found = await this.prisma.coachTask.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Task not found');
    await this.prisma.coachTask.delete({ where: { id } });
    return this.list();
  }

  /** Check off / un-check a task for the signed-in coach only. */
  async setDone(actor: JwtPayload, id: string, done: boolean) {
    const task = await this.prisma.coachTask.findUnique({
      where: { id },
      select: { allCoaches: true, assignees: { where: { userId: actor.sub }, select: { userId: true } } },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (!task.allCoaches && task.assignees.length === 0)
      throw new ForbiddenException("This task isn't assigned to you");

    if (done) {
      await this.prisma.coachTaskCompletion.upsert({
        where: { taskId_userId: { taskId: id, userId: actor.sub } },
        create: { taskId: id, userId: actor.sub },
        update: { completedAt: new Date() },
      });
    } else {
      await this.prisma.coachTaskCompletion.deleteMany({ where: { taskId: id, userId: actor.sub } });
    }
    return this.list();
  }
}
