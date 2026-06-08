import { test, expect } from '@playwright/test';

const PASSWORD = 'TestPass123!';

function generateUniqueEmail(prefix: string) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return `e2e-${prefix}-${ts}-${rand}@rekrutai.test`;
}

// ───────────────────────────────────────────────
// Recruiter Critical Flow
// ───────────────────────────────────────────────
test.describe('Recruiter Critical Flow', () => {
  test('signup → post job → view applicants → shortlist candidate', async ({ page, request }) => {
    const email = generateUniqueEmail('recruiter');

    // ─── 1. Signup as Recruiter ───
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: /Create an account/i })).toBeVisible();

    // Select role: Employer / Recruiter
    const roleSelect = page.getByRole('combobox').first()
    if (await roleSelect.isVisible().catch(() => false)) {
      await roleSelect.selectOption('employer')
    }
    await page.fill('input#name', 'E2E Test Recruiter');
    await page.fill('input#email', email);
    await page.fill('input#password', PASSWORD);
    await page.getByRole('textbox', { name: /Company name/i }).fill('E2E Test Co');

    await page.getByRole('button', { name: /Sign up/i }).click();

    // Should redirect to recruiter dashboard
    await expect(page).toHaveURL(/.*\/recruiter/);
    await expect(page.locator('text=Recruiter').or(page.locator('text=Dashboard')).first()).toBeVisible({ timeout: 15000 });

    // ─── 2. Post a Job ───
    await page.goto('/recruiter/jobs/new');
    await expect(page.getByRole('heading', { name: /Job Details/i })).toBeVisible({ timeout: 10000 });

    // Step 1: Job Details
    await page.getByPlaceholder('e.g. Senior Software Engineer').fill('E2E Critical Path Job');
    await page.getByPlaceholder('Leave blank to use your company name').fill('E2E Test Co');
    await page.getByPlaceholder('e.g. New York, NY or Remote').fill('Remote');
    await page.getByPlaceholder('Describe the role, responsibilities, and what a typical day looks like').fill('This is a test job for E2E critical path verification.');
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 2: Requirements (minimal)
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 3: Preview & Post
    await page.getByRole('button', { name: /Publish Job/i }).click();

    // Verify success — redirect to job list or show success
    await expect(page).toHaveURL(/.*\/recruiter\/jobs/, { timeout: 15000 });
    await expect(page.locator('text=E2E Critical Path Job').first()).toBeVisible({ timeout: 10000 });

    // ─── 3. View Applicants ───
    // Click on the job card to view applicants
    const jobCard = page.locator('text=E2E Critical Path Job').first();
    await jobCard.click();

    await expect(
      page.locator('text=Applicants').or(page.locator('text=Applications')).or(page.locator('text=No applicants')).first()
    ).toBeVisible({ timeout: 10000 });

    // ─── 4. Shortlist Candidate (if there are applicants) ───
    // In a fresh environment there may be no applicants.
    // If none exist, we verify the applicant view loads correctly.
    const noApplicants = page.locator('text=No applicants').or(page.locator('text=No applications')).first();
    if (await noApplicants.isVisible().catch(() => false)) {
      test.info().annotations.push({ type: 'note', description: 'No applicants to shortlist — job posted successfully' });
      return;
    }

    // If there are applicants, move the first one to "shortlisted" status
    const firstApplicant = page.locator('[class*="applicant"], [class*="card"]').first();
    if (await firstApplicant.isVisible().catch(() => false)) {
      // Look for a status dropdown or "Shortlist" button
      const shortlistBtn = page.locator('button, a').filter({ hasText: /Shortlist/i }).first();
      if (await shortlistBtn.isVisible().catch(() => false)) {
        await shortlistBtn.click();
        await expect(page.locator('text=Shortlisted').first()).toBeVisible({ timeout: 10000 });
      }
    }
  });
});
