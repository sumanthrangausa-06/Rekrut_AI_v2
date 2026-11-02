/**
 * #2083 — GET /api/omniscore/leaderboard must return an explicit field
 * allowlist, not the full omni_scores row. The recruiter ranking screen
 * (client/src/pages/recruiter/omniscore.tsx, CandidateRow) displays
 * exactly: user_id, total_score, score_tier, interview_score,
 * technical_score, resume_score, behavior_score, name, email,
 * avatar_url, headline, location, years_experience, applications_count.
 * Internal evaluative data — fraud_signals, factor_scores,
 * peer_percentile, last_checkin_at, version, row id, timestamps — must
 * never reach the list response.
 *
 * HL-003 user-journey E2E (Quinn + Recruiter persona): real HTTP
 * against the REAL router (routes/omniscore.js), real auth, on a
 * fresh-install Postgres built ONLY by `node migrate.js`.
 *
 * Journey (as a recruiter would live it):
 *   1. public candidate appears with EXACTLY the allowlisted keys and
 *      the values the screen renders (tier shown as its API label)
 *   2. no leaked key and no seeded sentinel value appears anywhere in
 *      the candidates payload
 *   3. private candidate (Public-profile switch OFF) still absent —
 *      the #2082 discovery predicate is intact
 *   4. non-recruiter role -> 403 preserved
 *
 * Rig: PostgreSQL 18 at 127.0.0.1:55442; DB `rekrut_2083` created
 * empty and built only by migrate.js (exit 0). Fixture ids derive
 * from a per-run RUN_BASE so the suite is re-runnable.
 *
 * Example:
 *   OMNISCORE2083_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55442/rekrut_2083' \
 *     npx jest server/__tests__/routes/omniscore-leaderboard-allowlist-2083-realdb.test.js --runInBand --forceExit
 */
jest.unmock('../../../lib/db');

// Infrastructure/AI boundaries only (same stubs as the #2082 suite) —
// the leaderboard query behaviour is exercised for real, never mocked.
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

const DB_URL = process.env.OMNISCORE2083_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(180000);

const RUN_BASE = 5000000 + Math.floor(Math.random() * 9000) * 100;
const CO = RUN_BASE + 1;
const R = RUN_BASE + 2; // recruiter (company CO)
const C_PUB = RUN_BASE + 3; // profile_visible = true, rich omni row
const C_PRIV = RUN_BASE + 4; // profile_visible = false, omni row
const TIER_DB = 'gold'; // stored metal; API label is 'excellent'
const FRAUD_SENTINEL = 'FRAUD_SENTINEL_2083';
const FACTOR_SENTINEL = 987123;

const ALLOWLIST_KEYS = [
	'applications_count',
	'avatar_url',
	'behavior_score',
	'email',
	'headline',
	'interview_score',
	'location',
	'name',
	'resume_score',
	'score_tier',
	'technical_score',
	'total_score',
	'user_id',
	'years_experience',
];
const LEAKED_KEYS = [
	'id',
	'factor_scores',
	'peer_percentile',
	'fraud_signals',
	'last_checkin_at',
	'version',
	'last_updated',
	'created_at',
];

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

describeIfDb('#2083 omniscore leaderboard allowlist — real DB (recruiter journey)', () => {
	let request;
	let app;
	let token;
	let candidateToken;

	const get = (path, tok) =>
		request(app)
			.get(path)
			.set('Authorization', `Bearer ${tok || token}`);

	beforeAll(async () => {
		Object.assign(process.env, { DATABASE_URL: DB_URL });

		const CANDS = [C_PUB, C_PRIV];
		await seedPool.query('DELETE FROM omni_scores WHERE user_id = ANY($1)', [CANDS]);
		await seedPool.query('DELETE FROM users WHERE id = ANY($1)', [[R, ...CANDS]]);
		await seedPool.query('DELETE FROM companies WHERE id = $1', [CO]);

		await seedPool.query('INSERT INTO companies (id, name) VALUES ($1, $2)', [CO, 'Gate Co 2083']);
		await seedPool.query(
			`INSERT INTO users (id, email, password_hash, name, role, company_id)
			 VALUES ($1, $2, 'x', 'Recruiter 2083', 'recruiter', $3)`,
			[R, `rec${RUN_BASE}@test.local`, CO],
		);
		const candSeed = async (id, label, privacy) => {
			await seedPool.query(
				`INSERT INTO users (id, email, password_hash, name, role)
				 VALUES ($1, $2, 'x', $3, 'candidate')`,
				[id, `cand${id}@test.local`, label],
			);
			await seedPool.query(
				`INSERT INTO candidate_profiles (user_id, headline, location, years_experience)
				 VALUES ($1, 'Engineer', 'Hyderabad', 5)`,
				[id],
			);
			await seedPool.query(`INSERT INTO user_settings (user_id, privacy) VALUES ($1, $2)`, [
				id,
				JSON.stringify(privacy),
			]);
		};
		await candSeed(C_PUB, 'Public Leaderboard', { profile_visible: true });
		await candSeed(C_PRIV, 'Private Leaderboard', { profile_visible: false });

		// Writer-shaped omni rows carrying internal data with sentinel
		// values, so a leak is detectable by value as well as by key.
		await seedPool.query(
			`INSERT INTO omni_scores
			   (user_id, total_score, interview_score, technical_score, resume_score,
			    behavior_score, score_tier, factor_scores, peer_percentile,
			    fraud_signals, last_checkin_at, version)
			 VALUES ($1, 750, 700, 710, 720, 730, $2, $3::jsonb, 91, $4::jsonb, NOW(), 2)`,
			[
				C_PUB,
				TIER_DB,
				JSON.stringify({ secret_factor: FACTOR_SENTINEL }),
				JSON.stringify([{ signal: FRAUD_SENTINEL }]),
			],
		);
		await seedPool.query(
			`INSERT INTO omni_scores
			   (user_id, total_score, interview_score, technical_score, resume_score,
			    behavior_score, score_tier, factor_scores, peer_percentile,
			    fraud_signals, version)
			 VALUES ($1, 760, 700, 710, 720, 730, $2, $3::jsonb, 92, $4::jsonb, 2)`,
			[
				C_PRIV,
				TIER_DB,
				JSON.stringify({ secret_factor: FACTOR_SENTINEL }),
				JSON.stringify([{ signal: FRAUD_SENTINEL }]),
			],
		);

		const express = require('express');
		request = require('supertest');
		const { generateToken } = require('../../../lib/auth');
		token = generateToken({
			id: R,
			email: `rec${RUN_BASE}@test.local`,
			role: 'recruiter',
			company_id: CO,
		});
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

	test('1. public candidate appears with EXACTLY the allowlisted keys and the rendered values', async () => {
		const res = await get('/api/omniscore/leaderboard?limit=50');
		expect(res.status).toBe(200);
		const row = res.body.candidates.find((c) => c.user_id === C_PUB);
		expect(row).toBeTruthy();
		expect(Object.keys(row).sort()).toEqual(ALLOWLIST_KEYS);
		expect(Number(row.total_score)).toBe(750);
		expect(row.score_tier).toBe('excellent'); // gold stored -> API label
		expect(Number(row.interview_score)).toBe(700);
		expect(Number(row.technical_score)).toBe(710);
		expect(Number(row.resume_score)).toBe(720);
		expect(Number(row.behavior_score)).toBe(730);
		expect(row.name).toBe('Public Leaderboard');
		expect(row.email).toBe(`cand${C_PUB}@test.local`);
		expect(row.headline).toBe('Engineer');
		expect(row.location).toBe('Hyderabad');
		expect(Number(row.years_experience)).toBe(5);
	});

	test('2. no leaked key and no sentinel value anywhere in the candidates payload', async () => {
		const res = await get('/api/omniscore/leaderboard?limit=50');
		expect(res.status).toBe(200);
		for (const row of res.body.candidates) {
			for (const key of LEAKED_KEYS) {
				expect(row).not.toHaveProperty(key);
			}
		}
		const payload = JSON.stringify(res.body.candidates);
		expect(payload).not.toContain(FRAUD_SENTINEL);
		expect(payload).not.toContain(String(FACTOR_SENTINEL));
	});

	test('3. private candidate (switch OFF) still absent from the list (#2082 predicate intact)', async () => {
		const res = await get('/api/omniscore/leaderboard?limit=50');
		expect(res.status).toBe(200);
		const ids = res.body.candidates.map((c) => c.user_id);
		expect(ids).toContain(C_PUB);
		expect(ids).not.toContain(C_PRIV);
	});

	test('4. non-recruiter role -> 403 on /leaderboard', async () => {
		const res = await get('/api/omniscore/leaderboard?limit=50', candidateToken);
		expect(res.status).toBe(403);
	});
});
