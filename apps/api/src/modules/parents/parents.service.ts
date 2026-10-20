import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

/** What a parent (or a coach looking at one) sees about a linked athlete. */
const ATHLETE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  gradYear: true,
  positions: true,
  profilePhoto: true,
} as const;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Parent logins (first pass): a coach creates one from the parent email on
 * an athlete's profile plus a password; the parent signs in to their own
 * profile page listing the athletes linked to them. Parents can edit their
 * own details only -- never their email, and never any athlete data.
 */
@Injectable()
export class ParentsService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
  ) {}

  private shape(parent: {
    id: string; firstName: string; lastName: string; birthDate: string | null; hometown: string | null;
    user: { email: string; phone: string | null };
    links: { player: { id: string; firstName: string; lastName: string; gradYear: number | null; positions: string; profilePhoto: string | null } }[];
  }) {
    return {
      id: parent.id,
      firstName: parent.firstName,
      lastName: parent.lastName,
      email: parent.user.email,
      phone: parent.user.phone,
      birthDate: parent.birthDate,
      hometown: parent.hometown,
      athletes: parent.links
        .map((l) => l.player)
        .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
    };
  }

  private include = {
    user: { select: { email: true, phone: true } },
    links: { include: { player: { select: ATHLETE_SELECT } } },
  } as const;

  /* ── Parent: own profile ─────────────────────────────────────────── */

  async getMine(userId: string) {
    const parent = await this.prisma.parent.findUnique({ where: { userId }, include: this.include });
    if (!parent) throw new NotFoundException('Parent profile not found');
    return this.shape(parent);
  }

  /** Named fields only -- the parent's own details. Email is the login and
   *  stays with the coach; athlete links are never touched here. */
  async updateMine(userId: string, dto: {
    firstName?: unknown; lastName?: unknown; phone?: unknown; birthDate?: unknown; hometown?: unknown;
  }) {
    const parent = await this.prisma.parent.findUnique({ where: { userId } });
    if (!parent) throw new NotFoundException('Parent profile not found');
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

    const data: { firstName?: string; lastName?: string; birthDate?: string | null; hometown?: string | null } = {};
    const first = str(dto.firstName, 80);
    const last = str(dto.lastName, 80);
    if (dto.firstName !== undefined) {
      if (!first) throw new BadRequestException('First name is required');
      data.firstName = first;
    }
    if (dto.lastName !== undefined) {
      if (!last) throw new BadRequestException('Last name is required');
      data.lastName = last;
    }
    if (dto.birthDate !== undefined) {
      const b = str(dto.birthDate, 10) || null;
      if (b && !/^\d{4}-\d{2}-\d{2}$/.test(b)) throw new BadRequestException('Birthday must be a date');
      data.birthDate = b;
    }
    if (dto.hometown !== undefined) data.hometown = str(dto.hometown, 120) || null;

    await this.prisma.$transaction(async (tx) => {
      await tx.parent.update({ where: { id: parent.id }, data });
      if (dto.phone !== undefined) {
        await tx.user.update({ where: { id: userId }, data: { phone: str(dto.phone, 40) || null } });
      }
    });
    return this.getMine(userId);
  }

  /* ── Coach: parent logins on an athlete ──────────────────────────── */

  async listForPlayer(playerId: string) {
    const links = await this.prisma.parentLink.findMany({
      where: { playerId },
      include: { parent: { include: { user: { select: { email: true, phone: true, lastLoginAt: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    return links.map((l) => ({
      id: l.parent.id,
      firstName: l.parent.firstName,
      lastName: l.parent.lastName,
      email: l.parent.user.email,
      phone: l.parent.user.phone,
      hasSignedIn: !!l.parent.user.lastLoginAt,
    }));
  }

  /**
   * Create a parent login for an athlete, or link an existing one. If a
   * parent login with that email already exists (a sibling's parent), the
   * athlete is simply added to it -- the password is NOT changed. An email
   * that belongs to a coach or athlete login is refused.
   */
  async createOrLink(dto: { playerId?: unknown; email?: unknown; password?: unknown; firstName?: unknown; lastName?: unknown }) {
    const playerId = typeof dto.playerId === 'string' ? dto.playerId : '';
    const email = typeof dto.email === 'string' ? dto.email.trim().toLowerCase() : '';
    if (!playerId) throw new BadRequestException('Athlete is required');
    if (!email || !EMAIL_RE.test(email)) throw new BadRequestException('Enter a valid parent email');

    const player = await this.prisma.player.findUnique({ where: { id: playerId }, select: { id: true, lastName: true } });
    if (!player) throw new NotFoundException('Athlete not found');

    const existing = await this.prisma.user.findUnique({ where: { email }, include: { parent: true } });
    if (existing) {
      if (existing.role !== 'PARENT' || !existing.parent) {
        throw new ConflictException('That email already belongs to a coach or athlete login.');
      }
      await this.prisma.parentLink.upsert({
        where: { parentId_playerId: { parentId: existing.parent.id, playerId } },
        create: { parentId: existing.parent.id, playerId },
        update: {},
      });
      return { linked: true, created: false, parents: await this.listForPlayer(playerId) };
    }

    const password = typeof dto.password === 'string' ? dto.password : '';
    if (!password.trim()) throw new BadRequestException('Create a password for the parent');
    const hashed = await this.auth.hashNewPassword(password);
    const firstName = (typeof dto.firstName === 'string' ? dto.firstName.trim() : '').slice(0, 80) || 'Parent';
    const lastName = (typeof dto.lastName === 'string' ? dto.lastName.trim() : '').slice(0, 80) || player.lastName;

    await this.prisma.user.create({
      data: {
        email,
        password: hashed,
        role: 'PARENT',
        name: `${firstName} ${lastName}`.trim(),
        parent: {
          create: {
            firstName,
            lastName,
            links: { create: { playerId } },
          },
        },
      },
    });
    return { linked: true, created: true, parents: await this.listForPlayer(playerId) };
  }

  /** Remove one athlete from a parent login (the login itself stays). */
  async unlink(parentId: string, playerId: string) {
    const link = await this.prisma.parentLink.findUnique({ where: { parentId_playerId: { parentId, playerId } } });
    if (!link) throw new NotFoundException('That parent is not linked to this athlete');
    await this.prisma.parentLink.delete({ where: { id: link.id } });
    return { ok: true, parents: await this.listForPlayer(playerId) };
  }
}
