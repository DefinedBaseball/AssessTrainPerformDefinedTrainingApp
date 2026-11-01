import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParentAllowed, Roles } from '../auth/jwt.guard';
import { FacilityProgramsService } from './facility-programs.service';

@ApiTags('facility-programs')
@ApiBearerAuth()
@Controller('facility-programs')
export class FacilityProgramsController {
  constructor(private svc: FacilityProgramsService) {}

  /* Everyone signed in reads it: athletes' and parents' calendars draw the
     program colours, names and weeks. */
  @Get()
  @Roles('COACH', 'PLAYER', 'PARENT')
  @ParentAllowed()
  @ApiOperation({ summary: 'Facility programs (dates, weekday start times, colours)' })
  list() {
    return this.svc.list();
  }

  /* Viewer-level coaches are refused by the global guard (writes). */
  @Put()
  @Roles('COACH')
  @ApiOperation({ summary: 'Save the facility programs (Settings → Programs, coaches)' })
  save(@Body() dto: { programs: unknown }) {
    return this.svc.save(dto?.programs);
  }
}
