/**
 * #1893 — PUT /profile UPDATE branch: JSON.stringify(null) defeats COALESCE.
 *
 * Follow-up from the independent review of PR #1892 (#1889), finding (a).
 * The UPDATE branch in routes/candidate.js passed
 *   JSON.stringify(preferred_job_types) / JSON.stringify(preferred_locations)
 * straight into `COALESCE($13, preferred_job_types)` /
 * `COALESCE($14, preferred_locations)`. JSON.stringify(null) returns the
 * STRING 'null' (not SQL NULL), so COALESCE saw a non-null parameter and
 * the stored jsonb array was overwritten with the jsonb literal null. An
 * API client that PUTs null intending 'leave unchanged' silently wiped
 * the preference. The INSERT branch already passed null through correctly
 * (#1889); the profile page never sends null (it sends []), so this only
 * bit direct API callers.
 *
 * Candidate Experience / API-contract journey assertions (UPDATE branch,
 * i.e. an EXISTING profile row — the first PUT creates it):
 *  (a) PUT arrays, then PUT null for both fields plus a headline change
 *      → arrays UNCHANGED, headline changed (the UPDATE demonstrably ran,
 *      and null meant 'leave unchanged' as COALESCE intends).
 *  (b) PUT [] for both fields → both clear to [] (explicit clear still
 *      writes; [] is not null and must not be treated as 'leave unchanged').
 *  (c) PUT a new array for both fields → both replace the stored arrays.
 *
 * Real-DB suite (HL-003): runs against a fresh-install Postgres built
 * ONLY by `node migrate.js`; surfaces exercised over real HTTP
 * (supertest against the real candidate router, real lib/db). Only auth
 * is mocked (req.user injection, the #1787 pattern). Without
 * PREF1893_INTEGRATION_DB_URL the real-DB describe is skipped and only
 * the static contract test runs.
 *
 * Example:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55471/nova1893_green node migrate.js
 *   PREF1893_INTEGRATION_DB_URL='postgresql://postgres:postgres@127.0.0.1:55471/nova1893_green' \
 *     npx jest server/__tests__/routes/candidate-profile-update-coalesce-null-1893.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const mockCurrentUser = { id: 189301, role: 'candidate', company_id: null };
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

const DB_URL = process.env.PREF1893_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_NULL = 189301;
const U_EMPTY = 189302;
const U_REPLACE = 189303;
const ALL_IDS = [U_NULL, U_EMPTY, U_REPLACE];

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

async function seedUsers() {
	const q = (sql, params) => seedPool.query(sql, params);
	await q('DELETE FROM candidate_profiles WHERE user_id = ANY($1)', [ALL_IDS]);
	await q('DELETE FROM users WHERE id = ANY($1)', [ALL_IDS]);
	for (const id of ALL_IDS) {
		await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, 'candidate')`, [
			id,
			`nova1893-${id}@test.local`,
			`Nova 1893 ${id}`,
		]);
	}
}

async function readProfile(userId) {
	const { rows } = await seedPool.query(
		'SELECT headline, preferred_job_types, preferred_locations FROM candidate_profiles WHERE user_id = $1',
		[userId],
	);
	return rows.length ? rows[0] : undefined;
}

describe('#1893 static contract — UPDATE branch null pass-through', () => {
	test('UPDATE branch passes SQL null through for both preference fields', () => {
		const src = read('routes/candidate.js');
		expect(src).toContain(
			'preferred_job_types != null ? JSON.stringify(preferred_job_types) : null',
		);
		expect(src).toContain(
			'preferred_locations != null ? JSON.stringify(preferred_locations) : null',
		);
		// The bare stringify that defeated COALESCE is gone from the file's
		// UPDATE parameter list (the INSERT branch keeps its own shapes).
		const updateStart = src.indexOf('UPDATE candidate_profiles SET');
		const updateEnd = src.indexOf('RETURNING *', updateStart);
		const updateBlock = src.slice(updateStart, updateEnd);
		expect(updateBlock).toContain('preferred_job_types = COALESCE($13, preferred_job_types)');
		expect(updateBlock).toContain(
			'preferred_locations = COALESCE($14, preferred_locations)',
		);
	});
});

describeIfDb('#1893 profile UPDATE null pass-through — real DB', () => {
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

	test('(a) PUT null on an existing profile keeps the stored arrays, headline still updates', async () => {
		mockCurrentUser.id = U_NULL;
		const put1 = await request(app)
			.put('/api/candidate/profile')
			.send({
				headline: 'Original headline',
				preferred_job_types: ['full-time'],
				preferred_locations: ['Remote'],
			});
		expect(put1.status).toBe(200);
		const before = await readProfile(U_NULL);
		expect(before.headline).toBe('Original headline');
		expect(before.preferred_job_types).toEqual(['full-time']);
		expect(before.preferred_locations).toEqual(['Remote']);

		const put2 = await request(app)
			.put('/api/candidate/profile')
			.send({
				headline: 'Updated headline',
				preferred_job_types: null,
				preferred_locations: null,
			});
		expect(put2.status).toBe(200);

		const after = await readProfile(U_NULL);
		// The UPDATE ran (headline changed) …
		expect(after.headline).toBe('Updated headline');
		// … but null meant 'leave unchanged', not jsonb-null.
		expect(after.preferred_job_types).toEqual(['full-time']);
		expect(after.preferred_locations).toEqual(['Remote']);
		// The API response carries the same truth.
		expect(put2.body.profile.preferred_job_types).toEqual(['full-time']);
		expect(put2.body.profile.preferred_locations).toEqual(['Remote']);
	});

	test('(b) PUT [] on an existing profile clears both fields to []', async () => {
		mockCurrentUser.id = U_EMPTY;
		const put1 = await request(app)
			.put('/api/candidate/profile')
			.send({
				preferred_job_types: ['full-time'],
				preferred_locations: ['Remote'],
			});
		expect(put1.status).toBe(200);
		expect((await readProfile(U_EMPTY)).preferred_job_types).toEqual(['full-time']);

		const put2 = await request(app)
			.put('/api/candidate/profile')
			.send({ preferred_job_types: [], preferred_locations: [] });
		expect(put2.status).toBe(200);

		const after = await readProfile(U_EMPTY);
		expect(after.preferred_job_types).toEqual([]);
		expect(after.preferred_locations).toEqual([]);
	});

	test('(c) PUT a new array on an existing profile replaces both fields', async () => {
		mockCurrentUser.id = U_REPLACE;
		const put1 = await request(app)
			.put('/api/candidate/profile')
			.send({
				preferred_job_types: ['full-time'],
				preferred_locations: ['Remote'],
			});
		expect(put1.status).toBe(200);

		const put2 = await request(app)
			.put('/api/candidate/profile')
			.send({
				preferred_job_types: ['contract', 'part-time'],
				preferred_locations: ['Berlin', 'Remote'],
			});
		expect(put2.status).toBe(200);

		const after = await readProfile(U_REPLACE);
		expect(after.preferred_job_types).toEqual(['contract', 'part-time']);
		expect(after.preferred_locations).toEqual(['Berlin', 'Remote']);
	});
});
