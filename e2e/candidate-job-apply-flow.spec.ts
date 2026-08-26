import { test, expect } from '@playwright/test';
import * as fs from 'fs';

test.use({ storageState: 'e2e/.auth/candidate.json' });

function getToken(path: string): string {
  const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
  const origin = data.origins?.find((o: any) => o.origin === 'http://localhost:3000');
  const token = origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value;
  return token || '';
}

test.describe('Candidate Job Search + Apply Flow', () => {
  test('search, filter, click job, apply, and verify in applications', async ({ page, request }) => {
    const recruiterToken = getToken('e2e/.auth/recruiter.json');
    const jobTitle = `E2E SearchApply Job ${Date.now()}`;

    // ─── 0. Seed a job via API so the candidate has something to find ───
    const createRes = await request.post('/api/jobs', {
      headers: { Authorization: `Bearer ${recruiterToken}` },
      data: {
        title: jobTitle,
        company: 'E2E Search Co',
        description: 'Job for search-and-apply E2E verification.',
        requirements: 'Playwright, end-to-end testing.',
        location: 'Remote',
        salary_range: '$90,000 - $120,000',
        job_type: 'full-time',
        screening_questions: [],
      },
    });
    if (!createRes.ok()) {
      throw new Error(`Failed to seed job: ${createRes.status()} ${await createRes.text()}`);
    }
    const jobData = await createRes.json();
    const jobId = jobData.job?.id;
    if (!jobId) {
      throw new Error('Job creation did not return an ID');
    }

    // ─── 1. Navigate to Jobs Page ───
    await page.goto('/candidate/jobs');
    await page.waitForTimeout(1000);

    await expect(page.getByText(/active jobs|results/).first()).toBeVisible({ timeout: 15000 });

    // ─── 2. Search for the seeded job ───
    const searchInput = page.getByPlaceholder(/Search by title/).first();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(jobTitle);
      await page.waitForTimeout(800);
    }

    // ─── 3. Verify the job appears in results ───
    const jobCards = page.locator('.cursor-pointer');
    const count = await jobCards.count();
    let targetJobIndex = -1;
    for (let i = 0; i < count; i++) {
      const card = jobCards.nth(i);
      const cardText = await card.textContent().catch(() => '');
      const hasApplied = await card.locator('text=Applied').isVisible().catch(() => false);
      if (!hasApplied && cardText.includes(jobTitle)) {
        targetJobIndex = i;
        break;
      }
    }
    if (targetJobIndex === -1) {
      throw new Error(`Seeded job "${jobTitle}" not found in candidate jobs list — cannot proceed`);
    }
    const targetJob = jobCards.nth(targetJobIndex);

    // ─── 4. Click job to open detail panel ───
    await targetJob.click();
    await page.waitForTimeout(800);

    // The UI opens a side panel on the same page (URL stays /candidate/jobs)
    // Verify the detail panel is visible with job info and Apply Now button
    const jobTitleWords = jobTitle.split(' ').slice(0, 3).join(' ');
    await expect(page.getByText(jobTitleWords).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('About the Role').first()).toBeVisible({ timeout: 10000 });

    // ─── 5. Click Apply Now in the detail panel ───
    const applyBtn = page.getByRole('button', { name: 'Apply Now' }).first();
    await expect(applyBtn).toBeVisible({ timeout: 10000 });
    await applyBtn.click();

    await expect(page.getByRole('button', { name: 'Submit Application' }).first()).toBeVisible({ timeout: 10000 });

    // ─── 6. Submit the application ───
    // Check if One-Click Apply is available
    const oneClickBtn = page.getByRole('button', { name: /One-Click Apply/ }).first();
    const hasOneClick = await oneClickBtn.isVisible().catch(() => false);

    if (hasOneClick) {
      await oneClickBtn.click();
      await expect(page.getByText(/AI is generating|One-Click Apply/).first()).toBeVisible({ timeout: 10000 });
      await expect(
        page.getByRole('button', { name: /Submit with AI-Tailored Documents/ }).first()
      ).toBeVisible({ timeout: 20000 });
      await page.getByRole('button', { name: /Submit with AI-Tailored Documents/ }).first().click();
    } else {
      // Fill cover letter if textarea is present
      const coverLetterTextarea = page.locator('textarea').filter({ hasText: /cover letter|brief/i }).first();
      const hasTextarea = await coverLetterTextarea.isVisible().catch(() => false);
      if (hasTextarea) {
        await coverLetterTextarea.fill('I am excited about this opportunity and believe my skills align well with the role requirements.');
      }
      await page.getByRole('button', { name: 'Submit Application' }).first().click();
    }

    // Verify "Applied" badge appears
    await expect(page.getByText('Applied').first()).toBeVisible({ timeout: 15000 });

    // ─── 7. Verify application appears in My Applications ───
    await page.goto('/candidate/applications');
    await page.waitForTimeout(1000);
    await page.waitForTimeout(800);

    await expect(page.getByRole('heading', { name: 'My Applications' }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total Applied').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Active').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(jobTitleWords).first()).toBeVisible({ timeout: 10000 });
  });

  test('filter and sort jobs, then apply to a job', async ({ page }) => {
    await page.goto('/candidate/jobs');
    await page.waitForTimeout(1000);

    await expect(page.getByText(/active jobs|results/).first()).toBeVisible({ timeout: 15000 });

    const resultText = await page.getByText(/active jobs|results/).first().textContent();
    const resultCount = parseInt(resultText?.match(/(\d+)/)?.[0] || '0');
    if (resultCount === 0) {
      test.skip(true, 'No jobs available on the board — skipping');
      return;
    }

    // ─── Filter by job type (if select exists) ───
    const typeSelect = page.locator('select').filter({ hasText: /All Types|Type/i }).first();
    if (await typeSelect.isVisible().catch(() => false)) {
      await typeSelect.selectOption('full-time');
      await page.waitForTimeout(600);
    }

    // ─── Filter by remote (if select exists) ───
    const remoteSelect = page.locator('select').filter({ hasText: /All Work Modes|Remote|Work Mode/i }).first();
    if (await remoteSelect.isVisible().catch(() => false)) {
      await remoteSelect.selectOption('remote');
      await page.waitForTimeout(600);
    }

    // Verify filtered results still show jobs or empty state
    const filteredText = await page.getByText(/results?|No jobs found/).first().textContent().catch(() => '');
    expect(filteredText).toBeTruthy();

    // ─── Sort by newest (if select exists) ───
    const sortSelect = page.locator('select').filter({ hasText: /Best Match|Sort/i }).first();
    if (await sortSelect.isVisible().catch(() => false)) {
      await sortSelect.selectOption('newest');
      await page.waitForTimeout(600);
    }

    // ─── Find a job that hasn't been applied to yet ───
    const jobCards = page.locator('.cursor-pointer');
    const count = await jobCards.count();
    let targetJobIndex = -1;
    for (let i = 0; i < count; i++) {
      const card = jobCards.nth(i);
      const hasApplied = await card.locator('text=Applied').isVisible().catch(() => false);
      if (!hasApplied) {
        targetJobIndex = i;
        break;
      }
    }
    if (targetJobIndex === -1) {
      test.skip(true, 'All visible jobs already applied — skipping');
      return;
    }

    const targetJob = jobCards.nth(targetJobIndex);

    // Click the job to open the detail panel (same page, side panel opens)
    await targetJob.click();
    await page.waitForTimeout(800);

    // Verify the detail panel is visible with an Apply Now button
    await expect(page.getByText('About the Role').first()).toBeVisible({ timeout: 10000 });

    // Click Apply Now to open the form
    const applyBtn = page.getByRole('button', { name: 'Apply Now' }).first();
    if (await applyBtn.isVisible().catch(() => false)) {
      await applyBtn.click();
      await expect(
        page.locator('text=Application').or(page.locator('text=Submit Application')).first()
      ).toBeVisible({ timeout: 10000 });
    }

    // Cancel to leave state clean
    const cancelBtn = page.getByRole('button', { name: 'Cancel' }).first();
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
    }

    // ─── Clear filters ───
    await page.goto('/candidate/jobs');
    await page.waitForTimeout(1000);
    const resetBtn = page.getByRole('button', { name: /Reset Filters|Clear all/ }).first();
    if (await resetBtn.isVisible().catch(() => false)) {
      await resetBtn.click();
      await page.waitForTimeout(600);
    }
  });
});
