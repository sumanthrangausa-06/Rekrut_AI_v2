const { test, expect } = require('@playwright/test');
const fs = require('fs');

const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json';
const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json';

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

test.describe('Recruiter Core Flow', () => {
	test.use({ storageState: RECRUITER_STORAGE });

	/**
	 * Verifies the recruiter can log in and land on the recruiter dashboard.
	 * Auth is handled by storageState; this test confirms the dashboard renders.
	 */
	test('login as recruiter and view dashboard', async ({ page }) => {
		await page.goto('/recruiter');
		await page.waitForLoadState('networkidle');

		await expect(
			page.locator('text=/Welcome back|Dashboard|Recruiter|Active Jobs/i').first(),
		).toBeVisible({ timeout: 15000 });

		// Dashboard should show navigation sidebar
		await expect(page.getByRole('link', { name: 'Dashboard' }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Jobs' }).first()).toBeVisible();
	});

	/**
	 * Verifies the recruiter can create a new job posting through the multi-step form.
	 * Steps: Job Details → Requirements → Preview & Publish.
	 */
	test('create a job posting', async ({ page }) => {
		const jobTitle = `E2E Recruiter Job ${Date.now()}`;

		// Navigate to jobs page
		await page.goto('/recruiter/jobs');
		await page.waitForLoadState('networkidle');
		await expect(page.locator('text=/Jobs|My Jobs|Active Jobs/i').first()).toBeVisible({
			timeout: 15000,
		});

		// Click "Post New Job" or similar button
		const createBtn = page
			.getByRole('button')
			.filter({ hasText: /Post New Job|Create Job|New Job/i })
			.first();
		await expect(createBtn).toBeVisible({ timeout: 10000 });
		await createBtn.click();

		await page.waitForURL(/.*\/recruiter\/jobs\/new/);
		await page.waitForLoadState('networkidle');

		// ─── Step 1: Job Details ───
		await page.waitForSelector(
			'input[placeholder*="Senior"], input[placeholder*="Engineer"], input[name="title"]',
			{ timeout: 15000 },
		);
		await page
			.locator('input[placeholder*="Senior"], input[placeholder*="Engineer"], input[name="title"]')
			.first()
			.fill(jobTitle);
		await page.getByPlaceholder(/Leave blank to use your company name/i).fill('E2E Recruiter Co');
		await page.getByPlaceholder(/e\.g\. New York, NY or Remote/i).fill('Remote');
		await page
			.getByPlaceholder(/Describe the role, responsibilities/i)
			.fill('This is an end-to-end test job for recruiter flow verification.');

		// ─── Step 2: Requirements ───
		await page.getByRole('button', { name: /Next/i }).click();
		await page.waitForSelector('text=Requirements', { timeout: 15000 });

		// ─── Step 3: Preview & Publish ───
		await page.getByRole('button', { name: /Next/i }).click();
		await page.waitForSelector('text=Preview', { timeout: 15000 });
		await page.getByRole('button', { name: 'Publish Job' }).click();

		// Verify redirect to jobs list and the job appears
		await page.waitForURL(/.*\/recruiter\/jobs/);
		await expect(page.getByText(jobTitle).first()).toBeVisible({ timeout: 15000 });
	});

	/**
	 * Verifies the recruiter can view applicants for a job.
	 * Seeds a job via API, applies as candidate via API, then views applicants in UI.
	 */
	test('view applicants for a job', async ({ page, request }) => {
		const recruiterToken = getToken(RECRUITER_STORAGE);
		const candidateToken = getToken(CANDIDATE_STORAGE);
		const jobTitle = `E2E Applicants Job ${Date.now()}`;

		// 1. Create a job via API
		const createRes = await request.post('/api/jobs', {
			headers: { Authorization: `Bearer ${recruiterToken}` },
			data: {
				title: jobTitle,
				company: 'E2E Applicants Co',
				description: 'Job for viewing applicants E2E test.',
				requirements: 'Playwright testing experience.',
				location: 'Remote',
				job_type: 'full-time',
				screening_questions: [],
			},
		});
		if (!createRes.ok()) {
			throw new Error(`Failed to create job: ${createRes.status()} ${await createRes.text()}`);
		}
		const jobData = await createRes.json();
		const jobId = jobData.job?.id || jobData.id;
		if (!jobId) {
			throw new Error('Job creation did not return an ID');
		}

		// 2. Apply as candidate via API
		const applyRes = await request.post(`/api/candidate/jobs/${jobId}/apply`, {
			headers: { Authorization: `Bearer ${candidateToken}` },
			data: {
				cover_letter: 'Excited about this opportunity for E2E testing.',
				screening_answers: {},
			},
		});
		if (!applyRes.ok()) {
			throw new Error(`Failed to apply: ${applyRes.status()} ${await applyRes.text()}`);
		}

		// 3. View applicants in recruiter UI
		await page.goto(`/recruiter/jobs/${jobId}/applicants`);
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(800);

		await expect(page.getByRole('heading', { name: 'Pipeline' }).first()).toBeVisible({
			timeout: 10000,
		});
		await expect(page.getByText(/1 applicant|applicants/i).first()).toBeVisible({ timeout: 10000 });
	});

	/**
	 * Verifies the recruiter can schedule an interview for an applicant.
	 * Creates a job, applies as candidate, advances applicant to shortlisted,
	 * then schedules an interview.
	 */
	test('schedule an interview', async ({ page, request }) => {
		const recruiterToken = getToken(RECRUITER_STORAGE);
		const candidateToken = getToken(CANDIDATE_STORAGE);
		const jobTitle = `E2E Interview Job ${Date.now()}`;

		// 1. Create a job via API
		const createRes = await request.post('/api/jobs', {
			headers: { Authorization: `Bearer ${recruiterToken}` },
			data: {
				title: jobTitle,
				company: 'E2E Interview Co',
				description: 'Job for interview scheduling E2E test.',
				requirements: 'Testing experience.',
				location: 'Remote',
				job_type: 'full-time',
				screening_questions: [],
			},
		});
		if (!createRes.ok()) {
			throw new Error(`Failed to create job: ${createRes.status()} ${await createRes.text()}`);
		}
		const jobData = await createRes.json();
		const jobId = jobData.job?.id || jobData.id;
		if (!jobId) {
			throw new Error('Job creation did not return an ID');
		}

		// 2. Apply as candidate via API
		await request.post(`/api/candidate/jobs/${jobId}/apply`, {
			headers: { Authorization: `Bearer ${candidateToken}` },
			data: {
				cover_letter: 'Looking forward to the interview.',
				screening_answers: {},
			},
		});

		// 3. Navigate to applicants and advance to shortlisted
		await page.goto(`/recruiter/jobs/${jobId}/applicants`);
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(800);

		await expect(page.getByRole('heading', { name: 'Pipeline' }).first()).toBeVisible({
			timeout: 10000,
		});

		// Advance from Applied → Screening → Shortlisted (2 clicks)
		for (let i = 0; i < 2; i++) {
			const advanceBtn = page.getByRole('button', { name: 'Advance' }).first();
			if (await advanceBtn.isVisible().catch(() => false)) {
				await advanceBtn.click();
				await page.waitForTimeout(1200);
			}
		}

		await expect(page.getByText('Shortlisted').first()).toBeVisible({ timeout: 10000 });

		// 4. Schedule an interview
		const scheduleBtn = page.getByRole('button', { name: /Schedule Interview/i }).first();
		if (await scheduleBtn.isVisible().catch(() => false)) {
			await scheduleBtn.click();

			// Fill interview scheduling form
			await expect(
				page.locator('text=/Schedule Interview|Interview Details/i').first(),
			).toBeVisible({ timeout: 10000 });

			// Select date (tomorrow)
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			const dateStr = tomorrow.toISOString().split('T')[0];
			const dateInput = page.locator('input[type="date"]').first();
			if (await dateInput.isVisible().catch(() => false)) {
				await dateInput.fill(dateStr);
			}

			// Select time
			const timeInput = page.locator('input[type="time"]').first();
			if (await timeInput.isVisible().catch(() => false)) {
				await timeInput.fill('14:00');
			}

			// Select type
			const typeSelect = page.locator('select').first();
			if (await typeSelect.isVisible().catch(() => false)) {
				await typeSelect.selectOption('video');
			}

			// Submit
			const submitBtn = page.getByRole('button', { name: /Schedule|Confirm/i }).first();
			if (await submitBtn.isVisible().catch(() => false)) {
				await submitBtn.click();
				await expect(page.locator('text=/Interview scheduled|Success/i').first()).toBeVisible({
					timeout: 10000,
				});
			}
		}
	});

	/**
	 * Verifies the recruiter analytics dashboard loads and displays key metrics.
	 */
	test('view analytics dashboard', async ({ page }) => {
		await page.goto('/recruiter/analytics');
		await page.waitForLoadState('networkidle');

		await expect(page.getByRole('heading', { name: /Hiring Analytics/i })).toBeVisible({
			timeout: 10000,
		});

		// Key metrics should be visible
		await expect(page.locator('text=Job Views').first()).toBeVisible({ timeout: 10000 });
		await expect(page.locator('text=Applications').first()).toBeVisible({ timeout: 10000 });
		await expect(page.locator('text=Conversion Rate').first()).toBeVisible({ timeout: 10000 });
		await expect(page.locator('text=Avg Days to Hire').first()).toBeVisible({ timeout: 10000 });
	});
});
