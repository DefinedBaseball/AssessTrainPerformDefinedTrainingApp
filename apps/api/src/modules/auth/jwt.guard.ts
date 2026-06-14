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
import { verifyJwt, JwtPayload, CoachLevel } from './jwt.util';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: ('COACH' | 'PLAYER')[]) => SetMetadata(ROLES_KEY, roles);

/** Marks an endpoint as requiring an ADMIN-level coach (e.g. coach-account
 *  management, account approvals). */
export const ADMIN_ONLY_KEY = 'adminOnly';
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);

/** Marks a mutating endpoint that VIEWER-level coaches may still call —
 *  i.e. self-service writes (own profile/password/notification prefs/read
 *  state). Without this, the guard blocks all non-GET requests for viewers. */
export const VIEWER_ALLOWED_KEY = 'viewerAllowed';
export const ViewerAllowed = () => SetMetadata(VIEWER_ALLOWED_KEY, true);

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

/** Effective access level for a token. Players → null. Coaches → their level,
 *  defaulting to ADMIN for legacy tokens minted before RBAC existed. */
export function coachLevelOf(payload: JwtPayload | undefined): CoachLevel | null {
  if (!payload || payload.role !== 'COACH') return null;
  return (payload.coachLevel as CoachLevel) || 'ADMIN';
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

    // ── Coach access-level (RBAC) enforcement ──────────────────────────
    const level = coachLevelOf(payload);

    // Admin-only endpoints: coach-account management + account approvals.
    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (adminOnly && level !== 'ADMIN') {
      throw new ForbiddenException('Admin access required.');
    }

    // Viewer accounts are read-only: block any mutating method unless the
    // endpoint is explicitly self-service (own profile/password/prefs/bell).
    if (level === 'VIEWER') {
      const method = req.method.toUpperCase();
      const isMutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
      const viewerAllowed = this.reflector.getAllAndOverride<boolean>(VIEWER_ALLOWED_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (isMutating && !viewerAllowed) {
        throw new ForbiddenException('Viewer accounts have read-only access.');
      }
    }

    req.user = payload;
    return true;
  }
}
