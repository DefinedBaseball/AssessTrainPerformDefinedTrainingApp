import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { createHash, timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { signJwt, JwtPayload, CoachLevel } from './jwt.util';
import { NotificationsService } from '../notifications/notifications.service';

/** Full payload from the public /register form: profile + credentials. */
export interface SignupPlayerPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  positions: string; // comma-separated, e.g. "INF,OF"
  heightInches?: number | null;
  weightLbs?: number | null;
  gradYear?: number | null;
  bats?: string | null;
  throws?: string | null;
  birthDate?: string | null;
  highSchool?: string | null;
  clubTeam?: string | null;
  collegeCommit?: string | null;
  pbrNational?: number | null;
  pbrState?: number | null;
  pbrPosition?: number | null;
  pgScore?: number | null;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /**
   * Cost factor for bcrypt. 10 is a sound default for the pure-JS bcryptjs
   * (roughly comparable in wall-time to native bcrypt at 12) — expensive
   * enough to make offline cracking impractical without stalling logins on
   * Render's small instances.
   */
  private static readonly BCRYPT_ROUNDS = 10;

  /** Hash a new/changed password with bcrypt — the at-rest format going forward. */
  private hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, AuthService.BCRYPT_ROUNDS);
  }

  /**
   * Verify a plaintext password against a stored hash. Transparently supports
   * BOTH formats:
   *   - bcrypt strings (start with "$2") — the current scheme.
   *   - legacy "salt:sha256(password+salt)" — pre-bcrypt accounts, validated
   *     here (constant-time) so existing logins keep working and can be
   *     upgraded in place on next login.
   */
  private async verifyPassword(password: string, stored: string): Promise<boolean> {
    if (!stored) return false;
    if (stored.startsWith('$2')) return bcrypt.compare(password, stored);
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const attempt = createHash('sha256').update(password + salt).digest('hex');
    const a = Buffer.from(attempt);
    const b = Buffer.from(hash);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** True for the legacy salt:sha256 format → caller should re-hash with bcrypt. */
  private isLegacyHash(stored: string): boolean {
    return !!stored && !stored.startsWith('$2');
  }

  async register(
    actor: JwtPayload,
    rawEmail: string,
    password: string,
    role: 'COACH' | 'PLAYER',
    newCoachLevel?: CoachLevel,
    name?: string,
  ) {
    /* Only ADMIN-level coaches may create COACH accounts. Player creation
       (Add Athlete) stays open to any non-viewer coach — viewers are already
       blocked from this POST by the guard. */
    if (role === 'COACH') {
      const actorLevel = actor.role === 'COACH' ? (actor.coachLevel || 'ADMIN') : null;
      if (actorLevel !== 'ADMIN') {
        throw new ForbiddenException('Only admins can create coach accounts.');
      }
    }

    /* Normalize to lowercase like signupPlayer does — emails are stored
       case-sensitively in the DB, and a mixed-case duplicate (e.g.
       Connor@ vs connor@) creates two near-identical logins. */
    const email = rawEmail?.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const hashed = await this.hashPassword(password);
    // New coaches get an explicit level (default COACH); players carry none.
    const coachLevel = role === 'COACH' ? (newCoachLevel || 'COACH') : null;

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashed,
        role,
        coachLevel,
        name: name?.trim() || null,
      },
      include: { player: true },
    });

    const token = signJwt({
      sub: user.id,
      email: user.email,
      role: user.role as 'COACH' | 'PLAYER',
      coachLevel: user.coachLevel as CoachLevel | null,
      playerId: user.player?.id ?? null,
    });

    return {
      token,
      id: user.id,
      email: user.email,
      role: user.role,
      coachLevel: user.coachLevel ?? null,
      status: user.status,
      name: user.name ?? null,
      playerId: user.player?.id ?? null,
    };
  }

  /**
   * Public self-registration. Creates a PENDING player account + profile in
   * one shot and notifies every coach so they can accept/decline. Returns a
   * normal session so the register page can drop the user straight onto the
   * "waiting for approval" holding screen.
   */
  async signupPlayer(payload: SignupPlayerPayload) {
    const email = payload.email?.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');
    if (!payload.password || payload.password.length < 6)
      throw new BadRequestException('Password must be at least 6 characters');
    if (!payload.firstName?.trim() || !payload.lastName?.trim())
      throw new BadRequestException('First and last name are required');
    if (!payload.positions?.trim())
      throw new BadRequestException('At least one position is required');

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const hashed = await this.hashPassword(payload.password);

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashed,
        role: 'PLAYER',
        status: 'PENDING',
        player: {
          create: {
            firstName: payload.firstName.trim(),
            lastName: payload.lastName.trim(),
            positions: payload.positions,
            heightInches: payload.heightInches ?? null,
            weightLbs: payload.weightLbs ?? null,
            gradYear: payload.gradYear ?? null,
            bats: payload.bats ?? null,
            throws: payload.throws ?? null,
            birthDate: payload.birthDate ?? null,
            highSchool: payload.highSchool ?? null,
            clubTeam: payload.clubTeam ?? null,
            collegeCommit: payload.collegeCommit ?? null,
            pbrNational: payload.pbrNational ?? null,
            pbrState: payload.pbrState ?? null,
            pbrPosition: payload.pbrPosition ?? null,
            pgScore: payload.pgScore ?? null,
          },
        },
      },
      include: { player: true },
    });

    const fullName = `${user.player!.firstName} ${user.player!.lastName}`.trim();
    // Only admins can approve/decline, so only admins are notified.
    await this.notifications.notifyAdmins({
      type: 'ACCOUNT_REQUEST',
      title: 'New player account request',
      body: `${fullName} requested an account and is awaiting approval.`,
      entityId: user.id,
      linkUrl: '/',
    });

    const token = signJwt({
      sub: user.id,
      email: user.email,
      role: 'PLAYER',
      playerId: user.player?.id ?? null,
    });

    return {
      token,
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      playerId: user.player?.id ?? null,
    };
  }

  /** Shared session/profile shape returned by getMe + updateAccount. */
  private meShape(user: any) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      coachLevel: user.coachLevel ?? null,
      status: user.status,
      name: user.name ?? null,
      phone: user.phone ?? null,
      position: user.position ?? null,
      isPrimaryAdmin: user.isPrimaryAdmin ?? false,
      playerId: user.player?.id ?? null,
    };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { player: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return this.meShape(user);
  }

  /** Update editable account fields (Settings → Account). */
  async updateAccount(
    userId: string,
    dto: { name?: string | null; phone?: string | null; position?: string | null; email?: string | null },
  ) {
    const data: { name?: string | null; phone?: string | null; position?: string | null; email?: string } = {};
    if (dto.name !== undefined) data.name = dto.name?.trim() || null;
    if (dto.phone !== undefined) data.phone = dto.phone?.trim() || null;
    if (dto.position !== undefined) data.position = dto.position?.trim() || null;
    // Email is the login username. Only PLAYER accounts may self-change it here:
    // coach emails are how the prod seed keys the seeded admins, so renaming one
    // would let the next deploy re-create a duplicate admin.
    if (dto.email !== undefined) {
      const me = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!me) throw new NotFoundException('User not found');
      if (me.role !== 'PLAYER')
        throw new ForbiddenException('Only player accounts can change their email here.');
      const email = dto.email?.trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        throw new BadRequestException('Enter a valid email address');
      if (email !== me.email) {
        const existing = await this.prisma.user.findUnique({ where: { email } });
        if (existing && existing.id !== userId)
          throw new ConflictException('That email is already in use');
        data.email = email;
      }
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      include: { player: true },
    });
    return this.meShape(user);
  }

  /** Change the current user's password (requires the current one). */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (!newPassword || newPassword.length < 6)
      throw new BadRequestException('New password must be at least 6 characters');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!(await this.verifyPassword(currentPassword || '', user.password)))
      throw new UnauthorizedException('Current password is incorrect');
    const newHash = await this.hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: newHash },
    });
    return { ok: true };
  }

  /** Raw per-subject notification channel matrix (defaults applied client-side). */
  async getNotificationPrefs(userId: string): Promise<Record<string, unknown>> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPrefs: true },
    });
    if (!u?.notificationPrefs) return {};
    try {
      return JSON.parse(u.notificationPrefs);
    } catch {
      return {};
    }
  }

  async setNotificationPrefs(userId: string, prefs: unknown) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { notificationPrefs: JSON.stringify(prefs ?? {}) },
    });
    return { ok: true };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { player: true },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (!(await this.verifyPassword(password, user.password)))
      throw new UnauthorizedException('Invalid credentials');

    // Transparent upgrade: an account still on the legacy SHA-256 hash is
    // re-hashed with bcrypt now that we hold the plaintext. One-time per user,
    // on their next successful login.
    if (this.isLegacyHash(user.password)) {
      const upgraded = await this.hashPassword(password);
      await this.prisma.user.update({ where: { id: user.id }, data: { password: upgraded } });
    }

    const token = signJwt({
      sub: user.id,
      email: user.email,
      role: user.role as 'COACH' | 'PLAYER',
      coachLevel: user.coachLevel as CoachLevel | null,
      playerId: user.player?.id ?? null,
    });

    return {
      token,
      id: user.id,
      email: user.email,
      role: user.role,
      coachLevel: user.coachLevel ?? null,
      status: user.status,
      name: user.name ?? null,
      playerId: user.player?.id ?? null,
    };
  }

  async listCoaches() {
    return this.prisma.user.findMany({
      where: { role: 'COACH' },
      select: { id: true, email: true, name: true, position: true, isPrimaryAdmin: true, coachLevel: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Admin sets another coach's access level (ADMIN / COACH / VIEWER).
   *  The primary admin's level can't be downgraded by anyone else. */
  async setCoachLevel(actorId: string, targetUserId: string, level: CoachLevel) {
    if (!['ADMIN', 'COACH', 'VIEWER'].includes(level))
      throw new BadRequestException('Invalid coach level');
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.role !== 'COACH')
      throw new BadRequestException('Access levels apply to coach accounts only');
    if (target.isPrimaryAdmin && actorId !== target.id)
      throw new ForbiddenException('The primary admin’s level cannot be changed by others');
    await this.prisma.user.update({ where: { id: targetUserId }, data: { coachLevel: level } });
    return { ok: true, coachLevel: level };
  }

  /**
   * Coach sets a new password for another account (player reset from the
   * athlete profile, or coach reset from Settings → Staff). The primary
   * admin's password can only be changed by the primary admin themselves
   * (via this route or the self change-password flow).
   */
  async setUserPassword(actor: JwtPayload, targetUserId: string, newPassword: string) {
    if (!newPassword || newPassword.length < 6)
      throw new BadRequestException('Password must be at least 6 characters');
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');
    // Resetting another COACH's password is an admin action; resetting a
    // PLAYER's password is allowed for any (non-viewer) coach.
    if (target.role === 'COACH' && actor.sub !== target.id) {
      const actorLevel = actor.coachLevel || 'ADMIN';
      if (actorLevel !== 'ADMIN')
        throw new ForbiddenException('Only admins can reset coach passwords');
    }
    if (target.isPrimaryAdmin && actor.sub !== target.id)
      throw new ForbiddenException('Only the primary admin can change their own password');
    const hash = await this.hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { password: hash },
    });
    return { ok: true };
  }

  /**
   * Coach changes another account's LOGIN email (e.g. fixing a typo from the
   * athlete profile). Scoped to PLAYER targets only — coach emails key the
   * prod-seed admins, so they aren't changed via this route. Validates format
   * and enforces uniqueness (lowercased).
   */
  async setUserEmail(targetUserId: string, rawEmail: string) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.role !== 'PLAYER')
      throw new ForbiddenException('Only player account emails can be changed here.');
    const email = rawEmail?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      throw new BadRequestException('Enter a valid email address');
    if (email !== target.email) {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing && existing.id !== targetUserId)
        throw new ConflictException('That email is already in use');
      await this.prisma.user.update({ where: { id: targetUserId }, data: { email } });
    }
    return { ok: true, email };
  }

  /**
   * Set another account's display name. Admins may set anyone's; a non-admin
   * may only set their own (self-edit also flows through updateAccount). Stored
   * on User.name (First Last combined).
   */
  async setUserName(actor: JwtPayload, targetUserId: string, rawName: string) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');
    if (actor.sub !== target.id) {
      const actorLevel = actor.role === 'COACH' ? (actor.coachLevel || 'ADMIN') : null;
      if (actorLevel !== 'ADMIN')
        throw new ForbiddenException('Only admins can edit another account’s name.');
    }
    const name = rawName?.trim() || null;
    await this.prisma.user.update({ where: { id: targetUserId }, data: { name } });
    return { ok: true, name };
  }

  /** Pending player accounts awaiting coach acceptance. */
  async listPending() {
    const users = await this.prisma.user.findMany({
      where: { role: 'PLAYER', status: 'PENDING' },
      select: {
        id: true,
        email: true,
        createdAt: true,
        player: {
          select: { id: true, firstName: true, lastName: true, positions: true, gradYear: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
      playerId: u.player?.id ?? null,
      firstName: u.player?.firstName ?? null,
      lastName: u.player?.lastName ?? null,
      positions: u.player?.positions ?? null,
      gradYear: u.player?.gradYear ?? null,
    }));
  }

  /** Accept a pending player → ACTIVE (idempotent). */
  async approvePlayer(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== 'PENDING') return { ok: true, status: user.status };
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
    // Resolve the request → drop it from every coach's bell.
    await this.notifications.clearAccountRequest(userId);
    return { ok: true, status: 'ACTIVE' };
  }

  /**
   * Decline a pending player: delete the account entirely (frees the email
   * for retry). Safe because a pending player was gated out and has no
   * dependent records; notifications addressed to them are removed first.
   */
  async declinePlayer(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { player: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== 'PENDING') throw new ConflictException('Only pending accounts can be declined');

    await this.prisma.$transaction(async (tx) => {
      await tx.notification.deleteMany({ where: { recipientId: userId } });
      if (user.player) await tx.player.delete({ where: { id: user.player.id } });
      await tx.user.delete({ where: { id: userId } });
    });
    // Resolve the request → drop it from every coach's bell.
    await this.notifications.clearAccountRequest(userId);
    return { ok: true };
  }
}
