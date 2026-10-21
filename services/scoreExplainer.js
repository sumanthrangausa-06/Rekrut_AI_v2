const pool = require('../lib/db');
const { FACTOR_WEIGHTS, FACTOR_META } = require('./omniscore');

/**
 * Score Explainability Service
 * Provides transparent explanations for OmniScore and assessment results
 */

function numOrNull(value) {
	if (value === null || value === undefined) return null;
	const parsed = parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

// A factor's contribution to the total, in total-scale points — the
// engine's own arithmetic (services/omniscore.js): total = 300 +
// Σ (raw/100 × weight) × 550.
function factorContribution(raw, weight) {
	if (raw === null) return null;
	return Math.round((raw / 100) * weight * 550);
}

/**
 * Generate a human-readable explanation for a user's OmniScore
 */
async function explainOmniScore(userId) {
	try {
		// #1152-B (R1): repointed from the never-written omniscore_results
		// table to the live omni_scores store. Pass-through scales (Rex
		// scale decision 2026-10-20, §4 R1): total_score is native
		// 300–850, factor values are native 0–100. A row can exist with a
		// NULL total (#1192: NULL = no data), so "row exists" is never
		// "score exists".
		const scoreResult = await pool.query(
			`SELECT total_score, technical_score, behavior_score, factor_scores
       FROM omni_scores WHERE user_id = $1`,
			[userId],
		);

		const score = scoreResult.rows[0];
		const totalScore = score ? numOrNull(score.total_score) : null;

		if (totalScore === null) {
			// Honest insufficient-data (#1517 precedent): a payload, not a
			// throw — the route used to surface this case as a 500.
			return {
				overall_score: null,
				overall_score_normalized: null,
				score_scale: '300-850',
				insufficient_data: true,
				message: 'Insufficient data — no OmniScore has been calculated for this user yet.',
				score_breakdown: null,
				factor_breakdown: [],
				recent_changes: [],
				how_calculated: null,
				improvement_factors: [],
			};
		}

		// Get score components breakdown
		const components = await pool.query(
			`
        SELECT component_type, source_type, points AS points_earned, weight, created_at, metadata
        FROM score_components
        WHERE user_id = $1
        ORDER BY created_at DESC
      `,
			[userId],
		);

		// Get score history (values are already total-scale — pass-through)
		const history = await pool.query(
			`
        SELECT previous_score, new_score, change_amount, change_reason, component_type, created_at
        FROM score_history
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 10
      `,
			[userId],
		);

		// Group components by type
		const componentsByType = {
			technical: [],
			behavioral: [],
			experience: [],
		};

		components.rows.forEach((comp) => {
			if (componentsByType[comp.component_type]) {
				componentsByType[comp.component_type].push(comp);
			}
		});

		// factor_scores JSONB: the pg driver returns it parsed, but
		// normalise defensively so a string form cannot throw.
		let factorScores = score.factor_scores || {};
		if (typeof factorScores === 'string') {
			try {
				factorScores = JSON.parse(factorScores);
			} catch {
				factorScores = {};
			}
		}

		// The real 8-factor breakdown (replaces the fabricated 40/30/30
		// formula, dropped per Rex §5.2 — it described a model that
		// never ran).
		const factorBreakdown = Object.entries(FACTOR_WEIGHTS).map(([key, weight]) => {
			const raw = numOrNull(factorScores[key]);
			return {
				factor: key,
				label: (FACTOR_META[key] && FACTOR_META[key].label) || key,
				score: raw,
				weight,
				contribution: factorContribution(raw, weight),
			};
		});
		const factorByKey = Object.fromEntries(factorBreakdown.map((f) => [f.factor, f]));

		const technicalScore = numOrNull(score.technical_score);
		const behavioralScore = numOrNull(score.behavior_score);
		const experienceScore = factorByKey.experience_quality.score;
		// behavior_score is a composite: the average of the Reliability
		// Signals and Soft Skills factor raws (omniscore.js
		// calculateScore), so its true combined weight is their sum.
		const behavioralWeight = FACTOR_WEIGHTS.reliability_signals + FACTOR_WEIGHTS.soft_skills;

		const componentList = (list) =>
			list.map((c) => ({
				source: c.source_type,
				points: parseFloat(c.points_earned),
				weight: parseFloat(c.weight),
				date: c.created_at,
				details: c.metadata,
			}));

		const explanation = {
			overall_score: totalScore,
			// Labelled secondary index (Rex §3.2): the only normalised
			// value in this payload, converted once here — the headline
			// above stays native 300–850.
			overall_score_normalized: Math.round(((totalScore - 300) / 5.5) * 10) / 10,
			score_scale: '300-850',
			insufficient_data: false,
			score_breakdown: {
				technical: {
					label: 'Technical (Verified Skills factor)',
					score: technicalScore,
					weight: FACTOR_WEIGHTS.verified_skills,
					contribution: factorContribution(technicalScore, FACTOR_WEIGHTS.verified_skills),
					components: componentList(componentsByType.technical),
				},
				behavioral: {
					// Labelled as the composite it is, never as an
					// assessment score (Rex §5.4).
					label: 'Behavioral (composite of Reliability Signals and Soft Skills factors)',
					score: behavioralScore,
					weight: behavioralWeight,
					contribution: factorContribution(behavioralScore, behavioralWeight),
					components: componentList(componentsByType.behavioral),
				},
				experience: {
					label: 'Experience (Experience Quality factor)',
					score: experienceScore,
					weight: FACTOR_WEIGHTS.experience_quality,
					contribution: factorContribution(experienceScore, FACTOR_WEIGHTS.experience_quality),
					components: componentList(componentsByType.experience),
				},
			},
			factor_breakdown: factorBreakdown,
			recent_changes: history.rows.map((h) => ({
				date: h.created_at,
				previous: numOrNull(h.previous_score),
				new: numOrNull(h.new_score),
				change: numOrNull(h.change_amount),
				reason: h.change_reason,
				component: h.component_type,
			})),
			how_calculated: generateCalculationExplanation(totalScore, factorBreakdown),
			improvement_factors: generateImprovementFactors(componentsByType),
		};

		return explanation;
	} catch (error) {
		console.error('Score explanation failed:', error);
		throw error;
	}
}

/**
 * Generate plain-English explanation of how the score is calculated —
 * the engine's real formula: 300 + Σ (factor ÷ 100 × weight) × 550
 * across the 8 factors. (The previous 40/30/30 text described a model
 * that never ran and is dropped, not converted — Rex §5.2.)
 */
function generateCalculationExplanation(totalScore, factorBreakdown) {
	// Honesty gate (PR #1531 BLOCK 6307320338): a null contribution means
	// that factor has no data — substituting 0 and asserting the sum
	// equality fabricates a decomposition (e.g. a document-verification
	// row carrying total_score only). Only render the equality when all
	// 8 factor contributions are present; otherwise state the total is
	// the stored OmniScore and the decomposition is unavailable.
	const hasMissingFactor = factorBreakdown.some((f) => f.contribution === null);
	return {
		formula:
			'OmniScore = 300 + \u03a3 (factor score \u00f7 100 \u00d7 factor weight) \u00d7 550 across 8 factors (scale 300\u2013850)',
		scale: '300-850',
		calculation: hasMissingFactor
			? `${totalScore} is the stored OmniScore. A full factor decomposition is unavailable because some factor data is missing \u2014 factors with no data have no contribution (see the breakdown below).`
			: `${totalScore} = 300 + ${factorBreakdown
					.map((f) => f.contribution)
					.join(' + ')} (the 8 factor contributions below)`,
		breakdown: factorBreakdown.map((f) =>
			f.score === null
				? `${f.label}: no data \u2014 no contribution`
				: `${f.label} contribution: ${f.contribution} of 550 points (score ${f.score} \u00d7 ${Math.round(f.weight * 100)}% weight)`,
		),
	};
}

/**
 * Identify which factors could most improve the score
 */
function generateImprovementFactors(componentsByType) {
	const factors = [];

	// Check technical components
	const techSources = new Set(componentsByType.technical.map((c) => c.source_type));
	if (!techSources.has('github_profile')) {
		factors.push({
			category: 'technical',
			action: 'Connect your GitHub profile',
			potential_impact: 'high',
			points: '+15-30 points',
		});
	}
	if (!techSources.has('coding_assessment')) {
		factors.push({
			category: 'technical',
			action: 'Complete a coding assessment',
			potential_impact: 'high',
			points: '+20-40 points',
		});
	}

	// Check behavioral components
	const behaviorSources = new Set(componentsByType.behavioral.map((c) => c.source_type));
	if (behaviorSources.size < 3) {
		factors.push({
			category: 'behavioral',
			action: 'Complete behavioral interviews',
			potential_impact: 'medium',
			points: '+10-20 points',
		});
	}

	// Check experience components
	const expSources = new Set(componentsByType.experience.map((c) => c.source_type));
	if (!expSources.has('work_history')) {
		factors.push({
			category: 'experience',
			action: 'Add work experience to your profile',
			potential_impact: 'high',
			points: '+15-25 points',
		});
	}

	return factors;
}

/**
 * Explain a decision for a specific candidate-job pair with weighted factor breakdowns.
 * Caches result in ai_decision_explanations.
 */
async function explainDecisionForJob(userId, jobId, applicationId) {
	const scoreResult = await pool.query('SELECT * FROM omniscore_results WHERE user_id = $1', [
		userId,
	]);
	const score = scoreResult.rows[0] || {};

	const components = await pool.query(
		`SELECT component_type, source_type, points, max_points, weight, metadata, created_at
       FROM score_components WHERE user_id = $1 ORDER BY created_at DESC`,
		[userId],
	);

	const jobResult = await pool.query('SELECT title, requirements FROM jobs WHERE id = $1', [jobId]);
	const job = jobResult.rows[0] || {};

	// #1458: re-sourced from match_results (the real, written match store).
	// candidate_job_matches never existed. Only honest persisted columns are
	// selected: weighted_score is the headline match score and the JSONB skill
	// lists feed the explanation text. There is NO persisted skill-match or
	// experience-match score to fall back to (match_results.experience_score
	// is never written — always 0), and no cultural-fit source at all, so the
	// Cultural Fit factor is dropped rather than fabricated. Weights are NOT
	// renormalised (STOP 1 on #1458): the surviving 0.4/0.3/0.2 sum to 0.9 and
	// overall_score is computed independently, never as their sum.
	const matchResult = await pool.query(
		`SELECT weighted_score AS overall_match_score,
              matching_skills AS skills_matched, missing_skills AS skills_missing
       FROM match_results WHERE candidate_id = $1 AND job_id = $2`,
		[userId, jobId],
	);
	const match = matchResult.rows[0] || {};

	const overallScore =
		parseFloat(score.overall_score) || parseFloat(match.overall_match_score) || 0;
	const factorBreakdowns = [];

	factorBreakdowns.push({
		factor: 'Technical Skills',
		weight: 0.4,
		score: parseFloat(score.technical_score) || 0,
		contribution: ((parseFloat(score.technical_score) || 0) * 0.4).toFixed(2),
		explanation: match.skills_matched
			? `Matched skills: ${Array.isArray(match.skills_matched) ? match.skills_matched.join(', ') : match.skills_matched}`
			: 'Based on technical assessment and resume parsing',
		data_source: 'score_components',
	});

	factorBreakdowns.push({
		factor: 'Behavioral Fit',
		weight: 0.3,
		score: parseFloat(score.behavioral_score) || 0,
		contribution: ((parseFloat(score.behavioral_score) || 0) * 0.3).toFixed(2),
		explanation: 'Derived from interview responses and personality indicators',
		data_source: 'omniscore_results',
	});

	factorBreakdowns.push({
		factor: 'Experience Match',
		weight: 0.2,
		score: parseFloat(score.experience_score) || 0,
		contribution: ((parseFloat(score.experience_score) || 0) * 0.2).toFixed(2),
		explanation: `Relevance to ${job.title || 'this role'} based on work history`,
		data_source: 'score_components',
	});

	const explanation = {
		user_id: userId,
		job_id: jobId,
		application_id: applicationId || null,
		overall_score: overallScore,
		job_title: job.title,
		factor_breakdowns: factorBreakdowns,
		component_details: components.rows.map((c) => ({
			component_type: c.component_type,
			source_type: c.source_type,
			points: parseFloat(c.points),
			max_points: parseFloat(c.max_points),
			weight: parseFloat(c.weight),
			metadata: c.metadata,
			date: c.created_at,
		})),
		generated_at: new Date().toISOString(),
	};

	// Cache (#1458: hash bumped to v2-match-results — rows written under the
	// old shape must never be served as new-shape; the euComplianceService
	// cache read only serves rows carrying the current hash).
	await pool.query(
		`INSERT INTO ai_decision_explanations (user_id, job_id, application_id, overall_score, factor_breakdowns, weights_hash, generated_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'v2-match-results', NOW(), NOW())
       ON CONFLICT (user_id, job_id) DO UPDATE SET
         application_id = EXCLUDED.application_id,
         overall_score = EXCLUDED.overall_score,
         factor_breakdowns = EXCLUDED.factor_breakdowns,
         weights_hash = EXCLUDED.weights_hash,
         generated_at = EXCLUDED.generated_at,
         updated_at = NOW()`,
		[userId, jobId, applicationId || null, overallScore, JSON.stringify(explanation)],
	);

	return explanation;
}

/**
 * Explain why a specific score decision was made
 * (e.g., why a candidate was rejected)
 *
 * Returns the FULL record, including decision.recruiter_notes (#927):
 * any caller serving a candidate audience must shape the result with
 * an allowlist projection at the route boundary (see
 * toCandidateSafeDecisionExplanation in routes/compliance.js) — never
 * pass this object to a candidate as-is.
 */
async function explainDecision(applicationId) {
	try {
		// #1152-C (R3): repointed from the never-written omniscore_results
		// table to the live omni_scores store. Pass-through (Rex scale
		// decision 2026-10-20, §4 R3): total_score is native 300–850 and
		// becomes current_omniscore as-is; factor columns are native
		// 0–100 (behavior_score is the reliability + soft-skills
		// composite). experience_score is no longer selected — it was
		// consumed nowhere in this function after #1458.
		const app = await pool.query(
			`
        SELECT ja.*, j.title as job_title,
               u.name as candidate_name, u.email as candidate_email,
               os.total_score AS overall_score, os.technical_score, os.behavior_score AS behavioral_score
        FROM job_applications ja
        JOIN jobs j ON ja.job_id = j.id
        JOIN users u ON ja.candidate_id = u.id
        LEFT JOIN omni_scores os ON os.user_id = ja.candidate_id
        WHERE ja.id = $1
      `,
			[applicationId],
		);

		if (app.rows.length === 0) {
			throw new Error('Application not found');
		}

		const application = app.rows[0];

		// Get matching score if available
		// #1458: candidate_job_matches never existed (no migration creates it,
		// nothing writes it) — this query 500'd every authorised call. The real
		// match store is match_results; this function consumes only its headline
		// score and the missing-skills list, so only those two are selected.
		// match_explanation is deliberately NOT selected: it is a recruiter-side
		// JSONB artifact embedding company TrustScore text (privacy seat, #1458
		// STOP 1) and must never reach a candidate-reachable path.
		const matchResult = await pool.query(
			`
        SELECT weighted_score AS overall_match_score, missing_skills AS skills_missing
        FROM match_results
        WHERE candidate_id = $1 AND job_id = $2
      `,
			[application.candidate_id, application.job_id],
		);

		// #1458 (interim honesty, #1152 owns the JOIN's disposition): with no
		// omni_scores row the LEFT JOIN yields NULL and parseFloat(NULL)
		// is NaN — surface null (insufficient data), never NaN.
		const parsedCurrentOmniscore = parseFloat(application.overall_score);

		const explanation = {
			application_id: applicationId,
			candidate: {
				name: application.candidate_name,
				email: application.candidate_email,
			},
			job: {
				title: application.job_title,
			},
			decision: {
				status: application.status,
				decided_at: application.updated_at,
				recruiter_notes: application.recruiter_notes,
			},
			omniscore_at_apply: parseFloat(application.omniscore_at_apply),
			current_omniscore: Number.isFinite(parsedCurrentOmniscore) ? parsedCurrentOmniscore : null,
			factors: [],
		};

		// Explain based on status
		if (application.status === 'rejected') {
			// #1152-C behaviour change (Rex §3.3/§5.3): omniscore_at_apply
			// has always held native 300–850 values, so the old < 60 test
			// could never fire. 630 = 300 + 60 × 5.5 preserves the intent
			// on the native scale — this factor now fires for real.
			if (application.omniscore_at_apply < 630) {
				explanation.factors.push({
					factor: 'Low OmniScore',
					value: application.omniscore_at_apply,
					impact: 'negative',
					explanation: `OmniScore of ${application.omniscore_at_apply} was below the competitive threshold of 630`,
				});
			}

			if (matchResult.rows.length > 0) {
				const match = matchResult.rows[0];
				if (parseFloat(match.overall_match_score) < 70) {
					explanation.factors.push({
						factor: 'Low Job Match Score',
						value: match.overall_match_score,
						impact: 'negative',
						explanation: `Overall match score of ${match.overall_match_score}% indicates limited fit for this role`,
					});
				}

				// missing_skills is JSONB: the pg driver returns it parsed, but
				// normalise defensively so a string form cannot throw on .join.
				let skillsMissing = match.skills_missing;
				if (typeof skillsMissing === 'string') {
					try {
						skillsMissing = JSON.parse(skillsMissing);
					} catch {
						skillsMissing = [];
					}
				}
				if (Array.isArray(skillsMissing) && skillsMissing.length > 0) {
					explanation.factors.push({
						factor: 'Missing Required Skills',
						value: skillsMissing,
						impact: 'negative',
						explanation: `Candidate lacks: ${skillsMissing.join(', ')}`,
					});
				}
			}
		}

		return explanation;
	} catch (error) {
		console.error('Decision explanation failed:', error);
		throw error;
	}
}

module.exports = {
	explainOmniScore,
	explainDecisionForJob,
	explainDecision,
};
