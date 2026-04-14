import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'videos');

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private prisma: PrismaService) {}

  async create(data: {
    playerId: string;
    createdById: string;
    reportType: string;
    title?: string;
    content: string;
    notes?: string;
    videoIds?: string;
  }) {
    return this.prisma.report.create({ data });
  }

  async findByPlayer(playerId: string, reportType?: string) {
    return this.prisma.report.findMany({
      where: { playerId, ...(reportType ? { reportType } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, email: true, role: true } },
      },
    });
  }

  async findOne(id: string) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, email: true, role: true } },
        player: { select: { firstName: true, lastName: true, positions: true } },
      },
    });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  async update(id: string, data: { content?: string; notes?: string; videoIds?: string }) {
    return this.prisma.report.update({ where: { id }, data });
  }

  async remove(id: string) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');

    // Collect video IDs from both report.videoIds and report.content.videos
    const videoIds = new Set<string>();

    // 1. From the videoIds field (comma-separated)
    if (report.videoIds) {
      report.videoIds.split(',').map(v => v.trim()).filter(Boolean).forEach(v => videoIds.add(v));
    }

    // 2. From the content JSON
    try {
      const content = JSON.parse(report.content || '{}');

      // CSV upload cleanup
      const uploadIds: string[] = [];
      if (content.csvUploads) {
        for (const slot of Object.values(content.csvUploads) as any[]) {
          if (slot?.uploadId) uploadIds.push(slot.uploadId);
        }
      }
      if (uploadIds.length > 0) {
        await this.prisma.metric.deleteMany({
          where: { uploadId: { in: uploadIds } },
        });
        await this.prisma.csvUpload.deleteMany({
          where: { id: { in: uploadIds } },
        });
      }

      // Video IDs from content.videos
      if (content.videos && Array.isArray(content.videos)) {
        for (const v of content.videos) {
          if (v?.id) videoIds.add(v.id);
        }
      }
    } catch {
      // If content parsing fails, continue with deletion
    }

    // 3. Delete videos (annotations, voice-overs, DB records, and files)
    if (videoIds.size > 0) {
      const ids = Array.from(videoIds);
      try {
        // Fetch video records to get file paths
        const videos = await this.prisma.video.findMany({
          where: { id: { in: ids } },
          select: { id: true, originalUrl: true },
        });

        // Delete annotations and voice-overs first (no cascade)
        await this.prisma.annotation.deleteMany({ where: { videoId: { in: ids } } });
        await this.prisma.voiceOver.deleteMany({ where: { videoId: { in: ids } } });

        // Delete video DB records
        await this.prisma.video.deleteMany({ where: { id: { in: ids } } });

        // Delete video files from disk
        for (const video of videos) {
          if (video.originalUrl?.startsWith('/api/videos/file/')) {
            const filename = video.originalUrl.replace('/api/videos/file/', '');
            const filePath = path.join(UPLOAD_DIR, filename);
            try {
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                this.logger.log(`Deleted video file: ${filename}`);
              }
            } catch (fileErr) {
              this.logger.warn(`Failed to delete video file ${filename}: ${fileErr}`);
            }
          }
        }

        this.logger.log(`Deleted ${videos.length} video(s) for report ${id}`);
      } catch (err) {
        this.logger.warn(`Error deleting videos for report ${id}: ${err}`);
      }
    }

    return this.prisma.report.delete({ where: { id } });
  }
}
