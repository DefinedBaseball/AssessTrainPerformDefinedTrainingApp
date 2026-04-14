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

  @Post('recompute')
  @Roles('COACH')
  @ApiOperation({ summary: 'Recompute leaderboards (COACH only)' })
  recompute(@Query('gradYear') gradYear?: string) {
    return this.leaderboardsService.recompute(
      gradYear ? parseInt(gradYear) : undefined,
    );
  }
}
