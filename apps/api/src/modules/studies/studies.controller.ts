import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request } from '@nestjs/common';
import { AuthenticatedRequest, Roles, ViewerAllowed } from '../auth/jwt.guard';
import { StudiesService } from './studies.service';

/* Data -> Studies. Coaches only (athletes and parents never see studies).
   Viewer coaches can open studies (the data POST is a read) but not save. */
@Controller('studies')
@Roles('COACH')
export class StudiesController {
  constructor(private svc: StudiesService) {}

  @Get('measures')
  measures(@Request() req: AuthenticatedRequest) {
    return this.svc.measures(req.user!);
  }

  /** VALD groups and tags with their athletes (athlete filters). ?refresh=1 re-reads VALD. */
  @Get('vald-filters')
  valdFilters(@Query('refresh') refresh?: string) {
    return this.svc.valdFilters(refresh === '1');
  }

  /** Raw points for the chosen measures (POST: the list can be long). */
  @Post('data')
  @ViewerAllowed()
  data(@Body() body: any) {
    return this.svc.data(body);
  }

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  create(@Request() req: AuthenticatedRequest, @Body() body: any) {
    return this.svc.create(body, req.user!);
  }

  @Put(':id')
  update(@Request() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: any) {
    return this.svc.update(id, body, req.user!);
  }

  @Delete(':id')
  remove(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.remove(id, req.user!);
  }
}
