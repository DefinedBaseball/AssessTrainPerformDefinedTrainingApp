/** @type {import('next').NextConfig} */

/* Where the Next server proxies `/api/*` to. In dev the API shares
 * localhost:3001; in production (web + API on separate hosts, e.g. two
 * Render services) set API_PROXY_TARGET to the API's base URL — e.g.
 * its Render internal URL or public https://…onrender.com. Keeping the
 * proxy means the browser only ever talks to the web origin, so there's
 * no cross-origin/CORS step for normal API calls. */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:3001';

const nextConfig = {
  /* Image optimization off. The app never uses next/image, but the optimizer
     endpoint (/_next/image) is live by default -- and it is where Next
     <15.5.24's critical unauthenticated RCE lived. Images are served as-is,
     which is what already happens everywhere in this app. */
  images: { unoptimized: true },
  /* Don't advertise the framework/version in every response. */
  poweredByHeader: false,
  /* Browser security headers. The API already sends these (helmet); the
     web app sent none, so any site could load it in a hidden frame and
     trick a signed-in coach into clicking (clickjacking).

     /inquiry is left frameable on purpose -- it's the public form meant
     for the Defined Baseball website, which may embed it. Everything else
     refuses to be framed. No full Content-Security-Policy yet: the app
     leans on inline styles, and a strict policy needs its own pass. */
  async headers() {
    const base = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      /* Browsers only honour this over HTTPS (Render serves HTTPS). */
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      /* Camera + microphone stay allowed for this site -- live sessions
         record video. Nothing in the app uses location. */
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
    ];
    const noFraming = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
    ];
    return [
      { source: '/inquiry', headers: base },
      { source: '/((?!inquiry$).*)', headers: [...base, ...noFraming] },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_PROXY_TARGET}/api/:path*`,
      },
    ];
  },
};

/* Sentry wrapper — only applies its build-time integrations when a DSN
 * is present. Without one, the app builds and runs identically to the
 * pre-Sentry config. We disable source-map upload locally; production
 * builds set SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT and turn
 * silent off so the upload runs. */
const { withSentryConfig } = require('@sentry/nextjs');

module.exports = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      // Tunnel route avoids ad-blockers swallowing client error events.
      tunnelRoute: '/monitoring',
      hideSourceMaps: true,
      disableLogger: true,
    })
  : nextConfig;
