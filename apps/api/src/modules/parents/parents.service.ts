import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';

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

const norm = (e: string | null | undefined) => (e || '').trim().toLowerCase();

/** Parents see a matched athlete as "John S." until an admin allows the
 *  link -- nobody has checked yet that they own the email they signed up
 *  with, so a full name would leak to whoever typed it. */
const shortName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName ? p.lastName[0] + '.' : ''}`.trim();

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
    private notifications: NotificationsService,
  ) {}

  private shape(parent: {
    id: string; firstName: string; lastName: string; birthDate: string | null; hometown: string | null;
    user: { email: string; phone: string | null };
    links: { player: { id: string; firstName: string; lastName: string; gradYear: number | null; positions: string; profilePhoto: string | null } }[];
    linkRequests: { id: string; player: { firstName: string; lastName: string; gradYear: number | null } }[];
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
      /* Link Athlete requests still waiting on an admin. */
      pendingRequests: parent.linkRequests.map((r) => ({
        id: r.id,
        name: shortName(r.player),
        gradYear: r.player.gradYear,
      })),
    };
  }

  private include = {
    user: { select: { email: true, phone: true } },
    links: { include: { player: { select: ATHLETE_SELECT } } },
    linkRequests: {
      where: { status: 'PENDING' },
      include: { player: { select: { firstName: true, lastName: true, gradYear: true } } },
      orderBy: { createdAt: 'asc' as const },
    },
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

  /* ── Public: a parent creates their own account ─────────────────── */

  /** Self sign-up from the login page ("Create an account" -> Parent). The
   *  account is ACTIVE straight away: on its own it sees only its own
   *  profile. Athletes are added later through Link Athlete + admin OK. */
  async signup(dto: { firstName?: unknown; lastName?: unknown; email?: unknown; phone?: unknown; password?: unknown }) {
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const firstName = str(dto.firstName, 80);
    const lastName = str(dto.lastName, 80);
    const email = norm(typeof dto.email === 'string' ? dto.email : '');
    if (!firstName || !lastName) throw new BadRequestException('First and last name are required');
    if (!email || !EMAIL_RE.test(email)) throw new BadRequestException('Enter a valid email address');
    const password = typeof dto.password === 'string' ? dto.password : '';
    if (!password.trim()) throw new BadRequestException('Create Password to Continue');
    const hashed = await this.auth.hashNewPassword(password);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with this email already exists. Sign in instead.');

    await this.prisma.user.create({
      data: {
        email,
        password: hashed,
        role: 'PARENT',
        name: `${firstName} ${lastName}`,
        phone: str(dto.phone, 40) || null,
        parent: { create: { firstName, lastName } },
      },
    });
    return { ok: true };
  }

  /* ── Parent: Link Athlete ────────────────────────────────────────── */

  /** Athletes whose Parent Email is this parent's login email, minus any
   *  already linked or already requested (a denied request isn't re-offered;
   *  a coach can still link them by hand). Matched in code, not SQL, so the
   *  comparison ignores case on SQLite too. */
  private async candidatesFor(userId: string) {
    const parent = await this.prisma.parent.findUnique({
      where: { userId },
      include: { user: { select: { email: true } }, links: true, linkRequests: true },
    });
    if (!parent) throw new NotFoundException('Parent profile not found');
    const email = norm(parent.user.email);
    const taken = new Set([...parent.links.map((l) => l.playerId), ...parent.linkRequests.map((r) => r.playerId)]);
    const players = await this.prisma.player.findMany({
      where: { parentEmail: { not: null } },
      select: { id: true, firstName: true, lastName: true, gradYear: true, parentEmail: true },
    });
    return {
      parent,
      players: players.filter((p) => norm(p.parentEmail) === email && !taken.has(p.id)),
    };
  }

  async linkCandidates(userId: string) {
    const { players } = await this.candidatesFor(userId);
    return players
      .map((p) => ({ id: p.id, name: shortName(p), gradYear: p.gradYear }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Request links to some of the candidates; each becomes an Allow/Deny
   *  item in every admin's bell. Only real candidates are accepted, so a
   *  parent can never ask for an athlete that doesn't list their email. */
  async requestLinks(userId: string, playerIds: unknown) {
    const ids = Array.isArray(playerIds) ? playerIds.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];
    if (ids.length === 0) throw new BadRequestException('Pick at least one athlete');
    const { parent, players } = await this.candidatesFor(userId);
    const allowed = new Map(players.map((p) => [p.id, p]));
    const chosen = ids.filter((id) => allowed.has(id));
    if (chosen.length === 0) throw new BadRequestException('Those athletes can’t be linked to this account.');

    const parentName = `${parent.firstName} ${parent.lastName}`.trim();
    for (const id of chosen) {
      const p = allowed.get(id)!;
      const req = await this.prisma.parentLinkRequest.create({ data: { parentId: parent.id, playerId: id } });
      await this.notifications.notifyAdmins({
        type: 'PARENT_LINK_REQUEST',
        title: 'Parent link request',
        body: `${parentName} (${parent.user.email}) asked to be linked to ${p.firstName} ${p.lastName}. The athlete’s profile lists this email as Parent Email.`,
        entityId: req.id,
        linkUrl: `/athletes/${id}`,
      });
    }
    return this.getMine(userId);
  }

  /* ── Admin: allow / deny a link request (from the bell) ─────────── */

  async decideLinkRequest(requestId: string, allow: boolean) {
    const req = await this.prisma.parentLinkRequest.findUnique({ where: { id: requestId } });
    if (!req) {
      await this.notifications.clearParentLinkRequest(requestId);
      throw new NotFoundException('That request no longer exists');
    }
    if (req.status === 'PENDING') {
      await this.prisma.$transaction(async (tx) => {
        if (allow) {
          await tx.parentLink.upsert({
            where: { parentId_playerId: { parentId: req.parentId, playerId: req.playerId } },
            create: { parentId: req.parentId, playerId: req.playerId },
            update: {},
          });
        }
        await tx.parentLinkRequest.update({
          where: { id: req.id },
          data: { status: allow ? 'APPROVED' : 'DENIED', decidedAt: new Date() },
        });
      });
    }
    await this.notifications.clearParentLinkRequest(requestId);
    return { ok: true, status: allow ? 'APPROVED' : 'DENIED' };
  }

  /* ── Coach: parent logins on an athlete ──────────────────────────── */

  /** Other athletes whose Parent Email matches `email` and aren't linked to
   *  that parent login yet -- the "also link?" list after creating one. */
  async matchingAthletes(email: unknown, excludePlayerId?: unknown) {
    const e = norm(typeof email === 'string' ? email : '');
    if (!e) return [];
    const existing = await this.prisma.user.findUnique({ where: { email: e }, include: { parent: { include: { links: true } } } });
    const linked = new Set((existing?.parent?.links ?? []).map((l) => l.playerId));
    const players = await this.prisma.player.findMany({
      where: { parentEmail: { not: null } },
      select: { id: true, firstName: true, lastName: true, gradYear: true, parentEmail: true },
    });
    return players
      .filter((p) => norm(p.parentEmail) === e && !linked.has(p.id) && p.id !== excludePlayerId)
      .map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, gradYear: p.gradYear }))
      .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
  }

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
      /* A coach linking by hand also settles any pending request for it. */
      const pending = await this.prisma.parentLinkRequest.findUnique({
        where: { parentId_playerId: { parentId: existing.parent.id, playerId } },
      });
      if (pending?.status === 'PENDING') {
        await this.prisma.parentLinkRequest.update({ where: { id: pending.id }, data: { status: 'APPROVED', decidedAt: new Date() } });
        await this.notifications.clearParentLinkRequest(pending.id);
      }
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
