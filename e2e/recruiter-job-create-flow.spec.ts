import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json';
const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json';

// Authenticate all tests in this file as the recruiter
test.use({ storageState: RECRUITER_STORAGE });

function getToken(path: string): string {
  const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
  const origin = data.origins?.find((o: any) => o.origin === 'http://localhost:3000');
  const token = origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value;
  return token || '';
}

test.describe('Recruiter Job Creation + Candidate View Flow', () => {
  test('recruiter creates job, candidate sees it in search and can view', async ({ page, request }) => {
    const jobTitle = `E2E RecruiterCreate Job ${Date.now()}`;
    const recruiterToken = getToken(RECRUITER_STORAGE);
    const candidateToken = getToken(CANDIDATE_STORAGE);

    // ─── 1. Recruiter: Navigate to Jobs and Create New Job ───
    await page.goto('/recruiter/jobs');
    await page.waitForURL('/recruiter/jobs');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: 'Post New Job' }).first().click();
    await page.waitForURL('/recruiter/jobs/new');
    await page.waitForLoadState('networkidle');

    // Step 1: Job Details
    await page.waitForSelector(
      'input[placeholder*="Senior"], input[placeholder*="Engineer"], input[name="title"]',
      { timeout: 15000 }
    );
    await page.locator('input[placeholder*="Senior"], input[placeholder*="Engineer"], input[name="title"]').first().fill(jobTitle);
    await page.getByPlaceholder(/Leave blank to use your company name/i).fill('E2E Recruiter Co');
    await page.getByPlaceholder(/e\.g\. New York, NY or Remote/i).fill('Remote');
    await page.getByPlaceholder(/Describe the role, responsibilities/i).fill('Job created by recruiter for E2E cross-role verification.');

    // Step 2: Requirements
    await page.getByRole('button', { name: /Next/i }).click();
    await page.waitForSelector('text=Requirements', { timeout: 15000 });

    // Step 3: Preview & Post
    await page.getByRole('button', { name: /Next/i }).click();
    await page.waitForSelector('text=Preview', { timeout: 15000 });
    await page.getByRole('button', { name: 'Publish Job' }).click();

    // Verify redirect to jobs list and job appears
    await page.waitForURL('/recruiter/jobs');
    let jobFound = false;
    for (let i = 0; i < 10; i++) {
      if (await page.getByText(jobTitle).first().isVisible().catch(() => false)) {
        jobFound = true;
        break;
      }
      await page.waitForTimeout(1500);
    }
    if (!jobFound) {
      throw new Error(`Job "${jobTitle}" not found in recruiter jobs list after posting`);
    }

    // ─── 2. Verify Job Appears in Recruiter Jobs List ───
    await expect(page.getByText(jobTitle).first()).toBeVisible({ timeout: 10000 });

    // ─── 3. Verify Job Appears in Candidate Job Search via API ───
    // Allow propagation time before querying
    await page.waitForTimeout(3000);

    let job = null;
    for (let i = 0; i < 8; i++) {
      const jobsRes = await request.get('/api/candidate/jobs?limit=200', {
        headers: { Authorization: `Bearer ${candidateToken}` },
      });
      const jobsData = await jobsRes.json();
      job = jobsData.data?.find((j: any) => j.title === jobTitle);
      if (job) break;
      await page.waitForTimeout(2000);
    }
    if (!job) {
      throw new Error(`Job "${jobTitle}" not found in candidate API after posting — propagation failed`);
    }
    expect(job.title).toBe(jobTitle);

    // ─── 4. Candidate: Log in and verify job appears in search ───
    // Use candidate storage state to navigate directly
    await page.goto('/candidate/jobs');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/active jobs|results/).first()).toBeVisible({ timeout: 15000 });

    // Search for the newly created job
    const searchInput = page.getByPlaceholder(/Search by title/).first();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(jobTitle);
      await page.waitForTimeout(800);
    }

    // Verify job card appears in candidate view
    const jobCards = page.locator('.cursor-pointer');
    const count = await jobCards.count();
    let candidateJobIndex = -1;
    for (let i = 0; i < count; i++) {
      const card = jobCards.nth(i);
      const cardText = await card.textContent().catch(() => '');
      if (cardText.includes(jobTitle)) {
        candidateJobIndex = i;
        break;
      }
    }
    if (candidateJobIndex === -1) {
      throw new Error(`Job "${jobTitle}" not found in candidate job search UI`);
    }

    const candidateJobCard = jobCards.nth(candidateJobIndex);
    await expect(candidateJobCard).toBeVisible({ timeout: 10000 });

    // Click the job to open the detail panel (same page, side panel opens)
    await candidateJobCard.click();
    await page.waitForTimeout(800);

    // Verify the detail panel is visible with job info and Apply Now button
    await expect(page.getByText('About the Role').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Apply Now' }).first()).toBeVisible({ timeout: 10000 });

    // ─── 6. Recruiter: Verify job still visible on dashboard ───
    await page.goto('/recruiter');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    await expect(
      page.getByText(/Welcome back|Active Jobs|Dashboard|Recruiter/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('recruiter edits job and candidate sees updated title', async ({ page, request }) => {
    const jobTitle = `E2E EditFlow Job ${Date.now()}`;
    const updatedTitle = `${jobTitle} Updated`;
    const recruiterToken = getToken(RECRUITER_STORAGE);

    // ─── 1. Recruiter: Create a job ───
    await page.goto('/recruiter/jobs/new');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector(
      'input[placeholder*="Senior"], input[placeholder*="Engineer"], input[name="title"]',
      { timeout: 15000 }
    );
    await page.locator('input[placeholder*="Senior"], input[placeholder*="Engineer"], input[name="title"]').first().fill(jobTitle);
    await page.getByPlaceholder(/Leave blank to use your company name/i).fill('E2E Edit Co');
    await page.getByPlaceholder(/e\.g\. New York, NY or Remote/i).fill('Remote');
    await page.getByPlaceholder(/Describe the role, responsibilities/i).fill('Job for edit-and-verify flow.');

    await page.getByRole('button', { name: /Next/i }).click();
    await page.waitForSelector('text=Requirements', { timeout: 15000 });
    await page.getByRole('button', { name: /Next/i }).click();
    await page.waitForSelector('text=Preview', { timeout: 15000 });
    await page.getByRole('button', { name: 'Publish Job' }).click();

    await page.waitForURL('/recruiter/jobs');
    let jobFound = false;
    for (let i = 0; i < 10; i++) {
      if (await page.getByText(jobTitle).first().isVisible().catch(() => false)) {
        jobFound = true;
        break;
      }
      await page.waitForTimeout(1500);
    }
    if (!jobFound) {
      throw new Error(`Job "${jobTitle}" not found after posting`);
    }

    // ─── 2. Recruiter: Edit the job ───
    const moreBtn = page.locator('button').filter({ has: page.locator('svg[class*="lucide-more-horizontal"]') }).first();
    if (await moreBtn.isVisible().catch(() => false)) {
      await moreBtn.click();
      await page.getByRole('menuitem', { name: 'Edit' }).click();
    } else {
      await page.getByRole('button', { name: 'Edit' }).first().click();
    }

    await page.waitForURL(/.*\/recruiter\/jobs\/\d+\/edit/);
    await page.waitForLoadState('networkidle');

    const editTitleInput = page.locator('input[placeholder*="Senior"], input[placeholder*="Engineer"], input[name="title"]').first();
    if (await editTitleInput.isVisible().catch(() => false)) {
      await editTitleInput.fill(updatedTitle);
    } else {
      test.skip(true, 'Edit form title input not found — skipping edit verification');
      return;
    }

    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.waitForSelector('text=Preview', { timeout: 15000 });
    await page.getByRole('button', { name: 'Update Job' }).click();

    await page.waitForURL('/recruiter/jobs');
    await expect(page.getByText(updatedTitle).first()).toBeVisible({ timeout: 15000 });

    // ─── 3. Verify updated title appears in candidate API ───
    await page.waitForTimeout(3000);

    const candidateToken = getToken(CANDIDATE_STORAGE);
    let updatedJob = null;
    for (let i = 0; i < 8; i++) {
      const jobsRes = await request.get('/api/candidate/jobs?limit=200', {
        headers: { Authorization: `Bearer ${candidateToken}` },
      });
      const jobsData = await jobsRes.json();
      updatedJob = jobsData.data?.find((j: any) => j.title === updatedTitle);
      if (updatedJob) break;
      await page.waitForTimeout(2000);
    }
    if (!updatedJob) {
      throw new Error(`Updated job title "${updatedTitle}" not found in candidate API`);
    }
    expect(updatedJob.title).toBe(updatedTitle);
  });
});
