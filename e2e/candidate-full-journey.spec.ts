import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const PASSWORD = 'TestPass123!';

function generateUniqueEmail(prefix: string) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return `e2e-${prefix}-${ts}-${rand}@rekrutai.test`;
}

function getRecruiterToken(): string {
  const path = 'e2e/.auth/recruiter.json';
  const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
  const origin = data.origins?.find((o: any) => o.origin === 'http://localhost:3000');
  return origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value || '';
}

function getCandidateToken(): string {
  const path = 'e2e/.auth/candidate.json';
  const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
  const origin = data.origins?.find((o: any) => o.origin === 'http://localhost:3000');
  return origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value || '';
}

// ───────────────────────────────────────────────
// Candidate Full Journey: signup → profile → search → apply → verify
// ───────────────────────────────────────────────
test.describe('Candidate Full Journey', () => {
  test('signup → complete profile → search job → apply → verify in applications', async ({ page, request }) => {
    const email = generateUniqueEmail('candidate');
    const jobTitle = `E2E Full Journey Job ${Date.now()}`;
    const recruiterToken = getRecruiterToken();

    // ─── 0. Seed a job via API as recruiter ───
    const createRes = await request.post('/api/jobs', {
      headers: { Authorization: `Bearer ${recruiterToken}` },
      data: {
        title: jobTitle,
        company: 'E2E Journey Co',
        description: 'End-to-end testing position for full candidate journey verification.',
        requirements: 'Experience with Playwright and E2E testing.',
        location: 'Remote',
        salary_range: '$85,000 - $110,000',
        job_type: 'full-time',
        screening_questions: [],
      },
    });
    if (!createRes.ok()) {
      throw new Error(`Failed to seed job: ${createRes.status()} ${await createRes.text()}`);
    }
    const jobData = await createRes.json();
    const jobId = jobData.job?.id;
    if (!jobId) throw new Error('Job creation did not return an ID');

    // ─── 1. Signup as a new candidate ───
    // Use a random IP to avoid rate-limiting collisions with other tests
    const randomIP = `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': randomIP });
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: /Create an account/i })).toBeVisible({ timeout: 10000 });

    await page.getByRole('combobox').selectOption('candidate');
    await page.fill('input#name', 'E2E Full Journey Candidate');
    await page.fill('input#email', email);
    await page.fill('input#password', PASSWORD);
    await page.getByRole('button', { name: /Sign up/i }).click();

    // Should redirect to candidate dashboard
    await expect(page).toHaveURL(/.*\/candidate/, { timeout: 15000 });
    await expect(page.locator('text=Welcome back').or(page.locator('text=Dashboard')).first()).toBeVisible({ timeout: 15000 });

    // ─── 2. Complete profile ───
    await page.goto('/candidate/profile');
    await page.waitForURL('/candidate/profile');
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Personal Information' })).toBeVisible({ timeout: 10000 });

    await page.locator('input[placeholder="Senior Software Engineer"]').fill('Senior QA Automation Engineer');
    await page.locator('textarea[placeholder="Brief professional summary..."]').fill('Experienced in end-to-end testing, CI/CD, and Playwright automation with 5+ years.');
    await page.locator('input[placeholder="San Francisco, CA"]').fill('Remote');
    await page.locator('input[placeholder="+1 (555) 000-0000"]').fill('+1 (555) 123-4567');

    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText('Profile saved')).toBeVisible({ timeout: 10000 });

    // ─── 3. Search for the seeded job ───
    await page.goto('/candidate/jobs');
    await page.waitForTimeout(1000);
    await expect(page.getByText(/active jobs|results/).first()).toBeVisible({ timeout: 15000 });

    const searchInput = page.getByPlaceholder(/Search by title/).first();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(jobTitle);
      await page.waitForTimeout(800);
    }

    // ─── 4. Navigate directly to the seeded job detail ───
    await page.goto(`/candidate/jobs/${jobId}`);
    await expect(page).toHaveURL(`/candidate/jobs/${jobId}`, { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.waitForTimeout(1000);

    // Wait for the job to load by checking the Apply Now button
    await expect(page.getByRole('button', { name: 'Apply Now' }).first()).toBeVisible({ timeout: 15000 });

    // ─── 5. Apply to the job ───
    // Use a more specific locator scoped to the main job card to avoid similar-jobs buttons
    const applyBtn = page.locator('main, [role="main"], .job-detail').getByRole('button', { name: 'Apply Now' }).first();
    await expect(applyBtn).toBeVisible({ timeout: 10000 });
    await applyBtn.click();
    await page.waitForTimeout(500);

    await expect(page.getByRole('button', { name: 'Submit Application' }).first()).toBeVisible({ timeout: 10000 });

    // Handle cover letter if needed
    const coverLetterTextarea = page.locator('textarea').filter({ hasText: /cover letter|brief/i }).first();
    const hasTextarea = await coverLetterTextarea.isVisible().catch(() => false);
    if (hasTextarea) {
      await coverLetterTextarea.fill('I am excited about this opportunity and believe my skills align well with the role requirements.');
    }

    // Handle any screening questions
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
          await input.fill('Test answer for screening question.');
        } else if (await select.isVisible().catch(() => false)) {
          await select.selectOption({ index: 1 });
        }
      }
    }

    // Submit application
    await page.getByRole('button', { name: 'Submit Application' }).first().click();

    // Verify "Applied" badge appears
    await expect(page.getByText('Applied').first()).toBeVisible({ timeout: 15000 });

    // ─── 6. Verify in My Applications ───
    const jobTitleWords = jobTitle.split(' ').slice(0, 3).join(' ');
    await page.goto('/candidate/applications');
    await page.waitForTimeout(1000);
    await page.waitForTimeout(800);

    await expect(page.getByRole('heading', { name: 'My Applications' }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total Applied').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Active').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(jobTitleWords).first()).toBeVisible({ timeout: 10000 });
  });
});
