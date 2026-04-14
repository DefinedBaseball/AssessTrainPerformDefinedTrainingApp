import {
  Controller, Get, Post, Patch, Param, Body, Query,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBearerAuth } from '@nestjs/swagger';
import { VideosService } from './videos.service';
import { S3Service } from './s3.service';
import { Roles } from '../auth/jwt.guard';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

// Local upload directory (dev only — production uses S3)
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'videos');

class CreateVideoDto {
  playerId!: string;
  uploadedById?: string;
  title!: string;
  category!: string;
  originalUrl?: string;
}

class AddAnnotationDto {
  createdById!: string;
  frameTimestamp!: number;
  strokeData!: string;
  color!: string;
  strokeWidth!: number;
}

class AddVoiceOverDto {
  createdById!: string;
  audioUrl!: string;
  startTimestamp!: number;
  durationSec!: number;
}

class PresignUploadDto {
  playerId!: string;
  title!: string;
  category!: string;
  contentType!: string;
  uploadedById?: string;
}

class CompleteUploadDto {
  hlsUrl?: string;
}

@ApiTags('videos')
@ApiBearerAuth()
@Controller('videos')
export class VideosController {
  constructor(
    private videosService: VideosService,
    private s3: S3Service,
  ) {}

  /**
   * POST /api/videos/presign
   *
   * Issue a presigned PUT URL so the client can upload the video file
   * directly to S3, bypassing the API server. Creates a pending DB record
   * with status=UPLOADING; client must call POST /api/videos/:id/complete
   * after the upload finishes.
   *
   * Returns 503 if S3 is not configured (dev mode → use POST /upload instead).
   */
  @Post('presign')
  @Roles('COACH')
  @ApiOperation({ summary: 'Get a presigned S3 PUT URL for direct upload (COACH only)' })
  async presignUpload(@Body() dto: PresignUploadDto) {
    if (!dto.playerId) throw new BadRequestException('playerId is required');
    if (!dto.contentType) throw new BadRequestException('contentType is required');

    // Build the S3 key. Layout: uploads/<yyyy-mm>/<uuid>.<ext>
    // The MediaConvert pipeline will read from `uploads/` and write to `processed/`.
    const ext = dto.contentType.split('/')[1] || 'mp4';
    const ym = new Date().toISOString().slice(0, 7);
    const key = `uploads/${ym}/${uuid()}.${ext}`;

    const uploadUrl = await this.s3.presignPutUrl(key, dto.contentType);

    // Create DB record so we have an ID to track. originalUrl is the S3 key —
    // it gets rewritten to a CloudFront / HLS URL by /complete.
    const video = await this.videosService.create({
      playerId: dto.playerId,
      uploadedById: dto.uploadedById,
      title: dto.title || 'Untitled',
      category: dto.category || 'HITTING',
      originalUrl: `s3://${this.s3.bucket}/${key}`,
    });

    return {
      videoId: video.id,
      uploadUrl,
      key,
      bucket: this.s3.bucket,
      expiresInSec: 900,
    };
  }

  /**
   * POST /api/videos/:id/complete
   *
   * Mark a presigned upload as complete. For now this just flips the status
   * to PROCESSING (or READY if no transcoding pipeline is wired up yet).
   * Once MediaConvert is in place, an EventBridge rule will call this with
   * the resulting HLS manifest URL.
   */
  @Post(':id/complete')
  @Roles('COACH')
  @ApiOperation({ summary: 'Mark a presigned upload as complete (COACH only)' })
  async completeUpload(@Param('id') id: string, @Body() dto: CompleteUploadDto) {
    // If client provided an HLS URL, mark READY immediately. Otherwise leave
    // it in PROCESSING for the transcoding job to flip later.
    const status = dto.hlsUrl ? 'READY' : 'PROCESSING';
    return this.videosService.updateStatus(id, status, dto.hlsUrl);
  }

  /**
   * POST /api/videos/upload
   *
   * Upload a video file + create the DB record in one step.
   * For dev: saves to local disk.
   * For production: will generate S3 presigned URL instead.
   */
  @Post('upload')
  @Roles('COACH')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a video file (COACH only)' })
  @ApiConsumes('multipart/form-data')
  async uploadVideo(
    @UploadedFile() file: any,
    @Query('playerId') playerId: string,
    @Query('title') title: string,
    @Query('category') category?: string,
    @Query('uploadedById') uploadedById?: string,
  ) {
    if (!file) throw new BadRequestException('No video file provided');
    if (!playerId) throw new BadRequestException('playerId is required');

    // Ensure upload directory exists
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    // Save file to disk
    const ext = path.extname(file.originalname) || '.mp4';
    const filename = `${uuid()}${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filePath, file.buffer);

    // Create DB record
    const videoTitle = title || file.originalname.replace(/\.[^.]+$/, '');
    const video = await this.videosService.create({
      playerId,
      uploadedById: uploadedById || undefined,
      title: videoTitle,
      category: category || 'HITTING',
      originalUrl: `/api/videos/file/${filename}`,
    });

    // Mark as READY immediately (no transcoding in dev)
    await this.videosService.updateStatus(video.id, 'READY');

    return {
      ...video,
      status: 'READY',
      originalUrl: `/api/videos/file/${filename}`,
      fileSize: file.size,
    };
  }

  // Video file serving is handled by express.static middleware in main.ts
  // at path /api/videos/file — no controller route needed.

  @Post()
  @Roles('COACH')
  @ApiOperation({ summary: 'Create a video record (metadata only, COACH only)' })
  create(@Body() dto: CreateVideoDto) {
    return this.videosService.create(dto);
  }

  /**
   * GET /api/videos/browse
   *
   * Browse ALL videos with optional filters:
   *   ?playerId=...      — filter to a specific player
   *   &category=HITTING  — filter by category
   *   &gradYears=2026,2027 — filter by player grad year (multi-select)
   *   &from=2026-01-01   — videos uploaded on or after this date
   *   &to=2026-12-31     — videos uploaded on or before this date
   *
   * Returns videos with embedded player info.
   */
  @Get('browse')
  @ApiOperation({ summary: 'Browse all videos with filters (includes player info)' })
  async browse(
    @Query('playerId') playerId?: string,
    @Query('category') category?: string,
    @Query('gradYears') gradYears?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const parsedGradYears = gradYears
      ? gradYears.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
      : undefined;
    return this.videosService.findAll({
      playerId: playerId || undefined,
      category: category || undefined,
      gradYears: parsedGradYears?.length ? parsedGradYears : undefined,
      from: from || undefined,
      to: to || undefined,
    });
  }

  @Get('player/:playerId')
  @ApiOperation({ summary: 'Get all videos for a player' })
  findByPlayer(
    @Param('playerId') playerId: string,
    @Query('category') category?: string,
  ) {
    return this.videosService.findByPlayer(playerId, category);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a video with annotations and voice-overs' })
  findOne(@Param('id') id: string) {
    return this.videosService.findOne(id);
  }

  @Patch(':id/status')
  @Roles('COACH')
  @ApiOperation({ summary: 'Update video processing status (COACH only)' })
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: 'PROCESSING' | 'READY' | 'FAILED'; hlsUrl?: string },
  ) {
    return this.videosService.updateStatus(id, body.status, body.hlsUrl);
  }

  @Post(':id/annotations')
  @Roles('COACH')
  @ApiOperation({ summary: 'Add a drawing annotation to a video (COACH only)' })
  addAnnotation(@Param('id') id: string, @Body() dto: AddAnnotationDto) {
    return this.videosService.addAnnotation({ videoId: id, ...dto });
  }

  @Post(':id/voice-overs')
  @Roles('COACH')
  @ApiOperation({ summary: 'Add a voice-over recording to a video (COACH only)' })
  addVoiceOver(@Param('id') id: string, @Body() dto: AddVoiceOverDto) {
    return this.videosService.addVoiceOver({ videoId: id, ...dto });
  }
}
