import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Request, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlayersService } from './players.service';
import { Roles, Public, AdminOnly, assertPlayerOwnership, AuthenticatedRequest, ParentAllowed } from '../auth/jwt.guard';

class CreatePlayerDto {
  userId!: string;
  firstName!: string;
  lastName!: string;
  positions!: string;
  heightInches?: number;
  weightLbs?: number;
  gradYear?: number;
}

/* What an athlete may change about themselves: the personal information on
   the Edit Profile form. Everything else on the Player row -- roster tags,
   the coach's development notes, tab visibility -- stays coach-only, and
   baseball data (metrics, reports, uploads) lives behind coach-only routes
   altogether. Unknown keys are dropped; a value of the wrong type is
   refused rather than handed to the database. */
const ATHLETE_TEXT_FIELDS = [
  'firstName', 'lastName', 'positions', 'bats', 'throws', 'birthDate',
  'highSchool', 'clubTeam', 'college', 'professionalTeam', 'collegeCommit',
  'parentEmail', 'parentPhone', 'playingLevelGoal', 'mainGoal', 'goals', 'longTermGoals',
  'trainingHistory', 'trainingAvailability', 'otherSports', 'injuryHistory',
] as const;
const ATHLETE_NUMBER_FIELDS = [
  'heightInches', 'weightLbs', 'gradYear', 'pbrNational', 'pbrState', 'pbrPosition', 'pgScore',
] as const;

function athleteEditableFields(dto: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of ATHLETE_TEXT_FIELDS) {
    if (!(k in (dto || {}))) continue;
    const v = dto[k];
    if (v !== null && typeof v !== 'string') throw new BadRequestException(`${k} must be text`);
    if (typeof v === 'string' && v.length > 2000) throw new BadRequestException(`${k} is too long`);
    if ((k === 'firstName' || k === 'lastName') && !(typeof v === 'string' && v.trim())) continue;
    out[k] = v;
  }
  for (const k of ATHLETE_NUMBER_FIELDS) {
    if (!(k in (dto || {}))) continue;
    const v = dto[k];
    if (v !== null && !(typeof v === 'number' && Number.isFinite(v))) throw new BadRequestException(`${k} must be a number`);
    out[k] = v;
  }
  return out;
}

class UpdatePlayerDto {
  firstName?: string;
  lastName?: string;
  positions?: string;
  athleteTypes?: string; // comma-separated: PROGRAM,LESSON,MEMBERSHIP,REMOTE
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
  professionalTeam?: string | null;
  collegeCommit?: string | null;
  parentEmail?: string | null;
  parentPhone?: string | null;
  pbrNational?: number | null;
  pbrState?: number | null;
  pbrPosition?: number | null;
  pgScore?: number | null;
  developmentNotes?: string | null;
}

@ApiTags('players')
@ApiBearerAuth()
@Controller('players')
export class PlayersController {
  constructor(private playersService: PlayersService) {}

  @Post()
  @Roles('COACH')
  @ApiOperation({ summary: 'Create a new player profile (COACH only)' })
  create(@Body() dto: CreatePlayerDto) {
    return this.playersService.create(dto);
  }

  @Get()
  @Roles('COACH')
  @ApiOperation({ summary: 'List all players (COACH only — roster view)' })
  findAll(
    @Query('gradYear') gradYear?: string,
    @Query('position') position?: string,
  ) {
    return this.playersService.findAll({
      gradYear: gradYear ? parseInt(gradYear) : undefined,
      position,
    });
  }

  @Get(':id')
  @Roles('COACH', 'PLAYER', 'PARENT')
  @ParentAllowed() // linked parents read (ownership-checked)
  @ApiOperation({ summary: 'Get a player profile (ownership-checked)' })
  findOne(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    assertPlayerOwnership(req, id);
    return this.playersService.findOne(id);
  }

  @Patch(':id')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Update player profile (athletes: their own personal information only)' })
  async update(@Request() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdatePlayerDto) {
    assertPlayerOwnership(req, id);
    if (req.user?.role === 'PLAYER') {
      const saved = await this.playersService.update(id, athleteEditableFields(dto));
      void this.playersService.notifyCoachesOfAthleteEdit(id, 'profile');
      return saved;
    }
    return this.playersService.update(id, dto);
  }

  @Delete(':id/account')
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Permanently delete an athlete who requested account deletion (admin)' })
  deleteAccount(@Param('id') id: string) {
    return this.playersService.deleteAthleteAccount(id);
  }

  /* Admin deletes an athlete directly (Edit Profile / Athlete Hub) -- no
     request from the athlete needed. Same permanent clean-up as above. */
  @Delete(':id')
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Permanently delete an athlete account and all of its data (admin)' })
  deleteAthlete(@Param('id') id: string) {
    return this.playersService.deleteAthleteAccount(id, { requireRequest: false });
  }

  @Delete(':id/deletion-request')
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: "Keep the account: clear an athlete's deletion request (admin)" })
  dismissDeletionRequest(@Param('id') id: string) {
    return this.playersService.dismissDeletionRequest(id);
  }

  @Put(':id/photo')
  @Roles('COACH', 'PLAYER')
  @Throttle({ short: { limit: 30, ttl: 600_000 } })
  @ApiOperation({ summary: "Set an athlete's profile picture from a data URL (coaches; athletes: their own)" })
  setPhoto(@Request() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: { dataUrl?: unknown }) {
    assertPlayerOwnership(req, id);
    return this.playersService.setPhoto(id, dto?.dataUrl);
  }

  @Delete(':id/photo')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: "Remove an athlete's profile picture (coaches; athletes: their own)" })
  removePhoto(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    assertPlayerOwnership(req, id);
    return this.playersService.removePhoto(id);
  }

  @Post(':id/profile-reminder')
  @Roles('COACH')
  /* Nudges one athlete to finish their profile. Throttled at the same rate as
     /auth/invite: it neither creates nor changes anything, it just mails one
     existing athlete, and a coach working down the Client Directory would
     otherwise trip a tighter cap. */
  @Throttle({ short: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Email an athlete a reminder to complete their profile (COACH only)' })
  profileReminder(@Param('id') id: string) {
    return this.playersService.sendProfileReminder(id);
  }

  @Get(':id/report-email-draft')
  @Roles('COACH')
  @ApiOperation({ summary: 'Starting subject + message for emailing a report PDF (COACH only)' })
  reportEmailDraft(@Param('id') id: string) {
    return this.playersService.reportEmailDraft(id);
  }

  @Post(':id/report-email')
  @Roles('COACH')
  /* Emails a report PDF the coach just built to the athlete and/or their
     guardian. Addresses come from the athlete's record on the server, never
     from the request, so this can't be pointed at an arbitrary inbox.
     Throttled like the profile reminder. */
  @Throttle({ short: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Email a report PDF to the athlete and/or guardian (COACH only)' })
  emailReport(
    @Param('id') id: string,
    @Body() body: { recipients?: unknown; filename?: unknown; pdfBase64?: unknown; subject?: unknown; message?: unknown },
  ) {
    return this.playersService.emailReportPdf(id, body);
  }

  @Patch(':id/season-stats')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: "Replace an athlete's season stats (athletes: their own)" })
  async setSeasonStats(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: { stats: unknown },
  ) {
    assertPlayerOwnership(req, id);
    const saved = await this.playersService.setSeasonStats(id, dto?.stats);
    if (req.user?.role === 'PLAYER') void this.playersService.notifyCoachesOfAthleteEdit(id, 'stats');
    return saved;
  }

  @Patch(':id/hidden-tabs')
  @Roles('COACH')
  @ApiOperation({ summary: "Set which profile tabs are hidden on an athlete's profile (COACH only)" })
  setHiddenTabs(@Param('id') id: string, @Body() dto: { tabs: string[] }) {
    return this.playersService.setHiddenTabs(id, dto?.tabs);
  }

  /* ── Weight history ── coaches and the athlete add / remove weigh-ins;
     linked parents can read them. View-only coaches are read-only (the
     guard blocks their writes). */
  @Get(':id/weights')
  @Roles('COACH', 'PLAYER', 'PARENT')
  @ParentAllowed()
  @ApiOperation({ summary: "An athlete's weigh-ins, newest first (ownership-checked)" })
  listWeights(@Request() req: AuthenticatedRequest, @Param('id') id: string, @Query('limit') limit?: string) {
    assertPlayerOwnership(req, id);
    return this.playersService.listWeights(id, limit ? Number(limit) : 10);
  }

  @Post(':id/weights')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Add a weigh-in (coach, or the athlete for themself)' })
  addWeight(@Request() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: { weightLbs?: number; recordedOn?: string }) {
    assertPlayerOwnership(req, id);
    return this.playersService.addWeight(id, dto, req.user?.sub);
  }

  @Delete(':id/weights/:entryId')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Remove a weigh-in (coach, or the athlete for themself)' })
  deleteWeight(@Request() req: AuthenticatedRequest, @Param('id') id: string, @Param('entryId') entryId: string) {
    assertPlayerOwnership(req, id);
    return this.playersService.deleteWeight(id, entryId);
  }

  @Patch(':id/calendar-tabs')
  @Roles('COACH')
  @ApiOperation({ summary: "Set which extra Training Calendar areas are on for an athlete (COACH only)" })
  setCalendarTabs(@Param('id') id: string, @Body() dto: { tabs: string[] }) {
    return this.playersService.setCalendarTabs(id, dto?.tabs);
  }

  @Patch(':id/lock')
  @Roles('COACH')
  @ApiOperation({ summary: "Pause or restore an athlete's account access (COACH only)" })
  setLocked(@Param('id') id: string, @Body() dto: { locked: boolean }) {
    return this.playersService.setPlayerLocked(id, !!dto.locked);
  }

  @Get(':id/top-metrics')
  @Roles('COACH', 'PLAYER', 'PARENT')
  @ParentAllowed() // linked parents read (ownership-checked)
  @ApiOperation({ summary: 'Get latest value for each metric type (ownership-checked)' })
  getTopMetrics(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    assertPlayerOwnership(req, id);
    return this.playersService.getTopMetrics(id);
  }
}

/* Profile pictures, loaded by <img> tags (which can't send the login
   token). The URL's id is random, changes on every upload and is only
   handed out to signed-in users, so it is the access check -- the same
   model as the video CDN links. */
@ApiTags('players')
@Controller('player-photos')
export class PlayerPhotosController {
  constructor(private readonly playersService: PlayersService) {}

  @Get(':photoId')
  @Public()
  @ApiOperation({ summary: 'A profile picture by its URL id' })
  async get(@Param('photoId') photoId: string, @Res() res: Response) {
    const photo = await this.playersService.getPhoto(photoId);
    res.set({
      'Content-Type': photo.mime,
      'Content-Length': String(photo.data.length),
      // The id changes whenever the photo does, so it never goes stale.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(photo.data);
  }
}
