import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PostsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async findAll(limit = 50, offset = 0) {
    return this.prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        author: { select: { id: true, email: true, role: true } },
        taggedPlayer: { select: { id: true, firstName: true, lastName: true, positions: true, profilePhoto: true } },
      },
    });
  }

  async create(authorId: string, data: {
    type: string;
    title: string;
    body?: string;
    imageUrl?: string;
    videoUrl?: string;
    linkUrl?: string;
    urgency?: string;
    taggedPlayerId?: string;
    collegeName?: string;
    position?: string;
    organizationName?: string;
    level?: string;
  }) {
    const post = await this.prisma.post.create({
      data: {
        ...data,
        urgency: data.urgency || 'NORMAL',
        authorId,
      },
      include: {
        author: { select: { id: true, email: true, role: true } },
        taggedPlayer: { select: { id: true, firstName: true, lastName: true, positions: true, profilePhoto: true } },
      },
    });

    // If COLLEGE_COMMITMENT, update the tagged player's collegeCommit field
    if (data.type === 'COLLEGE_COMMITMENT' && data.taggedPlayerId && data.collegeName) {
      await this.prisma.player.update({
        where: { id: data.taggedPlayerId },
        data: { collegeCommit: data.collegeName },
      });
    }

    // Fan out notifications (best-effort — NotificationsService never throws).
    // Every post is a dashboard announcement for players; coaches get a
    // type-aware heads-up (college commitments called out specifically).
    await this.notifications.notifyActivePlayers({
      type: 'ANNOUNCEMENT',
      title: `New announcement: ${post.title}`,
      linkUrl: '/',
      actorId: authorId,
      entityId: post.id,
    });

    if (post.type === 'COLLEGE_COMMITMENT') {
      const who = post.taggedPlayer
        ? `${post.taggedPlayer.firstName} ${post.taggedPlayer.lastName}`.trim()
        : 'A player';
      await this.notifications.notifyAllCoaches(
        {
          type: 'COMMITMENT',
          title: 'New college commitment',
          body: data.collegeName ? `${who} → ${data.collegeName}` : `${who} committed`,
          linkUrl: '/',
          actorId: authorId,
          entityId: post.id,
        },
        authorId,
      );
    } else {
      await this.notifications.notifyAllCoaches(
        {
          type: 'ANNOUNCEMENT',
          title: `New post: ${post.title}`,
          linkUrl: '/',
          actorId: authorId,
          entityId: post.id,
        },
        authorId,
      );
    }

    return post;
  }

  async update(postId: string, data: {
    type?: string;
    title?: string;
    body?: string;
    imageUrl?: string;
    videoUrl?: string;
    linkUrl?: string;
    urgency?: string;
    taggedPlayerId?: string;
    collegeName?: string;
    position?: string;
    organizationName?: string;
    level?: string;
  }) {
    return this.prisma.post.update({
      where: { id: postId },
      data,
      include: {
        author: { select: { id: true, email: true, role: true } },
        taggedPlayer: { select: { id: true, firstName: true, lastName: true, positions: true, profilePhoto: true } },
      },
    });
  }

  async delete(postId: string) {
    return this.prisma.post.delete({ where: { id: postId } });
  }
}
