import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/jwt.guard';
import { VendorContactsService } from './vendor-contacts.service';

@ApiTags('vendor-contacts')
@ApiBearerAuth()
@Controller('vendor-contacts')
export class VendorContactsController {
  constructor(private svc: VendorContactsService) {}

  @Get()
  @Roles('COACH')
  @ApiOperation({ summary: 'Sales-rep contacts for each technology (coaches)' })
  list() {
    return this.svc.list();
  }

  /* Viewer-level coaches are refused by the global guard (writes). */
  @Put()
  @Roles('COACH')
  @ApiOperation({ summary: 'Save the technology sales-rep contacts (coaches)' })
  save(@Body() dto: { contacts: unknown }) {
    return this.svc.save(dto?.contacts);
  }
}
