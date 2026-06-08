import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/admin.json' });

test.describe('Admin Revenue Flow', () => {
  test('admin revenue dashboard loads and shows key sections', async ({ page }) => {
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
    await expect(page.locator('text=Monetization funnel').first()).toBeVisible({ timeout: 10000 });

    // Verify navigation links exist
    await expect(page.getByRole('link', { name: /Open pricing page/i }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /AI health/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Test signup flow/i }).first()).toBeVisible();
  });
});
