import { Controller, Get, Post, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LeaderboardsService } from './leaderboards.service';
import { Roles } from '../auth/jwt.guard';

@ApiTags('leaderboards')
@ApiBearerAuth()
@Controller('leaderboards')
export class LeaderboardsController {
  constructor(private leaderboardsService: LeaderboardsService) {}

  @Get()
  @ApiOperation({ summary: 'Get leaderboard by grad year and metric' })
  getLeaderboard(
    @Query('gradYear') gradYear: string,
    @Query('metricType') metricType: string,
    @Query('limit') limit?: string,
  ) {
    return this.leaderboardsService.getLeaderboard(
      parseInt(gradYear),
      metricType,
      limit ? parseInt(limit) : 15,
    );
  }

  /**
   * Distinct grad years present, for the filter dropdown. No `@Roles` → any
   * authenticated user (coach OR player) may read it; it returns only year
   * numbers (no player data), and the player list endpoint is coach-only.
   */
  @Get('grad-years')
  @ApiOperation({ summary: 'Distinct grad years for the leaderboard filter' })
  getGradYears() {
    return this.leaderboardsService.getGradYears();
  }

  @Post('recompute')
  @Roles('COACH')
  @ApiOperation({ summary: 'Recompute leaderboards (COACH only)' })
  recompute(@Query('gradYear') gradYear?: string) {
    return this.leaderboardsService.recompute(
      gradYear ? parseInt(gradYear) : undefined,
    );
  }

  /**
   * Player-rank summary — every leaderboard metric this player qualifies
   * for, with their rank within their grad-year class.
   *
   * Powers the "Class Rankings" widget on the Player Summary tab so an
   * athlete sees where they stand without leaving their profile.
   */
  @Get('player/:playerId')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get a player\'s ranks across every leaderboard metric' })
  getPlayerRank(@Param('playerId') playerId: string) {
    return this.leaderboardsService.getPlayerRank(playerId);
  }
}
