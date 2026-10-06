import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';

/** Profile tabs a coach may hide (matches the web tab keys). Summary and
 *  Videos are never hideable. */
const HIDEABLE_TABS = new Set(['hitting', 'pitching', 'catching', 'infield', 'outfield', 'strength']);
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { profileReminderEmail } from '../mail/mail.templates';

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
  constructor(private prisma: PrismaService, private mail: MailService) {}

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

    const { subject, html, text } = profileReminderEmail(
      `${this.mail.webAppUrl}/login`,
      player.firstName,
    );
    const emailed = await this.mail.send({ to, subject, html, text });
    return { ok: true, emailed, to };
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
        user: { select: { email: true, role: true, phone: true, status: true } },
        metrics: { orderBy: { recordedAt: 'desc' }, take: 50 },
        videos: { orderBy: { createdAt: 'desc' }, take: 20 },
        leaderboardEntries: true,
      },
    });
    if (!player) throw new NotFoundException('Player not found');
    return player;
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
  }) {
    return this.prisma.player.update({ where: { id }, data });
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
