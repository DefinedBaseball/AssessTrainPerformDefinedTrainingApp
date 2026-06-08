/**
 * Minimal HS256 JWT implementation using Node crypto.
 * Avoids adding @nestjs/jwt or jsonwebtoken as a dependency.
 * For production deployment, consider migrating to AWS Cognito (Terraform module already configured).
 */
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * JWT signing secret. In production we fail fast at boot if it's missing —
 * a default secret would let anyone forge tokens against a deployed env.
 * Local dev (NODE_ENV !== 'production') keeps the convenience fallback so
 * `npm run dev` and the seed scripts still work without env setup.
 */
const SECRET = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET environment variable is required in production. ' +
        'Set it via your secrets manager (AWS Secrets Manager / SSM / etc).',
    );
  }
  return 'dev-secret-change-in-production-please-use-aws-secrets-manager';
})();

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: 'COACH' | 'PLAYER';
  playerId: string | null;
  iat: number;
  exp: number;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (padded.length % 4)) % 4);
  return Buffer.from(padded + padding, 'base64');
}

function sign(data: string): string {
  return base64UrlEncode(createHmac('sha256', SECRET).update(data).digest());
}

export function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${header}.${body}`;
  const signature = sign(data);
  return `${data}.${signature}`;
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expected = sign(`${header}.${body}`);
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expBuf)) return null;

    const payload: JwtPayload = JSON.parse(base64UrlDecode(body).toString('utf8'));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
