import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BunnyService } from './bunny.service';
import { decideRendition, describeSource, withRendition } from './bunny-renditions';

/* ─────────────────────────────────────────────────────────────────────────
   Moves athlete clips from Bunny's 720p MP4 to its 1080p MP4 when one
   exists.

   A clip's link is saved at upload (play_720p.mp4) before Bunny encodes it.
   Every few minutes this looks at clips still on 720p that haven't been
   settled yet: once Bunny says the encode finished and lists a 1080p
   rendition, and the 1080p file really loads from the CDN, the clip's link
   is switched to it. A clip whose source was too small for 720p (Bunny only
   made 360p / 240p, so play_720p.mp4 doesn't exist and it couldn't play) is
   moved to the best copy that does load. A 720p source stays on 720p --
   nothing ever points at a file that isn't there. The first runs also catch
   up every older clip.

   Each check records what Bunny received (size + frame rate) so admins can
   see whether phones are uploading full-quality originals (GET
   /api/videos/renditions).
   ───────────────────────────────────────────────────────────────────────── */

const FIRST_RUN_MS = 60_000;
const EVERY_MS = 5 * 60_000;
const PER_RUN = 40;
/** A clip Bunny still hasn't finished (or can't find) after this is left on 720p. */
const GIVE_UP_MS = 2 * 24 * 60 * 60_000;

export interface RenditionResult {
  videoId: string;
  at: string;
  source: string;
  /** lower = the source was too small for 720p; moved to its 480p/360p/240p copy. */
  outcome: '1080p' | 'kept 720p' | 'lower' | 'pending' | 'failed' | 'not found';
}

@Injectable()
export class VideoRenditionsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(VideoRenditionsService.name);
  private first: NodeJS.Timeout | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** The latest checks, newest first (for the admin status route). */
  private recent: RenditionResult[] = [];

  constructor(private prisma: PrismaService, private bunny: BunnyService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || !this.bunny.isConfigured()) return;
    this.first = setTimeout(() => void this.sweep(), FIRST_RUN_MS);
    this.timer = setInterval(() => void this.sweep(), EVERY_MS);
    this.first.unref?.();
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over unsettled 720p clips (newest first). */
  async sweep(limit = PER_RUN): Promise<{ checked: number; upgraded: number }> {
    if (this.running || !this.bunny.isConfigured()) return { checked: 0, upgraded: 0 };
    this.running = true;
    let checked = 0;
    let upgraded = 0;
    try {
      const rows = await this.prisma.video.findMany({
        where: {
          renditionCheckedAt: null,
          originalUrl: { startsWith: `https://${this.bunny.cdnHostname}/`, endsWith: '/play_720p.mp4' },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, originalUrl: true, createdAt: true },
      });
      for (const row of rows) {
        const outcome = await this.checkOne(row);
        checked++;
        if (outcome === '1080p') upgraded++;
        await new Promise((r) => setTimeout(r, 250)); // be gentle with Bunny's API
      }
      if (checked) this.logger.log(`Rendition sweep: ${checked} checked, ${upgraded} moved to 1080p`);
    } catch (e: any) {
      this.logger.warn(`Rendition sweep failed: ${e?.message || e}`);
    } finally {
      this.running = false;
    }
    return { checked, upgraded };
  }

  private async checkOne(row: { id: string; originalUrl: string | null; createdAt: Date }): Promise<RenditionResult['outcome']> {
    const url = row.originalUrl ?? '';
    const old = Date.now() - row.createdAt.getTime() > GIVE_UP_MS;
    const settle = (data: { originalUrl?: string } = {}) =>
      this.prisma.video.update({ where: { id: row.id }, data: { ...data, renditionCheckedAt: new Date() } });

    const guid = this.bunny.guidFromUrl(url);
    if (!guid) {
      await settle();
      return this.note(row.id, 'unknown', 'not found');
    }
    const info = await this.bunny.getVideoInfo(guid);
    const source = describeSource(info);
    if (!info) {
      /* Bunny unreachable or the asset is gone: try again later, but stop
         after a couple of days. */
      if (old) await settle();
      return this.note(row.id, source, 'not found');
    }
    const decision = decideRendition(info);
    if (decision.state === 'pending') {
      if (old) await settle();
      return this.note(row.id, source, 'pending');
    }
    if (decision.state === 'failed') {
      await settle();
      return this.note(row.id, source, 'failed');
    }
    /* Best copy first. 720p is what the link already points at, so reaching
       it means "keep"; anything else must load before the link moves. */
    for (const height of decision.candidates) {
      if (height === '720p') {
        await settle();
        return this.note(row.id, source, 'kept 720p');
      }
      const next = withRendition(url, height);
      if (await this.bunny.cdnFileLoads(next)) {
        await settle({ originalUrl: next });
        return this.note(row.id, source, height === '1080p' ? '1080p' : 'lower');
      }
      this.logger.warn(`Video ${row.id}: Bunny lists ${height} but the MP4 didn't load`);
    }
    await settle();
    return this.note(row.id, source, 'kept 720p');
  }

  private note(videoId: string, source: string, outcome: RenditionResult['outcome']): RenditionResult['outcome'] {
    this.logger.log(`Video ${videoId}: source ${source} -> ${outcome}`);
    this.recent.unshift({ videoId, at: new Date().toISOString(), source, outcome });
    if (this.recent.length > 50) this.recent.length = 50;
    return outcome;
  }

  /** Admin status: where clips stand, plus the latest checks. */
  async status() {
    const host = this.bunny.cdnHostname;
    if (!host) return { configured: false, on1080p: 0, on720p: 0, onLower: 0, waiting: 0, recent: [] as RenditionResult[] };
    const bunnyClip = { startsWith: `https://${host}/` };
    const lower = ['480p', '360p', '240p'].map((h) => ({ originalUrl: { ...bunnyClip, endsWith: `/play_${h}.mp4` } }));
    const [on1080p, onLower, on720p, waiting] = await Promise.all([
      this.prisma.video.count({ where: { originalUrl: { ...bunnyClip, endsWith: '/play_1080p.mp4' } } }),
      this.prisma.video.count({ where: { OR: lower } }),
      this.prisma.video.count({ where: { originalUrl: { ...bunnyClip, endsWith: '/play_720p.mp4' }, renditionCheckedAt: { not: null } } }),
      this.prisma.video.count({ where: { originalUrl: { ...bunnyClip, endsWith: '/play_720p.mp4' }, renditionCheckedAt: null } }),
    ]);
    return { configured: true, on1080p, on720p, onLower, waiting, recent: this.recent.slice(0, 25) };
  }
}
