import { Controller, Get, Post, Patch, Param, Body, Query, Request, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlayersService } from './players.service';
import { Roles, assertPlayerOwnership, AuthenticatedRequest } from '../auth/jwt.guard';

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
  'parentEmail', 'parentPhone', 'playingLevelGoal', 'goals',
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
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get a player profile (ownership-checked)' })
  findOne(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    assertPlayerOwnership(req, id);
    return this.playersService.findOne(id);
  }

  @Patch(':id')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Update player profile (athletes: their own personal information only)' })
  update(@Request() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdatePlayerDto) {
    assertPlayerOwnership(req, id);
    if (req.user?.role === 'PLAYER') {
      return this.playersService.update(id, athleteEditableFields(dto));
    }
    return this.playersService.update(id, dto);
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

  @Patch(':id/season-stats')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: "Replace an athlete's season stats (athletes: their own)" })
  setSeasonStats(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: { stats: unknown },
  ) {
    assertPlayerOwnership(req, id);
    return this.playersService.setSeasonStats(id, dto?.stats);
  }

  @Patch(':id/hidden-tabs')
  @Roles('COACH')
  @ApiOperation({ summary: "Set which profile tabs are hidden on an athlete's profile (COACH only)" })
  setHiddenTabs(@Param('id') id: string, @Body() dto: { tabs: string[] }) {
    return this.playersService.setHiddenTabs(id, dto?.tabs);
  }

  @Patch(':id/lock')
  @Roles('COACH')
  @ApiOperation({ summary: "Pause or restore an athlete's account access (COACH only)" })
  setLocked(@Param('id') id: string, @Body() dto: { locked: boolean }) {
    return this.playersService.setPlayerLocked(id, !!dto.locked);
  }

  @Get(':id/top-metrics')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get latest value for each metric type (ownership-checked)' })
  getTopMetrics(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    assertPlayerOwnership(req, id);
    return this.playersService.getTopMetrics(id);
  }
}
