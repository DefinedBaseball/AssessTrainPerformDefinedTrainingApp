import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CollegesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.college.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const college = await this.prisma.college.findUnique({ where: { id } });
    if (!college) throw new NotFoundException('College not found');
    return college;
  }

  create(data: { name: string; logoUrl?: string | null; websiteUrl?: string | null }) {
    return this.prisma.college.create({ data });
  }

  update(id: string, data: { name?: string; logoUrl?: string | null; websiteUrl?: string | null }) {
    return this.prisma.college.update({ where: { id }, data });
  }

  remove(id: string) {
    return this.prisma.college.delete({ where: { id } });
  }
}
