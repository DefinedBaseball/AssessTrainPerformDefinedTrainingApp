import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { createHash, timingSafeEqual, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { signJwt, JwtPayload, CoachLevel } from './jwt.util';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { AcademyService } from '../academy/academy.service';

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
  /** Lives on the User row, not Player -- set after the nested create. */
  phone?: string | null;
  /** From a coach-sent registration link (?invite=); opens sign-up while closed. */
  inviteCode?: string | null;
  parentEmail?: string | null;
  parentPhone?: string | null;
  college?: string | null;
  professionalTeam?: string | null;
  playingLevelGoal?: string | null;
  goals?: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private mail: MailService,
    private academy: AcademyService,
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
    /* Coach-created accounts (+ Add Athlete, Settings -> Staff, Inquiry
       conversion) had no password check here at all, so a blank one was
       hashed and stored as a real credential. Same rule and wording as
       the forms, so the message reads the same if a client ever skips
       its own check. */
    if (!password || !password.trim()) throw new BadRequestException('Create Password to Continue');
    if (password.length < AuthService.MIN_PASSWORD) throw new BadRequestException(`Password must be at least ${AuthService.MIN_PASSWORD} characters`);
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
    /* Closed to new athletes (Settings → Academy) unless the link a coach
       emailed carries the invite code. */
    await this.academy.assertAccepting(payload.inviteCode);
    const email = payload.email?.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');
    if (!payload.password || !payload.password.trim())
      throw new BadRequestException('Create Password to Continue');
    if (payload.password.length < AuthService.MIN_PASSWORD)
      throw new BadRequestException(`Password must be at least ${AuthService.MIN_PASSWORD} characters`);
    if (!payload.firstName?.trim() || !payload.lastName?.trim())
      throw new BadRequestException('First and last name are required');
    if (!payload.positions?.trim())
      throw new BadRequestException('At least one position is required');

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const hashed = await this.hashPassword(payload.password);

    /* Blank optional text arrives as '' from the form; store null so an
       untouched field reads as "not provided" rather than an empty string
       that the Client Directory would render as a real, empty value. */
    const str = (v?: string | null) => {
      const t = v?.trim();
      return t ? t : null;
    };

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashed,
        role: 'PLAYER',
        status: 'PENDING',
        phone: str(payload.phone),
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
            parentEmail: str(payload.parentEmail),
            parentPhone: str(payload.parentPhone),
            college: str(payload.college),
            professionalTeam: str(payload.professionalTeam),
            playingLevelGoal: str(payload.playingLevelGoal),
            goals: str(payload.goals),
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
    // Email is the login username; anyone may change their own. (The prod
    // seed used to key the starter admins by email and would re-create one
    // after a rename -- it now only runs on an empty database.)
    if (dto.email !== undefined) {
      const me = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!me) throw new NotFoundException('User not found');
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
    if (!newPassword || newPassword.length < AuthService.MIN_PASSWORD)
      throw new BadRequestException(`New password must be at least ${AuthService.MIN_PASSWORD} characters`);
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

  /** SHA-256 of a reset token. Only the hash is persisted — the raw token
   *  lives only in the emailed link, so a DB leak yields no usable links. */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Begin the forgot-password flow. ALWAYS returns { ok: true } and swallows
   * every error, so the response is identical whether or not the email maps to
   * an account — no user enumeration. On a real ACTIVE match we mint a
   * single-use token (raw value emailed, hash stored, 1-hour expiry) and send
   * the reset link. Pending/declined players can't log in, so they don't reset.
   */
  async requestPasswordReset(rawEmail: string): Promise<{ ok: true }> {
    const email = rawEmail?.trim().toLowerCase();
    if (!email) return { ok: true };
    try {
      const user = await this.prisma.user.findUnique({ where: { email } });
      if (user && user.status === 'ACTIVE') {
        // Drop any prior outstanding tokens so only the newest link works.
        await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
        const token = randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await this.prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash: this.hashToken(token), expiresAt },
        });
        const resetUrl = `${this.mail.webAppUrl}/reset-password?token=${token}`;
        await this.mail.sendTemplate('PASSWORD_RESET', user.email, { name: user.name, url: resetUrl });
      }
    } catch {
      // Deliberately swallowed — the caller's response must not reveal outcome.
    }
    return { ok: true };
  }

  /** How long a coach-issued invite link stays valid. Far longer than the
   *  1-hour forgot-password window: an invite is onboarding mail that may sit
   *  unread over a weekend, and the recipient has no password to fall back on
   *  if it lapses. Still bounded, and still single-use. */
  private static readonly INVITE_TTL_DAYS = 7;

  /** Minimum length for any NEW password (existing ones keep working). */
  static readonly MIN_PASSWORD = 8;

  /**
   * Issue a set-password link for an account a COACH created on someone's
   * behalf (converting an inquiry into a player profile). The coach sets the
   * account's password at creation; this only adds a separate single-use
   * token so the athlete can choose their own. It never changes the stored
   * password.
   *
   * Unlike `requestPasswordReset` this is NOT anonymous-safe by design — it's
   * coach-only and reports real failures, because the coach needs to know if
   * the invite didn't go out. A missing mail provider is surfaced rather than
   * swallowed for the same reason.
   */
  async sendInvite(rawEmail: string, name?: string | null, kind: 'athlete' | 'coach' = 'athlete'): Promise<{ ok: boolean; emailed: boolean }> {
    const email = rawEmail?.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('No account found for that email');

    // Only the newest invite should work, same rule as password reset.
    await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + AuthService.INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: this.hashToken(token), expiresAt },
    });

    /* Mail is config-gated (same pattern as Bunny) — if RESEND_API_KEY isn't
       set the send is a no-op. Report that back instead of implying the
       athlete was emailed, so the coach knows to share the link another way. */
    const setPasswordUrl = `${this.mail.webAppUrl}/reset-password?token=${token}`;
    let emailed = false;
    try {
      /* send() RETURNS false when Resend isn't configured or the send fails —
         it doesn't throw. Trusting the absence of an exception would report
         "we emailed them" every time, including on a box with no mail set up
         at all, which is the one thing this flag exists to prevent. */
      emailed = await this.mail.sendTemplate(kind === 'coach' ? 'COACH_INVITE' : 'ATHLETE_INVITE', user.email, {
        name,
        url: setPasswordUrl,
        expiryDays: AuthService.INVITE_TTL_DAYS,
      });
    } catch (err) {
      this.logger.warn(`Invite email failed for ${user.email}: ${err}`);
    }
    if (!emailed) {
      this.logger.warn(`Invite link issued for ${user.email} but no email was sent`);
    }
    return { ok: true, emailed };
  }

  /**
   * Email someone who has NO account a link to the public registration form.
   *
   * Coach-only and, like sendInvite, reports real failures rather than being
   * anonymous-safe: the coach needs to know whether it actually went out.
   *
   * Refuses an address that already has an account -- sending that person to
   * the Create an Account form would only dead-end at "Email already
   * registered", and the coach would never know why nothing happened.
   */
  async sendRegistrationInvite(rawEmail: string): Promise<{ ok: boolean; emailed: boolean; to: string }> {
    const to = rawEmail?.trim().toLowerCase();
    if (!to) throw new BadRequestException('Email is required');
    if (!/^[^@s]+@[^@s]+.[^@s]+$/.test(to))
      throw new BadRequestException('Enter a valid email address');

    const existing = await this.prisma.user.findUnique({ where: { email: to } });
    if (existing) {
      throw new ConflictException(
        'That email already has an account. Use the reminder button on their profile instead.',
      );
    }

    /* The code lets this link open the sign-up form even while new athletes
       are switched off in Settings → Academy. */
    const registerUrl = `${this.mail.webAppUrl}/register?invite=${this.academy.registrationInviteCode()}`;
    let emailed = false;
    try {
      /* send() returns false when Resend is unconfigured or the send fails --
         it does not throw -- so this flag, not the absence of an exception,
         is what tells the coach the invite actually left. */
      emailed = await this.mail.sendTemplate('REGISTRATION_INVITE', to, { url: registerUrl });
    } catch (err) {
      this.logger.warn(`Registration invite failed for ${to}: ${err}`);
    }
    return { ok: true, emailed, to };
  }

  /**
   * Complete the flow: validate the token, set the new password, and burn
   * every reset token for that user. Any invalid / expired / already-used
   * token yields the same generic error (no leak about which condition failed).
   */
  async resetPassword(token: string, newPassword: string): Promise<{ ok: true }> {
    if (!newPassword || newPassword.length < AuthService.MIN_PASSWORD)
      throw new BadRequestException(`New password must be at least ${AuthService.MIN_PASSWORD} characters`);
    if (!token) throw new BadRequestException('This reset link is invalid or has expired.');
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now())
      throw new BadRequestException('This reset link is invalid or has expired.');
    const hash = await this.hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: row.userId }, data: { password: hash } }),
      // Burn all of this user's tokens (the one just used + any stragglers).
      this.prisma.passwordResetToken.deleteMany({ where: { userId: row.userId } }),
    ]);
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

  /* ── Sign out of all devices ─────────────────────────────────────────
     Moves the account's cut-off to now: every token issued before it --
     including the caller's own -- stops working on its next request. */
  async signOutEverywhere(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { sessionsValidAfter: new Date() } });
    return { ok: true };
  }

  /** A coach signs an athlete out everywhere (e.g. a lost phone). Coach
   *  accounts are signed out by an admin or by themselves. */
  async signOutUserEverywhere(actor: JwtPayload, targetUserId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, role: true, isPrimaryAdmin: true } });
    if (!target) throw new NotFoundException('User not found');
    if (target.role === 'COACH' && actor.sub !== target.id) {
      const actorLevel = actor.role === 'COACH' ? (actor.coachLevel || 'ADMIN') : null;
      if (actorLevel !== 'ADMIN' || target.isPrimaryAdmin)
        throw new ForbiddenException('Only admins can sign out another coach.');
    }
    return this.signOutEverywhere(target.id);
  }

  /* ── Coach accounts (Settings → Staff, admin only) ─────────────────── */

  private async assertManageableCoach(actor: JwtPayload, targetUserId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('Coach not found');
    if (target.role !== 'COACH') throw new BadRequestException('That is not a coach account.');
    if (target.id === actor.sub) throw new ForbiddenException('You can’t pause or remove your own account.');
    if (target.isPrimaryAdmin) throw new ForbiddenException('The primary admin can’t be paused or removed.');
    return target;
  }

  /** Pause (LOCKED) or restore (ACTIVE) a coach. Paused coaches can't sign
   *  in and are refused on their next request; nothing they made changes. */
  async setCoachStatus(actor: JwtPayload, targetUserId: string, status: string) {
    if (status !== 'ACTIVE' && status !== 'LOCKED') throw new BadRequestException('Status must be ACTIVE or LOCKED');
    await this.assertManageableCoach(actor, targetUserId);
    await this.prisma.user.update({ where: { id: targetUserId }, data: { status } });
    return { ok: true, status };
  }

  /**
   * Permanently delete a coach account and what is theirs alone: their
   * posts, messages and notifications. Athletes' records are NOT deleted:
   * reports they wrote stay on the athlete (the coach name is cleared), and
   * live at-bat sessions they ran move to the admin doing the deletion so
   * the athletes' at-bat history survives.
   */
  async deleteCoach(actor: JwtPayload, targetUserId: string) {
    const target = await this.assertManageableCoach(actor, targetUserId);
    await this.prisma.$transaction(async (tx) => {
      await tx.liveSession.updateMany({ where: { createdById: target.id }, data: { createdById: actor.sub } });
      await tx.notification.deleteMany({ where: { recipientId: target.id } });
      await tx.message.deleteMany({ where: { OR: [{ senderId: target.id }, { recipientId: target.id }] } });
      await tx.postSeen.deleteMany({ where: { userId: target.id } });
      await tx.post.deleteMany({ where: { authorId: target.id } });
      await tx.user.delete({ where: { id: target.id } });
      /* Their To Do assignments went with them (cascade); a task that was
         theirs alone now belongs to no one, so drop it. */
      await tx.coachTask.deleteMany({ where: { allCoaches: false, assignees: { none: {} } } });
    });
    return { ok: true, deleted: target.email };
  }

  /** Create a coach account with no usable password and email them a
   *  set-password link (the "Invite by email" option in Staff). */
  async inviteCoach(actor: JwtPayload, dto: { email?: string; name?: string | null; coachLevel?: CoachLevel }) {
    const actorLevel = actor.role === 'COACH' ? (actor.coachLevel || 'ADMIN') : null;
    if (actorLevel !== 'ADMIN') throw new ForbiddenException('Only admins can invite coaches.');
    const email = dto.email?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('Enter a valid email address');
    const level = dto.coachLevel && ['ADMIN', 'COACH', 'VIEWER'].includes(dto.coachLevel) ? dto.coachLevel : 'COACH';
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('Email already registered');
    const name = dto.name?.trim() || null;
    /* A random password nobody knows -- the invite link is the way in. */
    await this.prisma.user.create({
      data: {
        email,
        password: await this.hashPassword(randomBytes(24).toString('hex')),
        role: 'COACH',
        coachLevel: level,
        status: 'ACTIVE',
        name,
      },
    });
    const { emailed } = await this.sendInvite(email, name, 'coach');
    return { ok: true, emailed, email, coachLevel: level };
  }

  /* Wrong-password limit PER ACCOUNT, on top of the per-visitor request
     limit: 10 misses in 15 minutes locks that email out for the rest of the
     window, however many addresses the guesses come from. Counted for
     unknown emails too, so the reply never reveals which emails exist.
     In memory -- the API runs as a single instance. */
  private static readonly MAX_FAILED_LOGINS = 10;
  private static readonly FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
  private readonly failedLogins = new Map<string, { count: number; first: number }>();

  private assertNotLockedOut(key: string) {
    const f = this.failedLogins.get(key);
    if (!f) return;
    if (Date.now() - f.first >= AuthService.FAILED_LOGIN_WINDOW_MS) {
      this.failedLogins.delete(key);
      return;
    }
    if (f.count >= AuthService.MAX_FAILED_LOGINS) {
      throw new HttpException(
        'Too many wrong passwords for this account. Try again in 15 minutes, or use "Forgot password?".',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private recordFailedLogin(key: string) {
    const now = Date.now();
    if (this.failedLogins.size > 5000) {
      for (const [k, v] of this.failedLogins) {
        if (now - v.first >= AuthService.FAILED_LOGIN_WINDOW_MS) this.failedLogins.delete(k);
      }
    }
    const f = this.failedLogins.get(key);
    if (!f || now - f.first >= AuthService.FAILED_LOGIN_WINDOW_MS) this.failedLogins.set(key, { count: 1, first: now });
    else f.count += 1;
  }

  async login(email: string, password: string) {
    const attemptKey = (email || '').trim().toLowerCase();
    this.assertNotLockedOut(attemptKey);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { player: true },
    });
    if (!user) {
      this.recordFailedLogin(attemptKey);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!(await this.verifyPassword(password, user.password))) {
      this.recordFailedLogin(attemptKey);
      throw new UnauthorizedException('Invalid credentials');
    }
    this.failedLogins.delete(attemptKey);

    /* Refuse a non-ACTIVE account HERE, not just at the guard.
    
       Login used to hand out a token regardless of status, so a locked (or
       still-pending) athlete signed in "successfully" and then had every
       subsequent request rejected — they land in the app shell watching
       everything fail instead of being told why. The credentials are already
       verified at this point, so naming the actual reason leaks nothing they
       do not own. */
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        user.status === 'LOCKED'
          ? (user.role === 'COACH' ? 'Your account is paused. Contact your admin.' : 'Your account is paused. Contact your coach.')
          : user.status === 'PENDING'
            ? 'Your account is awaiting coach approval.'
            : 'This account is not active.',
      );
    }

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
      select: { id: true, email: true, name: true, position: true, isPrimaryAdmin: true, coachLevel: true, status: true, createdAt: true },
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
    if (!newPassword || newPassword.length < AuthService.MIN_PASSWORD)
      throw new BadRequestException(`Password must be at least ${AuthService.MIN_PASSWORD} characters`);
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
  /**
   * Set another account's phone. Coaches edit an athlete's contact number
   * from the Edit Profile form; `updateAccount` only ever touches the
   * CALLER's row, so without this there was no path to it.
   *
   * Scoped to PLAYER targets for the same reason as setUserEmail: this is
   * reached from an athlete form, and a coach should not be able to rewrite
   * another coach's contact details through it.
   */
  async setUserPhone(targetUserId: string, rawPhone: string | null) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.role !== 'PLAYER')
      throw new ForbiddenException('Only player account phone numbers can be changed here.');
    const phone = (rawPhone ?? '').trim() || null;
    await this.prisma.user.update({ where: { id: targetUserId }, data: { phone } });
    return { ok: true, phone };
  }

  async setUserEmail(actor: JwtPayload, targetUserId: string, rawEmail: string) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');
    /* Any coach may fix an athlete's login email; a coach's email is changed
       by an admin (Settings → Staff) or by that coach themselves. */
    if (target.role === 'COACH' && actor.sub !== target.id) {
      const actorLevel = actor.role === 'COACH' ? (actor.coachLevel || 'ADMIN') : null;
      if (actorLevel !== 'ADMIN') throw new ForbiddenException('Only admins can change another coach’s email.');
    }
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { player: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== 'PENDING') return { ok: true, status: user.status };
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
    // Resolve the request → drop it from every coach's bell.
    await this.notifications.clearAccountRequest(userId);
    // Welcome email — best-effort, non-blocking (no-ops if Resend unconfigured).
    const displayName = user.name || user.player?.firstName || null;
    void this.mail.sendTemplate('WELCOME', user.email, { name: displayName, url: `${this.mail.webAppUrl}/login` });
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
