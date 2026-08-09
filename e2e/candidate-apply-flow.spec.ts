import { test, expect } from '@playwright/test';
import * as fs from 'fs';

test.use({ storageState: 'e2e/.auth/candidate.json' });

function getToken(path: string): string {
  const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
  const origin = data.origins?.find((o: any) => o.origin === 'http://localhost:3000');
  const token = origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value;
  return token || '';
}

test.describe('Candidate Apply Flow', () => {
  test('browse jobs, apply with one-click, and verify on dashboard and applications', async ({ page, request }) => {
    const recruiterToken = getToken('e2e/.auth/recruiter.json');
    const jobTitle = `E2E Apply Flow Job ${Date.now()}`;

    // ─── 0. Create a job via API as recruiter (so candidate has something to apply to) ───
    const createRes = await request.post('/api/jobs', {
      headers: { 'Authorization': `Bearer ${recruiterToken}` },
      data: {
        title: jobTitle,
        company: 'E2E Test Co',
        description: 'End-to-end testing position for candidate apply flow verification.',
        requirements: 'Experience with Playwright and E2E testing.',
        location: 'Remote',
        salary_range: '$80,000 - $100,000',
        job_type: 'full-time',
        screening_questions: [],
      },
    });

    if (!createRes.ok()) {
      throw new Error(`Failed to create job: ${createRes.status()} ${await createRes.text()}`);
    }
    const jobData = await createRes.json();
    const jobId = jobData.job?.id;
    if (!jobId) {
      throw new Error('Job creation did not return an ID');
    }

    // ─── 1. Browse Jobs ───
    await page.goto('/candidate/jobs');
    await page.waitForTimeout(1000);

    await expect(page.getByText(/active jobs|results/).first()).toBeVisible({ timeout: 15000 });

    // Find the newly created job (it should not have "Applied" badge yet)
    const jobCards = page.locator('.cursor-pointer');
    const count = await jobCards.count();
    let targetJobIndex = -1;
    for (let i = 0; i < count; i++) {
      const card = jobCards.nth(i);
      const hasApplied = await card.locator('text=Applied').isVisible().catch(() => false);
      const cardText = await card.textContent().catch(() => '');
      if (!hasApplied && cardText.includes(jobTitle)) {
        targetJobIndex = i;
        break;
      }
    }

    if (targetJobIndex === -1) {
      throw new Error('Created job not found in jobs list — candidate test cannot proceed');
    }

    const targetJob = jobCards.nth(targetJobIndex);

    // ─── 2. View Job Detail ───
    await targetJob.click();
    await page.waitForTimeout(800);

    // Job cards now open a slide-out drawer — click "View Full Page" to navigate
    const viewFullPageBtn = page.getByRole('button', { name: /View full page/i }).first();
    const hasViewFullPage = await viewFullPageBtn.isVisible().catch(() => false);

    if (hasViewFullPage) {
      await viewFullPageBtn.click();
      await page.waitForTimeout(500);
    }

    // Verify we're on the job detail page
    await expect(page).toHaveURL(/.*\/candidate\/jobs\/\d+/, { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.waitForTimeout(800);

    // Click Apply Now on the job detail page to open the form
    await page.getByRole('button', { name: 'Apply Now' }).first().click();

    // Wait for the apply form to appear
    await expect(page.getByRole('button', { name: 'Submit Application' }).first()).toBeVisible({ timeout: 10000 });

    // Check if One-Click Apply is available (profile completeness >= 80%)
    const oneClickBtn = page.getByRole('button', { name: /One-Click Apply/ }).first();
    const hasOneClick = await oneClickBtn.isVisible().catch(() => false);

    if (hasOneClick) {
      await oneClickBtn.click();

      // Wait for the AI generation to complete
      await expect(page.getByText(/AI is generating|One-Click Apply/).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('button', { name: /Submit with AI-Tailored Documents/ }).first()).toBeVisible({ timeout: 20000 });

      // Submit the AI-tailored application
      await page.getByRole('button', { name: /Submit with AI-Tailored Documents/ }).first().click();
    } else {
      // Regular apply: just submit the application
      await page.getByRole('button', { name: 'Submit Application' }).first().click();
    }

    // Verify "Applied" badge appears on the job detail page
    await expect(page.getByText('Applied').first()).toBeVisible({ timeout: 15000 });

    // ─── 4. Verify on Dashboard ───
    await page.goto('/candidate');
    await page.waitForTimeout(1000);
    await page.waitForTimeout(800);

    await expect(page.getByText('Welcome back').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Applications').first()).toBeVisible({ timeout: 10000 });

    // ─── 5. Verify on My Applications ───
    await page.goto('/candidate/applications');
    await page.waitForTimeout(1000);
    await page.waitForTimeout(800);

    await expect(page.getByRole('heading', { name: 'My Applications' }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total Applied').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Active').first()).toBeVisible({ timeout: 10000 });

    // Verify the job title appears in the applications list (use first 3 words for resilience)
    const jobTitleWords = jobTitle.split(' ').slice(0, 3).join(' ');
    await expect(page.getByText(jobTitleWords).first()).toBeVisible({ timeout: 10000 });
  });
});