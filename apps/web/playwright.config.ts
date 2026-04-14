import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the web app's E2E tests.
 *
 * Assumes both the API (localhost:3001) and the web app (localhost:3000)
 * are already running. Start them with the preview tool or:
 *   apps/api>  npm run dev
 *   apps/web>  npm run dev
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
