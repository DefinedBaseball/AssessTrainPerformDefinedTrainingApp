import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GamesService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    playerId: string;
    gameDate: Date;
    opponent?: string;
    stats?: string;
    journal?: string;
    videoIds?: string;
    season?: string;
  }) {
    return this.prisma.gameReport.create({ data });
  }

  async findByPlayer(playerId: string, season?: string) {
    return this.prisma.gameReport.findMany({
      where: { playerId, ...(season ? { season } : {}) },
      orderBy: { gameDate: 'desc' },
    });
  }

  async findOne(id: string) {
    const game = await this.prisma.gameReport.findUnique({ where: { id } });
    if (!game) throw new NotFoundException('Game report not found');
    return game;
  }

  async update(id: string, data: {
    opponent?: string;
    stats?: string;
    journal?: string;
    videoIds?: string;
  }) {
    return this.prisma.gameReport.update({ where: { id }, data });
  }
}
