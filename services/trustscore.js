// TrustScore Service v2 — Deep company scoring and accountability (Issue #122)
const pool = require('../lib/db');
const { chat, safeParseJSON, handleAIError } = require('../lib/polsia-ai');

// Score ranges and tiers (0-1000 scale)
const TRUST_SCORE_RANGES = {
	MIN: 0,
	MAX: 1000,
	STARTING: 500,
	TIERS: {
		exceptional: { min: 900, max: 1000, label: 'Exceptional Employer', color: '#10b981' },
		excellent: { min: 800, max: 899, label: 'Excellent', color: '#34d399' },
		trusted: { min: 700, max: 799, label: 'Trusted', color: '#22c55e' },
		good: { min: 600, max: 699, label: 'Good', color: '#84cc16' },
		building: { min: 400, max: 599, label: 'Building Trust', color: '#eab308' },
		new: { min: 0, max: 399, label: 'New Employer', color: '#94a3b8' },
	},
};

// TrustScore v1 component weights (total = 1000 max)
const TRUST_COMPONENTS = {
	verification: {
		max: 200,
		weight: 0.2,
		label: 'Company Verification',
		description: 'Email domain verification, LinkedIn, website confirmation',
	},
	job_authenticity: {
		max: 250,
		weight: 0.25,
		label: 'Job Authenticity',
		description: 'Complete job descriptions, realistic salary ranges, clear requirements',
	},
	hiring_ratio: {
		max: 250,
		weight: 0.25,
		label: 'Interview-to-Offer Ratio',
		description: 'Ratio of interviews conducted to offers made',
	},
	feedback: {
		max: 200,
		weight: 0.2,
		label: 'Candidate Feedback',
		description: 'Ratings from candidates who interviewed',
	},
	behavior: {
		max: 100,
		weight: 0.1,
		label: 'Platform Behavior',
		description: 'Response times, profile completeness, activity',
	},
};

// TrustScore v2 factor definitions
const TRUST_V2_FACTORS = {
	employee_satisfaction: {
		max: 100,
		label: 'Employee Satisfaction',
		description: 'Post-hire and post-interview satisfaction ratings',
		min_data_points: 3,
	},
	interview_experience: {
		max: 100,
		label: 'Interview Experience',
		description: 'Candidate reviews of the interview process',
		min_data_points: 3,
	},
	offer_acceptance_rate: {
		max: 75,
		label: 'Offer Acceptance Rate',
		description: 'Percentage of offers that candidates accept',
		min_data_points: 2,
	},
	time_to_hire: {
		max: 50,
		label: 'Time to Hire',
		description: 'Speed from application to decision',
		min_data_points: 3,
	},
	response_rate: {
		max: 75,
		label: 'Response Rate',
		description: 'Do companies reply to applications?',
		min_data_points: 5,
	},
	salary_competitiveness: {
		max: 50,
		label: 'Salary Competitiveness',
		description: 'Offers against market rate for role/location',
		min_data_points: 2,
	},
	diversity_metrics: {
		max: 0, // placeholder — insufficient data in most cases
		label: 'Diversity Metrics',
		description: 'Representation across the pipeline',
		min_data_points: 10,
	},
	career_growth: {
		max: 100,
		label: 'Career Growth',
		description: 'Progression and growth opportunity for people they hired',
		min_data_points: 3,
	},
};

// ═══════════════════════════════════════════════════════════════════════════════
// V1 FUNCTIONS (preserved for backwards compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

async function getOrCreateTrustScore(companyId) {
	const existing = await pool.query('SELECT * FROM trust_scores WHERE company_id = $1', [
		companyId,
	]);

	if (existing.rows.length > 0) {
		return existing.rows[0];
	}

	const result = await pool.query(
		`INSERT INTO trust_scores (company_id, total_score, score_tier)
     VALUES ($1, $2, 'new')
     RETURNING *`,
		[companyId, TRUST_SCORE_RANGES.STARTING],
	);

	return result.rows[0];
}

async function calculateTrustScore(companyId) {
	const components = await pool.query(
		`
    SELECT component_type,
           SUM(points * POWER(decay_rate, EXTRACT(DAYS FROM NOW() - created_at) / 30)) as decayed_points,
           SUM(max_points) as max_points
    FROM trust_score_components
    WHERE company_id = $1
      AND (expires_at IS NULL OR expires_at > NOW())
    GROUP BY component_type
  `,
		[companyId],
	);

	const scores = {
		verification: 0,
		job_authenticity: 0,
		hiring_ratio: 0,
		feedback: 0,
		behavior: 0,
	};

	for (const comp of components.rows) {
		const type = comp.component_type;
		if (Object.hasOwn(scores, type)) {
			const maxForType = TRUST_COMPONENTS[type].max;
			const ratio = Math.min(1, comp.decayed_points / (comp.max_points || 1));
			scores[type] = Math.round(ratio * maxForType);
		}
	}

	const componentTotal = Object.values(scores).reduce((a, b) => a + b, 0);
	const total = Math.min(TRUST_SCORE_RANGES.MAX, componentTotal);

	let tier = 'new';
	for (const [key, range] of Object.entries(TRUST_SCORE_RANGES.TIERS)) {
		if (total >= range.min && total <= range.max) {
			tier = key;
			break;
		}
	}

	await pool.query(
		`
    UPDATE trust_scores SET
      total_score = $1,
      verification_score = $2,
      job_authenticity_score = $3,
      hiring_ratio_score = $4,
      feedback_score = $5,
      behavior_score = $6,
      score_tier = $7,
      last_updated = NOW()
    WHERE company_id = $8
  `,
		[
			total,
			scores.verification,
			scores.job_authenticity,
			scores.hiring_ratio,
			scores.feedback,
			scores.behavior,
			tier,
			companyId,
		],
	);

	return {
		total_score: total,
		...scores,
		tier,
		tier_label: TRUST_SCORE_RANGES.TIERS[tier]?.label || 'New Employer',
		tier_color: TRUST_SCORE_RANGES.TIERS[tier]?.color || '#94a3b8',
	};
}

async function addVerificationComponent(companyId, verificationType, points, maxPoints = 50) {
	await pool.query(
		`
    INSERT INTO trust_score_components (company_id, component_type, source_type, points, max_points, metadata)
    VALUES ($1, 'verification', $2, $3, $4, $5)
  `,
		[companyId, verificationType, points, maxPoints, JSON.stringify({ type: verificationType })],
	);
	return calculateTrustScore(companyId);
}

async function addJobAuthenticityComponent(companyId, jobId, authenticityScore, maxScore = 100) {
	const points = Math.round((authenticityScore / maxScore) * 50);
	await pool.query(
		`
    INSERT INTO trust_score_components (company_id, component_type, source_type, source_id, points, max_points)
    VALUES ($1, 'job_authenticity', 'job_posting', $2, $3, 50)
  `,
		[companyId, jobId, points],
	);
	return calculateTrustScore(companyId);
}

async function updateHiringRatioScore(companyId) {
	const stats = await pool.query(
		`
    SELECT
      COUNT(*) FILTER (WHERE status = 'interviewed') as interviews,
      COUNT(*) FILTER (WHERE status = 'offered') as offers,
      COUNT(*) FILTER (WHERE status = 'hired') as hires
    FROM job_applications
    WHERE company_id = $1
  `,
		[companyId],
	);

	const { interviews, offers, hires } = stats.rows[0];
	let ratioScore = 0;
	if (interviews > 0) {
		const offerRate = offers / interviews;
		if (offerRate >= 0.2 && offerRate <= 0.5) {
			ratioScore = 80 + offerRate * 40;
		} else if (offerRate > 0.5) {
			ratioScore = 70;
		} else {
			ratioScore = offerRate * 350;
		}
	}

	await pool.query(
		`DELETE FROM trust_score_components WHERE company_id = $1 AND component_type = 'hiring_ratio'`,
		[companyId],
	);

	if (interviews > 0) {
		await pool.query(
			`
      INSERT INTO trust_score_components (company_id, component_type, source_type, points, max_points, metadata)
      VALUES ($1, 'hiring_ratio', 'calculated', $2, 100, $3)
    `,
			[companyId, Math.round(ratioScore), JSON.stringify({ interviews, offers, hires })],
		);
	}

	return calculateTrustScore(companyId);
}

async function addFeedbackComponent(companyId, feedbackId, overallRating) {
	const points = Math.round((overallRating / 5) * 40);
	await pool.query(
		`
    INSERT INTO trust_score_components (company_id, component_type, source_type, source_id, points, max_points)
    VALUES ($1, 'feedback', 'candidate_feedback', $2, $3, 40)
  `,
		[companyId, feedbackId, points],
	);
	return calculateTrustScore(companyId);
}

async function addBehaviorComponent(companyId, behaviorType, points, maxPoints = 20) {
	await pool.query(
		`
    INSERT INTO trust_score_components (company_id, component_type, source_type, points, max_points, metadata)
    VALUES ($1, 'behavior', 'activity', $2, $3, $4)
  `,
		[companyId, points, maxPoints, JSON.stringify({ type: behaviorType })],
	);
	return calculateTrustScore(companyId);
}

async function getTrustScoreBreakdown(companyId) {
	const _score = await getOrCreateTrustScore(companyId);
	const currentScores = await calculateTrustScore(companyId);
	const v2Scores = await calculateTrustScoreV2(companyId);

	const recentComponents = await pool.query(
		`
    SELECT component_type, source_type, points, max_points, created_at
    FROM trust_score_components
    WHERE company_id = $1
    ORDER BY created_at DESC
    LIMIT 20
  `,
		[companyId],
	);

	const history = await pool.query(
		`
    SELECT previous_score, new_score, change_amount, change_reason, created_at
    FROM trust_score_history
    WHERE company_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `,
		[companyId],
	);

	const analytics = await pool.query(
		`
    SELECT
      COUNT(DISTINCT ja.job_id) as active_jobs,
      COUNT(ja.id) as total_applications,
      COUNT(*) FILTER (WHERE ja.status = 'interviewed') as interviews,
      COUNT(*) FILTER (WHERE ja.status = 'offered') as offers,
      COUNT(*) FILTER (WHERE ja.status = 'hired') as hires
    FROM job_applications ja
    WHERE ja.company_id = $1
  `,
		[companyId],
	);

	return {
		current: currentScores,
		v2: v2Scores,
		breakdown: Object.entries(TRUST_COMPONENTS).map(([key, config]) => ({
			type: key,
			score: currentScores[key] || 0,
			max: config.max,
			label: config.label,
			description: config.description,
		})),
		v2_breakdown: Object.entries(TRUST_V2_FACTORS).map(([key, config]) => ({
			type: key,
			score: v2Scores[key] || 0,
			max: config.max,
			label: config.label,
			description: config.description,
			data_sufficient: v2Scores.data_sufficiency?.[key] || false,
		})),
		recent_activity: recentComponents.rows,
		history: history.rows,
		analytics: analytics.rows[0],
		recommendations: generateTrustRecommendations(currentScores),
		v2_recommendations: generateV2ImprovementGuidance(v2Scores),
	};
}

function generateTrustRecommendations(scores) {
	const recommendations = [];

	if (scores.verification < TRUST_COMPONENTS.verification.max * 0.5) {
		recommendations.push({
			type: 'verification',
			priority: 'high',
			title: 'Complete Company Verification',
			description:
				'Verify your company email domain, add LinkedIn profile, and complete your company profile to build trust.',
			potential_gain: Math.round(TRUST_COMPONENTS.verification.max * 0.4),
		});
	}

	if (scores.job_authenticity < TRUST_COMPONENTS.job_authenticity.max * 0.5) {
		recommendations.push({
			type: 'job_authenticity',
			priority: 'high',
			title: 'Improve Job Descriptions',
			description:
				'Use our AI optimizer to create detailed, authentic job postings with clear requirements and realistic salary ranges.',
			potential_gain: Math.round(TRUST_COMPONENTS.job_authenticity.max * 0.3),
		});
	}

	if (scores.feedback < TRUST_COMPONENTS.feedback.max * 0.3) {
		recommendations.push({
			type: 'feedback',
			priority: 'medium',
			title: 'Collect Candidate Feedback',
			description:
				'After interviews, encourage candidates to leave feedback. Positive experiences boost your TrustScore.',
			potential_gain: Math.round(TRUST_COMPONENTS.feedback.max * 0.3),
		});
	}

	if (scores.behavior < TRUST_COMPONENTS.behavior.max * 0.5) {
		recommendations.push({
			type: 'behavior',
			priority: 'low',
			title: 'Stay Active & Responsive',
			description:
				'Respond to applications promptly and maintain regular activity on the platform.',
			potential_gain: Math.round(TRUST_COMPONENTS.behavior.max * 0.3),
		});
	}

	return recommendations;
}

async function recordScoreChange(companyId, previousScore, newScore, reason, componentType) {
	await pool.query(
		`
    INSERT INTO trust_score_history (company_id, previous_score, new_score, change_amount, change_reason, component_type)
    VALUES ($1, $2, $3, $4, $5, $6)
  `,
		[companyId, previousScore, newScore, newScore - previousScore, reason, componentType],
	);
}

// ═══════════════════════════════════════════════════════════════════════════════
// V2 FACTOR CALCULATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate data sufficiency for a company (0-100)
 * Returns which factors have enough data and overall sufficiency
 */
async function getDataSufficiency(companyId) {
	// Count data points per factor
	const [ratings, feedback, applications, offers, jobsCount, interviews] = await Promise.all([
		pool.query('SELECT COUNT(*) as count FROM company_ratings WHERE company_id = $1', [companyId]),
		pool.query('SELECT COUNT(*) as count FROM candidate_feedback WHERE company_id = $1', [companyId]),
		pool.query('SELECT COUNT(*) as count FROM job_applications WHERE company_id = $1', [companyId]),
		pool.query(
			`SELECT COUNT(*) as count, COUNT(*) FILTER (WHERE status = 'accepted') as accepted FROM offers WHERE company_name = (SELECT name FROM companies WHERE id = $1)`,
			[companyId],
		),
		pool.query('SELECT COUNT(*) as count FROM jobs WHERE company_id = $1', [companyId]),
		pool.query(
			`SELECT COUNT(*) as count FROM interview_feedback WHERE company_id = $1`,
			[companyId],
		),
	]);

	const counts = {
		employee_satisfaction: parseInt(ratings.rows[0].count, 10),
		interview_experience: parseInt(ratings.rows[0].count, 10) + parseInt(interviews.rows[0].count, 10),
		offer_acceptance_rate: parseInt(offers.rows[0].count, 10),
		time_to_hire: parseInt(applications.rows[0].count, 10),
		response_rate: parseInt(applications.rows[0].count, 10),
		salary_competitiveness: parseInt(offers.rows[0].count, 10),
		diversity_metrics: parseInt(applications.rows[0].count, 10),
		career_growth: parseInt(ratings.rows[0].count, 10),
	};

	const sufficiency = {};
	let totalScore = 0;
	let factorCount = 0;

	for (const [factor, config] of Object.entries(TRUST_V2_FACTORS)) {
		const count = counts[factor] || 0;
		const hasEnough = count >= config.min_data_points;
		sufficiency[factor] = hasEnough;

		// Calculate partial sufficiency (0-100 per factor)
		const partial = Math.min(100, Math.round((count / Math.max(1, config.min_data_points)) * 100));
		totalScore += partial;
		factorCount++;
	}

	// Also count v1 component sufficiency
	const v1Components = await pool.query(
		`SELECT COUNT(*) as count FROM trust_score_components WHERE company_id = $1`,
		[companyId],
	);
	sufficiency.v1_components = parseInt(v1Components.rows[0].count, 10) > 0;

	return {
		overall: Math.round(totalScore / factorCount),
		factors: sufficiency,
		counts,
		insufficient_factors: Object.entries(sufficiency)
			.filter(([k, v]) => !v && k !== 'v1_components')
			.map(([k]) => k),
	};
}

/**
 * Employee Satisfaction — from company_ratings.overall_rating (post-hire ratings)
 */
async function calculateEmployeeSatisfaction(companyId) {
	const result = await pool.query(
		`
    SELECT AVG(overall_rating) as avg_rating, COUNT(*) as count
    FROM company_ratings
    WHERE company_id = $1 AND overall_rating IS NOT NULL
  `,
		[companyId],
	);

	const { avg_rating, count } = result.rows[0];
	if (!avg_rating || count < TRUST_V2_FACTORS.employee_satisfaction.min_data_points) {
		return { score: 0, data_points: parseInt(count, 10), sufficient: false };
	}

	// Map 1-5 rating to 0-100
	const score = Math.round((parseFloat(avg_rating) / 5) * TRUST_V2_FACTORS.employee_satisfaction.max);
	return { score, data_points: parseInt(count, 10), sufficient: true };
}

/**
 * Interview Experience — from company_ratings.interview_experience + interview_feedback
 */
async function calculateInterviewExperience(companyId) {
	const [ratings, interviews] = await Promise.all([
		pool.query(
			`
      SELECT AVG(interview_experience) as avg_rating, COUNT(*) as count
      FROM company_ratings
      WHERE company_id = $1 AND interview_experience IS NOT NULL
    `,
			[companyId],
		),
		pool.query(
			`
      SELECT AVG(interview_experience_rating) as avg_rating, COUNT(*) as count
      FROM interview_feedback
      WHERE company_id = $1 AND interview_experience_rating IS NOT NULL
    `,
			[companyId],
		),
	]);

	const rAvg = ratings.rows[0].avg_rating ? parseFloat(ratings.rows[0].avg_rating) : null;
	const rCount = parseInt(ratings.rows[0].count, 10);
	const iAvg = interviews.rows[0].avg_rating ? parseFloat(interviews.rows[0].avg_rating) : null;
	const iCount = parseInt(interviews.rows[0].count, 10);

	const totalCount = rCount + iCount;
	if (totalCount < TRUST_V2_FACTORS.interview_experience.min_data_points) {
		return { score: 0, data_points: totalCount, sufficient: false };
	}

	// Weighted average
	let weightedAvg = 0;
	if (rAvg && iAvg) {
		weightedAvg = (rAvg * rCount + iAvg * iCount) / totalCount;
	} else if (rAvg) {
		weightedAvg = rAvg;
	} else {
		weightedAvg = iAvg;
	}

	const score = Math.round((weightedAvg / 5) * TRUST_V2_FACTORS.interview_experience.max);
	return { score, data_points: totalCount, sufficient: true };
}

/**
 * Offer Acceptance Rate — offers accepted / offers sent
 */
async function calculateOfferAcceptanceRate(companyId) {
	const result = await pool.query(
		`
    SELECT
      COUNT(*) FILTER (WHERE accepted_at IS NOT NULL) as accepted,
      COUNT(*) FILTER (WHERE sent_at IS NOT NULL) as sent
    FROM offers
    WHERE company_name = (SELECT name FROM companies WHERE id = $1)
  `,
		[companyId],
	);

	const accepted = parseInt(result.rows[0].accepted, 10);
	const sent = parseInt(result.rows[0].sent, 10);

	if (sent < TRUST_V2_FACTORS.offer_acceptance_rate.min_data_points) {
		return { score: 0, accepted, sent, sufficient: false };
	}

	const rate = accepted / sent;
	// 80%+ acceptance = full score, 50% = 75%, below 30% = 0
	let score = 0;
	if (rate >= 0.8) score = TRUST_V2_FACTORS.offer_acceptance_rate.max;
	else if (rate >= 0.5) score = Math.round(rate * TRUST_V2_FACTORS.offer_acceptance_rate.max);
	else score = Math.round(rate * 0.5 * TRUST_V2_FACTORS.offer_acceptance_rate.max);

	return { score, accepted, sent, rate: Math.round(rate * 1000) / 10, sufficient: true };
}

/**
 * Time to Hire — median days from application to decision
 */
async function calculateTimeToHire(companyId) {
	const result = await pool.query(
		`
    SELECT
      EXTRACT(EPOCH FROM (updated_at - applied_at)) / 86400.0 as days,
      status
    FROM job_applications
    WHERE company_id = $1
      AND status IN ('hired', 'rejected', 'offered', 'interviewed')
      AND updated_at > applied_at
    ORDER BY days
  `,
		[companyId],
	);

	if (result.rows.length < TRUST_V2_FACTORS.time_to_hire.min_data_points) {
		return { score: 0, median_days: null, data_points: result.rows.length, sufficient: false };
	}

	// Calculate median
	const days = result.rows.map((r) => parseFloat(r.days)).sort((a, b) => a - b);
	const mid = Math.floor(days.length / 2);
	const median = days.length % 2 === 0 ? (days[mid - 1] + days[mid]) / 2 : days[mid];

	// Scoring: <7 days = full, 7-14 = good, 14-30 = ok, 30-60 = poor, >60 = very poor
	let score = 0;
	if (median <= 7) score = TRUST_V2_FACTORS.time_to_hire.max;
	else if (median <= 14) score = Math.round(TRUST_V2_FACTORS.time_to_hire.max * 0.8);
	else if (median <= 30) score = Math.round(TRUST_V2_FACTORS.time_to_hire.max * 0.5);
	else if (median <= 60) score = Math.round(TRUST_V2_FACTORS.time_to_hire.max * 0.2);
	else score = 0;

	return {
		score,
		median_days: Math.round(median * 10) / 10,
		data_points: result.rows.length,
		sufficient: true,
	};
}

/**
 * Response Rate — do companies reply to applications?
 */
async function calculateResponseRate(companyId) {
	const result = await pool.query(
		`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status != 'applied') as responded
    FROM job_applications
    WHERE company_id = $1
  `,
		[companyId],
	);

	const total = parseInt(result.rows[0].total, 10);
	const responded = parseInt(result.rows[0].responded, 10);

	if (total < TRUST_V2_FACTORS.response_rate.min_data_points) {
		return { score: 0, responded, total, sufficient: false };
	}

	const rate = responded / total;
	// 95%+ response rate = full score, 80% = 80%, 50% = 40%, <30% = 0
	let score = 0;
	if (rate >= 0.95) score = TRUST_V2_FACTORS.response_rate.max;
	else if (rate >= 0.8) score = Math.round(rate * TRUST_V2_FACTORS.response_rate.max);
	else if (rate >= 0.5) score = Math.round(rate * 0.8 * TRUST_V2_FACTORS.response_rate.max);
	else score = Math.round(rate * 0.5 * TRUST_V2_FACTORS.response_rate.max);

	return { score, responded, total, rate: Math.round(rate * 1000) / 10, sufficient: true };
}

/**
 * Salary Competitiveness — offers vs job posting range
 */
async function calculateSalaryCompetitiveness(companyId) {
	const result = await pool.query(
		`
    SELECT
      o.salary,
      j.salary_min,
      j.salary_max,
      j.title,
      j.location
    FROM offers o
    JOIN jobs j ON o.job_id = j.id
    WHERE j.company_id = $1
      AND o.salary IS NOT NULL
      AND (j.salary_min IS NOT NULL OR j.salary_max IS NOT NULL)
  `,
		[companyId],
	);

	if (result.rows.length < TRUST_V2_FACTORS.salary_competitiveness.min_data_points) {
		return { score: 0, data_points: result.rows.length, sufficient: false };
	}

	let competitiveCount = 0;
	for (const row of result.rows) {
		const { salary, salary_min, salary_max } = row;
		if (!salary) continue;

		if (salary_max && salary_min) {
			const midpoint = (salary_min + salary_max) / 2;
			if (salary >= midpoint) competitiveCount++;
		} else if (salary_max && salary >= salary_max * 0.8) {
			competitiveCount++;
		} else if (salary_min && salary >= salary_min) {
			competitiveCount++;
		}
	}

	const rate = competitiveCount / result.rows.length;
	const score = Math.round(rate * TRUST_V2_FACTORS.salary_competitiveness.max);

	return {
		score,
		competitive_count: competitiveCount,
		total_offers: result.rows.length,
		data_points: result.rows.length,
		sufficient: true,
	};
}

/**
 * Diversity Metrics — placeholder (insufficient demographic data in most cases)
 * Computes geographic diversity as a proxy when available
 */
async function calculateDiversityMetrics(companyId) {
	// Check if we have location data from applicants
	const result = await pool.query(
		`
    SELECT COUNT(DISTINCT cp.location) as distinct_locations, COUNT(*) as total
    FROM job_applications ja
    JOIN users u ON ja.candidate_id = u.id
    LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    WHERE ja.company_id = $1 AND cp.location IS NOT NULL
  `,
		[companyId],
	);

	const distinctLocations = parseInt(result.rows[0].distinct_locations, 10);
	const total = parseInt(result.rows[0].total, 10);

	if (total < TRUST_V2_FACTORS.diversity_metrics.min_data_points) {
		return {
			score: 0,
			distinct_locations: distinctLocations,
			total,
			sufficient: false,
			message: 'Insufficient data — diversity metrics require demographic information',
		};
	}

	// Geographic diversity as a proxy: more locations = more diverse
	const diversityRatio = distinctLocations / total;
	const score = Math.round(diversityRatio * 100); // max 100, but capped at 0 since this is placeholder

	return {
		score: 0, // Stays 0 until we have real demographic data
		distinct_locations: distinctLocations,
		total,
		sufficient: false,
		message:
			'Diversity metrics require demographic data. Enable optional diversity surveys to activate this factor.',
	};
}

/**
 * Career Growth — from company_ratings.growth_opportunity
 */
async function calculateCareerGrowth(companyId) {
	const result = await pool.query(
		`
    SELECT AVG(growth_opportunity) as avg_rating, COUNT(*) as count
    FROM company_ratings
    WHERE company_id = $1 AND growth_opportunity IS NOT NULL
  `,
		[companyId],
	);

	const { avg_rating, count } = result.rows[0];
	if (!avg_rating || count < TRUST_V2_FACTORS.career_growth.min_data_points) {
		return { score: 0, data_points: parseInt(count, 10), sufficient: false };
	}

	const score = Math.round((parseFloat(avg_rating) / 5) * TRUST_V2_FACTORS.career_growth.max);
	return { score, data_points: parseInt(count, 10), sufficient: true };
}

/**
 * Calculate complete TrustScore v2 — combines v1 + v2 factors
 */
async function calculateTrustScoreV2(companyId) {
	// First ensure v1 is calculated
	const v1 = await calculateTrustScore(companyId);

	// Calculate all v2 factors in parallel
	const [
		employeeSatisfaction,
		interviewExperience,
		offerAcceptance,
		timeToHire,
		responseRate,
		salaryCompetitive,
		diversity,
		careerGrowth,
		dataSufficiency,
	] = await Promise.all([
		calculateEmployeeSatisfaction(companyId),
		calculateInterviewExperience(companyId),
		calculateOfferAcceptanceRate(companyId),
		calculateTimeToHire(companyId),
		calculateResponseRate(companyId),
		calculateSalaryCompetitiveness(companyId),
		calculateDiversityMetrics(companyId),
		calculateCareerGrowth(companyId),
		getDataSufficiency(companyId),
	]);

	// v2 total = v1 components (already capped at their max) + v2 factors
	// But we keep the overall 0-1000 scale by proportionally scaling
	const v2Scores = {
		employee_satisfaction: employeeSatisfaction.score,
		interview_experience: interviewExperience.score,
		offer_acceptance_rate: offerAcceptance.score,
		time_to_hire: timeToHire.score,
		response_rate: responseRate.score,
		salary_competitiveness: salaryCompetitive.score,
		diversity_metrics: diversity.score,
		career_growth: careerGrowth.score,
	};

	const v2Total = Object.values(v2Scores).reduce((a, b) => a + b, 0);

	// Combine: v1 total + v2 total, but cap at 1000
	// The v1 scores are already on their own scale (0-1000 total)
	// v2 adds additional nuance but the public score stays 0-1000
	// Strategy: v1 = 60% weight, v2 = 40% weight of the cap
	const v1Weight = 0.6;
	const v2Weight = 0.4;
	const v2MaxPossible = Object.values(TRUST_V2_FACTORS).reduce((s, f) => s + f.max, 0); // 650
	const v2Normalized = v2MaxPossible > 0 ? (v2Total / v2MaxPossible) * TRUST_SCORE_RANGES.MAX : 0;

	const combinedTotal = Math.min(
		TRUST_SCORE_RANGES.MAX,
		Math.round(v1.total_score * v1Weight + v2Normalized * v2Weight),
	);

	// Determine tier based on combined score
	let tier = 'new';
	for (const [key, range] of Object.entries(TRUST_SCORE_RANGES.TIERS)) {
		if (combinedTotal >= range.min && combinedTotal <= range.max) {
			tier = key;
			break;
		}
	}

	// Update database with v2 scores
	await pool.query(
		`
    UPDATE trust_scores SET
      total_score = $1,
      employee_satisfaction_score = $2,
      interview_experience_score = $3,
      offer_acceptance_rate_score = $4,
      time_to_hire_score = $5,
      response_rate_score = $6,
      salary_competitiveness_score = $7,
      diversity_metrics_score = $8,
      career_growth_score = $9,
      data_sufficiency_score = $10,
      score_tier = $11,
      v2_calculated_at = NOW(),
      last_updated = NOW()
    WHERE company_id = $12
  `,
		[
			combinedTotal,
			v2Scores.employee_satisfaction,
			v2Scores.interview_experience,
			v2Scores.offer_acceptance_rate,
			v2Scores.time_to_hire,
			v2Scores.response_rate,
			v2Scores.salary_competitiveness,
			v2Scores.diversity_metrics,
			v2Scores.career_growth,
			dataSufficiency.overall,
			tier,
			companyId,
		],
	);

	return {
		total_score: combinedTotal,
		v1_score: v1.total_score,
		v2_score: v2Total,
		...v1,
		...v2Scores,
		tier,
		tier_label: TRUST_SCORE_RANGES.TIERS[tier]?.label || 'New Employer',
		tier_color: TRUST_SCORE_RANGES.TIERS[tier]?.color || '#94a3b8',
		data_sufficiency: dataSufficiency,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEADERBOARD & COMPARISON
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get public company leaderboard
 */
async function getLeaderboard(options = {}) {
	const { limit = 50, offset = 0, tier, minScore = 0 } = options;

	let whereClause = 'WHERE ts.data_sufficiency_score >= 50 AND ts.total_score >= $3';
	const params = [limit, offset, minScore];

	if (tier) {
		whereClause += ' AND ts.score_tier = $4';
		params.push(tier);
	}

	const result = await pool.query(
		`
    SELECT
      c.id as company_id,
      c.name as company_name,
      c.slug,
      c.logo_url,
      c.industry,
      c.is_verified,
      ts.total_score,
      ts.score_tier,
      ts.verification_score,
      ts.job_authenticity_score,
      ts.hiring_ratio_score,
      ts.feedback_score,
      ts.behavior_score,
      ts.employee_satisfaction_score,
      ts.interview_experience_score,
      ts.offer_acceptance_rate_score,
      ts.time_to_hire_score,
      ts.response_rate_score,
      ts.salary_competitiveness_score,
      ts.career_growth_score,
      ts.data_sufficiency_score,
      ts.ai_summary,
      ts.last_updated,
      COUNT(j.id) as active_jobs
    FROM companies c
    JOIN trust_scores ts ON c.id = ts.company_id
    LEFT JOIN jobs j ON c.id = j.company_id AND j.status = 'active'
    ${whereClause}
    GROUP BY c.id, ts.id
    ORDER BY ts.total_score DESC, ts.last_updated DESC
    LIMIT $1 OFFSET $2
  `,
		params,
	);

	const countResult = await pool.query(
		`
    SELECT COUNT(*) as total
    FROM companies c
    JOIN trust_scores ts ON c.id = ts.company_id
    ${whereClause}
  `,
		params.slice(2), // limit and offset not needed for count
	);

	return {
		companies: result.rows.map((row) => ({
			...row,
			badges: buildBadges(row),
			insufficient_data: row.data_sufficiency_score < 50,
		})),
		pagination: {
			total: parseInt(countResult.rows[0].total, 10),
			limit,
			offset,
			has_more: offset + result.rows.length < parseInt(countResult.rows[0].total, 10),
		},
	};
}

function buildBadges(row) {
	const badges = [];
	if (row.is_verified) badges.push({ type: 'verified', label: 'Verified' });
	if (row.total_score >= 800) badges.push({ type: 'trusted', label: 'Highly Trusted' });
	if (row.feedback_score >= 60) badges.push({ type: 'candidate_approved', label: 'Candidate Approved' });
	if (row.response_rate_score >= 60) badges.push({ type: 'responsive', label: 'Responsive' });
	if (row.offer_acceptance_rate_score >= 50)
		badges.push({ type: 'desirable', label: 'Desirable Employer' });
	return badges;
}

/**
 * Compare two or more companies side-by-side
 */
async function compareCompanies(companyIds) {
	if (!Array.isArray(companyIds) || companyIds.length < 2) {
		throw new Error('At least 2 company IDs required for comparison');
	}

	const result = await pool.query(
		`
    SELECT
      c.id as company_id,
      c.name as company_name,
      c.slug,
      c.logo_url,
      c.industry,
      c.is_verified,
      ts.*
    FROM companies c
    JOIN trust_scores ts ON c.id = ts.company_id
    WHERE c.id = ANY($1)
    ORDER BY ts.total_score DESC
  `,
		[companyIds],
	);

	const companies = result.rows;

	// Build comparison matrix
	const factors = [
		{ key: 'total_score', label: 'Overall TrustScore', max: 1000 },
		{ key: 'verification_score', label: 'Verification', max: 200 },
		{ key: 'job_authenticity_score', label: 'Job Authenticity', max: 250 },
		{ key: 'hiring_ratio_score', label: 'Hiring Ratio', max: 250 },
		{ key: 'feedback_score', label: 'Candidate Feedback', max: 200 },
		{ key: 'behavior_score', label: 'Platform Behavior', max: 100 },
		{ key: 'employee_satisfaction_score', label: 'Employee Satisfaction', max: 100 },
		{ key: 'interview_experience_score', label: 'Interview Experience', max: 100 },
		{ key: 'offer_acceptance_rate_score', label: 'Offer Acceptance', max: 75 },
		{ key: 'time_to_hire_score', label: 'Time to Hire', max: 50 },
		{ key: 'response_rate_score', label: 'Response Rate', max: 75 },
		{ key: 'salary_competitiveness_score', label: 'Salary Competitiveness', max: 50 },
		{ key: 'career_growth_score', label: 'Career Growth', max: 100 },
	];

	const comparison = factors.map((factor) => ({
		...factor,
		values: companies.map((c) => ({
			company_id: c.company_id,
			company_name: c.company_name,
			value: c[factor.key] || 0,
			percentage: factor.max > 0 ? Math.round(((c[factor.key] || 0) / factor.max) * 100) : 0,
			winner: false,
		})),
	}));

	// Mark winners per factor
	for (const factor of comparison) {
		const maxValue = Math.max(...factor.values.map((v) => v.value));
		factor.values.forEach((v) => {
			if (v.value === maxValue && maxValue > 0) v.winner = true;
		});
	}

	return {
		companies: companies.map((c) => ({
			id: c.company_id,
			name: c.company_name,
			slug: c.slug,
			logo_url: c.logo_url,
			industry: c.industry,
			is_verified: c.is_verified,
			badges: buildBadges(c),
		})),
		comparison,
		overall_winner: companies[0]?.company_id || null,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI SUMMARY GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate an AI-powered "what it is like to work here" summary
 */
async function generateAISummary(companyId) {
	const company = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
	if (company.rows.length === 0) {
		throw new Error('Company not found');
	}

	const v2 = await calculateTrustScoreV2(companyId);

	// Gather recent reviews
	const reviews = await pool.query(
		`
    SELECT overall_rating, interview_experience, communication, transparency,
           work_life_balance, culture, growth_opportunity, review_text, pros, cons
    FROM company_ratings
    WHERE company_id = $1 AND status = 'published'
    ORDER BY created_at DESC
    LIMIT 20
  `,
		[companyId],
	);

	const reviewTexts = reviews.rows
		.filter((r) => r.review_text)
		.map((r) => `"${r.review_text.substring(0, 300)}"`)
		.join('\n\n');

	const pros = reviews.rows.filter((r) => r.pros).map((r) => r.pros);
	const cons = reviews.rows.filter((r) => r.cons).map((r) => r.cons);

	const prompt = `Write a 2-3 paragraph "What it's like to work here" summary for ${company.rows[0].name}.

TRUSTSCORE DATA:
- Overall Score: ${v2.total_score}/1000 (${v2.tier_label})
- Employee Satisfaction: ${v2.employee_satisfaction}/100
- Interview Experience: ${v2.interview_experience}/100
- Response Rate: ${v2.response_rate}/75
- Time to Hire: ${v2.time_to_hire}/50
- Offer Acceptance: ${v2.offer_acceptance_rate}/75
- Career Growth: ${v2.career_growth}/100
- Salary Competitiveness: ${v2.salary_competitiveness}/50

RECENT REVIEWS:
${reviewTexts || 'No reviews available'}

COMMON PROS: ${pros.length > 0 ? pros.slice(0, 5).join('; ') : 'No data'}
COMMON CONS: ${cons.length > 0 ? cons.slice(0, 5).join('; ') : 'No data'}

Write in a balanced, honest tone — celebrate strengths but acknowledge areas for improvement. Use concrete language a job seeker would find useful. Do NOT use corporate jargon. Keep it under 250 words.`;

	try {
		const summary = await chat(prompt, {
			system:
				'You are a career advisor writing honest, balanced company summaries for job seekers. Be specific, avoid generic praise, and focus on what actually matters to candidates.',
			maxTokens: 800,
			module: 'trustscore',
			feature: 'ai_summary',
		});

		// Cache the summary
		await pool.query(
			`
      UPDATE trust_scores
      SET ai_summary = $1, ai_summary_generated_at = NOW()
      WHERE company_id = $2
    `,
			[summary, companyId],
		);

		return summary;
	} catch (err) {
		console.error('[TrustScore v2] AI summary generation failed:', err.message);
		return null;
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// FAIRNESS & ANTI-GAMING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect review brigading patterns
 * Returns suspicious reviews grouped by pattern type
 */
async function detectReviewBrigading(companyId, lookbackDays = 30) {
	const reviews = await pool.query(
		`
    SELECT id, candidate_id, overall_rating, review_text, ip_address, created_at
    FROM company_ratings
    WHERE company_id = $1 AND created_at > NOW() - INTERVAL '${lookbackDays} days'
    ORDER BY created_at DESC
  `,
		[companyId],
	);

	const flags = [];
	const rows = reviews.rows;

	// 1. Same IP bulk submissions
	const ipGroups = {};
	for (const r of rows) {
		if (!r.ip_address) continue;
		if (!ipGroups[r.ip_address]) ipGroups[r.ip_address] = [];
		ipGroups[r.ip_address].push(r);
	}
	for (const [ip, group] of Object.entries(ipGroups)) {
		if (group.length >= 3) {
			flags.push({
				type: 'same_ip_bulk',
				severity: 'high',
				message: `${group.length} reviews from same IP (${ip})`,
				review_ids: group.map((r) => r.id),
				count: group.length,
			});
		}
	}

	// 2. Same rating pattern (all 5s or all 1s in a cluster)
	if (rows.length >= 5) {
		const recentFive = rows.slice(0, 5);
		const allSame = recentFive.every((r) => r.overall_rating === recentFive[0].overall_rating);
		if (allSame) {
			flags.push({
				type: 'rating_cluster',
				severity: 'medium',
				message: `Last ${recentFive.length} reviews all rated ${recentFive[0].overall_rating}/5`,
				review_ids: recentFive.map((r) => r.id),
				count: recentFive.length,
			});
		}
	}

	// 3. Similar review text (simple: identical first 50 chars)
	const textGroups = {};
	for (const r of rows) {
		if (!r.review_text) continue;
		const key = r.review_text.substring(0, 50).toLowerCase().trim();
		if (key.length < 10) continue;
		if (!textGroups[key]) textGroups[key] = [];
		textGroups[key].push(r);
	}
	for (const [key, group] of Object.entries(textGroups)) {
		if (group.length >= 2) {
			flags.push({
				type: 'similar_text',
				severity: 'medium',
				message: `${group.length} reviews with near-identical opening text`,
				review_ids: group.map((r) => r.id),
				count: group.length,
			});
		}
	}

	// 4. Rapid-fire reviews (3+ within 1 hour)
	const timeBuckets = {};
	for (const r of rows) {
		const hour = new Date(r.created_at).toISOString().substring(0, 13); // YYYY-MM-DDTHH
		if (!timeBuckets[hour]) timeBuckets[hour] = [];
		timeBuckets[hour].push(r);
	}
	for (const [hour, group] of Object.entries(timeBuckets)) {
		if (group.length >= 3) {
			flags.push({
				type: 'rapid_fire',
				severity: 'medium',
				message: `${group.length} reviews submitted within the same hour`,
				review_ids: group.map((r) => r.id),
				count: group.length,
			});
		}
	}

	return {
		company_id: companyId,
		review_count: rows.length,
		lookback_days: lookbackDays,
		flags,
		risk_level: flags.length === 0 ? 'low' : flags.some((f) => f.severity === 'high') ? 'high' : 'medium',
		recommendation:
			flags.length > 0
				? 'Consider manual review of flagged submissions'
				: 'No suspicious patterns detected',
	};
}

/**
 * Generate v2-specific improvement guidance for companies
 */
function generateV2ImprovementGuidance(v2Scores) {
	const guidance = [];

	const factors = [
		{
			key: 'response_rate',
			title: 'Respond to Every Application',
			tip: 'The #1 candidate complaint is ghosting. Even a rejection is better than silence. Set up auto-responses for initial applications.',
		},
		{
			key: 'interview_experience',
			title: 'Improve the Interview Experience',
			tip: 'Send prep materials 24h before interviews. Keep interviews on schedule. Follow up within 48h with next steps.',
		},
		{
			key: 'time_to_hire',
			title: 'Speed Up Your Hiring Process',
			tip: 'Top candidates are off the market in 10 days. Aim for <14 days from application to decision.',
		},
		{
			key: 'offer_acceptance_rate',
			title: 'Make Offers That Get Accepted',
			tip: 'If <50% of offers are accepted, review your compensation, benefits, or how you sell the role.',
		},
		{
			key: 'salary_competitiveness',
			title: 'Make Competitive Offers',
			tip: 'Benchmark your offers against market rate for the role and location. Top candidates know their worth.',
		},
		{
			key: 'career_growth',
			title: 'Show Growth Paths',
			tip: 'Highlight internal mobility, mentorship, and learning budgets. Candidates choose growth over titles.',
		},
	];

	for (const factor of factors) {
		const score = v2Scores[factor.key] || 0;
		const max = TRUST_V2_FACTORS[factor.key]?.max || 100;
		const pct = max > 0 ? score / max : 0;

		if (pct < 0.5) {
			guidance.push({
				priority: pct < 0.3 ? 'high' : 'medium',
				factor: factor.key,
				title: factor.title,
				current_score: score,
				max_score: max,
				tip: factor.tip,
				potential_gain: Math.round(max * (0.7 - pct)),
			});
		}
	}

	return guidance.sort((a, b) => b.potential_gain - a.potential_gain);
}

// ═══════════════════════════════════════════════════════════════════════════════
// METHODOLOGY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get published scoring methodology
 */
async function getMethodology(version = '2.0') {
	const result = await pool.query(
		`
    SELECT factor_name, factor_key, weight, max_score, description, data_source, calculation_method
    FROM trustscore_methodology
    WHERE version = $1 AND is_active = true
    ORDER BY weight DESC
  `,
		[version],
	);

	return {
		version,
		total_max_score: 1000,
		factors: result.rows,
		last_updated: result.rows[0]?.updated_at || null,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
	// Constants
	TRUST_SCORE_RANGES,
	TRUST_COMPONENTS,
	TRUST_V2_FACTORS,

	// V1 functions (preserved)
	getOrCreateTrustScore,
	calculateTrustScore,
	addVerificationComponent,
	addJobAuthenticityComponent,
	updateHiringRatioScore,
	addFeedbackComponent,
	addBehaviorComponent,
	getTrustScoreBreakdown,
	generateTrustRecommendations,
	recordScoreChange,

	// V2 functions
	calculateTrustScoreV2,
	getDataSufficiency,
	calculateEmployeeSatisfaction,
	calculateInterviewExperience,
	calculateOfferAcceptanceRate,
	calculateTimeToHire,
	calculateResponseRate,
	calculateSalaryCompetitiveness,
	calculateDiversityMetrics,
	calculateCareerGrowth,
	getLeaderboard,
	compareCompanies,
	generateAISummary,
	detectReviewBrigading,
	generateV2ImprovementGuidance,
	getMethodology,
	buildBadges,
};
