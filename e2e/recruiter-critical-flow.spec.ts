import { test, expect } from '@playwright/test';
import * as fs from 'fs';

test.use({ storageState: 'e2e/.auth/recruiter.json' });

function getToken(path: string): string {
  const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
  const origin = data.origins?.find((o: any) => {
    const token = o.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value;
    return !!token;
  });
  return origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value || '';
}

// ───────────────────────────────────────────────
// Recruiter Critical Flow: login → post job → view candidates → shortlist → analytics
// ───────────────────────────────────────────────
test.describe('Recruiter Critical Flow', () => {
  test('login → post job → view candidates → shortlist candidate → view analytics dashboard', async ({ page, request }) => {
    const jobTitle = `E2E Critical Flow Job ${Date.now()}`;
    const candidateToken = getToken('e2e/.auth/candidate.json');

    // ─── 1. Login (handled by storageState) — verify recruiter dashboard ───
    await page.goto('/recruiter');
    await page.waitForTimeout(1000);
    await expect(page.getByText(/Welcome back|Active Jobs|Dashboard|Recruiter/i).first()).toBeVisible({ timeout: 15000 });

    // ─── 2. Post a Job ───
    await page.goto('/recruiter/jobs');
    await page.waitForURL('/recruiter/jobs');
    await page.waitForTimeout(1000);
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: 'Post New Job' }).first().click();
    await page.waitForURL('/recruiter/jobs/new');
    await page.waitForTimeout(1000);

    // Step 1: Job Details
    await page.waitForSelector(
      'input[placeholder*="Senior"], input[placeholder*="Engineer"], input[name="title"]',
      { timeout: 15000 }
    );
    await page.locator('input[placeholder*="Senior"], input[placeholder*="Engineer"], input[name="title"]').first().fill(jobTitle);
    await page.getByPlaceholder(/Leave blank to use your company name/i).fill('E2E Critical Co');
    await page.getByPlaceholder(/e\.g\. New York, NY or Remote/i).fill('Remote');
    await page.getByPlaceholder(/Describe the role, responsibilities/i).fill('Critical path E2E verification job.');

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
    await expect(page.getByText(jobTitle).first()).toBeVisible({ timeout: 10000 });

    // ─── 3. Find job ID via API and apply as candidate ───
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
      throw new Error(`Job "${jobTitle}" not found in candidate API after posting`);
    }

    const applyRes = await request.post(`/api/candidate/jobs/${job.id}/apply`, {
      headers: { Authorization: `Bearer ${candidateToken}` },
      data: {
        cover_letter: 'I am excited about this opportunity and believe my skills align well.',
        screening_answers: {},
      },
    });
    if (!applyRes.ok()) {
      throw new Error(`Failed to apply as candidate: ${applyRes.status()} ${await applyRes.text()}`);
    }

    // ─── 4. View Candidates / Applicants ───
    await page.goto(`/recruiter/jobs/${job.id}/applicants`);
    await page.waitForTimeout(1000);
    await page.waitForTimeout(800);

    await expect(page.getByRole('heading', { name: 'Pipeline' }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/1 applicant/).first()).toBeVisible({ timeout: 10000 });

    // ─── 5. Shortlist Candidate ───
    // Advance from applied → screening → shortlisted (2 clicks)
    for (let i = 0; i < 2; i++) {
      const advanceBtn = page.getByRole('button', { name: 'Advance' }).first();
      await expect(advanceBtn).toBeVisible({ timeout: 10000 });
      await advanceBtn.click();
      await page.waitForTimeout(1200);
    }

    await expect(page.getByText('Shortlisted').first()).toBeVisible({ timeout: 10000 });

    // ─── 6. View Analytics Dashboard ───
    await page.goto('/recruiter/analytics');
    await page.waitForTimeout(1000);

    await expect(page.getByRole('heading', { name: /Hiring Analytics/i })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Job Views').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Applications').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Conversion Rate').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Avg Days to Hire').first()).toBeVisible({ timeout: 10000 });
  });
});
