import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class VideosService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    playerId: string;
    uploadedById?: string;
    title: string;
    category: string;
    originalUrl?: string;
  }) {
    return this.prisma.video.create({
      data: { ...data, status: 'UPLOADING' },
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
