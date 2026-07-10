import { Controller, Get, Post, Put, Delete, Param, Body, Query, Res, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { EducationService } from './education.service';
import { Roles, Public } from '../auth/jwt.guard';

@ApiTags('education')
@ApiBearerAuth()
@Controller('education')
export class EducationController {
  constructor(private svc: EducationService) {}

  // ─── Classes ───────────────────────────────────────────────────

  @Get('classes')
  @ApiOperation({ summary: 'Get all classes, filter by sport/level' })
  getClasses(@Query('sport') sport?: string, @Query('level') level?: string) {
    return this.svc.getClasses(sport, level);
  }

  @Get('classes/:id')
  @ApiOperation({ summary: 'Get a single class by ID' })
  getClass(@Param('id') id: string) {
    return this.svc.getClass(id);
  }

  @Post('classes')
  @Roles('COACH')
  createClass(@Body() dto: { sport: string; level: string; name: string; desc?: string; description?: string; videoUrl?: string; lessons?: number; duration?: number; emoji?: string }) {
    return this.svc.createClass(dto);
  }

  @Put('classes/:id')
  @Roles('COACH')
  updateClass(@Param('id') id: string, @Body() dto: any) {
    return this.svc.updateClass(id, dto);
  }

  @Delete('classes/:id')
  @Roles('COACH')
  deleteClass(@Param('id') id: string) {
    return this.svc.deleteClass(id);
  }

  // ─── MLB Players ───────────────────────────────────────────────

  @Get('mlb/players')
  @ApiOperation({ summary: 'Get MLB players, filter by position/bats/throws' })
  getMlbPlayers(
    @Query('position') position?: string,
    @Query('bats') bats?: string,
    @Query('throws') throws_?: string,
  ) {
    return this.svc.getMlbPlayers(position, bats, throws_);
  }

  @Get('mlb/players/:id')
  getMlbPlayer(@Param('id') id: string) {
    return this.svc.getMlbPlayer(id);
  }

  /**
   * GET /education/mlb/players/:id/cover
   *
   * Serves the player's cover photo as a real cacheable image response —
   * the base64 blob no longer rides inside the players-list JSON (which
   * was headed for tens of MB per Education visit at roster scale).
   * @Public so plain <img>/CSS `url()` requests work (they can't attach
   * the Bearer header): the ids are unguessable uuids and the content is
   * non-sensitive MLB imagery. 5-min cache = repeat visits are free while
   * a replaced cover still propagates quickly.
   */
  @Public()
  /* Exempt from the global rate-limit buckets: a full roster grid fires one
     image request per card (potentially hundreds inside the 10s window),
     which would blow the 120-req budget and 429 both the covers AND the
     page's real API calls. The route is one indexed select + a buffer send,
     and the 5-min Cache-Control absorbs repeats. */
  @SkipThrottle()
  @Get('mlb/players/:id/cover')
  @ApiOperation({ summary: "Serve an MLB player's cover photo as an image" })
  async getMlbPlayerCover(@Param('id') id: string, @Res() res: Response) {
    const cover = await this.svc.getMlbPlayerCoverData(id);
    if (!cover) throw new NotFoundException('No cover photo');
    res.set({
      'Content-Type': cover.mime,
      'Cache-Control': 'public, max-age=300',
      'Content-Length': String(cover.buffer.length),
    });
    res.send(cover.buffer);
  }

  @Post('mlb/players')
  @Roles('COACH')
  createMlbPlayer(@Body() dto: { name: string; positions: string; bats?: string | null; throws?: string | null; team?: string; emoji?: string; heightInches?: number | null; weightLbs?: number | null }) {
    return this.svc.createMlbPlayer(dto);
  }

  @Put('mlb/players/:id')
  @Roles('COACH')
  updateMlbPlayer(@Param('id') id: string, @Body() dto: any) {
    return this.svc.updateMlbPlayer(id, dto);
  }

  @Delete('mlb/players/:id')
  @Roles('COACH')
  deleteMlbPlayer(@Param('id') id: string) {
    return this.svc.deleteMlbPlayer(id);
  }

  // ─── MLB Videos ────────────────────────────────────────────────

  @Post('mlb/videos')
  @Roles('COACH')
  createMlbVideo(@Body() dto: { playerId: string; title: string; category: string; url?: string; notes?: string }) {
    return this.svc.createMlbVideo(dto);
  }

  @Put('mlb/videos/:id')
  @Roles('COACH')
  updateMlbVideo(@Param('id') id: string, @Body() dto: any) {
    return this.svc.updateMlbVideo(id, dto);
  }

  @Delete('mlb/videos/:id')
  @Roles('COACH')
  deleteMlbVideo(@Param('id') id: string) {
    return this.svc.deleteMlbVideo(id);
  }
}
