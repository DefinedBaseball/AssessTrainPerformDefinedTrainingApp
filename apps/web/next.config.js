/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/api/:path*',
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
