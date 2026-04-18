import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClubTeamsService } from './club-teams.service';
import { Roles } from '../auth/jwt.guard';

class ClubTeamUpsertDto {
  name!: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
}

class ClubTeamPatchDto {
  name?: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
}

@ApiTags('club-teams')
@ApiBearerAuth()
@Controller('club-teams')
export class ClubTeamsController {
  constructor(private svc: ClubTeamsService) {}

  @Get()
  @ApiOperation({ summary: 'List all club teams' })
  findAll() {
    return this.svc.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Post()
  @Roles('COACH')
  @ApiOperation({ summary: 'Create a club team (COACH only)' })
  create(@Body() dto: ClubTeamUpsertDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Update a club team (COACH only)' })
  update(@Param('id') id: string, @Body() dto: ClubTeamPatchDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @Roles('COACH')
  @ApiOperation({ summary: 'Delete a club team (COACH only)' })
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
