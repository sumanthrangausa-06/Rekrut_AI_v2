/**
 * #1804 part (ii) — runnable journey check (not jest; needs real Postgres).
 *
 * User journey under test, over real HTTP against the real recruiter router
 * and a real (fresh-migrated) Postgres:
 *   a recruiter updates a scheduled interview via
 *   PUT /api/recruiter/interviews/:id. Rex's design (issue #1804): judge the
 *   RESULTING (effective) status — validated incoming status if sent, else
 *   stored status. While the effective status is in the rescheduled family
 *   {rescheduled, reschedule_requested}, an outcome-write (outcome non-null)
 *   or a feedback-write (truthy feedback) must be rejected 400 with the row
 *   unchanged; every other combination passes unchanged — including the
 *   lawful same-call completion the real client sends
 *   ({status:'completed', outcome, feedback}) which moves the row OUT of
 *   the family. Lead ruling (adopted): a status-only move INTO the family
 *   clears outcome to NULL in the same UPDATE (feedback preserved),
 *   mirroring part (i) PR #1849 and the decline precedent.
 *
 * Covers Rex's T1–T11 (T5/T12 are re-runs of the existing #1789 suite and
 * the #1801 calculator suites, run alongside this file — see the PR).
 *
 * On the un-fixed code T1/T2/T3 fail (the writes land, HTTP 200) and T10
 * fails (the stale outcome is kept).
 *
 * Run: node tests/interview-recruiter-put-guard-1804.check.js
 * Expects Postgres at 127.0.0.1:55433 (superuser postgres, no password);
 * creates/drops its own scratch database `rekrut_1804ii_check` and runs
 * the real migrate.js against it.
 */
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const ADMIN_URL = 'postgresql://postgres@127.0.0.1:55433/postgres';
const DB_NAME = 'rekrut_1804ii_check';
const DB_URL = `postgresql://postgres@127.0.0.1:55433/${DB_NAME}`;

const GUARD_ERROR = (s) =>
	`Interview outcome and feedback cannot be recorded while the interview is rescheduled (status: ${s}). Set the interview to completed first, then save the outcome and feedback.`;

const FEEDBACK = {
	rating: 4,
	strengths: 'Strong system design',
	weaknesses: 'Slow on follow-ups',
	notes: 'Would work well with the platform team',
};

const failures = [];
async function check(label, fn) {
	try {
		await fn();
		console.log(`PASS ${label}`);
	} catch (err) {
		failures.push(`${label}: ${err.message}`);
		console.log(`FAIL ${label}: ${err.message}`);
	}
}

async function main() {
	const admin = new Client({ connectionString: ADMIN_URL });
	await admin.connect();
	await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
	await admin.query(`CREATE DATABASE ${DB_NAME}`);
	await admin.end();

	// Fresh-install schema: the real migration chain, nothing hand-rolled.
	execFileSync('node', ['migrate.js'], {
		cwd: require('node:path').join(__dirname, '..'),
		env: { ...process.env, DATABASE_URL: DB_URL },
		stdio: 'pipe',
		timeout: 600000,
	});

	// Env must be set before lib/db / lib/auth build from it.
	process.env.DATABASE_URL = DB_URL;
	process.env.JWT_SECRET = 'check-1804ii-secret';

	const express = require('express');
	const pool = require('../lib/db');
	const { generateToken, hashPassword } = require('../lib/auth');

	const companyId = (await pool.query(`INSERT INTO companies (name) VALUES ('Check Co') RETURNING id`)).rows[0].id;
	const jobId = (await pool.query(
		`INSERT INTO jobs (title, company, company_id) VALUES ('Check Role', 'Check Co', $1) RETURNING id`,
		[companyId],
	)).rows[0].id;
	const candidateId = (await pool.query(
		`INSERT INTO users (name, email, password_hash, role)
		 VALUES ('Guard Candidate', 'guard-candidate@example.com', $1, 'candidate') RETURNING id`,
		[await hashPassword('CheckPass123!')],
	)).rows[0].id;
	const recruiterId = (await pool.query(
		`INSERT INTO users (name, email, password_hash, role, company_id)
		 VALUES ('Guard Recruiter', 'guard-recruiter@example.com', $1, 'recruiter', $2) RETURNING id`,
		[await hashPassword('CheckPass123!'), companyId],
	)).rows[0].id;
	const token = generateToken({ id: recruiterId, email: 'guard-recruiter@example.com', role: 'recruiter' });
	const authH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

	const seed = async ({ status, outcome = null, feedback = null }) => {
		const r = await pool.query(
			`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, recruiter_id, scheduled_at, status, outcome, feedback)
			 VALUES ($1, $2, $3, $4, NOW() - INTERVAL '1 day', $5, $6, $7)
			 RETURNING id`,
			[companyId, jobId, candidateId, recruiterId, status, outcome, feedback ? JSON.stringify(feedback) : null],
		);
		return r.rows[0].id;
	};
	const readRow = async (id) =>
		(await pool.query('SELECT status, outcome, feedback, meeting_link FROM scheduled_interviews WHERE id=$1', [id])).rows[0];
	const parseFb = (fb) => (typeof fb === 'string' ? JSON.parse(fb) : fb);

	const app = express();
	app.use(express.json());
	app.use('/api/recruiter', require('../routes/recruiter'));
	const server = await new Promise((r) => {
		const s = app.listen(0, '127.0.0.1', () => r(s));
	});
	const base = `http://127.0.0.1:${server.address().port}`;
	const put = async (id, body) => {
		const res = await fetch(`${base}/api/recruiter/interviews/${id}`, {
			method: 'PUT',
			headers: authH,
			body: JSON.stringify(body),
		});
		return { status: res.status, body: await res.json() };
	};

	try {
		// T1: stale-write in the same call that moves the row INTO the family.
		for (const target of ['rescheduled', 'reschedule_requested']) {
			await check(`T1 same-call move into '${target}' + outcome + feedback -> 400, row unchanged`, async () => {
				const id = await seed({ status: 'confirmed' });
				const res = await put(id, { status: target, outcome: 'passed', feedback: { ...FEEDBACK } });
				assert.strictEqual(res.status, 400, `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
				assert.strictEqual(res.body.error, GUARD_ERROR(target));
				const row = await readRow(id);
				assert.strictEqual(row.status, 'confirmed', 'row status must be unchanged');
				assert.strictEqual(row.outcome, null, 'row outcome must be unchanged');
				assert.strictEqual(row.feedback, null, 'row feedback must be unchanged');
			});
		}

		// T2: outcome-only and feedback-only writes on a family row.
		await check('T2a outcome-only on rescheduled row -> 400, row unchanged', async () => {
			const id = await seed({ status: 'rescheduled' });
			const res = await put(id, { outcome: 'passed' });
			assert.strictEqual(res.status, 400, `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
			assert.strictEqual(res.body.error, GUARD_ERROR('rescheduled'));
			assert.strictEqual((await readRow(id)).outcome, null);
		});
		await check('T2b feedback-only on rescheduled row -> 400, row unchanged', async () => {
			const id = await seed({ status: 'rescheduled' });
			const res = await put(id, { feedback: { ...FEEDBACK } });
			assert.strictEqual(res.status, 400, `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
			assert.strictEqual(res.body.error, GUARD_ERROR('rescheduled'));
			assert.strictEqual((await readRow(id)).feedback, null);
		});
		await check("T2c client-default outcome 'completed' counts as an outcome-write on a family row -> 400", async () => {
			const id = await seed({ status: 'reschedule_requested' });
			const res = await put(id, { outcome: 'completed' });
			assert.strictEqual(res.status, 400, `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
			assert.strictEqual(res.body.error, GUARD_ERROR('reschedule_requested'));
			assert.strictEqual((await readRow(id)).outcome, null);
		});

		// T3: already in family, no status sent — stored status is effective.
		await check('T3 already reschedule_requested, no status, outcome write -> 400', async () => {
			const id = await seed({ status: 'reschedule_requested' });
			const res = await put(id, { outcome: 'failed', feedback: { ...FEEDBACK } });
			assert.strictEqual(res.status, 400, `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
			assert.strictEqual(res.body.error, GUARD_ERROR('reschedule_requested'));
			const row = await readRow(id);
			assert.strictEqual(row.status, 'reschedule_requested');
			assert.strictEqual(row.outcome, null);
		});

		// T4: lawful completion OUT of the family, exact client body.
		await check('T4 completion out of family with exact client body -> 200, feedback verbatim', async () => {
			const id = await seed({ status: 'reschedule_requested' });
			const res = await put(id, { status: 'completed', outcome: 'passed', feedback: { ...FEEDBACK } });
			assert.strictEqual(res.status, 200, `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
			const row = await readRow(id);
			assert.strictEqual(row.status, 'completed');
			assert.strictEqual(row.outcome, 'passed');
			assert.deepStrictEqual(parseFb(row.feedback), FEEDBACK);
		});
		await check("T4b client hire-vocabulary completion out of family ('strong_hire') -> 200, stored 'passed'", async () => {
			const id = await seed({ status: 'rescheduled' });
			const res = await put(id, { status: 'completed', outcome: 'strong_hire', feedback: { ...FEEDBACK } });
			assert.strictEqual(res.status, 200, `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
			const row = await readRow(id);
			assert.strictEqual(row.status, 'completed');
			assert.strictEqual(row.outcome, 'passed');
			assert.deepStrictEqual(parseFb(row.feedback), FEEDBACK);
		});

		// T5: ordinary completion on a non-family row (the #1789 suite itself
		// is re-run alongside this file — see PR evidence).
		await check('T5 ordinary completion on scheduled row -> 200 completed/passed', async () => {
			const id = await seed({ status: 'scheduled' });
			const res = await put(id, { status: 'completed', outcome: 'hire', feedback: { ...FEEDBACK } });
			assert.strictEqual(res.status, 200, `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
			const row = await readRow(id);
			assert.strictEqual(row.status, 'completed');
			assert.strictEqual(row.outcome, 'passed');
		});

		// T6: Confirm a reschedule request — status-only, out of the family.
		await check("T6 Confirm flow {status:'confirmed'} only on reschedule_requested row -> 200", async () => {
			const id = await seed({ status: 'reschedule_requested' });
			const res = await put(id, { status: 'confirmed' });
			assert.strictEqual(res.status, 200, `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
			assert.strictEqual((await readRow(id)).status, 'confirmed');
		});

		// T7: separate-calls flow — complete first, then outcome/feedback.
		await check('T7 separate-calls flow -> 200s, final row completed/passed/feedback', async () => {
			const id = await seed({ status: 'rescheduled' });
			const first = await put(id, { status: 'completed' });
			assert.strictEqual(first.status, 200, `first HTTP ${first.status}: ${JSON.stringify(first.body)}`);
			const second = await put(id, { outcome: 'passed', feedback: { ...FEEDBACK } });
			assert.strictEqual(second.status, 200, `second HTTP ${second.status}: ${JSON.stringify(second.body)}`);
			const row = await readRow(id);
			assert.strictEqual(row.status, 'completed');
			assert.strictEqual(row.outcome, 'passed');
			assert.deepStrictEqual(parseFb(row.feedback), FEEDBACK);
		});

		// T8: meeting_link-only update on a family row is not an outcome write.
		await check('T8 meeting_link-only on rescheduled row -> 200, link saved, status kept', async () => {
			const id = await seed({ status: 'rescheduled' });
			const res = await put(id, { meeting_link: 'https://meet.example.com/guard-check' });
			assert.strictEqual(res.status, 200, `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
			const row = await readRow(id);
			assert.strictEqual(row.meeting_link, 'https://meet.example.com/guard-check');
			assert.strictEqual(row.status, 'rescheduled');
		});

		// T9: falsy feedback is not a write; empty body is not a write.
		await check('T9 falsy feedback on rescheduled row -> 200, stored feedback kept', async () => {
			const id = await seed({ status: 'rescheduled', feedback: { ...FEEDBACK } });
			const res = await put(id, { feedback: '' });
			assert.strictEqual(res.status, 200, `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
			assert.deepStrictEqual(parseFb((await readRow(id)).feedback), FEEDBACK);
			const empty = await put(id, {});
			assert.strictEqual(empty.status, 200, `empty-body HTTP ${empty.status}: ${JSON.stringify(empty.body)}`);
		});

		// T10 (Lead ruling ADOPTED): status-only move INTO the family clears
		// a stale outcome to NULL; feedback is preserved.
		for (const target of ['rescheduled', 'reschedule_requested']) {
			await check(`T10 status-only move into '${target}' -> 200, outcome NULL, feedback preserved`, async () => {
				const id = await seed({ status: 'completed', outcome: 'passed', feedback: { ...FEEDBACK } });
				const res = await put(id, { status: target });
				assert.strictEqual(res.status, 200, `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
				const row = await readRow(id);
				assert.strictEqual(row.status, target);
				assert.strictEqual(row.outcome, null, `outcome must be cleared to NULL, got '${row.outcome}'`);
				assert.deepStrictEqual(parseFb(row.feedback), FEEDBACK);
			});
		}

		// T11: vocabulary validation still runs first (400 before 404), and
		// the 404 shape for a genuinely missing row is unchanged.
		await check('T11 vocabulary error precedes 404; valid write to missing row -> 404 shape', async () => {
			const missing = 99999999;
			const badOutcome = await put(missing, { outcome: 'maybe' });
			assert.strictEqual(badOutcome.status, 400, `bad-outcome HTTP ${badOutcome.status}`);
			assert.ok(String(badOutcome.body.error).startsWith('Invalid interview outcome: maybe'));
			const badStatus = await put(missing, { status: 'bogus' });
			assert.strictEqual(badStatus.status, 400, `bad-status HTTP ${badStatus.status}`);
			assert.ok(String(badStatus.body.error).startsWith('Invalid interview status: bogus'));
			const notFound = await put(missing, { outcome: 'passed' });
			assert.strictEqual(notFound.status, 404, `missing-row HTTP ${notFound.status}`);
			assert.strictEqual(notFound.body.error, 'Interview not found');
			// Guard rejection on a missing row must not leak a different shape:
			// a family-effective write to a missing row is still the plain 404.
			const guardMissing = await put(missing, { status: 'rescheduled', outcome: 'passed' });
			assert.strictEqual(guardMissing.status, 404, `guard-missing HTTP ${guardMissing.status}`);
			assert.strictEqual(guardMissing.body.error, 'Interview not found');
		});

		if (failures.length) {
			console.error(`FAIL #1804(ii): ${failures.length} check(s) failed:\n - ${failures.join('\n - ')}`);
			process.exitCode = 1;
		} else {
			console.log('PASS #1804(ii): recruiter PUT cross-field guard — family writes rejected, lawful flows unchanged, status-only move into family clears outcome.');
		}
	} finally {
		server.close();
		await pool.end();
		const cleanup = new Client({ connectionString: ADMIN_URL });
		await cleanup.connect();
		await cleanup.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
		await cleanup.end();
	}
	// Imported services keep timers alive; exit explicitly with the result.
	process.exit(process.exitCode ? 1 : 0);
}

main().catch((err) => {
	console.error('FAIL #1804(ii):', err.message);
	process.exit(1);
});
