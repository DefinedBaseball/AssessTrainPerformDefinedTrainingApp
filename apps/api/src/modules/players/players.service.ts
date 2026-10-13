import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';

/** Profile tabs a coach may hide (matches the web tab keys). Summary and
 *  Videos are never hideable. */
const HIDEABLE_TABS = new Set(['hitting', 'pitching', 'catching', 'infield', 'outfield', 'strength']);
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LeaderboardsService } from '../leaderboards/leaderboards.service';
import { BunnyService } from '../videos/bunny.service';

/* Stat keys per grid for the season stats sheet. Mirrors STAT_GRIDS in the
   web app's lib/season-stats.ts -- keep the two in step. */
const SEASON_STAT_KEYS: Record<string, Set<string>> = {
  hitting: new Set(['GP', 'PA', 'AB', 'AVG', 'OBP', 'OPS', 'SLG', 'H', '1B', '2B', '3B', 'HR', 'RBI', 'R',
    'BB', 'K', 'HBP', 'SB', 'CS', 'SB%', 'LOB', 'BABIP', 'GB%', 'LD%', 'FB%', 'QAB%']),
  pitching: new Set(['IP', 'GP', 'H', 'HR', 'R', 'ER', 'BB', 'K', 'HBP', 'ERA', 'WHIP', 'BAA', 'FIP',
    'S%', 'FPS%', 'FB%', 'LD%', 'GB%', 'BABIP']),
  defense: new Set(['TC', 'A', 'PO', 'FLD%', 'E', 'DP']),
  catching: new Set(['INN', 'PB', 'WP', 'SB/ATT', 'CS', 'CS%', 'PIK', 'CI']),
};

@Injectable()
export class PlayersService {
  /* MailModule is @Global, so MailService injects without importing it. */
  private readonly logger = new Logger(PlayersService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private notifications: NotificationsService,
    private leaderboards: LeaderboardsService,
    private bunny: BunnyService,
  ) {}

  /** Tell coaches an athlete changed their own profile or Season Stats
   *  (Settings → Notifications → Athlete Profile & Stats Updates). One per
   *  athlete per hour while unread. Never throws. */
  async notifyCoachesOfAthleteEdit(playerId: string, what: 'profile' | 'stats') {
    try {
      const p = await this.prisma.player.findUnique({ where: { id: playerId }, select: { firstName: true, lastName: true } });
      if (!p) return;
      const name = `${p.firstName} ${p.lastName}`.trim();
      await this.notifications.notifyAllCoachesOnce({
        type: 'PROFILE_UPDATE',
        title: what === 'stats' ? `${name} updated their Season Stats` : `${name} updated their profile`,
        body: what === 'stats' ? 'Player Summary → Stats' : 'Their personal information changed.',
        linkUrl: `/athletes/${playerId}`,
        entityId: playerId,
      }, 60 * 60 * 1000);
    } catch { /* an alert must never fail the save */ }
  }

  /**
   * Email one athlete a reminder to finish filling in their profile.
   *
   * Reports honestly rather than optimistically: MailService.send() RETURNS
   * false when Resend is unconfigured or the send fails -- it does not throw
   * -- so trusting the absence of an exception would tell the coach "sent" on
   * a box with no mail set up at all. `emailed` is what the button reads.
   *
   * The link goes to the sign-in page, not a deep link to the profile: the
   * athlete is almost certainly signed out, so a deep link would bounce to
   * /login anyway.
   */
  async sendProfileReminder(playerId: string): Promise<{ ok: boolean; emailed: boolean; to: string }> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { firstName: true, user: { select: { email: true } } },
    });
    if (!player) throw new NotFoundException('Player not found');

    const to = player.user?.email?.trim();
    if (!to) {
      throw new BadRequestException(
        'That athlete has no email address on file, so there is nowhere to send the reminder.',
      );
    }

    const emailed = await this.mail.sendTemplate('PROFILE_REMINDER', to, {
      name: player.firstName,
      url: `${this.mail.webAppUrl}/login`,
    });
    return { ok: true, emailed, to };
  }

  /** The "Assessment report" email's saved wording for this athlete, as the
   *  starting subject + message the coach edits before sending. */
  async reportEmailDraft(playerId: string): Promise<{ subject: string; message: string }> {
    const player = await this.prisma.player.findUnique({ where: { id: playerId }, select: { firstName: true } });
    if (!player) throw new NotFoundException('Player not found');
    const draft = await this.mail.filledContent('REPORT_PDF', player.firstName);
    return { subject: draft.subject, message: draft.body };
  }

  /** Email a coach-built report PDF to the athlete and/or guardian -- one
   *  email each, so neither sees the other's address. Recipients resolve
   *  to the addresses on file (the athlete's login email, the guardian's
   *  parentEmail); the request only says which. The subject and message are
   *  the coach's own words, wrapped in the academy's email layout. */
  async emailReportPdf(
    playerId: string,
    body: { recipients?: unknown; filename?: unknown; pdfBase64?: unknown; subject?: unknown; message?: unknown },
  ): Promise<{ results: Array<{ recipient: 'player' | 'guardian'; email: string; sent: boolean }> }> {
    const wanted = Array.isArray(body.recipients) ? body.recipients : [];
    const recipients = (['player', 'guardian'] as const).filter((r) => wanted.includes(r));
    if (recipients.length === 0) throw new BadRequestException('Choose who to email: the player, the guardian or both.');

    const subject = (typeof body.subject === 'string' ? body.subject : '').replace(/[\r\n]+/g, ' ').trim();
    const message = (typeof body.message === 'string' ? body.message : '').replace(/\r\n/g, '\n').trim();
    if (!subject) throw new BadRequestException('Add a subject line.');
    if (subject.length > 200) throw new BadRequestException('Keep the subject under 200 characters.');
    if (message.length > 5000) throw new BadRequestException('Keep the message under 5,000 characters.');

    if (typeof body.pdfBase64 !== 'string' || body.pdfBase64.length === 0) {
      throw new BadRequestException('The PDF is missing.');
    }
    // ~15 MB of PDF; base64 is 4/3 the size.
    if (body.pdfBase64.length > 20_000_000) throw new BadRequestException('That PDF is too large to email.');
    const pdf = Buffer.from(body.pdfBase64, 'base64');
    if (pdf.length < 5 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new BadRequestException('Only PDF reports can be emailed.');
    }
    const rawName = typeof body.filename === 'string' ? body.filename : 'Report.pdf';
    const filename = (rawName.replace(/[^\w.-]+/g, '_').replace(/\.pdf$/i, '').slice(0, 100) || 'Report') + '.pdf';

    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { firstName: true, parentEmail: true, user: { select: { email: true } } },
    });
    if (!player) throw new NotFoundException('Player not found');
    const addressOf = { player: player.user?.email?.trim() || '', guardian: player.parentEmail?.trim() || '' };
    const missing = recipients.filter((r) => !addressOf[r]);
    if (missing.length) {
      throw new BadRequestException(
        missing.length === 2 ? 'Neither the player nor the guardian has an email address on file.'
          : missing[0] === 'player' ? 'The player has no email address on file.'
          : 'There is no guardian email on file for this athlete.',
      );
    }

    const attachment = [{ filename, content: pdf.toString('base64') }];
    /* The coach's subject + message in place of the template's; the
       template's heading stays as the title inside the email. */
    const template = await this.mail.filledContent('REPORT_PDF', player.firstName);
    const draft = { subject, heading: template.heading, body: message };
    const results: Array<{ recipient: 'player' | 'guardian'; email: string; sent: boolean }> = [];
    for (const recipient of recipients) {
      const sent = await this.mail.sendTemplate(
        'REPORT_PDF', addressOf[recipient],
        { name: player.firstName, url: `${this.mail.webAppUrl}/login` },
        draft, attachment,
      );
      results.push({ recipient, email: addressOf[recipient], sent });
    }
    return { results };
  }

  async create(data: {
    userId: string;
    firstName: string;
    lastName: string;
    positions: string;
    heightInches?: number;
    weightLbs?: number;
    gradYear?: number;
  }) {
    return this.prisma.player.create({ data });
  }

  async findAll(filters?: { gradYear?: number; position?: string }) {
    const where: any = {};
    if (filters?.gradYear) where.gradYear = filters.gradYear;
    if (filters?.position) where.positions = { contains: filters.position };

    return this.prisma.player.findMany({
      where,
      orderBy: { firstName: 'asc' },
      /* status drives the Athlete Hub's locked/unlocked split and keeps
         locked athletes out of Apply Calendar's target list. */
      include: { user: { select: { email: true, role: true, phone: true, status: true } } },
    });
  }

  async findOne(id: string) {
    const player = await this.prisma.player.findUnique({
      where: { id },
      include: {
        user: { select: { email: true, role: true, phone: true, status: true, deletionRequestedAt: true } },
        metrics: { orderBy: { recordedAt: 'desc' }, take: 50 },
        videos: { orderBy: { createdAt: 'desc' }, take: 20 },
        leaderboardEntries: true,
      },
    });
    if (!player) throw new NotFoundException('Player not found');
    return player;
  }

  /**
   * Permanently delete an athlete who asked for it (Settings → Delete my
   * account), confirmed by an admin on their profile. Removes the account
   * and everything that is theirs: profile, photo, reports, metrics, videos
   * (and the Bunny files behind them), at-bats, schedules, check-ins, stats,
   * messages and notifications. Raw upload rows whose rows were all this
   * athlete's go too. Posts that merely tagged them keep the post.
   */
  async deleteAthleteAccount(playerId: string) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { user: true, videos: { select: { originalUrl: true, hlsUrl: true } } },
    });
    if (!player) throw new NotFoundException('Player not found');
    if (!player.user.deletionRequestedAt) {
      throw new BadRequestException('This athlete hasn\u2019t asked for their account to be deleted.');
    }
    const userId = player.userId;

    /* Gather what lives outside these rows before they disappear. */
    const uploadIds = (await this.prisma.metric.findMany({
      where: { playerId, uploadId: { not: null } },
      select: { uploadId: true },
      distinct: ['uploadId'],
    })).map((m) => m.uploadId as string);
    const sentClips = (await this.prisma.message.findMany({
      where: { senderId: userId, videoUrl: { not: null } },
      select: { videoUrl: true },
    })).map((m) => m.videoUrl as string);

    await this.prisma.$transaction(async (tx) => {
      // Relations that don't cascade from the player / user.
      await tx.trainingProgram.deleteMany({ where: { playerId } });
      await tx.gameReport.deleteMany({ where: { playerId } });
      await tx.post.updateMany({ where: { taggedPlayerId: playerId }, data: { taggedPlayerId: null } });
      await tx.postSeen.deleteMany({ where: { userId } });
      await tx.post.deleteMany({ where: { authorId: userId } });
      await tx.message.deleteMany({ where: { OR: [{ senderId: userId }, { recipientId: userId }] } });
      await tx.notification.deleteMany({ where: { recipientId: userId } });
      // Coaches' bell items about this athlete would point at a missing profile.
      await tx.notification.deleteMany({ where: { entityId: { in: [playerId, userId] } } });
      // Everything else hangs off the player (cascade), then the login itself.
      await tx.player.delete({ where: { id: playerId } });
      await tx.user.delete({ where: { id: userId } });
      // Raw uploads that now have no rows left (they were only this athlete's).
      for (const id of uploadIds) {
        const left = await tx.metric.count({ where: { uploadId: id } });
        if (left === 0) await tx.csvUpload.deleteMany({ where: { id } });
      }
    }, { timeout: 60_000 }); // years of per-pitch rows can outlast the 5 s default

    /* Storage clean-up after the rows are gone -- best effort, like a video
       delete: a storage hiccup leaves an orphaned file, never a half-deleted
       account. */
    const guids = new Set<string>();
    for (const v of player.videos) {
      const g = this.bunny.guidFromUrl(v.originalUrl) ?? this.bunny.guidFromUrl(v.hlsUrl);
      if (g) guids.add(g);
    }
    for (const url of sentClips) {
      const stillUsed = await this.prisma.message.count({ where: { videoUrl: url } })
        + await this.prisma.video.count({ where: { OR: [{ originalUrl: url }, { hlsUrl: url }] } });
      const g = this.bunny.guidFromUrl(url);
      if (g && stillUsed === 0) guids.add(g);
    }
    for (const g of guids) {
      void this.bunny.deleteVideoObject(g)
        .then((ok) => { if (!ok) this.logger.warn(`Bunny asset ${g} could not be deleted (athlete account deletion)`); })
        .catch((e) => this.logger.warn(`Bunny cleanup failed for ${g}: ${e?.message || e}`));
    }
    void this.rebuildLeaderboards([player.gradYear]);

    this.logger.log(`Athlete account deleted on request: ${player.firstName} ${player.lastName} (${player.user.email})`);
    return { ok: true, deleted: `${player.firstName} ${player.lastName}`.trim() };
  }

  /** Keep the account: clear an athlete's deletion request (admin). */
  async dismissDeletionRequest(playerId: string) {
    const player = await this.prisma.player.findUnique({ where: { id: playerId }, select: { userId: true } });
    if (!player) throw new NotFoundException('Player not found');
    await this.prisma.user.update({ where: { id: player.userId }, data: { deletionRequestedAt: null } });
    await this.prisma.notification.deleteMany({ where: { type: 'ACCOUNT_DELETION', entityId: playerId } });
    return { ok: true };
  }

  async findByUserId(userId: string) {
    return this.prisma.player.findUnique({ where: { userId } });
  }

  async update(id: string, data: {
    firstName?: string;
    lastName?: string;
    positions?: string;
    athleteTypes?: string;
    profilePhoto?: string;
    heightInches?: number | null;
    weightLbs?: number | null;
    gradYear?: number | null;
    bats?: string | null;
    throws?: string | null;
    birthDate?: string | null;
    highSchool?: string | null;
    clubTeam?: string | null;
    college?: string | null;
    /* Pro club, for athletes who have signed. Deliberately separate from
       `college`: the Client Directory's Team column and the PDF cover both
       read College. */
    professionalTeam?: string | null;
    collegeCommit?: string | null;
    parentEmail?: string | null;
    parentPhone?: string | null;
    pbrNational?: number | null;
    pbrState?: number | null;
    pbrPosition?: number | null;
    pgScore?: number | null;
    developmentNotes?: string | null;
    playingLevelGoal?: string | null;
    goals?: string | null;
    trainingHistory?: string | null;
    trainingAvailability?: string | null;
    otherSports?: string | null;
    injuryHistory?: string | null;
  }) {
    /* The photo link is only ever set by setPhoto / removePhoto -- never
       from a profile save, where it could point at any outside URL. */
    const { profilePhoto: _ignored, ...fields } = data;
    const before = fields.gradYear !== undefined
      ? await this.prisma.player.findUnique({ where: { id }, select: { gradYear: true } })
      : null;
    const updated = await this.prisma.player.update({ where: { id }, data: fields });
    /* Leaderboards are rebuilt when results change (report saves, CSV
       imports), not when someone opens the page -- so a class change has to
       move the athlete between boards here. Both classes are rebuilt. */
    if (before && before.gradYear !== updated.gradYear) {
      void this.rebuildLeaderboards([before.gradYear, updated.gradYear]);
    }
    return updated;
  }

  /** Each class rebuild also rebuilds All Ages. */
  private async rebuildLeaderboards(years: (number | null)[]) {
    try {
      for (const year of years) {
        if (year != null) await this.leaderboards.recompute(year);
      }
    } catch (err) {
      this.logger.warn(`Leaderboard rebuild after class change failed: ${err}`);
    }
  }

  /** Save a new profile picture (a data URL from the browser, already
   *  square-cropped and shrunk there). Replaces any previous one: the new
   *  photo gets a new random id, so the old URL stops working. */
  async setPhoto(playerId: string, dataUrl: unknown): Promise<{ profilePhoto: string }> {
    if (typeof dataUrl !== 'string') throw new BadRequestException('Choose an image file');
    const m = /^data:[^;,]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
    if (!m) throw new BadRequestException('Choose an image file');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 1_000_000) throw new BadRequestException('Photo must be under 1 MB');
    const mime = sniffPhoto(buf);
    if (!mime) throw new BadRequestException('Photo must be a PNG, JPG or WebP image');

    const exists = await this.prisma.player.findUnique({ where: { id: playerId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Player not found');

    const id = randomBytes(16).toString('hex');
    const profilePhoto = `/api/player-photos/${id}`;
    await this.prisma.$transaction([
      this.prisma.playerPhoto.deleteMany({ where: { playerId } }),
      this.prisma.playerPhoto.create({ data: { id, playerId, mime, data: buf.toString('base64') } }),
      this.prisma.player.update({ where: { id: playerId }, data: { profilePhoto } }),
    ]);
    return { profilePhoto };
  }

  async removePhoto(playerId: string): Promise<{ profilePhoto: null }> {
    await this.prisma.$transaction([
      this.prisma.playerPhoto.deleteMany({ where: { playerId } }),
      this.prisma.player.update({ where: { id: playerId }, data: { profilePhoto: null } }),
    ]);
    return { profilePhoto: null };
  }

  /** The image behind a photo URL. */
  async getPhoto(photoId: string): Promise<{ mime: string; data: Buffer }> {
    if (!/^[0-9a-f]{32}$/.test(photoId)) throw new NotFoundException('No photo');
    const row = await this.prisma.playerPhoto.findUnique({ where: { id: photoId } });
    if (!row) throw new NotFoundException('No photo');
    return { mime: row.mime, data: Buffer.from(row.data, 'base64') };
  }

  /**
   * Pause or restore an athlete's account.
   *
   * Locking flips the linked User's status to LOCKED, which the JWT guard
   * already enforces on EVERY request — so access stops on the next call
   * rather than whenever their week-long token happens to expire.
   *
   * Deliberately only toggles ACTIVE ⇄ LOCKED. A PENDING self-registration
   * must not be "unlocked" into a live account — that would route around the
   * coach approval step entirely — and a DECLINED one must stay declined.
   */
  /**
   * Profile tabs hidden on this athlete's profile (the coach's eye toggle).
   * Unknown keys are dropped rather than rejected, so a stale client can't
   * fail the whole save over one renamed tab.
   */
  async setHiddenTabs(playerId: string, tabs: unknown) {
    if (!Array.isArray(tabs)) throw new BadRequestException('"tabs" must be an array of tab names');
    const clean = [...new Set(tabs.filter(
      (t): t is string => typeof t === 'string' && HIDEABLE_TABS.has(t),
    ))];
    const exists = await this.prisma.player.findUnique({ where: { id: playerId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Player not found');
    await this.prisma.player.update({
      where: { id: playerId },
      data: { hiddenTabs: JSON.stringify(clean) },
    });
    return { hiddenTabs: clean };
  }

  /**
   * Replace an athlete's season stats (Player Summary → Stats). Only known
   * grids and stat keys are kept; values are short strings of digits and
   * . % / - exactly as typed (".313", "45.1", "3/10"). Blank values and
   * empty seasons are dropped.
   */
  async setSeasonStats(playerId: string, stats: unknown) {
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
      throw new BadRequestException('"stats" must be an object');
    }
    const clean: Record<string, Record<string, Record<string, string>>> = {};
    for (const [grid, seasons] of Object.entries(stats as Record<string, unknown>)) {
      const allowed = SEASON_STAT_KEYS[grid];
      if (!allowed) throw new BadRequestException(`Unknown stat group "${grid}"`);
      if (!seasons || typeof seasons !== 'object' || Array.isArray(seasons)) {
        throw new BadRequestException(`${grid} must be an object of seasons`);
      }
      const entries = Object.entries(seasons as Record<string, unknown>);
      if (entries.length > 40) throw new BadRequestException(`Too many ${grid} seasons`);
      for (const [season, row] of entries) {
        const year = Number(season);
        if (!/^\d{4}$/.test(season) || year < 1990 || year > 2100) {
          throw new BadRequestException(`Invalid season "${season}"`);
        }
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          throw new BadRequestException(`${grid} ${season} must be an object of stats`);
        }
        const kept: Record<string, string> = {};
        for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
          if (!allowed.has(key)) throw new BadRequestException(`Unknown ${grid} stat "${key}"`);
          if (value === null || value === undefined || value === '') continue;
          if (typeof value !== 'string' || value.length > 10 || !/^[0-9.%/\-]+$/.test(value)) {
            throw new BadRequestException(`${grid} ${key} must be a number like 12, .313, 45.1, 48% or 3/10`);
          }
          kept[key] = value;
        }
        if (Object.keys(kept).length) (clean[grid] ??= {})[season] = kept;
      }
    }
    const exists = await this.prisma.player.findUnique({ where: { id: playerId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Player not found');
    const json = Object.keys(clean).length ? JSON.stringify(clean) : null;
    await this.prisma.player.update({ where: { id: playerId }, data: { seasonStats: json } });
    return { seasonStats: json };
  }

  async setPlayerLocked(playerId: string, locked: boolean) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        userId: true,
        user: { select: { status: true, role: true, isPrimaryAdmin: true } },
      },
    });
    if (!player) throw new NotFoundException('Player not found');

    /* Refuse anything that is not a PLAYER account.
    
       A Player row does not guarantee a player ACCOUNT: staff who also train
       carry one, and the primary admin is among them. Without this check the
       Lock button beside their name in the Athlete Hub flips their own
       coach login to LOCKED, and because the guard rejects every request
       from a locked account they cannot reach Settings to undo it — the app
       locks its owner out, recoverable only from the database.

       The Hub's "positions !== 'COACH'" filter does not catch this: a coach
       who trains carries real positions like "C,P,INF,OF". */
    if (player.user?.role !== 'PLAYER') {
      throw new BadRequestException('Only athlete accounts can be locked');
    }
    if (player.user?.isPrimaryAdmin) {
      throw new BadRequestException('The primary admin account cannot be locked');
    }

    const current = player.user?.status;
    const target = locked ? 'LOCKED' : 'ACTIVE';

    if (current === target) {
      return { playerId, status: target, changed: false };
    }
    if (locked && current !== 'ACTIVE') {
      throw new BadRequestException(`Only an active account can be locked (this one is ${current})`);
    }
    if (!locked && current !== 'LOCKED') {
      throw new BadRequestException(`Only a locked account can be unlocked (this one is ${current})`);
    }

    await this.prisma.user.update({
      where: { id: player.userId },
      data: { status: target },
    });
    return { playerId, status: target, changed: true };
  }

  async getTopMetrics(playerId: string) {
    // Get every metric for the player (sorted newest-first).
    const metrics = await this.prisma.metric.findMany({
      where: { playerId },
      orderBy: { recordedAt: 'desc' },
    });

    /* Bucket by metric_type so we can aggregate across every row of the
       same type — handles parsers that emit one row per batted ball
       (Full Swing, Blast) the same as parsers that emit a single
       session summary (HitTrax). */
    const grouped = new Map<string, typeof metrics>();
    for (const m of metrics) {
      const arr = grouped.get(m.metricType);
      if (arr) arr.push(m);
      else grouped.set(m.metricType, [m]);
    }

    /* Aggregation rule per metric_type, deduced from the name:
         - starts with `max_*` or ends with `_max`  → MAX
         - starts with `avg_*` or ends with `_avg`  → AVG
         - ends with `_pct`                          → AVG (per-row 0/100 flags average to a percentage)
         - explicit AVG metrics (launch_angle, distance, etc.)
         - everything else                           → latest (default, prior behavior)
       Coach-graded scouting numbers (manual entries) keep "latest" so
       the most recent grade wins, not an average across history. */
    const AVG_METRICS = new Set([
      'launch_angle', 'distance', 'spray_angle', 'pitch_speed',
      'bat_speed', 'attack_angle', 'plane_angle',
      'time_to_contact', 'on_plane_efficiency',
      'connection_at_contact', 'rotational_acceleration',
      'smash_factor',
    ]);

    const aggregateForType = (metricType: string): 'max' | 'avg' | 'latest' => {
      if (metricType.startsWith('max_') || metricType.endsWith('_max')) return 'max';
      if (metricType.startsWith('avg_') || metricType.endsWith('_avg')) return 'avg';
      if (metricType.endsWith('_pct')) return 'avg';
      if (AVG_METRICS.has(metricType)) return 'avg';
      return 'latest';
    };

    const out: Record<string, { value: number; unit: string; recordedAt: Date }> = {};
    grouped.forEach((rows, metricType) => {
      const mode = aggregateForType(metricType);
      const latest = rows[0]; // grouped insertion preserves desc order from the query
      const values = rows.map(r => r.value);
      let value: number;
      if (mode === 'max') value = Math.max(...values);
      else if (mode === 'avg') value = values.reduce((s, n) => s + n, 0) / values.length;
      else value = latest.value;
      out[metricType] = {
        value: Math.round(value * 100) / 100,
        unit: latest.unit,
        recordedAt: latest.recordedAt,
      };
    });

    /* ── Synthesized companions ──────────────────────────────────────
       Both the Full Swing parser (`ExitSpeed`) and the legacy HitTrax
       parser map per-batted-ball exit velo to `max_exit_velo`, so
       `avg_exit_velo` may not exist as its own row even though the raw
       data is sitting right there. Derive it from the per-row average
       of `max_exit_velo` so the Hitting tab's "Avg Exit Velo" KPI
       lights up regardless of which parser ingested the file. */
    const exitVeloRows = grouped.get('max_exit_velo');
    if (exitVeloRows && exitVeloRows.length > 0 && !out.avg_exit_velo) {
      const avg = exitVeloRows.reduce((s, r) => s + r.value, 0) / exitVeloRows.length;
      out.avg_exit_velo = {
        value: Math.round(avg * 100) / 100,
        unit: exitVeloRows[0].unit,
        recordedAt: exitVeloRows[0].recordedAt,
      };
    }

    return out;
  }
}

/** PNG / JPEG / WebP by their first bytes -- the file's claimed type is not trusted. */
function sniffPhoto(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
