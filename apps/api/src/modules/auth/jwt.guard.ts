import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { verifyJwt, JwtPayload } from './jwt.util';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: ('COACH' | 'PLAYER')[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

/**
 * Ownership guard for "/:playerId/..." style routes. Coaches see everything;
 * players may only access data tied to their own linked playerId. Throws
 * ForbiddenException if a player tries to peek at another athlete.
 *
 * Centralised here so every controller routes through the same check —
 * adding a new player-scoped read endpoint is a one-liner instead of a
 * handwritten conditional that's easy to forget.
 */
export function assertPlayerOwnership(
  req: AuthenticatedRequest,
  requestedPlayerId: string,
) {
  const user = req.user;
  if (!user) throw new UnauthorizedException();
  if (user.role === 'COACH') return;
  if (user.role === 'PLAYER' && user.playerId && user.playerId === requestedPlayerId) return;
  throw new ForbiddenException('You can only access your own data.');
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = req.headers['authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('Missing Authorization header');
    }
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid Authorization header');
    }

    const payload = verifyJwt(token);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Role check
    const requiredRoles = this.reflector.getAllAndOverride<('COACH' | 'PLAYER')[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(payload.role)) {
      throw new UnauthorizedException(
        `Required role: ${requiredRoles.join(' or ')}, got: ${payload.role}`,
      );
    }

    req.user = payload;
    return true;
  }
}
