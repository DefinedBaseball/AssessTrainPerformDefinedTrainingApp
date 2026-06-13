import { Controller, Post, Patch, Put, Body, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import type { SignupPlayerPayload } from './auth.service';
import { JwtAuthGuard, Roles, Public, AuthenticatedRequest } from './jwt.guard';

class RegisterDto {
  email!: string;
  password!: string;
  role!: 'COACH' | 'PLAYER';
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
  /* Coach-only — a signed-in COACH creates a new COACH or PLAYER account
   * (Settings → Staff, or Add New Athlete). No longer public: anonymous
   * self-registration is rejected. Still throttled to 5 / 10 min. */
  @Throttle({ short: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Create a new coach or player account (coach only)' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password, dto.role);
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List player accounts awaiting approval (coach only)' })
  listPending() {
    return this.authService.listPending();
  }

  @Post('pending/:userId/approve')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a pending player account (coach only)' })
  approvePending(@Param('userId') userId: string) {
    return this.authService.approvePlayer(userId);
  }

  @Post('pending/:userId/decline')
  @UseGuards(JwtAuthGuard)
  @Roles('COACH')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Decline + remove a pending player account (coach only)' })
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

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current authenticated user from token' })
  me(@Req() req: AuthenticatedRequest) {
    return this.authService.getMe(req.user!.sub);
  }

  @Patch('account')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update editable account fields (name, phone, position)' })
  updateAccount(
    @Req() req: AuthenticatedRequest,
    @Body() dto: { name?: string | null; phone?: string | null; position?: string | null },
  ) {
    return this.authService.updateAccount(req.user!.sub, dto);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
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
  @ApiOperation({ summary: 'Set another account’s password (coach only; primary admin is self-only)' })
  setUserPassword(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: { newPassword: string },
  ) {
    return this.authService.setUserPassword(req.user!.sub, userId, dto.newPassword);
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace the current user’s notification channel matrix' })
  setNotificationPrefs(@Req() req: AuthenticatedRequest, @Body() dto: unknown) {
    return this.authService.setNotificationPrefs(req.user!.sub, dto);
  }
}
