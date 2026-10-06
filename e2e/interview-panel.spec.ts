/**
 * Task 9 (#322) — recruiter unified interview panel + session report view.
 * The report page is rendered with fully mocked backend (page.route):
 * seeded sessions of all four types appear, and the report shows the
 * transcript, AI evaluation scores, and the recording playback element.
 */
import { test, expect } from '@playwright/test';

const CANDIDATE_ID = 1;
const SESSION_ID = 42;

const completedSession = {
	id: SESSION_ID,
	type: 'screening',
	status: 'completed',
	source: 'interview_session',
	candidate_id: CANDIDATE_ID,
	created_at: new Date().toISOString(),
	started_at: new Date().toISOString(),
	completed_at: new Date().toISOString(),
	config: {
		question_source: 'template',
		report: {
			overall_score: 82,
			recommendation: 'advance',
			recommendation_reasoning: 'Strong backend depth.',
			strengths: ['concrete examples'],
			red_flags: [],
			dimension_scores: {
				can_do_work: { score: 85, evidence: 'Shipped APIs.' },
				communication: { score: 80, evidence: 'Clear answers.' },
			},
			key_moments: ['Strong system design answer'],
			question_scores: [{ question_index: 0, topic: 'experience', score: 85, feedback: 'Good.' }],
		},
	},
	conversation: [
		{
			role: 'interviewer',
			text: 'Hello! Tell me about yourself.',
			phase: 'intro',
			timestamp: new Date().toISOString(),
		},
		{
			role: 'candidate',
			text: 'I am a backend engineer with 5 years of experience.',
			phase: 'intro',
			timestamp: new Date().toISOString(),
		},
	],
	frame_analysis: {
		turn_count: 1,
		per_turn: [{ eye_contact: 'good', posture: 'upright' }],
	},
};

const otherSessions = [
	{
		id: 43,
		type: 'ai_interview',
		status: 'in_progress',
		source: 'interview_session',
		candidate_id: CANDIDATE_ID,
		created_at: new Date().toISOString(),
		config: {},
		conversation: [],
	},
	{
		id: 44,
		type: 'practice',
		status: 'completed',
		source: 'interview_session',
		candidate_id: CANDIDATE_ID,
		created_at: new Date().toISOString(),
		config: { report: { overall_score: 71, recommendation: 'consider' } },
		conversation: [],
	},
	{
		id: 45,
		type: 'human_scheduled',
		status: 'scheduled',
		source: 'scheduled_interviews',
		scheduled_at: new Date().toISOString(),
	},
];

const listResponse = {
	success: true,
	sessions: [completedSession, ...otherSessions],
};

const recordingResponse = {
	success: true,
	recording: {
		id: 7,
		status: 'completed',
		started_at: new Date().toISOString(),
		stopped_at: new Date().toISOString(),
		duration_seconds: 372,
	},
};

test.describe('Recruiter interview report', () => {
	test.beforeEach(async ({ page }) => {
		// Fake recruiter auth
		await page.addInitScript(() => {
			localStorage.setItem('token', 'test-jwt');
		});
		await page.route('**/api/auth/me', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					// company_id present: otherwise RecruiterGuard treats the
					// recruiter as pending approval and redirects away.
					user: {
						id: 2,
						email: 'recruiter@test.com',
						name: 'Test Recruiter',
						role: 'recruiter',
						company_id: 5,
					},
				}),
			}),
		);
		await page.route('**/api/interviews/interview-sessions?candidate_id=*', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(listResponse),
			}),
		);
		await page.route(`**/api/interviews/interview-sessions/${SESSION_ID}/recording`, (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(recordingResponse),
			}),
		);
	});

	test('report shows AI evaluation, transcript, frame signals, and playback element', async ({
		page,
	}) => {
		await page.goto(`/recruiter/interviews/report/${SESSION_ID}?candidateId=${CANDIDATE_ID}`);

		// AI evaluation: score + recommendation
		await expect(page.getByText('82/100')).toBeVisible();
		await expect(page.getByText('ADVANCE')).toBeVisible();
		await expect(page.getByText('Strong backend depth.')).toBeVisible();
		await expect(page.getByText('Can do the work')).toBeVisible();

		// Transcript turns
		await expect(page.getByText('Hello! Tell me about yourself.')).toBeVisible();
		await expect(page.getByText('I am a backend engineer with 5 years of experience.')).toBeVisible();

		// Frame timeline
		await expect(page.getByText('Video Signals')).toBeVisible();
		await expect(page.getByText(/eye_contact/)).toBeVisible();

		// Recording playback element
		await expect(page.getByText(/Status: completed/)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Open playback' })).toBeVisible();
	});

	test('report handles a session with no evaluation yet', async ({ page }) => {
		// Session 43 is in_progress with no report
		await page.goto(`/recruiter/interviews/report/43?candidateId=${CANDIDATE_ID}`);

		await expect(page.getByText('No evaluation report yet')).toBeVisible();
		await expect(page.getByText('No transcript available.')).toBeVisible();
	});

	test('applicant dialog shows unified panel with all session types and trigger', async ({
		page,
	}) => {
		await page.route('**/api/recruiter/jobs/10/applications', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					job: { id: 10, title: 'Backend Engineer' },
					applications: [
						{
							id: 20,
							candidate_id: CANDIDATE_ID,
							job_id: 10,
							status: 'applied',
							candidate_name: 'Test Candidate',
							candidate_email: 'candidate@test.com',
							applied_at: new Date().toISOString(),
							updated_at: new Date().toISOString(),
						},
					],
				}),
			}),
		);
		let triggerBody: unknown = null;
		await page.route('**/api/interviews/interview-sessions/trigger', (route) => {
			triggerBody = route.request().postDataJSON();
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ success: true, already_triggered: false, session: { id: 99 } }),
			});
		});

		await page.goto('/recruiter/jobs/10/applicants');
		await page.getByText('Test Candidate').click();

		// All four session types render in the Interviews section (scoped to the
		// applicant dialog — the sidebar nav also has an "AI Screening" link).
		// The app's custom Dialog has no role="dialog"; scope by its fixed overlay.
		const dialog = page.locator('div.fixed.inset-0.z-50');
		await expect(dialog.getByText('AI Screening', { exact: true })).toBeVisible();
		await expect(dialog.getByText('AI Interview', { exact: true })).toBeVisible();
		await expect(dialog.getByText('Practice', { exact: true })).toBeVisible();
		await expect(dialog.getByText('Human Interview', { exact: true })).toBeVisible();

		// Trigger fires the POST with the application id
		await dialog.getByRole('button', { name: 'Start AI interview' }).click();
		await expect(dialog.getByText('AI interview triggered')).toBeVisible();
		expect(triggerBody).toEqual({ application_id: 20 });
	});
});
