import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { syncReportMetricsFor } from './report-metrics.util';
import { LeaderboardsService } from '../leaderboards/leaderboards.service';
import { NotificationsService } from '../notifications/notifications.service';
import * as fs from 'fs';
import * as path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'videos');

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private leaderboards: LeaderboardsService,
    private notifications: NotificationsService,
  ) {}

  async create(data: {
    playerId: string;
    createdById: string;
    reportType: string;
    title?: string;
    content: string;
    notes?: string;
    videoIds?: string;
  }) {
    const report = await this.prisma.report.create({ data });
    await this.syncReportMetrics(report);
    void this.recomputeLeaderboardFor(report.playerId);
    void this.notifyPlayerOfReport(report.playerId, data.reportType);
    return report;
  }

  /** Tell the report's player a new report landed on their profile. */
  private async notifyPlayerOfReport(playerId: string, reportType: string) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { userId: true },
    });
    if (!player?.userId) return;
    const label = reportType
      ? `${reportType.charAt(0)}${reportType.slice(1).toLowerCase()} `
      : '';
    await this.notifications.create(player.userId, {
      type: 'REPORT',
      title: 'New report uploaded',
      body: `A new ${label}report was added to your profile.`,
      linkUrl: `/athletes/${playerId}`,
      entityId: playerId,
    });
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

  async update(id: string, data: { title?: string; content?: string; notes?: string; videoIds?: string }) {
    const report = await this.prisma.report.update({ where: { id }, data });
    await this.syncReportMetrics(report);
    void this.recomputeLeaderboardFor(report.playerId);
    return report;
  }

  /**
   * Mirror a report's manual metric entries into the Metric table so they
   * surface on the Player Summary trend charts. Tagged with a per-report
   * source (`REPORT_<id>`) and re-synced on every save, so editing a report
   * replaces its points (never duplicates) and one report yields one point
   * per metric. Best-effort: a failure here never blocks the report save.
   */
  private async syncReportMetrics(report: {
    id: string; playerId: string; reportType: string; content: string; createdAt: Date;
  }) {
    try {
      await syncReportMetricsFor(this.prisma, report);
    } catch (err) {
      this.logger.warn(`Failed to sync metrics for report ${report.id}: ${err}`);
    }
  }

  /** Recompute this player's grad-year leaderboards so rankings track the
   *  report data. Fire-and-forget + error-safe — never blocks a report save. */
  private async recomputeLeaderboardFor(playerId: string) {
    try {
      const player = await this.prisma.player.findUnique({
        where: { id: playerId },
        select: { gradYear: true },
      });
      if (player?.gradYear != null) {
        await this.leaderboards.recompute(player.gradYear);
      }
    } catch (err) {
      this.logger.warn(`Leaderboard recompute failed for player ${playerId}: ${err}`);
    }
  }

  async remove(id: string) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');

    // Drop the trend points this report mirrored into the Metric table.
    await this.prisma.metric.deleteMany({ where: { source: `REPORT_${id}` } });
    void this.recomputeLeaderboardFor(report.playerId);

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
