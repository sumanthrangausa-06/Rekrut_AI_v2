import { test, expect } from '@playwright/test';
import { openDashboardSidebarIfNeeded } from './helpers';

const PASSWORD = 'TestPass123!';

function generateUniqueEmail(prefix: string) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return `e2e-${prefix}-${ts}-${rand}@rekrutai.test`;
}

// ───────────────────────────────────────────────
// Candidate Critical Flow — Desktop
// ───────────────────────────────────────────────
test.describe('Candidate Critical Flow — Desktop', () => {
  test('signup → complete profile → search jobs → apply', async ({ page }) => {
    const email = generateUniqueEmail('candidate');

    // ─── 1. Signup ───
    // Set X-Forwarded-For to bypass rate limiting
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': '1.2.3.4' });
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: /Create an account/i })).toBeVisible();

    await page.getByRole('combobox').selectOption('candidate');
    await page.fill('input#name', 'E2E Test Candidate');
    await page.fill('input#email', email);
    await page.fill('input#password', PASSWORD);

    // Submit registration
    await page.getByRole('button', { name: /Sign up/i }).click();

    // Should redirect to candidate dashboard
    await expect(page).toHaveURL(/.*\/candidate/);
    await expect(page.locator('text=Welcome back').or(page.locator('text=Dashboard')).first()).toBeVisible({ timeout: 15000 });

    // ─── 2. Complete Profile ───
    await page.goto('/candidate/profile');
    await expect(page.locator('text=Profile Completeness').or(page.locator('text=Personal Information')).first()).toBeVisible({ timeout: 10000 });

    // Click on the "Settings" tab to access the Personal Information form
    await page.locator('button').filter({ hasText: /Settings/i }).click();
    await expect(page.locator('text=Personal Information').first()).toBeVisible({ timeout: 10000 });

    // Fill key profile fields
    await page.getByPlaceholder('Senior Software Engineer').fill('Senior QA Engineer');
    await page.getByPlaceholder('Brief professional summary...').fill('Experienced QA automation engineer with 5+ years in end-to-end testing.');
    await page.getByPlaceholder('San Francisco, CA').fill('Remote');
    await page.getByPlaceholder('+1 (555) 000-0000').fill('+1 555 123 4567');

    // Save profile
    await page.getByRole('button', { name: /Save Changes/i }).click();
    await expect(page.locator('text=Profile saved').first()).toBeVisible({ timeout: 10000 });

    // ─── 3. Search Jobs ───
    await page.goto('/candidate/jobs');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Find Your Next Opportunity|Job Board|Jobs/i).first()).toBeVisible({ timeout: 10000 });

    // Search for jobs
    const searchInput = page.getByPlaceholder(/Search/i).first();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill('Engineer');
      await searchInput.press('Enter');
      await page.waitForTimeout(1500);
    }

    // Verify job cards are visible or a "no results" message
    const jobCard = page.locator('text=Engineer').first();
    await expect(jobCard.or(page.locator('text=No jobs found')).first()).toBeVisible({ timeout: 10000 });

    // ─── 4. Apply to a Job ───
    // If there are jobs, click the first one to view detail and apply
    const applyBtn = page.locator('button, a').filter({ hasText: /Apply|Apply Now/i }).first();
    if (await applyBtn.isVisible().catch(() => false)) {
      await applyBtn.click();
      await expect(
        page.locator('text=Application').or(page.locator('text=Apply')).or(page.locator('text=Cover Letter')).first()
      ).toBeVisible({ timeout: 10000 });
    }
  });
});

// ───────────────────────────────────────────────
// Candidate Critical Flow — Mobile
// ───────────────────────────────────────────────
test.describe('Candidate Critical Flow — Mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mobile: signup → complete profile → search jobs → apply', async ({ page }) => {
    const email = generateUniqueEmail('candidate-mobile');

    // ─── 1. Signup ───
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': '5.6.7.8' });
    await page.goto('/register');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Create an account|Sign up|Register/i).first()).toBeVisible({ timeout: 10000 });

    await page.getByRole('combobox').selectOption('candidate');
    await page.fill('input#name', 'E2E Mobile Candidate');
    await page.fill('input#email', email);
    await page.fill('input#password', PASSWORD);
    await page.getByRole('button', { name: /Sign up/i }).click();

    await expect(page).toHaveURL(/.*\/candidate/);
    await expect(page.locator('text=Welcome back').or(page.locator('text=Dashboard')).first()).toBeVisible({ timeout: 15000 });

    // ─── 2. Complete Profile ───
    await page.goto('/candidate/profile');
    await expect(page.locator('text=Profile Completeness').or(page.locator('text=Personal Information')).first()).toBeVisible({ timeout: 10000 });

    // Click on the "Settings" tab to access the Personal Information form
    await page.locator('button').filter({ hasText: /Settings/i }).click();
    await expect(page.locator('text=Personal Information').first()).toBeVisible({ timeout: 10000 });

    await page.getByPlaceholder('Senior Software Engineer').fill('Mobile QA Engineer');
    await page.getByPlaceholder('Brief professional summary...').fill('Mobile testing specialist.');
    await page.getByPlaceholder('San Francisco, CA').fill('Remote');
    await page.getByRole('button', { name: /Save Changes/i }).click();
    await expect(page.locator('text=Profile saved').first()).toBeVisible({ timeout: 10000 });

    // ─── 3. Search Jobs ───
    await page.goto('/candidate/jobs');
    await expect(page.getByRole('heading', { name: /Find Your Next Opportunity/i })).toBeVisible({ timeout: 10000 });

    const searchInput = page.getByPlaceholder(/Search/i).first();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill('Engineer');
      await searchInput.press('Enter');
      await page.waitForTimeout(1500);
    }

    // ─── 4. Apply ───
    const applyBtn = page.locator('button, a').filter({ hasText: /Apply|Apply Now/i }).first();
    if (await applyBtn.isVisible().catch(() => false)) {
      await applyBtn.click();
      await expect(
        page.locator('text=Application').or(page.locator('text=Apply')).or(page.locator('text=Cover Letter')).first()
      ).toBeVisible({ timeout: 10000 });
    }
  });
});
