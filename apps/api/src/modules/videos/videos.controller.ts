import {
  Controller, Get, Post, Patch, Param, Body, Query,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBearerAuth } from '@nestjs/swagger';
import { VideosService } from './videos.service';
import { S3Service } from './s3.service';
import { BunnyService } from './bunny.service';
import { Roles } from '../auth/jwt.guard';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

// Local upload directory (dev only — production uses S3)
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'videos');

/* Shared multer config for the standalone /upload-file route: 500 MB
   cap; accept video/* mimetypes OR a known video extension (some
   MediaRecorder blobs arrive with a generic octet-stream mimetype). */
const VIDEO_UPLOAD_LIMITS = { fileSize: 500 * 1024 * 1024 };
function videoFileFilter(
  _req: any,
  file: any,
  cb: (err: Error | null, accept: boolean) => void,
) {
  const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.ogv'];
  const mime = (file.mimetype || '').toLowerCase();
  const name = (file.originalname || '').toLowerCase();
  if (!mime.startsWith('video/') && !VIDEO_EXTS.some((ext) => name.endsWith(ext))) {
    return cb(
      new BadRequestException(
        `Only video files are allowed (got mimetype="${file.mimetype || '(none)'}", filename="${file.originalname || '(none)'}")`,
      ),
      false,
    );
  }
  cb(null, true);
}

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
    private bunny: BunnyService,
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
  @UseInterceptors(FileInterceptor('file', {
    /* 500 MB cap — enough for typical training-day clips at 1080p, small
     * enough to avoid OOMing the container on a runaway upload. The
     * presigned-PUT path (above) is the recommended route for anything
     * larger; that streams direct to S3 and never lands in API memory. */
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      /* Accept any of:
       *   1. mimetype starts with `video/` (the happy path — most
       *      browsers attach the right Content-Type on the multipart
       *      part directly).
       *   2. filename ends in a known video extension (`.mp4`,
       *      `.webm`, `.mov`, `.mkv`, `.avi`, `.m4v`, `.ogv`). This
       *      handles the Live-tracker MediaRecorder path: some
       *      browsers strip codec parameters from the blob's MIME
       *      during the File→multipart conversion and the server
       *      receives an empty / generic mimetype (e.g.
       *      `application/octet-stream`), even though the file is a
       *      legitimate `.webm` clip the recorder just produced.
       *
       * Anything that fails BOTH checks is rejected — still blocks
       * the original threat model (executables or images smuggled
       * into the video upload endpoint). The error message echoes
       * the received mimetype so the client can debug malformed
       * uploads quickly. */
      const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.ogv'];
      const mime = (file.mimetype || '').toLowerCase();
      const name = (file.originalname || '').toLowerCase();
      const mimeOk = mime.startsWith('video/');
      const extOk = VIDEO_EXTS.some(ext => name.endsWith(ext));
      if (!mimeOk && !extOk) {
        return cb(
          new BadRequestException(
            `Only video files are allowed (got mimetype="${file.mimetype || '(none)'}", filename="${file.originalname || '(none)'}")`,
          ),
          false,
        );
      }
      cb(null, true);
    },
  }))
  @ApiOperation({ summary: 'Upload a video file (COACH only, 500MB max, video/* only)' })
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

    const ext = path.extname(file.originalname) || '.mp4';
    const filename = `${uuid()}${ext}`;

    /* Storage routing — same pattern as the drill upload. STORAGE_DRIVER=s3
     * uploads to the configured bucket (and the URL points at CloudFront
     * via CDN_BASE_URL); otherwise writes to local disk for dev. The
     * presigned-PUT path on this controller is still the recommended
     * route for large client-side uploads — this server-side path is
     * here for legacy clients and small files. */
    const driver = process.env.STORAGE_DRIVER || 'local';
    const videoTitle = title || file.originalname.replace(/\.[^.]+$/, '');
    let originalUrl: string;
    let hlsUrl: string | undefined;

    if (driver === 'bunny' && this.bunny.isConfigured()) {
      /* Bunny Stream — auto-transcodes to MP4/HLS on its side. We store the
         progressive MP4 (for the custom player) as originalUrl and the HLS
         manifest as hlsUrl. Transcode is async; the URLs resolve once Bunny
         finishes (fast for short clips), so we still mark READY below. */
      const res = await this.bunny.uploadBuffer(file.buffer, videoTitle);
      originalUrl = res.mp4Url;
      hlsUrl = res.hlsUrl;
    } else if (driver === 's3' && this.s3.isConfigured()) {
      const ym = new Date().toISOString().slice(0, 7);
      const key = `uploads/${ym}/${filename}`;
      await this.s3.putObjectFromBuffer(key, file.buffer, file.mimetype || 'video/mp4');
      originalUrl = this.s3.publicUrlFor(key);
    } else {
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      }
      const filePath = path.join(UPLOAD_DIR, filename);
      /* Async file write — was `fs.writeFileSync` which blocks the
         Node event loop for the duration of the write. With the new
         adaptive 4K-up-to-240 fps capture giving ~50–60 Mbps bitrates,
         individual clips can be 100–500 MB; a sync write on a clip
         that big stalls EVERY other API call (auth, status pings,
         the parallel video uploads from the same save) for seconds.
         `fs.promises.writeFile` releases the event loop on the I/O
         wait so the other parallel uploads + their auth checks can
         interleave normally. */
      await fs.promises.writeFile(filePath, file.buffer);
      originalUrl = `/api/videos/file/${filename}`;
    }

    const video = await this.videosService.create({
      playerId,
      uploadedById: uploadedById || undefined,
      title: videoTitle,
      category: category || 'HITTING',
      originalUrl,
    });

    // Mark READY (Bunny path also records the HLS manifest URL).
    await this.videosService.updateStatus(video.id, 'READY', hlsUrl);

    return {
      ...video,
      status: 'READY',
      originalUrl,
      hlsUrl,
      fileSize: file.size,
    };
  }

  /**
   * POST /api/videos/upload-file
   *
   * Store a video file and return its URL — WITHOUT creating a Video DB
   * record. Used by the Education → Major League Video library, whose
   * clips live in their own MlbVideo table and just need a playable URL.
   * Same storage routing as /upload (S3 in prod, local disk in dev).
   */
  @Post('upload-file')
  @Roles('COACH')
  @UseInterceptors(FileInterceptor('file', { limits: VIDEO_UPLOAD_LIMITS, fileFilter: videoFileFilter }))
  @ApiOperation({ summary: 'Upload a video file and return its URL only (COACH only, 500MB max)' })
  @ApiConsumes('multipart/form-data')
  async uploadFileOnly(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No video file provided');

    const ext = path.extname(file.originalname) || '.mp4';
    const filename = `${uuid()}${ext}`;
    const driver = process.env.STORAGE_DRIVER || 'local';

    if (driver === 'bunny' && this.bunny.isConfigured()) {
      const res = await this.bunny.uploadBuffer(file.buffer, file.originalname || 'Video');
      return { url: res.mp4Url };
    }

    if (driver === 's3' && this.s3.isConfigured()) {
      const ym = new Date().toISOString().slice(0, 7);
      const key = `uploads/${ym}/${filename}`;
      await this.s3.putObjectFromBuffer(key, file.buffer, file.mimetype || 'video/mp4');
      return { url: this.s3.publicUrlFor(key) };
    }

    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), file.buffer);
    return { url: `/api/videos/file/${filename}` };
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
  /* Read endpoints require an authenticated user (coach OR player). The
     previous behaviour was open — any authenticated request could pull
     any other player's video listing. Locking to the two known roles
     is the academy-appropriate floor; finer-grained "this player can
     only see THEIR OWN videos" can layer on later if needed. */
  @Get('browse')
  @Roles('COACH', 'PLAYER')
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
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get all videos for a player (auth required)' })
  findByPlayer(
    @Param('playerId') playerId: string,
    @Query('category') category?: string,
  ) {
    return this.videosService.findByPlayer(playerId, category);
  }

  @Get(':id')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get a video with annotations and voice-overs (auth required)' })
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
