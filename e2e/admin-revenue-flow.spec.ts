import { test, expect } from '@playwright/test';

// Admin credentials from environment variables only
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

test.describe('Admin Revenue Flow', () => {
  test.beforeAll(() => {
    if (!ADMIN_PASSWORD) {
      test.skip(true, 'Admin password not available — skipping admin revenue tests');
    }
  });

  test('admin revenue dashboard loads and shows key sections', async ({ page }) => {
    // ─── Login as admin ───
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': '5.6.7.8' });
    await page.goto('/admin/login');
    await expect(page.getByRole('heading', { name: /Admin Access/i })).toBeVisible();

    await page.fill('input#username', ADMIN_USERNAME);
    await page.fill('input#password', ADMIN_PASSWORD);
    await page.getByRole('button', { name: /Sign in|Login/i }).click();

    await expect(page).toHaveURL(/.*\/admin\/(ai-health|dashboard|analytics|agents)/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    // ─── Navigate to Revenue Dashboard ───
    await page.goto('/admin/revenue');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);

    // Verify main heading
    await expect(page.getByRole('heading', { name: /Revenue Dashboard/i })).toBeVisible({ timeout: 10000 });

    // Verify Stripe badge is present
    await expect(page.locator('text=Stripe ready').or(page.locator('text=Stripe needs setup')).first()).toBeVisible({ timeout: 10000 });

    // Verify headline metric cards
    for (const label of ['Pricing viewers', 'Checkout starts', 'Checkout confirmations', 'Enterprise leads']) {
      await expect(page.locator('text=' + label).first()).toBeVisible({ timeout: 10000 });
    }

    // Verify funnel sections exist
    await expect(page.locator('text=Acquisition funnel').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Revenue funnel').first()).toBeVisible({ timeout: 10000 });

    // Verify navigation links exist
    await expect(page.getByRole('link', { name: /Open pricing page/i }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /AI health/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Test signup flow/i }).first()).toBeVisible();
  });
});
