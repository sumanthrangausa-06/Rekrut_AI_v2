import { test, expect } from '@playwright/test';

// Admin credentials from environment variables only
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

test.describe('Admin Analytics Flow', () => {
  test.beforeAll(() => {
    if (!ADMIN_PASSWORD) {
      test.skip(true, 'Admin password not available — skipping admin analytics tests');
    }
  });

  test('admin analytics dashboard loads and shows all key sections', async ({ page }) => {
    // ─── Login as admin ───
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': '6.7.8.9' });
    await page.goto('/admin/login');
    await expect(page.getByRole('heading', { name: /Admin Access/i })).toBeVisible();

    await page.fill('input#username', ADMIN_USERNAME);
    await page.fill('input#password', ADMIN_PASSWORD);
    await page.getByRole('button', { name: /Sign in|Login/i }).click();

    await expect(page).toHaveURL(/.*\/admin\/(ai-health|dashboard|analytics|agents)/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    // ─── Navigate to Analytics Dashboard ───
    await page.goto('/admin/analytics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);

    // Verify main heading
    await expect(page.getByRole('heading', { name: /Analytics Dashboard/i })).toBeVisible({ timeout: 10000 });

    // Verify date range filter inputs
    await expect(page.locator('input[type="date"]').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /Apply/i }).first()).toBeVisible();

    // Verify key metric cards
    for (const metric of ['Daily Visitors', 'Total Sign-ups', 'Conversion Rate', 'Click-Through Rate']) {
      await expect(page.locator('text=' + metric).first()).toBeVisible({ timeout: 10000 });
    }

    // Verify Sign-up Funnel section
    await expect(page.getByText('Sign-up Funnel').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Landing Page Views').first()).toBeVisible();
    await expect(page.locator('text=Sign-ups Completed').first()).toBeVisible();

    // Verify Daily Visitors chart section
    await expect(page.getByText('Daily Visitors').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Last 30 Days').first()).toBeVisible();

    // Verify Feature Engagement and Page Views sections
    await expect(page.getByText('Feature Engagement').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Page Views').first()).toBeVisible({ timeout: 10000 });
  });
});
