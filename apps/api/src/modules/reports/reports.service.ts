import { Injectable, NotFoundException, BadRequestException, Logger, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { syncReportMetricsFor } from './report-metrics.util';
import { LeaderboardsService } from '../leaderboards/leaderboards.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { JwtPayload } from '../auth/jwt.util';
import * as fs from 'fs';
import * as path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'videos');

/** Report content keys only coaches may read. Stripped from every report a
 *  player receives (see `redactForPlayer`). */
export const COACH_ONLY_CONTENT_KEYS = ['coachNotes'] as const;

/** Keys that must never be written through a content merge -- assigning
 *  them onto a parsed object would reach the prototype, not the data. */
const FORBIDDEN_CONTENT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function parseContent(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** A copy of the report with coach-only content removed. Returns the input
 *  untouched when there is nothing to strip, so unchanged rows aren't
 *  re-serialized. */
export function redactForPlayer<T extends { content?: string | null }>(report: T): T {
  if (!report?.content) return report;
  const content = parseContent(report.content);
  let changed = false;
  for (const key of COACH_ONLY_CONTENT_KEYS) {
    if (key in content) { delete content[key]; changed = true; }
  }
  return changed ? { ...report, content: JSON.stringify(content) } : report;
}

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
   * Merge named keys into a report's content, optionally setting the
   * top-level notes / title in the same write.
   *
   * The in-tab report flow saves one piece at a time (notes, coach notes,
   * an upload batch) while videos attach in the background. A browser-side
   * read-modify-write of the whole content blob would let any of those
   * stamp a stale copy over another, so the merge happens here instead.
   *
   * `set`: each key is written as given; a `null` value deletes the key.
   * Keys not named are left exactly as stored.
   */
  async mergeContent(
    id: string,
    data: { set?: Record<string, unknown> | null; notes?: string | null; title?: string | null },
  ) {
    const set = data.set ?? {};
    if (typeof set !== 'object' || Array.isArray(set)) {
      throw new BadRequestException('"set" must be an object of content keys');
    }
    const report = await this.withReportLock(id, async (tx, current) => {
      const content = parseContent(current.content);
      for (const [key, value] of Object.entries(set)) {
        if (FORBIDDEN_CONTENT_KEYS.has(key)) continue;
        if (value === null) delete content[key];
        else content[key] = value;
      }
      return tx.report.update({
        where: { id },
        data: {
          content: JSON.stringify(content),
          ...(data.notes !== undefined ? { notes: data.notes ?? null } : {}),
          ...(data.title !== undefined ? { title: data.title ?? null } : {}),
        },
      });
    });
    await this.syncReportMetrics(report);
    void this.recomputeLeaderboardFor(report.playerId);
    return report;
  }

  /**
   * Attach one uploaded clip to a report: append to content.videos and to
   * videoIds, skipping either if the clip is already there (a retried
   * attach that had actually succeeded). Server-side for the same reason as
   * mergeContent -- the upload queue used to do this read-modify-write in
   * the browser.
   */
  async attachVideo(
    id: string,
    entry: { id: string; name: string; size: number; url?: string | null; section?: 'swing' | 'decision' },
    actor?: JwtPayload,
  ) {
    if (!entry?.id) throw new BadRequestException('Video id is required');

    /* An athlete may attach only their own clip to their own report. The
       clip's URL is taken from the Video row, never from the request, so an
       athlete can't put an arbitrary link into a report. */
    let athleteUpload: { playerId: string; reportType: string; title: string | null } | null = null;
    if (actor?.role === 'PLAYER') {
      const report = await this.prisma.report.findUnique({
        where: { id },
        select: { playerId: true, reportType: true, title: true },
      });
      if (!report) throw new NotFoundException('Report not found');
      if (!actor.playerId || report.playerId !== actor.playerId) {
        throw new ForbiddenException('You can only add video to your own reports.');
      }
      const video = await this.prisma.video.findUnique({
        where: { id: entry.id },
        select: { playerId: true, originalUrl: true },
      });
      if (!video || video.playerId !== report.playerId) {
        throw new ForbiddenException('You can only add your own video.');
      }
      entry = {
        id: entry.id,
        name: String(entry.name || 'Video').slice(0, 200),
        size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : 0,
        url: video.originalUrl,
        section: entry.section,
      };
      athleteUpload = report;
    }

    const updated = await this.withReportLock(id, async (tx, current) => {
      const content = parseContent(current.content);
      const videos: any[] = Array.isArray(content.videos) ? content.videos : [];
      if (!videos.some((v) => v && v.id === entry.id)) {
        videos.push({
          name: entry.name,
          size: entry.size,
          id: entry.id,
          ...(entry.url ? { url: entry.url } : {}),
          section: entry.section === 'decision' ? 'decision' : 'swing',
        });
      }
      content.videos = videos;
      const ids = (current.videoIds || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!ids.includes(entry.id)) ids.push(entry.id);
      return tx.report.update({
        where: { id },
        data: { content: JSON.stringify(content), videoIds: ids.join(',') },
      });
    });

    if (athleteUpload) void this.notifyCoachesOfAthleteVideo(id, athleteUpload, actor!);
    return updated;
  }

  /** Tell coaches an athlete added video to a report. One notification per
   *  report per hour while unread, so a batch of clips is one bell entry. */
  private async notifyCoachesOfAthleteVideo(
    reportId: string,
    report: { playerId: string; reportType: string; title: string | null },
    actor: JwtPayload,
  ) {
    try {
      const player = await this.prisma.player.findUnique({
        where: { id: report.playerId },
        select: { firstName: true, lastName: true },
      });
      const name = player ? `${player.firstName} ${player.lastName}`.trim() : 'An athlete';
      const type = report.reportType.charAt(0) + report.reportType.slice(1).toLowerCase();
      const label = report.title?.trim() ? `${type} report "${report.title.trim()}"` : `${type} report`;
      await this.notifications.notifyAllCoachesOnce({
        type: 'VIDEO',
        title: `${name} uploaded video`,
        body: `Added to their ${label}.`,
        linkUrl: `/athletes/${report.playerId}?report=${reportId}`,
        actorId: actor.sub,
        entityId: reportId,
      }, 60 * 60 * 1000);
    } catch (err) {
      this.logger.warn(`Athlete video notification failed: ${err}`);
    }
  }

  /**
   * Run a read-modify-write of one report inside a serializable
   * transaction. Two writers racing on the same row make one of them fail
   * with P2034 (write conflict) instead of silently losing the other's
   * change; that one is retried against the fresh row.
   */
  private async withReportLock<T>(
    id: string,
    fn: (tx: Prisma.TransactionClient, current: { content: string; videoIds: string | null }) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const current = await tx.report.findUnique({
            where: { id },
            select: { content: true, videoIds: true },
          });
          if (!current) throw new NotFoundException('Report not found');
          return fn(tx, current);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < 4) continue;
        throw err;
      }
    }
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
          // Multi-file slots carry `uploadIds: string[]`; legacy/single-file
          // slots carry one `uploadId`. Clean up whichever is present.
          if (Array.isArray(slot?.uploadIds)) uploadIds.push(...slot.uploadIds.filter(Boolean));
          else if (slot?.uploadId) uploadIds.push(slot.uploadId);
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
