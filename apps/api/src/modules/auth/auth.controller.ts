import { Controller, Post, Patch, Put, Delete, Body, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import type { SignupPlayerPayload } from './auth.service';
import { JwtAuthGuard, Roles, Public, AdminOnly, ViewerAllowed, AuthenticatedRequest } from './jwt.guard';
import type { CoachLevel } from './jwt.util';

class RegisterDto {
  email!: string;
  password!: string;
  name?: string; // optional display name (First Last) for the new account
  role!: 'COACH' | 'PLAYER';
  // Access level for new COACH accounts (ADMIN / COACH / VIEWER). Ignored for
  // players. Defaults to COACH when omitted.
  coachLevel?: CoachLevel;
}

class LoginDto {
  email!: string;
  password!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @ApiBearerAuth()
  @Post('register')
  /* Signed-in COACH creates a new account. Creating a PLAYER (Add New Athlete)
   * is open to any non-viewer coach; creating a COACH requires ADMIN level —
   * that check lives in authService.register. No longer public. Throttled. */
  @Throttle({ short: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Create a coach (admin only) or player account' })
  register(@Req() req: AuthenticatedRequest, @Body() dto: RegisterDto) {
    return this.authService.register(req.user!, dto.email, dto.password, dto.role, dto.coachLevel, dto.name);
  }

  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @ApiBearerAuth()
  @Post('invite')
  /* Emails a set-password link for an account a coach just created on
   * someone's behalf (inquiry -> player profile). Those accounts get a random
   * password the athlete never sees, so this is their only way in.
   *
   * Throttled looser than /register: it neither creates an account nor
   * accepts a password, it just mails an existing user, and a coach working
   * through a batch of inquiries would otherwise trip the 5/10min cap. */
  @Throttle({ short: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Email a set-password invite to an existing account (COACH only)' })
  invite(@Body() dto: { email: string; name?: string }) {
    return this.authService.sendInvite(dto.email, dto.name);
  }

  @Roles('COACH')
  @ApiBearerAuth()
  @Post('invite-registration')
  /* Emails a link to the PUBLIC Create an Account form, for someone who has
   * no account yet -- the "Email" half of Add Athlete. Distinct from
   * /auth/invite, which mails a set-password token for an account a coach
   * already created.
   *
   * Same 20/10min cap as /auth/invite: it creates nothing, it just sends one
   * message, and a coach inviting a squad would trip a tighter limit. */
  @Throttle({ short: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Email a registration link to a prospective athlete (COACH only)' })
  inviteRegistration(@Body() dto: { email: string }) {
    return this.authService.sendRegistrationInvite(dto?.email);
  }

  @Public()
  @Post('signup')
  /* Public player self-registration. Creates a PENDING account + profile and
   * notifies coaches. Throttled to 5 / 10 min to slow abuse. */
  @Throttle({ short: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Self-register a player account (pending coach approval)' })
  signup(@Body() dto: SignupPlayerPayload) {
    return this.authService.signupPlayer(dto);
  }

  @Get('pending')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List player accounts awaiting approval (admin only)' })
  listPending() {
    return this.authService.listPending();
  }

  @Post('pending/:userId/approve')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a pending player account (admin only)' })
  approvePending(@Param('userId') userId: string) {
    return this.authService.approvePlayer(userId);
  }

  @Post('pending/:userId/decline')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Decline + remove a pending player account (admin only)' })
  declinePending(@Param('userId') userId: string) {
    return this.authService.declinePlayer(userId);
  }

  @Get('coaches')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all coach accounts (coach only)' })
  listCoaches() {
    return this.authService.listCoaches();
  }

  @Public()
  @Post('login')
  /* 5 attempts / minute per IP — strict enough to slow brute force,
   * loose enough that a fat-finger user retrying their password isn't
   * locked out. Overrides the `short` named throttler from AppModule. */
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login with email and password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Public()
  @Post('forgot-password')
  /* Request a reset email. Always returns { ok: true } regardless of whether
     the email exists (no account enumeration). Throttled 5 / 10 min. */
  @Throttle({ short: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Request a password-reset email' })
  forgotPassword(@Body() dto: { email: string }) {
    return this.authService.requestPasswordReset(dto?.email);
  }

  @Public()
  @Post('reset-password')
  /* Complete a reset with an emailed token + new password. Throttled. */
  @Throttle({ short: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Complete a password reset using an emailed token' })
  resetPassword(@Body() dto: { token: string; newPassword: string }) {
    return this.authService.resetPassword(dto?.token, dto?.newPassword);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current authenticated user from token' })
  me(@Req() req: AuthenticatedRequest) {
    return this.authService.getMe(req.user!.sub);
  }

  @Patch('account')
  @UseGuards(JwtAuthGuard)
  @ViewerAllowed()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update editable account fields (name, phone, position; email for players)' })
  updateAccount(
    @Req() req: AuthenticatedRequest,
    @Body() dto: { name?: string | null; phone?: string | null; position?: string | null; email?: string | null },
  ) {
    return this.authService.updateAccount(req.user!.sub, dto);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ViewerAllowed()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change the current user’s password' })
  changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: { currentPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(req.user!.sub, dto.currentPassword, dto.newPassword);
  }

  @Post('users/:userId/set-password')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set another account’s password (coach for players; admin for coaches)' })
  setUserPassword(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: { newPassword: string },
  ) {
    return this.authService.setUserPassword(req.user!, userId, dto.newPassword);
  }

  @Post('users/:userId/email')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Change a login email (any coach for athletes; admin for coaches)" })
  setUserEmail(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: { email: string },
  ) {
    return this.authService.setUserEmail(req.user!, userId, dto.email);
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @ViewerAllowed()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign the caller out on every device (this one included)' })
  logoutAll(@Req() req: AuthenticatedRequest) {
    return this.authService.signOutEverywhere(req.user!.sub);
  }

  @Post('users/:userId/logout-all')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Sign an athlete out on every device (coach); a coach only by an admin" })
  logoutUserAll(@Req() req: AuthenticatedRequest, @Param('userId') userId: string) {
    return this.authService.signOutUserEverywhere(req.user!, userId);
  }

  @Post('users/:userId/coach-status')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pause (LOCKED) or restore (ACTIVE) a coach account (admin only)' })
  setCoachStatus(@Req() req: AuthenticatedRequest, @Param('userId') userId: string, @Body() dto: { status: string }) {
    return this.authService.setCoachStatus(req.user!, userId, dto?.status);
  }

  @Delete('coaches/:userId')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Permanently delete a coach account (admin only)' })
  deleteCoach(@Req() req: AuthenticatedRequest, @Param('userId') userId: string) {
    return this.authService.deleteCoach(req.user!, userId);
  }

  @Post('invite-coach')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @AdminOnly()
  @Throttle({ short: { limit: 20, ttl: 600_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a coach account and email them a set-password link (admin only)' })
  inviteCoach(@Req() req: AuthenticatedRequest, @Body() dto: { email?: string; name?: string; coachLevel?: CoachLevel }) {
    return this.authService.inviteCoach(req.user!, dto);
  }

  @Post('users/:userId/phone')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Set a player account's phone number (coach)" })
  setUserPhone(
    @Param('userId') userId: string,
    @Body() dto: { phone: string | null },
  ) {
    return this.authService.setUserPhone(userId, dto?.phone ?? null);
  }

  @Post('users/:userId/name')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Set another account's display name (admin for anyone; self allowed)" })
  setUserName(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: { name: string },
  ) {
    return this.authService.setUserName(req.user!, userId, dto.name);
  }

  @Post('users/:userId/coach-level')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set a coach’s access level — ADMIN / COACH / VIEWER (admin only)' })
  setCoachLevel(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: { level: CoachLevel },
  ) {
    return this.authService.setCoachLevel(req.user!.sub, userId, dto.level);
  }

  @Get('notification-prefs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current user’s notification channel matrix' })
  getNotificationPrefs(@Req() req: AuthenticatedRequest) {
    return this.authService.getNotificationPrefs(req.user!.sub);
  }

  @Put('notification-prefs')
  @UseGuards(JwtAuthGuard)
  @ViewerAllowed()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace the current user’s notification channel matrix' })
  setNotificationPrefs(@Req() req: AuthenticatedRequest, @Body() dto: unknown) {
    return this.authService.setNotificationPrefs(req.user!.sub, dto);
  }
}
