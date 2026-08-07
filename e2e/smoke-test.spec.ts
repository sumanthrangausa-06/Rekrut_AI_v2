import { test, expect } from '@playwright/test';

/**
 * Smoke Test — Quick 30-second health check
 * Runs every 2 hours via QA discovery cron
 * Focus: critical paths only
 */

const STAGING_URL = process.env.BASE_URL || 'https://rekrutai-staging.onrender.com';
const CANDIDATE_EMAIL = 'e2e-candidate@rekrutai.test';
const RECRUITER_EMAIL = 'e2e-recruiter@rekrutai.test';
const PASSWORD = 'TestPass123!';

test.describe('Smoke Test — Critical Paths', () => {
  test('homepage loads without errors', async ({ page }) => {
    const response = await page.goto(STAGING_URL);
    expect(response?.status()).toBe(200);
    
    // Check no console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
    
    // Key elements visible
    await expect(page.locator('body')).toBeVisible();
  });

  test('candidate login works', async ({ page }) => {
    await page.goto(`${STAGING_URL}/login`);
    await page.fill('input#email', CANDIDATE_EMAIL);
    await page.fill('input#password', PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    
    // Should redirect to candidate dashboard
    await expect(page).toHaveURL(/.*candidate/, { timeout: 10000 });
  });

  test('recruiter login works', async ({ page }) => {
    await page.goto(`${STAGING_URL}/login`);
    await page.fill('input#email', RECRUITER_EMAIL);
    await page.fill('input#password', PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    
    // Should redirect to recruiter dashboard
    await expect(page).toHaveURL(/.*recruiter/, { timeout: 10000 });
  });

  test('health endpoint returns ok', async ({ request }) => {
    const response = await request.get(`${STAGING_URL}/health`);
    expect(response.status()).toBe(200);
    
    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  test('job search page loads', async ({ page }) => {
    await page.goto(`${STAGING_URL}/jobs`);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('text=/job|position|search/i').first()).toBeVisible({ timeout: 5000 });
  });
});
