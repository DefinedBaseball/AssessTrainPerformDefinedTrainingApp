import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Request, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { Roles, assertPlayerOwnership, AuthenticatedRequest } from '../auth/jwt.guard';

class CreateReportDto {
  playerId!: string;
  createdById!: string;
  reportType!: string;
  /** User-assigned report name. The Prisma `Report` model declares
   *  this column as `String?`, and the service-layer signature
   *  already accepts it — but until this field existed on the DTO
   *  Nest's body-mapper silently dropped it from incoming payloads,
   *  so every report created through the UI lost its title on
   *  save. */
  title?: string;
  content!: string;
  notes?: string;
  videoIds?: string;
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Post()
  @Roles('COACH')
  @ApiOperation({ summary: 'Create a player report (COACH only)' })
  create(@Body() dto: CreateReportDto) {
    return this.reportsService.create(dto);
  }

  @Get('player/:playerId')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get all reports for a player' })
  findByPlayer(
    @Request() req: AuthenticatedRequest,
    @Param('playerId') playerId: string,
    @Query('type') reportType?: string,
  ) {
    assertPlayerOwnership(req, playerId);
    return this.reportsService.findByPlayer(playerId, reportType);
  }

  @Get(':id')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: 'Get a single report (ownership-checked)' })
  async findOne(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const report = await this.reportsService.findOne(id);
    if (!report) throw new NotFoundException('Report not found');
    // Player-role callers can only fetch reports tied to their own playerId.
    // Loading the row first is unavoidable since the route is /reports/:id —
    // there's no playerId in the URL to gate on directly.
    assertPlayerOwnership(req, (report as any).playerId);
    return report;
  }

  @Patch(':id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Update report title, content, notes, or videos (COACH only)' })
  update(@Param('id') id: string, @Body() dto: { title?: string; content?: string; notes?: string; videoIds?: string }) {
    return this.reportsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Delete a report (COACH only)' })
  remove(@Param('id') id: string) {
    return this.reportsService.remove(id);
  }
}
