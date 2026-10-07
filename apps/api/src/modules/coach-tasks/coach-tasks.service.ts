import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt.util';

/* Coach To Do list (coach dashboard). Admins create and delete tasks; any
   coach assigned to a task checks it off for themselves. Every coach sees
   every task -- the web app colours them by who they're assigned to and
   works out "finished" per viewer (incl. the daily / weekly reset). */

export const TASK_COLUMNS = ['URGENT', 'LONG_TERM', 'DAILY', 'WEEKLY'] as const;
export type TaskColumn = (typeof TASK_COLUMNS)[number];

const MAX_TITLE = 200;

@Injectable()
export class CoachTasksService {
  constructor(private prisma: PrismaService) {}

  /** Active coaches -- who "All Coaches" means, and the assign picker. */
  private activeCoaches() {
    return this.prisma.user.findMany({
      where: { role: 'COACH', status: 'ACTIVE' },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async list() {
    const [tasks, coaches] = await Promise.all([
      this.prisma.coachTask.findMany({
        orderBy: { createdAt: 'asc' },
        include: {
          assignees: { select: { userId: true } },
          completions: { select: { userId: true, completedAt: true } },
        },
      }),
      this.activeCoaches(),
    ]);
    return {
      coaches,
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

    const column = b.column as TaskColumn;
    if (!TASK_COLUMNS.includes(column)) throw new BadRequestException('Choose a column');

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
