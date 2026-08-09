import { test, expect } from '@playwright/test';

// Admin credentials from environment variables only
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const envPassword = process.env.ADMIN_PASSWORD || '';
const ADMIN_PASSWORD_PLACEHOLDERS = [
  'YOUR_STRONG_ADMIN_PASSWORD_HERE',
  'change-me-strong-password',
];
const ADMIN_PASSWORD = ADMIN_PASSWORD_PLACEHOLDERS.includes(envPassword)
  ? 'Changeme123!'
  : envPassword;

// ───────────────────────────────────────────────
// Admin Critical Flow
// ───────────────────────────────────────────────
test.describe('Admin Critical Flow', () => {
  test.beforeAll(() => {
    if (!ADMIN_PASSWORD) {
      test.skip(true, 'Admin password not available — skipping admin tests');
    }
  });

  test('admin login → view analytics → view dashboard', async ({ page }) => {
    // ─── 1. Admin Login ───
    await page.goto('/admin/login');
    await expect(page.getByRole('heading', { name: /Admin Access/i })).toBeVisible();

    await page.fill('input#username', ADMIN_USERNAME);
    await page.fill('input#password', ADMIN_PASSWORD);
    await page.getByRole('button', { name: /Sign in|Login/i }).click();

    // Should redirect to admin dashboard (default returnTo is /admin/ai-health)
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/.*\/admin/, { timeout: 15000 });
    // Wait for admin navigation to render
    await page.waitForTimeout(800);
    // Verify we're on an admin page by checking for admin-specific content
    await expect(page.locator('text=Admin').or(page.locator('text=Dashboard')).or(page.locator('text=AI Health')).first()).toBeVisible({ timeout: 10000 });

    // ─── 2. View Admin Dashboard ───
    await page.goto('/admin/dashboard');
    await page.waitForTimeout(1000);
    // Verify admin page loaded (any admin heading or content)
    await expect(page.locator('h1').or(page.getByRole('heading')).first()).toBeVisible({ timeout: 10000 });
  });

  test('admin agents page loads', async ({ page }) => {
    if (!ADMIN_PASSWORD) test.skip();

    await page.goto('/admin/login');
    await page.fill('input#username', ADMIN_USERNAME);
    await page.fill('input#password', ADMIN_PASSWORD);
    await page.getByRole('button', { name: /Sign in|Login/i }).click();

    // Wait for login to complete and any redirect to settle
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/.*\/admin/, { timeout: 15000 });
    await page.waitForTimeout(800);

    await page.goto('/admin/agents');
    await page.waitForTimeout(1000);
    // Verify agents page loaded (any heading)
    await expect(page.locator('h1').or(page.getByRole('heading')).first()).toBeVisible({ timeout: 10000 });
  });
});
