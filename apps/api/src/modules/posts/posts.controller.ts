import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { PostsService } from './posts.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('posts')
@UseGuards(JwtAuthGuard)
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
  @UseGuards(RolesGuard)
  @Roles('COACH')
  async create(@Request() req: any, @Body() body: any) {
    return this.postsService.create(req.user.sub, body);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('COACH')
  async delete(@Param('id') id: string) {
    return this.postsService.delete(id);
  }
}
