import { test, expect } from '@playwright/test';
import * as fs from 'fs';

/**
 * Interview Scheduling E2E Test
 *
 * Tests the recruiter interview scheduling flow end-to-end:
 * 1. Navigate to interviews page and verify UI
 * 2. Schedule interview dialog opens and validates
 * 3. Full scheduling flow: create job → candidate applies → shortlist → schedule interview
 * 4. Cancel scheduled interview
 */

test.use({ storageState: 'e2e/.auth/recruiter.json' });

function getToken(path: string): string {
  const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
  const origin = data.origins?.find((o: any) => o.origin === 'http://localhost:3000');
  const token = origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value;
  return token || '';
}

// Track IDs for cleanup across tests
const createdJobs: number[] = [];
const createdApplications: number[] = [];
const createdInterviews: number[] = [];

test.describe('Recruiter Interview Scheduling', () => {
  test.afterEach(async ({ request }) => {
    const token = getToken('e2e/.auth/recruiter.json');

    // Clean up created interviews
    for (const interviewId of createdInterviews) {
      await request.delete(`/api/recruiter/interviews/${interviewId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => { /* ignore */ });
    }
    createdInterviews.length = 0;

    // Clean up created applications
    for (const appId of createdApplications) {
      await request.delete(`/api/recruiter/applications/${appId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => { /* ignore */ });
    }
    createdApplications.length = 0;

    // Clean up created jobs
    for (const jobId of createdJobs) {
      await request.delete(`/api/recruiter/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => { /* ignore */ });
    }
    createdJobs.length = 0;
  });

  test('recruiter navigates to Interviews page and sees tabs + Schedule button', async ({ page }) => {
    await test.step('Navigate to Interviews page', async () => {
      await page.goto('/recruiter/interviews');
      await page.waitForTimeout(1000);
    });

    await test.step('Verify page header and tabs', async () => {
      await expect(page.getByRole('heading', { name: 'Interviews' })).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('tab', { name: /Upcoming/i })).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('tab', { name: /Past/i })).toBeVisible({ timeout: 10000 });
      // Note: The tabs are 'upcoming', 'screening', 'calendar', 'past' — 'All' is not a tab
      await expect(page.getByRole('button', { name: /Schedule Interview/i })).toBeVisible({ timeout: 10000 });
    });
  });

  test('Schedule Interview dialog opens and validates empty form', async ({ page }) => {
    await test.step('Open dialog', async () => {
      await page.goto('/recruiter/interviews');
      await page.waitForTimeout(1000);

      await page.getByRole('button', { name: /Schedule Interview/i }).first().click();
      await page.waitForTimeout(500);
    });

    await test.step('Verify dialog fields exist', async () => {
      await expect(page.getByRole('heading', { name: /Schedule Interview/i })).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('combobox', { name: /Applicant/i })).toBeVisible({ timeout: 10000 });
      await expect(page.getByLabel(/Date/i)).toBeVisible({ timeout: 10000 });
      await expect(page.getByLabel(/Time/i)).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('combobox', { name: /Duration/i })).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('combobox', { name: /Type/i })).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('textbox', { name: /Notes/i })).toBeVisible({ timeout: 10000 });
    });

    await test.step('Submit empty form and verify validation', async () => {
      await page.getByRole('button', { name: /Schedule Interview$/i }).click();
      await page.waitForTimeout(500);

      // The form should still be open because required fields are empty
      await expect(page.getByRole('heading', { name: /Schedule Interview/i })).toBeVisible({ timeout: 10000 });

      // Close dialog
      await page.getByRole('button', { name: /Cancel$/i }).first().click();
      await page.waitForTimeout(500);
    });
  });

  test('full scheduling flow: create job, apply, shortlist, schedule interview', async ({ page, request }) => {
    const jobTitle = `E2E Interview Job ${Date.now()}`;
    const candidateToken = getToken('e2e/.auth/candidate.json');
    const recruiterToken = getToken('e2e/.auth/recruiter.json');
    let jobId: number | null = null;
    let applicationId: number | null = null;

    await test.step('Create job via API', async () => {
      const jobRes = await request.post('/api/recruiter/jobs', {
        headers: { Authorization: `Bearer ${recruiterToken}` },
        data: {
          title: jobTitle,
          description: 'E2E interview scheduling test job',
          requirements: 'Must pass E2E testing',
          location: 'Remote',
          type: 'full_time',
          salary_min: 50000,
          salary_max: 100000,
          remote: true,
        },
      });
      if (!jobRes.ok()) {
        throw new Error(`Failed to create job: ${jobRes.status()} ${await jobRes.text()}`);
      }
      const jobData = await jobRes.json();
      jobId = jobData.job?.id || jobData.id;
      if (!jobId) {
        throw new Error('Job creation did not return an ID');
      }
      createdJobs.push(jobId);
    });

    await test.step('Candidate applies via API', async () => {
      const applyRes = await request.post(`/api/candidate/jobs/${jobId}/apply`, {
        headers: { Authorization: `Bearer ${candidateToken}` },
        data: {
          cover_letter: 'I am excited about this E2E interview scheduling test position.',
          screening_answers: {},
        },
      });
      if (!applyRes.ok()) {
        throw new Error(`Failed to apply: ${applyRes.status()} ${await applyRes.text()}`);
      }
      const applyData = await applyRes.json();
      applicationId = applyData.application?.id;
      if (applicationId) {
        createdApplications.push(applicationId);
      }
    });

    await test.step('Shortlist candidate via API', async () => {
      if (!applicationId) {
        throw new Error('No application ID to shortlist');
      }
      const statusRes = await request.put(`/api/recruiter/applications/${applicationId}`, {
        headers: { Authorization: `Bearer ${recruiterToken}` },
        data: { status: 'interviewed' },
      });
      if (!statusRes.ok()) {
        throw new Error(`Failed to update application status: ${statusRes.status()} ${await statusRes.text()}`);
      }
    });

    await test.step('Navigate to Interviews and open schedule dialog', async () => {
      await page.goto('/recruiter/interviews');
      await page.waitForTimeout(1000);
      await page.waitForTimeout(800);

      await page.getByRole('button', { name: /Schedule Interview/i }).first().click();
      await page.waitForTimeout(600);
    });

    await test.step('Fill in schedule form', async () => {
      // Select applicant from dropdown
      const applicantSelect = page.getByRole('combobox', { name: /Applicant/i });
      await applicantSelect.selectOption({ index: 1 });
      await page.waitForTimeout(300);

      // Date: tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];
      await page.getByLabel(/Date/i).fill(dateStr);

      // Time: 10:00 AM
      await page.getByLabel(/Time/i).fill('10:00');

      // Duration: 60 minutes (default)
      // Type: Video (default)
      // Notes
      await page.getByRole('textbox', { name: /Notes/i }).fill('E2E test interview — video call');
    });

    await test.step('Submit and verify interview appears in Upcoming', async () => {
      await page.getByRole('button', { name: /Schedule Interview$/i }).click();
      await page.waitForTimeout(1500);

      // Dialog should close
      await expect(page.getByRole('heading', { name: /Schedule Interview/i })).not.toBeVisible({ timeout: 10000 });

      // Verify interview appears in Upcoming tab
      await expect(page.getByRole('tab', { name: /Upcoming/i })).toBeVisible();
      await page.getByRole('tab', { name: /Upcoming/i }).click();
      await page.waitForTimeout(800);

      // Look for the scheduled interview
      await expect(page.getByText(/E2E test interview/).first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Video/i).first()).toBeVisible({ timeout: 10000 });
    });

    await test.step('Track created interview for cleanup', async () => {
      // Fetch interviews via API to get the ID
      const intRes = await request.get('/api/recruiter/interviews?upcoming_only=true', {
        headers: { Authorization: `Bearer ${recruiterToken}` },
      });
      const intData = await intRes.json();
      const interview = intData.interviews?.find(
        (i: any) => i.job_title === jobTitle || i.notes?.includes('E2E test interview')
      );
      if (interview?.id) {
        createdInterviews.push(interview.id);
      }
    });
  });

  test('cancel scheduled interview from Upcoming tab', async ({ page, request }) => {
    const jobTitle = `E2E Cancel Job ${Date.now()}`;
    const candidateToken = getToken('e2e/.auth/candidate.json');
    const recruiterToken = getToken('e2e/.auth/recruiter.json');
    let jobId: number | null = null;
    let applicationId: number | null = null;
    let interviewId: number | null = null;

    await test.step('Create job, apply, and shortlist via API', async () => {
      const jobRes = await request.post('/api/recruiter/jobs', {
        headers: { Authorization: `Bearer ${recruiterToken}` },
        data: {
          title: jobTitle,
          description: 'E2E interview cancellation test job',
          requirements: 'Must pass cancellation test',
          location: 'Remote',
          type: 'full_time',
          salary_min: 50000,
          salary_max: 100000,
          remote: true,
        },
      });
      const jobData = await jobRes.json();
      jobId = jobData.job?.id || jobData.id;
      if (!jobId) throw new Error('No job ID');
      createdJobs.push(jobId);

      const applyRes = await request.post(`/api/candidate/jobs/${jobId}/apply`, {
        headers: { Authorization: `Bearer ${candidateToken}` },
        data: {
          cover_letter: 'Applying for cancellation test.',
          screening_answers: {},
        },
      });
      const applyData = await applyRes.json();
      applicationId = applyData.application?.id;
      if (applicationId) createdApplications.push(applicationId);

      if (applicationId) {
        await request.put(`/api/recruiter/applications/${applicationId}`, {
          headers: { Authorization: `Bearer ${recruiterToken}` },
          data: { status: 'interviewed' },
        });
      }
    });

    await test.step('Schedule interview via API', async () => {
      if (!applicationId) throw new Error('No application ID');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const scheduledAt = new Date(tomorrow.toISOString().split('T')[0] + 'T10:00:00');

      const intRes = await request.post('/api/recruiter/interviews', {
        headers: { Authorization: `Bearer ${recruiterToken}` },
        data: {
          application_id: applicationId,
          scheduled_at: scheduledAt.toISOString(),
          duration: 60,
          interview_type: 'video',
          notes: 'E2E cancellation test interview',
        },
      });
      if (!intRes.ok()) {
        throw new Error(`Failed to schedule interview: ${intRes.status()} ${await intRes.text()}`);
      }
      const intData = await intRes.json();
      interviewId = intData.interview?.id;
      if (!interviewId) throw new Error('No interview ID returned');
      createdInterviews.push(interviewId);
    });

    await test.step('Navigate to Upcoming tab and cancel', async () => {
      await page.goto('/recruiter/interviews');
      await page.waitForTimeout(1000);
      await page.waitForTimeout(800);

      // Ensure we're on Upcoming tab
      await page.getByRole('tab', { name: /Upcoming/i }).click();
      await page.waitForTimeout(600);

      // Verify interview is visible
      await expect(page.getByText(/E2E cancellation test interview/).first()).toBeVisible({ timeout: 15000 });

      // Find the Cancel button for this interview
      const cancelButton = page.locator('button:has-text("Cancel")').filter({ hasText: /^Cancel$/ }).first();
      await expect(cancelButton).toBeVisible({ timeout: 10000 });

      // Click Cancel — this triggers a browser confirm() dialog
      await cancelButton.click();

      // Handle browser confirm dialog
      page.on('dialog', async dialog => {
        if (dialog.type() === 'confirm') {
          await dialog.accept();
        } else {
          await dialog.dismiss();
        }
      });
      await page.waitForTimeout(1500);
    });

    await test.step('Verify interview is removed or moved to Past', async () => {
      await page.reload();
      await page.waitForTimeout(1000);
      await page.waitForTimeout(800);

      await page.getByRole('tab', { name: /Upcoming/i }).click();
      await page.waitForTimeout(600);

      // The interview should no longer be in the Upcoming tab
      const interviewText = page.getByText(/E2E cancellation test interview/);
      const count = await interviewText.count();
      expect(count).toBe(0);
    });
  });
});
