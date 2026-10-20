import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminOnly, AuthenticatedRequest, ParentAllowed, Public, Roles } from '../auth/jwt.guard';
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

  @Post('me/delete')
  @Roles('PARENT')
  @ParentAllowed()
  @Throttle({ short: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Parent: permanently delete own parent login (password required)' })
  deleteMine(@Req() req: AuthenticatedRequest, @Body() dto: { password?: unknown }) {
    return this.parents.deleteMine(req.user!.sub, dto?.password);
  }

  /* ── Public: a parent creates their own account ── */

  @Public()
  @Post('signup')
  @Throttle({ short: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Public: create a parent account (name, email, phone, password)' })
  signup(@Body() dto: Record<string, unknown>) {
    return this.parents.signup({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      phone: dto.phone,
      password: dto.password,
      inviteCode: dto.inviteCode,
    });
  }

  @Public()
  @Get('invite/:code')
  @Throttle({ short: { limit: 30, ttl: 600_000 } })
  @ApiOperation({ summary: 'Public: the email + name an invite link pre-fills' })
  inviteInfo(@Param('code') code: string) {
    return this.parents.inviteInfo(code);
  }

  /* ── Coaches: Athlete Hub -> Add Parent ── */

  @Post('invite')
  @Roles('COACH')
  @Throttle({ short: { limit: 50, ttl: 600_000 } })
  @ApiOperation({ summary: 'Coach: email a parent a sign-up link that links the chosen athletes' })
  invite(@Req() req: AuthenticatedRequest, @Body() dto: Record<string, unknown>) {
    return this.parents.invite({ email: dto.email, name: dto.name, playerIds: dto.playerIds }, req.user!.sub);
  }

  @Post('manual')
  @Roles('COACH')
  @Throttle({ short: { limit: 50, ttl: 600_000 } })
  @ApiOperation({ summary: 'Coach: create a parent login by hand and link athletes' })
  createManual(@Body() dto: Record<string, unknown>) {
    return this.parents.createManual({
      firstName: dto.firstName, lastName: dto.lastName, email: dto.email, phone: dto.phone,
      birthDate: dto.birthDate, hometown: dto.hometown, password: dto.password, playerIds: dto.playerIds,
    });
  }

  /* ── Parent: Link Athlete ── */

  @Get('me/link-candidates')
  @Roles('PARENT')
  @ParentAllowed()
  @ApiOperation({ summary: 'Parent: athletes whose Parent Email matches this login' })
  linkCandidates(@Req() req: AuthenticatedRequest) {
    return this.parents.linkCandidates(req.user!.sub);
  }

  @Post('me/link-requests')
  @Roles('PARENT')
  @ParentAllowed()
  @Throttle({ short: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Parent: ask an admin to link some of those athletes' })
  requestLinks(@Req() req: AuthenticatedRequest, @Body() dto: { playerIds?: unknown }) {
    return this.parents.requestLinks(req.user!.sub, dto?.playerIds);
  }

  /* ── Admins: allow / deny a link request (notification bell) ── */

  @Post('link-requests/:id/approve')
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Admin: allow a parent link request' })
  approve(@Param('id') id: string) {
    return this.parents.decideLinkRequest(id, true);
  }

  @Post('link-requests/:id/deny')
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Admin: deny a parent link request' })
  deny(@Param('id') id: string) {
    return this.parents.decideLinkRequest(id, false);
  }

  /* ── Coaches: parent logins on an athlete (viewers read-only) ── */

  @Get('matching-athletes')
  @Roles('COACH')
  @ApiOperation({ summary: 'Coach: other athletes whose Parent Email matches an email' })
  matchingAthletes(@Query('email') email: string, @Query('exclude') exclude?: string) {
    return this.parents.matchingAthletes(email, exclude);
  }

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
