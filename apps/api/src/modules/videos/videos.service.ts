import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BunnyService } from './bunny.service';

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private bunny: BunnyService,
  ) {}

  async create(data: {
    playerId: string;
    uploadedById?: string;
    title: string;
    category: string;
    originalUrl?: string;
  }) {
    // Destructure named fields instead of spreading the caller's object —
    // POST /videos passes the request body straight through, so a spread
    // would let a crafted payload set any valid Video column (id, status,
    // hlsUrl, …). TS types don't exist at runtime; the destructure does.
    const { playerId, uploadedById, title, category, originalUrl } = data;
    const video = await this.prisma.video.create({
      data: { playerId, uploadedById, title, category, originalUrl, status: 'UPLOADING' },
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

  /**
   * Delete a video record. Annotations + voice-overs cascade off the Video
   * relation (schema `onDelete: Cascade`), and any AtBat / TrainingClip that
   * referenced this clip is `SetNull`, so the row deletes cleanly without FK
   * blocks. When the clip lives on Bunny Stream we also delete the underlying
   * asset (best-effort, after the row is gone) so storage cost doesn't creep
   * as coaches prune clips; S3/disk assets are still left in place.
   */
  async remove(id: string) {
    const existing = await this.prisma.video.findUnique({
      where: { id },
      select: { id: true, originalUrl: true, hlsUrl: true },
    });
    if (!existing) throw new NotFoundException('Video not found');
    await this.prisma.video.delete({ where: { id } });
    // Fire-and-forget Bunny cleanup — a storage hiccup must never turn a
    // successful gallery delete into a 500. Failures just leave an orphan
    // (exactly the pre-cleanup behaviour), logged for visibility.
    const guid =
      this.bunny.guidFromUrl(existing.originalUrl) ?? this.bunny.guidFromUrl(existing.hlsUrl);
    if (guid) {
      void this.bunny
        .deleteVideoObject(guid)
        .then((ok) => {
          if (ok) this.logger.log(`Bunny asset ${guid} deleted with video ${id}`);
          else this.logger.warn(`Bunny asset ${guid} could not be deleted (video ${id}) — orphaned`);
        })
        .catch((e) => this.logger.warn(`Bunny cleanup failed for ${guid}: ${e?.message || e}`));
    }
    return { id, deleted: true };
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
