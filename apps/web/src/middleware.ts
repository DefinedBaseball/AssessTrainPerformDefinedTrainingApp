import { NextResponse, type NextRequest } from 'next/server';

/* Tell the API who the visitor really is.

   The browser calls /api/* on THIS server, which proxies to the API (the
   rewrite in next.config.js). The API therefore sees every request coming
   from here, and its rate limits lumped the whole academy into one bucket.
   Before each /api call is proxied, attach the visitor's address
   (x-pdev-client-ip) plus the shared secret (x-pdev-proxy-key) that proves
   it came from us -- the API only honours the address with that key. Any
   x-pdev-* headers the browser sent are overwritten. */

export const config = {
  matcher: '/api/:path*',
  /* Node runtime: reads PROXY_SHARED_SECRET at request time on the server. */
  runtime: 'nodejs',
};

function visitorAddress(req: NextRequest): string {
  /* The edge in front of Render (Cloudflare) sets cf-connecting-ip and
     overwrites anything the browser sends. Fallbacks for other hosts. */
  const edge = req.headers.get('cf-connecting-ip') || req.headers.get('true-client-ip');
  if (edge) return edge.trim();
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || '';
}

export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.delete('x-pdev-client-ip');
  headers.delete('x-pdev-proxy-key');

  const secret = process.env.PROXY_SHARED_SECRET;
  const ip = visitorAddress(req);
  if (secret && ip) {
    headers.set('x-pdev-client-ip', ip);
    headers.set('x-pdev-proxy-key', secret);
  }
  return NextResponse.next({ request: { headers } });
}
