import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly, AuthenticatedRequest, Roles, ViewerAllowed } from '../auth/jwt.guard';
import { CoachTasksService } from './coach-tasks.service';

@ApiTags('coach-tasks')
@ApiBearerAuth()
@Controller('coach-tasks')
export class CoachTasksController {
  constructor(private svc: CoachTasksService) {}

  @Get()
  @Roles('COACH')
  @ApiOperation({ summary: 'Every To Do task + the active coaches (coaches)' })
  list() {
    return this.svc.list();
  }

  @Post()
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Create a To Do task (admin)' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: unknown) {
    return this.svc.create(req.user!, dto);
  }

  @Delete(':id')
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Delete a To Do task (admin)' })
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  /* Any assigned coach -- viewers included -- checks off their own copy. */
  @Post(':id/done')
  @Roles('COACH')
  @ViewerAllowed()
  @ApiOperation({ summary: 'Mark a task finished for me' })
  done(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.setDone(req.user!, id, true);
  }

  @Delete(':id/done')
  @Roles('COACH')
  @ViewerAllowed()
  @ApiOperation({ summary: 'Move a task back to current for me' })
  undo(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.setDone(req.user!, id, false);
  }
}
