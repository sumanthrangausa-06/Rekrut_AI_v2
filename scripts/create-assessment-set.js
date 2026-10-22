#!/usr/bin/env node
/**
 * create-assessment-set.js — #1656 (#1603 Phase C story C3, R1/R2).
 *
 * The INTERNAL set-creation path: sets are created at seed/test time by
 * this script (or by test fixtures calling createAssessmentSet with
 * their own client) — C3 ships NO HTTP admin endpoint and NO UI for set
 * authoring, and NO hand-authored content sets for real topics (real
 * curated sets are C5 content work; R1 as narrowed by amendment Q2).
 *
 * A set is a named, ordered question selection for one topic (§3.3):
 *   assessment_sets(topic_id, name, format, difficulty_band, is_active)
 *   assessment_set_questions(set_id, question_id, position 1..n)
 * Serving reads only review_status='approved' members (§7 rule 6), so a
 * set created over unapproved questions simply has less servable supply
 * — the count is reported back here so the creator sees it immediately.
 *
 * Usage (CLI):
 *   node scripts/create-assessment-set.js \
 *     --topic-id 20 --name "Python Core — Set A" --format mcq \
 *     --band medium --questions 101,102,103
 *
 * Env: DATABASE_URL (same convention as migrate.js / the coverage job).
 */
const pool = require('../lib/db');

const FORMATS = ['mcq', 'short_answer', 'mixed', 'coding'];
const BANDS = ['easy', 'medium', 'hard'];

/**
 * Create one set + its ordered membership in a single transaction.
 * `client` is any pg-style client (the app pool works: it has .connect).
 * Throws on invalid input or an unknown topic — creation fails loudly,
 * never partially: the transaction rolls back with no set row left.
 * Returns { setId, questionCount, approvedCount }.
 */
async function createAssessmentSet(client, { topicId, name, format, difficultyBand, questionIds, isActive = true }) {
	if (!Number.isInteger(topicId)) throw new Error('topicId must be an integer');
	if (!name || typeof name !== 'string') throw new Error('name is required');
	if (!FORMATS.includes(format)) throw new Error(`format must be one of ${FORMATS.join(', ')}`);
	if (!BANDS.includes(difficultyBand)) throw new Error(`difficultyBand must be one of ${BANDS.join(', ')}`);
	if (!Array.isArray(questionIds) || questionIds.length === 0 || !questionIds.every(Number.isInteger)) {
		throw new Error('questionIds must be a non-empty array of integer question ids, in serving order');
	}
	if (new Set(questionIds).size !== questionIds.length) throw new Error('questionIds must not contain duplicates');

	const conn = client.connect ? await client.connect() : client;
	try {
		await conn.query('BEGIN');
		const topic = await conn.query('SELECT id FROM assessment_topics WHERE id = $1', [topicId]);
		if (topic.rows.length === 0) throw new Error(`topic ${topicId} does not exist`);
		const found = await conn.query('SELECT id, review_status FROM assessment_questions WHERE id = ANY($1::int[])', [
			questionIds,
		]);
		if (found.rows.length !== questionIds.length) {
			const known = new Set(found.rows.map((r) => r.id));
			const missing = questionIds.filter((id) => !known.has(id));
			throw new Error(`unknown question ids: ${missing.join(', ')}`);
		}
		const setResult = await conn.query(
			`INSERT INTO assessment_sets (topic_id, name, format, difficulty_band, is_active)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			[topicId, name, format, difficultyBand, isActive],
		);
		const setId = setResult.rows[0].id;
		for (let i = 0; i < questionIds.length; i++) {
			await conn.query(
				'INSERT INTO assessment_set_questions (set_id, question_id, position) VALUES ($1, $2, $3)',
				[setId, questionIds[i], i + 1],
			);
		}
		await conn.query('COMMIT');
		const approvedCount = found.rows.filter((r) => r.review_status === 'approved').length;
		return { setId, questionCount: questionIds.length, approvedCount };
	} catch (error) {
		await conn.query('ROLLBACK').catch(() => {});
		throw error;
	} finally {
		if (client.connect) conn.release();
	}
}

async function main(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i += 2) {
		if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1];
	}
	const questionIds = String(args.questions || '')
		.split(',')
		.map((s) => parseInt(s.trim(), 10))
		.filter((n) => Number.isInteger(n));
	const result = await createAssessmentSet(pool, {
		topicId: parseInt(args['topic-id'], 10),
		name: args.name,
		format: args.format,
		difficultyBand: args.band,
		questionIds,
	});
	console.log(
		`Created assessment set ${result.setId}: ${result.questionCount} questions (${result.approvedCount} approved/servable)`,
	);
	await pool.end();
}

if (require.main === module) {
	main(process.argv.slice(2)).catch((error) => {
		console.error('Failed to create assessment set:', error.message);
		process.exit(1);
	});
}

module.exports = { createAssessmentSet };
