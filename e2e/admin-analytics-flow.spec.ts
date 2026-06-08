import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/admin.json' });

test.describe('Admin Analytics Flow', () => {
  test('admin analytics dashboard loads and shows all key sections', async ({ page }) => {
    await page.goto('/admin/analytics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);

    // Verify main heading
    await expect(page.getByText('Analytics Dashboard').first()).toBeVisible({ timeout: 10000 });

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
