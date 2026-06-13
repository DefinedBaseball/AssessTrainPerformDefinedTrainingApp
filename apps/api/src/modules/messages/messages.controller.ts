import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { AuthenticatedRequest } from '../auth/jwt.guard';

/**
 * Direct messaging between users. Every route is protected by the global
 * JwtAuthGuard; no `@Roles` decorator means BOTH coaches and players may
 * use these endpoints (the service enforces who-can-message-whom). The
 * acting user is always `req.user.sub` — clients never pass their own id.
 */
@ApiTags('messages')
@ApiBearerAuth()
@Controller('messages')
export class MessagesController {
  constructor(private messagesService: MessagesService) {}

  @Get('contacts')
  @ApiOperation({ summary: 'List users the current user can start a conversation with' })
  getContacts(@Request() req: AuthenticatedRequest) {
    return this.messagesService.getContacts(req.user!.sub, req.user!.role);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List the current user’s conversations (latest message + unread count)' })
  getConversations(@Request() req: AuthenticatedRequest) {
    return this.messagesService.getConversations(req.user!.sub);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Total unread messages for the current user' })
  unreadCount(@Request() req: AuthenticatedRequest) {
    return this.messagesService.unreadCount(req.user!.sub);
  }

  @Get('thread/:userId')
  @ApiOperation({ summary: 'Full message history with another user (marks inbound as read)' })
  getThread(@Request() req: AuthenticatedRequest, @Param('userId') userId: string) {
    return this.messagesService.getThread(req.user!.sub, userId);
  }

  @Post()
  @ApiOperation({ summary: 'Send a message (text and/or video) to another user' })
  send(
    @Request() req: AuthenticatedRequest,
    @Body() body: { recipientId?: string; body?: string; videoUrl?: string },
  ) {
    return this.messagesService.send(req.user!.sub, body);
  }
}
