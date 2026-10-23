/**
 * #1731 Lane 2 (S-4/S-5/S-6/S-7) — score honesty, real-DB suite.
 *
 *  S-4 routes/public-api.js GET /api/v1/candidates:
 *      `COALESCE(os.total_score, ja.match_score, 0) as omniscore` substitutes
 *      a 0-100 match score for a missing 300-850 OmniScore and floors both-
 *      missing at a fabricated 0, exported to external API consumers.
 *      Honest: omniscore = measured OmniScore or NULL (+ omniscore_status);
 *      the match score is exposed under its own name `match_score`
 *      (+ match_score_status), never substituted.
 *  S-5 routes/recruiter.js GET /ai/rank-all/:jobId composite:
 *      `(COALESCE(os.total_score, 0) * 0.5 + COALESCE(ja.match_score, 50) * 0.5 * 8.5)`
 *      invents a mid-scale 50 for a missing match (worth 212.5 composite
 *      points) and a below-floor 0 for a missing OmniScore. Honest
 *      (panel §2.5, #1724 precedent): renormalise over measured components
 *      only — both measured: unchanged; omni only: composite = total_score;
 *      match only: composite = match_score * 8.5; neither: composite NULL,
 *      composite_status 'insufficient_data', sorted last, and the response
 *      accounts for them in `unranked_insufficient_data`.
 *  S-6 routes/recruiter.js GET /jobs/:id/ranked-candidates:
 *      `AND COALESCE(ja.match_score, 0) >= $2` makes NULL-match inclusion
 *      depend on a fabricated 0. Honest (panel §2.6): a NULL match is
 *      included exactly when no minimum was requested ($2 <= 0) and never
 *      passes a requested minimum.
 *  S-7 routes/recruiter.js POST /pipeline/auto-check/:jobId:
 *      `app.match_score || 0` above the #1717 skip guard silently judges a
 *      NULL match as 0. Honest (panel §2.7): when an applicable rule has
 *      auto_advance and match_score is NULL, the ADVANCE judgement is
 *      skipped with accounting — the same skipped-action shape with reason
 *      'Match score: insufficient data — automation not applied'. The
 *      match score feeds ONLY the advance conjunction; the auto-reject
 *      leg judges the (measured) OmniScore alone, so a COMBINED
 *      advance+reject rule must still reject on a measured OmniScore
 *      (fix round F-1, review adjudication §3): when the reject leg
 *      fires, the application is rejected with NO skipped action — a
 *      makeable judgement is never reported as un-makeable. Only when
 *      no reject fires is the advance skip accounted. Measured 0 is
 *      judged as before; auto-reject-only rules are untouched (they
 *      never consumed matchScore).
 *
 * Real-DB integration suite (Lane 1 / #1717 pattern): routes run against a
 * throwaway Postgres behind RECRUITER1731_LANE2_INTEGRATION_DB_URL; payloads
 * and post-action DB state are read back. Only auth / rbac / notify and
 * unrelated side-effect services are mocked. The public-api route uses its
 * REAL api-key middleware against a real api_keys row.
 *
 * Example:
 *   RECRUITER1731_LANE2_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55434/rekrut_1731_lane2_test' \
 *     npx jest server/__tests__/routes/recruiter-1731-lane2.test.js --forceExit
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

const crypto = require('node:crypto');
const request = require('supertest');
const express = require('express');

const DB_URL = process.env.RECRUITER1731_LANE2_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const API_KEY_PLAINTEXT = 'lane2-test-key';
const API_KEY_HASH = crypto.createHash('sha256').update(API_KEY_PLAINTEXT).digest('hex');

const SCHEMA_SQL = `
DROP TABLE IF EXISTS api_keys, pipeline_automation_rules, match_results, candidate_skills, job_applications, omni_scores, candidate_profiles, jobs, companies, users CASCADE;
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, avatar_url TEXT, role TEXT, company_id INTEGER);
CREATE TABLE companies (id INTEGER PRIMARY KEY, owner_id INTEGER, name TEXT, slug TEXT);
CREATE TABLE candidate_profiles (
  user_id INTEGER PRIMARY KEY, headline TEXT, location TEXT, years_experience INTEGER,
  phone TEXT, salary_min INTEGER, salary_max INTEGER, remote_preference TEXT);
CREATE TABLE jobs (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER, title TEXT, status TEXT DEFAULT 'active');
CREATE TABLE omni_scores (
  user_id INTEGER PRIMARY KEY, total_score INTEGER, score_tier TEXT,
  interview_score INTEGER, technical_score INTEGER, resume_score INTEGER, behavior_score INTEGER);
CREATE TABLE job_applications (
  id INTEGER PRIMARY KEY, job_id INTEGER, candidate_id INTEGER, company_id INTEGER,
  status TEXT, match_score INTEGER,
  applied_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
CREATE TABLE candidate_skills (user_id INTEGER, skill_name TEXT, level TEXT, category TEXT, is_verified BOOLEAN);
CREATE TABLE match_results (
  candidate_id INTEGER, job_id INTEGER, matching_skills JSONB, missing_skills JSONB,
  similarity_score NUMERIC, match_explanation TEXT);
CREATE TABLE pipeline_automation_rules (
  id SERIAL PRIMARY KEY, job_id INTEGER NOT NULL, recruiter_id INTEGER NOT NULL,
  from_stage VARCHAR(50) NOT NULL, to_stage VARCHAR(50) NOT NULL,
  auto_advance BOOLEAN DEFAULT false, omniscore_threshold INTEGER DEFAULT 600,
  match_score_threshold INTEGER DEFAULT 70,
  auto_reject BOOLEAN DEFAULT false, auto_reject_threshold INTEGER DEFAULT 400,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(job_id, recruiter_id, from_stage));
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY, name TEXT, scopes JSONB, rate_limit INTEGER,
  is_active BOOLEAN DEFAULT true, created_by INTEGER, key_hash TEXT, last_used_at TIMESTAMP);
`;

describeIfDb('#1731 Lane 2 — S-4/S-5/S-6/S-7 score honesty (real DB)', () => {
	let pool;
	let notifyUser;
	let app;

	// omni: 'no-row' | 'row-null' | measured integer total_score
	async function seedCandidate(id, omni, matchScore, jobId = 10) {
		await pool.query(
			`INSERT INTO users (id, name, email, role, company_id) VALUES ($1, $2, $3, 'candidate', 5)`,
			[id, `Candidate ${id}`, `candidate${id}@example.test`],
		);
		await pool.query(
			`INSERT INTO job_applications (id, job_id, candidate_id, company_id, status, match_score)
			 VALUES ($1, $2, $3, 5, 'applied', $4)`,
			[id, jobId, id, matchScore],
		);
		if (omni === 'row-null') {
			await pool.query(
				`INSERT INTO omni_scores (user_id, total_score, score_tier) VALUES ($1, NULL, NULL)`,
				[id],
			);
		} else if (typeof omni === 'number') {
			await pool.query(
				`INSERT INTO omni_scores (user_id, total_score, score_tier) VALUES ($1, $2, 'some_tier')`,
				[id, omni],
			);
		}
	}

	async function seedJob(id) {
		await pool.query(`INSERT INTO jobs (id, company_id, user_id, title) VALUES ($1, 5, 99, 'Job')`, [id]);
	}

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

	async function statusOf(id) {
		const r = await pool.query(`SELECT status FROM job_applications WHERE id = $1`, [id]);
		return r.rows[0].status;
	}

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		process.env.DISABLE_RATE_LIMIT = 'true';
		jest.resetModules();
		pool = require('../../../lib/db');
		notifyUser = require('../../../lib/notify').notifyUser;
		const recruiterRouter = require('../../../routes/recruiter');
		const publicApiRouter = require('../../../routes/public-api');
		app = express();
		app.use(express.json());
		app.use('/api/recruiter', recruiterRouter);
		app.use('/api/v1', publicApiRouter);
		await pool.query(SCHEMA_SQL);
		// API-key creator (user 99, company 5) + a real api_keys row.
		await pool.query(
			`INSERT INTO users (id, name, email, role, company_id) VALUES (99, 'Recruiter', 'recruiter@example.test', 'recruiter', 5)`,
		);
		await pool.query(
			`INSERT INTO api_keys (id, name, scopes, rate_limit, is_active, created_by, key_hash)
			 VALUES (1, 'lane2', '["candidates:read"]'::jsonb, 1000, true, 99, $1)`,
			[API_KEY_HASH],
		);
	}, 30000);

	afterAll(async () => {
		await pool.end();
	});

	beforeEach(async () => {
		jest.clearAllMocks();
		await pool.query(`DELETE FROM pipeline_automation_rules`);
		await pool.query(`DELETE FROM match_results`);
		await pool.query(`DELETE FROM candidate_skills`);
		await pool.query(`DELETE FROM job_applications`);
		await pool.query(`DELETE FROM omni_scores`);
		await pool.query(`DELETE FROM candidate_profiles`);
		await pool.query(`DELETE FROM jobs`);
		await pool.query(`DELETE FROM users WHERE id <> 99`);
	});

	// ── S-4 ──────────────────────────────────────────────────────
	async function getPublicCandidates() {
		const res = await request(app).get('/api/v1/candidates').set('X-API-Key', API_KEY_PLAINTEXT);
		expect(res.status).toBe(200);
		return res.body.candidates;
	}
	const pubById = (rows, id) => rows.find((c) => c.id === id);

	test('S-4: match-only candidate → omniscore null (not the match score), match_score under its own name', async () => {
		await seedCandidate(701, 'no-row', 90);
		const c = pubById(await getPublicCandidates(), 701);
		expect(c).toBeDefined();
		expect(c.omniscore).toBeNull();
		expect(c.omniscore_status).toBe('insufficient_data');
		expect(c.match_score).toBe(90);
		expect(c.match_score_status).toBe('measured');
	});

	test('S-4: both missing → omniscore null (not fabricated 0), match_score null', async () => {
		await seedCandidate(702, 'row-null', null);
		const c = pubById(await getPublicCandidates(), 702);
		expect(c.omniscore).toBeNull();
		expect(c.omniscore_status).toBe('insufficient_data');
		expect(c.match_score).toBeNull();
		expect(c.match_score_status).toBe('insufficient_data');
	});

	test('S-4: measured omni 640 + measured match 0 → both pass through as measured', async () => {
		await seedCandidate(703, 640, 0);
		const c = pubById(await getPublicCandidates(), 703);
		expect(c.omniscore).toBe(640);
		expect(c.omniscore_status).toBe('measured');
		expect(c.match_score).toBe(0);
		expect(c.match_score_status).toBe('measured');
	});

	// ── S-5 ──────────────────────────────────────────────────────
	async function getRankAll(jobId) {
		const res = await request(app).get(`/api/recruiter/ai/rank-all/${jobId}`);
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		return res.body;
	}

	test('S-5: renormalised composites, NULL composite sorts last and is accounted', async () => {
		await seedJob(20);
		await seedCandidate(711, 600, 40, 20); // both: 600*.5 + 40*8.5*.5 = 470
		await seedCandidate(712, 500, null, 20); // omni only: 500 (old: 250 + invented 212.5)
		await seedCandidate(713, 'no-row', 60, 20); // match only: 60*8.5 = 510 (old: 0 + 255)
		await seedCandidate(714, 'no-row', null, 20); // neither: NULL, last
		const body = await getRankAll(20);
		const rows = body.ranked_candidates;
		expect(rows.map((r) => r.candidate_id)).toEqual([713, 712, 711, 714]);
		const byCand = (id) => rows.find((r) => r.candidate_id === id);
		expect(byCand(711).composite_score).toBe(470);
		expect(byCand(711).composite_status).toBe('measured');
		expect(byCand(712).composite_score).toBe(500);
		expect(byCand(713).composite_score).toBe(510);
		const neither = byCand(714);
		expect(neither.composite_score).toBeNull();
		expect(neither.composite_status).toBe('insufficient_data');
		expect(neither.rank).toBe(4);
		expect(body.unranked_insufficient_data).toBe(1);
		expect(body.total).toBe(4);
	});

	test('S-5: measured-0 match is a measured component (composite from both, not renormalised away)', async () => {
		await seedJob(21);
		await seedCandidate(715, 400, 0, 21); // both measured: 400*.5 + 0 = 200
		const body = await getRankAll(21);
		const row = body.ranked_candidates.find((r) => r.candidate_id === 715);
		expect(row.composite_score).toBe(200);
		expect(row.composite_status).toBe('measured');
		expect(body.unranked_insufficient_data).toBe(0);
	});

	// ── S-6 ──────────────────────────────────────────────────────
	async function getRanked(jobId, query = '') {
		const res = await request(app).get(`/api/recruiter/jobs/${jobId}/ranked-candidates${query}`);
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		return res.body.candidates.map((c) => c.candidate_id);
	}

	test('S-6: no minimum requested → NULL-match candidate is included', async () => {
		await seedJob(30);
		await seedCandidate(721, 'no-row', null, 30);
		await seedCandidate(722, 'no-row', 50, 30);
		expect((await getRanked(30)).sort()).toEqual([721, 722]);
	});

	test('S-6: min_score=50 requested → NULL-match excluded, measured 50 + 80 included, measured 30 excluded', async () => {
		await seedJob(31);
		await seedCandidate(723, 'no-row', null, 31);
		await seedCandidate(724, 'no-row', 50, 31);
		await seedCandidate(725, 'no-row', 80, 31);
		await seedCandidate(726, 'no-row', 30, 31);
		expect((await getRanked(31, '?min_score=50')).sort()).toEqual([724, 725]);
	});

	test('S-6: min_score=0 explicitly → measured 0 included and NULL-match included', async () => {
		await seedJob(32);
		await seedCandidate(727, 'no-row', 0, 32);
		await seedCandidate(728, 'no-row', null, 32);
		expect((await getRanked(32, '?min_score=0')).sort()).toEqual([727, 728]);
	});

	// ── S-7 ──────────────────────────────────────────────────────
	async function postAutoCheck(jobId) {
		const res = await request(app).post(`/api/recruiter/pipeline/auto-check/${jobId}`);
		expect(res.status).toBe(200);
		return res.body;
	}

	test('S-7: NULL match + auto_advance rule (threshold 0) → skipped with Match-score reason, NOT advanced', async () => {
		await seedJob(40);
		await seedRule(40, { auto_advance: true, omniscore_threshold: 600, match_score_threshold: 0 });
		await seedCandidate(731, 700, null, 40);
		const body = await postAutoCheck(40);
		expect(await statusOf(731)).toBe('applied');
		const skipped = body.actions.filter((a) => a.type === 'skipped');
		expect(skipped).toHaveLength(1);
		expect(skipped[0].application_id).toBe(731);
		expect(skipped[0].reason).toBe('Match score: insufficient data — automation not applied');
		expect(body.skipped_insufficient_data).toBe(1);
		expect(body.actions.filter((a) => a.type === 'advanced')).toHaveLength(0);
	});

	test('S-7: measured-0 match judged as before — advances when rule threshold is 0', async () => {
		await seedJob(41);
		await seedRule(41, { auto_advance: true, omniscore_threshold: 600, match_score_threshold: 0 });
		await seedCandidate(732, 700, 0, 41);
		const body = await postAutoCheck(41);
		expect(await statusOf(732)).toBe('screening');
		expect(body.actions.filter((a) => a.type === 'advanced')).toHaveLength(1);
		expect(body.actions.filter((a) => a.type === 'skipped')).toHaveLength(0);
	});

	test('S-7: measured-0 match judged as before — does not advance when threshold is 70, and is NOT skipped', async () => {
		await seedJob(42);
		await seedRule(42, { auto_advance: true, omniscore_threshold: 600, match_score_threshold: 70 });
		await seedCandidate(733, 700, 0, 42);
		const body = await postAutoCheck(42);
		expect(await statusOf(733)).toBe('applied');
		expect(body.actions).toHaveLength(0);
	});

	test('S-7: NULL match + auto-reject-only rule → rejected on measured OmniScore exactly as before, no skip', async () => {
		await seedJob(43);
		await seedRule(43, { auto_reject: true, auto_reject_threshold: 400 });
		await seedCandidate(734, 100, null, 43);
		const body = await postAutoCheck(43);
		expect(await statusOf(734)).toBe('rejected');
		expect(body.actions.filter((a) => a.type === 'rejected')).toHaveLength(1);
		expect(body.actions.filter((a) => a.type === 'skipped')).toHaveLength(0);
		expect(notifyUser).toHaveBeenCalledTimes(1);
	});

	test('S-7 (F-1): NULL match + advance+reject rule + measured OmniScore below reject threshold → rejected, NO skipped action', async () => {
		// Discriminating test for the F-1 fix round (review §2/§3). The
		// match score feeds only the advance conjunction; the reject leg's
		// sole input (OmniScore 100) IS measured, so the reject judgement
		// can and must be made: status rejected (read back from the DB),
		// exactly one rejected action, NO skipped action for this
		// application, exactly one notification. On the pre-fix branch
		// (e3d74e8b0) the match skip's `continue` suppressed the reject leg
		// entirely — status stayed 'applied' with a skipped action.
		await seedJob(44);
		await seedRule(44, {
			auto_advance: true,
			omniscore_threshold: 600,
			match_score_threshold: 70,
			auto_reject: true,
			auto_reject_threshold: 400,
		});
		await seedCandidate(735, 100, null, 44);
		const body = await postAutoCheck(44);
		expect(await statusOf(735)).toBe('rejected');
		expect(body.actions.filter((a) => a.type === 'rejected')).toHaveLength(1);
		expect(body.actions.filter((a) => a.type === 'rejected')[0].application_id).toBe(735);
		expect(body.actions.filter((a) => a.type === 'skipped')).toHaveLength(0);
		expect(body.skipped_insufficient_data).toBe(0);
		expect(body.actions.filter((a) => a.type === 'advanced')).toHaveLength(0);
		expect(notifyUser).toHaveBeenCalledTimes(1);
	});

	test('S-7 (F-1): NULL match + advance+reject rule + OmniScore NOT below reject threshold → advance skip accounted, not rejected', async () => {
		// Companion guard: when the reject leg judges and does NOT fire
		// (OmniScore 700 >= 400), the deferred advance skip is accounted
		// exactly as the advance-only case — the application is neither
		// advanced (match unmeasured) nor rejected, and nobody is notified.
		await seedJob(46);
		await seedRule(46, {
			auto_advance: true,
			omniscore_threshold: 600,
			match_score_threshold: 70,
			auto_reject: true,
			auto_reject_threshold: 400,
		});
		await seedCandidate(737, 700, null, 46);
		const body = await postAutoCheck(46);
		expect(await statusOf(737)).toBe('applied');
		const skipped = body.actions.filter((a) => a.type === 'skipped');
		expect(skipped).toHaveLength(1);
		expect(skipped[0].application_id).toBe(737);
		expect(skipped[0].reason).toBe('Match score: insufficient data — automation not applied');
		expect(body.skipped_insufficient_data).toBe(1);
		expect(body.actions.filter((a) => a.type === 'rejected')).toHaveLength(0);
		expect(body.actions.filter((a) => a.type === 'advanced')).toHaveLength(0);
		expect(notifyUser).not.toHaveBeenCalled();
	});

	test('S-7 control: measured match 90 + measured omni 700 advances as before', async () => {
		await seedJob(45);
		await seedRule(45, { auto_advance: true, omniscore_threshold: 600, match_score_threshold: 70 });
		await seedCandidate(736, 700, 90, 45);
		const body = await postAutoCheck(45);
		expect(await statusOf(736)).toBe('screening');
		expect(body.actions.filter((a) => a.type === 'advanced')).toHaveLength(1);
	});
});
