import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClubTeamsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.clubTeam.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const team = await this.prisma.clubTeam.findUnique({ where: { id } });
    if (!team) throw new NotFoundException('Club team not found');
    return team;
  }

  create(data: { name: string; logoUrl?: string | null; websiteUrl?: string | null }) {
    return this.prisma.clubTeam.create({ data });
  }

  update(id: string, data: { name?: string; logoUrl?: string | null; websiteUrl?: string | null }) {
    return this.prisma.clubTeam.update({ where: { id }, data });
  }

  remove(id: string) {
    return this.prisma.clubTeam.delete({ where: { id } });
  }
}
