/**
 * #1759 — runnable check (not jest/playwright; needs a real Postgres).
 *
 * Repro: applyDocumentScoresToOmniScore() ran
 *   SET resume_score = omni_scores.resume_score + $2
 * When the stored resume_score is NULL, NULL + $2 = NULL: the function
 * returned score_change = totalImpact and marked the impacts applied,
 * yet resume_score never moved — the delta was silently swallowed and
 * lost (score_history also recorded a change that never happened).
 *
 * Honest behaviour (#1715 consistency / no fabricated scores):
 *  - existing row, resume_score NULL  -> apply nothing, do NOT mark the
 *    impacts applied, write no score_history row, report score_change 0
 *    with applied:false and unapplied_impact = the delta.
 *  - existing row, resume_score set   -> delta applies to resume + total.
 *  - no row yet (#1715)               -> fresh row: resume = delta,
 *    total stays NULL (never an invented 300 + impact).
 *
 * Run:
 *   node tests/document-verification-omniscore-null.check.js
 * Expects Postgres at 127.0.0.1:55433 (superuser postgres, no password);
 * creates/drops its own scratch database `rekrut_1759_check`.
 */
const assert = require('node:assert');
const { Client } = require('pg');

const ADMIN_URL = 'postgresql://postgres@127.0.0.1:55433/postgres';
const DB_NAME = 'rekrut_1759_check';
const DB_URL = `postgresql://postgres@127.0.0.1:55433/${DB_NAME}`;

async function main() {
	const admin = new Client({ connectionString: ADMIN_URL });
	await admin.connect();
	await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
	await admin.query(`CREATE DATABASE ${DB_NAME}`);
	await admin.end();

	// DATABASE_URL must be set before lib/db builds its pool.
	process.env.DATABASE_URL = DB_URL;
	const pool = require('../lib/db');
	const { applyDocumentScoresToOmniScore } = require('../services/document-verification');

	// Minimal schema per the real migrations, post-#1280/#290 (no score
	// defaults): 001 omni_scores + score_history, 009 document_score_impacts.
	await pool.query(`
		CREATE TABLE omni_scores (
			id SERIAL PRIMARY KEY,
			user_id INTEGER UNIQUE,
			total_score INTEGER,
			resume_score INTEGER,
			last_updated TIMESTAMP DEFAULT NOW(),
			created_at TIMESTAMP DEFAULT NOW()
		);
		CREATE TABLE score_history (
			id SERIAL PRIMARY KEY,
			user_id INTEGER,
			previous_score INTEGER,
			new_score INTEGER,
			change_amount INTEGER,
			change_reason VARCHAR(255),
			component_type VARCHAR(50),
			created_at TIMESTAMP DEFAULT NOW()
		);
		CREATE TABLE document_score_impacts (
			id SERIAL PRIMARY KEY,
			user_id INTEGER,
			document_id INTEGER,
			document_type VARCHAR(50),
			score_impact INTEGER NOT NULL,
			authenticity_score INTEGER,
			verification_status VARCHAR(50),
			applied_to_omniscore BOOLEAN DEFAULT false,
			applied_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT NOW()
		);
	`);

	const seedImpact = (userId, impact) =>
		pool.query(
			`INSERT INTO document_score_impacts
			   (user_id, document_id, document_type, score_impact, authenticity_score, verification_status)
			 VALUES ($1, $1, 'resume', $2, 90, 'verified')`,
			[userId, impact],
		);
	const omni = async (userId) =>
		(await pool.query('SELECT * FROM omni_scores WHERE user_id = $1', [userId])).rows[0];
	const impactApplied = async (userId) =>
		(await pool.query('SELECT applied_to_omniscore FROM document_score_impacts WHERE user_id = $1', [userId]))
			.rows[0].applied_to_omniscore;
	const historyCount = async (userId) =>
		(await pool.query('SELECT COUNT(*)::int AS n FROM score_history WHERE user_id = $1', [userId])).rows[0].n;

	// Case 1 — THE BUG: existing row, resume_score NULL, delta 50.
	await pool.query('INSERT INTO omni_scores (user_id, total_score, resume_score) VALUES (1, NULL, NULL)');
	await seedImpact(1, 50);
	const r1 = await applyDocumentScoresToOmniScore(1);
	console.log('case1 result:', JSON.stringify(r1), 'omni:', JSON.stringify(await omni(1)));
	assert.strictEqual(r1.score_change, 0, 'NULL resume: score_change must be 0 (delta unapplied), not the swallowed delta');
	assert.strictEqual(r1.applied, false, 'NULL resume: result must explicitly flag applied:false');
	assert.strictEqual(r1.unapplied_impact, 50, 'NULL resume: unapplied_impact must carry the delta');
	assert.strictEqual((await omni(1)).resume_score, null, 'NULL resume must stay NULL — no fabricated score');
	assert.strictEqual(await impactApplied(1), false, 'NULL resume: impact must stay unapplied so a later run can apply it');
	assert.strictEqual(await historyCount(1), 0, 'NULL resume: no score_history row for a change that never happened');

	// Case 2 — regression: measured resume_score 40 (+ total 400), delta 50.
	await pool.query('INSERT INTO omni_scores (user_id, total_score, resume_score) VALUES (2, 400, 40)');
	await seedImpact(2, 50);
	const r2 = await applyDocumentScoresToOmniScore(2);
	console.log('case2 result:', JSON.stringify(r2), 'omni:', JSON.stringify(await omni(2)));
	assert.strictEqual(r2.score_change, 50);
	assert.strictEqual((await omni(2)).resume_score, 90);
	assert.strictEqual((await omni(2)).total_score, 450);
	assert.strictEqual(await impactApplied(2), true);
	assert.strictEqual(await historyCount(2), 1);

	// Case 3 — #1715 fresh row: no omni_scores row yet, delta 50.
	await seedImpact(3, 50);
	const r3 = await applyDocumentScoresToOmniScore(3);
	console.log('case3 result:', JSON.stringify(r3), 'omni:', JSON.stringify(await omni(3)));
	assert.strictEqual(r3.score_change, 50);
	assert.strictEqual((await omni(3)).resume_score, 50);
	assert.strictEqual((await omni(3)).total_score, null, '#1715: fresh total must stay NULL, never 300 + impact');
	assert.strictEqual(await impactApplied(3), true);

	await pool.end();
	const cleanup = new Client({ connectionString: ADMIN_URL });
	await cleanup.connect();
	await cleanup.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
	await cleanup.end();
	console.log('PASS #1759: NULL resume delta reported unapplied (not swallowed, not fabricated); measured + fresh-row paths unchanged');
}

main().catch((err) => {
	console.error('FAIL #1759:', err.message);
	process.exit(1);
});
