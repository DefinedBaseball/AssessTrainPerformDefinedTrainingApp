import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/jwt.guard';
import { DrillOptionsService } from './drill-options.service';

@ApiTags('drill-options')
@ApiBearerAuth()
@Controller('drill-options')
export class DrillOptionsController {
  constructor(private svc: DrillOptionsService) {}

  @Get()
  @Roles('COACH')
  @ApiOperation({ summary: 'Per-drill drop-down option lists (Feed Type, Reps, …) for coaches' })
  list() {
    return this.svc.list();
  }

  /* Viewer-level coaches are refused by the global guard (writes). */
  @Post(':tab/:field')
  @Roles('COACH')
  @ApiOperation({ summary: 'Add an option to a drop-down list (coaches)' })
  add(@Param('tab') tab: string, @Param('field') field: string, @Body() dto: { value?: unknown }) {
    return this.svc.add(tab, field, dto?.value);
  }

  @Post(':tab/:field/remove')
  @Roles('COACH')
  @ApiOperation({ summary: 'Remove an option from a drop-down list (coaches)' })
  remove(@Param('tab') tab: string, @Param('field') field: string, @Body() dto: { value?: unknown }) {
    return this.svc.remove(tab, field, dto?.value);
  }
}
