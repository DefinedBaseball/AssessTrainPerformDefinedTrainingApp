import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Request, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TrainingService } from './training.service';
import { S3Service } from '../videos/s3.service';
import { BunnyService } from '../videos/bunny.service';
import { Roles, assertPlayerOwnership, AuthenticatedRequest } from '../auth/jwt.guard';
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
  // Optional drag-reorder positions — used when applying a saved template so
  // the created day reproduces the template's curated ordering. Default 0.
  order?: number;
  sectionOrder?: number;
}

class UpdateScheduledDrillDto {
  // playerId enables drag-drop reassignment on /program — moving a drill
  // from one athlete's column to another's is a single PATCH instead of
  // delete + recreate.
  playerId?: string;
  drillId?: string;
  tab?: string;
  category?: string;
  name?: string;
  date?: string;
  time?: string;
  duration?: number;
  notes?: string | null;
  order?: number;
  sectionOrder?: number;
}

// Coach drag-to-reorder payload. One PATCH carries new positions (and an
// optional reassign) for many drills at once. See reorderScheduledDrills.
class ReorderScheduledDrillsDto {
  items!: {
    id: string;
    order?: number;
    sectionOrder?: number;
    playerId?: string;
    category?: string;
  }[];
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
  constructor(
    private trainingService: TrainingService,
    private s3: S3Service,
    private bunny: BunnyService,
  ) {}

  // ─── Drill Library ─────────────────────────────────────────────

  @Get('drills')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get all drills, optionally filtered by tab' })
  getDrills(@Query('tab') tab?: string) {
    return this.trainingService.getAllDrills(tab);
  }

  @Get('drills/search')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Search drills by name' })
  searchDrills(@Query('q') query: string, @Query('tab') tab?: string) {
    return this.trainingService.searchDrills(query || '', tab);
  }

  @Get('drills/:id')
  @Roles('COACH', 'PLAYER')
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
  @UseInterceptors(FileInterceptor('file', {
    /* Drill demo clips are short — 100MB is well above what a 30-second
     * 1080p iPhone clip produces. Anything larger is almost certainly a
     * mis-clicked file. */
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype || !file.mimetype.startsWith('video/')) {
        return cb(new BadRequestException('Only video files are allowed'), false);
      }
      cb(null, true);
    },
  }))
  @ApiOperation({ summary: 'Upload a video file for a drill (COACH only, 100MB max, video/* only)' })
  async uploadDrillVideo(
    @Param('id') id: string,
    @UploadedFile() file: any,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    const ext = path.extname(file.originalname) || '.mp4';
    const filename = `${id}-${Date.now()}${ext}`;

    /* Storage routing — STORAGE_DRIVER=s3 sends bytes straight to the
     * configured bucket; anything else (default local) writes to disk in
     * uploads/drills/ and serves via express.static. The S3 path is what
     * production uses; local is for dev convenience and the docker-compose
     * single-container deploy where a volume mount works fine. */
    const driver = process.env.STORAGE_DRIVER || 'local';
    let videoUrl: string;

    if (driver === 'bunny' && this.bunny.isConfigured()) {
      const res = await this.bunny.uploadBuffer(file.buffer, filename);
      videoUrl = res.mp4Url;
    } else if (driver === 's3' && this.s3.isConfigured()) {
      const key = `drills/${filename}`;
      await this.s3.putObjectFromBuffer(key, file.buffer, file.mimetype || 'video/mp4');
      // Use CloudFront if CDN_BASE_URL is set, fall back to direct S3 URL.
      videoUrl = this.s3.publicUrlFor(key);
    } else {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'drills');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, file.buffer);
      videoUrl = `/api/training/drills/video/${filename}`;
    }

    return this.trainingService.updateDrill(id, { videoUrl });
  }

  // ─── Scheduled Drills (Calendar) ───────────────────────────────

  @Get('schedule/:playerId')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get scheduled drills for a player (ownership-checked)' })
  getScheduledDrills(
    @Request() req: AuthenticatedRequest,
    @Param('playerId') playerId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('date') date?: string,
    @Query('tab') tab?: string,
  ) {
    assertPlayerOwnership(req, playerId);
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

  // PATCH (not /:id) so it never collides with the PUT schedule/:id route.
  @Patch('schedule/reorder')
  @Roles('COACH')
  @ApiOperation({ summary: 'Drag-reorder scheduled drills / sections (COACH only)' })
  reorderScheduledDrills(@Body() dto: ReorderScheduledDrillsDto) {
    return this.trainingService.reorderScheduledDrills(dto.items);
  }

  // ─── Schedule Templates (named, reusable day plans) ────────────
  // Facility-wide: any coach can list/apply/delete any template. Applying
  // a template reuses POST schedule/batch — no dedicated apply endpoint.

  @Get('templates')
  @Roles('COACH')
  @ApiOperation({ summary: 'List schedule templates, optionally by sport tab (COACH only)' })
  listScheduleTemplates(@Query('tab') tab?: string) {
    return this.trainingService.listScheduleTemplates(tab);
  }

  @Post('templates')
  @Roles('COACH')
  @ApiOperation({ summary: 'Save a day plan as a named template (COACH only)' })
  createScheduleTemplate(
    @Request() req: AuthenticatedRequest,
    @Body() dto: { name: string; tab: string; items: string },
  ) {
    return this.trainingService.createScheduleTemplate({
      name: dto.name,
      tab: dto.tab,
      items: dto.items,
      createdById: req.user?.sub,
    });
  }

  @Put('templates/:id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Rename / overwrite a schedule template (COACH only)' })
  updateScheduleTemplate(@Param('id') id: string, @Body() dto: { name?: string; items?: string }) {
    return this.trainingService.updateScheduleTemplate(id, dto);
  }

  @Delete('templates/:id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Delete a schedule template (COACH only)' })
  deleteScheduleTemplate(@Param('id') id: string) {
    return this.trainingService.deleteScheduleTemplate(id);
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
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get a training program with all days and exercises (own program for players)' })
  async getProgram(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const program = await this.trainingService.getProgram(id);
    // A player may only open their own program; coaches may open any.
    assertPlayerOwnership(req, program.playerId);
    return program;
  }

  @Get('player/:playerId')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get all training programs for a player (ownership-checked)' })
  getPlayerPrograms(@Request() req: AuthenticatedRequest, @Param('playerId') playerId: string) {
    assertPlayerOwnership(req, playerId);
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
