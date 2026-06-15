import {
  Controller, Get, Post, Patch, Param, Body, Query,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import * as XLSX from 'xlsx';
import { UploadsService } from './uploads.service';
import { CsvProcessingService } from './csv-processing.service';
import { extractPdfTextItems, buildTrackmanPdfResult, extractTrackmanLocations, extractTrackmanMovement } from './parsers/trackman-pdf-parser';
import { Roles } from '../auth/jwt.guard';

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(
    private uploadsService: UploadsService,
    private csvProcessingService: CsvProcessingService,
  ) {}

  /**
   * POST /api/uploads/csv
   *
   * Upload a CSV file from any supported vendor.
   * The system auto-detects the vendor from column headers,
   * or you can specify ?source=BLAST_MOTION to force it.
   *
   * Body: multipart/form-data with field "file" (the CSV)
   * Query: ?source=TRACKMAN (optional), ?uploadedById=<userId> (required),
   *        ?recordedAt=2024-03-15 (optional fallback date)
   */
  @Post('csv')
  @Roles('COACH')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload and process a vendor CSV file (COACH only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  async uploadCsv(
    @UploadedFile() file: any,
    @Query('uploadedById') uploadedById: string,
    @Query('source') source?: string,
    @Query('recordedAt') recordedAt?: string,
    @Query('playerId') playerId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No CSV file provided');
    }
    if (!uploadedById) {
      throw new BadRequestException('uploadedById is required');
    }

    // Create the upload tracking record
    const upload = await this.uploadsService.createUploadRecord({
      uploadedById,
      source: source || 'AUTO_DETECT',
      fileUrl: file.originalname,
    });

    // Update to PROCESSING
    await this.uploadsService.updateUploadStatus(upload.id, {
      status: 'PROCESSING',
    });

    try {
      // Handle xlsx/xls files by converting to CSV first
      let csvText: string;
      const fileName: string = file.originalname || '';
      const isExcel = /\.(xlsx?|xls)$/i.test(fileName);

      if (isExcel) {
        const workbook = XLSX.read(file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        csvText = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
      } else {
        csvText = file.buffer.toString('utf-8');
      }

      const result = await this.csvProcessingService.processCSV(
        csvText,
        upload.id,
        uploadedById,
        {
          source: source || undefined,
          recordedAt: recordedAt ? new Date(recordedAt) : undefined,
          playerId: playerId || undefined,
        },
      );

      return {
        message: 'CSV processed successfully',
        ...result,
      };
    } catch (error: any) {
      await this.uploadsService.updateUploadStatus(upload.id, {
        status: 'FAILED',
        errorDetails: error?.message || String(error),
      });
      throw new BadRequestException(`CSV processing failed: ${error?.message || error}`);
    }
  }

  /**
   * POST /api/uploads/trackman-pdf
   *
   * Upload a Trackman "Player Session Report" PDF. Reads the summary table and
   * rebuilds a faithful (but NON-interactive) set of `trackman_pitch` rows for
   * the given player — the fallback for when only the PDF is available, not a
   * CSV. Mirrors /uploads/csv: tracks an upload record + returns its id so the
   * report can scope the Pitching tab to these pitches.
   *
   * Body: multipart/form-data with field "file" (the PDF)
   * Query: ?uploadedById=<userId> (required), ?playerId=<id> (required),
   *        ?recordedAt=2024-03-15 (optional)
   */
  @Post('trackman-pdf')
  @Roles('COACH')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload and parse a Trackman session-report PDF (COACH only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  async uploadTrackmanPdf(
    @UploadedFile() file: any,
    @Query('uploadedById') uploadedById: string,
    @Query('playerId') playerId: string,
    @Query('recordedAt') recordedAt?: string,
  ) {
    if (!file) throw new BadRequestException('No PDF file provided');
    if (!uploadedById) throw new BadRequestException('uploadedById is required');
    if (!playerId) throw new BadRequestException('playerId is required');

    const upload = await this.uploadsService.createUploadRecord({
      uploadedById,
      source: 'TRACKMAN',
      fileUrl: file.originalname,
    });
    await this.uploadsService.updateUploadStatus(upload.id, { status: 'PROCESSING' });

    try {
      const items = await extractPdfTextItems(file.buffer);
      // Best-effort: render the Location + Movement charts and detect their dots
      // so both plots match the report. A rendering failure never blocks the
      // upload — each defaults to [] (→ table-driven fallback for Movement,
      // empty Location).
      let locationDots: Awaited<ReturnType<typeof extractTrackmanLocations>> = [];
      let movementDots: Awaited<ReturnType<typeof extractTrackmanMovement>> = [];
      try { locationDots = await extractTrackmanLocations(file.buffer); } catch { locationDots = []; }
      try { movementDots = await extractTrackmanMovement(file.buffer); } catch { movementDots = []; }
      const result = buildTrackmanPdfResult(items, recordedAt ? new Date(recordedAt) : new Date(), 'TrackMan PDF', locationDots, movementDots);

      if (result.totalRows === 0) {
        throw new Error('No pitch data found — could not read the "Stats by pitch type" table from this PDF.');
      }

      const metricsCreated = await this.csvProcessingService.storeParsedMetricsForPlayer(
        result.success,
        { playerId, uploadId: upload.id, source: 'TRACKMAN' },
      );
      const pitchTypes = [
        ...new Set(
          result.success
            .filter(m => m.metricType === 'trackman_pitch')
            .map(m => (m.rawData as any).pitchType),
        ),
      ];

      await this.uploadsService.updateUploadStatus(upload.id, {
        status: 'COMPLETED',
        totalRows: result.totalRows,
        successRows: metricsCreated,
      });

      return {
        message: 'PDF processed successfully',
        uploadId: upload.id,
        totalRows: result.totalRows,
        metricsCreated,
        pitchTypes,
      };
    } catch (error: any) {
      await this.uploadsService.updateUploadStatus(upload.id, {
        status: 'FAILED',
        errorDetails: error?.message || String(error),
      });
      throw new BadRequestException(`PDF processing failed: ${error?.message || error}`);
    }
  }

  @Post()
  @Roles('COACH')
  @ApiOperation({ summary: 'Create a CSV upload record (manual, COACH only)' })
  create(@Body() dto: { uploadedById: string; source: string; fileUrl: string }) {
    return this.uploadsService.createUploadRecord(dto);
  }

  @Patch(':id/status')
  @Roles('COACH')
  @ApiOperation({ summary: 'Update CSV upload processing status (COACH only)' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: {
      status: 'PROCESSING' | 'COMPLETED' | 'PARTIAL_FAILURE' | 'FAILED';
      totalRows?: number;
      successRows?: number;
      errorDetails?: string;
    },
  ) {
    return this.uploadsService.updateUploadStatus(id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get recent CSV uploads' })
  getUploads(@Query('uploadedById') uploadedById?: string) {
    return this.uploadsService.getUploads(uploadedById);
  }

  @Get('sources')
  @ApiOperation({ summary: 'Get list of supported CSV vendor sources' })
  getSources() {
    return {
      sources: ['BLAST_MOTION', 'FULL_SWING', 'HITTRAX', 'TRACKMAN', 'VALD'],
      note: 'You can upload without specifying a source — the system auto-detects from column headers.',
    };
  }
}
