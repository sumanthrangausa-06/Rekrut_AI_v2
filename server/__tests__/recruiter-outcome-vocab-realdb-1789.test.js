/**
 * #1789 — Recruiter interview feedback can never save: the client's
 * outcome vocabulary (strong_hire / hire / lean_hire / lean_no_hire /
 * no_hire / completed) vs chk_scheduled_interviews_outcome
 * (passed / failed / pending_review / no_decision / NULL).
 *
 * Design: docs/sdlc/rekrut-ai-v2/03-solutioning/interview-outcome-vocabulary/design.md
 * (Rex, PR #1790) — option (b) server-side translation at
 * PUT /api/recruiter/interviews/:id (§5 table, §6 build contract):
 *   strong_hire / hire / lean_hire -> passed
 *   lean_no_hire / no_hire         -> failed
 *   completed (client no-selection default) -> no_decision (never passed, D4)
 *   canonical values pass through unchanged
 *   anything else (incl. '', 'no_show', 'maybe') -> honest 400, row unchanged
 *   outcome null / omitted -> keep stored value (D7, no clear-to-NULL)
 *
 * This suite follows the candidate-decline-outcome-realdb-1783 pattern:
 * a fresh throwaway Postgres built by migrate.js, the REAL recruiter
 * router (real lib/db, real auth) exercised over HTTP via supertest,
 * and the resulting row read back. The submit body is built EXACTLY as
 * client/src/pages/recruiter/interviews.tsx submitFeedback() builds it:
 *   { status: 'completed', outcome: fbOutcome || 'completed',
 *     feedback: { rating, strengths, weaknesses, notes } }
 *
 * Example:
 *   RECRUITER1789_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55489/nova1789' \
 *     npx jest server/__tests__/recruiter-outcome-vocab-realdb-1789.test.js --forceExit
 */
jest.unmock('../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.RECRUITER1789_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_CAND = 178901;
const U_REC = 178902;
const C_ID = 17891;
const J_ID = 17891;

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

const FEEDBACK = {
	rating: 4,
	strengths: 'Strong system design',
	weaknesses: 'Slow on follow-ups',
	notes: 'Would work well with the platform team',
};

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	await q('DELETE FROM scheduled_interviews WHERE candidate_id = $1', [U_CAND]);
	await q('DELETE FROM jobs WHERE id = $1', [J_ID]);
	await q('DELETE FROM companies WHERE id = $1', [C_ID]);
	await q('DELETE FROM users WHERE id = ANY($1::int[])', [[U_CAND, U_REC]]);
	await q(`INSERT INTO companies (id, name) VALUES ($1, 'Outcome 1789 Co')`, [C_ID]);
	await q(`INSERT INTO jobs (id, title, company_id) VALUES ($1, 'Outcome Role', $2)`, [
		J_ID,
		C_ID,
	]);
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES
		   ($1, 'cand1789@test.local', 'Cand 1789', 'candidate', NULL),
		   ($2, 'rec1789@test.local', 'Rec 1789', 'recruiter', $3)`,
		[U_CAND, U_REC, C_ID],
	);
}

async function newInterview() {
	const ins = await seedPool.query(
		`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, recruiter_id, scheduled_at, status)
		 VALUES ($1, $2, $3, $4, NOW() + interval '1 day', 'scheduled') RETURNING id`,
		[C_ID, J_ID, U_CAND, U_REC],
	);
	return ins.rows[0].id;
}

async function readRow(id) {
	const back = await seedPool.query(
		'SELECT status, outcome, feedback FROM scheduled_interviews WHERE id = $1',
		[id],
	);
	return back.rows[0];
}

describeIfDb('#1789 recruiter outcome vocabulary — real DB (user journey)', () => {
	let request;
	let app;
	let rtoken;

	beforeAll(async () => {
		// server/test/setup.js replaces DATABASE_URL with a dummy; restore the
		// real one before lib/db (and the router that uses it) load.
		process.env.DATABASE_URL = DB_URL;
		await cleanAndSeed();
		const express = require('express');
		request = require('supertest');
		const { generateToken } = require('../../lib/auth');
		rtoken = generateToken({ id: U_REC, email: 'rec1789@test.local', role: 'recruiter' });
		const recruiterRoutes = require('../../routes/recruiter');
		app = express();
		app.use(express.json());
		app.use('/api/recruiter', recruiterRoutes);
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	// The body exactly as submitFeedback() builds it.
	const clientBody = (outcome) => ({
		status: 'completed',
		outcome,
		feedback: { ...FEEDBACK },
	});

	const put = (id, body) =>
		request(app)
			.put(`/api/recruiter/interviews/${id}`)
			.set('Authorization', `Bearer ${rtoken}`)
			.send(body);

	test("client submits 'strong_hire' with full feedback: 200, stored canonical 'passed', feedback preserved verbatim", async () => {
		const id = await newInterview();
		const res = await put(id, clientBody('strong_hire'));
		expect(res.status).toBe(200);
		const row = await readRow(id);
		expect(row.status).toBe('completed');
		expect(row.outcome).toBe('passed');
		const fb = typeof row.feedback === 'string' ? JSON.parse(row.feedback) : row.feedback;
		expect(fb).toEqual(FEEDBACK);
	});

	test.each([
		['hire', 'passed'],
		['lean_hire', 'passed'],
		['lean_no_hire', 'failed'],
		['no_hire', 'failed'],
	])("client value '%s' is stored as canonical '%s' (design §5)", async (sent, stored) => {
		const id = await newInterview();
		const res = await put(id, clientBody(sent));
		expect(res.status).toBe(200);
		const row = await readRow(id);
		expect(row.outcome).toBe(stored);
	});

	test("no-selection submit: client sends 'completed' -> 200, stored 'no_decision', explicitly NOT 'passed' (D4)", async () => {
		const id = await newInterview();
		const res = await put(id, clientBody('completed'));
		expect(res.status).toBe(200);
		const row = await readRow(id);
		expect(row.status).toBe('completed');
		expect(row.outcome).toBe('no_decision');
		expect(row.outcome).not.toBe('passed');
	});

	test.each([['passed'], ['failed'], ['pending_review'], ['no_decision']])(
		"canonical value '%s' passes through unchanged",
		async (value) => {
			const id = await newInterview();
			const res = await put(id, clientBody(value));
			expect(res.status).toBe(200);
			const row = await readRow(id);
			expect(row.outcome).toBe(value);
		},
	);

	test.each([['no_show'], ['maybe'], ['']])(
		"invalid outcome '%s' -> honest 400, row unchanged (D8: 'maybe' joins 'no_show')",
		async (value) => {
			const id = await newInterview();
			const res = await put(id, clientBody(value));
			expect(res.status).toBe(400);
			const row = await readRow(id);
			expect(row.outcome).toBeNull();
			expect(row.status).toBe('scheduled');
		},
	);

	test('outcome null and omitted outcome keep the stored value (D7: no clear-to-NULL)', async () => {
		const id = await newInterview();
		const first = await put(id, clientBody('hire'));
		expect(first.status).toBe(200);
		expect((await readRow(id)).outcome).toBe('passed');

		const withNull = await put(id, { status: 'completed', outcome: null, feedback: { ...FEEDBACK } });
		expect(withNull.status).toBe(200);
		expect((await readRow(id)).outcome).toBe('passed');

		const omitted = await put(id, { status: 'completed', feedback: { ...FEEDBACK } });
		expect(omitted.status).toBe(200);
		expect((await readRow(id)).outcome).toBe('passed');
	});

	test("change of mind: a 'passed' row re-submitted with 'no_hire' ends at 'failed'", async () => {
		const id = await newInterview();
		expect((await put(id, clientBody('hire'))).status).toBe(200);
		expect((await readRow(id)).outcome).toBe('passed');
		expect((await put(id, clientBody('no_hire'))).status).toBe(200);
		expect((await readRow(id)).outcome).toBe('failed');
	});
});
