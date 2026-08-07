import { test, expect } from '@playwright/test';

/**
 * Smoke Test — Quick 30-second health check
 * Runs every 2 hours via QA discovery cron
 * Focus: critical public paths (no auth required)
 */

const STAGING_URL = process.env.BASE_URL || 'https://rekrutai-staging.onrender.com';

test.describe('Smoke Test — Critical Paths', () => {
  test('homepage loads without critical errors', async ({ page }) => {
    const response = await page.goto(STAGING_URL);
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
  });

  test('health endpoint returns ok', async ({ request }) => {
    const response = await request.get(`${STAGING_URL}/health`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  test('jobs page loads', async ({ page }) => {
    const response = await page.goto(`${STAGING_URL}/jobs`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
  });

  test('login page loads', async ({ page }) => {
    const response = await page.goto(`${STAGING_URL}/login`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
  });

  test('register page loads', async ({ page }) => {
    const response = await page.goto(`${STAGING_URL}/register`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
  });
});
