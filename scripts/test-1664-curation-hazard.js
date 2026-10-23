#!/usr/bin/env node
/**
 * test-1664-curation-hazard.js — RED/GREEN proof for issue #1664.
 *
 * Hazard: migration 280's original curation key matched migration 006's
 * seed batch on identity alone, so a same-identity duplicate with a WRONG
 * correct_answer was approved as scored truth.
 *
 * Method (no mocks — a real throwaway Postgres DB built only by migrate.js):
 *   1. Create a throwaway DB on the local Postgres (127.0.0.1:55433) and run
 *      the FULL migration chain via `node migrate.js`.
 *   2. REWIND the chain to just before migration 280: drop the columns 280
 *      added, delete 281's seed rows, forget _migrations 280/281/282. The
 *      bank is now exactly the pre-280 state (the 6 genuine migration-006
 *      rows, base columns only).
 *   3. Insert two hazard rows that share a seed identity but diverge in
 *      content: a typeof-null duplicate with correct_answer 'null', and a
 *      React seed copy with the answer edited to 'useState'.
 *   4. Re-run `node migrate.js` — migrations 280+ run against a bank that
 *      already contains the hazard rows, exactly as a real pre-existing
 *      bank would present them.
 *   5. Read back every row's source/review_status, print verdicts, and
 *      ASSERT them (#1667): any mismatch exits non-zero with a FAIL line.
 *   6. If migration 282 exists in this checkout (GREEN), also prove its
 *      demote path directly: insert a NEW poisoned row already marked
 *      curated+approved (the state a loose-280 database is left in), run
 *      282's up() against it, read back the demotion, then run up() again
 *      to prove idempotency.
 *
 * RED expectation (unpatched dev checkout, no 282): both hazard rows come
 * out source='curated', review_status='approved'; curated+approved total 8.
 * GREEN expectation (this fix): both hazard rows stay legacy/pending, the
 * post-chain poison is demoted by 282, curated+approved total is exactly
 * the 6 genuine seed rows, and JavaScript mcq approved supply is 2 (the
 * genuine rows), not inflated.
 *
 * Usage: node scripts/test-1664-curation-hazard.js <LABEL> [--keep]
 *   --keep leaves the throwaway DB in place and prints its name so
 *   scripts/audit-assessment-coverage.js can be run against it.
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');

const REPO = path.join(__dirname, '..');
const ADMIN_URL = 'postgresql://postgres@127.0.0.1:55433/postgres';
const label = (process.argv[2] || 'run').toLowerCase().replace(/[^a-z0-9]/g, '');
const keep = process.argv.includes('--keep');
const dbName = `rekrut_1664_hazard_${label}_${process.pid}`;
const dbUrl = `postgresql://postgres@127.0.0.1:55433/${dbName}`;

// #1667: real assertions — a mismatch records a FAIL line and forces a
// non-zero exit at the end of main() (previously verdicts were print-only
// and the process exited 0 even when a hazard came out approved).
const failures = [];
function check(name, ok, detail) {
	console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
	if (!ok) failures.push(name);
}

function runMigrate(phase) {
	console.log(`\n--- migrate.js (${phase}) against ${dbName} ---`);
	const res = spawnSync('node', ['migrate.js'], {
		cwd: REPO,
		env: { ...process.env, DATABASE_URL: dbUrl },
		encoding: 'utf8',
		timeout: 900000,
		maxBuffer: 64 * 1024 * 1024,
	});
	const out = `${res.stdout || ''}\n${res.stderr || ''}`;
	for (const line of out.split('\n')) {
		if (/280|282|curation|demot|error|fail/i.test(line)) console.log(`  [migrate] ${line}`);
	}
	if (res.status !== 0) {
		console.log(out.split('\n').slice(-40).join('\n'));
		throw new Error(`migrate.js (${phase}) exited with status ${res.status}`);
	}
	console.log(`  [migrate] exit 0`);
}

async function main() {
	const admin = new Client({ connectionString: ADMIN_URL });
	await admin.connect();
	await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
	await admin.query(`CREATE DATABASE ${dbName}`);
	await admin.end();
	console.log(`Throwaway DB created: ${dbName}`);

	const client = new Client({ connectionString: dbUrl });
	await client.connect();
	try {
		runMigrate('phase 1: full chain');

		// ── Rewind to pre-280 ─────────────────────────────────────────────
		await client.query(
			`DELETE FROM _migrations WHERE name IN ('280_assessment_question_provenance','281_seed_group_a_question_bank','282_curation_content_integrity')`,
		);
		await client.query(`DELETE FROM assessment_questions WHERE source = 'seed'`);
		await client.query(`
      ALTER TABLE assessment_questions
        DROP COLUMN IF EXISTS topic_id,
        DROP COLUMN IF EXISTS format,
        DROP COLUMN IF EXISTS mcq_subtype,
        DROP COLUMN IF EXISTS coding_template_id,
        DROP COLUMN IF EXISTS source,
        DROP COLUMN IF EXISTS review_status
    `);
		await client.query(`
      ALTER TABLE assessment_sessions
        DROP COLUMN IF EXISTS subject_id,
        DROP COLUMN IF EXISTS topic_id,
        DROP COLUMN IF EXISTS set_id,
        DROP COLUMN IF EXISTS format,
        DROP COLUMN IF EXISTS difficulty_band,
        DROP COLUMN IF EXISTS total_questions
    `);
		const pre = await client.query(`SELECT COUNT(*)::int AS n FROM assessment_questions`);
		console.log(`\nRewound to pre-280 state: ${pre.rows[0].n} bank rows (expect 6 genuine seed rows)`);

		// ── Insert hazard rows (identity matches seed, content diverged) ──
		const h1 = await client.query(`
      INSERT INTO assessment_questions (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds)
      VALUES ('JavaScript', 2, 'multiple_choice', 'What is the output of: console.log(typeof null)?',
        '["object", "null", "undefined", "number"]'::jsonb, 'null',
        'typeof null returns "object" - this is a known JavaScript quirk/bug that has been preserved for backwards compatibility.', 90)
      RETURNING id
    `);
		const h2 = await client.query(`
      INSERT INTO assessment_questions (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds)
      VALUES ('React', 2, 'multiple_choice', 'Which hook is used to perform side effects in React?',
        '["useEffect", "useState", "useMemo", "useCallback"]'::jsonb, 'useState',
        'useEffect is the React hook for handling side effects like data fetching, subscriptions, or DOM manipulation.', 60)
      RETURNING id
    `);
		console.log(`Hazard rows inserted: typeof-null poison id=${h1.rows[0].id} (correct_answer 'null'), React edited-answer id=${h2.rows[0].id} (correct_answer 'useState')`);

		runMigrate('phase 2: migrations 280+ over the hazard bank');

		// ── Read back ─────────────────────────────────────────────────────
		const rows = await client.query(`
      SELECT id, skill_category, difficulty_level, question_text, correct_answer, source, review_status
      FROM assessment_questions ORDER BY id
    `);
		console.log('\n--- Bank state after 280+ ---');
		for (const r of rows.rows) {
			console.log(`  id=${r.id} ${r.skill_category} d${r.difficulty_level} correct=${JSON.stringify(r.correct_answer)} source=${r.source} review_status=${r.review_status} :: ${r.question_text.slice(0, 60)}`);
		}
		const hazard1 = rows.rows.find((r) => r.id === h1.rows[0].id);
		const hazard2 = rows.rows.find((r) => r.id === h2.rows[0].id);
		const approvedTotal = await client.query(
			`SELECT COUNT(*)::int AS n FROM assessment_questions WHERE source='curated' AND review_status='approved'`,
		);
		const jsMcq = await client.query(
			`SELECT COUNT(*)::int AS n FROM assessment_questions WHERE skill_category='JavaScript' AND format='mcq' AND review_status='approved'`,
		);
		console.log('\n--- VERDICTS ---');
		console.log(`HAZARD typeof-null poison (id=${hazard1.id}): source=${hazard1.source} review_status=${hazard1.review_status}`);
		console.log(`HAZARD React edited-answer (id=${hazard2.id}): source=${hazard2.source} review_status=${hazard2.review_status}`);
		console.log(`curated+approved total: ${approvedTotal.rows[0].n} (genuine seed rows = 6)`);
		console.log(`JavaScript mcq approved supply: ${jsMcq.rows[0].n} (genuine = 2)`);
		console.log('\n--- ASSERTIONS (#1667) ---');
		const isCuratedApproved = (r) => r.source === 'curated' && r.review_status === 'approved';
		check('(a) hazard typeof-null poison is NOT curated+approved', !isCuratedApproved(hazard1), `source=${hazard1.source} review_status=${hazard1.review_status}`);
		check('(a) hazard React edited-answer is NOT curated+approved', !isCuratedApproved(hazard2), `source=${hazard2.source} review_status=${hazard2.review_status}`);
		check('(b) curated+approved total == 6 (genuine seed rows)', approvedTotal.rows[0].n === 6, `got ${approvedTotal.rows[0].n}`);
		check('(c) JavaScript MCQ approved supply == 2', jsMcq.rows[0].n === 2, `got ${jsMcq.rows[0].n}`);

		// ── Phase 3: 282 demote path (GREEN checkouts only) ──────────────
		const mig282 = path.join(REPO, 'migrations', '282_curation_content_integrity.js');
		if (fs.existsSync(mig282)) {
			const poison = await client.query(`
        INSERT INTO assessment_questions (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds, topic_id, format, source, review_status)
        SELECT skill_category, difficulty_level, question_type, question_text, options, 'null', explanation, time_limit_seconds, topic_id, format, 'curated', 'approved'
        FROM assessment_questions
        WHERE question_text = 'What is the output of: console.log(typeof null)?' AND correct_answer = 'object'
        RETURNING id
      `);
			console.log(`\nPhase 3: post-chain poison inserted already curated+approved, id=${poison.rows[0].id}`);
			const mig = require(mig282);
			await client.query('BEGIN');
			try {
				await mig.up(client);
				await client.query('COMMIT');
			} catch (e) {
				await client.query('ROLLBACK');
				throw e;
			}
			const after = await client.query(`SELECT source, review_status FROM assessment_questions WHERE id=$1`, [poison.rows[0].id]);
			console.log(`Phase 3: after 282 up() — poison row source=${after.rows[0].source} review_status=${after.rows[0].review_status}`);
			check('(d) Phase-3 poison row demoted by migration 282 up()', !isCuratedApproved(after.rows[0]), `source=${after.rows[0].source} review_status=${after.rows[0].review_status}`);
			await client.query('BEGIN');
			try {
				await mig.up(client);
				await client.query('COMMIT');
			} catch (e) {
				await client.query('ROLLBACK');
				throw e;
			}
			const again = await client.query(`SELECT source, review_status FROM assessment_questions WHERE id=$1`, [poison.rows[0].id]);
			const total2 = await client.query(
				`SELECT COUNT(*)::int AS n FROM assessment_questions WHERE source='curated' AND review_status='approved'`,
			);
			console.log(`Phase 3: 282 up() re-run (idempotency) passed; poison row still source=${again.rows[0].source} review_status=${again.rows[0].review_status}; curated+approved total still ${total2.rows[0].n}`);
			check('(d) Phase-3 poison row still demoted after idempotent 282 re-run', !isCuratedApproved(again.rows[0]), `source=${again.rows[0].source} review_status=${again.rows[0].review_status}`);
			check('(d) curated+approved total unchanged after 282 re-run', total2.rows[0].n === approvedTotal.rows[0].n, `before=${approvedTotal.rows[0].n} after=${total2.rows[0].n}`);
		} else {
			console.log('\nPhase 3 skipped: migration 282 not present in this checkout (RED baseline).');
			check('(d) migration 282 present for Phase-3 demotion check', false, 'migrations/282_curation_content_integrity.js not found');
		}
		if (failures.length > 0) {
			throw new Error(`FAIL: ${failures.length} assertion(s) failed: ${failures.join('; ')}`);
		}
		console.log('\nALL ASSERTIONS PASSED');
	} finally {
		await client.end();
		if (keep) {
			console.log(`\nKEPT_DB=${dbName}`);
			console.log(`DATABASE_URL=${dbUrl}`);
		} else {
			const admin2 = new Client({ connectionString: ADMIN_URL });
			await admin2.connect();
			await admin2.query(`DROP DATABASE IF EXISTS ${dbName}`);
			await admin2.end();
			console.log(`\nThrowaway DB dropped: ${dbName}`);
		}
	}
}

main().catch((err) => {
	console.error('test-1664-curation-hazard FAILED:', err);
	process.exit(1);
});
