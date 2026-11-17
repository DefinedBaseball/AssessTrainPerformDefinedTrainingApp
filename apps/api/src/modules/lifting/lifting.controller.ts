import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly, AuthenticatedRequest, ParentAllowed, Roles, assertPlayerOwnership } from '../auth/jwt.guard';
import { LiftingService } from './lifting.service';
import { ValdService } from './vald.service';

/* ─────────────────────────────────────────────────────────────────────────
   /api/lifting -- the Lifting Dashboard.
     layout:   GET config (everyone who can see a profile), PUT / DELETE
               config (Admins + Lifting editors -- checked in the service)
     athlete:  GET players/:id/layout (ownership; their own layout or the
               default), PUT / DELETE players/:id/layout (editors),
               GET layouts (who has their own), PUT layouts / POST
               layouts/reset (several athletes at once, editors)
     editors:  GET editors, PATCH editors/:userId (Admin)
     VALD:     GET vald/status, GET vald/options, PUT vald/settings,
               POST vald/pull (Admins + Lifting editors -- checked in the
               service)
     results:  GET players/:id/tests (ownership), POST players/:id/tests
               (coach), DELETE tests/:id (coach), GET team (coach)
   ───────────────────────────────────────────────────────────────────────── */
@ApiTags('lifting')
@ApiBearerAuth()
@Controller('lifting')
export class LiftingController {
  constructor(private svc: LiftingService, private vald: ValdService) {}

  @Get('config')
  @Roles('COACH', 'PLAYER', 'PARENT')
  @ParentAllowed()
  @ApiOperation({ summary: 'Lifting Dashboard layout + test catalog' })
  config(@Request() req: AuthenticatedRequest) {
    return this.svc.getConfig(req.user);
  }

  @Put('config')
  @Roles('COACH')
  @ApiOperation({ summary: 'Save the Lifting Dashboard layout (Admins + Lifting editors)' })
  saveConfig(@Request() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.svc.saveConfig(body, req.user!);
  }

  @Delete('config')
  @Roles('COACH')
  @ApiOperation({ summary: 'Reset the Lifting Dashboard layout to the defaults' })
  resetConfig(@Request() req: AuthenticatedRequest) {
    return this.svc.resetConfig(req.user!);
  }

  /* ── VALD import ── */

  @Get('vald/status')
  @Roles('COACH')
  @ApiOperation({ summary: 'VALD import: connection, settings, running / last pull' })
  valdStatus(@Request() req: AuthenticatedRequest) {
    return this.vald.status(req.user!);
  }

  @Get('vald/options')
  @Roles('COACH')
  @ApiOperation({ summary: 'VALD sports, groups, tags, test types + app athletes to filter a pull by' })
  valdOptions(@Request() req: AuthenticatedRequest, @Query('refresh') refresh?: string) {
    return this.vald.options(req.user!, refresh === '1');
  }

  @Put('vald/settings')
  @Roles('COACH')
  @ApiOperation({ summary: 'Save the manual-pull and automatic-pull settings' })
  valdSettings(@Request() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.vald.saveSettings(body, req.user!);
  }

  @Post('vald/pull')
  @Roles('COACH')
  @ApiOperation({ summary: 'PULL: import VALD tests for the chosen dates + filters (runs in the background)' })
  valdPull(@Request() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.vald.startManualPull(body, req.user!);
  }

  @Get('layouts')
  @Roles('COACH')
  @ApiOperation({ summary: 'Athletes who have their own Lifting Dashboard layout' })
  layouts() {
    return this.svc.listPlayerLayouts();
  }

  @Put('layouts')
  @Roles('COACH')
  @ApiOperation({ summary: 'Give several athletes the same own layout (Admins + Lifting editors)' })
  saveLayouts(@Request() req: AuthenticatedRequest, @Body() dto: { playerIds?: unknown; config?: unknown }) {
    return this.svc.savePlayerLayouts(dto, req.user!);
  }

  @Post('layouts/reset')
  @Roles('COACH')
  @ApiOperation({ summary: 'Put several athletes back on the default layout' })
  resetLayouts(@Request() req: AuthenticatedRequest, @Body() dto: { playerIds?: unknown }) {
    return this.svc.resetPlayerLayouts(dto, req.user!);
  }

  @Get('players/:playerId/layout')
  @Roles('COACH', 'PLAYER', 'PARENT')
  @ParentAllowed()
  @ApiOperation({ summary: "An athlete's Lifting Dashboard layout (their own, else the default)" })
  playerLayout(@Request() req: AuthenticatedRequest, @Param('playerId') playerId: string) {
    assertPlayerOwnership(req, playerId);
    return this.svc.getPlayerLayout(playerId, req.user);
  }

  @Put('players/:playerId/layout')
  @Roles('COACH')
  @ApiOperation({ summary: "Give an athlete their own layout (Admins + Lifting editors)" })
  savePlayerLayout(@Request() req: AuthenticatedRequest, @Param('playerId') playerId: string, @Body() body: unknown) {
    return this.svc.savePlayerLayout(playerId, body, req.user!);
  }

  @Delete('players/:playerId/layout')
  @Roles('COACH')
  @ApiOperation({ summary: 'Put an athlete back on the default layout' })
  resetPlayerLayout(@Request() req: AuthenticatedRequest, @Param('playerId') playerId: string) {
    return this.svc.resetPlayerLayout(playerId, req.user!);
  }

  @Get('editors')
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Coaches and whether each may edit the layout (admin)' })
  editors() {
    return this.svc.listEditors();
  }

  @Patch('editors/:userId')
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Switch a coach on/off as a Lifting editor (admin)' })
  setEditor(@Param('userId') userId: string, @Body() dto: { on?: boolean }) {
    return this.svc.setEditor(userId, dto?.on);
  }

  @Get('team')
  @Roles('COACH')
  @ApiOperation({ summary: "Every athlete's latest two results per test" })
  team() {
    return this.svc.team();
  }

  @Get('players/:playerId/tests')
  @Roles('COACH', 'PLAYER', 'PARENT')
  @ParentAllowed()
  @ApiOperation({ summary: "An athlete's Lifting results (ownership-checked)" })
  tests(@Request() req: AuthenticatedRequest, @Param('playerId') playerId: string) {
    assertPlayerOwnership(req, playerId);
    return this.svc.listTests(playerId);
  }

  @Post('players/:playerId/tests')
  @Roles('COACH')
  @ApiOperation({ summary: 'Type in a Lifting result (coach)' })
  addTest(@Request() req: AuthenticatedRequest, @Param('playerId') playerId: string, @Body() dto: Record<string, unknown>) {
    return this.svc.addTest(playerId, dto, req.user?.sub);
  }

  @Delete('tests/:id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Remove a Lifting result (typed: coach; VALD: Admin)' })
  deleteTest(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.deleteTest(id, req.user!);
  }
}
