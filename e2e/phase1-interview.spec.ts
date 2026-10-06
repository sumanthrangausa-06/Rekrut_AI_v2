/**
 * Task 12 (#322) — Phase 1 staging E2E.
 *
 * Targeted, real-backend / real-DB verification of the conversational AI
 * interview phase. This is the real-DB gate for the whole phase: the first
 * time migrations 128/129/130/138 and the Phase 1 SQL paths run against real
 * Postgres.
 *
 * Run with:
 *   BASE_URL=https://rekrutai-staging.onrender.com npx playwright test e2e/phase1-interview.spec.ts
 *
 * Conventions:
 * - All test entities are clearly marked [E2E-TEST] for pre-launch cleanup (#151).
 * - API-first: Playwright's request fixture drives the backend E2E.
 * - One browser test exercises the real candidate page (token → consent →
 *   devices → interview) with fake media devices.
 * - AI turns are kept minimal (2 screening responds, 1 interview turn).
 *
 * This file is intentionally standalone: the repo's full Playwright suite is
 * broken (pre-existing, CI-unrelated) and is not touched here.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://rekrutai-staging.onrender.com';
const RUN = Date.now().toString(36);
const PASSWORD = 'TestPass123!';

const REC1 = `phase1-rec1-${RUN}@e2etestco.com`;
const CAND = `phase1-cand-${RUN}@e2etestco.com`;
const REC2 = `phase1-rec2-${RUN}@e2eotherco.com`;
const JOB_TITLE = `[E2E-TEST] Phase1 Screening ${RUN}`;
const RESUME_KEYWORD = `ZephyrDB-${RUN}`; // unique token to trace resume → trigger personalization

// 1x1 JPEG data URL — accepted by the frames path without real camera hardware.
const TINY_FRAME =
	'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////2wBDAf//////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBIiAAIRECEQA7/8A8g//9k=';

interface Ctx {
	rec1Token: string;
	rec1Id: number;
	rec1CompanyId: number;
	candToken: string;
	candId: number;
	rec2Token: string;
	jobId: number;
	applicationId: number;
	screenSessionId: number;
	screenToken: string;
	recordingId: number;
	triggerSessionId: number;
	manualToken: string;
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

test.describe.serial('Phase 1 staging E2E (#322)', () => {
	test('setup: register/log in test accounts', async ({ request }) => {
		const rec1 = await registerOrLogin(request, REC1, 'recruiter', '[E2E-TEST] Phase1 Co');
		ctx.rec1Token = rec1.token;
		ctx.rec1Id = rec1.id;
		ctx.rec1CompanyId = rec1.company_id;
		expect(ctx.rec1CompanyId, 'recruiter1 has no company_id').toBeTruthy();

		const cand = await registerOrLogin(request, CAND, 'candidate');
		ctx.candToken = cand.token;
		ctx.candId = cand.id;

		const rec2 = await registerOrLogin(request, REC2, 'recruiter', '[E2E-TEST] Other Co');
		ctx.rec2Token = rec2.token;
		expect(rec2.company_id).not.toBe(ctx.rec1CompanyId);
	});

	test('Step 1: apply → auto-send creates a screening session', async ({ request }) => {
		// Recruiter creates a job with auto-send on and threshold 0 (everyone qualifies).
		const jobRes = await request.post(`${BASE_URL}/api/recruiter/jobs`, {
			headers: auth(ctx.rec1Token),
			data: {
				title: JOB_TITLE,
				description: 'E2E test job for Phase 1 screening verification.',
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
		expect(ctx.jobId).toBeTruthy();

		// Candidate applies.
		const applyRes = await request.post(`${BASE_URL}/api/candidate/jobs/${ctx.jobId}/apply`, {
			headers: auth(ctx.candToken),
			data: { cover_letter: 'E2E test application.' },
		});
		expect(applyRes.ok(), `apply failed: ${await applyRes.text()}`).toBe(true);
		const apply = await applyRes.json();
		ctx.applicationId = apply.application?.id || apply.applicationId || apply.id;
		expect(ctx.applicationId).toBeTruthy();

		// Auto-send must have created an interview_sessions row (type=screening).
		const listRes = await request.get(
			`${BASE_URL}/api/interviews/interview-sessions?candidate_id=${ctx.candId}`,
			{ headers: auth(ctx.candToken) },
		);
		expect(listRes.ok(), `session list failed: ${await listRes.text()}`).toBe(true);
		const sessions = (await listRes.json()).sessions.filter(
			(s: any) => s.type === 'screening' && s.application_id === ctx.applicationId,
		);
		expect(sessions.length, 'no auto-sent screening session').toBeGreaterThan(0);
		const session = sessions[0];
		expect(session.status).toBe('invited');
		ctx.screenSessionId = session.id;
		ctx.screenToken = session.invite_token;
		expect(ctx.screenToken, 'no invite token on session').toBeTruthy();

		// C1 (mount-order fix): the single-segment list GET must return 200, not 400.
		const recList = await request.get(
			`${BASE_URL}/api/interviews/interview-sessions?candidate_id=${ctx.candId}`,
			{ headers: auth(ctx.rec1Token) },
		);
		expect(recList.status(), 'C1: recruiter list GET did not return 200').toBe(200);
	});

	test('Step 2: complete a screening via API (consent → start → 2 turns → complete)', async ({
		request,
	}) => {
		// Start (creates the session-linked recording row).
		const startRes = await request.post(
			`${BASE_URL}/api/interviews/interview-sessions/${ctx.screenSessionId}/start`,
			{ headers: auth(ctx.candToken) },
		);
		expect(startRes.ok(), `start failed: ${await startRes.text()}`).toBe(true);
		const started = await startRes.json();
		expect(started.session.status).toBe('in_progress');
		expect(started.ai_message, 'no AI opening message').toBeTruthy();
		ctx.recordingId = started.recording?.id;
		expect(ctx.recordingId, 'no recording row from start').toBeTruthy();

		// Consent (explicit) — required before frames are accepted.
		const consentRes = await request.post(
			`${BASE_URL}/api/interviews/recordings/${ctx.recordingId}/consent`,
			{ headers: auth(ctx.candToken), data: { consent_type: 'explicit' } },
		);
		expect(consentRes.ok(), `consent failed: ${await consentRes.text()}`).toBe(true);

		// Two conversational turns with a frame each (camera-on path).
		let convLen = started.session.conversation?.length || 0;
		for (let i = 0; i < 2; i++) {
			const respRes = await request.post(
				`${BASE_URL}/api/interviews/interview-sessions/${ctx.screenSessionId}/respond`,
				{
					headers: { ...auth(ctx.candToken), 'Content-Type': 'application/json' },
					data: {
						text: `E2E answer ${i + 1}: I have five years of backend experience with Node.js and Postgres.`,
						frames: [TINY_FRAME],
					},
				},
			);
			expect(respRes.ok(), `respond ${i} failed: ${await respRes.text()}`).toBe(true);
			const resp = await respRes.json();
			expect(resp.ai_message, `no AI message on turn ${i}`).toBeTruthy();
			const newLen = resp.session?.conversation?.length || 0;
			expect(newLen, 'transcript did not grow').toBeGreaterThan(convLen);
			convLen = newLen;
		}

		// Complete → report generated.
		const completeRes = await request.post(
			`${BASE_URL}/api/interviews/interview-sessions/${ctx.screenSessionId}/complete`,
			{ headers: auth(ctx.candToken) },
		);
		expect(completeRes.ok(), `complete failed: ${await completeRes.text()}`).toBe(true);
		const completed = await completeRes.json();
		expect(completed.session.status).toBe('completed');
		expect(completed.report?.overall_score, 'no report score').not.toBeNull();

		// Recording row completed.
		const recRes = await request.get(
			`${BASE_URL}/api/interviews/interview-sessions/${ctx.screenSessionId}/recording`,
			{ headers: auth(ctx.rec1Token) },
		);
		expect(recRes.ok(), `recording fetch failed: ${await recRes.text()}`).toBe(true);
	});

	test('Step 2b: manual screening send uses the unified model (C2)', async ({ request }) => {
		// Manual send (C2 fix) → unified invite URL → token resolves on the page.
		// Uses a second job WITHOUT auto-send so the manual send isn't a duplicate.
		const job2Res = await request.post(`${BASE_URL}/api/recruiter/jobs`, {
			headers: auth(ctx.rec1Token),
			data: {
				title: `[E2E-TEST] Phase1 ManualSend ${RUN}`,
				description: 'E2E manual-send test job.',
				requirements: 'None',
				location: 'Remote',
				job_type: 'full-time',
				auto_send_on_apply: false,
			},
		});
		expect(job2Res.ok()).toBe(true);
		const job2 = await job2Res.json();
		const job2Id = job2.job?.id || job2.id;

		const apply2 = await request.post(`${BASE_URL}/api/candidate/jobs/${job2Id}/apply`, {
			headers: auth(ctx.candToken),
			data: { cover_letter: 'E2E manual-send application.' },
		});
		expect(apply2.ok()).toBe(true);
		const app2 = await apply2.json();
		const app2Id = app2.application?.id || app2.applicationId || app2.id;

		const tplRes = await request.get(`${BASE_URL}/api/interviews/screening/templates`, {
			headers: auth(ctx.rec1Token),
		});
		expect(tplRes.ok()).toBe(true);
		const templates = (await tplRes.json()).templates || [];
		expect(templates.length, 'no screening templates for manual send').toBeGreaterThan(0);

		const sendRes = await request.post(`${BASE_URL}/api/interviews/screening/send`, {
			headers: auth(ctx.rec1Token),
			data: {
				template_id: templates[0].id,
				candidate_id: ctx.candId,
				application_id: app2Id,
				job_id: job2Id,
			},
		});
		expect(sendRes.ok(), `manual send failed: ${await sendRes.text()}`).toBe(true);
		const sent = await sendRes.json();
		// C2 fix: unified invite URL, not /screening/<token>.
		expect(sent.invite_url, 'C2: invite_url is not the unified path').toContain(
			'/interview/session/',
		);
		const manualToken = sent.invite_url.split('/interview/session/')[1];
		expect(manualToken).toBeTruthy();
		ctx.manualToken = manualToken;

		// Duplicate manual send is idempotent (409, unified-table dup check).
		const dupRes = await request.post(`${BASE_URL}/api/interviews/screening/send`, {
			headers: auth(ctx.rec1Token),
			data: {
				template_id: templates[0].id,
				candidate_id: ctx.candId,
				application_id: app2Id,
				job_id: job2Id,
			},
		});
		expect(dupRes.status()).toBe(409);

		// Anonymous token resolution (redacted).
		const byToken = await request.get(
			`${BASE_URL}/api/interviews/interview-sessions/by-token/${manualToken}`,
		);
		expect(byToken.ok(), `by-token failed: ${await byToken.text()}`).toBe(true);
		const tokenBody = await byToken.json();
		expect(tokenBody.session?.job?.title).toContain('[E2E-TEST]');
		expect(tokenBody.session?.conversation, 'token response leaks conversation').toBeFalsy();
	});

	test('Step 2c: candidate page loads the token and starts the interview (browser)', async ({
		page,
	}) => {
		const manualToken = ctx.manualToken;
		expect(manualToken, 'no manual token from Step 2b').toBeTruthy();

		// Real page: fake media devices, consent → devices → start → first AI turn.
		await page.addInitScript((token: string) => {
			localStorage.setItem('token', token);
			localStorage.setItem('rekrutai_token', token);
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
		}, ctx.candToken);

		await page.goto(`${BASE_URL}/interview/session/${manualToken}`);
		// Token landing shows the job; proceed through consent.
		await expect(page.getByText(JOB_TITLE).first()).toBeVisible({ timeout: 30000 });

		// Click through to consent (button labels from InterviewSession.tsx).
		const startBtn = page.getByRole('button', { name: /start/i }).first();
		if (await startBtn.isVisible().catch(() => false)) {
			await startBtn.click();
		}
		const consentBtn = page
			.getByRole('button', { name: /agree|consent|allow|accept/i })
			.first();
		await expect(consentBtn).toBeVisible({ timeout: 30000 });
		await consentBtn.click();

		// Device check → begin interview; wait for the first AI message.
		const beginBtn = page.getByRole('button', { name: /begin|continue|start interview/i }).first();
		await expect(beginBtn).toBeVisible({ timeout: 30000 });
		await beginBtn.click();
		await expect(page.getByText(/E2E answer|interviewer/i).first()).toBeVisible({
			timeout: 90000,
		});
	});

	test('Step 3: recruiter triggers a personalized AI interview', async ({ request }) => {
		// Upload a resume so the trigger can personalize from it.
		const resumeText = `E2E Test Candidate\nSenior Backend Engineer with 6 years of Node.js experience.\nSpecialist in ${RESUME_KEYWORD} distributed database internals and Postgres query planning.`;
		const uploadRes = await request.post(`${BASE_URL}/api/candidate/resume/upload`, {
			headers: auth(ctx.candToken),
			multipart: {
				resume: {
					name: 'e2e-resume.txt',
					mimeType: 'text/plain',
					buffer: Buffer.from(resumeText),
				},
			},
		});
		expect(uploadRes.ok(), `resume upload failed: ${await uploadRes.text()}`).toBe(true);

		const trigRes = await request.post(`${BASE_URL}/api/interviews/interview-sessions/trigger`, {
			headers: auth(ctx.rec1Token),
			data: { application_id: ctx.applicationId },
		});
		expect(trigRes.ok(), `trigger failed: ${await trigRes.text()}`).toBe(true);
		const trig = await trigRes.json();
		ctx.triggerSessionId = trig.session?.id;
		expect(ctx.triggerSessionId).toBeTruthy();

		// Personalized source: frozen resume text in the session config.
		const cfg = trig.session?.config || {};
		expect(cfg.question_source, 'not the personalized source').toBe('personalized');
		expect(
			JSON.stringify(cfg.resume || {}),
			'resume not frozen into trigger config',
		).toContain(RESUME_KEYWORD);

		// One turn: the interviewer's message should exist (personalization is in the prompt).
		const startRes = await request.post(
			`${BASE_URL}/api/interviews/interview-sessions/${ctx.triggerSessionId}/start`,
			{ headers: auth(ctx.candToken) },
		);
		expect(startRes.ok(), `interview start failed: ${await startRes.text()}`).toBe(true);
		const started = await startRes.json();
		expect(started.ai_message, 'no AI interview opening').toBeTruthy();
	});

	test('Step 4: panel, audit log, retention, and C3 authz', async ({ request }) => {
		// Unified panel (recruiter view): both sessions visible.
		const panelRes = await request.get(
			`${BASE_URL}/api/interviews/interview-sessions?candidate_id=${ctx.candId}`,
			{ headers: auth(ctx.rec1Token) },
		);
		expect(panelRes.ok()).toBe(true);
		const sessions = (await panelRes.json()).sessions;
		const types = sessions.map((s: any) => s.type);
		expect(types, 'panel missing screening').toContain('screening');
		expect(types, 'panel missing ai_interview').toContain('ai_interview');

		// Audit log has the lifecycle events.
		const auditRes = await request.get(`${BASE_URL}/api/company/audit-log`, {
			headers: auth(ctx.rec1Token),
		});
		expect(auditRes.ok(), `audit log failed: ${await auditRes.text()}`).toBe(true);
		const events = (await auditRes.json()).events || (await auditRes.json()).logs || [];
		const actions = events.map((e: any) => e.action);
		for (const expected of ['session.sent', 'session.started', 'session.completed', 'session.scored']) {
			expect(actions, `audit missing ${expected}`).toContain(expected);
		}

		// Retention: hiring decision sets retention_expires_at on the recording.
		const statusRes = await request.put(
			`${BASE_URL}/api/recruiter/applications/${ctx.applicationId}/status`,
			{ headers: auth(ctx.rec1Token), data: { status: 'hired' } },
		);
		expect(statusRes.ok(), `status update failed: ${await statusRes.text()}`).toBe(true);
		const recRes = await request.get(
			`${BASE_URL}/api/interviews/interview-sessions/${ctx.screenSessionId}/recording`,
			{ headers: auth(ctx.rec1Token) },
		);
		expect(recRes.ok()).toBe(true);
		const recording = (await recRes.json()).recording;
		expect(recording?.retention_expires_at, 'retention_expires_at not set').toBeTruthy();

		// C3: cross-company recruiter cannot read the session.
		const xRes = await request.get(
			`${BASE_URL}/api/interviews/interview-sessions/${ctx.screenSessionId}/recording`,
			{ headers: auth(ctx.rec2Token) },
		);
		expect(xRes.status(), 'C3: cross-company recruiter was not denied').toBe(403);
		const xList = await request.get(
			`${BASE_URL}/api/interviews/interview-sessions?candidate_id=${ctx.candId}`,
			{ headers: auth(ctx.rec2Token) },
		);
		expect(xList.ok()).toBe(true);
		expect(
			(await xList.json()).sessions.length,
			'C3: cross-company list leaked sessions',
		).toBe(0);
	});
});
