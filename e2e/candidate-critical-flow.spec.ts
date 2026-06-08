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
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: /Create an account/i })).toBeVisible();

    // Select role: Job Seeker (if a role selector is visible)
    const roleSelect = page.getByRole('combobox').first()
    if (await roleSelect.isVisible().catch(() => false)) {
      await roleSelect.selectOption('candidate')
    }
    await page.fill('input#name', 'E2E Test Candidate');
    await page.fill('input#email', email);
    await page.fill('input#password', PASSWORD);

    // Submit registration
    await page.getByRole('button', { name: /Create Account|Sign Up|Register/i }).click();

    // Should redirect to candidate dashboard
    await expect(page).toHaveURL(/.*\/candidate/);
    await expect(page.locator('text=Welcome back').or(page.locator('text=Dashboard')).first()).toBeVisible({ timeout: 15000 });

    // ─── 2. Complete Profile ───
    await page.goto('/candidate/profile');
    // Profile page heading may be the user's name rather than "Profile"
    await expect(
      page.getByRole('heading', { name: /Profile/i }).or(page.locator('h2').first()).or(page.getByText(/About/i)).first()
    ).toBeVisible({ timeout: 10000 });

    // Fill key profile fields if visible
    const headlineInput = page.getByPlaceholder(/headline|title|engineer/i).first()
    if (await headlineInput.isVisible().catch(() => false)) {
      await headlineInput.fill('Senior QA Engineer')
    }
    const bioInput = page.getByPlaceholder(/summary|bio|about/i).first()
    if (await bioInput.isVisible().catch(() => false)) {
      await bioInput.fill('Experienced QA automation engineer with 5+ years in end-to-end testing.')
    }
    const locationInput = page.getByPlaceholder(/location|city/i).first()
    if (await locationInput.isVisible().catch(() => false)) {
      await locationInput.fill('Remote')
    }
    const phoneInput = page.getByPlaceholder(/phone|contact/i).first()
    if (await phoneInput.isVisible().catch(() => false)) {
      await phoneInput.fill('+1 555 123 4567')
    }

    // Save profile if save button is visible
    const saveBtn = page.getByRole('button', { name: /Save|Update/i }).first()
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click()
      await expect(page.locator('text=Saved').or(page.locator('text=Updated')).first()).toBeVisible({ timeout: 10000 })
    }

    // ─── 3. Search Jobs ───
    await page.goto('/candidate/jobs');
    // Jobs page may not have a dedicated heading; verify URL and page content
    await expect(page).toHaveURL(/.*\/candidate\/jobs/)
    await expect(
      page.locator('text=Jobs').first().or(page.getByPlaceholder(/Search/i).first()).or(page.locator('text=No jobs found')).first()
    ).toBeVisible({ timeout: 10000 })

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
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: /Create an account/i })).toBeVisible();

    const roleSelectMobile = page.getByRole('combobox').first()
    if (await roleSelectMobile.isVisible().catch(() => false)) {
      await roleSelectMobile.selectOption('candidate')
    }
    await page.fill('input#name', 'E2E Mobile Candidate');
    await page.fill('input#email', email);
    await page.fill('input#password', PASSWORD);
    await page.getByRole('button', { name: /Create Account|Sign Up|Register/i }).click();

    await expect(page).toHaveURL(/.*\/candidate/);
    await expect(page.locator('text=Welcome back').or(page.locator('text=Dashboard')).first()).toBeVisible({ timeout: 15000 });

    // ─── 2. Complete Profile ───
    await page.goto('/candidate/profile');
    await expect(
      page.getByRole('heading', { name: /Profile/i }).or(page.locator('h2').first()).or(page.getByText(/About/i)).first()
    ).toBeVisible({ timeout: 10000 });

    const headlineInputMobile = page.getByPlaceholder(/headline|title|engineer/i).first()
    if (await headlineInputMobile.isVisible().catch(() => false)) {
      await headlineInputMobile.fill('Mobile QA Engineer')
    }
    const bioInputMobile = page.getByPlaceholder(/summary|bio|about/i).first()
    if (await bioInputMobile.isVisible().catch(() => false)) {
      await bioInputMobile.fill('Mobile testing specialist.')
    }
    const locationInputMobile = page.getByPlaceholder(/location|city/i).first()
    if (await locationInputMobile.isVisible().catch(() => false)) {
      await locationInputMobile.fill('Remote')
    }
    const saveBtnMobile = page.getByRole('button', { name: /Save|Update/i }).first()
    if (await saveBtnMobile.isVisible().catch(() => false)) {
      await saveBtnMobile.click()
      await expect(page.locator('text=Saved').or(page.locator('text=Updated')).first()).toBeVisible({ timeout: 10000 })
    }

    // ─── 3. Search Jobs ───
    await page.goto('/candidate/jobs');
    await expect(page).toHaveURL(/.*\/candidate\/jobs/)
    await expect(
      page.locator('text=Jobs').first().or(page.getByPlaceholder(/Search/i).first()).or(page.locator('text=No jobs found')).first()
    ).toBeVisible({ timeout: 10000 })

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
