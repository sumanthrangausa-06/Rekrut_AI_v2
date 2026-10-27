/**
 * #1896 — PUT /profile passes RAW remote_preference / timezone_preference /
 * travel_willingness; sanitized values computed then discarded.
 *
 * The PUT /profile handler computes sanitizedTimezonePreference and
 * sanitizedTravelWillingness via normalizeTextField — then the UPDATE branch
 * passed the RAW req.body values as $16/$17 anyway (the INSERT branch used
 * the sanitized ones). remote_preference had NO sanitized variable at all:
 * UPDATE passed it raw, INSERT passed `remote_preference || null` raw, into
 * a VARCHAR(50) column (migration 004).
 *
 * Candidate Experience / API-contract journey assertions:
 *  (a) INSERT: first PUT with a >50-char remote_preference → honest 400
 *      (every other field's length check returns 400 via normalizeTextField),
 *      NOT a raw Postgres value-too-long 500, and no profile row is created.
 *  (b) UPDATE: PUT with a >50-char remote_preference on an existing profile
 *      → 400, stored value unchanged.
 *  (c) UPDATE cleaning: padded / markup-carrying timezone_preference and
 *      travel_willingness are stored CLEANED (trimmed, tags stripped) —
 *      exactly what the sanitizer computed.
 *  (d) UPDATE '' semantics: PUT timezone_preference: '' means "no answer"
 *      (sanitizer → null → COALESCE leaves the stored value unchanged),
 *      NOT an empty-string overwrite that reads back as an answered value.
 *  (e) Control: ordinary clean values round-trip byte-identical on both
 *      the INSERT and UPDATE branches.
 *
 * Real-DB suite (HL-003): runs against a fresh-install Postgres built ONLY
 * by `node migrate.js`; surfaces exercised over real HTTP (supertest against
 * the real candidate router, real lib/db). Only auth is mocked (req.user
 * injection, the #1787 pattern). Without PREF1896_INTEGRATION_DB_URL the
 * real-DB describe is skipped and only the static contract test runs.
 */
jest.unmock('../../../lib/db');

const mockCurrentUser = { id: 189601, role: 'candidate', company_id: null };
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

const DB_URL = process.env.PREF1896_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_INSERT_LONG = 189601;
const U_UPDATE_LONG = 189602;
const U_CLEAN = 189603;
const U_EMPTY = 189604;
const U_CONTROL = 189605;
const ALL_IDS = [U_INSERT_LONG, U_UPDATE_LONG, U_CLEAN, U_EMPTY, U_CONTROL];

const LONG_REMOTE = 'x'.repeat(60); // > VARCHAR(50)

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

async function seedUsers() {
	const q = (sql, params) => seedPool.query(sql, params);
	await q('DELETE FROM candidate_profiles WHERE user_id = ANY($1)', [ALL_IDS]);
	await q('DELETE FROM users WHERE id = ANY($1)', [ALL_IDS]);
	for (const id of ALL_IDS) {
		await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, 'candidate')`, [
			id,
			`nova1896-${id}@test.local`,
			`Nova 1896 ${id}`,
		]);
	}
}

async function readProfile(userId) {
	const { rows } = await seedPool.query(
		'SELECT remote_preference, timezone_preference, travel_willingness FROM candidate_profiles WHERE user_id = $1',
		[userId],
	);
	return rows.length ? rows[0] : undefined;
}

describe('#1896 static contract — sanitized preference pass-through', () => {
	test('a sanitized remote_preference is computed via normalizeTextField', () => {
		const src = read('routes/candidate.js');
		expect(src).toMatch(
			/const sanitizedRemotePreference = normalizeTextField\(\s*remote_preference,\s*50,/,
		);
	});
});

describeIfDb('#1896 profile sanitized preferences — real DB', () => {
	let app;

	beforeAll(async () => {
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

	test('(a) INSERT branch: >50-char remote_preference → 400, no row created', async () => {
		mockCurrentUser.id = U_INSERT_LONG;
		const put = await request(app)
			.put('/api/candidate/profile')
			.send({ headline: 'First profile', remote_preference: LONG_REMOTE });
		expect(put.status).toBe(400);
		expect(await readProfile(U_INSERT_LONG)).toBeUndefined();
	});

	test('(b) UPDATE branch: >50-char remote_preference → 400, stored value unchanged', async () => {
		mockCurrentUser.id = U_UPDATE_LONG;
		const put1 = await request(app)
			.put('/api/candidate/profile')
			.send({ headline: 'Existing profile', remote_preference: 'hybrid' });
		expect(put1.status).toBe(200);
		expect((await readProfile(U_UPDATE_LONG)).remote_preference).toBe('hybrid');

		const put2 = await request(app)
			.put('/api/candidate/profile')
			.send({ remote_preference: LONG_REMOTE });
		expect(put2.status).toBe(400);
		expect((await readProfile(U_UPDATE_LONG)).remote_preference).toBe('hybrid');
	});

	test('(c) UPDATE branch stores timezone/travel CLEANED, not raw', async () => {
		mockCurrentUser.id = U_CLEAN;
		const put1 = await request(app)
			.put('/api/candidate/profile')
			.send({ headline: 'Clean me' });
		expect(put1.status).toBe(200);

		const put2 = await request(app)
			.put('/api/candidate/profile')
			.send({
				timezone_preference: '  <b>America/New_York</b>  ',
				travel_willingness: ' <i>Some travel</i> ',
			});
		expect(put2.status).toBe(200);
		const after = await readProfile(U_CLEAN);
		expect(after.timezone_preference).toBe('America/New_York');
		expect(after.travel_willingness).toBe('Some travel');
	});

	test("(d) UPDATE branch: '' timezone means no-answer — stored value unchanged", async () => {
		mockCurrentUser.id = U_EMPTY;
		const put1 = await request(app)
			.put('/api/candidate/profile')
			.send({ headline: 'Has tz', timezone_preference: 'UTC' });
		expect(put1.status).toBe(200);
		expect((await readProfile(U_EMPTY)).timezone_preference).toBe('UTC');

		const put2 = await request(app)
			.put('/api/candidate/profile')
			.send({ timezone_preference: '' });
		expect(put2.status).toBe(200);
		expect((await readProfile(U_EMPTY)).timezone_preference).toBe('UTC');
	});

	test('(e) control: ordinary clean values round-trip on INSERT and UPDATE', async () => {
		mockCurrentUser.id = U_CONTROL;
		const put1 = await request(app)
			.put('/api/candidate/profile')
			.send({
				remote_preference: 'remote',
				timezone_preference: 'Europe/Berlin',
				travel_willingness: 'None',
			});
		expect(put1.status).toBe(200);
		let after = await readProfile(U_CONTROL);
		expect(after.remote_preference).toBe('remote');
		expect(after.timezone_preference).toBe('Europe/Berlin');
		expect(after.travel_willingness).toBe('None');

		const put2 = await request(app)
			.put('/api/candidate/profile')
			.send({
				remote_preference: 'onsite',
				timezone_preference: 'Asia/Kolkata',
				travel_willingness: 'Frequent',
			});
		expect(put2.status).toBe(200);
		after = await readProfile(U_CONTROL);
		expect(after.remote_preference).toBe('onsite');
		expect(after.timezone_preference).toBe('Asia/Kolkata');
		expect(after.travel_willingness).toBe('Frequent');
	});
});
