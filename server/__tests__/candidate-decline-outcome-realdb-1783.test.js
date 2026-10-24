/**
 * #1783 — Candidate interview decline writes a free-text reason into
 * scheduled_interviews.outcome, which chk_scheduled_interviews_outcome
 * rejects (PG 23514) on a fully migrated DB.
 *
 * Verified first on a fresh-install rig (Nova, 2026-10-23): empty DB built
 * by `node migrate.js`, real server, real HTTP —
 *   PUT /api/candidate/interviews/1/decline {"reason":"Schedule conflict - family event"}
 *   -> HTTP 500 {"error":"Failed to decline interview"}
 *   server log: violates check constraint "chk_scheduled_interviews_outcome"
 *   read-back: interview still status='scheduled'.
 *
 * This suite follows the omniscore-reliability-realdb-1776.test.js pattern:
 * a fresh throwaway Postgres built by migrate.js, the REAL candidate router
 * (real lib/db, real auth) exercised over HTTP via supertest, and the
 * resulting row read back. User-journey expectations (Quinn gate):
 * a candidate declines a scheduled interview -> HTTP 200, the interview is
 * cancelled, there is no pass/fail outcome (outcome IS NULL), and the reason
 * they typed is not lost — it is stored in `notes`, the same lawful column
 * the reschedule route already appends free-text reasons to, and which the
 * candidate/recruiter interview lists already return.
 *
 * Sibling class check: routes/recruiter.js PUT /interviews/:id is the only
 * other writer of scheduled_interviews.outcome; it passed the client value
 * through unvalidated, so an out-of-vocabulary outcome produced the same
 * PG 23514 -> 500. It must answer an honest 400 instead, while a lawful
 * outcome ('passed') still writes.
 *
 * Example:
 *   CAND1783_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55483/nova1783' \
 *     npx jest server/__tests__/candidate-decline-outcome-realdb-1783.test.js --forceExit
 */
jest.unmock('../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.CAND1783_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_CAND = 178301;
const U_REC = 178302;
const C_ID = 17831;
const J_ID = 17831;

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	await q('DELETE FROM scheduled_interviews WHERE candidate_id = $1', [U_CAND]);
	await q('DELETE FROM jobs WHERE id = $1', [J_ID]);
	await q('DELETE FROM companies WHERE id = $1', [C_ID]);
	await q('DELETE FROM users WHERE id = ANY($1::int[])', [[U_CAND, U_REC]]);
	await q(`INSERT INTO companies (id, name) VALUES ($1, 'Decline 1783 Co')`, [C_ID]);
	await q(`INSERT INTO jobs (id, title, company_id) VALUES ($1, 'Decline Role', $2)`, [
		J_ID,
		C_ID,
	]);
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES
		   ($1, 'cand1783@test.local', 'Cand 1783', 'candidate', NULL),
		   ($2, 'rec1783@test.local', 'Rec 1783', 'recruiter', $3)`,
		[U_CAND, U_REC, C_ID],
	);
	const ins = await q(
		`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, recruiter_id, scheduled_at, status)
		 VALUES ($1, $2, $3, $4, NOW() + interval '1 day', 'scheduled') RETURNING id`,
		[C_ID, J_ID, U_CAND, U_REC],
	);
	return ins.rows[0].id;
}

describeIfDb('#1783 candidate interview decline — real DB (user journey)', () => {
	let request;
	let app;
	let generateToken;
	let interviewId;

	beforeAll(async () => {
		// server/test/setup.js replaces DATABASE_URL with a dummy; restore the
		// real one before lib/db (and the router that uses it) load.
		process.env.DATABASE_URL = DB_URL;
		interviewId = await cleanAndSeed();
		const express = require('express');
		request = require('supertest');
		({ generateToken } = require('../../lib/auth'));
		const candidateRoutes = require('../../routes/candidate');
		app = express();
		app.use(express.json());
		app.use('/api/candidate', candidateRoutes);
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('candidate declines with a reason: 200, status cancelled, outcome NULL, reason kept in notes', async () => {
		const token = generateToken({ id: U_CAND, email: 'cand1783@test.local', role: 'candidate' });
		const res = await request(app)
			.put(`/api/candidate/interviews/${interviewId}/decline`)
			.set('Authorization', `Bearer ${token}`)
			.send({ reason: 'Schedule conflict - family event' });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.interview.status).toBe('cancelled');

		const back = await seedPool.query(
			'SELECT status, outcome, notes FROM scheduled_interviews WHERE id = $1',
			[interviewId],
		);
		expect(back.rows[0].status).toBe('cancelled');
		expect(back.rows[0].outcome).toBeNull();
		expect(back.rows[0].notes).toContain('Schedule conflict - family event');
	});

	test('candidate declines with no reason: 200, cancelled, outcome NULL, default note recorded', async () => {
		const id2 = (
			await seedPool.query(
				`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, recruiter_id, scheduled_at, status)
				 VALUES ($1, $2, $3, $4, NOW() + interval '2 days', 'confirmed') RETURNING id`,
				[C_ID, J_ID, U_CAND, U_REC],
			)
		).rows[0].id;
		const token = generateToken({ id: U_CAND, email: 'cand1783@test.local', role: 'candidate' });
		const res = await request(app)
			.put(`/api/candidate/interviews/${id2}/decline`)
			.set('Authorization', `Bearer ${token}`)
			.send({});

		expect(res.status).toBe(200);
		const back = await seedPool.query(
			'SELECT status, outcome, notes FROM scheduled_interviews WHERE id = $1',
			[id2],
		);
		expect(back.rows[0].status).toBe('cancelled');
		expect(back.rows[0].outcome).toBeNull();
		expect(back.rows[0].notes).toContain('Candidate declined');
	});

	test('sibling: recruiter PUT with out-of-vocabulary outcome is an honest 400, not a PG 23514 500; lawful outcome still writes', async () => {
		const recruiterRoutes = require('../../routes/recruiter');
		const express = require('express');
		const rapp = express();
		rapp.use(express.json());
		rapp.use('/api/recruiter', recruiterRoutes);
		const rtoken = generateToken({ id: U_REC, email: 'rec1783@test.local', role: 'recruiter' });

		const bad = await request(rapp)
			.put(`/api/recruiter/interviews/${interviewId}`)
			.set('Authorization', `Bearer ${rtoken}`)
			.send({ outcome: 'no_show' });
		expect(bad.status).toBe(400);

		const good = await request(rapp)
			.put(`/api/recruiter/interviews/${interviewId}`)
			.set('Authorization', `Bearer ${rtoken}`)
			.send({ outcome: 'passed' });
		expect(good.status).toBe(200);
		const back = await seedPool.query(
			'SELECT outcome FROM scheduled_interviews WHERE id = $1',
			[interviewId],
		);
		expect(back.rows[0].outcome).toBe('passed');
	});
});
