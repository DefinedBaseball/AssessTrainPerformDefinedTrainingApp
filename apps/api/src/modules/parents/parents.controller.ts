import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedRequest, ParentAllowed, Roles } from '../auth/jwt.guard';
import { ParentsService } from './parents.service';

@ApiTags('parents')
@ApiBearerAuth()
@Controller('parents')
export class ParentsController {
  constructor(private parents: ParentsService) {}

  /* ── The parent's own profile ── */

  @Get('me')
  @Roles('PARENT')
  @ParentAllowed()
  @ApiOperation({ summary: 'Parent: own profile + linked athletes' })
  getMine(@Req() req: AuthenticatedRequest) {
    return this.parents.getMine(req.user!.sub);
  }

  @Put('me')
  @Roles('PARENT')
  @ParentAllowed()
  @ApiOperation({ summary: 'Parent: update own name / phone / birthday / hometown' })
  updateMine(@Req() req: AuthenticatedRequest, @Body() dto: Record<string, unknown>) {
    return this.parents.updateMine(req.user!.sub, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      birthDate: dto.birthDate,
      hometown: dto.hometown,
    });
  }

  /* ── Coaches: parent logins on an athlete (viewers read-only) ── */

  @Get('for-player/:playerId')
  @Roles('COACH')
  @ApiOperation({ summary: 'Coach: parent logins linked to an athlete' })
  listForPlayer(@Param('playerId') playerId: string) {
    return this.parents.listForPlayer(playerId);
  }

  @Post()
  @Roles('COACH')
  @Throttle({ short: { limit: 50, ttl: 600_000 } })
  @ApiOperation({ summary: 'Coach: create a parent login for an athlete, or link an existing one' })
  createOrLink(@Body() dto: Record<string, unknown>) {
    return this.parents.createOrLink({
      playerId: dto.playerId,
      email: dto.email,
      password: dto.password,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });
  }

  @Delete(':parentId/links/:playerId')
  @Roles('COACH')
  @ApiOperation({ summary: 'Coach: unlink an athlete from a parent login' })
  unlink(@Param('parentId') parentId: string, @Param('playerId') playerId: string) {
    return this.parents.unlink(parentId, playerId);
  }
}
