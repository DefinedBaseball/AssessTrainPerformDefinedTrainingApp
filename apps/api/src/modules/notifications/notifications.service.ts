import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { coachReviewEmail } from '../mail/mail.templates';

/**
 * Notification subjects wired for EMAIL delivery. Everything else stays
 * in-app only (the Settings matrix shows those email toggles as "Soon").
 * Kept deliberately small — email is opt-out per subject and we don't want to
 * flood inboxes on high-frequency events. Extend this as more emails are wired.
 */
const EMAIL_DELIVERED_SUBJECTS: ReadonlySet<string> = new Set(['COACH_REVIEW']);

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

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

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
   * Does this user want EMAIL for `subject`? Defaults to ON (matches the
   * Settings matrix default), so a player is emailed about coach reviews
   * unless they explicitly turn the Email toggle off. Independent of the app
   * channel — turning the bell off must not silence the email and vice versa.
   */
  private emailEnabled(prefsJson: string | null | undefined, subject: string): boolean {
    if (!prefsJson) return true;
    try {
      const prefs = JSON.parse(prefsJson);
      return prefs?.[subject]?.email !== false;
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
        select: {
          notificationPrefs: true,
          email: true,
          name: true,
          player: { select: { firstName: true } },
        },
      });

      // Email + app channels are independent — a player can want the email but
      // not the bell, or vice versa. Fire the email (best-effort) before the
      // app-channel early-return so muting the bell doesn't mute the email.
      if (
        EMAIL_DELIVERED_SUBJECTS.has(payload.type) &&
        u?.email &&
        this.emailEnabled(u.notificationPrefs, payload.type)
      ) {
        this.sendNotificationEmail(payload, u.email, u.name || u.player?.firstName || null);
      }

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
   * Fire the email for a notification whose subject is email-delivered.
   * Fire-and-forget: MailService.send never throws and no-ops when Resend is
   * unconfigured, so this can't affect the in-app notification path.
   */
  private sendNotificationEmail(payload: NotificationPayload, to: string, name: string | null): void {
    const link = `${this.mail.webAppUrl}${payload.linkUrl || '/'}`;
    if (payload.type === 'COACH_REVIEW') {
      const { subject, html, text } = coachReviewEmail(link, name);
      void this.mail.send({ to, subject, html, text });
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

  /** Notify only ADMIN-level coaches (e.g. account-approval requests, which
   *  only admins can action). Legacy coaches with a null level count as ADMIN. */
  async notifyAdmins(payload: NotificationPayload, exceptId?: string) {
    const admins = await this.prisma.user.findMany({
      where: {
        role: 'COACH',
        status: 'ACTIVE',
        OR: [{ coachLevel: 'ADMIN' }, { coachLevel: null }],
      },
      select: { id: true },
    });
    await this.notifyMany(
      admins.map((c) => c.id).filter((id) => id !== exceptId),
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
