import { Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { AuthenticatedRequest } from '../auth/jwt.guard';

/**
 * In-app notifications for the current user. Protected by the global
 * JwtAuthGuard; no `@Roles` → both coaches and players. The acting user is
 * always `req.user.sub`.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List the current user’s notifications (newest first)' })
  list(@Request() req: AuthenticatedRequest, @Query('limit') limit?: string) {
    return this.notificationsService.list(req.user!.sub, limit ? parseInt(limit, 10) : 50);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications for the current user' })
  unreadCount(@Request() req: AuthenticatedRequest) {
    return this.notificationsService.unreadCount(req.user!.sub);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.notificationsService.markRead(req.user!.sub, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllRead(@Request() req: AuthenticatedRequest) {
    return this.notificationsService.markAllRead(req.user!.sub);
  }
}
