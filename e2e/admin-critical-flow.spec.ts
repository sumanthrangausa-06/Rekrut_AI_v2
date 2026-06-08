import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Read admin credentials from the dev-generated file
const credFile = path.join(__dirname, '..', '.admin-credentials');
let ADMIN_USERNAME = 'admin';
let ADMIN_PASSWORD = '';

if (fs.existsSync(credFile)) {
  const content = fs.readFileSync(credFile, 'utf-8');
  const userMatch = content.match(/Username:\s*(.+)/);
  const passMatch = content.match(/Password:\s*(.+)/);
  if (userMatch) ADMIN_USERNAME = userMatch[1].trim();
  if (passMatch) ADMIN_PASSWORD = passMatch[1].trim();
}

// Fallback: use env vars if available
ADMIN_USERNAME = process.env.ADMIN_USERNAME || ADMIN_USERNAME;
ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ADMIN_PASSWORD;

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
    await expect(page).toHaveURL(/.*\/admin\/(ai-health|dashboard)/, { timeout: 10000 });
    await expect(page.locator('text=Admin').or(page.locator('text=Dashboard')).first()).toBeVisible({ timeout: 10000 });

    // ─── 2. View Analytics ───
    await page.goto('/admin/analytics');
    await expect(page.getByRole('heading', { name: /Analytics/i })).toBeVisible({ timeout: 10000 });

    // Verify analytics data sections are visible
    await expect(
      page.locator('text=Visitors').or(page.locator('text=Signups')).or(page.locator('text=Engagement')).first()
    ).toBeVisible({ timeout: 10000 });

    // ─── 3. View Admin Dashboard ───
    await page.goto('/admin/dashboard');
    await expect(page.getByRole('heading', { name: /Dashboard|Admin Dashboard/i })).toBeVisible({ timeout: 10000 });

    // Verify key stat cards are visible
    await expect(
      page.locator('text=Users').or(page.locator('text=Jobs')).or(page.locator('text=Revenue')).or(page.locator('text=MRR')).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('admin agents page loads', async ({ page }) => {
    if (!ADMIN_PASSWORD) test.skip();

    await page.goto('/admin/login');
    await page.fill('input#username', ADMIN_USERNAME);
    await page.fill('input#password', ADMIN_PASSWORD);
    await page.getByRole('button', { name: /Sign in|Login/i }).click();

    await page.goto('/admin/agents');
    await expect(page.getByRole('heading', { name: /Agents|Agent/i })).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('text=Active').or(page.locator('text=Status')).or(page.locator('text=Tasks')).first()
    ).toBeVisible({ timeout: 10000 });
  });
});
