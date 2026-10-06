import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt.util';
import { PrismaService } from '../../prisma/prisma.service';

/* ── Information documents ── */
export const DOC_CATEGORIES = ['SKILL', 'PHYSICAL', 'RECRUITING', 'MENTAL'] as const;
export const DOC_MAX_BYTES = 25 * 1024 * 1024;

/* Accepted file types, by extension. The stored content type comes from
   this table, never from the browser, and only PDFs and images are served
   for in-browser viewing -- everything else downloads. */
export const DOC_TYPES: Record<string, { mime: string; inline: boolean }> = {
  '.pdf':     { mime: 'application/pdf', inline: true },
  '.png':     { mime: 'image/png', inline: true },
  '.jpg':     { mime: 'image/jpeg', inline: true },
  '.jpeg':    { mime: 'image/jpeg', inline: true },
  '.webp':    { mime: 'image/webp', inline: true },
  '.doc':     { mime: 'application/msword', inline: false },
  '.docx':    { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', inline: false },
  '.xls':     { mime: 'application/vnd.ms-excel', inline: false },
  '.xlsx':    { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', inline: false },
  '.csv':     { mime: 'text/csv', inline: false },
  '.ppt':     { mime: 'application/vnd.ms-powerpoint', inline: false },
  '.pptx':    { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', inline: false },
  '.txt':     { mime: 'text/plain', inline: false },
  '.rtf':     { mime: 'application/rtf', inline: false },
  '.pages':   { mime: 'application/vnd.apple.pages', inline: false },
  '.numbers': { mime: 'application/vnd.apple.numbers', inline: false },
  '.key':     { mime: 'application/vnd.apple.keynote', inline: false },
};

export function docTypeFor(fileName: string) {
  const m = /\.[a-z0-9]+$/i.exec(fileName || '');
  return m ? DOC_TYPES[m[0].toLowerCase()] ?? null : null;
}

const DOC_LIST_SELECT = {
  id: true, title: true, description: true, category: true, fileName: true,
  mimeType: true, size: true, createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class EducationService {
  constructor(private prisma: PrismaService) {}

  // ─── Membership gate (Classes + Information) ─────────────────────

  /** Coaches always; athletes only with "Membership" on their profile. */
  async hasMemberAccess(user: JwtPayload | undefined): Promise<boolean> {
    if (!user) return false;
    if (user.role === 'COACH') return true;
    if (user.role !== 'PLAYER' || !user.playerId) return false;
    const p = await this.prisma.player.findUnique({
      where: { id: user.playerId },
      select: { athleteTypes: true },
    });
    return (p?.athleteTypes || '').split(',').map((s) => s.trim()).includes('MEMBERSHIP');
  }

  async assertMemberAccess(user: JwtPayload | undefined) {
    if (!(await this.hasMemberAccess(user))) {
      throw new ForbiddenException('Members only. Ask your coach about Membership.');
    }
  }

  // ─── Information documents ─────────────────────────────────────

  listDocuments() {
    return this.prisma.eduDocument.findMany({ select: DOC_LIST_SELECT, orderBy: { createdAt: 'desc' } });
  }

  async getDocumentFile(id: string) {
    const doc = await this.prisma.eduDocument.findUnique({
      where: { id },
      select: { fileName: true, mimeType: true, data: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async createDocument(input: {
    title: string; category: string; description?: string | null;
    fileName: string; buffer: Buffer; uploadedById?: string | null;
  }) {
    const type = docTypeFor(input.fileName);
    if (!type) throw new BadRequestException('That file type is not supported. Use PDF, Word, Excel, PowerPoint, text or an image.');
    if (!input.buffer?.length) throw new BadRequestException('The file is empty.');
    if (input.buffer.length > DOC_MAX_BYTES) throw new BadRequestException('Files can be up to 25 MB.');
    const meta = this.cleanDocMeta(input, true);
    return this.prisma.eduDocument.create({
      data: {
        title: meta.title!,
        category: meta.category!,
        description: meta.description ?? null,
        fileName: input.fileName.slice(0, 200),
        mimeType: type.mime,
        size: input.buffer.length,
        data: input.buffer,
        uploadedById: input.uploadedById ?? null,
      },
      select: DOC_LIST_SELECT,
    });
  }

  async updateDocument(id: string, input: { title?: string; category?: string; description?: string | null }) {
    const exists = await this.prisma.eduDocument.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Document not found');
    return this.prisma.eduDocument.update({ where: { id }, data: this.cleanDocMeta(input, false), select: DOC_LIST_SELECT });
  }

  async deleteDocument(id: string) {
    const exists = await this.prisma.eduDocument.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Document not found');
    await this.prisma.eduDocument.delete({ where: { id } });
    return { deleted: true };
  }

  private cleanDocMeta(input: { title?: unknown; category?: unknown; description?: unknown }, required: boolean) {
    const out: { title?: string; category?: string; description?: string | null } = {};
    if (input.title !== undefined || required) {
      const t = typeof input.title === 'string' ? input.title.trim() : '';
      if (!t) throw new BadRequestException('A title is required.');
      out.title = t.slice(0, 200);
    }
    if (input.category !== undefined || required) {
      if (typeof input.category !== 'string' || !(DOC_CATEGORIES as readonly string[]).includes(input.category)) {
        throw new BadRequestException('Pick a category: Skill Training, Physical Training, Recruiting or Mental/Visual.');
      }
      out.category = input.category;
    }
    if (input.description !== undefined) {
      const d = typeof input.description === 'string' ? input.description.trim() : '';
      out.description = d ? d.slice(0, 2000) : null;
    }
    return out;
  }

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
