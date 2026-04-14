import { test, expect } from '@playwright/test';

/**
 * Happy-path E2E:
 *   1. Land on /login
 *   2. Click "Coach Demo" → JWT lands in localStorage, dashboard renders
 *   3. Click first player card on Athletes page → profile loads
 *   4. From profile, click "+ New Report" → reports page is preselected with playerId
 *   5. Sign out → returned to /login
 */

test('coach can sign in, browse a player, deep-link to a new report, and sign out', async ({ page }) => {
  test.setTimeout(60_000);

  // Step 1 — login page
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Player Development' })).toBeVisible();

  // Step 2 — click Coach Demo
  await page.getByRole('button', { name: 'Coach Demo' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });

  // JWT should be persisted
  const token = await page.evaluate(() => localStorage.getItem('pdapp_token'));
  expect(token, 'JWT should be in localStorage after login').toBeTruthy();

  // Step 3 — navigate to Athletes, click first player card
  await page.getByRole('link', { name: /Athletes/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Athletes' })).toBeVisible({ timeout: 10_000 });

  // The athletes page renders player cards as links in <main> — click the first one
  await page.locator('main a[href^="/athletes/"]').first().click();
  await expect(page).toHaveURL(/\/athletes\/[a-f0-9-]+/, { timeout: 10_000 });
  // Profile header (player full name) should render
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
  // Reports section should be present (even if empty)
  await expect(page.getByRole('heading', { name: /Reports \(\d+\)/ })).toBeVisible();

  // Step 4 — deep-link to new report
  await page.getByRole('link', { name: '+ New Report' }).first().click();
  await expect(page).toHaveURL(/\/reports\?playerId=[a-f0-9-]+/);
  // The athlete <select> should already have the player chosen (non-empty value)
  const selectedValue = await page.locator('select').first().inputValue();
  expect(selectedValue, 'Player should be preselected from the deep link').toMatch(/^[a-f0-9-]+$/);

  // Step 5 — sign out
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  const tokenAfter = await page.evaluate(() => localStorage.getItem('pdapp_token'));
  expect(tokenAfter, 'JWT should be cleared after sign out').toBeNull();
});
