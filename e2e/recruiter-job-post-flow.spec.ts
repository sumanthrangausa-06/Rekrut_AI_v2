import { test, expect } from '@playwright/test';
import * as fs from 'fs';

test.use({ storageState: 'e2e/.auth/recruiter.json' });

function getTokenFromStorageState(path: string): string {
  const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
  const origin = data.origins?.find((o: any) => o.origin === 'http://localhost:3000');
  const token = origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value;
  return token || '';
}

test.describe('Recruiter Job Post and Pipeline Flow', () => {
  test('post job, verify listing, apply via api, and move applicant through pipeline', async ({ page, request }) => {
    const jobTitle = `E2E Pipeline Job ${Date.now()}`;

    // ─── 1. Post a New Job ───
    await page.goto('/recruiter/jobs');
    await page.waitForURL('/recruiter/jobs');
    await page.getByRole('button', { name: 'Post New Job' }).click();
    await page.waitForURL('/recruiter/jobs/new');

    // Step 1: Job Details
    await page.getByPlaceholder(/e\.g\. Senior Software Engineer/i).fill(jobTitle);
    await page.getByPlaceholder(/Leave blank to use your company name/i).fill('E2E Test Co');
    await page.getByPlaceholder(/e\.g\. New York, NY or Remote/i).fill('Remote');
    await page.getByPlaceholder(/Describe the role, responsibilities/i).fill('End-to-end testing position for pipeline verification.');

    // Step 2: Requirements
    await page.getByRole('button', { name: /Next/i }).click();
    await page.waitForSelector('text=Requirements');
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 3: Preview & Post
    await page.waitForSelector('text=Preview');
    await page.getByRole('button', { name: 'Publish Job' }).click();

    // Verify redirect to jobs list and job appears
    await page.waitForURL('/recruiter/jobs');
    await expect(page.getByText(jobTitle).first()).toBeVisible({ timeout: 15000 });

    // ─── 2. Apply as Candidate via API ───
    const candidateToken = getTokenFromStorageState('e2e/.auth/candidate.json');

    // Find the job by title via API
    const jobsRes = await request.get('/api/candidate/jobs?limit=200', {
      headers: { 'Authorization': `Bearer ${candidateToken}` },
    });
    const jobsData = await jobsRes.json();
    const job = jobsData.data?.find((j: any) => j.title === jobTitle);

    if (!job) {
      throw new Error(`Job "${jobTitle}" not found after posting`);
    }

    // Apply to the job
    const applyRes = await request.post(`/api/candidate/jobs/${job.id}/apply`, {
      headers: { 'Authorization': `Bearer ${candidateToken}` },
      data: {
        cover_letter: 'I am excited about this opportunity and believe my skills align well.',
        screening_answers: {},
      },
    });

    if (!applyRes.ok()) {
      throw new Error(`Failed to apply as candidate: ${applyRes.status()} ${await applyRes.text()}`);
    }

    // ─── 3. View Applicants ───
    await page.goto(`/recruiter/jobs/${job.id}/applicants`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    await expect(page.getByRole('heading', { name: 'Pipeline' }).first()).toBeVisible({ timeout: 10000 });

    // Verify at least one applicant is shown
    await expect(page.getByText(/1 applicant/).first()).toBeVisible({ timeout: 10000 });

    // ─── 4. Move Applicant Through Pipeline ───
    // Kanban stages: applied → screening → shortlisted → reviewing → interviewed → offered → hired
    // We need to move: applied → screening → shortlisted → reviewing → interviewed → offered

    // Click "Advance" 5 times to move from applied → offered
    const stages = ['applied', 'screening', 'shortlisted', 'reviewing', 'interviewed'];
    for (let i = 0; i < stages.length; i++) {
      const advanceBtn = page.getByRole('button', { name: 'Advance' }).first();
      await expect(advanceBtn).toBeVisible({ timeout: 10000 });
      await advanceBtn.click();
      // Allow React state to update and re-render
      await page.waitForTimeout(1200);
    }

    // Verify applicant is in the Offered column
    await expect(page.getByText('Offered').first()).toBeVisible({ timeout: 10000 });

    // ─── 5. Verify Job Still Listed on Recruiter Dashboard ───
    await page.goto('/recruiter/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    await expect(page.getByText('Active Jobs').first()).toBeVisible({ timeout: 10000 });
  });
});
