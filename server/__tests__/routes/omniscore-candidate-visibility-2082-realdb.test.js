/**
 * #2082 — GET /api/omniscore/candidate/:candidateId (and the recruiter
 * leaderboard) must obey the candidate's Public-profile switch with
 * DISCOVERY semantics (#416): a candidate is hidden only on an explicit
 * profile_visible='false' in user_settings.privacy, or when
 * soft-deleted. Absent settings row / absent key = visible (the product
 * default is ON). This is deliberately DIFFERENT from the #1391
 * analysis gate (fail-closed, job-scoped applicant exception): this
 * endpoint carries no job context, so no applicant exception applies.
 *
 * Denial: 404 {error:'Candidate not found'}, audit-logged with the
 * distinct actionType 'candidate_visibility_denied' (metadata:
 * candidate_id, endpoint, reason only — no email, no score), and ZERO
 * writes — the gate runs before getOrCreateScore/calculateScore, so a
 * denied read must not create or recompute an omni_scores row.
 *
 * HL-003 user-journey E2E: real HTTP against the REAL router
 * (routes/omniscore.js), real auth, real AuditLogger, on a
 * fresh-install Postgres built ONLY by `node migrate.js`.
 *
 * Journey (as a recruiter would live it):
 *   1. private candidate (switch OFF) opened by id -> 404 + audit row
 *      + no omni_scores row created
 *   2. public candidate (switch ON) opened by id -> 200
 *   3. candidate who never touched settings -> 200 (discovery default)
 *   4. settings row present but key absent -> 200
 *   5. private candidate who applied to the recruiter's job, opened
 *      with NO job context -> 404 (the #1391 exception stays on the
 *      job-scoped surfaces; it does not leak here)
 *   6. soft-deleted candidate -> 404
 *   7. leaderboard: private candidate absent from the list AND from
 *      the tier distribution counts; public candidate present
 *   8. non-recruiter role -> 403 preserved
 *
 * Rig (this run): PostgreSQL 18 at 127.0.0.1:55442; DB `rekrut_2082`
 * created empty and built only by migrate.js (exit 0). Fixture ids
 * derive from a per-run RUN_BASE so the suite is re-runnable.
 *
 * Example:
 *   OMNISCORE2082_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55442/rekrut_2082' \
 *     npx jest server/__tests__/routes/omniscore-candidate-visibility-2082-realdb.test.js --runInBand --forceExit
 */
jest.unmock('../../../lib/db');

// Infrastructure/AI boundaries only (same stubs as the #1787 omniscore
// real-DB suite) — the gate behaviour (DB reads, audit writes, score
// writes) is exercised for real, never mocked.
jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(async () => ''),
	parseResume: jest.fn(),
	generateSkillAssessment: jest.fn(),
	evaluateSkillAssessment: jest.fn(),
	generateJobMatchScore: jest.fn(),
	generateInterviewCoaching: jest.fn(),
}));
jest.mock('../../../services/memory-service', () => ({}));
jest.mock('../../../services/autofill-service', () => ({}));

const { Pool } = require('pg');

const DB_URL = process.env.OMNISCORE2082_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(180000);

const RUN_BASE = 4000000 + Math.floor(Math.random() * 9000) * 100;
const CO = RUN_BASE + 1;
const R = RUN_BASE + 2; // recruiter (company CO)
const C_PUB = RUN_BASE + 3; // profile_visible = true
const C_PRIV = RUN_BASE + 4; // profile_visible = false, NO omni row
const C_NONE = RUN_BASE + 5; // no user_settings row at all (visible)
const C_KEYABSENT = RUN_BASE + 6; // settings row, key absent (visible)
const C_PRIV_APP = RUN_BASE + 7; // profile_visible = false; applied to J1
const C_DEL = RUN_BASE + 8; // profile_visible = true but soft-deleted
const C_PUB_LB = RUN_BASE + 9; // public, omni row (leaderboard)
const C_PRIV_LB = RUN_BASE + 10; // private, omni row (leaderboard)
const J1 = RUN_BASE + 21; // job (company CO) C_PRIV_APP applied to
const APP1 = RUN_BASE + 31; // C_PRIV_APP -> J1 application
const LB_TIER = 'gold';

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

describeIfDb('#2082 omniscore candidate visibility gate — real DB (recruiter journey)', () => {
	let request;
	let app;
	let token;
	let candidateToken;

	const get = (path, tok) =>
		request(app)
			.get(path)
			.set('Authorization', `Bearer ${tok || token}`);

	async function count(sql, params) {
		const { rows } = await seedPool.query(sql, params);
		return parseInt(rows[0].c, 10);
	}
	const omniRows = (cand) =>
		count('SELECT COUNT(*)::int AS c FROM omni_scores WHERE user_id = $1', [cand]);
	const denialLogs = (cand) =>
		count(
			"SELECT COUNT(*)::int AS c FROM audit_logs WHERE action_type = 'candidate_visibility_denied' AND target_id = $1",
			[cand],
		);

	beforeAll(async () => {
		Object.assign(process.env, { DATABASE_URL: DB_URL });

		const CANDS = [C_PUB, C_PRIV, C_NONE, C_KEYABSENT, C_PRIV_APP, C_DEL, C_PUB_LB, C_PRIV_LB];
		// Clean any prior run with these ids (children first).
		await seedPool.query('DELETE FROM audit_logs WHERE user_id = $1', [R]);
		await seedPool.query('DELETE FROM job_applications WHERE candidate_id = ANY($1)', [CANDS]);
		await seedPool.query('DELETE FROM omni_scores WHERE user_id = ANY($1)', [CANDS]);
		await seedPool.query('DELETE FROM jobs WHERE id = $1', [J1]);
		await seedPool.query('DELETE FROM users WHERE id = ANY($1)', [[R, ...CANDS]]);
		await seedPool.query('DELETE FROM companies WHERE id = $1', [CO]);

		await seedPool.query('INSERT INTO companies (id, name) VALUES ($1, $2)', [CO, 'Gate Co 2082']);
		await seedPool.query(
			`INSERT INTO users (id, email, password_hash, name, role, company_id)
			 VALUES ($1, $2, 'x', 'Recruiter 2082', 'recruiter', $3)`,
			[R, `rec${RUN_BASE}@test.local`, CO],
		);
		const candSeed = async (id, label, privacy, { deleted = false } = {}) => {
			await seedPool.query(
				`INSERT INTO users (id, email, password_hash, name, role, deleted_at)
				 VALUES ($1, $2, 'x', $3, 'candidate', $4)`,
				[id, `cand${id}@test.local`, label, deleted ? new Date() : null],
			);
			await seedPool.query(
				`INSERT INTO candidate_profiles (user_id, headline, years_experience)
				 VALUES ($1, 'Engineer', 5)`,
				[id],
			);
			if (privacy !== null) {
				await seedPool.query(`INSERT INTO user_settings (user_id, privacy) VALUES ($1, $2)`, [
					id,
					JSON.stringify(privacy),
				]);
			}
		};
		await candSeed(C_PUB, 'Public Candidate', { profile_visible: true });
		await candSeed(C_PRIV, 'Private Candidate', { profile_visible: false });
		await candSeed(C_NONE, 'No Settings Candidate', null);
		await candSeed(C_KEYABSENT, 'Key Absent Candidate', { allow_messages: true });
		await candSeed(C_PRIV_APP, 'Private Applicant', { profile_visible: false });
		await candSeed(C_DEL, 'Soft Deleted Candidate', { profile_visible: true }, { deleted: true });
		await candSeed(C_PUB_LB, 'Public Leaderboard', { profile_visible: true });
		await candSeed(C_PRIV_LB, 'Private Leaderboard', { profile_visible: false });

		// Leaderboard fixtures: writer-shaped omni rows, same tier, so the
		// distribution count is an exact, checkable number.
		for (const [id, total] of [
			[C_PUB_LB, 750],
			[C_PRIV_LB, 760],
		]) {
			await seedPool.query(
				'INSERT INTO omni_scores (user_id, total_score, score_tier, version) VALUES ($1, $2, $3, 2)',
				[id, total, LB_TIER],
			);
		}

		await seedPool.query(
			`INSERT INTO jobs (id, user_id, company_id, title, description, status, skills_required)
			 VALUES ($1, $2, $3, 'Applied Job', 'desc', 'active', '["React"]'::jsonb)`,
			[J1, R, CO],
		);
		await seedPool.query(
			`INSERT INTO job_applications (id, candidate_id, job_id, company_id, status)
			 VALUES ($1, $2, $3, $4, 'applied')`,
			[APP1, C_PRIV_APP, J1, CO],
		);

		const express = require('express');
		request = require('supertest');
		const { generateToken } = require('../../../lib/auth');
		token = generateToken({ id: R, email: `rec${RUN_BASE}@test.local`, role: 'recruiter' });
		candidateToken = generateToken({
			id: C_PUB,
			email: `cand${C_PUB}@test.local`,
			role: 'candidate',
		});
		app = express();
		app.use(express.json({ limit: '10mb' }));
		app.use('/api/omniscore', require('../../../routes/omniscore'));
	}, 60000);

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	// ── Denials first, so "no writes" is proven on a clean slate ──────
	test('1. private (explicit OFF) by id -> 404, denial audit-logged with minimal metadata, NO omni_scores row created', async () => {
		expect(await omniRows(C_PRIV)).toBe(0);
		const res = await get(`/api/omniscore/candidate/${C_PRIV}`);
		expect(res.status).toBe(404);
		expect(res.body.error).toBe('Candidate not found');
		expect(await omniRows(C_PRIV)).toBe(0);
		expect(await denialLogs(C_PRIV)).toBeGreaterThanOrEqual(1);
		const { rows } = await seedPool.query(
			"SELECT metadata FROM audit_logs WHERE action_type = 'candidate_visibility_denied' AND target_id = $1 ORDER BY id DESC LIMIT 1",
			[C_PRIV],
		);
		const md = rows[0].metadata;
		expect(Number(md.candidate_id)).toBe(C_PRIV);
		expect(String(md.endpoint)).toContain('candidate');
		expect(md.reason).toBeTruthy();
		// Minimal metadata: no email, no score anywhere in the payload.
		expect(JSON.stringify(md)).not.toContain('@test.local');
		expect(md).not.toHaveProperty('email');
		expect(md).not.toHaveProperty('score');
	});

	test('5. private applicant (applied to the recruiter’s job) with NO job context -> 404, no omni_scores row created', async () => {
		expect(await omniRows(C_PRIV_APP)).toBe(0);
		const res = await get(`/api/omniscore/candidate/${C_PRIV_APP}`);
		expect(res.status).toBe(404);
		expect(await omniRows(C_PRIV_APP)).toBe(0);
		expect(await denialLogs(C_PRIV_APP)).toBeGreaterThanOrEqual(1);
	});

	test('6. soft-deleted candidate (switch ON) by id -> 404', async () => {
		const res = await get(`/api/omniscore/candidate/${C_DEL}`);
		expect(res.status).toBe(404);
	});

	// ── Allowed reads (discovery semantics) ───────────────────────────
	test('2. public (explicit ON) by id -> 200 with candidate + score', async () => {
		const res = await get(`/api/omniscore/candidate/${C_PUB}`);
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.candidate.email).toBe(`cand${C_PUB}@test.local`);
	});

	test('3. never-touched settings (no user_settings row) by id -> 200', async () => {
		const res = await get(`/api/omniscore/candidate/${C_NONE}`);
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	test('4. settings row present but profile_visible key absent by id -> 200', async () => {
		const res = await get(`/api/omniscore/candidate/${C_KEYABSENT}`);
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	// ── Leaderboard ───────────────────────────────────────────────────
	test('7. leaderboard excludes the private candidate from the list AND the distribution counts, includes the public one', async () => {
		// Ground truth from the seeds themselves.
		const totalWithTier = await count(
			`SELECT COUNT(*)::int AS c FROM omni_scores os JOIN users u ON u.id = os.user_id
			 WHERE u.role = 'candidate' AND os.score_tier = $1`,
			[LB_TIER],
		);
		const privateWithTier = await count(
			`SELECT COUNT(*)::int AS c FROM omni_scores os JOIN users u ON u.id = os.user_id
			 WHERE u.role = 'candidate' AND os.score_tier = $1
			   AND EXISTS (SELECT 1 FROM user_settings us WHERE us.user_id = u.id
			               AND us.privacy->>'profile_visible' = 'false')`,
			[LB_TIER],
		);
		expect(privateWithTier).toBeGreaterThanOrEqual(1);

		const res = await get('/api/omniscore/leaderboard');
		expect(res.status).toBe(200);
		const ids = res.body.candidates.map((c) => c.user_id);
		expect(ids).toContain(C_PUB_LB);
		expect(ids).not.toContain(C_PRIV_LB);
		const dist = res.body.distribution.find(
			(d) => d.score_tier === 'excellent' || d.score_tier === LB_TIER,
		);
		expect(dist).toBeTruthy();
		expect(parseInt(dist.count, 10)).toBe(totalWithTier - privateWithTier);
	});

	// ── Role gate preserved ───────────────────────────────────────────
	test('8. non-recruiter role -> 403 on /candidate/:id', async () => {
		const res = await get(`/api/omniscore/candidate/${C_PUB}`, candidateToken);
		expect(res.status).toBe(403);
	});
});
