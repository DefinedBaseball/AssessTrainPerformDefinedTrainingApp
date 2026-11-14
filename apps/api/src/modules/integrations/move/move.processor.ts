import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AcademyService } from '../../academy/academy.service';
import { ReportsService } from '../../reports/reports.service';
import { localDate, mergeMoveSession, MoveSession, parseMoveSession, sessionLocalDay } from './move-session';

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
export class MoveProcessor {
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
}
