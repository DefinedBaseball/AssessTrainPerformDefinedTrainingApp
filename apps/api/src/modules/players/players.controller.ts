import { Controller, Get, Post, Patch, Param, Body, Query, Request } from '@nestjs/common';
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
  @Roles('COACH')
  @ApiOperation({ summary: 'Update player profile (COACH only)' })
  update(@Param('id') id: string, @Body() dto: UpdatePlayerDto) {
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
