/**
 * #1890 — Screening-answer enrichment never lands the candidate's answers.
 *
 * The manual-apply enrichment block in routes/candidate.js (submitApplication)
 * built its UPDATE clauses as `${key} = COALESCE(${idx}, ${key})` — `${idx}`
 * interpolates the bare clause number, so the parsed screening values were
 * pushed into the values array and never bound (only $1 = user_id is used):
 *   - availability present → `COALESCE(<int>, availability)` errors in
 *     Postgres ("COALESCE types integer and text cannot be matched"); the
 *     best-effort try/catch swallowed it and the WHOLE enrichment (salary +
 *     experience too) was silently lost. The filed #1890 failure.
 *   - salary/experience only → the UPDATE "succeeded" and wrote the literal
 *     clause index (2, 3, …) as salary_min / years_experience — fabricated
 *     values on the candidate's profile.
 * And even with binding fixed, the availability branch copied the free-text
 * answer verbatim into a CHECK-constrained column whose storable set (the
 * intersection of chk_candidate_profiles_availability /047 and
 * chk_profiles_availability /p2, see #1891) is exactly
 * { 'immediately', '2 weeks', '1 month' }.
 *
 * Candidate journey assertions (manual apply → profile read-back):
 *  (a) availability "Immediately" + salary "80000 - 100000" + experience
 *      "3-5" → profile availability 'immediately', salary_min 80000,
 *      salary_max 100000, years_experience 4 — the answers the candidate
 *      actually gave.
 *  (b) salary-only "60000" → salary_min 60000 (NOT the literal 2 the broken
 *      clause wrote), salary_max stays NULL.
 *  (c) unmappable availability "After my notice period ends" + experience
 *      "5-10" → availability stays NULL (honest absence, no forced write),
 *      years_experience 7 still lands (one bad answer no longer takes its
 *      siblings down).
 *  (d) availability "In 2 weeks" → '2 weeks'; "One month" → '1 month'
 *      (free-text phrasings map onto the canonical storable vocabulary).
 *
 * Real-DB suite (HL-003): runs against a fresh-install Postgres built ONLY
 * by `node migrate.js`; the apply surface is exercised over real HTTP
 * (supertest against the real candidate router, real lib/db). Only auth is
 * mocked (req.user injection, the #1787 pattern). Without
 * PREF1890_INTEGRATION_DB_URL the real-DB describe is skipped and only the
 * static contract test runs.
 *
 * Example:
 *   PREF1890_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55471/nova1890_green' \
 *     npx jest server/__tests__/routes/candidate-screening-enrichment-1890.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const mockCurrentUser = { id: 189001, role: 'candidate', company_id: null };
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

const DB_URL = process.env.PREF1890_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_FULL = 189001;
const U_SALARY = 189002;
const U_UNMAPPABLE = 189003;
const U_TWO_WEEKS = 189004;
const U_ONE_MONTH = 189005;
const ALL_IDS = [U_FULL, U_SALARY, U_UNMAPPABLE, U_TWO_WEEKS, U_ONE_MONTH];

const QUESTIONS = [
	{ id: 'q_avail', category: 'availability', question: 'When can you start?' },
	{ id: 'q_sal', category: 'salary', question: 'What salary do you expect?' },
	{ id: 'q_exp', category: 'experience', question: 'How much experience do you have?' },
];

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;
const jobIdByUser = {};

async function seed() {
	const q = (sql, params) => seedPool.query(sql, params);
	await q('DELETE FROM job_applications WHERE candidate_id = ANY($1)', [ALL_IDS]);
	await q('DELETE FROM candidate_profiles WHERE user_id = ANY($1)', [ALL_IDS]);
	await q('DELETE FROM jobs WHERE title LIKE $1', ['Nova 1890 job %']);
	await q('DELETE FROM users WHERE id = ANY($1)', [ALL_IDS]);
	for (const id of ALL_IDS) {
		await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, 'candidate')`, [
			id,
			`nova1890-${id}@test.local`,
			`Nova 1890 ${id}`,
		]);
		// The enrichment UPDATE targets an existing profile row.
		await q('INSERT INTO candidate_profiles (user_id) VALUES ($1)', [id]);
		const job = await q(
			'INSERT INTO jobs (title, screening_questions) VALUES ($1, $2) RETURNING id',
			[`Nova 1890 job ${id}`, JSON.stringify(QUESTIONS)],
		);
		jobIdByUser[id] = job.rows[0].id;
	}
}

async function readProfile(userId) {
	const { rows } = await seedPool.query(
		'SELECT availability, salary_min, salary_max, years_experience FROM candidate_profiles WHERE user_id = $1',
		[userId],
	);
	return rows.length ? rows[0] : undefined;
}

async function applyAs(userId, answers) {
	mockCurrentUser.id = userId;
	return request(appRef)
		.post(`/api/candidate/jobs/${jobIdByUser[userId]}/apply`)
		.send({ screening_answers: answers });
}

let appRef;

describe('#1890 static contract — enrichment binds values and maps availability', () => {
	test('clause builder emits real placeholders and availability is mapped, not copied raw', () => {
		const src = read('routes/candidate.js');
		const start = src.indexOf('Smart data enrichment from screening answers');
		const end = src.indexOf('Auto-create conversation', start);
		const block = src.slice(start, end);
		expect(block).toContain('COALESCE($${idx}, ${key})');
		expect(block).not.toContain('updates.availability = String(answer)');
		expect(block).toContain('mapScreeningAvailability');
	});
});

describeIfDb('#1890 screening enrichment — real DB', () => {
	beforeAll(async () => {
		// server/test/setup.js replaces DATABASE_URL with a dummy; restore
		// the real one before lib/db (and the routers) load.
		process.env.DATABASE_URL = DB_URL;
		await seed();
		const candidateRouter = require('../../../routes/candidate');
		appRef = express();
		appRef.use(express.json());
		appRef.use('/api/candidate', candidateRouter);
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('(a) full answer set lands exactly as the candidate gave it', async () => {
		const res = await applyAs(U_FULL, {
			q_avail: 'Immediately',
			q_sal: '80000 - 100000',
			q_exp: '3-5',
		});
		expect(res.status).toBe(200);
		const p = await readProfile(U_FULL);
		expect(p.availability).toBe('immediately');
		expect(p.salary_min).toBe(80000);
		expect(p.salary_max).toBe(100000);
		expect(p.years_experience).toBe(4);
	});

	test('(b) salary-only answer writes the typed salary, not a literal clause index', async () => {
		const res = await applyAs(U_SALARY, { q_sal: '60000' });
		expect(res.status).toBe(200);
		const p = await readProfile(U_SALARY);
		expect(p.salary_min).toBe(60000);
		expect(p.salary_max).toBeNull();
	});

	test('(c) unmappable availability is honestly absent; sibling answers still land', async () => {
		const res = await applyAs(U_UNMAPPABLE, {
			q_avail: 'After my notice period ends',
			q_exp: '5-10',
		});
		expect(res.status).toBe(200);
		const p = await readProfile(U_UNMAPPABLE);
		expect(p.availability).toBeNull();
		expect(p.years_experience).toBe(7);
	});

	test('(d) free-text phrasings map onto the storable vocabulary', async () => {
		const r1 = await applyAs(U_TWO_WEEKS, { q_avail: 'In 2 weeks' });
		expect(r1.status).toBe(200);
		expect((await readProfile(U_TWO_WEEKS)).availability).toBe('2 weeks');

		const r2 = await applyAs(U_ONE_MONTH, { q_avail: 'One month' });
		expect(r2.status).toBe(200);
		expect((await readProfile(U_ONE_MONTH)).availability).toBe('1 month');
	});
});
