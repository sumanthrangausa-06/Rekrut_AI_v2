/**
 * #1889 — profile preference answered-state (follow-up sweep from #1631).
 *
 * Founder standard (Sumanth, #1631 ruling 2026-10-26): a field the
 * candidate never touched is UNANSWERED; a database/system default read
 * as the user's own answer is a defect. Migration 004 gave three
 * non-completion preference fields manufactured defaults:
 *   availability        DEFAULT 'immediately'  (not even a value in the
 *                        profile page's availability vocabulary — the
 *                        header badge rendered the raw invented word)
 *   remote_preference   DEFAULT 'hybrid'
 *   preferred_job_types DEFAULT '["full-time"]'
 * and the profile page + the PUT /profile INSERT branch re-invented the
 * same answers client/server-side ('hybrid' / 'full-time' / 'open'
 * fallbacks). preferred_locations DEFAULT '[]' is KEPT by decision on
 * the STOP 1: an empty set renders as nothing and is never presented as
 * a candidate's choice.
 *
 * Candidate Experience journey assertions:
 *  (a) fresh candidate whose profile row is created by a side door (the
 *      exact INSERT shape routes/settings.js uses) reads back
 *      availability / remote_preference / preferred_job_types all NULL
 *      — no invented answers.
 *  (b) PUT /profile with explicit choices ('2 weeks' / remote /
 *      ['contract']) reads back exactly those choices. NOTE: the
 *      availability value is from the storable intersection of the TWO
 *      overlapping CHECK constraints on the column (migration 047 +
 *      p2_schema_hardening — see the STOP 1 amendments on #1889 and
 *      follow-up #1891): only 'immediately', '2 weeks' and '1 month'
 *      can be stored today. The profile page originally offered
 *      search-status values (open / actively_looking / not_looking /
 *      available_soon) that the CHECKs reject on every save (HTTP
 *      500); the amendments aligned the page to the storable values.
 *  (c) PUT /profile with NO preference fields on a fresh profile (the
 *      server INSERT branch on its own) writes NULLs — the server must
 *      not coerce an omission back to 'hybrid' / ['full-time'].
 *  (d) PUT /profile with the profile page's unanswered payload shape
 *      (availability null, remote_preference null,
 *      preferred_job_types []) writes NULL / NULL / [] — never the
 *      manufactured defaults.
 *
 * Real-DB suite (HL-003): runs against a fresh-install Postgres built
 * ONLY by `node migrate.js`; surfaces exercised over real HTTP
 * (supertest against the real candidate router, real lib/db). Only auth
 * is mocked (req.user injection, the #1787 pattern). Without
 * PREF1889_INTEGRATION_DB_URL the real-DB describe is skipped and only
 * the static contract tests run.
 *
 * Example:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55471/nova1889_green node migrate.js
 *   PREF1889_INTEGRATION_DB_URL='postgresql://postgres:postgres@127.0.0.1:55471/nova1889_green' \
 *     npx jest server/__tests__/routes/candidate-profile-preferences-answered-state-1889.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const mockCurrentUser = { id: 188901, role: 'candidate', company_id: null };
jest.mock('../../../lib/auth', () => {
	const actual = jest.requireActual('../../../lib/auth');
	const authMiddleware = jest.fn((req, _res, next) => {
		req.user = { ...mockCurrentUser };
		return next();
	});
	return { ...actual, authMiddleware };
});
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const passthrough = (_req, _res, next) => next();
	return {
		rateLimits: { ai: passthrough, standard: passthrough, strict: passthrough, lenient: passthrough },
		distributedRateLimiter: { check: jest.fn(async () => ({ allowed: true })) },
		DistributedRateLimiter: class {
			async checkLimit() {
				return { allowed: true };
			}
		},
	};
});
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

const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const DB_URL = process.env.PREF1889_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_SIDEDOOR = 188901;
const U_EXPLICIT = 188902;
const U_OMITTED = 188903;
const U_UNANSWERED = 188904;
const ALL_IDS = [U_SIDEDOOR, U_EXPLICIT, U_OMITTED, U_UNANSWERED];

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

async function seedUsers() {
	const q = (sql, params) => seedPool.query(sql, params);
	await q('DELETE FROM candidate_profiles WHERE user_id = ANY($1)', [ALL_IDS]);
	await q('DELETE FROM users WHERE id = ANY($1)', [ALL_IDS]);
	for (const id of ALL_IDS) {
		await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, 'candidate')`, [
			id,
			`nova1889-${id}@test.local`,
			`Nova 1889 ${id}`,
		]);
	}
	// (a) side door: the exact INSERT shape routes/settings.js uses to
	// upsert candidate_profiles — it omits all three preference columns.
	await q(
		`INSERT INTO candidate_profiles (user_id, bio, location, linkedin_url)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id)
		 DO UPDATE SET
		   bio = COALESCE(NULLIF($2, ''), candidate_profiles.bio),
		   location = COALESCE(NULLIF($3, ''), candidate_profiles.location),
		   linkedin_url = COALESCE(NULLIF($4, ''), candidate_profiles.linkedin_url),
		   updated_at = NOW()`,
		[U_SIDEDOOR, '', '', ''],
	);
}

async function readPrefs(userId) {
	const { rows } = await seedPool.query(
		'SELECT availability, remote_preference, preferred_job_types FROM candidate_profiles WHERE user_id = $1',
		[userId],
	);
	return rows.length ? rows[0] : undefined;
}

describe('#1889 static contract — migration + profile page + server answered-state', () => {
	test('migration 295 drops the three manufactured defaults and its down restores them', () => {
		const mig = read('migrations/295_candidate_profile_preferences_no_default.js');
		for (const col of ['availability', 'remote_preference', 'preferred_job_types']) {
			expect(mig).toContain(
				`ALTER TABLE candidate_profiles ALTER COLUMN ${col} DROP DEFAULT`,
			);
		}
		expect(mig).toContain("ALTER COLUMN availability SET DEFAULT 'immediately'");
		expect(mig).toContain("ALTER COLUMN remote_preference SET DEFAULT 'hybrid'");
		expect(mig).toContain('ALTER COLUMN preferred_job_types SET DEFAULT');
		// No existing-row heal in this lane (separate founder data gate).
		expect(mig).not.toMatch(/UPDATE\s+candidate_profiles\s+SET/i);
	});

	test('profile page: the three preference selects are explicit with an unanswered option', () => {
		const src = read('client/src/pages/candidate/profile.tsx');
		// The invented on-screen answers are gone.
		expect(src).not.toContain("profile.remote_preference || 'hybrid'");
		expect(src).not.toContain("profile.preferred_job_types?.[0] || 'full-time'");
		expect(src).not.toContain("profile.availability || 'open'");
		// Unanswered option sends the honest empty value for each field.
		expect(src).toMatch(/updateField\(\s*'availability',\s*e\.target\.value === '' \? null/);
		expect(src).toMatch(/updateField\(\s*'remote_preference',\s*e\.target\.value === '' \? null/);
		expect(src).toMatch(/updateField\(\s*'preferred_job_types',\s*e\.target\.value === '' \? \[\]/);
		// The availability select offers only values from the storable
		// CHECK intersection — not the old search-status values every
		// save rejected with a 500 (STOP 1 amendments, #1891).
		expect(src).toContain('<option value="2 weeks">');
		expect(src).toContain('<option value="immediately">');
		expect(src).not.toContain('value="actively_looking"');
		expect(src).not.toContain('value="available_soon"');
		// 'flexible' remote preference is likewise unstorable today
		// (chk_profiles_remote_preference) — a dead option, removed.
		expect(src).not.toContain('<option value="flexible">');
	});

	test('server PUT insert path does not coerce omitted preferences back to manufactured answers', () => {
		const src = read('routes/candidate.js');
		expect(src).not.toContain("preferred_job_types || ['full-time']");
		expect(src).not.toContain("remote_preference || 'hybrid'");
	});
});

describeIfDb('#1889 profile preferences answered-state — real DB', () => {
	let app;

	beforeAll(async () => {
		// server/test/setup.js replaces DATABASE_URL with a dummy; restore
		// the real one before lib/db (and the routers) load.
		process.env.DATABASE_URL = DB_URL;
		await seedUsers();
		const candidateRouter = require('../../../routes/candidate');
		app = express();
		app.use(express.json());
		app.use('/api/candidate', candidateRouter);
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('(a) side-door row: all three preferences read back NULL — no invented answers', async () => {
		const prefs = await readPrefs(U_SIDEDOOR);
		expect(prefs.availability).toBeNull();
		expect(prefs.remote_preference).toBeNull();
		expect(prefs.preferred_job_types).toBeNull();
	});

	test('(b) PUT explicit choices on a fresh profile: reads back exactly those choices', async () => {
		mockCurrentUser.id = U_EXPLICIT;
		const put = await request(app)
			.put('/api/candidate/profile')
			.send({
				availability: '2 weeks',
				remote_preference: 'remote',
				preferred_job_types: ['contract'],
			});
		expect(put.status).toBe(200);
		const prefs = await readPrefs(U_EXPLICIT);
		expect(prefs.availability).toBe('2 weeks');
		expect(prefs.remote_preference).toBe('remote');
		expect(prefs.preferred_job_types).toEqual(['contract']);
	});

	test('(c) PUT with no preference fields on a fresh profile: writes NULLs, no coercion', async () => {
		mockCurrentUser.id = U_OMITTED;
		const put = await request(app).put('/api/candidate/profile').send({ headline: 'Hello' });
		expect(put.status).toBe(200);
		const prefs = await readPrefs(U_OMITTED);
		expect(prefs.availability).toBeNull();
		expect(prefs.remote_preference).toBeNull();
		expect(prefs.preferred_job_types).toBeNull();
	});

	test('(d) PUT the unanswered payload shape on a fresh profile: NULL / NULL / []', async () => {
		mockCurrentUser.id = U_UNANSWERED;
		const put = await request(app)
			.put('/api/candidate/profile')
			.send({ availability: null, remote_preference: null, preferred_job_types: [] });
		expect(put.status).toBe(200);
		const prefs = await readPrefs(U_UNANSWERED);
		expect(prefs.availability).toBeNull();
		expect(prefs.remote_preference).toBeNull();
		expect(prefs.preferred_job_types).toEqual([]);
	});
});
