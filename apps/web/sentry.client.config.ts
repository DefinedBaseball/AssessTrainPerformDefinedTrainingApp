/**
 * Sentry — client (browser) init.
 *
 * Loaded automatically by `withSentryConfig` (next.config.js) on the
 * client bundle. No-op when NEXT_PUBLIC_SENTRY_DSN isn't set, so dev
 * builds emit zero network traffic to Sentry. Production sets the DSN
 * via env at build time (Next.js inlines NEXT_PUBLIC_* at build).
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    /* Sample 10% of transactions by default; bump via env if a deeper
     * trace is needed during an incident. */
    tracesSampleRate: parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    /* Replay session sampling — keep low to control cost; bump only on
     * issues you want to reproduce. */
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.5,
  });
}
