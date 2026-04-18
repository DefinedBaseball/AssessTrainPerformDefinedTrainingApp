import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CollegesService } from './colleges.service';
import { Roles } from '../auth/jwt.guard';

class CollegeUpsertDto {
  name!: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
}

class CollegePatchDto {
  name?: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
}

@ApiTags('colleges')
@ApiBearerAuth()
@Controller('colleges')
export class CollegesController {
  constructor(private svc: CollegesService) {}

  @Get()
  @ApiOperation({ summary: 'List all colleges' })
  findAll() {
    return this.svc.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Post()
  @Roles('COACH')
  @ApiOperation({ summary: 'Create a college (COACH only)' })
  create(@Body() dto: CollegeUpsertDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Update a college (COACH only)' })
  update(@Param('id') id: string, @Body() dto: CollegePatchDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Delete a college (COACH only)' })
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
