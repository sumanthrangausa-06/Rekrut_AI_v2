#!/usr/bin/env node
/**
 * audit-assessment-coverage.js — #1603 Phase C coverage job (design §7 rule 3,
 * story C0 / issue #1652).
 *
 * Reports the full assessment-bank coverage matrix: every topic × format ×
 * difficulty band × question count, SPLIT BY review_status. Only
 * review_status='approved' rows are servable supply (§7 rule 6) — pending
 * and rejected counts are shown so the review backlog can never masquerade
 * as supply.
 *
 * Bands (§5.1): easy = levels {1,2}, medium = {2,3,4}, hard = {4,5}. The
 * boundary overlap is deliberate (§7): a shared-level row counts in EACH
 * band it belongs to; counts are per-configuration availability, never a
 * partition of the bank, and are never deduplicated across bands.
 *
 * Formats: mcq / short_answer / coding are stored on bank rows (§3.4).
 * `mixed` is a computed union (§4.6) — servable(mixed) = servable(mcq) +
 * servable(short_answer) per band; the member sets are disjoint, so the
 * sum is exact. Coding is never a member of mixed.
 *
 * Flags (any flag → exit 1):
 *   (a) an ACTIVE topic below the §7 rule-2 floor: no (format, band)
 *       configuration with servable >= 10 (the smallest offered count);
 *   (b) bank rows with topic_id NULL (unmapped legacy rows — reported,
 *       never guessed into a topic);
 *   (c) a (topic, format, band) cell with 0 < servable < 10: partial
 *       supply in a band of an offered format, below the smallest
 *       offered count.
 *
 * Read-only. Usage:
 *   DATABASE_URL=postgresql://... node scripts/audit-assessment-coverage.js
 */
'use strict';

const pool = require('../lib/db');

const BANDS = {
	easy: [1, 2],
	medium: [2, 3, 4],
	hard: [4, 5],
};
const FORMATS = ['mcq', 'short_answer', 'coding'];
const FLOOR = 10; // §7 rule 2: smallest offered count

async function main() {
	const topicsRes = await pool.query(`
    SELECT s.id AS subject_id, s.slug AS subject_slug, s.name AS subject_name,
           s.is_active AS subject_active,
           t.id AS topic_id, t.slug AS topic_slug, t.name AS topic_name,
           t.legacy_skill_name, t.is_active AS topic_active
    FROM assessment_subjects s
    LEFT JOIN assessment_topics t ON t.subject_id = s.id
    ORDER BY s.sort_order, s.id, t.sort_order, t.id
  `);

	// Counts per (topic, format, difficulty_level, review_status).
	const countsRes = await pool.query(`
    SELECT topic_id, format, difficulty_level, review_status, COUNT(*)::int AS n
    FROM assessment_questions
    WHERE topic_id IS NOT NULL
    GROUP BY topic_id, format, difficulty_level, review_status
  `);
	const cell = new Map(); // key topic|format|level|status -> n
	for (const r of countsRes.rows) {
		cell.set(`${r.topic_id}|${r.format}|${r.difficulty_level}|${r.review_status}`, r.n);
	}
	const count = (topicId, format, band, status) =>
		BANDS[band].reduce(
			(sum, lvl) => sum + (cell.get(`${topicId}|${format}|${lvl}|${status}`) || 0),
			0,
		);
	const servable = (topicId, format, band) =>
		format === 'mixed'
			? count(topicId, 'mcq', band, 'approved') +
				count(topicId, 'short_answer', band, 'approved')
			: count(topicId, format, band, 'approved');

	const unmappedRes = await pool.query(`
    SELECT review_status, COUNT(*)::int AS n
    FROM assessment_questions
    WHERE topic_id IS NULL
    GROUP BY review_status
    ORDER BY review_status
  `);
	const unmappedTotal = unmappedRes.rows.reduce((s, r) => s + r.n, 0);
	const unclassifiedRes = await pool.query(`
    SELECT COUNT(*)::int AS n FROM assessment_questions WHERE format IS NULL
  `);

	const flags = [];
	const lines = [];
	lines.push('# Assessment coverage matrix — counts split by review_status');
	lines.push('# servable = approved only (§7 rule 6). Bands: easy {1,2} · medium {2,3,4} · hard {4,5} (overlap deliberate, §7).');
	lines.push('');

	let currentSubject = null;
	for (const row of topicsRes.rows) {
		if (row.subject_id !== currentSubject) {
			currentSubject = row.subject_id;
			lines.push(
				`## Subject: ${row.subject_name} (slug=${row.subject_slug}, active=${row.subject_active})`,
			);
		}
		if (row.topic_id === null) {
			lines.push('  (no topics seeded for this subject)');
			continue;
		}
		lines.push(
			`  Topic: ${row.topic_name} (id=${row.topic_id}, slug=${row.topic_slug}, legacy=${row.legacy_skill_name ?? '—'}, active=${row.topic_active})`,
		);
		let topicMaxServable = 0;
		for (const format of [...FORMATS, 'mixed']) {
			for (const band of Object.keys(BANDS)) {
				const approved =
					format === 'mixed'
						? servable(row.topic_id, 'mixed', band)
						: count(row.topic_id, format, band, 'approved');
				const pending =
					format === 'mixed'
						? count(row.topic_id, 'mcq', band, 'pending') +
							count(row.topic_id, 'short_answer', band, 'pending')
						: count(row.topic_id, format, band, 'pending');
				const rejected =
					format === 'mixed'
						? count(row.topic_id, 'mcq', band, 'rejected') +
							count(row.topic_id, 'short_answer', band, 'rejected')
						: count(row.topic_id, format, band, 'rejected');
				topicMaxServable = Math.max(topicMaxServable, approved);
				lines.push(
					`    ${format.padEnd(12)} ${band.padEnd(6)} approved=${approved} pending=${pending} rejected=${rejected}`,
				);
				if (approved > 0 && approved < FLOOR) {
					flags.push(
						`(c) ${row.subject_name} / ${row.topic_name} / ${format} / ${band}: servable=${approved} is below the smallest offered count (${FLOOR})`,
					);
				}
			}
		}
		if (row.topic_active && topicMaxServable < FLOOR) {
			flags.push(
				`(a) ACTIVE topic below floor: ${row.subject_name} / ${row.topic_name} — best configuration servable=${topicMaxServable} < ${FLOOR}`,
			);
		}
	}
	lines.push('');
	lines.push('## Unmapped bank rows (topic_id IS NULL)');
	if (unmappedTotal === 0) {
		lines.push('  none');
	} else {
		for (const r of unmappedRes.rows) lines.push(`  ${r.review_status}: ${r.n}`);
		flags.push(
			`(b) ${unmappedTotal} bank row(s) have topic_id NULL (unmapped legacy rows — see §6 step 2)`,
		);
	}
	lines.push(`  rows with format NULL (unclassified question_type): ${unclassifiedRes.rows[0].n}`);
	lines.push('');
	if (flags.length) {
		lines.push(`## FLAGS (${flags.length})`);
		for (const f of flags) lines.push(`  FLAG ${f}`);
	} else {
		lines.push('## FLAGS (0) — matrix clean');
	}
	console.log(lines.join('\n'));
	await pool.end();
	process.exit(flags.length ? 1 : 0);
}

main().catch(async (err) => {
	console.error('audit-assessment-coverage failed:', err.message);
	try {
		await pool.end();
	} catch {
		/* already closed */
	}
	process.exit(2);
});
