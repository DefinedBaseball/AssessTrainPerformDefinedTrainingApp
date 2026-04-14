import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { createHash, randomBytes } from 'crypto';
import { signJwt } from './jwt.util';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  private hashPassword(password: string, salt: string): string {
    return createHash('sha256').update(password + salt).digest('hex');
  }

  async register(email: string, password: string, role: 'COACH' | 'PLAYER') {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const salt = randomBytes(16).toString('hex');
    const hashed = this.hashPassword(password, salt);

    const user = await this.prisma.user.create({
      data: {
        email,
        password: `${salt}:${hashed}`,
        role,
      },
      include: { player: true },
    });

    const token = signJwt({
      sub: user.id,
      email: user.email,
      role: user.role as 'COACH' | 'PLAYER',
      playerId: user.player?.id ?? null,
    });

    return {
      token,
      id: user.id,
      email: user.email,
      role: user.role,
      playerId: user.player?.id ?? null,
    };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { player: true },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const [salt, hash] = user.password.split(':');
    const attempt = this.hashPassword(password, salt);
    if (attempt !== hash) throw new UnauthorizedException('Invalid credentials');

    const token = signJwt({
      sub: user.id,
      email: user.email,
      role: user.role as 'COACH' | 'PLAYER',
      playerId: user.player?.id ?? null,
    });

    return {
      token,
      id: user.id,
      email: user.email,
      role: user.role,
      playerId: user.player?.id ?? null,
    };
  }
}
