/**
 * S-096 / #820 — candidate application endpoints: status self-advance guard
 * + payload minimisation.
 *
 * Proven in the S-088 audit (live): PUT /api/candidate/applications/:id/status
 * accepted ANY of the 9 statuses with an ownership-only check — a candidate
 * set their own application to `hired`, and reversed a recruiter's
 * `rejected` back to `offered`. The candidate-facing responses also
 * serialised the raw job_applications row (recruiter_notes, screening_score).
 *
 * Contract under test:
 *  - Candidate-writable status set = {withdrawn} ONLY. Every recruiter-owned
 *    status attempt → 403 and the row is unchanged (incl. rejection-reversal).
 *  - Candidate withdraw (status endpoint or withdraw endpoint) of a
 *    non-terminal application → 200; of a terminal application → 400.
 *  - Another candidate's application → 404 (existing ownership behaviour).
 *  - Candidate-facing responses (status, withdraw, GET list, apply,
 *    auto-apply) project EXACTLY the candidate-safe key set — no
 *    recruiter_notes / screening_score / omniscore_at_apply / resume_url.
 *  - Recruiter-side status endpoint is unchanged: transitions still 200 and
 *    its response still carries the full row (incl. recruiter_notes).
 *  - submitApplication's internal behaviour is unaffected (apply still
 *    creates the row; duplicate apply still 400; auto-apply still works).
 *
 * Mocked tier only: in-memory store behind the repo's mocked lib/db
 * (server/test/setup.js), same pattern as candidate-autosend.test.js.
 * The store deliberately returns FULL raw rows (incl. recruiter-internal
 * fields) from UPDATE/INSERT — the response projection must strip them.
 */

const request = require('supertest');
const express = require('express');

// ─── Auth (header-driven, two candidates + one recruiter) ───────────────────
jest.mock('../../../lib/auth', () => {
	const passthrough = (req, res, next) => next();
	const authMiddleware = jest.fn((req, res, next) => {
		const userId = parseInt(req.headers['x-test-user-id'], 10);
		const user = global.__testUsers?.[userId];
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		req.user = user;
		return next();
	});
	return {
		authMiddleware,
		requireRole: () => passthrough,
		requireApprovedRecruiter: passthrough,
		requireNotSuspended: passthrough,
		requireEmployer: passthrough,
		optionalAuth: passthrough,
	};
});

// ─── Side-effect / boundary mocks ───────────────────────────────────────────
jest.mock('../../../services/matching-engine', () => ({
	calculateDeterministicMatch: jest.fn(() => ({ match_score: 80 })),
}));
jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn().mockResolvedValue(1),
}));
jest.mock('../../../lib/email-service', () => ({
	sendTemplatedEmail: jest.fn().mockResolvedValue({}),
	sendCustomEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../routes/chat', () => ({
	getOrCreateConversation: jest.fn().mockResolvedValue({ id: 1 }),
}));
jest.mock('../../../lib/subscription', () => ({
	checkFeatureAccess: jest.fn().mockResolvedValue({ allowed: true }),
	incrementUsage: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../middleware/rbac', () => ({
	requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../../../services/trustscore', () => ({
	updateHiringRatioScore: jest.fn().mockResolvedValue(true),
	calculateTrustScore: jest.fn().mockResolvedValue(null),
}));

// ─── In-memory store behind the globally mocked lib/db ──────────────────────
const db = require('../../../lib/db');

const CANDIDATE_SAFE_KEYS = [
	'id',
	'job_id',
	'candidate_id',
	'company_id',
	'status',
	'cover_letter',
	'screening_answers',
	'screening_status',
	'match_score',
	'assessment_score',
	'assessment_result',
	'is_auto_applied',
	'applied_via',
	'applied_at',
	'updated_at',
].sort();

const LIST_EXTRA_KEYS = [
	'title',
	'company',
	'location',
	'salary_range',
	'job_type',
	'screening_questions',
	'posted_by_company',
	'poster_company',
	'intro_status',
	'intro_id',
	'outreach_count',
].sort();

const store = { applications: new Map(), nextId: 100 };

function seedApp(overrides = {}) {
	const row = {
		id: 1,
		job_id: 10,
		candidate_id: 1,
		company_id: 9,
		status: 'applied',
		resume_url: 'https://files.example/resume.pdf',
		cover_letter: 'My cover letter',
		omniscore_at_apply: 71,
		recruiter_notes: 'INTERNAL: borderline culture fit',
		screening_answers: {},
		screening_status: null,
		screening_score: 42.5,
		match_score: 80,
		assessment_score: 88,
		assessment_result: 'pass',
		is_auto_applied: false,
		applied_via: 'manual',
		applied_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-02T00:00:00.000Z',
		...overrides,
	};
	store.applications.set(row.id, row);
	return row;
}

const JOB_ROW = {
	id: 10,
	company_id: 9,
	user_id: 77,
	title: 'Data Analyst',
	company: 'Acme',
	location: 'Remote',
	salary_range: '$80k-$100k',
	job_type: 'full-time',
	screening_questions: [],
	auto_send_on_apply: false,
};

function installDbMock() {
	db.query.mockImplementation(async (sql, params = []) => {
		const n = sql.toLowerCase().replace(/\s+/g, ' ').trim();

		// INSERT a new application (submitApplication) — returns the RAW row,
		// recruiter-internal fields included, exactly like RETURNING *.
		if (n.startsWith('insert into job_applications')) {
			const row = {
				id: store.nextId++,
				candidate_id: params[0],
				job_id: params[1],
				company_id: params[2],
				cover_letter: params[3],
				match_score: params[4],
				omniscore_at_apply: params[5],
				screening_answers: JSON.parse(params[6] || '{}'),
				is_auto_applied: params[7],
				applied_via: params[8],
				status: 'applied',
				resume_url: 'https://files.example/resume.pdf',
				recruiter_notes: 'INTERNAL',
				screening_status: null,
				screening_score: 11,
				assessment_score: null,
				assessment_result: null,
				applied_at: '2026-10-13T00:00:00.000Z',
				updated_at: '2026-10-13T00:00:00.000Z',
			};
			store.applications.set(row.id, row);
			return { rows: [row], rowCount: 1 };
		}

		// Recruiter status UPDATE (COALESCE form, routes/recruiter.js)
		if (n.includes('update job_applications set') && n.includes('coalesce')) {
			const row = store.applications.get(Number(params[2]));
			if (!row) return { rows: [], rowCount: 0 };
			if (params[0]) row.status = params[0];
			if (params[1]) row.recruiter_notes = params[1];
			row.updated_at = '2026-10-13T00:00:00.000Z';
			return { rows: [row], rowCount: 1 };
		}

		// Withdraw UPDATE (literal 'withdrawn')
		if (n.includes('update job_applications') && n.includes("status = 'withdrawn'")) {
			const row = store.applications.get(Number(params[0]));
			if (!row) return { rows: [], rowCount: 0 };
			row.status = 'withdrawn';
			return { rows: [row], rowCount: 1 };
		}

		// Candidate status UPDATE (SET status = $1)
		if (n.includes('update job_applications set status = $1')) {
			const row = store.applications.get(Number(params[1]));
			if (!row) return { rows: [], rowCount: 0 };
			row.status = params[0];
			row.updated_at = '2026-10-13T00:00:00.000Z';
			return { rows: [row], rowCount: 1 };
		}

		if (n.includes('update job_applications set screening_status')) {
			return { rows: [], rowCount: 1 };
		}

		// Ownership/status lookups (candidate status + withdraw handlers)
		if (n.includes('select id, status from job_applications')) {
			const row = store.applications.get(Number(params[0]));
			if (row && row.candidate_id === Number(params[1])) {
				return { rows: [{ id: row.id, status: row.status }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		}

		// Recruiter ownership lookup
		if (n.includes('select id, job_id, candidate_id, status as old_status from job_applications')) {
			const row = store.applications.get(Number(params[0]));
			if (row && row.company_id === Number(params[1])) {
				return {
					rows: [
						{
							id: row.id,
							job_id: row.job_id,
							candidate_id: row.candidate_id,
							old_status: row.status,
						},
					],
					rowCount: 1,
				};
			}
			return { rows: [], rowCount: 0 };
		}

		// Duplicate-apply check
		if (n.includes('select id from job_applications where candidate_id')) {
			const found = [...store.applications.values()].filter(
				(a) => a.candidate_id === Number(params[0]) && a.job_id === Number(params[1]),
			);
			return { rows: found.map((a) => ({ id: a.id })), rowCount: found.length };
		}

		// GET /applications list (joined) — raw ja fields + job basics + secrets
		if (n.includes('from job_applications ja')) {
			const rows = [...store.applications.values()]
				.filter((a) => a.candidate_id === Number(params[0]))
				.map((a) => ({
					...a,
					title: JOB_ROW.title,
					company: JOB_ROW.company,
					location: JOB_ROW.location,
					salary_range: JOB_ROW.salary_range,
					job_type: JOB_ROW.job_type,
					screening_questions: [],
					posted_by_company: 'Acme',
					poster_company: 'Acme',
					intro_status: null,
					intro_id: null,
					outreach_count: '0',
				}));
			return { rows, rowCount: rows.length };
		}

		// submitApplication: profile / skills / job / stripe lookups
		if (n.includes('total_score as omniscore')) {
			return {
				rows: [{ id: params[0], name: 'Cand One', email: 'cand1@test.com', omniscore: 71 }],
				rowCount: 1,
			};
		}
		if (n.includes('from candidate_skills')) return { rows: [], rowCount: 0 };
		if (n.includes('select stripe_subscription_id from users')) {
			return { rows: [{ stripe_subscription_id: null }], rowCount: 1 };
		}
		if (n.includes('select user_id from jobs where id')) {
			return { rows: [{ user_id: 77 }], rowCount: 1 };
		}
		if (n.includes('select * from jobs where id')) {
			return { rows: [{ ...JOB_ROW, id: Number(params[0]) }], rowCount: 1 };
		}
		if (n.includes('from auto_apply_profiles')) {
			return {
				rows: [{ user_id: params[0], profile_data: {}, is_active: true, gdpr_consent: true }],
				rowCount: 1,
			};
		}

		// Everything else (events, hiring_activity, analytics, notifications…)
		return { rows: [], rowCount: 0 };
	});
}

const candidateRoutes = require('../../../routes/candidate');
const recruiterRoutes = require('../../../routes/recruiter');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/candidate', candidateRoutes);
	app.use('/api/recruiter', recruiterRoutes);
	return app;
}

const asUser = (req, id) => req.set('x-test-user-id', String(id));

beforeAll(() => {
	global.__testUsers = {
		1: { id: 1, role: 'candidate', email: 'cand1@test.com' },
		2: { id: 2, role: 'candidate', email: 'cand2@test.com' },
		50: { id: 50, role: 'recruiter', email: 'rec@test.com', company_id: 9 },
	};
});

beforeEach(() => {
	jest.clearAllMocks();
	store.applications.clear();
	store.nextId = 100;
	installDbMock();
});

// ─── 1. Transition guard ────────────────────────────────────────────────────
describe('PUT /applications/:id/status — candidate transition guard (#820)', () => {
	const RECRUITER_OWNED = [
		'applied',
		'screening',
		'shortlisted',
		'reviewing',
		'interviewed',
		'offered',
		'hired',
		'rejected',
	];

	test.each(RECRUITER_OWNED)(
		'candidate → %s is 403 and the row is unchanged',
		async (status) => {
			seedApp({ status: 'screening' });
			const res = await asUser(
				request(makeApp()).put('/api/candidate/applications/1/status'),
				1,
			).send({ status });
			expect(res.status).toBe(403);
			expect(store.applications.get(1).status).toBe('screening');
		},
	);

	test('rejection-reversal sequence dies: recruiter rejects (200) → candidate offered/applied both 403, row stays rejected', async () => {
		seedApp({ status: 'screening' });
		const app = makeApp();

		const recRes = await asUser(request(app).put('/api/recruiter/applications/1'), 50).send({
			status: 'rejected',
		});
		expect(recRes.status).toBe(200);
		expect(store.applications.get(1).status).toBe('rejected');

		for (const attempt of ['offered', 'applied']) {
			const res = await asUser(
				request(app).put('/api/candidate/applications/1/status'),
				1,
			).send({ status: attempt });
			expect(res.status).toBe(403);
			expect(store.applications.get(1).status).toBe('rejected');
		}
	});

	test('candidate → withdrawn on a non-terminal application is 200 with the candidate-safe payload', async () => {
		seedApp({ status: 'screening' });
		const res = await asUser(request(makeApp()).put('/api/candidate/applications/1/status'), 1).send(
			{ status: 'withdrawn' },
		);
		expect(res.status).toBe(200);
		expect(store.applications.get(1).status).toBe('withdrawn');
		expect(Object.keys(res.body.application).sort()).toEqual(CANDIDATE_SAFE_KEYS);
	});

	test.each(['rejected', 'hired', 'withdrawn'])(
		'candidate → withdrawn on a terminal (%s) application is refused and unchanged',
		async (status) => {
			seedApp({ status });
			const res = await asUser(
				request(makeApp()).put('/api/candidate/applications/1/status'),
				1,
			).send({ status: 'withdrawn' });
			expect(res.status).toBe(400);
			expect(store.applications.get(1).status).toBe(status);
		},
	);

	test('invalid status value is still 400', async () => {
		seedApp({});
		const res = await asUser(request(makeApp()).put('/api/candidate/applications/1/status'), 1).send(
			{ status: 'bogus' },
		);
		expect(res.status).toBe(400);
	});

	test("another candidate's application is 404 and unchanged", async () => {
		seedApp({ status: 'applied' });
		const res = await asUser(request(makeApp()).put('/api/candidate/applications/1/status'), 2).send(
			{ status: 'withdrawn' },
		);
		expect(res.status).toBe(404);
		expect(store.applications.get(1).status).toBe('applied');
	});
});

// ─── 2. Withdraw endpoint ───────────────────────────────────────────────────
describe('PUT /applications/:id/withdraw (#820)', () => {
	test('non-terminal withdraw is 200 with exactly the candidate-safe payload', async () => {
		seedApp({ status: 'screening' });
		const res = await asUser(request(makeApp()).put('/api/candidate/applications/1/withdraw'), 1);
		expect(res.status).toBe(200);
		expect(res.body.application.status).toBe('withdrawn');
		expect(Object.keys(res.body.application).sort()).toEqual(CANDIDATE_SAFE_KEYS);
		expect(res.body.application).not.toHaveProperty('recruiter_notes');
		expect(res.body.application).not.toHaveProperty('screening_score');
	});

	test.each(['rejected', 'hired', 'withdrawn'])(
		'terminal (%s) withdraw is refused and unchanged',
		async (status) => {
			seedApp({ status });
			const res = await asUser(request(makeApp()).put('/api/candidate/applications/1/withdraw'), 1);
			expect(res.status).toBe(400);
			expect(store.applications.get(1).status).toBe(status);
		},
	);

	test("another candidate's application is 404", async () => {
		seedApp({});
		const res = await asUser(request(makeApp()).put('/api/candidate/applications/1/withdraw'), 2);
		expect(res.status).toBe(404);
	});
});

// ─── 3. Payload minimisation: GET list ──────────────────────────────────────
describe('GET /applications — candidate-safe projection (#820)', () => {
	test('list rows carry exactly the candidate-safe + job-basic keys, no recruiter-internal fields', async () => {
		seedApp({});
		const res = await asUser(request(makeApp()).get('/api/candidate/applications'), 1);
		expect(res.status).toBe(200);
		expect(res.body.applications).toHaveLength(1);
		const row = res.body.applications[0];
		expect(Object.keys(row).sort()).toEqual([...CANDIDATE_SAFE_KEYS, ...LIST_EXTRA_KEYS].sort());
		expect(row).not.toHaveProperty('recruiter_notes');
		expect(row).not.toHaveProperty('screening_score');
		expect(row).not.toHaveProperty('omniscore_at_apply');
		expect(row).not.toHaveProperty('resume_url');
		expect(row.title).toBe('Data Analyst');
		expect(row.status).toBe('applied');
	});
});

// ─── 4. Payload minimisation: apply + auto-apply ────────────────────────────
describe('apply via submitApplication — response projection, helper unaffected (#820)', () => {
	test('POST /jobs/:jobId/apply is 200, creates the row, and returns exactly the candidate-safe keys', async () => {
		const res = await asUser(request(makeApp()).post('/api/candidate/jobs/10/apply'), 1).send({
			cover_letter: 'Hello',
			screening_answers: {},
		});
		expect(res.status).toBe(200);
		expect(Object.keys(res.body.application).sort()).toEqual(CANDIDATE_SAFE_KEYS);
		expect(res.body.application).not.toHaveProperty('recruiter_notes');
		expect(res.body.application).not.toHaveProperty('screening_score');
		// Helper behaviour unchanged: the row exists in the store.
		const created = [...store.applications.values()].find((a) => Number(a.job_id) === 10);
		expect(created).toBeTruthy();
		expect(created.status).toBe('applied');
	});

	test('duplicate apply still 400 (helper guard unchanged)', async () => {
		seedApp({ job_id: 10 });
		const res = await asUser(request(makeApp()).post('/api/candidate/jobs/10/apply'), 1).send({
			cover_letter: 'Hello',
			screening_answers: {},
		});
		expect(res.status).toBe(400);
	});

	test('auto-apply path unaffected functionally (200, row created as auto_apply) and its response is candidate-safe', async () => {
		const res = await asUser(request(makeApp()).post('/api/candidate/applications/auto-apply'), 1).send(
			{ job_id: 11 },
		);
		expect(res.status).toBe(200);
		expect(res.body.application.applied_via).toBe('auto_apply');
		expect(res.body.application.is_auto_applied).toBe(true);
		expect(Object.keys(res.body.application).sort()).toEqual(CANDIDATE_SAFE_KEYS);
		const created = [...store.applications.values()].find((a) => a.job_id === 11);
		expect(created).toBeTruthy();
	});
});

// ─── 5. Recruiter side unchanged ────────────────────────────────────────────
describe('recruiter status endpoint — unchanged (#820)', () => {
	test.each(['screening', 'offered', 'hired'])(
		'recruiter → %s is 200, row updated, full row (incl. recruiter_notes) still returned',
		async (status) => {
			seedApp({ status: 'applied' });
			const res = await asUser(request(makeApp()).put('/api/recruiter/applications/1'), 50).send({
				status,
			});
			expect(res.status).toBe(200);
			expect(store.applications.get(1).status).toBe(status);
			expect(res.body.application).toHaveProperty('recruiter_notes');
		},
	);
});
