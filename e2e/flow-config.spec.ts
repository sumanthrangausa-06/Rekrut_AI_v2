/**
 * Task 10 (#322) — recruiter interview-flow configuration UI.
 * Fully mocked via page.route (no backend): loads a job with threshold 0 and an
 * existing interview flow, then exercises the flow editor (topics, preview, save).
 */
import { test, expect, type Page } from '@playwright/test';

const job = {
	id: 10,
	title: 'Backend Engineer',
	company: 'Acme Corp',
	department: 'Engineering',
	description: 'Build APIs.',
	requirements: 'Node.js',
	location: 'Remote',
	salary_range: '',
	job_type: 'full-time',
	screening_questions: [],
	auto_send_on_apply: true,
	// Regression guard: 0 must stay 0, never become the 70 default (the || 70 bug).
	auto_send_min_score: 0,
};

const flow = {
	id: 9,
	job_id: 10,
	name: 'Flow screening',
	type: 'screening',
	description: 'Standard flow',
	phases: ['Introduction', 'Core questions', 'Wrap-up'],
	topics: ['experience', 'motivation'],
	questions: [{ question_text: 'Tell me about yourself.' }],
	rubric_weights: { can_do_work: 30, wants_move: 20, logistics_fit: 20, communication: 30 },
	triggers: { manual: true, auto_send_on_apply: true },
	status: 'active',
};

test.describe('Recruiter interview flow config', () => {
	let flowUpsertBody: Record<string, unknown> | null;

	test.beforeEach(async ({ page }) => {
		flowUpsertBody = null;
		await page.addInitScript(() => {
			localStorage.setItem('token', 'test-jwt');
		});

		// Catch-all for anything the layout bootstraps that we don't care about
		// (registered first so the specific mocks below take precedence).
		await page.route('**/api/**', (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
		);
		await page.route('**/api/auth/me', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					// company_id set: RecruiterGuard treats a recruiter without one
					// as pending approval and redirects away from the form.
					user: { id: 2, email: 'recruiter@test.com', name: 'Test Recruiter', role: 'recruiter', company_id: 5 },
				}),
			}),
		);
		await page.route('**/api/jobs/10', (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job }) }),
		);
		await page.route('**/api/countries', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ countries: [] }),
			}),
		);
		await page.route('**/api/interviews/screening/templates*', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ templates: [] }),
			}),
		);
		await page.route('**/api/interviews/interview-flows*', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ flows: [flow] }),
			}),
		);
		await page.route('**/api/interviews/interview-flows/9', (route) => {
			if (route.request().method() === 'PUT') {
				flowUpsertBody = route.request().postDataJSON() as Record<string, unknown>;
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ success: true, flow: { id: 9 } }),
				});
			} else {
				route.continue();
			}
		});
		await page.route('**/api/recruiter/jobs/10', (route) => {
			if (route.request().method() === 'PUT') {
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ success: true, job: { id: 10 } }),
				});
			} else {
				route.continue();
			}
		});
	});

	async function goToFlowEditor(page: Page) {
		await page.goto('/recruiter/jobs/10/edit');
		// Step 1 → step 2 (job title is prefilled from the mocked job)
		await page.getByRole('button', { name: 'Next' }).click();
		await expect(page.getByText('Interview Flow')).toBeVisible();
	}

	test('threshold 0 renders as 0, not the 70 default', async ({ page }) => {
		await goToFlowEditor(page);
		await expect(page.getByText('Minimum match score: 0%')).toBeVisible();
	});

	test('flow loads topics from the interview flow and accepts a new topic', async ({ page }) => {
		await goToFlowEditor(page);
		// Topics come from the flow row (Task 10 cutover source of truth)
		await expect(page.getByText('experience', { exact: true })).toBeVisible();
		await page.getByPlaceholder('Add a custom topic...').fill('system design');
		await page.getByPlaceholder('Add a custom topic...').press('Enter');
		await expect(page.getByText('system design', { exact: true })).toBeVisible();
	});

	test('preview shows phases, topics, rubric and triggers before saving', async ({ page }) => {
		await goToFlowEditor(page);
		await page.getByRole('button', { name: 'Preview', exact: true }).click();
		const preview = page.getByTestId('flow-preview');
		await expect(preview).toBeVisible();
		await expect(preview.getByText('Flow screening')).toBeVisible();
		await expect(preview.getByText('Introduction')).toBeVisible();
		await expect(preview.getByText('can do work: 30%')).toBeVisible();
		await expect(preview.getByText(/auto-send on apply/)).toBeVisible();
	});

	test('save upserts the interview flow with the edited config', async ({ page }) => {
		await goToFlowEditor(page);
		// Edit: add a topic and a question
		await page.getByPlaceholder('Add a custom topic...').fill('system design');
		await page.getByPlaceholder('Add a custom topic...').press('Enter');
		await page.getByPlaceholder('Add a question…').fill('Walk me through a system you designed.');
		await page.getByPlaceholder('Add a question…').press('Enter');

		// Step 2 → step 3 → save
		await page.getByRole('button', { name: 'Next' }).click();
		await page.getByRole('button', { name: 'Update Job' }).click();

		// The flow upsert fires (non-blocking, before the questionnaire save)
		await expect
			.poll(() => flowUpsertBody, { timeout: 15000 })
			.not.toBeNull();
		const body = flowUpsertBody as Record<string, unknown>;
		expect(body.name).toBe('Flow screening');
		expect(body.type).toBe('screening');
		expect(body.topics).toEqual(['experience', 'motivation', 'system design']);
		expect(body.questions).toEqual(['Tell me about yourself.', 'Walk me through a system you designed.']);
		expect(body.phases).toEqual(['Introduction', 'Core questions', 'Wrap-up']);
		expect(body.rubric_weights).toEqual({
			can_do_work: 30,
			wants_move: 20,
			logistics_fit: 20,
			communication: 30,
		});
		// Triggers mirror the form; the threshold stays job-level (not in triggers)
		expect(body.triggers).toEqual({ manual: true, auto_send_on_apply: true });
		expect(body).not.toHaveProperty('auto_send_min_score');
	});
});

test.describe('Legacy template question fallback', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('token', 'test-jwt');
		});

		// Catch-all for anything the layout bootstraps that we don't care about.
		await page.route('**/api/**', (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
		);
		await page.route('**/api/auth/me', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					user: { id: 2, email: 'recruiter@test.com', name: 'Test Recruiter', role: 'recruiter', company_id: 5 },
				}),
			}),
		);
		await page.route('**/api/jobs/10', (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job }) }),
		);
		await page.route('**/api/countries', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ countries: [] }),
			}),
		);
		// Legacy template with AI-generated questions and EMPTY topics; no flow row.
		await page.route('**/api/interviews/screening/templates*', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					templates: [
						{
							id: 5,
							topics: [],
							questions: ['What is a closure?', { question_text: 'Explain the event loop.' }],
						},
					],
				}),
			}),
		);
		await page.route('**/api/interviews/interview-flows*', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ flows: [] }),
			}),
		);
	});

	test('legacy template questions seed the flow editor when no flow row exists', async ({ page }) => {
		await page.goto('/recruiter/jobs/10/edit');
		// Step 1 → step 2 (job title is prefilled from the mocked job)
		await page.getByRole('button', { name: 'Next' }).click();
		await expect(page.getByText('Interview Flow')).toBeVisible();
		// Both legacy question shapes (string + {question_text}) seed the editor
		await expect(page.getByText('What is a closure?', { exact: true })).toBeVisible();
		await expect(page.getByText('Explain the event loop.', { exact: true })).toBeVisible();
	});
});
