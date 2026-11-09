import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest, Roles, assertPlayerOwnership } from '../auth/jwt.guard';
import { JournalService } from './journal.service';

/* Athlete Journal. Parents are default-denied by the global guard (no route
   here is @ParentAllowed): the journal is between an athlete and coaches. */
@ApiTags('journal')
@ApiBearerAuth()
@Controller('journal')
export class JournalController {
  constructor(private svc: JournalService) {}

  @Get('questions')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: "An area's journal questions (coaches + athletes)" })
  questions(@Query('area') area: string) {
    return this.svc.listQuestions(area);
  }

  @Put('questions/:area')
  @Roles('COACH')
  @ApiOperation({ summary: "Replace an area's journal questions (COACH only)" })
  saveQuestions(@Param('area') area: string, @Body() dto: { questions?: unknown }) {
    return this.svc.saveQuestions(area, dto?.questions);
  }

  @Get('entries/:playerId')
  @Roles('COACH', 'PLAYER')
  @ApiOperation({ summary: "An athlete's journal entries, newest first (coach or the athlete)" })
  entries(
    @Request() req: AuthenticatedRequest,
    @Param('playerId') playerId: string,
    @Query('area') area?: string,
  ) {
    assertPlayerOwnership(req, playerId);
    return this.svc.listEntries(playerId, area || undefined);
  }

  @Post('entries')
  @Roles('PLAYER')
  @ApiOperation({ summary: 'Add a journal entry (the athlete, for themselves)' })
  create(@Request() req: AuthenticatedRequest, @Body() dto: unknown) {
    return this.svc.createEntry(req.user?.playerId ?? '', dto);
  }

  @Patch('entries/:id')
  @Roles('PLAYER')
  @ApiOperation({ summary: 'Edit one of your journal entries' })
  update(@Request() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: unknown) {
    return this.svc.updateEntry(req.user?.playerId ?? '', id, dto);
  }

  @Delete('entries/:id')
  @Roles('PLAYER')
  @ApiOperation({ summary: 'Delete one of your journal entries' })
  remove(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.deleteEntry(req.user?.playerId ?? '', id);
  }
}
