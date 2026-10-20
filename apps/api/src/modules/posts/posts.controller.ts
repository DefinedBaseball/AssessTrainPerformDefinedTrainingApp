import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request } from '@nestjs/common';
import { PostsService } from './posts.service';
import { Roles, ParentAllowed } from '../auth/jwt.guard';

@Controller('posts')
export class PostsController {
  constructor(private postsService: PostsService) {}

  @Get()
  @ParentAllowed() // parents: announcements addressed to their athletes
  async findAll(
    @Request() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    /* The viewer comes from the token, never the query string — the service
       uses it to decide which posts this caller is allowed to see at all. */
    return this.postsService.findAll(
      { id: req.user.sub, role: req.user.role, playerId: req.user.playerId, parentPlayerIds: req.user.parentPlayerIds },
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  @Post()
  @Roles('COACH')
  async create(@Request() req: any, @Body() body: any) {
    return this.postsService.create(req.user.sub, body);
  }

  @Put(':id')
  @Roles('COACH')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.postsService.update(id, body);
  }

  @Delete(':id')
  @Roles('COACH')
  async delete(@Param('id') id: string) {
    return this.postsService.delete(id);
  }

  /** Per-coach "Flag as Seen" — clears the post from THIS coach's pinned row. */
  @Post(':id/seen')
  @Roles('COACH')
  async markSeen(@Request() req: any, @Param('id') id: string) {
    return this.postsService.markSeen(id, req.user.sub);
  }
}
