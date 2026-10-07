import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';

/**
 * Rate limiting keyed on the real visitor, not the last hop.
 *
 * Browsers never call this API directly: the web app's server proxies /api/*
 * here. So the connection the API sees comes from the web server (through
 * Render's edge) for EVERY user, and the stock tracker (req.ip) lumped the
 * whole academy into one bucket -- a few coaches opening profiles at once,
 * or six people signing in within a minute, got everyone "too many
 * requests".
 *
 * The web app's middleware now forwards the visitor's address in
 * `x-pdev-client-ip`, signed with `x-pdev-proxy-key` = PROXY_SHARED_SECRET
 * (set on both services). That header is honoured ONLY with the matching
 * key, so nobody calling the API directly can pick their own bucket.
 * Unsigned requests fall back to the edge's client-IP header, then the
 * socket address.
 */
export function clientIpFrom(req: Record<string, any>): string {
  const h = (name: string): string => {
    const v = req.headers?.[name];
    return (Array.isArray(v) ? v[0] : v || '').toString().trim();
  };

  const secret = process.env.PROXY_SHARED_SECRET || '';
  const key = h('x-pdev-proxy-key');
  const forwarded = h('x-pdev-client-ip');
  if (secret && key && forwarded) {
    const a = Buffer.from(key);
    const b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) return forwarded;
  }

  /* Set by the edge (Cloudflare in front of Render), which overwrites any
     value the caller sent. */
  const edge = h('cf-connecting-ip') || h('true-client-ip');
  if (edge) return edge;

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return clientIpFrom(req);
  }
}
