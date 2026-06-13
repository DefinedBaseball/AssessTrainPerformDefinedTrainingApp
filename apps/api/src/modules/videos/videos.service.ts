import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class VideosService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async create(data: {
    playerId: string;
    uploadedById?: string;
    title: string;
    category: string;
    originalUrl?: string;
  }) {
    const video = await this.prisma.video.create({
      data: { ...data, status: 'UPLOADING' },
    });
    void this.notifyPlayerOfVideo(video);
    return video;
  }

  /**
   * Notify the video's player a new clip landed — unless they uploaded it
   * themselves. Coach Reviews (title/category flagged) get their own type.
   */
  private async notifyPlayerOfVideo(video: {
    id: string;
    playerId: string;
    uploadedById: string | null;
    title: string;
    category: string;
  }) {
    // `uploadedById` references Player (see schema relation), so a self-upload
    // is one where the uploader's Player id equals the video's own playerId.
    if (video.uploadedById && video.uploadedById === video.playerId) return;
    const player = await this.prisma.player.findUnique({
      where: { id: video.playerId },
      select: { userId: true },
    });
    if (!player?.userId) return;
    const isReview =
      /coach review/i.test(video.title || '') || /review/i.test(video.category || '');
    await this.notifications.create(player.userId, {
      type: isReview ? 'COACH_REVIEW' : 'VIDEO',
      title: isReview ? 'New Coach Review' : 'New video uploaded',
      body: isReview
        ? 'A coach posted a new video review on your profile.'
        : 'A new video was added to your profile.',
      linkUrl: `/athletes/${video.playerId}`,
      entityId: video.id,
    });
  }

  /**
   * Browse all videos across all players, with optional filters.
   * Includes player info for display.
   */
  async findAll(options?: {
    playerId?: string;
    category?: string;
    gradYears?: number[];
    from?: string;
    to?: string;
  }) {
    const where: any = { status: 'READY' };

    if (options?.playerId) {
      where.playerId = options.playerId;
    }
    if (options?.category) {
      where.category = options.category;
    }
    if (options?.gradYears?.length) {
      where.player = { ...where.player, gradYear: { in: options.gradYears } };
    }
    if (options?.from || options?.to) {
      where.createdAt = {};
      if (options.from) where.createdAt.gte = new Date(options.from);
      if (options.to) where.createdAt.lte = new Date(options.to + 'T23:59:59.999Z');
    }

    return this.prisma.video.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        player: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            positions: true,
            gradYear: true,
            profilePhoto: true,
          },
        },
        annotations: { orderBy: { frameTimestamp: 'asc' } },
        voiceOvers: { orderBy: { startTimestamp: 'asc' } },
      },
    });
  }

  async findByPlayer(playerId: string, category?: string) {
    return this.prisma.video.findMany({
      where: {
        playerId,
        ...(category ? { category } : {}),
        status: 'READY',
      },
      orderBy: { createdAt: 'desc' },
      include: {
        annotations: { orderBy: { frameTimestamp: 'asc' } },
        voiceOvers: { orderBy: { startTimestamp: 'asc' } },
      },
    });
  }

  async findOne(id: string) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: {
        annotations: { orderBy: { frameTimestamp: 'asc' } },
        voiceOvers: { orderBy: { startTimestamp: 'asc' } },
      },
    });
    if (!video) throw new NotFoundException('Video not found');
    return video;
  }

  async updateStatus(id: string, status: 'PROCESSING' | 'READY' | 'FAILED', hlsUrl?: string) {
    return this.prisma.video.update({
      where: { id },
      data: { status, ...(hlsUrl ? { hlsUrl } : {}) },
    });
  }

  async addAnnotation(data: {
    videoId: string;
    createdById: string;
    frameTimestamp: number;
    strokeData: string;
    color: string;
    strokeWidth: number;
  }) {
    return this.prisma.annotation.create({ data });
  }

  async addVoiceOver(data: {
    videoId: string;
    createdById: string;
    audioUrl: string;
    startTimestamp: number;
    durationSec: number;
  }) {
    return this.prisma.voiceOver.create({ data });
  }
}
