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

  async getMlbPlayers(position?: string, bats?: string, throws_?: string) {
    const players = await this.prisma.mlbPlayer.findMany({
      // title + url included so the Compare picker (Video Bundle modal)
      // can browse & play MLB clips straight from the players list.
      // Ordered newest-first to match the player detail page (getMlbPlayer
      // uses createdAt desc), so the card's cover-photo fallback shows the
      // SAME "first video" the user sees in that player's videos section.
      include: { videos: { select: { id: true, title: true, category: true, url: true }, orderBy: { createdAt: 'desc' } } },
      orderBy: { name: 'asc' },
    });
    return players.filter(p => {
      if (position && position !== 'all' && !p.positions.includes(position)) return false;
      if (bats && bats !== 'all' && p.bats !== bats) return false;
      if (throws_ && throws_ !== 'all' && p.throws !== throws_) return false;
      return true;
    });
  }

  async getMlbPlayer(id: string) {
    const player = await this.prisma.mlbPlayer.findUnique({
      where: { id },
      include: { videos: { orderBy: { createdAt: 'desc' } } },
    });
    if (!player) throw new NotFoundException('MLB player not found');
    return player;
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
