import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request } from '@nestjs/common';
import { AnalyticsService, ChartConfigDto } from './analytics.service';
import { Roles, assertPlayerOwnership, AuthenticatedRequest } from '../auth/jwt.guard';

@Controller('analytics')
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  @Get('columns')
  @Roles('COACH')
  listColumns() {
    return this.analytics.listColumns();
  }

  @Get('configs')
  @Roles('COACH', 'PLAYER')
  listConfigs(@Request() req: any, @Query('section') section?: string) {
    return this.analytics.listConfigs(req.user.sub, section);
  }

  @Post('configs')
  @Roles('COACH')
  create(@Request() req: any, @Body() body: ChartConfigDto) {
    return this.analytics.create(req.user.sub, body);
  }

  @Put('configs/:id')
  @Roles('COACH')
  update(@Request() req: any, @Param('id') id: string, @Body() body: Partial<ChartConfigDto>) {
    return this.analytics.update(id, req.user.sub, body);
  }

  @Delete('configs/:id')
  @Roles('COACH')
  delete(@Request() req: any, @Param('id') id: string) {
    return this.analytics.delete(id, req.user.sub);
  }

  @Get('configs/:id/evaluate/:playerId')
  @Roles('COACH', 'PLAYER')
  evaluate(@Request() req: AuthenticatedRequest, @Param('id') id: string, @Param('playerId') playerId: string) {
    // A player may only evaluate a config against their OWN data; coaches any.
    assertPlayerOwnership(req, playerId);
    return this.analytics.evaluate(id, playerId);
  }

  @Post('preview/:playerId')
  @Roles('COACH')
  preview(@Param('playerId') playerId: string, @Body() body: ChartConfigDto) {
    return this.analytics.preview(body, playerId);
  }
}
