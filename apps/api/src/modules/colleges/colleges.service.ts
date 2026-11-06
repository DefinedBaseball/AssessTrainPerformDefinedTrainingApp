import { Injectable, NotFoundException } from '@nestjs/common';
import type { College } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/* A logo uploaded in Settings is stored on the record as a base64 data URL.
   Sent inline, every logo rode along in the college list that loads with
   every athlete profile (~60 KB each, so 40 logos = ~2.4 MB a profile).
   The list now carries a short versioned link instead, and the image is
   served (and cached by the browser) from GET /colleges/:id/logo. Logos
   given as a plain web address are passed through unchanged. */
const DATA_URL = /^data:(image\/(?:png|jpe?g|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/i;

@Injectable()
export class CollegesService {
  constructor(private prisma: PrismaService) {}

  /** Path the app uses for a stored logo (version = last edit, so a new
   *  logo is a new URL and the long browser cache never goes stale). */
  private logoPath(c: Pick<College, 'id' | 'updatedAt'>): string {
    return `/api/colleges/${c.id}/logo?v=${c.updatedAt.getTime()}`;
  }

  private present(c: College): College {
    return c.logoUrl && DATA_URL.test(c.logoUrl) ? { ...c, logoUrl: this.logoPath(c) } : c;
  }

  /** Settings' edit form sends the logo field back as it received it -- our
   *  own link -- when the coach didn't change it: keep the stored image. */
  private withoutEchoedLogo<T extends { logoUrl?: string | null }>(data: T): T {
    if (typeof data.logoUrl === 'string' && data.logoUrl.startsWith('/api/colleges/')) {
      const rest = { ...data };
      delete rest.logoUrl;
      return rest;
    }
    return data;
  }

  async findAll() {
    const rows = await this.prisma.college.findMany({ orderBy: { name: 'asc' } });
    return rows.map((c) => this.present(c));
  }

  async findOne(id: string) {
    const college = await this.prisma.college.findUnique({ where: { id } });
    if (!college) throw new NotFoundException('College not found');
    return this.present(college);
  }

  /** The stored logo image itself, for GET /colleges/:id/logo. */
  async getLogo(id: string): Promise<{ mime: string; data: Buffer }> {
    const college = await this.prisma.college.findUnique({ where: { id }, select: { logoUrl: true } });
    const m = college?.logoUrl?.match(DATA_URL);
    if (!m) throw new NotFoundException('No logo');
    return { mime: m[1].toLowerCase().replace('image/jpg', 'image/jpeg'), data: Buffer.from(m[2].replace(/\s+/g, ''), 'base64') };
  }

  async create(data: { name: string; logoUrl?: string | null; websiteUrl?: string | null; division?: string | null }) {
    return this.present(await this.prisma.college.create({ data: this.withoutEchoedLogo(data) }));
  }

  async update(id: string, data: { name?: string; logoUrl?: string | null; websiteUrl?: string | null; division?: string | null }) {
    return this.present(await this.prisma.college.update({ where: { id }, data: this.withoutEchoedLogo(data) }));
  }

  remove(id: string) {
    return this.prisma.college.delete({ where: { id } });
  }
}
