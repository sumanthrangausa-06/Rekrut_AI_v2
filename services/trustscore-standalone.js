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

const pool = require('../lib/db');

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

/**
 * Reapplication Rate — % of rejected candidates who apply again.
 *
 * A rejected candidate (status 'rejected'/'declined') counts as "reapplied"
 * if they submit an application to a *different* job at the same company
 * within 365 days after their first rejection. The UNIQUE(job_id, candidate_id)
 * constraint guarantees any later application is to a different job.
 *
 * Note: "first rejection" is anchored on applied_at of the first rejected
 * application — the table has no rejected_at timestamp, so the actual
 * rejection moment is approximated.
 */
async function calculateReapplicationRate(companyId) {
	const result = await pool.query(
		`
    WITH first_rejections AS (
      SELECT candidate_id, MIN(applied_at) AS first_rejection_at
      FROM job_applications
      WHERE company_id = $1
        AND status IN ('rejected', 'declined')
      GROUP BY candidate_id
    ),
    reapplied AS (
      SELECT fr.candidate_id
      FROM first_rejections fr
      WHERE EXISTS (
        SELECT 1
        FROM job_applications ja
        WHERE ja.company_id = $1
          AND ja.candidate_id = fr.candidate_id
          AND ja.applied_at > fr.first_rejection_at
          AND ja.applied_at <= fr.first_rejection_at + INTERVAL '365 days'
      )
    )
    SELECT
      (SELECT COUNT(*) FROM first_rejections) AS total_rejected,
      (SELECT COUNT(*) FROM reapplied) AS reapplied_count
  `,
		[companyId],
	);

	const row = result.rows[0];
	const totalRejected = parseInt(row.total_rejected, 10);
	const reappliedCount = parseInt(row.reapplied_count, 10);

	if (totalRejected < MIN_DATA_POINTS.REAPPLICATION_RATE) {
		return {
			score: 0,
			reapplication_rate: 0,
			reapplied_count: reappliedCount,
			total_rejected: totalRejected,
			sufficient: false,
		};
	}

	const rate = Math.round((reappliedCount / totalRejected) * 1000) / 10;
	const score = Math.round((reappliedCount / totalRejected) * 100);

	return {
		score,
		reapplication_rate: rate,
		reapplied_count: reappliedCount,
		total_rejected: totalRejected,
		sufficient: true,
	};
}

/**
 * Communication Responsiveness — recruiter reply speed and coverage.
 *
 * Sender attribution uses conversations.candidate_id / conversations.recruiter_id
 * directly (no users-role join needed). Conversations with NULL recruiter_id are
 * excluded — replies can't be attributed there. Messages from unknown senders
 * are ignored.
 *
 * Metric A (speed): median hours from a candidate message to the next recruiter
 * reply in the same conversation. One recruiter reply resolves all pending
 * candidate messages before it. ≤4h=100, ≤24h=75, ≤72h=40, >72h=0.
 * Metric B (coverage): % of candidate messages that received any recruiter reply.
 * Score = speed * 0.5 + coverage * 0.5.
 */
async function calculateCommunicationResponsiveness(companyId) {
	const result = await pool.query(
		`
    SELECT m.conversation_id, m.sender_id, m.created_at,
           c.candidate_id, c.recruiter_id
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.company_id = $1
      AND c.recruiter_id IS NOT NULL
    ORDER BY m.conversation_id, m.created_at ASC, m.id ASC
  `,
		[companyId],
	);

	const byConversation = new Map();
	for (const row of result.rows) {
		if (!byConversation.has(row.conversation_id)) {
			byConversation.set(row.conversation_id, []);
		}
		byConversation.get(row.conversation_id).push(row);
	}

	let totalCandidateMessages = 0;
	let repliedCount = 0;
	const replyHours = [];

	for (const messages of byConversation.values()) {
		const candidateId = parseInt(messages[0].candidate_id, 10);
		const recruiterId = parseInt(messages[0].recruiter_id, 10);
		const pending = [];

		for (const m of messages) {
			const senderId = parseInt(m.sender_id, 10);
			const at = new Date(m.created_at).getTime();

			if (senderId === candidateId) {
				totalCandidateMessages++;
				pending.push(at);
			} else if (senderId === recruiterId) {
				for (const sentAt of pending) {
					repliedCount++;
					replyHours.push((at - sentAt) / 3600000);
				}
				pending.length = 0;
			}
			// Unknown senders (system/AI messages) are ignored.
		}
		// Candidate messages still pending at the end count against coverage.
	}

	if (totalCandidateMessages < MIN_DATA_POINTS.COMMUNICATION) {
		return {
			score: 0,
			median_reply_hours: null,
			reply_coverage_pct: 0,
			total_messages: totalCandidateMessages,
			sufficient: false,
		};
	}

	const coverage = Math.round((repliedCount / totalCandidateMessages) * 1000) / 10;

	let medianHours = null;
	let speedScore = 0;
	if (replyHours.length > 0) {
		const sorted = [...replyHours].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		const median =
			sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
		medianHours = Math.round(median * 10) / 10;

		if (medianHours <= 4) speedScore = 100;
		else if (medianHours <= 24) speedScore = 75;
		else if (medianHours <= 72) speedScore = 40;
		else speedScore = 0;
	}

	const score = Math.round(speedScore * 0.5 + coverage * 0.5);

	return {
		score,
		median_reply_hours: medianHours,
		reply_coverage_pct: coverage,
		total_messages: totalCandidateMessages,
		sufficient: true,
	};
}

/**
 * Offer Decline Analysis — are declines the company's fault?
 *
 * Categorizes decline_reason text by keyword:
 * - company_fault: compensation/culture/process complaints
 * - external: competing offers, personal/life reasons
 * - unclear: everything else (neutral — counts in denominator, not as fault)
 *
 * Score = (1 - company_fault_rate) * 100
 */
const COMPANY_FAULT_KEYWORDS = [
	'compensat',
	'salary',
	'pay',
	'cultur',
	'process',
	'slow',
	'ghost',
	'rude',
	'unprofessional',
	'benefit',
];
const EXTERNAL_KEYWORDS = [
	'competing offer',
	'personal',
	'location',
	'relocation',
	'family',
	'timing',
];

function categorizeDeclineReason(reason) {
	const r = (reason || '').toLowerCase();
	if (COMPANY_FAULT_KEYWORDS.some((k) => r.includes(k))) return 'company_fault';
	if (EXTERNAL_KEYWORDS.some((k) => r.includes(k))) return 'external';
	return 'unclear';
}

async function calculateOfferDeclineAnalysis(companyId) {
	// offers.company_id is set on INSERT (migrations/015 + backfill), no join needed
	const result = await pool.query(
		`SELECT decline_reason FROM offers
     WHERE company_id = $1 AND decline_reason IS NOT NULL`,
		[companyId],
	);

	const total = result.rows.length;
	if (total < MIN_DATA_POINTS.OFFER_DECLINE) {
		return {
			score: 0,
			company_fault_rate: 0,
			company_fault_count: 0,
			total_declines: total,
			sufficient: false,
		};
	}

	const companyFaultCount = result.rows.filter(
		(row) => categorizeDeclineReason(row.decline_reason) === 'company_fault',
	).length;
	const faultRate = companyFaultCount / total;

	return {
		score: Math.round((1 - faultRate) * 100),
		company_fault_rate: Math.round(faultRate * 1000) / 1000,
		company_fault_count: companyFaultCount,
		total_declines: total,
		sufficient: true,
	};
}

/**
 * Posting Efficiency — hires per posting (sweet-spot curve)
 *
 * Ratio = hires / active postings over trailing 12 months.
 * Sweet spot 0.3–2.0 = 100 (healthy hiring).
 * Below 0.3 scales down linearly (spray-and-pray or stale postings).
 * Above 2.0 = 70 (suspicious — possible data issue or mass hiring event).
 */
async function calculatePostingEfficiency(companyId) {
	const result = await pool.query(
		`SELECT
       (SELECT COUNT(*) FROM jobs
        WHERE company_id = $1 AND status = 'active'
          AND created_at > NOW() - INTERVAL '12 months') AS postings,
       (SELECT COUNT(*) FROM job_applications
        WHERE company_id = $1 AND status = 'hired'
          AND updated_at > NOW() - INTERVAL '12 months') AS hires`,
		[companyId],
	);

	const postings = parseInt(result.rows[0].postings, 10);
	const hires = parseInt(result.rows[0].hires, 10);

	if (postings < MIN_DATA_POINTS.POSTING_EFFICIENCY) {
		return {
			score: 0,
			hires_per_posting: 0,
			hires,
			postings,
			sufficient: false,
		};
	}

	const ratio = hires / postings;
	let score;
	if (ratio >= 0.3 && ratio <= 2.0) {
		score = 100;
	} else if (ratio < 0.3) {
		score = Math.round((ratio / 0.3) * 100);
	} else {
		score = 70;
	}

	return {
		score,
		hires_per_posting: Math.round(ratio * 100) / 100,
		hires,
		postings,
		sufficient: true,
	};
}

/**
 * Stage Fluidity — are candidates stuck in hiring stages?
 *
 * Reconstructs per-application stage timelines from application_status_changed
 * audit events (plus applied_at as the implicit entry into 'applied').
 * Duration in a stage = time from entering it to the next transition.
 *
 * Thresholds (median days): screening > 14, interview > 21, offer > 7.
 * Score starts at 100, subtracts 25 per violating stage (floors at 0).
 */
const STAGE_THRESHOLDS = {
	screening: 14,
	interview: 21,
	offer: 7,
};
const TERMINAL_STATUSES = new Set(['hired', 'rejected', 'withdrawn', 'declined', 'cancelled']);

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function calculateStageFluidity(companyId) {
	const result = await pool.query(
		`SELECT al.target_id AS application_id,
            al.metadata->>'new_status' AS status,
            al.created_at,
            ja.applied_at
     FROM audit_logs al
     JOIN job_applications ja ON ja.id = al.target_id
     WHERE al.action_type = 'application_status_changed'
       AND al.target_type = 'job_application'
       AND ja.company_id = $1
     ORDER BY al.target_id, al.created_at`,
		[companyId],
	);

	// Group events by application
	const byApp = new Map();
	for (const row of result.rows) {
		if (!row.status) continue; // skip events without a recorded status
		if (!byApp.has(row.application_id)) byApp.set(row.application_id, []);
		byApp.get(row.application_id).push(row);
	}

	// Build timelines and compute days spent in each (non-terminal) stage
	const durationsByStage = {};
	let transitions = 0;
	for (const rows of byApp.values()) {
		const timeline = rows[0].applied_at
			? [{ status: 'applied', at: new Date(rows[0].applied_at) }]
			: [];
		for (const r of rows) timeline.push({ status: r.status, at: new Date(r.created_at) });

		for (let i = 0; i < timeline.length - 1; i++) {
			const days = (timeline[i + 1].at - timeline[i].at) / 86400000;
			if (days < 0) continue; // clock-skew guard
			const stage = timeline[i].status;
			if (TERMINAL_STATUSES.has(stage)) continue;
			if (!durationsByStage[stage]) durationsByStage[stage] = [];
			durationsByStage[stage].push(days);
			transitions++;
		}
	}

	if (transitions < MIN_DATA_POINTS.STAGE_FLUIDITY) {
		return {
			score: 0,
			median_days_per_stage: {},
			violations: [],
			transitions,
			sufficient: false,
		};
	}

	const medianDaysPerStage = {};
	for (const [stage, durations] of Object.entries(durationsByStage)) {
		medianDaysPerStage[stage] = Math.round(median(durations) * 10) / 10;
	}

	const violations = Object.entries(STAGE_THRESHOLDS)
		.filter(
			([stage, threshold]) =>
				medianDaysPerStage[stage] !== undefined && medianDaysPerStage[stage] > threshold,
		)
		.map(([stage]) => stage);

	return {
		score: Math.max(0, 100 - violations.length * 25),
		median_days_per_stage: medianDaysPerStage,
		violations,
		transitions,
		sufficient: true,
	};
}

module.exports = {
	MIN_DATA_POINTS,
	calculateWorkplaceCulture,
	calculateCandidateNPS,
	calculateReapplicationRate,
	calculateCommunicationResponsiveness,
	calculateOfferDeclineAnalysis,
	calculatePostingEfficiency,
	calculateStageFluidity,
};
