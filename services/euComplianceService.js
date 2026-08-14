const pool = require('../lib/db');
const auditLogService = require('./auditLogService');

/**
 * EU AI Act Compliance Service
 * Handles risk classification, per-job-posting bias detection,
 * four-fifths rule, explainability, human oversight, data retention,
 * consent management, and transparency report generation.
 */
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
	static async calculateBiasMetricsForJob(jobId, { selectionStatuses = ['interview', 'hired', 'offer_extended'] } = {}) {
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
			const flagged = overallRatio < 0.80;

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
		// Check cache first
		const cached = await pool.query(
			`SELECT * FROM ai_decision_explanations WHERE user_id = $1 AND job_id = $2`,
			[userId, jobId],
		);
		if (cached.rows.length > 0 && (!weightsHash || cached.rows[0].weights_hash === weightsHash)) {
			return cached.rows[0];
		}

		// Build explanation from existing tables
		const scoreResult = await pool.query(
			`SELECT * FROM omniscore_results WHERE user_id = $1`,
			[userId],
		);
		const score = scoreResult.rows[0] || {};

		const components = await pool.query(
			`SELECT component_type, source_type, points, max_points, weight, metadata, created_at
       FROM score_components
       WHERE user_id = $1
       ORDER BY created_at DESC`,
			[userId],
		);

		const jobResult = await pool.query(`SELECT title, requirements FROM jobs WHERE id = $1`, [jobId]);
		const job = jobResult.rows[0] || {};

		const matchResult = await pool.query(
			`SELECT overall_match_score, skill_match_score, experience_match_score, cultural_match_score,
              skills_matched, skills_missing, match_explanation
       FROM candidate_job_matches
       WHERE candidate_id = $1 AND job_id = $2`,
			[userId, jobId],
		);
		const match = matchResult.rows[0] || {};

		// Build weighted factor breakdowns
		const factorBreakdowns = [];
		const overallScore = parseFloat(score.overall_score) || parseFloat(match.overall_match_score) || 0;

		// Technical factor
		if (score.technical_score !== undefined || match.skill_match_score !== undefined) {
			factorBreakdowns.push({
				factor: 'Technical Skills',
				weight: 0.40,
				score: parseFloat(score.technical_score) || parseFloat(match.skill_match_score) || 0,
				contribution: ((parseFloat(score.technical_score) || parseFloat(match.skill_match_score) || 0) * 0.40).toFixed(2),
				explanation: match.skills_matched
					? `Matched skills: ${Array.isArray(match.skills_matched) ? match.skills_matched.join(', ') : match.skills_matched}`
					: 'Based on technical assessment and resume parsing',
				data_source: 'score_components',
			});
		}

		// Behavioral factor
		if (score.behavioral_score !== undefined) {
			factorBreakdowns.push({
				factor: 'Behavioral Fit',
				weight: 0.30,
				score: parseFloat(score.behavioral_score) || 0,
				contribution: ((parseFloat(score.behavioral_score) || 0) * 0.30).toFixed(2),
				explanation: 'Derived from interview responses and personality indicators',
				data_source: 'omniscore_results',
			});
		}

		// Experience factor
		if (score.experience_score !== undefined || match.experience_match_score !== undefined) {
			factorBreakdowns.push({
				factor: 'Experience Match',
				weight: 0.20,
				score: parseFloat(score.experience_score) || parseFloat(match.experience_match_score) || 0,
				contribution: ((parseFloat(score.experience_score) || parseFloat(match.experience_match_score) || 0) * 0.20).toFixed(2),
				explanation: `Relevance to ${job.title || 'this role'} based on work history`,
				data_source: 'score_components',
			});
		}

		// Cultural fit
		if (match.cultural_match_score !== undefined) {
			factorBreakdowns.push({
				factor: 'Cultural Fit',
				weight: 0.10,
				score: parseFloat(match.cultural_match_score) || 0,
				contribution: ((parseFloat(match.cultural_match_score) || 0) * 0.10).toFixed(2),
				explanation: match.match_explanation || 'Alignment with company values and team dynamics',
				data_source: 'candidate_job_matches',
			});
		}

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
			factor_breakdowns: factorBreakdowns,
			component_details: componentDetails,
			job_title: job.title,
			generated_at: new Date().toISOString(),
		};

		const hash = weightsHash || 'default-v1';
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

	static async setRetentionPolicy({ dataType, retentionDays, autoDelete, companyId, policyScope, scopeId, description }) {
		const result = await pool.query(
			`INSERT INTO data_retention_policies (data_type, retention_days, auto_delete, company_id, policy_scope, scope_id, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (data_type, COALESCE(company_id, 0), COALESCE(scope_id, 0), policy_scope) DO UPDATE SET
         retention_days = EXCLUDED.retention_days,
         auto_delete = EXCLUDED.auto_delete,
         description = EXCLUDED.description,
         updated_at = NOW()
       RETURNING *`,
			[dataType, retentionDays, autoDelete, companyId || null, policyScope || 'global', scopeId || null, description || null],
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
		const policies = await this.getRetentionPolicies({ companyId });
		const summary = [];

		for (const policy of policies.filter((p) => p.auto_delete)) {
			const cutoff = new Date();
			cutoff.setDate(cutoff.getDate() - policy.retention_days);

			let deletedCount = 0;

			switch (policy.data_type) {
			case 'audit_logs': {
				if (!dryRun) {
					const r = await pool.query(`DELETE FROM audit_logs WHERE created_at < $1`, [cutoff]);
					deletedCount = r.rowCount;
				} else {
					const r = await pool.query(`SELECT COUNT(*)::int as c FROM audit_logs WHERE created_at < $1`, [cutoff]);
					deletedCount = r.rows[0].c;
				}
				break;
			}
			case 'interview_recordings': {
				if (!dryRun) {
					const r = await pool.query(`DELETE FROM interview_recordings WHERE created_at < $1`, [cutoff]);
					deletedCount = r.rowCount;
				} else {
					const r = await pool.query(`SELECT COUNT(*)::int as c FROM interview_recordings WHERE created_at < $1`, [cutoff]);
					deletedCount = r.rows[0].c;
				}
				break;
			}
			case 'assessment_results': {
				if (!dryRun) {
					const r = await pool.query(`DELETE FROM assessment_results WHERE created_at < $1`, [cutoff]);
					deletedCount = r.rowCount;
				} else {
					const r = await pool.query(`SELECT COUNT(*)::int as c FROM assessment_results WHERE created_at < $1`, [cutoff]);
					deletedCount = r.rows[0].c;
				}
				break;
			}
			case 'candidate_data': {
				// Anonymize rather than hard-delete for compliance
				if (!dryRun) {
					const r = await pool.query(
						`UPDATE candidate_profiles
               SET headline = '[redacted]', bio = '[redacted]', phone = NULL,
                   linkedin_url = NULL, github_url = NULL, portfolio_url = NULL,
                   resume_url = NULL, photo_url = NULL, location = NULL,
                   updated_at = NOW()
               WHERE updated_at < $1`,
						[cutoff],
					);
					deletedCount = r.rowCount;
				} else {
					const r = await pool.query(`SELECT COUNT(*)::int as c FROM candidate_profiles WHERE updated_at < $1`, [cutoff]);
					deletedCount = r.rows[0].c;
				}
				break;
			}
			case 'ai_decision_explanations': {
				if (!dryRun) {
					const r = await pool.query(`DELETE FROM ai_decision_explanations WHERE generated_at < $1`, [cutoff]);
					deletedCount = r.rowCount;
				} else {
					const r = await pool.query(`SELECT COUNT(*)::int as c FROM ai_decision_explanations WHERE generated_at < $1`, [cutoff]);
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
				dry_run: dryRun,
			});
		}

		return summary;
	}

	// ── Consent Management ───────────────────────────────────────────────

	static async recordConsent({ userId, consentType, consented, ipAddress, userAgent, metadata, recordedBy }) {
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
				[consented, consented ? new Date() : null, ipAddress, JSON.stringify(metadata || {}), prev.id],
			);
			consentRecord = result.rows[0];

			// Log history
			await pool.query(
				`INSERT INTO consent_history (consent_record_id, user_id, consent_type, previous_value, new_value, changed_at, changed_by, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)`,
				[prev.id, userId, consentType, prev.consented, consented, recordedBy || null, ipAddress, userAgent],
			);
		} else {
			const result = await pool.query(
				`INSERT INTO consent_records (user_id, consent_type, consented, consented_at, ip_address, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING *`,
				[userId, consentType, consented, consented ? new Date() : null, ipAddress, JSON.stringify(metadata || {})],
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
			[consentId, prev.user_id, prev.consent_type, prev.consented, false, revokedBy, ipAddress, userAgent],
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

	static async generateTransparencyReport({ companyId, periodStart, periodEnd, reportType = 'regulator', generatedBy, format = 'json' }) {
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
		const countResult = await pool.query(`SELECT COUNT(*)::int as total FROM transparency_reports ${where}`, params);
		const result = await pool.query(
			`SELECT * FROM transparency_reports ${where} ORDER BY generated_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
			[...params, limit, offset],
		);
		return { rows: result.rows, total: countResult.rows[0].total };
	}
}

module.exports = EuComplianceService;
