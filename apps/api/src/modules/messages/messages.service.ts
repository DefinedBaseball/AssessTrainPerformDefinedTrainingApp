import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Shape returned to the client for any "other user" in a conversation. */
export interface MessageContact {
  id: string;
  name: string;
  role: 'COACH' | 'PLAYER';
  photo: string | null;
}

/* User record shape we hydrate contacts from — the linked Player (if any)
   gives us a real name + avatar; otherwise the account's display name
   (Settings → Account), then the email prefix as a last resort. */
type UserWithPlayer = {
  id: string;
  email: string;
  role: string;
  name: string | null;
  player: { firstName: string; lastName: string; profilePhoto: string | null } | null;
};

@Injectable()
export class MessagesService {
  constructor(private prisma: PrismaService) {}

  /** Build the display contact (name/avatar/role) for a hydrated user row. */
  private toContact(u: UserWithPlayer): MessageContact {
    const name = u.player
      ? `${u.player.firstName} ${u.player.lastName}`.trim()
      : (u.name?.trim() || u.email?.split('@')[0] || 'User');
    return {
      id: u.id,
      name,
      role: (u.role === 'COACH' ? 'COACH' : 'PLAYER'),
      photo: u.player?.profilePhoto ?? null,
    };
  }

  private readonly contactSelect = {
    id: true,
    email: true,
    role: true,
    name: true,
    player: { select: { firstName: true, lastName: true, profilePhoto: true } },
  } as const;

  /**
   * The directory of users `me` is allowed to start a conversation with.
   *  - Coaches can message anyone (other coaches + all players).
   *  - Players can message coaches only (keeps player↔player DMs out of v1;
   *    revisit if athletes should be able to message each other).
   */
  async getContacts(meId: string, meRole: string): Promise<MessageContact[]> {
    const where =
      meRole === 'COACH'
        ? { id: { not: meId } }
        : { id: { not: meId }, role: 'COACH' };

    const users = (await this.prisma.user.findMany({
      where,
      select: this.contactSelect,
      orderBy: { createdAt: 'asc' },
    })) as UserWithPlayer[];

    return users
      .map((u) => this.toContact(u))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * One row per person `me` has exchanged messages with: the other user, the
   * most-recent message, and how many of their messages `me` hasn't read.
   * Sorted newest-activity first.
   */
  async getConversations(meId: string) {
    const messages = await this.prisma.message.findMany({
      where: { OR: [{ senderId: meId }, { recipientId: meId }] },
      orderBy: { createdAt: 'desc' },
    });

    // Group by the "other" participant, newest message first (already sorted).
    const byOther = new Map<string, { last: (typeof messages)[number]; unread: number }>();
    for (const m of messages) {
      const otherId = m.senderId === meId ? m.recipientId : m.senderId;
      const entry = byOther.get(otherId);
      const isUnreadForMe = m.recipientId === meId && m.readAt === null;
      if (!entry) {
        byOther.set(otherId, { last: m, unread: isUnreadForMe ? 1 : 0 });
      } else if (isUnreadForMe) {
        entry.unread += 1;
      }
    }

    if (byOther.size === 0) return [];

    const others = (await this.prisma.user.findMany({
      where: { id: { in: [...byOther.keys()] } },
      select: this.contactSelect,
    })) as UserWithPlayer[];
    const contactById = new Map(others.map((u) => [u.id, this.toContact(u)]));

    return [...byOther.entries()]
      .map(([otherId, { last, unread }]) => ({
        user: contactById.get(otherId) ?? { id: otherId, name: 'Unknown', role: 'PLAYER' as const, photo: null },
        lastMessage: last,
        unreadCount: unread,
      }))
      .sort(
        (a, b) =>
          new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime(),
      );
  }

  /**
   * Full message history between `me` and `otherId` (oldest first). Opening a
   * thread marks every inbound message from that person as read.
   */
  async getThread(meId: string, otherId: string) {
    const other = (await this.prisma.user.findUnique({
      where: { id: otherId },
      select: this.contactSelect,
    })) as UserWithPlayer | null;
    if (!other) throw new NotFoundException('User not found');

    // Mark their messages to me as read.
    await this.prisma.message.updateMany({
      where: { senderId: otherId, recipientId: meId, readAt: null },
      data: { readAt: new Date() },
    });

    const messages = await this.prisma.message.findMany({
      where: {
        OR: [
          { senderId: meId, recipientId: otherId },
          { senderId: otherId, recipientId: meId },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    return { user: this.toContact(other), messages };
  }

  /** Total number of unread messages addressed to `me` (for the bell/badge). */
  async unreadCount(meId: string): Promise<{ count: number }> {
    const count = await this.prisma.message.count({
      where: { recipientId: meId, readAt: null },
    });
    return { count };
  }

  /** Send a message. Requires text and/or a video; recipient must exist. */
  async send(meId: string, meRole: string, dto: { recipientId?: string; body?: string; videoUrl?: string }) {
    const recipientId = dto.recipientId?.trim();
    const body = dto.body?.trim() || null;
    const videoUrl = dto.videoUrl?.trim() || null;

    if (!recipientId) throw new BadRequestException('recipientId is required');
    if (recipientId === meId) throw new BadRequestException('Cannot message yourself');
    if (!body && !videoUrl) throw new BadRequestException('Message must include text or a video');

    const recipient = await this.prisma.user.findUnique({ where: { id: recipientId } });
    if (!recipient) throw new NotFoundException('Recipient not found');

    // Enforce the same who-can-message-whom policy as getContacts, server-side:
    // the contact picker only HIDES disallowed users, so a crafted request could
    // otherwise bypass it. Players may message coaches only; coaches may message
    // anyone (player or coach).
    if (meRole === 'PLAYER' && recipient.role !== 'COACH') {
      throw new ForbiddenException('Players can only message coaches.');
    }

    return this.prisma.message.create({
      data: { senderId: meId, recipientId, body, videoUrl },
    });
  }
}
