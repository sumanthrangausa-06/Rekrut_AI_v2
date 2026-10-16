/**
 * recompute-honest-null-scores.js — one-time heal for legacy persisted score
 * rows (#1192, code-review gate delta on the honest-null PR).
 *
 * WHAT IT HEALS
 * Rows written BEFORE the honest-null contract shipped: omni_scores seeded at
 * the 300 starter literal or floor-computed (e.g. 352), trust_scores holding
 * the STARTING 500 or a recomputed 0. Compute-on-read paths self-heal the
 * moment the fix deploys, but direct-read payloads — the candidate profile
 * LEFT JOIN, dashboard-stats, memory reads, the public trust profile by slug,
 * compareCompanies / mutual-match — serve stored rows verbatim, indefinitely.
 * This script rewrites every stored row through the post-fix engines so those
 * readers serve healed values.
 *
 * WHY THE ENGINE ARBITRATES (no SQL heuristics, no value tests)
 * A genuine 300 is indistinguishable from a seeded 300. Hand-rolling a
 * "looks fabricated" test would eventually erase a real score — the worse
 * sin. So this script contains NO judgement of its own: for each row it asks
 * the engine's own no-data predicate (omniscore.hasScoreData /
 * trustscore.hasTrustScoreData) and, in --live mode, calls the engine's
 * recompute (calculateScore / calculateTrustScore). No inputs → NULL is
 * persisted. Any genuine input → the same number the engine computes today.
 *
 * DEPLOY STEP (promotion checklist, #1192)
 * Run ONCE at the deploy that ships the honest-null PR, alongside migrations:
 *     node scripts/recompute-honest-null-scores.js --live
 * Nothing in the PR waves runs this against a live database automatically.
 *
 * SAFETY
 * - Dry-run is the DEFAULT: it reports counts only (rows scanned / would-null
 *   / would-keep-number / skipped). No writes, and no score values are ever
 *   printed.
 * - Tombstoned accounts are skipped untouched: users with deleted_at set are
 *   counted as skipped and never recomputed — erasure territory. (Companies
 *   have no deleted_at tombstone in the schema — migration 231 covers users
 *   only — so no company skip applies.)
 * - With-data recomputes append a same-value weekly snapshot; that is the
 *   engines' existing behaviour, not a side effect of this script.
 */

const pool = require('../lib/db');
const omniscore = require('../services/omniscore');
const trustscore = require('../services/trustscore');

async function recomputeHonestNullScores({ live = false } = {}) {
	const report = {
		live,
		omni: { scanned: 0, would_null: 0, would_keep_number: 0, skipped: 0 },
		trust: { scanned: 0, would_null: 0, would_keep_number: 0, skipped: 0 },
	};

	const omniRows = (
		await pool.query(
			'SELECT os.user_id AS id, u.deleted_at AS deleted_at FROM omni_scores os JOIN users u ON u.id = os.user_id',
		)
	).rows;
	for (const row of omniRows) {
		report.omni.scanned++;
		if (row.deleted_at) {
			report.omni.skipped++;
			continue;
		}
		if (await omniscore.hasScoreData(row.id)) report.omni.would_keep_number++;
		else report.omni.would_null++;
		if (live) await omniscore.calculateScore(row.id);
	}

	const trustRows = (await pool.query('SELECT company_id AS id FROM trust_scores')).rows;
	for (const row of trustRows) {
		report.trust.scanned++;
		if (await trustscore.hasTrustScoreData(row.id)) report.trust.would_keep_number++;
		else report.trust.would_null++;
		if (live) await trustscore.calculateTrustScore(row.id);
	}

	return report;
}

if (require.main === module) {
	const live = process.argv.includes('--live');
	recomputeHonestNullScores({ live })
		.then((report) => {
			console.log(
				`[honest-null heal] mode=${live ? 'LIVE' : 'DRY-RUN'} ` +
					`omni=${JSON.stringify(report.omni)} trust=${JSON.stringify(report.trust)}`,
			);
			if (!live) console.log('[honest-null heal] dry-run only — re-run with --live to apply.');
		})
		.catch((err) => {
			console.error('[honest-null heal] failed:', err);
			process.exitCode = 1;
		})
		.finally(() => pool.end && pool.end());
}

module.exports = { recomputeHonestNullScores };
