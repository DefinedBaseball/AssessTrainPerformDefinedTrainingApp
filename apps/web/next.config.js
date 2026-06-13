/** @type {import('next').NextConfig} */

/* Where the Next server proxies `/api/*` to. In dev the API shares
 * localhost:3001; in production (web + API on separate hosts, e.g. two
 * Render services) set API_PROXY_TARGET to the API's base URL — e.g.
 * its Render internal URL or public https://…onrender.com. Keeping the
 * proxy means the browser only ever talks to the web origin, so there's
 * no cross-origin/CORS step for normal API calls. */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:3001';

const nextConfig = {
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
