import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EducationService {
  constructor(private prisma: PrismaService) {}

  // ─── Classes ───────────────────────────────────────────────────

  async getClasses(sport?: string, level?: string) {
    const where: any = {};
    if (sport) where.sport = sport;
    if (level) where.level = level;
    return this.prisma.eduClass.findMany({
      where,
      orderBy: [{ sport: 'asc' }, { level: 'asc' }, { name: 'asc' }],
    });
  }

  async getClass(id: string) {
    const cls = await this.prisma.eduClass.findUnique({ where: { id } });
    if (!cls) throw new NotFoundException('Class not found');
    return cls;
  }

  async createClass(data: { sport: string; level: string; name: string; desc?: string; description?: string; videoUrl?: string; lessons?: number; duration?: number; emoji?: string }) {
    return this.prisma.eduClass.create({ data });
  }

  async updateClass(id: string, data: { sport?: string; level?: string; name?: string; desc?: string; description?: string; videoUrl?: string; lessons?: number; duration?: number; emoji?: string }) {
    return this.prisma.eduClass.update({ where: { id }, data });
  }

  async deleteClass(id: string) {
    return this.prisma.eduClass.delete({ where: { id } });
  }

  // ─── MLB Players ───────────────────────────────────────────────

  /** Public URL the frontend can drop straight into `url(...)` / <img src>.
   *  Serves the stored base64 blob as a real cacheable image response via
   *  getMlbPlayerCoverData — see the /cover controller route. */
  private coverUrlFor(id: string): string {
    return `/api/education/mlb/players/${id}/cover`;
  }

  async getMlbPlayers(position?: string, bats?: string, throws_?: string) {
    // EFFICIENCY: covers are stored as base64 data URLs (~up to 500KB each).
    // The old `findMany` shipped every blob inside the list JSON — at the
    // projected 300-player roster that's tens of MB per Education visit.
    // Now the list selects every scalar EXCEPT the blob, and `coverImageUrl`
    // is rewritten to the cacheable /cover image endpoint (same field name,
    // so the frontend's `url(${p.coverImageUrl})` render is unchanged).
    const [players, withCover] = await Promise.all([
      this.prisma.mlbPlayer.findMany({
        select: {
          id: true, name: true, positions: true, bats: true, throws: true,
          team: true, emoji: true, heightInches: true, weightLbs: true, createdAt: true,
          // title + url included so the Compare picker (Video Bundle modal)
          // can browse & play MLB clips straight from the players list.
          // Ordered newest-first to match the player detail page, so the
          // card's cover-photo fallback shows the SAME "first video".
          videos: { select: { id: true, title: true, category: true, url: true }, orderBy: { createdAt: 'desc' } },
        },
        orderBy: { name: 'asc' },
      }),
      // Tiny second query: which players HAVE a cover (ids only, no blobs).
      this.prisma.mlbPlayer.findMany({
        where: { coverImageUrl: { not: null } },
        select: { id: true },
      }),
    ]);
    const coverIds = new Set(withCover.map(p => p.id));
    return players
      .filter(p => {
        if (position && position !== 'all' && !p.positions.includes(position)) return false;
        if (bats && bats !== 'all' && p.bats !== bats) return false;
        if (throws_ && throws_ !== 'all' && p.throws !== throws_) return false;
        return true;
      })
      .map(p => ({ ...p, coverImageUrl: coverIds.has(p.id) ? this.coverUrlFor(p.id) : null }));
  }

  async getMlbPlayer(id: string) {
    const player = await this.prisma.mlbPlayer.findUnique({
      where: { id },
      include: { videos: { orderBy: { createdAt: 'desc' } } },
    });
    if (!player) throw new NotFoundException('MLB player not found');
    // Same blob→URL rewrite as the list (field name preserved).
    return { ...player, coverImageUrl: player.coverImageUrl ? this.coverUrlFor(id) : null };
  }

  /** Decode the stored base64 data-URL cover into servable bytes + mime.
   *  Null when the player has no cover (or the stored value isn't a data
   *  URL) — the controller turns that into a 404. */
  async getMlbPlayerCoverData(id: string): Promise<{ buffer: Buffer; mime: string } | null> {
    const row = await this.prisma.mlbPlayer.findUnique({
      where: { id },
      select: { coverImageUrl: true },
    });
    const dataUrl = row?.coverImageUrl;
    if (!dataUrl) return null;
    const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
    if (!m) return null;
    return { buffer: Buffer.from(m[2], 'base64'), mime: m[1] || 'image/jpeg' };
  }

  async createMlbPlayer(data: { name: string; positions: string; bats?: string | null; throws?: string | null; team?: string; emoji?: string; coverImageUrl?: string; heightInches?: number | null; weightLbs?: number | null }) {
    return this.prisma.mlbPlayer.create({ data });
  }

  async updateMlbPlayer(id: string, data: { name?: string; positions?: string; bats?: string | null; throws?: string | null; team?: string; emoji?: string; coverImageUrl?: string | null; heightInches?: number | null; weightLbs?: number | null }) {
    return this.prisma.mlbPlayer.update({ where: { id }, data });
  }

  async deleteMlbPlayer(id: string) {
    return this.prisma.mlbPlayer.delete({ where: { id } });
  }

  // ─── MLB Videos ────────────────────────────────────────────────

  async createMlbVideo(data: { playerId: string; title: string; category: string; url?: string; notes?: string }) {
    return this.prisma.mlbVideo.create({ data });
  }

  async updateMlbVideo(id: string, data: { title?: string; category?: string; url?: string; notes?: string }) {
    return this.prisma.mlbVideo.update({ where: { id }, data });
  }

  async deleteMlbVideo(id: string) {
    return this.prisma.mlbVideo.delete({ where: { id } });
  }
}
