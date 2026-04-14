import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EducationService } from './education.service';
import { Roles } from '../auth/jwt.guard';

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

  @Post('mlb/players')
  @Roles('COACH')
  createMlbPlayer(@Body() dto: { name: string; positions: string; bats?: string; throws?: string; team?: string; emoji?: string }) {
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
