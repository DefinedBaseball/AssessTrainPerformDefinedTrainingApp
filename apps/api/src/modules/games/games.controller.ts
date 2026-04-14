import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GamesService } from './games.service';

class CreateGameReportDto {
  playerId!: string;
  gameDate!: string;
  opponent?: string;
  stats?: string;
  journal?: string;
  videoIds?: string;
  season?: string;
}

@ApiTags('games')
@ApiBearerAuth()
@Controller('games')
export class GamesController {
  constructor(private gamesService: GamesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a game report' })
  create(@Body() dto: CreateGameReportDto) {
    return this.gamesService.create({
      ...dto,
      gameDate: new Date(dto.gameDate),
    });
  }

  @Get('player/:playerId')
  @ApiOperation({ summary: 'Get all game reports for a player' })
  findByPlayer(
    @Param('playerId') playerId: string,
    @Query('season') season?: string,
  ) {
    return this.gamesService.findByPlayer(playerId, season);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single game report' })
  findOne(@Param('id') id: string) {
    return this.gamesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a game report' })
  update(@Param('id') id: string, @Body() dto: { opponent?: string; stats?: string; journal?: string; videoIds?: string }) {
    return this.gamesService.update(id, dto);
  }
}
