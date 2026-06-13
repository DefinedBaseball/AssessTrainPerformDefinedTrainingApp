import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type NotificationType =
  | 'ACCOUNT_REQUEST'
  | 'ANNOUNCEMENT'
  | 'COMMITMENT'
  | 'COACH_REVIEW'
  | 'REPORT'
  | 'VIDEO'
  | 'SCHEDULE';

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  actorId?: string | null;
  entityId?: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Does this user want IN-APP notifications for `subject` (= payload type)?
   * Reads their saved channel matrix; a missing subject/channel defaults to
   * ON, so existing users keep getting in-app notifications until they opt
   * out in Settings. (Email/Phone channels are stored but not delivered yet.)
   */
  private appEnabled(prefsJson: string | null | undefined, subject: string): boolean {
    // Account requests are MANDATORY in-app — a coach can't mute them, so a
    // pending player is never silently stuck waiting for approval. The
    // Settings matrix shows this channel as a locked, always-on toggle.
    if (subject === 'ACCOUNT_REQUEST') return true;
    if (!prefsJson) return true;
    try {
      const prefs = JSON.parse(prefsJson);
      return prefs?.[subject]?.app !== false;
    } catch {
      return true;
    }
  }

  /**
   * Create a single notification. Never throws — a notification failure must
   * not break the action that triggered it (post save, report upload, …).
   * Respects the recipient's APP channel preference for this subject.
   */
  async create(recipientId: string, payload: NotificationPayload) {
    try {
      const u = await this.prisma.user.findUnique({
        where: { id: recipientId },
        select: { notificationPrefs: true },
      });
      if (!this.appEnabled(u?.notificationPrefs, payload.type)) return null;
      return await this.prisma.notification.create({
        data: {
          recipientId,
          type: payload.type,
          title: payload.title,
          body: payload.body ?? null,
          linkUrl: payload.linkUrl ?? null,
          actorId: payload.actorId ?? null,
          entityId: payload.entityId ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to create notification for ${recipientId}`, err as Error);
      return null;
    }
  }

  /**
   * Fan a single payload out to many recipients, skipping anyone who turned
   * the APP channel off for this subject. Never throws.
   */
  async notifyMany(recipientIds: string[], payload: NotificationPayload) {
    const ids = [...new Set(recipientIds.filter(Boolean))];
    if (ids.length === 0) return;
    try {
      const users = await this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, notificationPrefs: true },
      });
      const allowed = users
        .filter((u) => this.appEnabled(u.notificationPrefs, payload.type))
        .map((u) => u.id);
      if (allowed.length === 0) return;
      await this.prisma.notification.createMany({
        data: allowed.map((recipientId) => ({
          recipientId,
          type: payload.type,
          title: payload.title,
          body: payload.body ?? null,
          linkUrl: payload.linkUrl ?? null,
          actorId: payload.actorId ?? null,
          entityId: payload.entityId ?? null,
        })),
      });
    } catch (err) {
      this.logger.error('Failed to fan out notifications', err as Error);
    }
  }

  /** Notify every active coach (optionally excluding the actor). */
  async notifyAllCoaches(payload: NotificationPayload, exceptId?: string) {
    const coaches = await this.prisma.user.findMany({
      where: { role: 'COACH', status: 'ACTIVE' },
      select: { id: true },
    });
    await this.notifyMany(
      coaches.map((c) => c.id).filter((id) => id !== exceptId),
      payload,
    );
  }

  /** Notify every active player (optionally excluding the actor). */
  async notifyActivePlayers(payload: NotificationPayload, exceptId?: string) {
    const players = await this.prisma.user.findMany({
      where: { role: 'PLAYER', status: 'ACTIVE' },
      select: { id: true },
    });
    await this.notifyMany(
      players.map((p) => p.id).filter((id) => id !== exceptId),
      payload,
    );
  }

  /** The current user's recent notifications, newest first. */
  list(meId: string, limit = 50) {
    return this.prisma.notification.findMany({
      where: { recipientId: meId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async unreadCount(meId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { recipientId: meId, readAt: null },
    });
    return { count };
  }

  /** Mark one notification read (scoped to the owner). Account requests are
   *  exempt — they stay unread until the player is accepted/declined. */
  async markRead(meId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, recipientId: meId, readAt: null, NOT: { type: 'ACCOUNT_REQUEST' } },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async markAllRead(meId: string) {
    await this.prisma.notification.updateMany({
      where: { recipientId: meId, readAt: null, NOT: { type: 'ACCOUNT_REQUEST' } },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  /** Remove the account-request notification from EVERY coach's bell once the
   *  pending player has been accepted or declined (it lives there until then). */
  async clearAccountRequest(pendingUserId: string) {
    try {
      await this.prisma.notification.deleteMany({
        where: { type: 'ACCOUNT_REQUEST', entityId: pendingUserId },
      });
    } catch (err) {
      this.logger.error('Failed to clear account-request notifications', err as Error);
    }
  }
}
