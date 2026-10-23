/**
 * #1717 Site C — pipeline auto-check (routes/recruiter.js, POST
 * /pipeline/auto-check/:jobId) re-fabricates a 300 OmniScore via
 * `app.omniscore || 300` and judges real applications on it:
 * under the DEFAULT auto_reject_threshold (400, migration 038) a
 * no-data candidate is auto-rejected today, and under any configured
 * advance threshold ≤ 300 they can be auto-advanced.
 *
 * Panel position (DISCUSSION.md §3): (c) only — hard exclusion. When
 * `app.omniscore` is NULL the application is skipped by BOTH branches:
 * no status UPDATE, no notification, and the skip is accounted for in
 * the response `actions` with an insufficient-data reason. A genuinely
 * measured value — including a measured 0 — is judged exactly as today.
 *
 * Real-DB integration suite (legal-hold-db precedent): the route runs
 * against a throwaway Postgres behind MATCHING1717_INTEGRATION_DB_URL;
 * application status is read back from the DB after each POST. Only
 * auth / rbac / notify and unrelated side-effect services are mocked
 * (the repo's standard route-test pattern) — notifyUser is the seam
 * asserted for "no rejection notification was sent".
 *
 * Example:
 *   MATCHING1717_INTEGRATION_DB_URL='postgresql://root@/rekrut_1717_test?host=/var/run/postgresql' \
 *     npx jest server/__tests__/routes/recruiter-pipeline-auto-check-1717.test.js --forceExit
 */
jest.unmock('../../../lib/db');

jest.mock('../../../lib/auth', () => {
	const passthrough = (_req, _res, next) => next();
	const authMiddleware = jest.fn((req, _res, next) => {
		req.user = { id: 99, role: 'recruiter', company_id: 5 };
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
jest.mock('../../../middleware/rbac', () => ({
	requirePermission: () => (_req, _res, next) => next(),
}));
jest.mock('../../../services/trustscore', () => ({
	updateHiringRatioScore: jest.fn().mockResolvedValue(true),
	calculateTrustScore: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn().mockResolvedValue(1),
}));
jest.mock('../../../lib/email-service', () => ({
	sendTemplatedEmail: jest.fn().mockResolvedValue({}),
	sendCustomEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../services/auditLogService', () => ({
	EVENT_TYPES: {
		AI_DECISION: 'ai_decision',
		HUMAN_OVERRIDE: 'human_override',
		DATA_ACCESS: 'data_access',
		VERIFICATION: 'verification',
		SIGNATURE: 'signature',
		STATUS_CHANGE: 'status_change',
	},
	ENTITY_TYPES: { CANDIDATE: 'candidate', JOB: 'job', COMPANY: 'company', USER: 'user' },
	logEvent: jest.fn().mockResolvedValue(undefined),
	AuditLogger: { log: jest.fn().mockResolvedValue(undefined) },
}));

const request = require('supertest');
const express = require('express');

const DB_URL = process.env.MATCHING1717_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const SCHEMA_SQL = `
DROP TABLE IF EXISTS pipeline_automation_rules, job_applications, omni_scores, jobs, companies, users CASCADE;
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, role TEXT, company_id INTEGER);
CREATE TABLE companies (id INTEGER PRIMARY KEY, owner_id INTEGER, name TEXT, slug TEXT);
CREATE TABLE jobs (id INTEGER PRIMARY KEY, company_id INTEGER, title TEXT, status TEXT DEFAULT 'active');
CREATE TABLE omni_scores (user_id INTEGER PRIMARY KEY, total_score INTEGER, score_tier TEXT);
CREATE TABLE job_applications (
  id INTEGER PRIMARY KEY, job_id INTEGER, candidate_id INTEGER, company_id INTEGER,
  status TEXT, match_score INTEGER,
  applied_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
-- pipeline_automation_rules: migration 038 column shape/defaults (FKs omitted).
CREATE TABLE pipeline_automation_rules (
  id SERIAL PRIMARY KEY, job_id INTEGER NOT NULL, recruiter_id INTEGER NOT NULL,
  from_stage VARCHAR(50) NOT NULL, to_stage VARCHAR(50) NOT NULL,
  auto_advance BOOLEAN DEFAULT false, omniscore_threshold INTEGER DEFAULT 600,
  match_score_threshold INTEGER DEFAULT 70,
  auto_reject BOOLEAN DEFAULT false, auto_reject_threshold INTEGER DEFAULT 400,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(job_id, recruiter_id, from_stage));
`;

describeIfDb('#1717 Site C — pipeline auto-check NULL OmniScore skip (real DB)', () => {
	let pool;
	let notifyUser;
	let app;

	async function seedRule(jobId, rule) {
		await pool.query(
			`INSERT INTO pipeline_automation_rules
			   (job_id, recruiter_id, from_stage, to_stage, auto_advance, omniscore_threshold,
			    match_score_threshold, auto_reject, auto_reject_threshold)
			 VALUES ($1, 99, 'applied', 'screening', $2, $3, $4, $5, $6)`,
			[
				jobId,
				!!rule.auto_advance,
				rule.omniscore_threshold ?? 600,
				rule.match_score_threshold ?? 70,
				!!rule.auto_reject,
				rule.auto_reject_threshold ?? 400,
			],
		);
	}

	async function seedApplication(id, jobId, candidateId, omni, matchScore = 90) {
		await pool.query(
			`INSERT INTO job_applications (id, job_id, candidate_id, company_id, status, match_score)
			 VALUES ($1, $2, $3, 5, 'applied', $4)`,
			[id, jobId, candidateId, matchScore],
		);
		if (omni === 'row-null') {
			await pool.query(
				`INSERT INTO omni_scores (user_id, total_score, score_tier) VALUES ($1, NULL, NULL)`,
				[candidateId],
			);
		} else if (typeof omni === 'number') {
			await pool.query(
				`INSERT INTO omni_scores (user_id, total_score, score_tier) VALUES ($1, $2, 'some_tier')`,
				[candidateId, omni],
			);
		}
	}

	async function statusOf(id) {
		const r = await pool.query(`SELECT status FROM job_applications WHERE id = $1`, [id]);
		return r.rows[0].status;
	}

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		jest.resetModules();
		pool = require('../../../lib/db');
		notifyUser = require('../../../lib/notify').notifyUser;
		const recruiterRouter = require('../../../routes/recruiter');
		app = express();
		app.use(express.json());
		app.use('/api/recruiter', recruiterRouter);
		await pool.query(SCHEMA_SQL);
	}, 30000);

	afterAll(async () => {
		await pool.end();
	});

	beforeEach(async () => {
		jest.clearAllMocks();
		await pool.query(`DELETE FROM pipeline_automation_rules`);
		await pool.query(`DELETE FROM job_applications`);
		await pool.query(`DELETE FROM omni_scores`);
		await pool.query(`DELETE FROM jobs`);
	});

	test('NULL candidate (no row) with auto_reject=true / threshold 400 is NOT rejected, not notified, skip accounted', async () => {
		await pool.query(`INSERT INTO jobs (id, company_id, title) VALUES (10, 5, 'Job')`);
		await seedRule(10, { auto_reject: true, auto_reject_threshold: 400 });
		await seedApplication(1, 10, 501, 'no-row');
		const res = await request(app).post('/api/recruiter/pipeline/auto-check/10');
		expect(res.status).toBe(200);
		expect(await statusOf(1)).toBe('applied');
		expect(notifyUser).not.toHaveBeenCalled();
		const skipped = res.body.actions.filter((a) => a.type === 'skipped');
		expect(skipped).toHaveLength(1);
		expect(skipped[0].application_id).toBe(1);
		expect(skipped[0].reason).toMatch(/insufficient data/i);
		expect(res.body.skipped_insufficient_data).toBe(1);
	});

	test('NULL-total candidate with auto_reject=true / threshold 400 is NOT rejected', async () => {
		await pool.query(`INSERT INTO jobs (id, company_id, title) VALUES (10, 5, 'Job')`);
		await seedRule(10, { auto_reject: true, auto_reject_threshold: 400 });
		await seedApplication(1, 10, 502, 'row-null');
		const res = await request(app).post('/api/recruiter/pipeline/auto-check/10');
		expect(res.status).toBe(200);
		expect(await statusOf(1)).toBe('applied');
		expect(notifyUser).not.toHaveBeenCalled();
		expect(res.body.actions.filter((a) => a.type === 'skipped')).toHaveLength(1);
	});

	test('NULL candidate with auto_advance=true / threshold 200 is NOT advanced, skip accounted', async () => {
		await pool.query(`INSERT INTO jobs (id, company_id, title) VALUES (11, 5, 'Job')`);
		await seedRule(11, {
			auto_advance: true,
			omniscore_threshold: 200,
			match_score_threshold: 70,
		});
		await seedApplication(2, 11, 503, 'no-row', 90);
		const res = await request(app).post('/api/recruiter/pipeline/auto-check/11');
		expect(res.status).toBe(200);
		expect(await statusOf(2)).toBe('applied');
		expect(notifyUser).not.toHaveBeenCalled();
		const skipped = res.body.actions.filter((a) => a.type === 'skipped');
		expect(skipped).toHaveLength(1);
		expect(skipped[0].application_id).toBe(2);
		expect(skipped[0].reason).toMatch(/insufficient data/i);
	});

	test('controls: measured 700 advances at 600, measured 100 rejects at 400, measured 0 judged as 0', async () => {
		await pool.query(`INSERT INTO jobs (id, company_id, title) VALUES (12, 5, 'Job')`);
		await seedRule(12, {
			auto_advance: true,
			omniscore_threshold: 600,
			match_score_threshold: 70,
			auto_reject: true,
			auto_reject_threshold: 400,
		});
		await seedApplication(3, 12, 504, 700, 90);
		await seedApplication(4, 12, 505, 100, 90);
		await seedApplication(5, 12, 506, 0, 90);
		const res = await request(app).post('/api/recruiter/pipeline/auto-check/12');
		expect(res.status).toBe(200);
		expect(await statusOf(3)).toBe('screening');
		expect(await statusOf(4)).toBe('rejected');
		// Measured 0 is judged as 0 (< 400) — rejected, NOT skipped.
		expect(await statusOf(5)).toBe('rejected');
		expect(res.body.actions.filter((a) => a.type === 'skipped')).toHaveLength(0);
		expect(res.body.actions.filter((a) => a.type === 'advanced')).toHaveLength(1);
		expect(res.body.actions.filter((a) => a.type === 'rejected')).toHaveLength(2);
		// Rejection notifications only for the two measured rejects.
		expect(notifyUser).toHaveBeenCalledTimes(2);
	});
});
