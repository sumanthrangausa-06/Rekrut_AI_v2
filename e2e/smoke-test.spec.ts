import { test, expect } from '@playwright/test';

/**
 * Smoke Test — Quick 30-second health check
 * Runs every 2 hours via QA discovery cron
 * Focus: critical public paths (no auth required)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Smoke Test — Critical Paths', () => {
  test('homepage loads without critical errors', async ({ page }) => {
    const response = await page.goto(BASE_URL);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
  });

  test('health endpoint returns ok', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  test('jobs page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/jobs`);
    await expect(page.locator('body')).toBeVisible();
  });

  test('login page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await expect(page.locator('body')).toBeVisible();
  });

  test('register page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/register`);
    await expect(page.locator('body')).toBeVisible();
  });
});
