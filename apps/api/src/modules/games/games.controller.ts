import { Controller, Get, Post, Patch, Param, Body, Query, Request, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GamesService } from './games.service';
import { assertPlayerOwnership, AuthenticatedRequest } from '../auth/jwt.guard';

class CreateGameReportDto {
  playerId!: string;
  gameDate!: string;
  opponent?: string;
  stats?: string;
  journal?: string;
  videoIds?: string;
  season?: string;
}

/**
 * Game reports / journals. Both roles may use these routes, but every one
 * is scoped through `assertPlayerOwnership`: coaches see everything, a
 * player may only read or write THEIR OWN game reports. (Previously these
 * routes had no ownership checks at all — any signed-in player could read
 * or write any roster-mate's journal via a hand-crafted request.)
 */
@ApiTags('games')
@ApiBearerAuth()
@Controller('games')
export class GamesController {
  constructor(private gamesService: GamesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a game report (own player only, unless coach)' })
  create(@Request() req: AuthenticatedRequest, @Body() dto: CreateGameReportDto) {
    assertPlayerOwnership(req, dto.playerId);
    return this.gamesService.create({
      ...dto,
      gameDate: new Date(dto.gameDate),
    });
  }

  @Get('player/:playerId')
  @ApiOperation({ summary: 'Get all game reports for a player (own only, unless coach)' })
  findByPlayer(
    @Request() req: AuthenticatedRequest,
    @Param('playerId') playerId: string,
    @Query('season') season?: string,
  ) {
    assertPlayerOwnership(req, playerId);
    return this.gamesService.findByPlayer(playerId, season);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single game report (own only, unless coach)' })
  async findOne(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const report = await this.gamesService.findOne(id);
    if (!report) throw new NotFoundException('Game report not found');
    assertPlayerOwnership(req, report.playerId);
    return report;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a game report (own only, unless coach)' })
  async update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: { opponent?: string; stats?: string; journal?: string; videoIds?: string },
  ) {
    const report = await this.gamesService.findOne(id);
    if (!report) throw new NotFoundException('Game report not found');
    assertPlayerOwnership(req, report.playerId);
    return this.gamesService.update(id, dto);
  }
}
