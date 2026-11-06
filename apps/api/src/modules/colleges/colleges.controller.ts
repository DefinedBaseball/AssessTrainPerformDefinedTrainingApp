import { Body, Controller, Delete, Get, Param, Patch, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CollegesService } from './colleges.service';
import { Roles, ParentAllowed, Public } from '../auth/jwt.guard';

class CollegeUpsertDto {
  name!: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  division?: string | null;
}

class CollegePatchDto {
  name?: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  division?: string | null;
}

@ApiTags('colleges')
@ApiBearerAuth()
@Controller('colleges')
export class CollegesController {
  constructor(private svc: CollegesService) {}

  @Get()
  @ParentAllowed() // the profile shows the commitment logo
  @ApiOperation({ summary: 'List all colleges' })
  findAll() {
    return this.svc.findAll();
  }

  /* The logo image. Public like the profile photos: an <img> can't send the
     sign-in header, and a college's logo is public anyway. The link carries
     a version (?v=last edit), so it is cached for a year and a new logo is
     simply a new link. */
  @Get(':id/logo')
  @Public()
  @ApiOperation({ summary: "A college's uploaded logo image" })
  async logo(@Param('id') id: string, @Res() res: Response) {
    const logo = await this.svc.getLogo(id);
    res.set({
      'Content-Type': logo.mime,
      'Content-Length': String(logo.data.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      /* An SVG opened on its own could run script; a sandbox stops that. */
      ...(logo.mime === 'image/svg+xml' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
    });
    res.send(logo.data);
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
