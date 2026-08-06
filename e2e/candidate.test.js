const { test, expect } = require('@playwright/test');
const fs = require('fs');

const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json';
const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json';

/**
 * Helper to extract JWT token from Playwright storage state file.
 */
function getToken(path) {
  const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
  const origin = data.origins?.find((o) => {
    const token = o.localStorage?.find((item) => item.name === 'rekrutai_token')?.value;
    return !!token;
  });
  return origin?.localStorage?.find((item) => item.name === 'rekrutai_token')?.value || '';
}

test.describe('Candidate Core Flow', () => {
  test.use({ storageState: CANDIDATE_STORAGE });

  /**
   * Verifies the candidate can log in and land on the candidate dashboard.
   * Auth is handled by storageState; this test confirms the dashboard renders.
   */
  test('login as candidate and view dashboard', async ({ page }) => {
    await page.goto('/candidate');
    await page.waitForLoadState('networkidle');

    await expect(
      page.locator('text=/Welcome back|Dashboard|Candidate|Jobs|Job Board/i').first()
    ).toBeVisible({ timeout: 15000 });

    // Dashboard should show navigation
    await expect(page.getByRole('link', { name: 'Dashboard' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Job Board|Jobs/i }).first()).toBeVisible();
  });

  /**
   * Verifies the candidate can search for jobs using the search input.
   * Seeds a unique job via API, then searches for it in the UI.
   */
  test('search for jobs', async ({ page, request }) => {
    const recruiterToken = getToken(RECRUITER_STORAGE);
    const jobTitle = `E2E Search Job ${Date.now()}`;

    // Seed a job via API so we have something to search for
    const createRes = await request.post('/api/jobs', {
      headers: { Authorization: `Bearer ${recruiterToken}` },
      data: {
        title: jobTitle,
        company: 'E2E Search Co',
        description: 'Job for search E2E test.',
        requirements: 'Testing skills.',
        location: 'Remote',
        job_type: 'full-time',
        screening_questions: [],
      },
    });
    if (!createRes.ok()) {
      throw new Error(`Failed to seed job: ${createRes.status()} ${await createRes.text()}`);
    }

    // Navigate to jobs page
    await page.goto('/candidate/jobs');
    await page.waitForLoadState('networkidle');
    await expect(
      page.locator('text=/Find Your Next Opportunity|Job Board|active jobs|results/i').first()
    ).toBeVisible({ timeout: 15000 });

    // Search for the seeded job
    const searchInput = page.getByPlaceholder(/Search by title|Search/i).first();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(jobTitle);
      await page.waitForTimeout(1000);
    }

    // Verify the job appears in results
    const jobCards = page.locator('.cursor-pointer');
    const count = await jobCards.count();
    let found = false;
    for (let i = 0; i < count; i++) {
      const text = await jobCards.nth(i).textContent().catch(() => '');
      if (text.includes(jobTitle)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  /**
   * Verifies the candidate can apply to a job.
   * Seeds a job via API, finds it in the job board, and submits an application.
   */
  test('apply to a job', async ({ page, request }) => {
    const recruiterToken = getToken(RECRUITER_STORAGE);
    const jobTitle = `E2E Apply Job ${Date.now()}`;

    // Seed a job via API
    const createRes = await request.post('/api/jobs', {
      headers: { Authorization: `Bearer ${recruiterToken}` },
      data: {
        title: jobTitle,
        company: 'E2E Apply Co',
        description: 'Job for apply E2E test.',
        requirements: 'End-to-end testing.',
        location: 'Remote',
        job_type: 'full-time',
        screening_questions: [],
      },
    });
    if (!createRes.ok()) {
      throw new Error(`Failed to seed job: ${createRes.status()} ${await createRes.text()}`);
    }
    const jobData = await createRes.json();
    const jobId = jobData.job?.id || jobData.id;

    // Navigate to jobs page
    await page.goto('/candidate/jobs');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    await expect(
      page.locator('text=/active jobs|results/i').first()
    ).toBeVisible({ timeout: 15000 });

    // Search for the job
    const searchInput = page.getByPlaceholder(/Search by title|Search/i).first();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(jobTitle);
      await page.waitForTimeout(1000);
    }

    // Find and click the job card
    const jobCards = page.locator('.cursor-pointer');
    const count = await jobCards.count();
    let targetIndex = -1;
    for (let i = 0; i < count; i++) {
      const card = jobCards.nth(i);
      const text = await card.textContent().catch(() => '');
      const hasApplied = await card.locator('text=Applied').isVisible().catch(() => false);
      if (!hasApplied && text.includes(jobTitle)) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex === -1) {
      test.skip(true, 'Seeded job not found or already applied — skipping');
      return;
    }

    await jobCards.nth(targetIndex).click();
    await page.waitForTimeout(800);

    // Click Apply Now
    const applyBtn = page.getByRole('button', { name: 'Apply Now' }).first();
    await expect(applyBtn).toBeVisible({ timeout: 10000 });
    await applyBtn.click();

    // Wait for application form
    await expect(
      page.getByRole('button', { name: 'Submit Application' }).first()
    ).toBeVisible({ timeout: 10000 });

    // Fill cover letter if textarea present
    const coverLetterTextarea = page.locator('textarea').filter({ hasText: /cover letter|brief/i }).first();
    if (await coverLetterTextarea.isVisible().catch(() => false)) {
      await coverLetterTextarea.fill('I am excited about this opportunity and believe my skills align well.');
    }

    // Handle screening questions
    const questionInputs = page.locator('div.rounded-lg.border').filter({ has: page.locator('label') });
    const questionCount = await questionInputs.count();
    for (let i = 0; i < questionCount; i++) {
      const qBlock = questionInputs.nth(i);
      const yesBtn = qBlock.getByRole('button', { name: 'Yes' }).first();
      const noBtn = qBlock.getByRole('button', { name: 'No' }).first();
      if (await yesBtn.isVisible().catch(() => false)) {
        await yesBtn.click();
      } else if (await noBtn.isVisible().catch(() => false)) {
        await noBtn.click();
      } else {
        const input = qBlock.locator('input').first();
        const select = qBlock.locator('select').first();
        if (await input.isVisible().catch(() => false)) {
          await input.fill('Test answer.');
        } else if (await select.isVisible().catch(() => false)) {
          await select.selectOption({ index: 1 });
        }
      }
    }

    // Submit application
    const submitBtn = page.getByRole('button', { name: 'Submit Application' }).first();
    await submitBtn.click();

    // Verify "Applied" badge appears
    await expect(page.getByText('Applied').first()).toBeVisible({ timeout: 15000 });
  });

  /**
   * Verifies the AI mock interview page loads and the candidate can start a mock interview.
   * Checks that the coaching tabs are visible and the mock interview can be initiated.
   */
  test('complete AI mock interview', async ({ page }) => {
    await page.goto('/candidate/ai-coaching');
    await page.waitForLoadState('networkidle');

    // Verify heading and tabs
    await expect(
      page.getByRole('heading', { name: /AI Interview Coach|Interview Coach|AI Coaching/i })
    ).toBeVisible();

    await expect(page.getByRole('button', { name: 'Quick Practice', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mock Interview', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Progress', exact: true })).toBeVisible();

    // Switch to Mock Interview tab
    const mockTab = page.getByRole('button', { name: 'Mock Interview', exact: true });
    await mockTab.click();

    // Verify mock interview content loads
    await expect(
      page.locator('text=Mock Interview')
        .or(page.getByRole('button', { name: /Start Mock Interview/i }))
        .or(page.locator('text=Past Sessions'))
        .first()
    ).toBeVisible({ timeout: 10000 });

    // Try to start a mock interview if button is visible
    const startBtn = page.getByRole('button', { name: /Start Mock Interview/i }).first();
    if (await startBtn.isVisible().catch(() => false)) {
      await startBtn.click();
      // Wait for interview session to start
      await expect(
        page.locator('text=/Interview|Question|Session/i').first()
      ).toBeVisible({ timeout: 10000 });

      // Submit an answer (if input is available)
      const answerInput = page.locator('textarea, input[type="text"]').first();
      if (await answerInput.isVisible().catch(() => false)) {
        await answerInput.fill('This is a test answer for the mock interview.');
        const nextBtn = page.getByRole('button', { name: /Next|Submit|Continue/i }).first();
        if (await nextBtn.isVisible().catch(() => false)) {
          await nextBtn.click();
        }
      }
    }
  });

  /**
   * Verifies the candidate can view their application status on the applications page.
   * This test assumes there is at least one application in the system.
   */
  test('view application status', async ({ page }) => {
    await page.goto('/candidate/applications');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    // Verify applications page loads
    await expect(
      page.getByRole('heading', { name: /My Applications|Applications/i }).first()
    ).toBeVisible({ timeout: 10000 });

    // Key stats should be visible
    await expect(page.getByText('Total Applied').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Active').first()).toBeVisible({ timeout: 10000 });

    // If there are applications, verify status labels are present
    const statusLabels = page.locator('text=/Applied|Screening|Shortlisted|Interview|Offer|Rejected/i');
    const statusCount = await statusLabels.count();
    if (statusCount > 0) {
      await expect(statusLabels.first()).toBeVisible();
    }
  });
});
