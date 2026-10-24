/**
 * #1788 — Candidate reschedule writes status 'reschedule_requested', a
 * value absent from both historical definitions of
 * chk_scheduled_interviews_status (PG 23514 -> HTTP 500 on a migrated DB).
 *
 * Design: docs/sdlc/rekrut-ai-v2/03-solutioning/interview-reschedule-vocabulary/design.md
 * (Rex, PR #1794) — D1/D2 expand-only migration 293 widening the CHECK
 * to the canonical union (scheduled, confirmed, in_progress, completed,
 * cancelled, no_show, rescheduled, reschedule_requested); D5 (§6.1)
 * ALLOWED_STATUSES validation on recruiter PUT /interviews/:id
 * (null/omitted keeps stored value; '' or out-of-vocabulary -> honest
 * 400, row unchanged; only the validated value is bound).
 *
 * Verified first on a fresh-install rig (Nova, 2026-10-23): empty DB
 * built by `node migrate.js` from pristine dev 97aacaee3, real server,
 * real HTTP —
 *   PUT /api/candidate/interviews/1/reschedule {"reason": "..."}
 *   -> HTTP 500 {"error":"Failed to request reschedule"}
 *   server log: PG 23514, constraint chk_scheduled_interviews_status
 *   read-back: interview still status='scheduled', notes NULL.
 *
 * This suite follows the candidate-decline-outcome-realdb-1783 pattern:
 * a fresh throwaway Postgres built by migrate.js (WITH migration 293 in
 * the tree), the REAL candidate / recruiter / interviews routers (real
 * lib/db, real auth) exercised over HTTP via supertest, and the
 * resulting rows read back. User-journey expectations (design §8,
 * Quinn gate): a candidate asks to move an interview -> HTTP 200, the
 * interview reads back reschedule_requested at its ORIGINAL time with
 * the reason + preferred time in notes; the recruiter then acts on it
 * (Confirm leg A at the original time; new-time leg B via the real
 * reschedule route).
 *
 * Example:
 *   CAND1788_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55488/nova1788' \
 *     npx jest server/__tests__/candidate-reschedule-vocab-realdb-1788.test.js --forceExit
 */
jest.unmock('../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.CAND1788_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_CAND = 178801;
const U_CAND2 = 178803;
const U_REC = 178802;
const C_ID = 17881;
const J_ID = 17881;

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	await q('DELETE FROM scheduled_interviews WHERE candidate_id = ANY($1::int[])', [[U_CAND, U_CAND2]]);
	await q('DELETE FROM jobs WHERE id = $1', [J_ID]);
	await q('DELETE FROM companies WHERE id = $1', [C_ID]);
	await q('DELETE FROM users WHERE id = ANY($1::int[])', [[U_CAND, U_CAND2, U_REC]]);
	await q(`INSERT INTO companies (id, name) VALUES ($1, 'Reschedule 1788 Co')`, [C_ID]);
	await q(`INSERT INTO jobs (id, title, company_id) VALUES ($1, 'Reschedule Role', $2)`, [
		J_ID,
		C_ID,
	]);
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES
		   ($1, 'cand1788@test.local', 'Cand 1788', 'candidate', NULL),
		   ($2, 'cand21788@test.local', 'Cand2 1788', 'candidate', NULL),
		   ($3, 'rec1788@test.local', 'Rec 1788', 'recruiter', $4)`,
		[U_CAND, U_CAND2, U_REC, C_ID],
	);
}

async function newInterview(status = 'scheduled', daysAhead = 3) {
	const ins = await seedPool.query(
		`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, recruiter_id, scheduled_at, status)
		 VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::interval, $6) RETURNING id, scheduled_at`,
		[C_ID, J_ID, U_CAND, U_REC, String(daysAhead), status],
	);
	return ins.rows[0];
}

async function readRow(id) {
	const back = await seedPool.query(
		'SELECT status, outcome, notes, scheduled_at FROM scheduled_interviews WHERE id = $1',
		[id],
	);
	return back.rows[0];
}

describeIfDb('#1788 candidate reschedule vocabulary — real DB (user journey)', () => {
	let request;
	let app;
	let candToken;
	let cand2Token;
	let recToken;

	beforeAll(async () => {
		// server/test/setup.js replaces DATABASE_URL with a dummy; restore the
		// real one before lib/db (and the routers that use it) load.
		process.env.DATABASE_URL = DB_URL;
		await cleanAndSeed();
		const express = require('express');
		request = require('supertest');
		const { generateToken } = require('../../lib/auth');
		candToken = generateToken({ id: U_CAND, email: 'cand1788@test.local', role: 'candidate' });
		cand2Token = generateToken({ id: U_CAND2, email: 'cand21788@test.local', role: 'candidate' });
		recToken = generateToken({ id: U_REC, email: 'rec1788@test.local', role: 'recruiter' });
		const candidateRoutes = require('../../routes/candidate');
		const recruiterRoutes = require('../../routes/recruiter');
		const interviewRoutes = require('../../routes/interviews');
		app = express();
		app.use(express.json());
		app.use('/api/candidate', candidateRoutes);
		app.use('/api/recruiter', recruiterRoutes);
		app.use('/api/interviews', interviewRoutes);
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	const candReschedule = (id, body, token = candToken) =>
		request(app)
			.put(`/api/candidate/interviews/${id}/reschedule`)
			.set('Authorization', `Bearer ${token}`)
			.send(body);

	const recPut = (id, body) =>
		request(app)
			.put(`/api/recruiter/interviews/${id}`)
			.set('Authorization', `Bearer ${recToken}`)
			.send(body);

	test('schema read-back: exactly one status CHECK (chk_scheduled_interviews_status) with all 8 canonical values; outcome CHECK unchanged; bogus status still 23514', async () => {
		const checks = await seedPool.query(
			`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
			  WHERE conrelid = 'scheduled_interviews'::regclass AND contype = 'c' ORDER BY conname`,
		);
		const statusChecks = checks.rows.filter(
			(r) => r.def.includes("'no_show'") && r.def.includes('status'),
		);
		expect(statusChecks).toHaveLength(1);
		expect(statusChecks[0].conname).toBe('chk_scheduled_interviews_status');
		for (const v of [
			'scheduled',
			'confirmed',
			'in_progress',
			'completed',
			'cancelled',
			'no_show',
			'rescheduled',
			'reschedule_requested',
		]) {
			expect(statusChecks[0].def).toContain(`'${v}'`);
		}
		const outcomeCheck = checks.rows.find((r) => r.conname === 'chk_scheduled_interviews_outcome');
		expect(outcomeCheck).toBeTruthy();
		for (const v of ['passed', 'failed', 'pending_review', 'no_decision']) {
			expect(outcomeCheck.def).toContain(`'${v}'`);
		}
		// Direct SQL: the widened value writes; a value in NO vocabulary still fails.
		const { id } = await newInterview('scheduled');
		await seedPool.query(`UPDATE scheduled_interviews SET status = 'reschedule_requested' WHERE id = $1`, [id]);
		expect((await readRow(id)).status).toBe('reschedule_requested');
		await expect(
			seedPool.query(`UPDATE scheduled_interviews SET status = 'bogus_status' WHERE id = $1`, [id]),
		).rejects.toMatchObject({ code: '23514' });
		expect((await readRow(id)).status).toBe('reschedule_requested');
	});

	test('candidate reschedules a SCHEDULED interview with reason + preferred time: 200, reschedule_requested, original time kept, reason in notes', async () => {
		const { id, scheduled_at } = await newInterview('scheduled');
		const res = await candReschedule(id, {
			reason: 'Family event - need to move',
			preferred_time: '2026-11-02T15:00:00.000Z',
		});
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.interview.status).toBe('reschedule_requested');
		const row = await readRow(id);
		expect(row.status).toBe('reschedule_requested');
		expect(new Date(row.scheduled_at).toISOString()).toBe(new Date(scheduled_at).toISOString());
		expect(row.outcome).toBeNull();
		expect(row.notes).toContain('[Reschedule request]');
		expect(row.notes).toContain('Family event - need to move');
		expect(row.notes).toContain('Preferred: 2026-11-02T15:00:00.000Z');
	});

	test('candidate reschedules a CONFIRMED interview: 200, reschedule_requested', async () => {
		const { id } = await newInterview('confirmed');
		const res = await candReschedule(id, { reason: 'Travel clash', preferred_time: '2026-11-03T10:00:00.000Z' });
		expect(res.status).toBe(200);
		const row = await readRow(id);
		expect(row.status).toBe('reschedule_requested');
		expect(row.notes).toContain('Travel clash');
	});

	test('no-reason API leg: reschedule with neither reason nor preferred time still 200 with the default note', async () => {
		const { id } = await newInterview('scheduled');
		const res = await candReschedule(id, {});
		expect(res.status).toBe(200);
		const row = await readRow(id);
		expect(row.status).toBe('reschedule_requested');
		expect(row.notes).toContain('Candidate requested reschedule');
	});

	test('resolution leg A — recruiter Confirm via PUT {status: confirmed}: 200, back to confirmed', async () => {
		const { id } = await newInterview('scheduled');
		expect((await candReschedule(id, { reason: 'Please move' })).status).toBe(200);
		expect((await readRow(id)).status).toBe('reschedule_requested');
		const res = await recPut(id, { status: 'confirmed' });
		expect(res.status).toBe(200);
		expect((await readRow(id)).status).toBe('confirmed');
	});

	test('resolution leg B — recruiter reschedules to a new time via PUT /api/interviews/reschedule: 200, scheduled at the NEW time', async () => {
		const { id } = await newInterview('scheduled');
		expect((await candReschedule(id, { reason: 'Please move' })).status).toBe(200);
		const newTime = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
		const res = await request(app)
			.put('/api/interviews/reschedule')
			.set('Authorization', `Bearer ${recToken}`)
			.send({ interview_id: id, new_scheduled_at: newTime });
		expect(res.status).toBe(200);
		const row = await readRow(id);
		expect(row.status).toBe('scheduled');
		expect(Math.abs(new Date(row.scheduled_at).getTime() - new Date(newTime).getTime())).toBeLessThan(1000);
	});

	test("W7: recruiter PUT with status 'reschedule_requested' -> 200 and persisted (canonical now)", async () => {
		const { id } = await newInterview('scheduled');
		const res = await recPut(id, { status: 'reschedule_requested' });
		expect(res.status).toBe(200);
		expect((await readRow(id)).status).toBe('reschedule_requested');
	});

	test.each([['maybe'], ['declined'], ['']])(
		"W7: recruiter PUT with invalid status '%s' -> honest 400, row unchanged",
		async (value) => {
			const { id } = await newInterview('scheduled');
			const res = await recPut(id, { status: value });
			expect(res.status).toBe(400);
			expect(res.body.error).toContain('Invalid interview status');
			const row = await readRow(id);
			expect(row.status).toBe('scheduled');
		},
	);

	test('W7: status null and status omitted keep the stored value (200, unchanged)', async () => {
		const { id } = await newInterview('confirmed');
		const withNull = await recPut(id, { status: null });
		expect(withNull.status).toBe(200);
		expect((await readRow(id)).status).toBe('confirmed');
		const omitted = await recPut(id, { feedback: { rating: 5 } });
		expect(omitted.status).toBe(200);
		expect((await readRow(id)).status).toBe('confirmed');
	});

	test.each([['completed'], ['cancelled']])(
		'candidate rescheduling a %s interview -> 404, row unchanged (guard unchanged)',
		async (status) => {
			const { id } = await newInterview(status);
			const res = await candReschedule(id, { reason: 'Please move' });
			expect(res.status).toBe(404);
			expect((await readRow(id)).status).toBe(status);
		},
	);

	test("candidate rescheduling ANOTHER candidate's interview -> 404, row unchanged", async () => {
		const { id } = await newInterview('scheduled');
		const res = await candReschedule(id, { reason: 'Not mine' }, cand2Token);
		expect(res.status).toBe(404);
		expect((await readRow(id)).status).toBe('scheduled');
	});
});
