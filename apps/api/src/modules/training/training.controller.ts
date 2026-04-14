import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TrainingService } from './training.service';
import { Roles } from '../auth/jwt.guard';
import * as fs from 'fs';
import * as path from 'path';

// ─── DTOs ────────────────────────────────────────────────────────

class CreateDrillDto {
  name!: string;
  tab!: string;
  category!: string;
  description?: string;
  videoUrl?: string;
}

class UpdateDrillDto {
  name?: string;
  tab?: string;
  category?: string;
  description?: string;
  videoUrl?: string;
}

class CreateScheduledDrillDto {
  playerId!: string;
  drillId?: string;
  tab!: string;
  category!: string;
  name!: string;
  date!: string;
  time!: string;
  duration!: number;
  notes?: string;
}

class UpdateScheduledDrillDto {
  drillId?: string;
  tab?: string;
  category?: string;
  name?: string;
  date?: string;
  time?: string;
  duration?: number;
  notes?: string;
}

// Legacy DTOs
class CreateProgramDto {
  playerId!: string;
  name!: string;
  startDate!: string;
  endDate!: string;
}

class AddExerciseDto {
  category!: string;
  name!: string;
  description?: string;
  demoVideoUrl?: string;
  sortOrder?: number;
}

@ApiTags('training')
@ApiBearerAuth()
@Controller('training')
export class TrainingController {
  constructor(private trainingService: TrainingService) {}

  // ─── Drill Library ─────────────────────────────────────────────

  @Get('drills')
  @ApiOperation({ summary: 'Get all drills, optionally filtered by tab' })
  getDrills(@Query('tab') tab?: string) {
    return this.trainingService.getAllDrills(tab);
  }

  @Get('drills/search')
  @ApiOperation({ summary: 'Search drills by name' })
  searchDrills(@Query('q') query: string, @Query('tab') tab?: string) {
    return this.trainingService.searchDrills(query || '', tab);
  }

  @Get('drills/:id')
  @ApiOperation({ summary: 'Get a single drill by ID' })
  getDrill(@Param('id') id: string) {
    return this.trainingService.getDrill(id);
  }

  @Post('drills')
  @Roles('COACH')
  @ApiOperation({ summary: 'Create a new drill (COACH only)' })
  createDrill(@Body() dto: CreateDrillDto) {
    return this.trainingService.createDrill(dto);
  }

  @Put('drills/:id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Update a drill (COACH only)' })
  updateDrill(@Param('id') id: string, @Body() dto: UpdateDrillDto) {
    return this.trainingService.updateDrill(id, dto);
  }

  @Delete('drills/:id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Delete a drill (COACH only)' })
  deleteDrill(@Param('id') id: string) {
    return this.trainingService.deleteDrill(id);
  }

  @Post('drills/:id/upload-video')
  @Roles('COACH')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a video file for a drill (COACH only)' })
  async uploadDrillVideo(
    @Param('id') id: string,
    @UploadedFile() file: any,
  ) {
    if (!file) throw new Error('No file uploaded');

    // Save to local uploads/drills directory
    const uploadsDir = path.join(process.cwd(), 'uploads', 'drills');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const ext = path.extname(file.originalname) || '.mp4';
    const filename = `${id}-${Date.now()}${ext}`;
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, file.buffer);

    // Update drill with the video URL
    const videoUrl = `/api/training/drills/video/${filename}`;
    return this.trainingService.updateDrill(id, { videoUrl });
  }

  // ─── Scheduled Drills (Calendar) ───────────────────────────────

  @Get('schedule/:playerId')
  @ApiOperation({ summary: 'Get scheduled drills for a player (filter by date range and tab)' })
  getScheduledDrills(
    @Param('playerId') playerId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('date') date?: string,
    @Query('tab') tab?: string,
  ) {
    if (startDate && endDate) {
      return this.trainingService.getScheduledDrillsForRange(playerId, startDate, endDate, tab);
    }
    return this.trainingService.getScheduledDrills(playerId, date, tab);
  }

  @Post('schedule')
  @Roles('COACH')
  @ApiOperation({ summary: 'Schedule a drill for a player (COACH only)' })
  createScheduledDrill(@Body() dto: CreateScheduledDrillDto) {
    return this.trainingService.createScheduledDrill(dto);
  }

  @Post('schedule/batch')
  @Roles('COACH')
  @ApiOperation({ summary: 'Schedule multiple drills at once (COACH only)' })
  createScheduledDrillsBatch(@Body() dto: { items: CreateScheduledDrillDto[] }) {
    return this.trainingService.createScheduledDrillsBatch(dto.items);
  }

  @Put('schedule/:id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Update a scheduled drill (COACH only)' })
  updateScheduledDrill(@Param('id') id: string, @Body() dto: UpdateScheduledDrillDto) {
    return this.trainingService.updateScheduledDrill(id, dto);
  }

  @Delete('schedule/:id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Delete a scheduled drill (COACH only)' })
  deleteScheduledDrill(@Param('id') id: string) {
    return this.trainingService.deleteScheduledDrill(id);
  }

  // ─── Legacy Training Programs ──────────────────────────────────

  @Post('programs')
  @Roles('COACH')
  @ApiOperation({ summary: 'Create a training program (COACH only)' })
  createProgram(@Body() dto: CreateProgramDto) {
    return this.trainingService.createProgram({
      ...dto,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
    });
  }

  @Get('programs/:id')
  @ApiOperation({ summary: 'Get a training program with all days and exercises' })
  getProgram(@Param('id') id: string) {
    return this.trainingService.getProgram(id);
  }

  @Get('player/:playerId')
  @ApiOperation({ summary: 'Get all training programs for a player' })
  getPlayerPrograms(@Param('playerId') playerId: string) {
    return this.trainingService.getPlayerPrograms(playerId);
  }

  @Post('programs/:programId/days')
  @Roles('COACH')
  @ApiOperation({ summary: 'Add a training day to a program (COACH only)' })
  addDay(@Param('programId') programId: string, @Body() body: { date: string }) {
    return this.trainingService.addDay(programId, new Date(body.date));
  }

  @Post('days/:dayId/exercises')
  @Roles('COACH')
  @ApiOperation({ summary: 'Add an exercise to a training day (COACH only)' })
  addExercise(@Param('dayId') dayId: string, @Body() dto: AddExerciseDto) {
    return this.trainingService.addExercise(dayId, dto);
  }
}
