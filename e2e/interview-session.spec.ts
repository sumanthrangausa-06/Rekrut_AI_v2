/**
 * Task 8 (#322) — unified candidate interview session page.
 * Flow: token → consent → start → respond → complete renders transcript.
 * Backend is fully mocked via page.route; media is stubbed.
 */
import { test, expect } from '@playwright/test';

const TOKEN = 'test-token-abc123';

const tokenSession = {
	success: true,
	session: {
		id: 42,
		type: 'screening',
		status: 'invited',
		job_id: 10,
		company_id: 5,
		candidate_id: 1,
		invite_token: TOKEN,
		job: { title: 'Data Analyst', company_name: 'Acme Corp', description: 'Analyze data.' },
		created_at: new Date().toISOString(),
	},
};

const startedSession = {
	success: true,
	session: {
		id: 42,
		type: 'screening',
		status: 'in_progress',
		job_id: 10,
		company_id: 5,
		candidate_id: 1,
		invite_token: TOKEN,
		config: { question_source: 'template', current_phase: 'intro' },
		conversation: [
			{
				role: 'interviewer',
				text: 'Hello! Thanks for joining. Tell me about yourself.',
				phase: 'intro',
				timestamp: new Date().toISOString(),
			},
		],
	},
	ai_message: 'Hello! Thanks for joining. Tell me about yourself.',
	phase: 'intro',
	recording: { id: 7, interview_session_id: 42, status: 'pending', started_at: null },
};

test.describe('Candidate interview session', () => {
	test.beforeEach(async ({ page }) => {
		// Fake auth + stubbed camera/mic (no real devices in CI)
		await page.addInitScript(() => {
			localStorage.setItem('token', 'test-jwt');
			const canvas = document.createElement('canvas');
			canvas.width = 320;
			canvas.height = 240;
			const fakeStream = canvas.captureStream(1);
			Object.defineProperty(navigator, 'mediaDevices', {
				value: {
					getUserMedia: async () => fakeStream,
					enumerateDevices: async () => [],
				},
				configurable: true,
			});
			// Headless speechSynthesis may never fire onend — resolve immediately
			Object.defineProperty(window, 'speechSynthesis', {
				value: {
					speak: (u: SpeechSynthesisUtterance) => setTimeout(() => u.onend?.(), 10),
					cancel: () => {},
					getVoices: () => [],
				},
				configurable: true,
			});
		});

		await page.route('**/api/interviews/interview-sessions/by-token/*', (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tokenSession) }),
		);
		// Keep the app's auth bootstrap from clearing the fake token
		await page.route('**/api/auth/me', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					user: { id: 1, email: 'candidate@test.com', name: 'Test Candidate', role: 'candidate' },
				}),
			}),
		);
		await page.route('**/api/interviews/interview-sessions/42/start', (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(startedSession) }),
		);
		await page.route('**/api/interviews/recordings/7/consent', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ success: true }),
			}),
		);
		await page.route('**/api/interviews/interview-sessions/42/tts', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ tts_unavailable: true, text: 'hello' }),
			}),
		);

		let respondCount = 0;
		await page.route('**/api/interviews/interview-sessions/42/respond', (route) => {
			respondCount += 1;
			const aiMessage =
				respondCount === 1
					? 'Great background. What tools do you use for analysis?'
					: 'Thanks for sharing. We are wrapping up.';
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					ai_message: aiMessage,
					phase: 'experience',
					is_complete: respondCount > 1,
				}),
			});
		});
		await page.route('**/api/interviews/interview-sessions/42/complete', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					report: { overall_score: 82, recommendation: 'advance' },
				}),
			}),
		);
	});

	test('token → consent → start → respond → complete renders transcript', async ({ page }) => {
		await page.goto(`/interview/session/${TOKEN}`);

		// Invite landing shows the job
		await expect(page.getByText('Data Analyst').first()).toBeVisible({ timeout: 15000 });
		await expect(page.getByText('Acme Corp').first()).toBeVisible();

		// Start → consent screen (camera not touched before consent)
		await page.getByRole('button', { name: /start interview/i }).click();
		await expect(page.getByText(/recording consent/i)).toBeVisible({ timeout: 15000 });

		// Consent → device check
		await page.getByRole('button', { name: /i consent/i }).click();
		await expect(page.getByText(/camera and microphone/i).first()).toBeVisible({ timeout: 15000 });

		// Join → active session with the intro question
		await page.getByRole('button', { name: /join interview/i }).click();
		await expect(page.getByText('Tell me about yourself').first()).toBeVisible({ timeout: 15000 });

		// Answer → second AI question appears in the transcript
		await page.getByPlaceholder(/type your answer/i).fill('I am a data analyst with 5 years of experience.');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText('What tools do you use for analysis?').first()).toBeVisible({
			timeout: 30000,
		});

		// End → thank-you screen with transcript + score
		await page.getByRole('button', { name: /end interview/i }).click();
		await page.getByRole('button', { name: /yes, end interview/i }).click();
		await expect(page.getByText(/thank you/i).first()).toBeVisible({ timeout: 30000 });
		await expect(page.getByText('Tell me about yourself').first()).toBeVisible();
		await expect(page.getByText(/82/).first()).toBeVisible();
	});
});
