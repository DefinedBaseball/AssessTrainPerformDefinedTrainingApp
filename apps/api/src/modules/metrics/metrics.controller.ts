import { Controller, Get, Post, Param, Body, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';
import { Roles, assertPlayerOwnership, AuthenticatedRequest } from '../auth/jwt.guard';

class CreateMetricDto {
  playerId!: string;
  source!: string;
  metricType!: string;
  value!: number;
  unit!: string;
  recordedAt!: string;
  rawData?: string;
}

@ApiTags('metrics')
@ApiBearerAuth()
@Controller('players/:playerId/metrics')
export class MetricsController {
  constructor(private metricsService: MetricsService) {}

  @Post()
  @Roles('COACH')
  @ApiOperation({ summary: 'Add a metric for a player (COACH only)' })
  create(@Param('playerId') playerId: string, @Body() dto: CreateMetricDto) {
    return this.metricsService.create({
      ...dto,
      playerId,
      recordedAt: new Date(dto.recordedAt),
    });
  }

  @Get()
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get metrics with date filtering (ownership-checked)' })
  findByPlayer(
    @Request() req: AuthenticatedRequest,
    @Param('playerId') playerId: string,
    @Query('source') source?: string,
    @Query('date') date?: string,
    @Query('month') month?: string,
    @Query('latest') latest?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('uploadIds') uploadIds?: string,
  ) {
    assertPlayerOwnership(req, playerId);
    return this.metricsService.findByPlayer(playerId, {
      source,
      date,
      month,
      latest: latest === 'true',
      from,
      to,
      uploadIds: uploadIds ? uploadIds.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    });
  }

  @Get('progress/:metricType')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get progress data for a specific metric over time (ownership-checked)' })
  getProgress(
    @Request() req: AuthenticatedRequest,
    @Param('playerId') playerId: string,
    @Param('metricType') metricType: string,
    @Query('source') source?: string,
  ) {
    assertPlayerOwnership(req, playerId);
    return this.metricsService.getProgressData(playerId, metricType, source);
  }

  @Get('dates/:source')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get available report dates for a data source (ownership-checked)' })
  getDates(
    @Request() req: AuthenticatedRequest,
    @Param('playerId') playerId: string,
    @Param('source') source: string,
  ) {
    assertPlayerOwnership(req, playerId);
    return this.metricsService.getAvailableDates(playerId, source);
  }

  @Get('session-data/:source')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get raw session data points for spray charts (ownership-checked)' })
  getSessionData(
    @Request() req: AuthenticatedRequest,
    @Param('playerId') playerId: string,
    @Param('source') source: string,
    @Query('types') types: string,
    @Query('date') date?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('uploadIds') uploadIds?: string,
  ) {
    assertPlayerOwnership(req, playerId);
    const metricTypes = types ? types.split(',') : ['spray_angle', 'distance', 'max_exit_velo', 'launch_angle'];
    return this.metricsService.getSessionData(playerId, source, metricTypes, {
      date, from, to,
      uploadIds: uploadIds ? uploadIds.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    });
  }

  @Get('trackman-pitches')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get all Trackman pitch-level data for visualizations (ownership-checked)' })
  getTrackmanPitches(
    @Request() req: AuthenticatedRequest,
    @Param('playerId') playerId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('uploadIds') uploadIds?: string,
  ) {
    assertPlayerOwnership(req, playerId);
    return this.metricsService.getTrackmanPitches(playerId, {
      from, to,
      uploadIds: uploadIds ? uploadIds.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    });
  }

  @Get('batted-ball-summary')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get aggregated batted ball stats (ownership-checked)' })
  getBattedBallSummary(
    @Request() req: AuthenticatedRequest,
    @Param('playerId') playerId: string,
    @Query('source') source?: string,
    @Query('uploadIds') uploadIds?: string,
  ) {
    assertPlayerOwnership(req, playerId);
    return this.metricsService.getBattedBallSummary(
      playerId,
      source,
      uploadIds ? uploadIds.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    );
  }
}
