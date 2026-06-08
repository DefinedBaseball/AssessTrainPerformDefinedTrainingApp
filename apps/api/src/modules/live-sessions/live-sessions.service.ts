import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/* ─────────────────────────────────────────────────────────────────────
   LiveSessionsService — Phase 2 surface.
   Backs the /live coach-led session flows. Phase 2 covers TRAINING
   mode end-to-end: create a session, optionally rename it, attach
   per-player training clips on session end, mark the session
   completed. Phase 3 will extend the same service with LIVE-mode
   at-bat creation + pitch logging without changing the existing
   training-clip surface.
   ───────────────────────────────────────────────────────────────── */

export interface CreateLiveSessionInput {
  createdById: string;
  mode: 'TRAINING' | 'LIVE';
  position?: string;
  notes?: string;
}

export interface UpdateLiveSessionInput {
  notes?: string;
  status?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  endedAt?: Date | null;
}

export interface CreateTrainingClipInput {
  liveSessionId: string;
  playerId: string;
  videoId?: string | null;
  savedToReportId?: string | null;
}

@Injectable()
export class LiveSessionsService {
  constructor(private prisma: PrismaService) {}

  // ── Live Sessions ──────────────────────────────────────────────

  create(input: CreateLiveSessionInput) {
    return this.prisma.liveSession.create({
      data: {
        createdById: input.createdById,
        mode: input.mode,
        position: input.position ?? null,
        notes: input.notes ?? null,
        // `status` defaults to ACTIVE in the schema; `startedAt`
        // defaults to now(). We just initialize the FK + mode.
      },
    });
  }

  async findOne(id: string) {
    const session = await this.prisma.liveSession.findUnique({
      where: { id },
      // Includes are scoped to what the /live UI needs on detail
      // load (session header + clips list + at-bats list). Each
      // sub-collection is small (a single session's worth) so the
      // payload stays compact.
      include: {
        trainingClips: {
          orderBy: { recordedAt: 'asc' },
          include: {
            player: { select: { id: true, firstName: true, lastName: true, positions: true, profilePhoto: true } },
            video: { select: { id: true, originalUrl: true, hlsUrl: true, thumbnailUrl: true, status: true } },
          },
        },
        atBats: {
          orderBy: { startedAt: 'asc' },
          include: {
            hitter:  { select: { id: true, firstName: true, lastName: true, positions: true } },
            pitcher: { select: { id: true, firstName: true, lastName: true, positions: true, throws: true } },
            pitches: { orderBy: { pitchNumber: 'asc' } },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Live session not found');
    return session;
  }

  /** Most recent sessions started by a coach. Used by the /live
   *  landing page to surface in-progress sessions (status=ACTIVE)
   *  so the coach can resume one rather than starting fresh. */
  findRecent(createdById: string, limit = 25) {
    return this.prisma.liveSession.findMany({
      where: { createdById },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: {
        _count: { select: { trainingClips: true, atBats: true } },
      },
    });
  }

  update(id: string, input: UpdateLiveSessionInput) {
    return this.prisma.liveSession.update({
      where: { id },
      data: {
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.endedAt !== undefined ? { endedAt: input.endedAt } : {}),
      },
    });
  }

  /** Convenience: mark a session COMPLETED and stamp `endedAt`. */
  end(id: string) {
    return this.prisma.liveSession.update({
      where: { id },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });
  }

  // ── Training Clips ─────────────────────────────────────────────

  createTrainingClip(input: CreateTrainingClipInput) {
    return this.prisma.trainingClip.create({
      data: {
        liveSessionId: input.liveSessionId,
        playerId: input.playerId,
        videoId: input.videoId ?? null,
        savedToReportId: input.savedToReportId ?? null,
      },
    });
  }

  async updateTrainingClip(
    id: string,
    input: { videoId?: string | null; savedToReportId?: string | null },
  ) {
    return this.prisma.trainingClip.update({
      where: { id },
      data: {
        ...(input.videoId !== undefined ? { videoId: input.videoId } : {}),
        ...(input.savedToReportId !== undefined ? { savedToReportId: input.savedToReportId } : {}),
      },
    });
  }

  deleteTrainingClip(id: string) {
    return this.prisma.trainingClip.delete({ where: { id } });
  }

  // ── At-Bats (Phase 3 LIVE-mode capture) ────────────────────────

  /** Create a new in-progress at-bat. `pitcherHandedness` is a
   *  snapshot stored on the row at AB-start so historical filters
   *  ("vs LHP / vs RHP") stay accurate if the pitcher's `throws`
   *  field is later corrected. */
  createAtBat(input: {
    liveSessionId?: string | null;
    hitterId: string;
    pitcherId?: string | null;
    pitcherHandedness?: string | null;
  }) {
    return this.prisma.atBat.create({
      data: {
        liveSessionId:     input.liveSessionId ?? null,
        hitterId:          input.hitterId,
        pitcherId:         input.pitcherId ?? null,
        pitcherHandedness: input.pitcherHandedness ?? null,
      },
    });
  }

  /** Update an in-progress at-bat. Setting `outcome` typically also
   *  stamps `endedAt = now()` on the same call. */
  updateAtBat(id: string, input: {
    outcome?: string | null;
    endedAt?: Date | null;
    reportId?: string | null;
    videoId?: string | null;
  }) {
    return this.prisma.atBat.update({
      where: { id },
      data: {
        ...(input.outcome  !== undefined ? { outcome: input.outcome }   : {}),
        ...(input.endedAt  !== undefined ? { endedAt: input.endedAt }   : {}),
        ...(input.reportId !== undefined ? { reportId: input.reportId } : {}),
        ...(input.videoId  !== undefined ? { videoId: input.videoId }   : {}),
      },
    });
  }

  /** Mark an at-bat as ended with a final outcome — convenience
   *  wrapper around `updateAtBat` so the controller stays clean.
   *  `sprayX` / `sprayY` are the normalized field coordinates the
   *  coach tapped on the live-tracker mini field for in-play
   *  outcomes; they're null for strikeouts and walks. */
  closeAtBat(id: string, outcome: string, sprayX: number | null = null, sprayY: number | null = null) {
    return this.prisma.atBat.update({
      where: { id },
      data: { outcome, sprayX, sprayY, endedAt: new Date() },
    });
  }

  /** List at-bats for a hitter or pitcher (or both). Used by the
   *  "Live Results" history surfaces and the Spray-Decision
   *  consumer in the Hitting tab. `limit` defaults to 50 (matches
   *  the Swing-Decision Spray Chart's last-50 contract). `since`
   *  is an optional ISO date string used by the "Last Year" chip. */
  listAtBats(filters: {
    hitterId?: string;
    pitcherId?: string;
    pitcherHandedness?: 'L' | 'R';
    limit?: number;
    since?: Date;
  }) {
    const limit = filters.limit && filters.limit > 0
      ? Math.min(filters.limit, 1000)
      : 50;
    return this.prisma.atBat.findMany({
      where: {
        ...(filters.hitterId          ? { hitterId: filters.hitterId } : {}),
        ...(filters.pitcherId         ? { pitcherId: filters.pitcherId } : {}),
        ...(filters.pitcherHandedness ? { pitcherHandedness: filters.pitcherHandedness } : {}),
        ...(filters.since             ? { startedAt: { gte: filters.since } } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: {
        hitter:  { select: { id: true, firstName: true, lastName: true, positions: true } },
        pitcher: { select: { id: true, firstName: true, lastName: true, positions: true, throws: true } },
        pitches: { orderBy: { pitchNumber: 'asc' } },
      },
    });
  }

  // ── Pitches ───────────────────────────────────────────────────

  /** Append a pitch to an in-progress at-bat. `pitchNumber` is
   *  computed server-side as `count(existingPitches) + 1` to keep
   *  the client thin — clients only send the pitchType / result. */
  async createPitch(input: {
    atBatId: string;
    pitchType: string;
    callBallStrike?: string | null;
    result?: string | null;
  }) {
    const existing = await this.prisma.pitch.count({ where: { atBatId: input.atBatId } });
    return this.prisma.pitch.create({
      data: {
        atBatId:        input.atBatId,
        pitchNumber:    existing + 1,
        pitchType:      input.pitchType,
        callBallStrike: input.callBallStrike ?? null,
        result:         input.result ?? null,
      },
    });
  }

  updatePitch(id: string, input: {
    pitchType?: string;
    callBallStrike?: string | null;
    result?: string | null;
  }) {
    return this.prisma.pitch.update({
      where: { id },
      data: {
        ...(input.pitchType      !== undefined ? { pitchType:      input.pitchType }      : {}),
        ...(input.callBallStrike !== undefined ? { callBallStrike: input.callBallStrike } : {}),
        ...(input.result         !== undefined ? { result:         input.result }         : {}),
      },
    });
  }

  deletePitch(id: string) {
    return this.prisma.pitch.delete({ where: { id } });
  }
}
