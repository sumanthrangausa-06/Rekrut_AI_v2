/**
 * #1804 part (i) — runnable journey check (not jest/playwright; needs real Postgres).
 *
 * User journey under test, over real HTTP against the real candidate router
 * and a real (fresh-migrated) Postgres:
 *   candidate has a confirmed interview that (stale writer state) still
 *   carries an evaluation outcome → candidate requests a reschedule via
 *   PUT /api/candidate/interviews/:id/reschedule
 *   → the row must read back status='reschedule_requested', outcome=NULL
 *     (a not-yet-held interview has no evaluation outcome — the decline
 *     route in the same file already clears outcome for this reason, #1783),
 *     and the reschedule reason must be appended to notes (existing
 *     behaviour preserved).
 *
 * On the un-fixed code the outcome assertion FAILS (outcome stays 'passed').
 *
 * Run: node tests/interview-reschedule-clear-outcome-1804.check.js
 * Expects Postgres at 127.0.0.1:55433 (superuser postgres, no password);
 * creates/drops its own scratch database `rekrut_1804_check` and runs the
 * real migrate.js against it.
 */
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const ADMIN_URL = 'postgresql://postgres@127.0.0.1:55433/postgres';
const DB_NAME = 'rekrut_1804_check';
const DB_URL = `postgresql://postgres@127.0.0.1:55433/${DB_NAME}`;

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
	process.env.JWT_SECRET = 'check-1804-secret';

	const express = require('express');
	const pool = require('../lib/db');
	const { generateToken, hashPassword } = require('../lib/auth');

	const ins = await pool.query(
		`INSERT INTO users (name, email, password_hash, role)
		 VALUES ('Reschedule Check', 'reschedule-check@example.com', $1, 'candidate')
		 RETURNING id`,
		[await hashPassword('CheckPass123!')],
	);
	const candidateId = ins.rows[0].id;
	const token = generateToken({ id: candidateId, email: 'reschedule-check@example.com', role: 'candidate' });
	const authH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

	// company_id / job_id are NOT NULL on the migrated schema.
	const companyId = (await pool.query(`INSERT INTO companies (name) VALUES ('Check Co') RETURNING id`)).rows[0].id;
	const jobId = (await pool.query(
		`INSERT INTO jobs (title, company, company_id) VALUES ('Check Role', 'Check Co', $1) RETURNING id`,
		[companyId],
	)).rows[0].id;

	// Two lawful pre-states the route accepts: 'confirmed' and 'scheduled',
	// each carrying a stale outcome from a prior evaluation write.
	const seed = async (status, outcome) => {
		const r = await pool.query(
			`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, scheduled_at, status, outcome, notes)
			 VALUES ($1, $2, $3, NOW() + INTERVAL '2 days', $4, $5, 'Original note')
			 RETURNING id`,
			[companyId, jobId, candidateId, status, outcome],
		);
		return r.rows[0].id;
	};
	const confirmedId = await seed('confirmed', 'passed');
	const scheduledId = await seed('scheduled', 'failed');

	const app = express();
	app.use(express.json());
	app.use('/api/candidate', require('../routes/candidate'));
	const server = await new Promise((r) => {
		const s = app.listen(0, '127.0.0.1', () => r(s));
	});
	const base = `http://127.0.0.1:${server.address().port}`;

	try {
		for (const [label, id] of [['confirmed/passed', confirmedId], ['scheduled/failed', scheduledId]]) {
			console.log(`[check] reschedule leg: ${label}`);
			const res = await fetch(`${base}/api/candidate/interviews/${id}/reschedule`, {
				method: 'PUT',
				headers: authH,
				body: JSON.stringify({ reason: 'Family emergency', preferred_time: 'Next Monday 10am' }),
			});
			const body = await res.json();
			assert.strictEqual(res.status, 200, `reschedule HTTP ${res.status}: ${JSON.stringify(body)}`);
			assert.strictEqual(body.success, true, 'reschedule must report success');

			const row = (await pool.query('SELECT status, outcome, notes FROM scheduled_interviews WHERE id=$1', [id])).rows[0];
			assert.strictEqual(row.status, 'reschedule_requested', `status must be reschedule_requested, got '${row.status}'`);
			assert.strictEqual(row.outcome, null, `outcome must be cleared to NULL on reschedule, got '${row.outcome}' (stale outcome — #1804 part i)`);
			assert.ok(row.notes.includes('Original note'), 'existing notes must be preserved');
			assert.ok(row.notes.includes('[Reschedule request] Family emergency'), `reschedule reason must be appended to notes, got: ${row.notes}`);
			assert.ok(row.notes.includes('Preferred: Next Monday 10am'), 'preferred time must be appended to notes');
			// The response body is the same row the user sees.
			assert.strictEqual(body.interview.outcome, null, 'response interview.outcome must be NULL');
		}

		console.log('PASS #1804(i): reschedule clears stale outcome to NULL; status + notes append preserved.');
	} finally {
		server.close();
		await pool.end();
		const cleanup = new Client({ connectionString: ADMIN_URL });
		await cleanup.connect();
		await cleanup.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
		await cleanup.end();
	}
	process.exit(0);
}

main().catch((err) => {
	console.error('FAIL #1804(i):', err.message);
	process.exit(1);
});
