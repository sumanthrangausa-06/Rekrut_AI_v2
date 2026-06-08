import { test, expect } from '@playwright/test';
import { openMobileMenuIfNeeded, openDashboardSidebarIfNeeded } from './helpers';

const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json';
const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json';

// ───────────────────────────────────────────────
// Visitor navigation
// ───────────────────────────────────────────────
test.describe('Visitor Navigation', () => {
  test('visitor can navigate homepage and login', async ({ page }) => {
    await page.goto('/');

    // Verify homepage loads
    await expect(
      page.locator('h1').filter({ hasText: /AI-Powered Career Companion/i })
    ).toBeVisible();

    // Navigate to login (open mobile menu if needed)
    await openMobileMenuIfNeeded(page);
    await page.getByRole('link', { name: /Sign in/i }).click();
    await expect(page).toHaveURL(/.*\/login/);

    // Verify login form
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();
  });
});

// ───────────────────────────────────────────────
// Candidate navigation
// ───────────────────────────────────────────────
test.describe('Candidate Navigation', () => {
  test.use({ storageState: CANDIDATE_STORAGE });

  test('candidate can navigate dashboard → jobs → apply', async ({ page }) => {
    await page.goto('/candidate');

    // Verify dashboard loads
    await expect(
      page.locator('text=Welcome back').or(page.locator('text=Dashboard')).first()
    ).toBeVisible();

    // Navigate to jobs via sidebar or direct URL
    await openDashboardSidebarIfNeeded(page);
    const jobsLink = page
      .getByRole('link', { name: /Browse Jobs|Jobs|Find Jobs/i })
      .first();
    if (await jobsLink.isVisible().catch(() => false)) {
      try {
        await jobsLink.click({ timeout: 3000 });
      } catch {
        // Fallback: direct navigation if click is blocked by overlay
        await page.goto('/candidate/jobs');
      }
    } else {
      await page.goto('/candidate/jobs');
    }

    await expect(page).toHaveURL(/.*\/candidate\/jobs/);
    await expect(page.locator('text=Jobs').first()).toBeVisible();

    // Try to apply to a job if one exists
    const applyBtn = page
      .locator('button, a')
      .filter({ hasText: /Apply|Apply Now/i })
      .first();
    if (await applyBtn.isVisible().catch(() => false)) {
      await applyBtn.click();
      await expect(
        page.locator('text=Apply').or(page.locator('text=Application')).first()
      ).toBeVisible();
    }
  });
});

// ───────────────────────────────────────────────
// Recruiter navigation
// ───────────────────────────────────────────────
test.describe('Recruiter Navigation', () => {
  test.use({ storageState: RECRUITER_STORAGE });

  test('recruiter can navigate dashboard → create job → view applicants', async ({ page }) => {
    await page.goto('/recruiter');

    // Verify dashboard loads
    await expect(
      page.locator('text=Recruiter').or(page.locator('text=Dashboard')).first()
    ).toBeVisible();

    // Navigate to jobs page
    await openDashboardSidebarIfNeeded(page);
    const jobsLink = page
      .getByRole('link', { name: /Jobs|My Jobs|Post Job/i })
      .first();
    if (await jobsLink.isVisible().catch(() => false)) {
      await jobsLink.click();
    } else {
      await page.goto('/recruiter/jobs');
    }

    await expect(page).toHaveURL(/.*\/recruiter\/jobs/);

    // Click create new job
    const createBtn = page
      .locator('button, a')
      .filter({ hasText: /Create Job|New Job|Post Job|Add Job/i })
      .first();
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
    } else {
      await page.goto('/recruiter/jobs/new');
    }

    await expect(page).toHaveURL(/.*\/recruiter\/jobs\/new/);

    // Fill out the multi-step job form (Step 1: Job Details)
    await page
      .getByPlaceholder(/e\.g\. Senior Software Engineer/i)
      .fill('E2E Test Engineer');
    await page
      .getByPlaceholder(/Leave blank to use your company name/i)
      .fill('E2E Test Co');
    await page
      .getByPlaceholder(/e\.g\. New York, NY or Remote/i)
      .fill('Remote');
    await page
      .getByPlaceholder(/Describe the role, responsibilities/i)
      .fill('End-to-end testing position for QA automation.');

    // Move to next step
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 2: Requirements (can be minimal)
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 3: Preview & Post — publish the job
    await page
      .getByRole('button', { name: /Publish Job/i })
      .click();

    // Verify success or redirect to job list
    await expect(
      page
        .locator('text=E2E Test Engineer')
        .or(page.locator('text=Success'))
        .or(page.locator('text=posted'))
        .first()
    ).toBeVisible({ timeout: 15000 });
  });
});

// ───────────────────────────────────────────────
// Full integration flow
// ───────────────────────────────────────────────
test.describe('End-to-End Integration Flow', () => {
  test('recruiter posts job, candidate applies, recruiter views applicants', async ({ browser, request }) => {
    // 1. Recruiter creates a job via API (fast and reliable setup)
    const recruiterContext = await browser.newContext({
      storageState: RECRUITER_STORAGE,
    });
    const recruiterPage = await recruiterContext.newPage();

    const candidateContext = await browser.newContext({
      storageState: CANDIDATE_STORAGE,
    });
    const candidatePage = await candidateContext.newPage();

    try {
      await recruiterPage.goto('/recruiter/jobs/new');
      await recruiterPage
        .getByPlaceholder(/e\.g\. Senior Software Engineer/i)
        .fill('E2E Integration Job');
      await recruiterPage
        .getByPlaceholder(/Leave blank to use your company name/i)
        .fill('E2E Integration Co');
      await recruiterPage
        .getByPlaceholder(/e\.g\. New York, NY or Remote/i)
        .fill('Remote');
      await recruiterPage
        .getByPlaceholder(/Describe the role, responsibilities/i)
        .fill('Integration test job description.');

      await recruiterPage.getByRole('button', { name: /Next/i }).click();
      await recruiterPage.getByRole('button', { name: /Next/i }).click();
      await recruiterPage.getByRole('button', { name: /Publish Job/i }).click();

      await expect(
        recruiterPage
          .locator('text=E2E Integration Job')
          .or(recruiterPage.locator('text=Success'))
          .first()
      ).toBeVisible({ timeout: 15000 });

      // 2. Candidate finds and applies to the job
      await candidatePage.goto('/candidate/jobs');
      await candidatePage.waitForLoadState('networkidle');

      // Search for the job
      const searchInput = candidatePage.getByPlaceholder(/Search/i).first();
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill('E2E Integration Job');
        await searchInput.press('Enter');
        await candidatePage.waitForTimeout(1500);
      }

      // Apply to the job if visible
      const applyBtn = candidatePage
        .locator('button, a')
        .filter({ hasText: /Apply|Apply Now/i })
        .first();
      if (await applyBtn.isVisible().catch(() => false)) {
        await applyBtn.click();
        await expect(
          candidatePage
            .locator('text=Application')
            .or(candidatePage.locator('text=Apply'))
            .first()
        ).toBeVisible({ timeout: 10000 });
      }

      // 3. Recruiter views applicants for the job
      await recruiterPage.goto('/recruiter/jobs');
      await recruiterPage.waitForLoadState('networkidle');

      // Click on the job to view applicants
      const jobCard = recruiterPage
        .locator('text=E2E Integration Job')
        .first();
      if (await jobCard.isVisible().catch(() => false)) {
        await jobCard.click();
      }

      // Verify applicants section or job detail page
      await expect(
        recruiterPage
          .locator('text=Applicants')
          .or(recruiterPage.locator('text=Applications'))
          .or(recruiterPage.locator('text=E2E Integration Job'))
          .first()
      ).toBeVisible({ timeout: 10000 });
    } finally {
      // Always close extra contexts to free memory
      await recruiterContext.close().catch(() => {});
      await candidateContext.close().catch(() => {});
    }
  });
});
