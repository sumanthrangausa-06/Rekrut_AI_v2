/**
 * Task 4 (#323) — Phase 2 Track A voice frontend E2E.
 *
 * Covers the session-page voice join path at the API level against the real
 * backend, plus the acceptance-critical fallback path in a real browser with
 * mocked LiveKit endpoints.
 *
 * Run with:
 *   BASE_URL=https://rekrutai-staging.onrender.com npx playwright test e2e/phase2-voice-interview.spec.ts
 *
 * Conventions (from e2e/phase1-interview.spec.ts):
 * - All test entities are clearly marked [E2E-TEST] for pre-launch cleanup (#151).
 * - API-first: Playwright's request fixture drives the backend E2E.
 *
 * Honest limits (documented, not hidden):
 * - A REAL LiveKit room join needs the deployed voice agent + real credentials;
 *   that is Task 7's staging E2E. Here the network is stubbed at the API
 *   boundary, so the browser tests prove the fallback path (the acceptance-
 *   critical behavior) and the API tests prove the token/dispatch/transcript
 *   contracts. The successful-join path is covered by the vitest hook tests
 *   (client/src/pages/candidate/useVoiceRoom.test.ts), which run in CI.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://rekrutai-staging.onrender.com';
const RUN = Date.now().toString(36);
const PASSWORD = 'TestPass123!';

const REC1 = `phase2-rec1-${RUN}@e2etestco.com`;
const CAND = `phase2-cand-${RUN}@e2etestco.com`;
const JOB_TITLE = `[E2E-TEST] Phase2 Voice ${RUN}`;

interface Ctx {
	rec1Token: string;
	candToken: string;
	candId: number;
	jobId: number;
	applicationId: number;
	sessionId: number;
	inviteToken: string;
}
const ctx = {} as Ctx;

function auth(token: string) {
	return { Authorization: `Bearer ${token}` };
}

async function registerOrLogin(
	request: any,
	email: string,
	role: string,
	company_name?: string,
): Promise<{ token: string; id: number; company_id: number }> {
	await request.post(`${BASE_URL}/api/auth/register`, {
		data: { email, password: PASSWORD, name: 'E2E Test', role, company_name },
	});
	const login = await request.post(`${BASE_URL}/api/auth/login`, {
		data: { email, password: PASSWORD },
	});
	expect(login.ok(), `login failed for ${email}: ${await login.text()}`).toBe(true);
	const body = await login.json();
	const token = body.token || body.accessToken;
	expect(token, `no token for ${email}`).toBeTruthy();
	return { token, id: body.user.id, company_id: body.user.company_id };
}

test.describe.serial('Phase 2 Track A voice frontend (#323)', () => {
	test('setup: accounts, job, apply → screening session', async ({ request }) => {
		const rec1 = await registerOrLogin(request, REC1, 'recruiter', '[E2E-TEST] Phase2 Co');
		ctx.rec1Token = rec1.token;

		const cand = await registerOrLogin(request, CAND, 'candidate');
		ctx.candToken = cand.token;
		ctx.candId = cand.id;

		const jobRes = await request.post(`${BASE_URL}/api/recruiter/jobs`, {
			headers: auth(ctx.rec1Token),
			data: {
				title: JOB_TITLE,
				description: 'E2E test job for Phase 2 voice verification.',
				requirements: 'Node.js, Postgres',
				location: 'Remote',
				job_type: 'full-time',
				auto_send_on_apply: true,
				auto_send_min_score: 0,
			},
		});
		expect(jobRes.ok(), `job create failed: ${await jobRes.text()}`).toBe(true);
		const job = await jobRes.json();
		ctx.jobId = job.job?.id || job.id;

		const applyRes = await request.post(`${BASE_URL}/api/candidate/jobs/${ctx.jobId}/apply`, {
			headers: auth(ctx.candToken),
			data: { cover_letter: 'E2E test application.' },
		});
		expect(applyRes.ok(), `apply failed: ${await applyRes.text()}`).toBe(true);
		const apply = await applyRes.json();
		ctx.applicationId = apply.application?.id || apply.applicationId || apply.id;

		const listRes = await request.get(
			`${BASE_URL}/api/interviews/interview-sessions?candidate_id=${ctx.candId}`,
			{ headers: auth(ctx.candToken) },
		);
		expect(listRes.ok(), `session list failed: ${await listRes.text()}`).toBe(true);
		const sessions = (await listRes.json()).sessions.filter(
			(s: any) => s.type === 'screening' && s.application_id === ctx.applicationId,
		);
		expect(sessions.length, 'no auto-sent screening session').toBeGreaterThan(0);
		ctx.sessionId = sessions[0].id;
		ctx.inviteToken = sessions[0].invite_token;
		expect(ctx.inviteToken, 'no invite token').toBeTruthy();
	});

	test('API: session room + token contract for the voice join', async ({ request }) => {
		// Idempotent room creation, keyed to the session.
		const roomRes = await request.post(`${BASE_URL}/api/livekit/session-rooms`, {
			headers: auth(ctx.candToken),
			data: { session_id: ctx.sessionId },
		});
		expect(roomRes.ok(), `room create failed: ${await roomRes.text()}`).toBe(true);
		const room = await roomRes.json();
		expect(room.room.room_name, 'room not keyed to the session').toBe(
			`interview-${ctx.sessionId}`,
		);

		// Token: the frontend needs token + roomName + livekitUrl to connect.
		const tokenRes = await request.post(
			`${BASE_URL}/api/livekit/session-rooms/${ctx.sessionId}/token`,
			{ headers: auth(ctx.candToken), data: { name: 'E2E Candidate' } },
		);
		expect(tokenRes.ok(), `token failed: ${await tokenRes.text()}`).toBe(true);
		const tokenBody = await tokenRes.json();
		expect(tokenBody.token, 'no token').toBeTruthy();
		expect(tokenBody.roomName).toBe(`interview-${ctx.sessionId}`);
		expect(tokenBody.livekitUrl, 'no livekitUrl — the client cannot connect').toMatch(/^wss?:\/\//);
	});

	test('API: transcript endpoint mirrors agent-persisted turns', async ({ request }) => {
		// Empty before the interview starts.
		const empty = await request.get(
			`${BASE_URL}/api/livekit/session-rooms/${ctx.sessionId}/transcript`,
			{ headers: auth(ctx.candToken) },
		);
		expect(empty.ok(), `transcript failed: ${await empty.text()}`).toBe(true);
		expect((await empty.json()).conversation).toEqual([]);

		// One HTTP turn persists to the session conversation — the voice agent
		// writes the same field after every turn, so this proves the polling
		// path surfaces agent turns too.
		const startRes = await request.post(
			`${BASE_URL}/api/interviews/interview-sessions/${ctx.sessionId}/start`,
			{ headers: auth(ctx.candToken) },
		);
		expect(startRes.ok(), `start failed: ${await startRes.text()}`).toBe(true);

		const respondRes = await request.post(
			`${BASE_URL}/api/interviews/interview-sessions/${ctx.sessionId}/respond`,
			{ headers: auth(ctx.candToken), data: { text: 'I am a data analyst.' } },
		);
		expect(respondRes.ok(), `respond failed: ${await respondRes.text()}`).toBe(true);

		const filled = await request.get(
			`${BASE_URL}/api/livekit/session-rooms/${ctx.sessionId}/transcript`,
			{ headers: auth(ctx.candToken) },
		);
		const conv = (await filled.json()).conversation;
		expect(conv.length, 'turn not persisted to the conversation').toBeGreaterThan(0);
		expect(conv[conv.length - 1].role).toBe('candidate');
	});

	test('API: dispatch does not crash the request (informational)', async ({ request }) => {
		// Against a real LiveKit project this dispatches the agent (200);
		// without one it degrades to 502 — it must never 500.
		const res = await request.post(
			`${BASE_URL}/api/livekit/session-rooms/${ctx.sessionId}/dispatch`,
			{ headers: auth(ctx.rec1Token), data: { mode: 'interviewer' } },
		);
		expect([200, 502, 503], `dispatch crashed: ${res.status()} ${await res.text()}`).toContain(
			res.status(),
		);
	});

	test('browser: LiveKit failure falls back to the HTTP-turn UI', async ({ page }) => {
		// The acceptance-critical path: dispatch/token failure must leave a
		// WORKING interview, never a dead room.
		await page.route('**/api/livekit/session-rooms/*/token', (route) =>
			route.fulfill({ status: 503, body: JSON.stringify({ error: 'LiveKit not configured' }) }),
		);
		await page.route('**/api/livekit/session-rooms/*/dispatch', (route) =>
			route.fulfill({ status: 502, body: JSON.stringify({ error: 'dispatch failed' }) }),
		);

		await page.goto(`${BASE_URL}/interview/session/${ctx.inviteToken}`);
		await expect(page.getByText(JOB_TITLE).first()).toBeVisible({ timeout: 30000 });

		const startBtn = page.getByRole('button', { name: /start/i }).first();
		if (await startBtn.isVisible().catch(() => false)) {
			await startBtn.click();
		}
		const consentBtn = page
			.getByRole('button', { name: /agree|consent|allow|accept/i })
			.first();
		await expect(consentBtn).toBeVisible({ timeout: 30000 });
		await consentBtn.click();

		const joinBtn = page.getByRole('button', { name: /join interview/i }).first();
		await expect(joinBtn).toBeVisible({ timeout: 30000 });
		await joinBtn.click();

		// Fallback: the Phase 1 HTTP-turn UI renders with an explanatory notice.
		await expect(page.getByText(/live voice isn.t available/i).first()).toBeVisible({
			timeout: 30000,
		});
		const answerBox = page.getByPlaceholder(/type your answer/i);
		await expect(answerBox).toBeVisible({ timeout: 15000 });

		// And it WORKS: send an answer, see it in the transcript.
		const answerText = `E2E fallback answer ${RUN}`;
		await answerBox.fill(answerText);
		await page.getByRole('button', { name: /send/i }).first().click();
		await expect(page.getByText(answerText).first()).toBeVisible({ timeout: 60000 });
	});
});
