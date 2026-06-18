import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LiveSessionsService } from './live-sessions.service';
import { Roles, AuthenticatedRequest } from '../auth/jwt.guard';

/* ─────────────────────────────────────────────────────────────────────
   LiveSessionsController — REST surface for /api/live-sessions and
   the nested /api/live-sessions/:id/training-clips. All endpoints
   are COACH-only since live sessions are coach-led capture flows
   (athletes don't start their own sessions). The training-clip
   endpoints are nested under their parent session for clarity; the
   delete + update endpoints take the clip id directly for simpler
   client wiring.
   ───────────────────────────────────────────────────────────────── */

class CreateLiveSessionDto {
  /** 'TRAINING' or 'LIVE'. */
  mode!: 'TRAINING' | 'LIVE';
  /** Only required for TRAINING mode — the position being trained
   *  (HITTING / PITCHING / INFIELD / OUTFIELD / CATCHING). */
  position?: string;
  notes?: string;
}

class UpdateLiveSessionDto {
  notes?: string;
  status?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}

class CreateTrainingClipDto {
  playerId!: string;
  /** Optional — when omitted the clip is created without a video
   *  FK (used during recording, before the upload completes). */
  videoId?: string;
  savedToReportId?: string;
}

class UpdateTrainingClipDto {
  videoId?: string | null;
  savedToReportId?: string | null;
}

// ── AtBat + Pitch DTOs (Phase 3 — declared above the controller
// because NestJS evaluates `@Body() dto: SomeDto` parameter
// decorators at class-declaration time. Classes hoist by NAME but
// not by initialization, so a forward reference from above to a
// class block below the controller throws
// `ReferenceError: Cannot access X before initialization` at boot. */

class CreateAtBatDto {
  hitterId!: string;
  pitcherId?: string | null;
  pitcherHandedness?: string | null;
}

class UpdateAtBatDto {
  outcome?: string | null;
  endedAt?: string | null;
  reportId?: string | null;
  videoId?: string | null;
}

class CreatePitchDto {
  pitchType!: string;
  callBallStrike?: string | null;
  result?: string | null;
}

class UpdatePitchDto {
  pitchType?: string;
  callBallStrike?: string | null;
  result?: string | null;
}

@ApiTags('live-sessions')
@ApiBearerAuth()
@Controller('live-sessions')
export class LiveSessionsController {
  constructor(private liveSessionsService: LiveSessionsService) {}

  // ── Sessions ───────────────────────────────────────────────────

  @Post()
  @Roles('COACH')
  @ApiOperation({ summary: 'Start a Live Session (COACH only)' })
  create(@Request() req: AuthenticatedRequest, @Body() dto: CreateLiveSessionDto) {
    // `req.user!.sub` is the coach's User id from the JWT (`sub`
    // is the JWT-standard subject claim, see `JwtPayload` in
    // auth/jwt.util.ts). We never trust a `createdById` from the
    // client — the server always stamps the authenticated user's
    // id onto the row.
    const createdById = req.user!.sub;
    return this.liveSessionsService.create({
      createdById,
      mode: dto.mode,
      position: dto.position,
      notes: dto.notes,
    });
  }

  @Get()
  @Roles('COACH')
  @ApiOperation({ summary: 'List recent Live Sessions started by the calling coach' })
  findRecent(@Request() req: AuthenticatedRequest, @Query('limit') limit?: string) {
    const createdById = req.user!.sub;
    const lim = limit ? Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100) : 25;
    return this.liveSessionsService.findRecent(createdById, lim);
  }

  /** Phase 3 — at-bat list endpoint declared BEFORE the `:id`
   *  session-detail route because NestJS matches routes in
   *  declaration order. With one path segment on both, a request
   *  to `GET /live-sessions/at-bats` would otherwise resolve to
   *  the `:id` handler with `id="at-bats"` and 404 on the session
   *  lookup. Two-segment routes (`/:id/at-bats`, `/training-clips/:id`,
   *  `/at-bats/:id/...`, `/pitches/:id`) don't conflict with the
   *  one-segment `:id` matcher and stay in their natural grouped
   *  positions below. */
  @Get('at-bats')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'List at-bats by hitter/pitcher (ownership-checked)' })
  listAtBats(
    @Request() req: AuthenticatedRequest,
    @Query('hitterId')          hitterId?: string,
    @Query('pitcherId')         pitcherId?: string,
    @Query('pitcherHandedness') pitcherHandedness?: 'L' | 'R',
    @Query('limit')             limit?: string,
    @Query('since')             since?: string,
  ) {
    // Players can only fetch at-bats for THEIR OWN player record
    // (either as hitter or pitcher). Coaches see anything they
    // query. Mirrors the ownership pattern Reports uses.
    if (req.user?.role === 'PLAYER') {
      const myPlayerId = req.user.playerId;
      if (!myPlayerId) return [];
      if (hitterId  && hitterId  !== myPlayerId) return [];
      if (pitcherId && pitcherId !== myPlayerId) return [];
      if (!hitterId && !pitcherId) hitterId = myPlayerId;
    }
    const lim = limit ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 1000) : 50;
    const sinceDate = since ? new Date(since) : undefined;
    return this.liveSessionsService.listAtBats({
      hitterId, pitcherId, pitcherHandedness, limit: lim, since: sinceDate,
    });
  }

  @Get(':id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Get a Live Session by id (with training clips + at-bats)' })
  findOne(@Param('id') id: string) {
    return this.liveSessionsService.findOne(id);
  }

  @Patch(':id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Update a Live Session (notes / status, COACH only)' })
  update(@Param('id') id: string, @Body() dto: UpdateLiveSessionDto) {
    return this.liveSessionsService.update(id, dto);
  }

  @Post(':id/end')
  @Roles('COACH')
  @ApiOperation({ summary: 'Mark a Live Session COMPLETED and stamp endedAt' })
  end(@Param('id') id: string) {
    return this.liveSessionsService.end(id);
  }

  // ── Training Clips (nested) ────────────────────────────────────

  @Post(':id/training-clips')
  @Roles('COACH')
  @ApiOperation({ summary: 'Create a training clip row inside a session' })
  createTrainingClip(@Param('id') sessionId: string, @Body() dto: CreateTrainingClipDto) {
    return this.liveSessionsService.createTrainingClip({
      liveSessionId: sessionId,
      playerId: dto.playerId,
      videoId: dto.videoId,
      savedToReportId: dto.savedToReportId,
    });
  }

  @Patch('training-clips/:clipId')
  @Roles('COACH')
  @ApiOperation({ summary: 'Update a training clip (attach videoId, set saved-to-report)' })
  updateTrainingClip(@Param('clipId') clipId: string, @Body() dto: UpdateTrainingClipDto) {
    return this.liveSessionsService.updateTrainingClip(clipId, dto);
  }

  @Delete('training-clips/:clipId')
  @Roles('COACH')
  @ApiOperation({ summary: 'Discard a training clip (does NOT delete the Video, if any)' })
  deleteTrainingClip(@Param('clipId') clipId: string) {
    return this.liveSessionsService.deleteTrainingClip(clipId);
  }

  // ── At-Bats (Phase 3 — LIVE-mode capture) ─────────────────────

  @Post(':id/at-bats')
  @Roles('COACH')
  @ApiOperation({ summary: 'Create an at-bat inside a session (COACH only)' })
  createAtBat(
    @Param('id') sessionId: string,
    @Body() dto: CreateAtBatDto,
  ) {
    return this.liveSessionsService.createAtBat({
      liveSessionId:     sessionId,
      hitterId:          dto.hitterId,
      pitcherId:         dto.pitcherId,
      pitcherHandedness: dto.pitcherHandedness,
    });
  }

  @Patch('at-bats/:atBatId')
  @Roles('COACH')
  @ApiOperation({ summary: 'Update an at-bat (outcome, attach report/video)' })
  updateAtBat(
    @Param('atBatId') atBatId: string,
    @Body() dto: UpdateAtBatDto,
  ) {
    // The DTO accepts `endedAt` as an ISO string from the wire — coerce
    // to a Date before passing into the Prisma-typed service signature.
    const { endedAt, ...rest } = dto;
    return this.liveSessionsService.updateAtBat(atBatId, {
      ...rest,
      ...(endedAt !== undefined
        ? { endedAt: endedAt === null ? null : new Date(endedAt) }
        : {}),
    });
  }

  @Post('at-bats/:atBatId/close')
  @Roles('COACH')
  @ApiOperation({ summary: 'Mark an at-bat as ended with a final outcome' })
  closeAtBat(
    @Param('atBatId') atBatId: string,
    /* `sprayX` / `sprayY` are optional — required for in-play
       outcomes (BARREL / FLY_BALL / GROUND_BALL / LINE_DRIVE) where
       the coach taps a location on the live-tracker mini field;
       omitted for strikeouts and walks where no field location
       applies. Both values are normalized to [0,1]. */
    @Body() dto: { outcome: string; sprayX?: number | null; sprayY?: number | null; qualityOfContact?: string | null },
  ) {
    return this.liveSessionsService.closeAtBat(atBatId, dto.outcome, dto.sprayX ?? null, dto.sprayY ?? null, dto.qualityOfContact ?? null);
  }

  // ── Pitches ───────────────────────────────────────────────────

  @Post('at-bats/:atBatId/pitches')
  @Roles('COACH')
  @ApiOperation({ summary: 'Append a pitch to an at-bat (auto-increments pitchNumber)' })
  createPitch(
    @Param('atBatId') atBatId: string,
    @Body() dto: CreatePitchDto,
  ) {
    return this.liveSessionsService.createPitch({
      atBatId,
      pitchType:      dto.pitchType,
      callBallStrike: dto.callBallStrike,
      result:         dto.result,
    });
  }

  @Patch('pitches/:pitchId')
  @Roles('COACH')
  @ApiOperation({ summary: 'Update a pitch (correct mis-tagged type / result)' })
  updatePitch(
    @Param('pitchId') pitchId: string,
    @Body() dto: UpdatePitchDto,
  ) {
    return this.liveSessionsService.updatePitch(pitchId, dto);
  }

  @Delete('pitches/:pitchId')
  @Roles('COACH')
  @ApiOperation({ summary: 'Delete a mis-tapped pitch (e.g. accidental input)' })
  deletePitch(@Param('pitchId') pitchId: string) {
    return this.liveSessionsService.deletePitch(pitchId);
  }
}
