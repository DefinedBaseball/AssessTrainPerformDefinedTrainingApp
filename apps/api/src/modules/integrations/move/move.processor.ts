import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AcademyService } from '../../academy/academy.service';
import { ReportsService } from '../../reports/reports.service';
import {
  isMoveFileUrl, localDate, mergeMoveSession, MovePathData, MoveSession, parseMovePath, parseMoveSession, sessionLocalDay,
} from './move-session';

/* ─────────────────────────────────────────────────────────────────────────
   MOVE session -> athlete's Catching report.

   1. Find the athlete: a coach's saved link (from the Unmatched list), then
      the athlete's login email, then their Athlete ID -- each compared with
      MOVE's player.externalId (and the link also with player.moveId).
   2. Find the report: the athlete's Catching report that already holds this
      session (a resend / new revision), else their Catching report on the
      session's local date, else a new "MOVE Session" Catching report dated
      at the first catch.
   3. Store the catches under content.moveReceiving (see move-session.ts).

   TEST keys stop after step 2: the delivery shows where it WOULD go
   ("preview") and nothing is written to any athlete.
   ───────────────────────────────────────────────────────────────────────── */

export const MOVE_PROVIDER = 'move';

export type ProcessStatus = 'processed' | 'preview' | 'unmatched' | 'superseded' | 'error';

export interface ProcessOutcome {
  status: ProcessStatus;
  playerId?: string | null;
  reportId?: string | null;
  result: Record<string, unknown>;
}

@Injectable()
export class MoveProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(MoveProcessor.name);

  constructor(
    private prisma: PrismaService,
    private academy: AcademyService,
    private reports: ReportsService,
  ) {}

  /** Read + place one stored delivery and record the outcome on it. */
  async process(deliveryId: string): Promise<ProcessOutcome> {
    const d = await this.prisma.integrationDelivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, provider: true, kind: true, mode: true, payload: true },
    });
    if (!d) throw new Error('Delivery not found');

    let outcome: ProcessOutcome;
    try {
      outcome = await this.place(d.id, d.mode, JSON.parse(d.payload));
    } catch (err: any) {
      outcome = { status: 'error', result: { error: String(err?.message || err).slice(0, 500) } };
      this.logger.warn(`MOVE delivery ${d.id}: ${outcome.result.error}`);
    }
    await this.prisma.integrationDelivery.update({
      where: { id: d.id },
      data: {
        status: outcome.status,
        playerId: outcome.playerId ?? null,
        reportId: outcome.reportId ?? null,
        result: JSON.stringify(outcome.result),
        processedAt: new Date(),
      },
    });
    /* Copy the 3D paths in the background -- the partner's request
       doesn't wait for ~20 downloads. */
    if (outcome.status === 'processed') void this.savePaths(d.id).catch(() => {});
    return outcome;
  }

  /** The athlete a session belongs to, or null. */
  async matchAthlete(s: Pick<MoveSession, 'externalId' | 'moveId'>): Promise<{ id: string; name: string; via: string } | null> {
    const refs = [s.externalId, s.moveId].filter((r): r is string => !!r).map((r) => r.toLowerCase());
    const pick = (p: { id: string; firstName: string; lastName: string }, via: string) =>
      ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim(), via });

    if (refs.length) {
      const link = await this.prisma.integrationAthleteLink.findFirst({
        where: { provider: MOVE_PROVIDER, externalRef: { in: refs } },
        select: { player: { select: { id: true, firstName: true, lastName: true } } },
      });
      if (link?.player) return pick(link.player, 'link');
    }
    const ext = s.externalId?.trim();
    if (!ext) return null;
    if (ext.includes('@')) {
      const user = await this.prisma.user.findFirst({
        where: { email: { in: [ext, ext.toLowerCase()] }, role: 'PLAYER' },
        select: { player: { select: { id: true, firstName: true, lastName: true } } },
      });
      if (user?.player) return pick(user.player, 'email');
      /* Older accounts can hold a mixed-case email ("John@X.com"; new ones
         are stored lower-case) -- compare case-insensitively. Plain SQL so
         it runs on both SQLite (local) and Postgres (Render). */
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "User" WHERE LOWER("email") = ${ext.toLowerCase()} AND "role" = 'PLAYER' LIMIT 1`;
      if (rows[0]) {
        const p = await this.prisma.player.findUnique({
          where: { userId: rows[0].id },
          select: { id: true, firstName: true, lastName: true },
        });
        if (p) return pick(p, 'email');
      }
    }
    const byCode = await this.prisma.player.findFirst({
      where: { athleteCode: ext.toUpperCase() },
      select: { id: true, firstName: true, lastName: true },
    });
    return byCode ? pick(byCode, 'athleteId') : null;
  }

  private async place(deliveryId: string, mode: string, body: unknown): Promise<ProcessOutcome> {
    const s = parseMoveSession(body);
    const counted = s.catches.filter((c) => !c.withdrawn).length;
    const base = {
      sessionId: s.sessionId,
      revision: s.revision,
      catches: s.catchCount,
      counted,
      externalId: s.externalId,
      moveId: s.moveId,
    };

    const athlete = await this.matchAthlete(s);
    if (!athlete) return { status: 'unmatched', result: base };

    const tz = (await this.academy.get()).timeZone || undefined;
    const day = sessionLocalDay(s, tz);
    const target = await this.findReport(athlete.id, s.baseSessionId, day);
    const summary = { ...base, athlete: athlete.name, matchedBy: athlete.via, date: day.date };

    if (mode !== 'live') {
      return {
        status: 'preview', playerId: athlete.id, reportId: target?.id ?? null,
        result: { ...summary, wouldCreateReport: !target },
      };
    }

    if (target) {
      let content: Record<string, any> = {};
      try { content = JSON.parse(target.content || '{}') ?? {}; } catch { /* treat as empty */ }
      const merged = mergeMoveSession(content.moveReceiving, s, deliveryId);
      if (!merged) {
        return { status: 'superseded', playerId: athlete.id, reportId: target.id, result: { ...summary, note: 'A newer revision of this session is already on the report' } };
      }
      await this.reports.mergeContent(target.id, { set: { moveReceiving: merged } });
      return { status: 'processed', playerId: athlete.id, reportId: target.id, result: { ...summary, createdReport: false } };
    }

    const merged = mergeMoveSession(null, s, deliveryId)!;
    const created = await this.prisma.report.create({
      data: {
        playerId: athlete.id,
        createdById: null,
        reportType: 'CATCHING',
        title: 'MOVE Session',
        content: JSON.stringify({ moveReceiving: merged }),
        createdAt: new Date(s.firstCatchAt),
      },
      select: { id: true },
    });
    return { status: 'processed', playerId: athlete.id, reportId: created.id, result: { ...summary, createdReport: true } };
  }

  /** The Catching report this session belongs on, if one exists. */
  private async findReport(playerId: string, baseSessionId: string, day: { date: string; offsetMinutes: number | null; tz: string | null }) {
    const holding = await this.prisma.report.findFirst({
      where: { playerId, reportType: 'CATCHING', content: { contains: JSON.stringify(baseSessionId) } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, content: true },
    });
    if (holding) return holding;
    /* Same local day as the session -- a window of +/- 2 days by UTC, then
       an exact local-date check. Newest first. */
    const t = Date.parse(`${day.date}T12:00:00Z`);
    const rows = await this.prisma.report.findMany({
      where: {
        playerId, reportType: 'CATCHING',
        createdAt: { gte: new Date(t - 2 * 86_400_000), lte: new Date(t + 2 * 86_400_000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, content: true, createdAt: true },
    });
    return rows.find((r) => localDate(r.createdAt, day) === day.date) ?? null;
  }

  /** Re-run every unmatched MOVE delivery (after a coach links an athlete). */
  async retryUnmatched(): Promise<number> {
    const rows = await this.prisma.integrationDelivery.findMany({
      where: { provider: MOVE_PROVIDER, status: 'unmatched' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
      take: 500,
    });
    let placed = 0;
    for (const r of rows) {
      const o = await this.process(r.id);
      if (o.status !== 'unmatched') placed++;
    }
    return placed;
  }
  /* ── 3D glove paths ─────────────────────────────────────────────────
     MOVE's path3d links expire after about a week, so each catch's path is
     copied into MovePath as soon as its session is on a report (live keys
     only). A sweep shortly after start-up catches anything missed -- e.g.
     sessions placed before this existed, or a deploy mid-download. */

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    const timer = setTimeout(() => { void this.sweepPaths(); }, 45_000);
    timer.unref?.();
  }

  /** Copy the paths for every recent live session that's on a report. */
  async sweepPaths(): Promise<void> {
    try {
      const rows = await this.prisma.integrationDelivery.findMany({
        where: { provider: MOVE_PROVIDER, status: 'processed', mode: 'live', createdAt: { gte: new Date(Date.now() - 9 * 86_400_000) } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
        take: 300,
      });
      for (const r of rows) await this.savePaths(r.id);
    } catch (err: any) {
      this.logger.warn(`MOVE path sweep failed: ${err?.message || err}`);
    }
  }

  /** Download + store the 3D paths of one placed session. Returns counts. */
  async savePaths(deliveryId: string): Promise<{ saved: number; skipped: number; failed: number }> {
    const out = { saved: 0, skipped: 0, failed: 0 };
    const d = await this.prisma.integrationDelivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true, mode: true, playerId: true, payload: true },
    });
    if (!d || d.status !== 'processed' || d.mode !== 'live' || !d.playerId) return out;
    let s: MoveSession;
    try { s = parseMoveSession(JSON.parse(d.payload)); } catch { return out; }

    const wanted = s.catches.filter((c) => c.path3d && isMoveFileUrl(c.path3d.url)
      && (!c.path3d.expiresAt || Date.parse(c.path3d.expiresAt) > Date.now()));
    const have = new Set((await this.prisma.movePath.findMany({
      where: { catchId: { in: wanted.map((c) => c.catchId) } },
      select: { catchId: true, playerId: true },
    })).filter((r) => r.playerId === d.playerId).map((r) => r.catchId));

    for (const c of wanted) {
      if (have.has(c.catchId)) { out.skipped++; continue; }
      try {
        const data = parseMovePath(await fetchJson(c.path3d!.url));
        await this.prisma.movePath.upsert({
          where: { catchId: c.catchId },
          create: { catchId: c.catchId, playerId: d.playerId, deliveryId: d.id, data: JSON.stringify(data) },
          update: { playerId: d.playerId, deliveryId: d.id, data: JSON.stringify(data), fetchedAt: new Date() },
        });
        out.saved++;
      } catch (err: any) {
        out.failed++;
        this.logger.warn(`MOVE path ${c.catchId}: ${err?.message || err}`);
      }
    }
    return out;
  }

  /** One stored path, with the athlete it belongs to (for the access check). */
  async getPath(catchId: string): Promise<{ playerId: string; data: MovePathData } | null> {
    const row = await this.prisma.movePath.findUnique({ where: { catchId }, select: { playerId: true, data: true } });
    return row ? { playerId: row.playerId, data: JSON.parse(row.data) } : null;
  }
}

const MAX_PATH_BYTES = 1_500_000;

/** GET a MOVE file as JSON: 15 s limit, 1.5 MB cap. */
async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'error' });
    if (!res.ok) throw new Error(`MOVE file answered ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_PATH_BYTES) throw new Error('MOVE file is too large');
    const text = await res.text();
    if (text.length > MAX_PATH_BYTES) throw new Error('MOVE file is too large');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}
