const pool = require('../lib/db');
const auditLogService = require('./auditLogService');

/**
 * #1204: delete one object for a retention purge, routing by key form.
 *
 * Provider-prefixed keys (`r2/…`, `b2/…`) go to file-storage
 * deleteStorageObject, unchanged. `s3://<bucket>/<key>` locations — the
 * form #1130/GAP-A3 register for session recordings — name the
 * RECORDING_STORAGE_* egress bucket, which file-storage cannot address
 * (it parses `s3:` as a provider name and soft-fails forever). Those go
 * to sessionRecordingStore's verified delete: it parses with the existing
 * parseRecordingLocation, fails closed when the bucket is not the
 * configured RECORDING_STORAGE_BUCKET, and verifies the object is gone.
 * Its throws are normalised to the same soft-fail shape deleteStorageObject
 * returns, so callers keep their exact stamp-only-on-success semantics:
 * a failed delete is counted and the row is left for retry — never a
 * false stamp, never a guessed bucket.
 *
 * @param {string} objectKey
 * @returns {Promise<{deleted: boolean, reason?: string, alreadyGone?: boolean}>}
 */
async function deletePurgeStorageObject(objectKey) {
	if (typeof objectKey === 'string' && objectKey.startsWith('s3://')) {
		// Specialist review F-1: a malformed s3:// value (no bucket or no
		// key — corrupt/legacy rows) must NOT reach the recording store:
		// its parser falls through to a bucket-less key and the verified
		// delete would "succeed" on a literal garbage key in the configured
		// bucket, producing a false stamp. Well-formed means exactly the
		// `s3://<bucket>/<key>` form the writers emit.
		if (!/^s3:\/\/[^/]+\/.+/.test(objectKey)) {
			return { deleted: false, reason: 'unrecognized_format' };
		}
		// ponytail: lazy-require like the purge methods below — the recording
		// store pulls crypto/db modules the rest of this service doesn't need.
		const { deleteRecordingObjectVerified } = require('../lib/sessionRecordingStore');
		try {
			await deleteRecordingObjectVerified(objectKey);
			return { deleted: true };
		} catch (err) {
			return {
				deleted: false,
				reason: err.code || err.name || 'recording_storage_delete_failed',
				...(err.nonRetryable ? { nonRetryable: true } : {}),
			};
		}
	}
	const { deleteStorageObject } = require('../lib/file-storage');
	return deleteStorageObject(objectKey);
}

/**
 * EU AI Act Compliance Service
 * Handles risk classification, per-job-posting bias detection,
 * four-fifths rule, explainability, human oversight, data retention,
 * consent management, and transparency report generation.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Service pattern with static methods for backward compatibility
class EuComplianceService {
	// ── Risk Classification ──────────────────────────────────────────────

	static async classifyJobRisk({ jobId, riskLevel, riskFactors, justification, assessedBy }) {
		const result = await pool.query(
			`INSERT INTO job_risk_classifications (job_id, risk_level, risk_factors, justification, assessed_by, assessed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (job_id) DO UPDATE SET
         risk_level = EXCLUDED.risk_level,
         risk_factors = EXCLUDED.risk_factors,
         justification = EXCLUDED.justification,
         assessed_by = EXCLUDED.assessed_by,
         assessed_at = EXCLUDED.assessed_at,
         updated_at = NOW()
       RETURNING *`,
			[jobId, riskLevel, JSON.stringify(riskFactors || []), justification || null, assessedBy],
		);
		return result.rows[0];
	}

	static async getJobRiskClassification(jobId) {
		const result = await pool.query(
			`SELECT jrc.*, j.title as job_title, j.company_id
       FROM job_risk_classifications jrc
       JOIN jobs j ON j.id = jrc.job_id
       WHERE jrc.job_id = $1`,
			[jobId],
		);
		return result.rows[0] || null;
	}

	/**
	 * @param {{ companyId?: number, riskLevel?: string, limit?: number, offset?: number }} options
	 */
	static async listJobRiskClassifications({ companyId, riskLevel, limit = 50, offset = 0 } = {}) {
		const conditions = [];
		const params = [];
		let idx = 1;

		if (companyId) {
			conditions.push(`j.company_id = $${idx++}`);
			params.push(companyId);
		}
		if (riskLevel) {
			conditions.push(`jrc.risk_level = $${idx++}`);
			params.push(riskLevel);
		}

		const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
		const countResult = await pool.query(
			`SELECT COUNT(*)::int as total FROM job_risk_classifications jrc JOIN jobs j ON j.id = jrc.job_id ${where}`,
			params,
		);
		const total = countResult.rows[0].total;

		params.push(limit, offset);
		const result = await pool.query(
			`SELECT jrc.*, j.title as job_title, j.company_id
       FROM job_risk_classifications jrc
       JOIN jobs j ON j.id = jrc.job_id
       ${where}
       ORDER BY jrc.assessed_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
			params,
		);
		return { rows: result.rows, total };
	}

	// ── Bias Detection Per Posting ───────────────────────────────────────

	/**
	 * Calculate bias metrics for a specific job posting.
	 * Uses candidate_demographics + job_applications to compute selection rates.
	 */
	static async calculateBiasMetricsForJob(
		jobId,
		{ selectionStatuses = ['interview', 'hired', 'offer_extended'] } = {},
	) {
		const metrics = [];

		// Determine demographic attributes to analyze
		const attributes = ['gender', 'ethnicity', 'age_group', 'disability_status'];

		for (const attr of attributes) {
			const breakdown = await pool.query(
				`
        WITH applicants AS (
          SELECT
            ja.candidate_id,
            ja.status,
            cd.${attr}
          FROM job_applications ja
          LEFT JOIN candidate_demographics cd ON cd.user_id = ja.candidate_id
          WHERE ja.job_id = $1 AND cd.${attr} IS NOT NULL
        ),
        group_stats AS (
          SELECT
            ${attr} as group_value,
            COUNT(*) as total_applicants,
            COUNT(*) FILTER (WHERE status = ANY($2)) as selected_count
          FROM applicants
          GROUP BY ${attr}
        )
        SELECT
          group_value,
          total_applicants,
          selected_count,
          CASE WHEN total_applicants > 0 THEN selected_count::decimal / total_applicants ELSE 0 END as selection_rate
        FROM group_stats
        ORDER BY total_applicants DESC
      `,
				[jobId, selectionStatuses],
			);

			const groups = breakdown.rows;
			if (groups.length < 2) continue;

			const rates = groups.map((g) => parseFloat(g.selection_rate));
			const maxRate = Math.max(...rates);
			const minRate = Math.min(...rates);
			const overallRatio = maxRate > 0 ? minRate / maxRate : 0;
			const flagged = overallRatio < 0.8;

			const metric = await pool.query(
				`INSERT INTO bias_metrics (job_id, metric_type, demographic_attribute, group_breakdowns, overall_ratio, flagged, threshold_used, calculated_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0.80, NOW(), NOW())
         ON CONFLICT (job_id, metric_type, demographic_attribute) DO UPDATE SET
           group_breakdowns = EXCLUDED.group_breakdowns,
           overall_ratio = EXCLUDED.overall_ratio,
           flagged = EXCLUDED.flagged,
           threshold_used = EXCLUDED.threshold_used,
           calculated_at = EXCLUDED.calculated_at,
           updated_at = NOW()
         RETURNING *`,
				[jobId, 'four_fifths_rule', attr, JSON.stringify(groups), overallRatio, flagged],
			);
			metrics.push(metric.rows[0]);
		}

		return metrics;
	}

	static async getBiasMetricsForJob(jobId) {
		const result = await pool.query(
			`SELECT * FROM bias_metrics WHERE job_id = $1 ORDER BY calculated_at DESC`,
			[jobId],
		);
		return result.rows;
	}

	/**
	 * @param {{ companyId?: number, limit?: number, offset?: number }} options
	 */
	static async listFlaggedBiasMetrics({ companyId, limit = 50, offset = 0 } = {}) {
		const conditions = ['bm.flagged = true'];
		const params = [];
		let idx = 1;

		if (companyId) {
			conditions.push(`j.company_id = $${idx++}`);
			params.push(companyId);
		}

		const where = `WHERE ${conditions.join(' AND ')}`;
		const countResult = await pool.query(
			`SELECT COUNT(*)::int as total FROM bias_metrics bm JOIN jobs j ON j.id = bm.job_id ${where}`,
			params,
		);
		const total = countResult.rows[0].total;

		params.push(limit, offset);
		const result = await pool.query(
			`SELECT bm.*, j.title as job_title, j.company_id
       FROM bias_metrics bm
       JOIN jobs j ON j.id = bm.job_id
       ${where}
       ORDER BY bm.calculated_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
			params,
		);
		return { rows: result.rows, total };
	}

	// ── Explainability ───────────────────────────────────────────────────

	/**
	 * Generate or retrieve an explainability breakdown for a candidate-job pair.
	 */
	/**
	 * @param {{ userId: number, jobId: number, applicationId?: number, weightsHash?: string }} options
	 */
	static async explainDecisionForJob({ userId, jobId, applicationId, weightsHash }) {
		// Check cache first — #1458: serve a cached row ONLY when it carries
		// the effective weights hash. Rows written under an older shape must
		// never be served as new-shape; they fall through, are regenerated,
		// and the upsert below overwrites them. #1525 bumps the hash to
		// 'v3-omni-scores-split': every row written by the pre-repoint shape
		// (headline mixed from the dead omniscore_results table and the
		// match score) is stale by construction and regenerates.
		const effectiveHash = weightsHash || 'v3-omni-scores-split';
		const cached = await pool.query(
			`SELECT * FROM ai_decision_explanations WHERE user_id = $1 AND job_id = $2`,
			[userId, jobId],
		);
		if (cached.rows.length > 0 && cached.rows[0].weights_hash === effectiveHash) {
			return cached.rows[0];
		}

		// #1525 (Rex scale decision §4 R4, Lead+Lex disposition): repoint
		// from the never-written omniscore_results table to omni_scores.
		// Presence is keyed on the row and on total_score NOT NULL —
		// never on !== undefined against a {} default.
		const scoreResult = await pool.query(
			`SELECT total_score, technical_score, behavior_score, factor_scores
       FROM omni_scores WHERE user_id = $1`,
			[userId],
		);
		const score = scoreResult.rows[0] || null;
		const hasTotal = score !== null && score.total_score !== null && score.total_score !== undefined;

		const components = await pool.query(
			`SELECT component_type, source_type, points, max_points, weight, metadata, created_at
       FROM score_components
       WHERE user_id = $1
       ORDER BY created_at DESC`,
			[userId],
		);

		const jobResult = await pool.query(`SELECT title, requirements FROM jobs WHERE id = $1`, [
			jobId,
		]);
		const job = jobResult.rows[0] || {};

		// #1458: re-sourced from match_results (the real, written match store);
		// candidate_job_matches never existed. Only honest persisted columns:
		// no persisted skill-match score exists, match_results.experience_score
		// is never written (always 0 — sourcing it would fabricate a measured
		// 0), there is no cultural-fit source, and match_explanation is a
		// recruiter-side artifact embedding company TrustScore text that must
		// never reach a candidate-reachable path (privacy seat, #1458 STOP 1).
		const matchResult = await pool.query(
			`SELECT weighted_score AS overall_match_score,
              matching_skills AS skills_matched, missing_skills AS skills_missing
       FROM match_results
       WHERE candidate_id = $1 AND job_id = $2`,
			[userId, jobId],
		);
		const match = matchResult.rows[0] || null;
		const hasMatch =
			match !== null &&
			match.overall_match_score !== null &&
			match.overall_match_score !== undefined;
		const overallMatchScore = hasMatch ? parseFloat(match.overall_match_score) : null;

		// #1525 condition 2: persist NOTHING when neither a non-NULL total
		// nor a match exists — return an honest insufficient-data result
		// instead of the old overall_score: 0 explanation row.
		if (!hasTotal && !hasMatch) {
			return {
				user_id: userId,
				job_id: jobId,
				application_id: applicationId || null,
				overall_score: null,
				score_scale: '300-850',
				overall_match_score: null,
				factor_breakdowns: [],
				insufficient_data: true,
				job_title: job.title,
				generated_at: new Date().toISOString(),
			};
		}

		// #1525 split semantics: the headline is ONLY the omni_scores
		// total_score pass-through (native 300-850). The match score is
		// NEVER a fallback for it — it travels under its own name only.
		const overallScore = hasTotal ? parseFloat(score.total_score) : null;

		// Factor breakdowns — pass-through 0-100 values, no weights and
		// no contribution formula (the 0.4/0.3/0.2 formula described a
		// model that never ran; dropped per Rex §4 R4). OmniScore-derived
		// factors require a non-NULL total; a factor with no real source
		// value is omitted, never rendered as a measured 0.
		const factorBreakdowns = [];
		if (hasTotal) {
			if (score.technical_score !== null && score.technical_score !== undefined) {
				factorBreakdowns.push({
					factor: 'Technical Skills',
					score: parseFloat(score.technical_score),
					explanation:
						match && match.skills_matched
							? `Matched skills: ${Array.isArray(match.skills_matched) ? match.skills_matched.join(', ') : match.skills_matched}`
							: 'Based on technical assessment and resume parsing',
					data_source: 'omni_scores.technical_score',
				});
			}

			// behavior_score is a computed composite (reliability +
			// soft-skills average), not an assessment "behavioral_score"
			// — labelled as what it is (Rex §5.4).
			if (score.behavior_score !== null && score.behavior_score !== undefined) {
				factorBreakdowns.push({
					factor: 'Behavioral Fit',
					score: parseFloat(score.behavior_score),
					explanation:
						'Composite of reliability and soft-skills signals from the OmniScore engine',
					data_source: 'omni_scores.behavior_score',
				});
			}

			// Experience is a factor_scores factor (experience_quality),
			// never an "experience_score" column — no such column exists.
			const experienceQuality =
				score.factor_scores && typeof score.factor_scores === 'object'
					? score.factor_scores.experience_quality
					: undefined;
			if (experienceQuality !== null && experienceQuality !== undefined) {
				factorBreakdowns.push({
					factor: 'Experience Match',
					score: parseFloat(experienceQuality),
					explanation: `Relevance to ${job.title || 'this role'} based on work history`,
					data_source: 'omni_scores.factor_scores.experience_quality',
				});
			}
		}

		// #1458: the Cultural Fit factor stays dropped, not remapped — it
		// has no real source (never fabricate it from
		// mutual_matches.mutual_fit_score).

		// Add component-level detail
		const componentDetails = components.rows.map((c) => ({
			component_type: c.component_type,
			source_type: c.source_type,
			points: parseFloat(c.points),
			max_points: parseFloat(c.max_points),
			weight: parseFloat(c.weight),
			metadata: c.metadata,
			date: c.created_at,
		}));

		const explanationData = {
			user_id: userId,
			job_id: jobId,
			application_id: applicationId || null,
			overall_score: overallScore,
			score_scale: '300-850',
			overall_match_score: overallMatchScore,
			factor_breakdowns: factorBreakdowns,
			component_details: componentDetails,
			job_title: job.title,
			generated_at: new Date().toISOString(),
		};

		const hash = effectiveHash;
		const upsert = await pool.query(
			`INSERT INTO ai_decision_explanations (user_id, job_id, application_id, overall_score, factor_breakdowns, weights_hash, generated_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (user_id, job_id) DO UPDATE SET
         application_id = EXCLUDED.application_id,
         overall_score = EXCLUDED.overall_score,
         factor_breakdowns = EXCLUDED.factor_breakdowns,
         weights_hash = EXCLUDED.weights_hash,
         generated_at = EXCLUDED.generated_at,
         updated_at = NOW()
       RETURNING *`,
			[userId, jobId, applicationId || null, overallScore, JSON.stringify(explanationData), hash],
		);

		return upsert.rows[0];
	}

	static async getExplanationForJob(userId, jobId) {
		const result = await pool.query(
			`SELECT * FROM ai_decision_explanations WHERE user_id = $1 AND job_id = $2`,
			[userId, jobId],
		);
		return result.rows[0] || null;
	}

	// ── Human Oversight ──────────────────────────────────────────────────

	static async recordHumanOverride({
		applicationId,
		userId,
		jobId,
		originalScore,
		newScore,
		originalStatus,
		newStatus,
		reason,
		overriddenBy,
	}) {
		if (!reason || reason.trim().length < 5) {
			throw new Error('Override reason is required (min 5 characters)');
		}

		// Log to tamper-evident audit trail first
		const auditRecord = await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.HUMAN_OVERRIDE,
			entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
			entityId: userId,
			actorId: overriddenBy,
			actorRole: 'human_reviewer',
			jobId,
			companyId: null, // fetched below if needed
			payload: {
				application_id: applicationId,
				original_score: originalScore,
				new_score: newScore,
				original_status: originalStatus,
				new_status: newStatus,
				reason,
			},
		});

		const result = await pool.query(
			`INSERT INTO human_overrides
       (application_id, user_id, job_id, original_score, new_score, original_status, new_status, reason, overridden_by, overridden_at, audit_trail_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
       RETURNING *`,
			[
				applicationId,
				userId,
				jobId,
				originalScore || null,
				newScore || null,
				originalStatus || null,
				newStatus || null,
				reason,
				overriddenBy,
				auditRecord.id,
			],
		);

		return result.rows[0];
	}

	static async getOverridesForJob(jobId, { limit = 100, offset = 0 } = {}) {
		const countResult = await pool.query(
			`SELECT COUNT(*)::int as total FROM human_overrides WHERE job_id = $1`,
			[jobId],
		);
		const result = await pool.query(
			`SELECT ho.*, u.name as overridden_by_name
       FROM human_overrides ho
       LEFT JOIN users u ON u.id = ho.overridden_by
       WHERE ho.job_id = $1
       ORDER BY ho.overridden_at DESC
       LIMIT $2 OFFSET $3`,
			[jobId, limit, offset],
		);
		return { rows: result.rows, total: countResult.rows[0].total };
	}

	static async getOverrideById(id) {
		const result = await pool.query(
			`SELECT ho.*, u.name as overridden_by_name
       FROM human_overrides ho
       LEFT JOIN users u ON u.id = ho.overridden_by
       WHERE ho.id = $1`,
			[id],
		);
		return result.rows[0] || null;
	}

	// ── Data Retention ───────────────────────────────────────────────────

	/**
	 * @param {{ companyId?: number }} options
	 */
	static async getRetentionPolicies({ companyId } = {}) {
		const result = await pool.query(
			`SELECT * FROM data_retention_policies
       WHERE company_id IS NULL OR company_id = $1
       ORDER BY policy_scope, data_type`,
			[companyId || 0],
		);
		return result.rows;
	}

	static async setRetentionPolicy({
		dataType,
		retentionDays,
		autoDelete,
		companyId,
		policyScope,
		scopeId,
		description,
	}) {
		const result = await pool.query(
			`INSERT INTO data_retention_policies (data_type, retention_days, auto_delete, company_id, policy_scope, scope_id, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (data_type, COALESCE(company_id, 0), COALESCE(scope_id, 0), policy_scope) DO UPDATE SET
         retention_days = EXCLUDED.retention_days,
         auto_delete = EXCLUDED.auto_delete,
         description = EXCLUDED.description,
         updated_at = NOW()
       RETURNING *`,
			[
				dataType,
				retentionDays,
				autoDelete,
				companyId || null,
				policyScope || 'global',
				scopeId || null,
				description || null,
			],
		);
		return result.rows[0];
	}

	/**
	 * Execute automated purge based on retention policies.
	 * Returns summary of what was purged.
	 */
	/**
	 * @param {{ dryRun?: boolean, companyId?: number }} options
	 */
	static async executePurge({ dryRun = true, companyId } = {}) {
		const policies = await EuComplianceService.getRetentionPolicies({ companyId });
		const summary = [];
		// #799 (G-1): every attributable branch carries a legal-hold SQL
		// predicate (NOT EXISTS against active legal_holds) and reports
		// how many eligible rows were held back (held_skips) — held items
		// are visibly skipped, never silently retained. Attribution:
		// audit_logs.user_id, assessment_results.user_id (verified at
		// routes/compliance.js — the table has no CREATE TABLE in
		// migrations), candidate_profiles.user_id,
		// ai_decision_explanations.user_id. interview_recordings delegates
		// to purgeExpiredRecordings, which consults per row.
		const { heldPredicate, notHeldPredicate } = require('../lib/legalHold');

		for (const policy of policies.filter((p) => p.auto_delete)) {
			const cutoff = new Date();
			cutoff.setDate(cutoff.getDate() - policy.retention_days);

			let deletedCount = 0;
			let heldSkips = 0;

			switch (policy.data_type) {
				case 'audit_logs': {
					const heldRes = await pool.query(
						`SELECT COUNT(*)::int as c FROM audit_logs WHERE created_at < $1 AND ${heldPredicate('audit_logs.user_id')}`,
						[cutoff],
					);
					heldSkips = heldRes.rows[0].c;
					if (!dryRun) {
						const r = await pool.query(
							`DELETE FROM audit_logs WHERE created_at < $1 AND ${notHeldPredicate('audit_logs.user_id')}`,
							[cutoff],
						);
						deletedCount = r.rowCount;
					} else {
						const r = await pool.query(
							`SELECT COUNT(*)::int as c FROM audit_logs WHERE created_at < $1 AND ${notHeldPredicate('audit_logs.user_id')}`,
							[cutoff],
						);
						deletedCount = r.rows[0].c;
					}
					break;
				}
				case 'interview_recordings': {
					// S-077 (#760): routed through the storage-aware purge —
					// a bare DELETE would orphan R2/B2 objects (the #743 exposure).
					// purgeExpiredRecordings soft-deletes + deletes storage objects.
					if (!dryRun) {
						const res = await EuComplianceService.purgeExpiredRecordings({ dryRun: false });
						deletedCount = res.deletedCount;
						heldSkips = res.heldSkips || 0;
					} else {
						// D-1 (PR #915): recordings rows carry their own
						// session — count held with the session-scoped
						// predicate so the dry-run count matches the
						// per-row live path (purgeExpiredRecordings)
						// instead of over-retaining cross-company rows.
						const heldRes = await pool.query(
							`SELECT COUNT(*)::int as c FROM interview_recordings ir
							 JOIN interview_events ie ON ie.id = ir.interview_event_id
							 WHERE ir.created_at < $1 AND ${heldPredicate('ie.candidate_id', { sessionIdExpr: 'ir.interview_session_id' })}`,
							[cutoff],
						);
						heldSkips = heldRes.rows[0].c;
						const r = await pool.query(
							`SELECT COUNT(*)::int as c FROM interview_recordings WHERE created_at < $1`,
							[cutoff],
						);
						deletedCount = r.rows[0].c - heldSkips;
					}
					break;
				}
				case 'assessment_results': {
					const heldRes = await pool.query(
						`SELECT COUNT(*)::int as c FROM assessment_results WHERE created_at < $1 AND ${heldPredicate('assessment_results.user_id')}`,
						[cutoff],
					);
					heldSkips = heldRes.rows[0].c;
					if (!dryRun) {
						const r = await pool.query(
							`DELETE FROM assessment_results WHERE created_at < $1 AND ${notHeldPredicate('assessment_results.user_id')}`,
							[cutoff],
						);
						deletedCount = r.rowCount;
					} else {
						const r = await pool.query(
							`SELECT COUNT(*)::int as c FROM assessment_results WHERE created_at < $1 AND ${notHeldPredicate('assessment_results.user_id')}`,
							[cutoff],
						);
						deletedCount = r.rows[0].c;
					}
					break;
				}
				case 'candidate_data': {
					// Anonymize rather than hard-delete for compliance
					const heldRes = await pool.query(
						`SELECT COUNT(*)::int as c FROM candidate_profiles WHERE updated_at < $1 AND ${heldPredicate('candidate_profiles.user_id')}`,
						[cutoff],
					);
					heldSkips = heldRes.rows[0].c;
					if (!dryRun) {
						const r = await pool.query(
							`UPDATE candidate_profiles
               SET headline = '[redacted]', bio = '[redacted]', phone = NULL,
                   linkedin_url = NULL, github_url = NULL, portfolio_url = NULL,
                   resume_url = NULL, photo_url = NULL, location = NULL,
                   updated_at = NOW()
               WHERE updated_at < $1 AND ${notHeldPredicate('candidate_profiles.user_id')}`,
							[cutoff],
						);
						deletedCount = r.rowCount;
					} else {
						const r = await pool.query(
							`SELECT COUNT(*)::int as c FROM candidate_profiles WHERE updated_at < $1 AND ${notHeldPredicate('candidate_profiles.user_id')}`,
							[cutoff],
						);
						deletedCount = r.rows[0].c;
					}
					break;
				}
				case 'ai_decision_explanations': {
					const heldRes = await pool.query(
						`SELECT COUNT(*)::int as c FROM ai_decision_explanations WHERE generated_at < $1 AND ${heldPredicate('ai_decision_explanations.user_id')}`,
						[cutoff],
					);
					heldSkips = heldRes.rows[0].c;
					if (!dryRun) {
						const r = await pool.query(
							`DELETE FROM ai_decision_explanations WHERE generated_at < $1 AND ${notHeldPredicate('ai_decision_explanations.user_id')}`,
							[cutoff],
						);
						deletedCount = r.rowCount;
					} else {
						const r = await pool.query(
							`SELECT COUNT(*)::int as c FROM ai_decision_explanations WHERE generated_at < $1 AND ${notHeldPredicate('ai_decision_explanations.user_id')}`,
							[cutoff],
						);
						deletedCount = r.rows[0].c;
					}
					break;
				}
				default:
					break;
			}

			summary.push({
				data_type: policy.data_type,
				retention_days: policy.retention_days,
				cutoff: cutoff.toISOString(),
				affected_count: deletedCount,
				held_skips: heldSkips,
				dry_run: dryRun,
			});
		}

		return summary;
	}

	/**
	 * Soft-delete recordings past their per-recording retention_expires_at
	 * (#322, Task 4). Session-linked recordings get retention_expires_at set
	 * to 30 days after the hiring decision; the table default is 90 days.
	 * Transcript, analysis, key frames, and scores are retained — only the
	 * raw recording row is marked deleted (storage file cleanup is a
	 * follow-up). Runs daily via the server.js retention cron.
	 * @returns {Promise<{ deletedCount: number }>}
	 */
	static async purgeExpiredRecordings({ dryRun = true } = {}) {
		// S-077 (#760): storage-object deletion added. The old version only
		// soft-deleted DB rows; storage files accumulated indefinitely.
		// Per-row processing (not bulk UPDATE) so each storage object can be
		// deleted before its row is marked — storage-before-DB ordering is
		// crash-safe: a failed DB update leaves a row pointing at a missing
		// object (playback 404s, next run retries), never an orphaned file.
		const { rows } = await pool.query(
			`SELECT ir.id, ir.storage_path, ie.candidate_id, ir.interview_session_id FROM interview_recordings ir
			 LEFT JOIN interview_events ie ON ie.id = ir.interview_event_id
			 WHERE ir.retention_expires_at < NOW() AND ir.status != 'deleted'
			 ORDER BY ir.retention_expires_at ASC
			 LIMIT 500`,
		);

		let deletedCount = 0;
		let storageDeleted = 0;
		let errors = 0;
		let heldSkips = 0;

		// ponytail: lazy-require to avoid hard deps at module load.
		const livekitService = require('../server/services/livekit');
		// #799 (G-1): per-row legal-hold consult BEFORE the storage delete
		// and BEFORE the transcript anonymisation below (both are part of
		// the purge). Candidate attribution via interview_events.candidate_id
		// (the join pattern at lib/erasureService.js). Unattributable rows
		// (no interview_event) fall back to the any-active-hold skip.
		// isLegalHoldActive / anyHoldActive are fail-closed.
		// #915 PR-gate fix round (privacy F-1): the recording's
		// interview_session_id is ALSO passed — candidates carry no
		// users.company_id, so a company-only hold reaches this row only
		// via its session's company (isHeld now always merges it).
		const { isLegalHoldActive } = require('../lib/observerCapture');
		const { anyHoldActive } = require('../lib/legalHold');

		for (const row of rows) {
			try {
				const held =
					row.candidate_id != null || row.interview_session_id != null
						? await isLegalHoldActive({
								candidateId: row.candidate_id ?? undefined,
								sessionId: row.interview_session_id ?? undefined,
							})
						: await anyHoldActive();
				if (held) {
					heldSkips++;
					continue;
				}
				let storageOk = true;
				if (!dryRun && row.storage_path) {
					// storage_path is encrypted BYTEA — decrypt to get the key.
					const objectKey = livekitService.decryptStoragePath(row);
					if (!objectKey) {
						// Specialist review F-2 (pre-existing): decrypt returns
						// null on ANY decrypt error — a row whose pointer cannot
						// be read has NOT had its object deleted, so it must not
						// be marked deleted (that would exclude it from retry
						// forever while the object survives). Fail closed.
						storageOk = false;
						errors++;
						console.warn(`[retention] storage path undecryptable for recording ${row.id} — leaving for retry`);
					} else {
						// #1204: decrypted pointers for #1130-path recordings
						// are s3:// locations — route by key form.
						const r = await deletePurgeStorageObject(objectKey);
						if (r.deleted) {
							storageDeleted++;
						} else {
							// Q2 fix: don't mark deleted if storage delete soft-failed
							storageOk = false;
							errors++;
							console.warn(`[retention] storage delete soft-failed for recording ${row.id}: ${r.reason} — leaving for retry`);
						}
					}
				}
				if (!dryRun && storageOk) {
					await pool.query(
						`UPDATE interview_recordings
						 SET status = 'deleted', updated_at = NOW()
						 WHERE id = $1`,
						[row.id],
					);
					// Q1 fix: transcripts cascade only on hard DELETE, not soft-delete.
					// Anonymize transcripts of purged recordings — plaintext candidate
					// speech must not survive indefinitely on the scheduled path.
					await pool.query(
						`UPDATE interview_transcripts SET text = '[purged]' WHERE recording_id = $1`,
						[row.id],
					);
				}
				if (storageOk) deletedCount++;
			} catch (err) {
				// ponytail: best-effort per row — one bad row must not stop the sweep.
				console.error(`[retention] purgeExpiredRecordings row ${row.id} failed:`, err.message);
				errors++;
			}
		}

		await EuComplianceService._auditPurge({
			runType: 'interview_recordings',
			objectCount: deletedCount,
			storageDeleted,
			dryRun,
			errorCount: errors,
			heldSkips,
			periodCovered: null, // per-row retention_expires_at; batch range not tracked
		});

		return { deletedCount, storageDeleted, dryRun, errors, heldSkips };
	}

	/**
	 * Sweep the recording_objects registry (S-077 #760): delete expired
	 * storage objects from R2/B2, then stamp deleted_at.
	 *
	 * Crash-safe: storage object deleted BEFORE the DB stamp. Idempotent:
	 * deleteStorageObject treats NoSuchKey as success. Batched with
	 * LIMIT + SKIP LOCKED so concurrent cron runs don't double-process.
	 *
	 * DRY-RUN FIRST: defaults to dryRun=true. Live deletion requires an
	 * explicit { dryRun: false } — Sumanth's deletion-scope rule.
	 *
	 * @param {object} [opts]
	 * @param {boolean} [opts.dryRun=true]
	 * @param {number} [opts.batchSize=100]
	 * @returns {Promise<{purgedCount, storageDeleted, dryRun, errors}>}
	 */
	static async purgeRecordingObjects({ dryRun = true, batchSize = 100 } = {}) {
		// Gate A (S-085 #787, design §5.1): only CONFIRMED registrations are
		// purge-eligible — 'pending' intent rows belong to the reconciler
		// (lib/observerCapture.js). Legacy frame/recording rows are born
		// 'confirmed' (migration 257 default), so their behaviour is
		// unchanged. Observer-audio rows additionally pass the legal-hold
		// seam (P-10) and delete their observer_audio_chunks row with the
		// object (design §5.1 step 3).
		const { isLegalHoldActive } = require('../lib/observerCapture');
		const { anyHoldActive } = require('../lib/legalHold');

		const { rows } = await pool.query(
			`SELECT object_key, object_type, expires_at, candidate_id, interview_id FROM recording_objects
			 WHERE expires_at < NOW() AND deleted_at IS NULL AND registration_state = 'confirmed'
			 ORDER BY expires_at ASC
			 LIMIT $1
			 FOR UPDATE SKIP LOCKED`,
			[batchSize],
		);

		let purgedCount = 0;
		let storageDeleted = 0;
		let errors = 0;
		let heldSkips = 0;
		let minExpiresAt = null;
		let maxExpiresAt = null;

		for (const row of rows) {
			try {
				// Track period covered for the audit entry
				if (!minExpiresAt || row.expires_at < minExpiresAt) minExpiresAt = row.expires_at;
				if (!maxExpiresAt || row.expires_at > maxExpiresAt) maxExpiresAt = row.expires_at;

				// #799 (G-1): the hold check now covers EVERY registry row,
				// not only observer_audio — recording_objects already
				// selects candidate_id for legacy frame/recording rows.
				// Unattributable rows (candidate_id NULL) fall back to the
				// any-active-hold skip. Both checks are fail-closed.
				const held =
					row.candidate_id != null
						? await isLegalHoldActive({ candidateId: row.candidate_id, sessionId: row.interview_id })
						: await anyHoldActive();
				if (held) {
					heldSkips++;
					continue;
				}

				if (!dryRun) {
					// #1204: s3:// registry keys (session recordings) route to
					// the RECORDING_STORAGE_* client via the shared helper.
					const r = await deletePurgeStorageObject(row.object_key);
					// Q2 fix: only stamp deleted_at on CONFIRMED storage delete.
					// A soft-failed delete (r.deleted === false) leaves the row
					// for retry — never mark purged what wasn't deleted.
					if (r.deleted) {
						storageDeleted++;
						purgedCount++;
						await pool.query(
							`UPDATE recording_objects SET deleted_at = NOW() WHERE object_key = $1`,
							[row.object_key],
						);
						if (row.object_type === 'observer_audio') {
							await pool.query(
								`DELETE FROM observer_audio_chunks WHERE object_key = $1`,
								[row.object_key],
							);
						}
					} else {
						// Specialist review F-3: a soft-failed row is NOT
						// purged — it must not be counted in purgedCount /
						// the audit entry's objectCount. (Dry-run still
						// counts every enumerated row below.)
						errors++;
						// GAP-J (review F-5): reason + type only — never log
						// the storage key itself.
						console.warn(`[retention] storage delete soft-failed for ${row.object_type} object: ${r.reason} — leaving for retry`);
					}
				} else {
					purgedCount++;
				}
			} catch (err) {
				console.error(`[retention] purgeRecordingObjects ${row.object_type} object failed:`, err.message);
				errors++;
			}
		}

		await EuComplianceService._auditPurge({
			runType: 'recording_objects',
			objectCount: purgedCount,
			storageDeleted,
			dryRun,
			errorCount: errors,
			heldSkips,
			periodCovered: minExpiresAt ? { minExpiresAt, maxExpiresAt } : null,
		});

		return { purgedCount, storageDeleted, dryRun, errors, heldSkips };
	}

	/**
	 * Gate A (S-085 #787, design §5.1): purge expired observer speech
	 * measurements. The measurements envelope is DEK-encrypted per session
	 * (no storage object) — row deletion is the whole purge. 30-day
	 * retention, same RETENTION_PURGE_LIVE dry-run-default gate as the
	 * other purges (wired in the server.js retention cron). The legal-hold
	 * seam (P-10) is consulted per row; held rows are skipped and counted.
	 */
	static async purgeExpiredSpeechMeasurements({ dryRun = true, retentionDays = null } = {}) {
		const { isLegalHoldActive } = require('../lib/observerCapture');
		// Retention comes from the policy row when not explicitly passed
		// (§5.1, DB review M6); 30 is only the fallback.
		if (retentionDays == null) {
			const { rows: policyRows } = await pool.query(
				`SELECT retention_days FROM data_retention_policies WHERE data_type = 'observer_audio'`,
			);
			retentionDays = policyRows[0]?.retention_days ?? 30;
		}
		const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

		let deletedCount = 0;
		let heldSkips = 0;
		// Batched with an id cursor (DB review m5): never load the whole
		// expired set at once; the cursor keeps dry-run counts exact too.
		let lastId = 0;
		for (;;) {
			const { rows } = await pool.query(
				`SELECT id, candidate_id, interview_session_id FROM observer_speech_measurements
				 WHERE created_at < $1 AND id > $2 ORDER BY id LIMIT 500`,
				[cutoff, lastId],
			);
			if (rows.length === 0) break;
			for (const row of rows) {
				lastId = row.id;
				if (await isLegalHoldActive({ candidateId: row.candidate_id, sessionId: row.interview_session_id })) {
					heldSkips++;
					continue;
				}
				if (!dryRun) {
					await pool.query(`DELETE FROM observer_speech_measurements WHERE id = $1`, [row.id]);
				}
				deletedCount++;
			}
			if (rows.length < 500) break;
		}

		await EuComplianceService._auditPurge({
			runType: 'observer_speech_measurements',
			objectCount: deletedCount,
			storageDeleted: 0,
			dryRun,
			errorCount: 0,
			heldSkips,
		});

		return { deletedCount, heldSkips, dryRun };
	}

	/**
	 * Purge expired biometric_templates (S-077 #760, Delta 4).
	 * The S-015 deletion jobs referenced in migration 246 were verified
	 * ABSENT (zero code hits) — this folds template expiry into the purge cron.
	 * DB-row delete only: DEK crypto-shredding is the hard guarantee, and
	 * templates have no separate storage objects.
	 *
	 * @param {object} [opts]
	 * @param {boolean} [opts.dryRun=true]
	 * @param {number} [opts.retentionDays=90]
	 */
	static async purgeExpiredTemplates({ dryRun = true, retentionDays = 90 } = {}) {
		const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

		// #799 (G-1): biometric_templates has NO identity column by
		// deliberate schema design (migration 246: opaque subject_ref,
		// no join path to users), so per-candidate consultation is
		// impossible. Build default (STOP 1 Open Question 1, fallback
		// pattern): while ANY hold is active, this purge skips its run
		// and reports why — coarse, fail-safe, reversible. The
		// alternative (exempting templates) would purge a held
		// candidate's templates on schedule.
		const { anyHoldActive } = require('../lib/legalHold');
		if (await anyHoldActive()) {
			const r = await pool.query(
				`SELECT COUNT(*)::int AS c FROM biometric_templates WHERE created_at < $1`,
				[cutoff],
			);
			const heldSkips = r.rows[0].c;
			await EuComplianceService._auditPurge({
				runType: 'biometric_templates',
				objectCount: 0,
				storageDeleted: 0,
				dryRun,
				errorCount: 0,
				heldSkips,
			});
			return { deletedCount: 0, dryRun, heldSkips, skippedDueToHold: true };
		}

		let deletedCount;
		if (!dryRun) {
			const r = await pool.query(
				`DELETE FROM biometric_templates WHERE created_at < $1`,
				[cutoff],
			);
			deletedCount = r.rowCount;
		} else {
			const r = await pool.query(
				`SELECT COUNT(*)::int AS c FROM biometric_templates WHERE created_at < $1`,
				[cutoff],
			);
			deletedCount = r.rows[0].c;
		}

		await EuComplianceService._auditPurge({
			runType: 'biometric_templates',
			objectCount: deletedCount,
			storageDeleted: 0,
			dryRun,
			errorCount: 0,
			heldSkips: 0,
		});

		return { deletedCount, dryRun, heldSkips: 0, skippedDueToHold: false };
	}

	/**
	 * S-047 (E-008, #695): Purge expired AI Observer reports.
	 * 30-day retention per spec §5.3 (aligned with vision-frame precedent,
	 * not the 90-day session default). Observer reports contain biometric-derived
	 * analytics (gaze, voice, expression) — storage limitation (GDPR Art. 5(1)(e))
	 * requires the shorter period.
	 *
	 * DRY-RUN FIRST: defaults to dryRun=true. Live deletion requires the
	 * RETENTION_PURGE_LIVE gate (same as S-077).
	 */
	static async purgeExpiredObserverReports({ dryRun = true, retentionDays = 30 } = {}) {
		const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

		// #799 (G-1): per-row hold consult (converted from a bulk DELETE).
		// Candidate attribution via interview_sessions.candidate_id (the
		// join pattern at lib/erasureService.js). Both checks fail-closed.
		const { isLegalHoldActive } = require('../lib/observerCapture');
		const { anyHoldActive } = require('../lib/legalHold');
		const { rows } = await pool.query(
			`SELECT r.id, s.candidate_id, r.interview_session_id FROM ai_observer_reports r
			 LEFT JOIN interview_sessions s ON s.id = r.interview_session_id
			 WHERE r.created_at < $1`,
			[cutoff],
		);

		let deletedCount = 0;
		let heldSkips = 0;
		for (const row of rows) {
			// #915 PR-gate fix round (privacy F-1): pass the report's
			// session id as well as the candidate — the session's company
			// is the only path by which a company-only hold protects a
			// candidate's reports (candidates have no users.company_id).
			const held =
				row.candidate_id != null || row.interview_session_id != null
					? await isLegalHoldActive({
							candidateId: row.candidate_id ?? undefined,
							sessionId: row.interview_session_id ?? undefined,
						})
					: await anyHoldActive();
			if (held) {
				heldSkips++;
				continue;
			}
			if (!dryRun) {
				await pool.query(`DELETE FROM ai_observer_reports WHERE id = $1`, [row.id]);
			}
			deletedCount++;
		}

		await EuComplianceService._auditPurge({
			runType: 'ai_observer_reports',
			objectCount: deletedCount,
			storageDeleted: 0,
			dryRun,
			errorCount: 0,
			heldSkips,
		});

		return { deletedCount, dryRun, heldSkips };
	}

	/**
	 * Write a per-batch purge audit entry (compliance-auditor finding:
	 * run id, object count, period covered, dry-run flag, error count).
	 *
	 * Uses auditLogService.logEvent (not biometricAudit.logAccess) because
	 * purge runs are system actions with no userId/candidateId — logAccess
	 * requires both and would throw, making the audit a silent no-op.
	 * Failure here is LOUD (not best-effort-silent): the audit entry IS the
	 * Art. 5(2) compliance artifact.
	 */
	static async _auditPurge({ runType, objectCount, storageDeleted, dryRun, errorCount, periodCovered = null, heldSkips = 0 }) {
		const auditLogService = require('./auditLogService');
		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.STATUS_CHANGE,
			entityType: 'retention_purge',
			entityId: 0,
			actorId: null, // system cron, not a user action
			actorRole: 'system',
			payload: {
				runId: `${runType}-${Date.now()}`,
				runType,
				objectCount,
				storageDeleted,
				dryRun: !!dryRun,
				errorCount,
				heldSkips, // #799: held rows visibly skipped, never silently retained
				periodCovered, // { minExpiresAt, maxExpiresAt } per batch
			},
		});
	}

	// ── Consent Management ───────────────────────────────────────────────

	static async recordConsent({
		userId,
		consentType,
		consented,
		ipAddress,
		userAgent,
		metadata,
		recordedBy,
	}) {
		const existing = await pool.query(
			`SELECT * FROM consent_records WHERE user_id = $1 AND consent_type = $2 ORDER BY created_at DESC LIMIT 1`,
			[userId, consentType],
		);

		let consentRecord;
		if (existing.rows.length > 0) {
			// Update existing
			const prev = existing.rows[0];
			const result = await pool.query(
				`UPDATE consent_records
         SET consented = $1, consented_at = $2, ip_address = $3, metadata = $4, updated_at = NOW(),
             revoked_at = NULL, revoked_by = NULL, revocation_reason = NULL
         WHERE id = $5
         RETURNING *`,
				[
					consented,
					consented ? new Date() : null,
					ipAddress,
					JSON.stringify(metadata || {}),
					prev.id,
				],
			);
			consentRecord = result.rows[0];

			// Log history
			await pool.query(
				`INSERT INTO consent_history (consent_record_id, user_id, consent_type, previous_value, new_value, changed_at, changed_by, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)`,
				[
					prev.id,
					userId,
					consentType,
					prev.consented,
					consented,
					recordedBy || null,
					ipAddress,
					userAgent,
				],
			);
		} else {
			const result = await pool.query(
				`INSERT INTO consent_records (user_id, consent_type, consented, consented_at, ip_address, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING *`,
				[
					userId,
					consentType,
					consented,
					consented ? new Date() : null,
					ipAddress,
					JSON.stringify(metadata || {}),
				],
			);
			consentRecord = result.rows[0];
		}

		return consentRecord;
	}

	static async revokeConsent({ consentId, reason, revokedBy, ipAddress, userAgent }) {
		const existing = await pool.query(`SELECT * FROM consent_records WHERE id = $1`, [consentId]);
		if (existing.rows.length === 0) {
			throw new Error('Consent record not found');
		}
		const prev = existing.rows[0];

		const result = await pool.query(
			`UPDATE consent_records
       SET consented = false, revoked_at = NOW(), revoked_by = $1, revocation_reason = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
			[revokedBy, reason, consentId],
		);

		await pool.query(
			`INSERT INTO consent_history (consent_record_id, user_id, consent_type, previous_value, new_value, changed_at, changed_by, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)`,
			[
				consentId,
				prev.user_id,
				prev.consent_type,
				prev.consented,
				false,
				revokedBy,
				ipAddress,
				userAgent,
			],
		);

		return result.rows[0];
	}

	/**
	 * @param {number} userId
	 * @param {{ consentType?: string, limit?: number, offset?: number }} options
	 */
	static async getConsentHistory(userId, { consentType, limit = 100, offset = 0 } = {}) {
		const conditions = ['ch.user_id = $1'];
		/** @type {(string | number)[]} */
		const params = [userId];
		let idx = 2;

		if (consentType) {
			conditions.push(`ch.consent_type = $${idx++}`);
			params.push(consentType);
		}

		const where = `WHERE ${conditions.join(' AND ')}`;
		const countResult = await pool.query(
			`SELECT COUNT(*)::int as total FROM consent_history ch ${where}`,
			params,
		);
		const result = await pool.query(
			`SELECT ch.*, u.name as changed_by_name
       FROM consent_history ch
       LEFT JOIN users u ON u.id = ch.changed_by
       ${where}
       ORDER BY ch.changed_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
			[...params, limit, offset],
		);
		return { rows: result.rows, total: countResult.rows[0].total };
	}

	// ── Transparency Reports ─────────────────────────────────────────────

	static async generateTransparencyReport({
		companyId,
		periodStart,
		periodEnd,
		reportType = 'regulator',
		generatedBy,
		format = 'json',
	}) {
		// Risk classifications summary
		const riskResult = await pool.query(
			`SELECT risk_level, COUNT(*)::int as count
       FROM job_risk_classifications jrc
       JOIN jobs j ON j.id = jrc.job_id
       WHERE j.company_id = $1
       GROUP BY risk_level`,
			[companyId],
		);

		// Bias metrics summary
		const biasResult = await pool.query(
			`SELECT COUNT(*)::int as total_jobs_analyzed,
              COUNT(*) FILTER (WHERE flagged = true)::int as flagged_jobs
       FROM bias_metrics bm
       JOIN jobs j ON j.id = bm.job_id
       WHERE j.company_id = $1 AND bm.calculated_at BETWEEN $2 AND $3`,
			[companyId, periodStart, periodEnd],
		);

		// Override summary
		const overrideResult = await pool.query(
			`SELECT COUNT(*)::int as total_overrides,
              COUNT(*) FILTER (WHERE new_status = 'hired')::int as hired_overrides,
              COUNT(*) FILTER (WHERE new_status = 'rejected')::int as rejected_overrides
       FROM human_overrides ho
       JOIN jobs j ON j.id = ho.job_id
       WHERE j.company_id = $1 AND ho.overridden_at BETWEEN $2 AND $3`,
			[companyId, periodStart, periodEnd],
		);

		// Consent stats
		const consentResult = await pool.query(
			`SELECT consent_type,
              COUNT(*) FILTER (WHERE consented = true)::int as consented_count,
              COUNT(*) FILTER (WHERE consented = false)::int as denied_count,
              COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::int as revoked_count
       FROM consent_records cr
       JOIN users u ON u.id = cr.user_id
       WHERE u.company_id = $1 OR EXISTS (
         SELECT 1 FROM job_applications ja WHERE ja.candidate_id = cr.user_id AND ja.company_id = $1
       )
       GROUP BY consent_type`,
			[companyId],
		);

		// Retention compliance
		const retentionResult = await pool.query(
			`SELECT data_type, retention_days, auto_delete, policy_scope
       FROM data_retention_policies
       WHERE company_id IS NULL OR company_id = $1
       ORDER BY data_type`,
			[companyId],
		);

		const reportData = {
			period_start: periodStart,
			period_end: periodEnd,
			generated_at: new Date().toISOString(),
			risk_classifications: {
				total_classified: riskResult.rows.reduce((s, r) => s + r.count, 0),
				by_level: riskResult.rows,
			},
			bias_metrics: biasResult.rows[0],
			human_overrides: overrideResult.rows[0],
			consent_stats: consentResult.rows,
			retention_policies: retentionResult.rows,
		};

		const result = await pool.query(
			`INSERT INTO transparency_reports
       (company_id, report_type, period_start, period_end, risk_classifications_summary, bias_metrics_summary,
        override_summary, consent_stats, retention_compliance, report_data, generated_at, generated_by, format, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, 'draft')
       RETURNING *`,
			[
				companyId,
				reportType,
				periodStart,
				periodEnd,
				JSON.stringify(reportData.risk_classifications),
				JSON.stringify(reportData.bias_metrics),
				JSON.stringify(reportData.human_overrides),
				JSON.stringify(reportData.consent_stats),
				JSON.stringify(reportData.retention_policies),
				JSON.stringify(reportData),
				generatedBy,
				format,
			],
		);

		return { report: result.rows[0], data: reportData };
	}

	static async finalizeTransparencyReport(reportId) {
		const result = await pool.query(
			`UPDATE transparency_reports SET status = 'finalized', updated_at = NOW() WHERE id = $1 RETURNING *`,
			[reportId],
		);
		return result.rows[0] || null;
	}

	/**
	 * @param {{ companyId?: number, limit?: number, offset?: number }} options
	 */
	static async getTransparencyReports({ companyId, limit = 20, offset = 0 } = {}) {
		const conditions = [];
		const params = [];
		let idx = 1;

		if (companyId) {
			conditions.push(`company_id = $${idx++}`);
			params.push(companyId);
		}

		const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
		const countResult = await pool.query(
			`SELECT COUNT(*)::int as total FROM transparency_reports ${where}`,
			params,
		);
		const result = await pool.query(
			`SELECT * FROM transparency_reports ${where} ORDER BY generated_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
			[...params, limit, offset],
		);
		return { rows: result.rows, total: countResult.rows[0].total };
	}
}

module.exports = EuComplianceService;
