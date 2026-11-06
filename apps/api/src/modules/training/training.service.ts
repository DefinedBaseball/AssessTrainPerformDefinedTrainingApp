import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BunnyService } from '../videos/bunny.service';
import { S3Service } from '../videos/s3.service';
import {
  FacilityProgramsService, WEEKDAY_KEYS, WeekdayKey, addDays, mondayOf, weekdayKeyOf, programDaysOf,
} from '../facility-programs/facility-programs.service';

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
import * as fs from 'fs';
import * as path from 'path';

/** Local-disk URL shapes this API serves videos from, and the directory each
 *  one maps to. Drill uploads write the first; athlete videos the second.
 *  Getting this list wrong is what made the old cleanup a no-op. */
const LOCAL_VIDEO_ROUTES: { prefix: string; dir: string[] }[] = [
  { prefix: '/api/training/drills/video/', dir: ['uploads', 'drills'] },
  { prefix: '/api/videos/file/', dir: ['uploads', 'videos'] },
];

@Injectable()
export class TrainingService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private bunny: BunnyService,
    private s3: S3Service,
    private facilityPrograms: FacilityProgramsService,
  ) {}

  /**
   * Delete the media a Drill's videoUrl points at, so replacing or removing a
   * drill doesn't orphan the old clip.
   *
   * Handles every driver the upload route can write to, because the URL shape
   * differs per driver and matching only one is how this silently stopped
   * working: local disk (two distinct route prefixes), Bunny (guid recovered
   * from the CDN URL) and S3 (key recovered from the public URL). Anything
   * unrecognised — an external YouTube embed, a hand-edited URL — is left
   * alone rather than guessed at.
   *
   * Best-effort by design: a cleanup failure must never fail the save that
   * triggered it, so everything is caught and logged.
   */
  private async cleanupDrillVideoFile(videoUrl: string | null | undefined): Promise<void> {
    if (!videoUrl) return;

    try {
      for (const { prefix, dir } of LOCAL_VIDEO_ROUTES) {
        if (!videoUrl.startsWith(prefix)) continue;
        const filename = videoUrl.slice(prefix.length);
        // Guard against path traversal before touching the filesystem.
        if (!filename || filename.includes('/') || filename.includes('..')) return;
        try {
          fs.unlinkSync(path.join(process.cwd(), ...dir, filename));
        } catch {
          // Already gone or never existed — fine.
        }
        return;
      }

      const guid = this.bunny.guidFromUrl(videoUrl);
      if (guid) {
        await this.bunny.deleteVideoObject(guid);
        return;
      }

      const key = this.s3.keyFromUrl(videoUrl);
      if (key) {
        await this.s3.deleteObject(key);
        return;
      }
    } catch {
      /* Never let cleanup break the caller. */
    }
  }

  /* ═══════════════════ CHECK-INS ═══════════════════
     Eligibility is never stored — an athlete is asked to check in on a date
     exactly when ScheduledDrill has rows for them on it. Every read below
     therefore starts from the schedule and left-joins the check-in, so a
     coach clearing a calendar silently withdraws the prompt and a coach
     adding one offers it, with no extra bookkeeping. */

  /** Distinct dates this athlete has drills scheduled on, newest first. */
  private async scheduledDatesFor(playerId: string): Promise<string[]> {
    const rows = await this.prisma.scheduledDrill.findMany({
      where: { playerId },
      select: { date: true },
      distinct: ['date'],
      orderBy: { date: 'desc' },
    });
    return rows.map((r) => r.date);
  }

  /** Does this athlete have anything scheduled on this date? */
  async hasScheduledOn(playerId: string, date: string): Promise<boolean> {
    const n = await this.prisma.scheduledDrill.count({ where: { playerId, date } });
    return n > 0;
  }

  /**
   * What the athlete's Training tab needs on open: whether to prompt, and
   * where they are in the flow if they already started.
   */
  async getCheckInStatus(playerId: string, date: string) {
    const [scheduled, checkIn, drills] = await Promise.all([
      this.hasScheduledOn(playerId, date),
      this.prisma.drillCheckIn.findUnique({ where: { playerId_date: { playerId, date } } }),
      this.prisma.scheduledDrill.count({ where: { playerId, date } }),
    ]);
    return {
      date,
      scheduled,
      drillCount: drills,
      /* Only prompt when there is something to train and nothing recorded. */
      shouldPrompt: scheduled && !checkIn,
      checkedIn: !!checkIn,
      finished: !!checkIn?.finishedAt,
      checkIn: checkIn ?? null,
    };
  }

  /** Record the check-in. Idempotent: re-checking in the same day updates
   *  the focus rather than erroring, so a double-tap cannot 500. The three
   *  1-5 ratings (feel / sleep / eat) are optional here so an older client
   *  can still check in; anything outside 1-5 is refused. */
  async checkIn(
    playerId: string,
    date: string,
    focus: string,
    ratings: { feelRating?: unknown; sleepRating?: unknown; eatRating?: unknown } = {},
  ) {
    if (!date) throw new BadRequestException('date is required');
    const text = (focus || '').trim();
    if (!text) throw new BadRequestException('An area of focus is required');
    const rating = (v: unknown, label: string): number | null => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new BadRequestException(`${label} must be 1 to 5`);
      return n;
    };
    const scores = {
      feelRating: rating(ratings.feelRating, 'How you feel'),
      sleepRating: rating(ratings.sleepRating, 'How you slept'),
      eatRating: rating(ratings.eatRating, 'How you ate'),
    };
    if (!(await this.hasScheduledOn(playerId, date))) {
      throw new BadRequestException('Nothing is scheduled for that day');
    }
    return this.prisma.drillCheckIn.upsert({
      where: { playerId_date: { playerId, date } },
      create: { playerId, date, focus: text, ...scores },
      update: { focus: text, ...scores },
    });
  }

  /** Close out the session with the two reflection answers. */
  async finishCheckIn(playerId: string, date: string, executedGoal: string, learned: string) {
    const existing = await this.prisma.drillCheckIn.findUnique({
      where: { playerId_date: { playerId, date } },
    });
    if (!existing) throw new BadRequestException('Check in before finishing the session');
    return this.prisma.drillCheckIn.update({
      where: { playerId_date: { playerId, date } },
      data: {
        executedGoal: (executedGoal || '').trim() || null,
        learned: (learned || '').trim() || null,
        /* Preserve the original finish time if they submit twice. */
        finishedAt: existing.finishedAt ?? new Date(),
      },
    });
  }

  /**
   * The athlete's own history: every day they had drills scheduled, with
   * whatever check-in exists for it. Days with no check-in still appear —
   * a missed day is part of the record.
   */
  async listCheckInsForPlayer(playerId: string) {
    const dates = await this.scheduledDatesFor(playerId);
    if (dates.length === 0) return [];
    const rows = await this.prisma.drillCheckIn.findMany({
      where: { playerId, date: { in: dates } },
    });
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const counts = await this.prisma.scheduledDrill.groupBy({
      by: ['date'],
      where: { playerId, date: { in: dates } },
      _count: { _all: true },
    });
    const countByDate = new Map(counts.map((c) => [c.date, c._count._all]));
    return dates.map((date) => {
      const c = byDate.get(date);
      return {
        date,
        drillCount: countByDate.get(date) ?? 0,
        checkedIn: !!c,
        finished: !!c?.finishedAt,
        focus: c?.focus ?? null,
        feelRating: c?.feelRating ?? null,
        sleepRating: c?.sleepRating ?? null,
        eatRating: c?.eatRating ?? null,
        executedGoal: c?.executedGoal ?? null,
        learned: c?.learned ?? null,
        checkedInAt: c?.checkedInAt ?? null,
        finishedAt: c?.finishedAt ?? null,
      };
    });
  }

  /**
   * Coach view for one day: every athlete with drills scheduled, and their
   * check-in / finish state. Drives the dashboard's Athlete Workouts count
   * and the list behind it, so it is deliberately one query pair rather
   * than a per-athlete fan-out.
   */
  async listDayCheckIns(date: string) {
    if (!date) throw new BadRequestException('date is required');
    const scheduled = await this.prisma.scheduledDrill.groupBy({
      by: ['playerId'],
      where: { date },
      _count: { _all: true },
    });
    if (scheduled.length === 0) return [];
    const playerIds = scheduled.map((s) => s.playerId);
    const [players, checkIns] = await Promise.all([
      this.prisma.player.findMany({
        where: { id: { in: playerIds } },
        select: { id: true, firstName: true, lastName: true, positions: true, profilePhoto: true },
      }),
      this.prisma.drillCheckIn.findMany({ where: { date, playerId: { in: playerIds } } }),
    ]);
    const byId = new Map(players.map((p) => [p.id, p]));
    const ciById = new Map(checkIns.map((c) => [c.playerId, c]));
    return scheduled
      .map((s) => {
        const p = byId.get(s.playerId);
        const c = ciById.get(s.playerId);
        return {
          playerId: s.playerId,
          firstName: p?.firstName ?? '',
          lastName: p?.lastName ?? '',
          positions: p?.positions ?? '',
          profilePhoto: p?.profilePhoto ?? null,
          drillCount: s._count._all,
          checkedIn: !!c,
          finished: !!c?.finishedAt,
          focus: c?.focus ?? null,
          feelRating: c?.feelRating ?? null,
          sleepRating: c?.sleepRating ?? null,
          eatRating: c?.eatRating ?? null,
          executedGoal: c?.executedGoal ?? null,
          learned: c?.learned ?? null,
          checkedInAt: c?.checkedInAt ?? null,
          finishedAt: c?.finishedAt ?? null,
        };
      })
      /* Players deleted mid-day would otherwise render as a blank row. */
      .filter((r) => r.firstName || r.lastName)
      .sort((a, b) => (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName));
  }

  /**
   * Search every athlete's check-in history by name, newest first.
   *
   * Days with no check-in are included: a coach searching a name wants the
   * whole record, and a missed session is the part they are most likely
   * looking for. Same reasoning as the athlete's own history view.
   *
   * Name matching is done in memory rather than with a `contains` filter
   * because Prisma's case-insensitive mode is unavailable on SQLite, and
   * LIKE is case-insensitive on SQLite but case-SENSITIVE on Postgres — so
   * a DB-side filter would quietly behave differently in dev and prod. The
   * roster is small enough that this costs nothing.
   */
  async searchCheckIns(query: string) {
    const term = (query || '').trim().toLowerCase();
    if (!term) return [];

    const roster = await this.prisma.player.findMany({
      select: { id: true, firstName: true, lastName: true, positions: true, profilePhoto: true },
    });
    const matched = roster.filter((p) =>
      `${p.firstName ?? ''} ${p.lastName ?? ''}`.toLowerCase().includes(term));
    if (matched.length === 0) return [];

    const playerIds = matched.map((p) => p.id);
    const [scheduled, checkIns] = await Promise.all([
      this.prisma.scheduledDrill.groupBy({
        by: ['playerId', 'date'],
        where: { playerId: { in: playerIds } },
        _count: { _all: true },
      }),
      this.prisma.drillCheckIn.findMany({ where: { playerId: { in: playerIds } } }),
    ]);

    const byId = new Map(matched.map((p) => [p.id, p]));
    const ciKey = (playerId: string, date: string) => `${playerId}|${date}`;
    const ciMap = new Map(checkIns.map((c) => [ciKey(c.playerId, c.date), c]));

    return scheduled
      .map((s) => {
        const p = byId.get(s.playerId)!;
        const c = ciMap.get(ciKey(s.playerId, s.date));
        return {
          playerId: s.playerId,
          firstName: p.firstName ?? '',
          lastName: p.lastName ?? '',
          positions: p.positions ?? '',
          profilePhoto: p.profilePhoto ?? null,
          date: s.date,
          drillCount: s._count._all,
          checkedIn: !!c,
          finished: !!c?.finishedAt,
          focus: c?.focus ?? null,
          feelRating: c?.feelRating ?? null,
          sleepRating: c?.sleepRating ?? null,
          eatRating: c?.eatRating ?? null,
          executedGoal: c?.executedGoal ?? null,
          learned: c?.learned ?? null,
          checkedInAt: c?.checkedInAt ?? null,
          finishedAt: c?.finishedAt ?? null,
        };
      })
      /* Newest first; same athlete on the same day can't repeat, so the
         name is only a tiebreak when two athletes share a date. */
      .sort((a, b) =>
        b.date.localeCompare(a.date)
        || (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName));
  }

  // ─── Drill Library ─────────────────────────────────────────────

  async getAllDrills(tab?: string) {
    return this.prisma.drill.findMany({
      where: tab ? { tab } : undefined,
      orderBy: [{ tab: 'asc' }, { category: 'asc' }, { name: 'asc' }],
    });
  }

  async searchDrills(query: string, tab?: string) {
    const where: any = {
      name: { contains: query },
    };
    if (tab) where.tab = tab;

    return this.prisma.drill.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 20,
    });
  }

  async getDrill(id: string) {
    const drill = await this.prisma.drill.findUnique({ where: { id } });
    if (!drill) throw new NotFoundException('Drill not found');
    return drill;
  }

  async createDrill(data: {
    name: string;
    tab: string;
    category: string;
    description?: string;
    videoUrl?: string;
  }) {
    return this.prisma.drill.create({ data });
  }

  async updateDrill(id: string, data: {
    name?: string;
    tab?: string;
    category?: string;
    description?: string;
    videoUrl?: string;
  }) {
    /* If a coach replaces the drill's video, the previous file becomes
       orphaned on disk. Look up the existing drill, compare URLs, and
       delete the old file when it changes. */
    if (data.videoUrl !== undefined) {
      const prev = await this.prisma.drill.findUnique({ where: { id }, select: { videoUrl: true } });
      if (prev && prev.videoUrl && prev.videoUrl !== data.videoUrl) {
        await this.cleanupDrillVideoFile(prev.videoUrl);
      }
    }
    /* Renaming (Settings → Drills): calendar slots copy the drill's name when
       scheduled, so carry the new name onto the slots linked to this drill
       that still show the OLD name. Slots whose name was changed by hand
       are left alone. */
    const newName = typeof data.name === 'string' ? data.name.trim().replace(/\s+/g, ' ') : undefined;
    if (newName !== undefined) {
      if (!newName) throw new BadRequestException('A drill needs a name.');
      data = { ...data, name: newName };
      const prev = await this.prisma.drill.findUnique({ where: { id }, select: { name: true } });
      if (prev && prev.name !== newName) {
        const [updated] = await this.prisma.$transaction([
          this.prisma.drill.update({ where: { id }, data }),
          this.prisma.scheduledDrill.updateMany({ where: { drillId: id, name: prev.name }, data: { name: newName } }),
        ]);
        return updated;
      }
    }
    return this.prisma.drill.update({ where: { id }, data });
  }

  async deleteDrill(id: string) {
    /* Read the drill first so we can clean up its videoUrl file before
       the row is gone. ScheduledDrill rows pointing here have an
       onDelete: SetNull rule (see schema.prisma) so they survive but
       lose the FK link — which is the right behaviour because the
       calendar slot itself shouldn't disappear when the Drill template
       is removed. */
    const drill = await this.prisma.drill.findUnique({
      where: { id }, select: { videoUrl: true },
    });
    const result = await this.prisma.drill.delete({ where: { id } });
    if (drill?.videoUrl) await this.cleanupDrillVideoFile(drill.videoUrl);
    return result;
  }

  // ─── Scheduled Drills (Calendar) ───────────────────────────────

  async getScheduledDrills(playerId: string, date?: string, tab?: string) {
    const where: any = { playerId };
    if (date) where.date = date;
    if (tab) where.tab = tab;

    return this.prisma.scheduledDrill.findMany({
      where,
      include: { drill: true },
      // sectionOrder + order carry coach drag-reorder; both default 0 so an
      // un-reordered day still falls back to time order (matches old output).
      orderBy: [{ date: 'asc' }, { sectionOrder: 'asc' }, { order: 'asc' }, { time: 'asc' }],
    });
  }

  async getScheduledDrillsForRange(playerId: string, startDate: string, endDate: string, tab?: string) {
    const where: any = {
      playerId,
      date: { gte: startDate, lte: endDate },
    };
    if (tab) where.tab = tab;

    return this.prisma.scheduledDrill.findMany({
      where,
      include: { drill: true },
      orderBy: [{ date: 'asc' }, { sectionOrder: 'asc' }, { order: 'asc' }, { time: 'asc' }],
    });
  }

  async createScheduledDrill(data: {
    playerId: string;
    drillId?: string;
    tab: string;
    category: string;
    name: string;
    date: string;
    time: string;
    duration: number;
    notes?: string;
    order?: number;
    sectionOrder?: number;
    block?: number | null;
    environment?: string | null;
  }) {
    return this.prisma.scheduledDrill.create({
      data,
      include: { drill: true },
    });
  }

  async createScheduledDrillsBatch(items: {
    playerId: string;
    drillId?: string;
    tab: string;
    category: string;
    name: string;
    date: string;
    time: string;
    duration: number;
    notes?: string;
    order?: number;
    sectionOrder?: number;
    block?: number | null;
    environment?: string | null;
  }[]) {
    // One real transaction (single batched round-trip) instead of the old
    // sequential per-item awaits — template applies create dozens of rows,
    // and all-or-nothing semantics beat a half-created day on failure.
    const results = await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.scheduledDrill.create({
          data: item,
          include: { drill: true },
        }),
      ),
    );
    // One "new training scheduled" notification per unique player in the
    // batch (a schedule upload) — not one per drill, which would spam.
    void this.notifyScheduledPlayers([...new Set(items.map((i) => i.playerId))]);
    return results;
  }

  /**
   * Copy one athlete's calendar onto other athletes.
   *
   * Server-side on purpose. Doing this from the browser would mean fetching
   * each target's calendar, deleting their rows one at a time and re-creating
   * them — thousands of requests for a 20-athlete program, with no way to
   * avoid leaving half the group in a broken state if one failed partway.
   *
   * Semantics (coach spec):
   *   - `scope` picks the source dates: the anchor day, its Mon–Sun week, its
   *     month, or everything from `fromDate` on ('all', the original).
   *   - Each target's drills ARE REPLACED on the dates they receive, so the
   *     group ends up matching the source. Dates the source has nothing on
   *     are left completely alone.
   *   - Program days, not dates, whenever possible: a drill whose workout
   *     type has a program (hitting → Hitting Program, strength → Lifting,
   *     ...) that BOTH the source and a target have days in lands on the
   *     target's matching Day k of the same Mon–Sun week (Day k = k-th of
   *     their picked weekdays). Jack's Monday (Hitting Day 1) lands on a
   *     Tue/Thu hitter's Tuesday -- however that hitter was selected
   *     (2026-11-01: it first only applied to athletes reached through a
   *     ticked program box, and a hitter ticked by name got Monday). Only
   *     the types landing on a mapped date are replaced there. Everything
   *     else keeps its date. `programs` is accepted but no longer needed.
   *   - The source is skipped if it appears in the target list, so a coach
   *     ticking "Winter Program" cannot wipe the athlete they copied FROM.
   *   - `tabs` (workout types: hitting, pitching, ...) narrows BOTH sides:
   *     only those drills are copied, and only those types are replaced on
   *     the targets -- a hitter's own Strength day survives a Hitting-only
   *     apply. Omitted = every type, the original behaviour.
   */
  async applyCalendarToPlayers(
    sourcePlayerId: string,
    targetPlayerIds: string[],
    fromDate: string,
    actorUserId?: string,
    tabs?: string[],
    opts: { scope?: string; anchorDate?: string; programs?: string[] } = {},
  ) {
    if (!sourcePlayerId) throw new BadRequestException('sourcePlayerId is required');
    if (!ISO_DAY_RE.test(fromDate || '')) {
      throw new BadRequestException('fromDate must be YYYY-MM-DD');
    }
    const scope = (['day', 'week', 'month', 'all'] as const).find((s) => s === opts.scope) ?? 'all';
    const anchor = opts.anchorDate && ISO_DAY_RE.test(opts.anchorDate) ? opts.anchorDate : fromDate;

    /* Real players only — a bad id would otherwise create orphan rows that
       no calendar renders and nothing cleans up. */
    const requested = targetPlayerIds.filter((id) => id && id !== sourcePlayerId);
    const candidates = await this.prisma.player.findMany({
      where: { id: { in: requested } },
      select: { id: true, userId: true, facilitySchedule: true, user: { select: { status: true } } },
    });

    /* A locked athlete is paused: no access, and no program schedule pushed
       onto them. Filtering here — not just in the UI — means a stale client
       payload cannot schedule someone a coach has deliberately paused. */
    const targets = candidates.filter((t) => t.user?.status !== 'LOCKED');
    const skippedLocked = candidates.length - targets.length;

    if (targets.length === 0) {
      throw new BadRequestException(
        skippedLocked > 0
          ? 'Every selected athlete is locked — unlock them to schedule training'
          : 'No valid target athletes',
      );
    }

    const sourcePlayer = await this.prisma.player.findUnique({
      where: { id: sourcePlayerId },
      select: { firstName: true, facilitySchedule: true },
    });
    const sourceName = sourcePlayer?.firstName ?? 'this athlete';

    /* The source dates for the chosen scope. */
    let range: { gte: string; lte?: string };
    if (scope === 'day') range = { gte: anchor, lte: anchor };
    else if (scope === 'week') { const mon = mondayOf(anchor); range = { gte: mon, lte: addDays(mon, 6) }; }
    else if (scope === 'month') {
      const first = `${anchor.slice(0, 7)}-01`;
      const [y, m] = anchor.split('-').map(Number);
      const last = `${anchor.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
      range = { gte: first, lte: last };
    } else range = { gte: fromDate };

    const tabFilter = tabs && tabs.length > 0 ? [...new Set(tabs)] : null;
    const source = await this.prisma.scheduledDrill.findMany({
      where: { playerId: sourcePlayerId, date: range, ...(tabFilter ? { tab: { in: tabFilter } } : {}) },
      orderBy: [{ date: 'asc' }, { sectionOrder: 'asc' }, { order: 'asc' }],
    });
    const scopeWord = scope === 'day' ? 'on this day' : scope === 'week' ? 'in this week' : scope === 'month' ? 'in this month' : 'from this date forward';
    if (source.length === 0) {
      throw new BadRequestException(tabFilter
        ? `The selected athlete has none of those workouts scheduled ${scopeWord}`
        : `The selected athlete has nothing scheduled ${scopeWord}`);
    }
    const sourceByDate = new Map<string, typeof source>();
    for (const d of source) {
      const list = sourceByDate.get(d.date) ?? [];
      list.push(d);
      sourceByDate.set(d.date, list);
    }
    const dates = [...sourceByDate.keys()];

    /* Program-day matching. Each drill follows the program for its workout
       type (hitting → Hitting Program, strength → Lifting, a custom
       "Infield Program" → infield, ...). When the source AND a target both
       have days in that program, the source's Day k (k-th of their weekdays,
       Mon–Sun) lands on the target's Day k in the same week -- Jack's
       Monday Day 1 goes on Eddie's Tuesday Day 1. This applies to every
       target however they were picked (program box, season tag or by name);
       anything else keeps its date. Per type, so an athlete in Hitting AND
       Lifting gets each on the right day. */
    const allPrograms = await this.facilityPrograms.list();
    const tabProgram = (tab: string): string | null => {
      const builtIn: Record<string, string> = {
        hitting: 'HITTING_PROGRAM', pitching: 'PITCHING_PROGRAM', catching: 'CATCHING_PROGRAM', strength: 'LIFTING_PROGRAM',
      };
      if (builtIn[tab]) return builtIn[tab];
      return allPrograms.find((pr) => !pr.builtIn && pr.key.includes(tab.toUpperCase()))?.key ?? null;
    };
    const sourceDaysCache = new Map<string, WeekdayKey[]>();
    const sourceDays = (key: string) => {
      if (!sourceDaysCache.has(key)) sourceDaysCache.set(key, programDaysOf(sourcePlayer?.facilitySchedule, key));
      return sourceDaysCache.get(key)!;
    };

    const missing = new Set<string>(); // `${target}|${source date}|${program}`
    const usedPrograms = new Set<string>();
    type Row = Omit<(typeof source)[number], 'id' | 'playerId' | 'createdAt' | 'updatedAt'> & { playerId: string };
    const rows: Row[] = [];
    /* What each target date gets replaced: the whole day (a same-date copy
       with every type, as before) or just the types landing there. */
    const replace = new Map<string, { playerId: string; date: string; whole: boolean; tabs: Set<string> }>();
    for (const t of targets) {
      for (const d of source) {
        let td = d.date;
        let mapped = false;
        const prog = tabProgram(d.tab);
        if (prog) {
          const from = sourceDays(prog);
          const to = programDaysOf(t.facilitySchedule, prog);
          const k = from.indexOf(weekdayKeyOf(d.date));
          if (from.length && to.length && k >= 0) {
            const day = to[k];
            if (!day) { missing.add(`${t.id}|${d.date}|${prog}`); continue; } // they have fewer days a week
            td = addDays(mondayOf(d.date), WEEKDAY_KEYS.indexOf(day));
            mapped = true;
            usedPrograms.add(prog);
          }
        }
        rows.push({
          playerId: t.id,
          drillId: d.drillId,
          tab: d.tab,
          category: d.category,
          name: d.name,
          date: td,
          time: d.time,
          duration: d.duration,
          notes: d.notes,
          /* Carry the coach's drag-reorder so a copied day reads exactly like
             the one it came from. */
          order: d.order,
          sectionOrder: d.sectionOrder,
          block: d.block,
          environment: d.environment,
        } as Row);
        const rk = `${t.id}|${td}`;
        const entry = replace.get(rk) ?? { playerId: t.id, date: td, whole: false, tabs: new Set<string>() };
        if (!mapped && !tabFilter) entry.whole = true;
        entry.tabs.add(d.tab);
        replace.set(rk, entry);
      }
    }
    const missingDays = missing.size;
    if (rows.length === 0) {
      throw new BadRequestException('None of the selected athletes have a matching program day for those workouts');
    }

    /* Snapshot what is about to be destroyed BEFORE destroying it — this is
       the only record of the targets' previous plans, and undo restores from
       it verbatim. */
    const replaceWhere = {
      OR: [...replace.values()].map((r) => ({
        playerId: r.playerId,
        date: r.date,
        ...(r.whole ? {} : { tab: { in: [...r.tabs] } }),
      })),
    };
    const removed = await this.prisma.scheduledDrill.findMany({ where: replaceWhere });

    /* Ids are generated up front so the log can name exactly what this run
       created. createMany cannot return them, and "everything on those dates"
       would also sweep up rows a coach added afterwards. */
    const withIds = rows.map((r) => ({ ...r, id: randomUUID() }));

    /* Wipe-then-write as ONE transaction: a failure mid-way would otherwise
       leave targets with their old plan deleted and the new one missing. */
    await this.prisma.$transaction([
      this.prisma.scheduledDrill.deleteMany({ where: replaceWhere }),
      this.prisma.scheduledDrill.createMany({ data: withIds }),
    ]);

    const written = new Set(rows.map((r) => r.playerId));
    const tabNote = tabFilter
      ? ` (${tabFilter.map((t) => (t === 'strength' ? 'S&C' : t.charAt(0).toUpperCase() + t.slice(1))).join(', ')} only)`
      : '';
    const what = scope === 'day' ? 'day' : scope === 'week' ? 'week' : scope === 'month' ? 'month' : 'calendar';
    const programNote = usedPrograms.size
      ? `, matched to each athlete's ${allPrograms.filter((pr) => usedPrograms.has(pr.key)).map((pr) => pr.label).join(' / ')} days`
      : '';
    const missingNote = missingDays > 0
      ? ` ${missingDays} program day${missingDays === 1 ? ' was' : 's were'} skipped where an athlete has fewer days a week.`
      : '';
    const summary =
      `Applied ${sourceName}'s ${what}${tabNote} — ${rows.length} drill${rows.length === 1 ? '' : 's'} ` +
      `to ${written.size} athlete${written.size === 1 ? '' : 's'}${programNote}.${missingNote}`;

    const log = await this.prisma.calendarChangeLog.create({
      data: {
        kind: 'APPLY',
        actorId: actorUserId ?? null,
        summary,
        removedRows: JSON.stringify(removed),
        createdRowIds: JSON.stringify(withIds.map((r) => r.id)),
      },
      select: { id: true },
    });

    void this.notifyScheduledPlayers([...written]);

    return {
      players: written.size,
      dates: dates.length,
      drillsPerPlayer: source.length,
      drillsWritten: rows.length,
      skippedLocked,
      summary,
      logId: log.id,
    };
  }

  /**
   * Empty an athlete's schedule over a date range.
   *
   * Range comes from the caller as explicit dates rather than a "day / week /
   * all" keyword: the week a coach sees depends on their locale and timezone,
   * and the client already knows exactly which dates it drew. Omitting both
   * bounds clears everything.
   *
   * Logged like an apply, so the same Undo restores it.
   */
  async clearSchedule(
    playerId: string,
    startDate: string | undefined,
    endDate: string | undefined,
    actorUserId?: string,
  ) {
    /* Validate before touching Prisma: findUnique with an undefined id throws
       a client error, which surfaced as a bare 500 rather than telling the
       caller what was wrong. */
    if (!playerId || typeof playerId !== 'string') {
      throw new BadRequestException('playerId is required');
    }

    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { firstName: true },
    });
    if (!player) throw new NotFoundException('Player not found');

    const where: any = { playerId };
    if (startDate && endDate) where.date = { gte: startDate, lte: endDate };
    else if (startDate) where.date = { gte: startDate };
    else if (endDate) where.date = { lte: endDate };

    const removed = await this.prisma.scheduledDrill.findMany({ where });
    if (removed.length === 0) {
      throw new BadRequestException('Nothing scheduled in that range to clear');
    }

    await this.prisma.scheduledDrill.deleteMany({ where });

    const days = new Set(removed.map((r) => r.date)).size;
    const scope = startDate && endDate && startDate === endDate ? 'day'
      : startDate || endDate ? 'range'
        : 'whole calendar';
    const summary =
      `Cleared ${player.firstName}'s ${scope} — ${removed.length} drill${removed.length === 1 ? '' : 's'} ` +
      `across ${days} day${days === 1 ? '' : 's'}.`;

    const log = await this.prisma.calendarChangeLog.create({
      data: {
        kind: 'CLEAR',
        actorId: actorUserId ?? null,
        summary,
        removedRows: JSON.stringify(removed),
        createdRowIds: JSON.stringify([]),
      },
      select: { id: true },
    });

    return { drills: removed.length, days, summary, logId: log.id };
  }

  /**
   * Roll back one logged calendar change.
   *
   * Drops the rows that change created and restores the ones it removed, with
   * their original ids — so an undo lands the calendar exactly where it was,
   * not merely something equivalent. Both halves run in one transaction, and
   * the log is marked so the same change cannot be undone twice.
   */
  async undoCalendarChange(logId: string) {
    const log = await this.prisma.calendarChangeLog.findUnique({ where: { id: logId } });
    if (!log) throw new NotFoundException('That change is no longer on record');
    if (log.undone) throw new BadRequestException('That change has already been undone');

    let removed: any[] = [];
    let createdIds: string[] = [];
    try {
      removed = JSON.parse(log.removedRows);
      createdIds = JSON.parse(log.createdRowIds);
    } catch {
      throw new BadRequestException('That change cannot be undone — its record is unreadable');
    }

    /* Drop Prisma's relation fields and normalise dates: the snapshot came
       from findMany, so it carries whatever shape the row had. */
    const restore = removed.map((r) => ({
      id: r.id,
      playerId: r.playerId,
      drillId: r.drillId ?? null,
      tab: r.tab,
      category: r.category,
      name: r.name,
      date: r.date,
      time: r.time,
      duration: r.duration,
      notes: r.notes ?? null,
      order: r.order ?? 0,
      sectionOrder: r.sectionOrder ?? 0,
      block: r.block ?? null,
      environment: r.environment ?? null,
    }));

    await this.prisma.$transaction([
      this.prisma.scheduledDrill.deleteMany({ where: { id: { in: createdIds } } }),
      ...(restore.length ? [this.prisma.scheduledDrill.createMany({ data: restore })] : []),
      this.prisma.calendarChangeLog.update({
        where: { id: logId },
        data: { undone: true, undoneAt: new Date() },
      }),
    ]);

    return { restored: restore.length, discarded: createdIds.length };
  }

  /** Notify each given player once that new training hit their calendar. */
  private async notifyScheduledPlayers(playerIds: string[]) {
    const players = await this.prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { userId: true },
    });
    await this.notifications.notifyMany(
      players.map((p) => p.userId).filter((id): id is string => !!id),
      {
        type: 'SCHEDULE',
        title: 'New training scheduled',
        body: 'Your coach added new training to your calendar.',
        linkUrl: '/training',
      },
    );
  }

  async updateScheduledDrill(id: string, data: {
    /* playerId is included so the program-board's drag-drop flow can
       reassign a scheduled drill from one athlete to another with a
       single PATCH (rather than delete+recreate). */
    playerId?: string;
    drillId?: string;
    tab?: string;
    category?: string;
    name?: string;
    date?: string;
    time?: string;
    duration?: number;
    notes?: string | null;
    order?: number;
    sectionOrder?: number;
    block?: number | null;
    environment?: string | null;
  }) {
    return this.prisma.scheduledDrill.update({
      where: { id },
      data,
      include: { drill: true },
    });
  }

  /**
   * Coach drag-to-reorder. Persists new `order` (drill rank within its
   * section) and `sectionOrder` (the section's rank) for a set of drills in
   * one transaction. May also carry `playerId` / `category` so the same call
   * covers a cross-athlete reassign on the /program board (drop a drill onto
   * another athlete's column). Each item only writes the fields it provides.
   */
  async reorderScheduledDrills(items: {
    id: string;
    order?: number;
    sectionOrder?: number;
    playerId?: string;
    category?: string;
  }[]) {
    if (!items?.length) return { updated: 0 };
    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.scheduledDrill.update({
          where: { id: it.id },
          data: {
            ...(it.order !== undefined ? { order: it.order } : {}),
            ...(it.sectionOrder !== undefined ? { sectionOrder: it.sectionOrder } : {}),
            ...(it.playerId !== undefined ? { playerId: it.playerId } : {}),
            ...(it.category !== undefined ? { category: it.category } : {}),
          },
        }),
      ),
    );
    return { updated: items.length };
  }

  async deleteScheduledDrill(id: string) {
    return this.prisma.scheduledDrill.delete({ where: { id } });
  }

  // ─── Schedule Templates (named, reusable day plans) ───────────
  // Items are stored as a JSON string snapshot; the service validates it
  // parses to an array before writing so a bad client can't store junk
  // that later breaks every picker render. Applying a template happens
  // client-side via the existing createScheduledDrillsBatch.

  private assertTemplateItems(items: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(items);
    } catch {
      throw new BadRequestException('items must be a JSON array');
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new BadRequestException('items must be a non-empty JSON array');
    }
  }

  async listScheduleTemplates(tab?: string) {
    return this.prisma.scheduleTemplate.findMany({
      where: tab ? { tab } : undefined,
      orderBy: [{ tab: 'asc' }, { name: 'asc' }],
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
  }

  async createScheduleTemplate(data: { name: string; tab: string; items: string; createdById?: string }) {
    const { name, tab, items, createdById } = data;
    if (!name?.trim()) throw new BadRequestException('name is required');
    if (!tab?.trim()) throw new BadRequestException('tab is required');
    this.assertTemplateItems(items);
    return this.prisma.scheduleTemplate.create({
      data: { name: name.trim(), tab, items, createdById },
    });
  }

  async updateScheduleTemplate(id: string, data: { name?: string; items?: string }) {
    const existing = await this.prisma.scheduleTemplate.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Template not found');
    if (data.items !== undefined) this.assertTemplateItems(data.items);
    return this.prisma.scheduleTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.items !== undefined ? { items: data.items } : {}),
      },
    });
  }

  async deleteScheduleTemplate(id: string) {
    const existing = await this.prisma.scheduleTemplate.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Template not found');
    return this.prisma.scheduleTemplate.delete({ where: { id } });
  }

  // ─── Legacy Training Programs (kept for backward compat) ──────

  async createProgram(data: {
    playerId: string;
    name: string;
    startDate: Date;
    endDate: Date;
  }) {
    return this.prisma.trainingProgram.create({ data });
  }

  async getProgram(id: string) {
    const program = await this.prisma.trainingProgram.findUnique({
      where: { id },
      include: {
        days: {
          orderBy: { date: 'asc' },
          include: {
            exercises: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });
    if (!program) throw new NotFoundException('Training program not found');
    return program;
  }

  async getPlayerPrograms(playerId: string) {
    return this.prisma.trainingProgram.findMany({
      where: { playerId },
      orderBy: { startDate: 'desc' },
      include: {
        days: {
          orderBy: { date: 'asc' },
          include: { exercises: { select: { category: true } } },
        },
      },
    });
  }

  async addDay(programId: string, date: Date) {
    return this.prisma.trainingDay.create({
      data: { programId, date },
    });
  }

  async addExercise(dayId: string, data: {
    category: string;
    name: string;
    description?: string;
    demoVideoUrl?: string;
    sortOrder?: number;
  }) {
    return this.prisma.trainingExercise.create({
      data: { dayId, ...data },
    });
  }
}
