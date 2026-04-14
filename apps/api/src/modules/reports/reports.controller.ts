import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { Roles } from '../auth/jwt.guard';

class CreateReportDto {
  playerId!: string;
  createdById!: string;
  reportType!: string;
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
  @ApiOperation({ summary: 'Get all reports for a player' })
  findByPlayer(
    @Param('playerId') playerId: string,
    @Query('type') reportType?: string,
  ) {
    return this.reportsService.findByPlayer(playerId, reportType);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single report' })
  findOne(@Param('id') id: string) {
    return this.reportsService.findOne(id);
  }

  @Patch(':id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Update report content or notes (COACH only)' })
  update(@Param('id') id: string, @Body() dto: { content?: string; notes?: string; videoIds?: string }) {
    return this.reportsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Delete a report (COACH only)' })
  remove(@Param('id') id: string) {
    return this.reportsService.remove(id);
  }
}
