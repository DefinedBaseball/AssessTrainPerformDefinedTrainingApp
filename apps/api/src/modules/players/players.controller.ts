import { Controller, Get, Post, Patch, Param, Body, Query, Request } from '@nestjs/common';
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
  profilePhoto?: string;
  heightInches?: number | null;
  weightLbs?: number | null;
  gradYear?: number | null;
  bats?: string | null;
  throws?: string | null;
  birthDate?: string | null;
  highSchool?: string | null;
  clubTeam?: string | null;
  collegeCommit?: string | null;
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

  @Get(':id/top-metrics')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get latest value for each metric type (ownership-checked)' })
  getTopMetrics(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    assertPlayerOwnership(req, id);
    return this.playersService.getTopMetrics(id);
  }
}
