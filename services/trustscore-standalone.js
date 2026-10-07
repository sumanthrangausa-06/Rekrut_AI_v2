/**
 * TrustScore Standalone Metrics
 *
 * These metrics are NOT part of the TrustScore v2 factor set. They are computed
 * independently and exposed via dedicated endpoints. This avoids:
 * 1. Diluting the existing v2 score denominator (currently 550)
 * 2. Penalizing data sufficiency for companies without data
 * 3. Shifting historical scores when new metrics are added
 *
 * Metrics can be promoted to v2 factors later once data accumulates,
 * following the diversity_metrics max:0 pattern.
 *
 * Each function returns: { score (0-100), sufficient (bool), ...metric-specific fields }
 */

const { pool } = require('../lib/db');

// Minimum data points for each metric
const MIN_DATA_POINTS = {
	WORKPLACE_CULTURE: 3,
	CANDIDATE_NPS: 3,
	REAPPLICATION_RATE: 5,
	COMMUNICATION: 10,
	OFFER_DECLINE: 3,
	POSTING_EFFICIENCY: 3,
	STAGE_FLUIDITY: 5,
};

/**
 * Workplace Culture — averages 4 rating dimensions that are collected
 * but not used by any v2 factor: culture, work_life_balance, communication,
 * transparency (all INTEGER 1-5, nullable).
 *
 * Each dimension is averaged independently (non-null only), then the
 * dimension averages are averaged together (non-null only).
 */
async function calculateWorkplaceCulture(companyId) {
	const result = await pool.query(
		`
    SELECT
      AVG(culture) as culture,
      AVG(work_life_balance) as work_life_balance,
      AVG(communication) as communication,
      AVG(transparency) as transparency,
      COUNT(*) as data_points
    FROM company_ratings
    WHERE company_id = $1
  `,
		[companyId],
	);

	const row = result.rows[0];
	const dataPoints = parseInt(row.data_points, 10);

	if (dataPoints < MIN_DATA_POINTS.WORKPLACE_CULTURE) {
		return { score: 0, avg_rating: 0, dimensions: {}, data_points: dataPoints, sufficient: false };
	}

	const dimensions = {};
	let sum = 0;
	let count = 0;
	for (const key of ['culture', 'work_life_balance', 'communication', 'transparency']) {
		if (row[key] !== null && row[key] !== undefined) {
			const val = Math.round(parseFloat(row[key]) * 10) / 10;
			dimensions[key] = val;
			sum += val;
			count++;
		}
	}

	// Need at least one non-null dimension to be meaningful
	if (count === 0) {
		return { score: 0, avg_rating: 0, dimensions: {}, data_points: dataPoints, sufficient: false };
	}

	const avgRating = Math.round((sum / count) * 10) / 10;
	const score = Math.round((avgRating / 5) * 100);

	return { score, avg_rating: avgRating, dimensions, data_points: dataPoints, sufficient: true };
}

/**
 * Candidate NPS — Net Promoter Score from interview_feedback.would_recommend.
 *
 * Promoters = would_recommend TRUE, Detractors = FALSE, NULLs ignored.
 * NPS = (promoters - detractors) / total * 100 → range -100..100
 * Score = ((nps + 100) / 200) * 100 → range 0..100
 */
async function calculateCandidateNPS(companyId) {
	const result = await pool.query(
		`
    SELECT
      COUNT(*) FILTER (WHERE would_recommend = TRUE) as promoters,
      COUNT(*) FILTER (WHERE would_recommend = FALSE) as detractors,
      COUNT(*) FILTER (WHERE would_recommend IS NOT NULL) as total
    FROM interview_feedback
    WHERE company_id = $1
  `,
		[companyId],
	);

	const row = result.rows[0];
	const promoters = parseInt(row.promoters, 10);
	const detractors = parseInt(row.detractors, 10);
	const total = parseInt(row.total, 10);

	if (total < MIN_DATA_POINTS.CANDIDATE_NPS) {
		return { score: 0, nps: 0, promoters, detractors, total, sufficient: false };
	}

	const nps = Math.round(((promoters - detractors) / total) * 1000) / 10;
	const score = Math.round(((nps + 100) / 200) * 100);

	return { score, nps, promoters, detractors, total, sufficient: true };
}

module.exports = {
	MIN_DATA_POINTS,
	calculateWorkplaceCulture,
	calculateCandidateNPS,
};
