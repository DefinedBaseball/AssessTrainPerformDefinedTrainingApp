import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InquiriesService } from './inquiries.service';
import { Roles, Public } from '../auth/jwt.guard';

class CreateInquiryDto {
  firstName!: string;
  lastName!: string;
  email!: string;
  phone?: string | null;
  school?: string | null;
  gradYear?: number | null;
  clubTeam?: string | null;
  positions?: string | null;
  birthDate?: string | null;
  otherSports?: string | null;
  injuryHistory?: string | null;
  otherHobbies?: string | null;
  goalLevel?: string | null; // High School | College | Professional
  goals?: string | null;
  message?: string | null;
  formData?: string | null;
}

@ApiTags('inquiries')
@Controller('inquiries')
export class InquiriesController {
  constructor(private inquiries: InquiriesService) {}

  @Get()
  @Roles('COACH')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List inquiry-form submissions (COACH only)' })
  findAll() {
    return this.inquiries.findAll();
  }

  @Get(':id')
  @Roles('COACH')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get one inquiry (COACH only)' })
  findOne(@Param('id') id: string) {
    return this.inquiries.findOne(id);
  }

  @Public()
  @Post()
  /* Public — the inquiry form (built later) posts here. Throttled 5/10min to
     slow abuse, same as /auth/signup. */
  @Throttle({ short: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Submit an inquiry (public form)' })
  create(@Body() dto: CreateInquiryDto) {
    return this.inquiries.create(dto);
  }

  @Patch(':id/status')
  @Roles('COACH')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an inquiry status — NEW/REVIEWED/ARCHIVED (COACH only)' })
  updateStatus(@Param('id') id: string, @Body() dto: { status: string }) {
    return this.inquiries.updateStatus(id, dto.status);
  }

  @Delete(':id')
  @Roles('COACH')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete an inquiry (COACH only)' })
  remove(@Param('id') id: string) {
    return this.inquiries.remove(id);
  }
}
