/**
 * #1631 — years_experience answered-state.
 *
 * Founder semantics (2026-10-26): a candidate who never touched the field
 * is UNANSWERED — no completion credit, 'Years of Experience' stays in the
 * missing-sections nudge. Explicit 0 = 'No experience', a real answer that
 * counts. Root cause: candidate_profiles.years_experience carried
 * `DEFAULT 0` (migration 004), so every side-door INSERT that omits the
 * column (photo upload, resume upload, settings, preferences) manufactured
 * a 0 the user never gave, and the 12-field completion formula
 * (`years_experience != null`, client/src/lib/profile-completion.ts +
 * server mirror in GET /dashboard/stats) correctly counted it.
 *
 * Candidate Experience journey assertions:
 *  (a) fresh candidate whose profile row is created by a side door (the
 *      exact INSERT shape routes/settings.js uses) reads back
 *      years_experience NULL; GET /dashboard/stats grants NO experience
 *      credit and lists 'Years of Experience' in missing_sections.
 *  (b) PUT /profile with years_experience 0 (fresh profile, insert path)
 *      reads back 0 and stats credit is granted (nudge drops the field).
 *  (c) PUT /profile with years_experience 8 reads back 8, credit granted.
 *  (d) PUT /profile with years_experience null on a FRESH profile (the
 *      profile page select's empty "Select…" option) writes NULL — the
 *      insert path must not coerce null back to a manufactured 0.
 *
 * Real-DB suite (HL-003): runs against a fresh-install Postgres built
 * ONLY by `node migrate.js`; surfaces exercised over real HTTP
 * (supertest against the real candidate router, real lib/db). Only auth
 * is mocked (req.user injection, the #1787 lane pattern). Without
 * YEARS1631_INTEGRATION_DB_URL the real-DB describe is skipped and only
 * the static contract tests run.
 *
 * Example:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55471/nova1631_green node migrate.js
 *   YEARS1631_INTEGRATION_DB_URL='postgresql://postgres:postgres@127.0.0.1:55471/nova1631_green' \
 *     npx jest server/__tests__/routes/candidate-years-experience-answered-state-1631.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const mockCurrentUser = { id: 163101, role: 'candidate', company_id: null };
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

const DB_URL = process.env.YEARS1631_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_SIDEDOOR = 163101;
const U_ZERO = 163102;
const U_EIGHT = 163103;
const U_NULL = 163104;
const ALL_IDS = [U_SIDEDOOR, U_ZERO, U_EIGHT, U_NULL];

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

async function seedUsers() {
	const q = (sql, params) => seedPool.query(sql, params);
	await q('DELETE FROM candidate_profiles WHERE user_id = ANY($1)', [ALL_IDS]);
	await q('DELETE FROM users WHERE id = ANY($1)', [ALL_IDS]);
	for (const id of ALL_IDS) {
		await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, 'candidate')`, [
			id,
			`nova1631-${id}@test.local`,
			`Nova 1631 ${id}`,
		]);
	}
	// (a) side door: the exact INSERT shape routes/settings.js uses to
	// upsert candidate_profiles — it omits years_experience entirely.
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

async function readYears(userId) {
	const { rows } = await seedPool.query(
		'SELECT years_experience FROM candidate_profiles WHERE user_id = $1',
		[userId],
	);
	return rows.length ? rows[0].years_experience : undefined;
}

describe('#1631 static contract — migration + profile page answered-state', () => {
	test('migration 294 drops the manufactured DEFAULT 0 and its down restores it', () => {
		const mig = read('migrations/294_candidate_years_experience_no_default.js');
		expect(mig).toContain(
			'ALTER TABLE candidate_profiles ALTER COLUMN years_experience DROP DEFAULT',
		);
		expect(mig).toContain(
			'ALTER TABLE candidate_profiles ALTER COLUMN years_experience SET DEFAULT 0',
		);
		// No existing-row heal in this lane (separate founder data gate).
		expect(mig).not.toMatch(/UPDATE\s+candidate_profiles\s+SET/i);
	});

	test('profile page: years control is an explicit select with unanswered + No experience options', () => {
		const src = read('client/src/pages/candidate/profile.tsx');
		expect(src).toContain('>Select…</option>');
		expect(src).toContain('>No experience</option>');
		expect(src).toContain("'1 year'");
		// The old coercion (clearing the number input answered 0 for the user) is gone.
		expect(src).not.toContain(
			"updateField('years_experience', parseInt(e.target.value, 10) || 0)",
		);
		// Empty option sends null (unanswered), not 0.
		expect(src).toMatch(/updateField\(\s*'years_experience',\s*e\.target\.value === '' \? null/);
	});

	test('profile page: header chip renders 0 in words, >0 as years, null as no chip', () => {
		const src = read('client/src/pages/candidate/profile.tsx');
		expect(src).toContain("'No experience'");
		expect(src).toContain('years exp.');
	});

	test('server PUT insert path does not coerce a null years_experience back to 0', () => {
		const src = read('routes/candidate.js');
		expect(src).not.toContain('sanitizedYearsExperience || 0');
	});
});

describeIfDb('#1631 years_experience answered-state — real DB', () => {
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

	test('(a) side-door row: years_experience reads back NULL, no stats credit, nudge lists the field', async () => {
		expect(await readYears(U_SIDEDOOR)).toBeNull();

		mockCurrentUser.id = U_SIDEDOOR;
		const res = await request(app).get('/api/candidate/dashboard/stats');
		expect(res.status).toBe(200);
		expect(res.body.stats.missing_sections).toContain('Years of Experience');
		// Only the user's name is answered (1 of 12 fields = 8%): a
		// manufactured 0 would have made this 17%.
		expect(res.body.stats.profile_completeness).toBe(8);
	});

	test('(b) PUT years_experience=0 on a fresh profile: reads back 0 and earns credit', async () => {
		mockCurrentUser.id = U_ZERO;
		const put = await request(app)
			.put('/api/candidate/profile')
			.send({ years_experience: 0 });
		expect(put.status).toBe(200);
		expect(await readYears(U_ZERO)).toBe(0);

		const res = await request(app).get('/api/candidate/dashboard/stats');
		expect(res.status).toBe(200);
		expect(res.body.stats.missing_sections).not.toContain('Years of Experience');
	});

	test('(c) PUT years_experience=8 on a fresh profile: reads back 8 and earns credit', async () => {
		mockCurrentUser.id = U_EIGHT;
		const put = await request(app)
			.put('/api/candidate/profile')
			.send({ years_experience: 8 });
		expect(put.status).toBe(200);
		expect(await readYears(U_EIGHT)).toBe(8);

		const res = await request(app).get('/api/candidate/dashboard/stats');
		expect(res.status).toBe(200);
		expect(res.body.stats.missing_sections).not.toContain('Years of Experience');
	});

	test('(d) PUT years_experience=null on a fresh profile: writes NULL, no credit', async () => {
		mockCurrentUser.id = U_NULL;
		const put = await request(app)
			.put('/api/candidate/profile')
			.send({ years_experience: null });
		expect(put.status).toBe(200);
		expect(await readYears(U_NULL)).toBeNull();

		const res = await request(app).get('/api/candidate/dashboard/stats');
		expect(res.status).toBe(200);
		expect(res.body.stats.missing_sections).toContain('Years of Experience');
	});
});
