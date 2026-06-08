import { Controller, Post, Body, Get, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard, Public, AuthenticatedRequest } from './jwt.guard';

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

  @Public()
  @Post('register')
  /* 5 attempts / 10 minutes per IP — registration is rare, anything more
   * frequent is enumeration or scripted abuse. The @Throttle key must
   * match one of the named throttlers registered in AppModule (`short`
   * or `long`); we override `short` so the per-route limit replaces the
   * default 20/10s on this endpoint specifically. */
  @Throttle({ short: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Register a new coach or player account' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password, dto.role);
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
}
