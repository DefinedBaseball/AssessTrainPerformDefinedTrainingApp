import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request } from '@nestjs/common';
import { PostsService } from './posts.service';
import { Roles } from '../auth/jwt.guard';

@Controller('posts')
export class PostsController {
  constructor(private postsService: PostsService) {}

  @Get()
  async findAll(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.postsService.findAll(
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
}
