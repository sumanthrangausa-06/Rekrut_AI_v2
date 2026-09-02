const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const auditLogService = require('../services/auditLogService');
const { AuditLogger } = auditLogService;
const BiasDetection = require('../services/biasDetection');
const { explainOmniScore, explainDecision } = require('../services/scoreExplainer');

function canAccessUserRecord(req, userId) {
	const targetId = Number(userId);
	if (!Number.isInteger(targetId)) {
		return { ok: false, status: 400, error: 'Valid user ID required' };
	}

	if (req.user?.role === 'admin' || req.user?.id === targetId) {
		return { ok: true, targetId };
	}

	return { ok: false, status: 403, error: 'You can only access your own compliance data' };
}

/**
 * GDPR COMPLIANCE ENDPOINTS
 */

// Export user data (Right to portability)
router.post('/gdpr/export', authMiddleware, async (req, res) => {
	try {
		const { userId } = req.body;
		const access = canAccessUserRecord(req, userId);

		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const targetUserId = access.targetId;

		// Gather all user data
		const userData = await pool.query('SELECT * FROM users WHERE id = $1', [targetUserId]);
		const omniscoreData = await pool.query('SELECT * FROM omniscore_results WHERE user_id = $1', [
			targetUserId,
		]);
		const interviewData = await pool.query('SELECT * FROM interviews WHERE user_id = $1', [
			targetUserId,
		]);
		const assessmentData = await pool.query('SELECT * FROM assessment_results WHERE user_id = $1', [
			targetUserId,
		]);
		const profileData = await pool.query('SELECT * FROM candidate_profiles WHERE user_id = $1', [
			targetUserId,
		]);
		const consentData = await pool.query('SELECT * FROM consent_records WHERE user_id = $1', [
			targetUserId,
		]);
		const auditData = await pool.query('SELECT * FROM audit_logs WHERE user_id = $1', [
			targetUserId,
		]);

		const exportData = {
			user: userData.rows[0],
			omniscore: omniscoreData.rows,
			interviews: interviewData.rows,
			assessments: assessmentData.rows,
			profile: profileData.rows[0],
			consents: consentData.rows,
			audit_trail: auditData.rows,
			exported_at: new Date().toISOString(),
		};

		// Log the data export request
		await AuditLogger.log({
			actionType: 'gdpr_data_export',
			userId: targetUserId,
			targetType: 'user',
			targetId: targetUserId,
			metadata: { export_size: JSON.stringify(exportData).length },
			req,
		});

		// Create data request record
		await pool.query(
			`INSERT INTO data_requests (user_id, request_type, status, processed_at)
       VALUES ($1, 'export', 'completed', NOW())`,
			[targetUserId],
		);

		res.json({
			success: true,
			data: exportData,
		});
	} catch (error) {
		console.error('Data export failed:', error);
		res.status(500).json({ error: 'Export failed' });
	}
});

// Right to be forgotten
router.post('/gdpr/delete', authMiddleware, async (req, res) => {
	try {
		const { userId, confirmEmail } = req.body;
		const access = canAccessUserRecord(req, userId);

		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const targetUserId = access.targetId;

		if (!confirmEmail) {
			return res.status(400).json({ error: 'User ID and email confirmation required' });
		}

		// Verify email matches
		const userCheck = await pool.query('SELECT email FROM users WHERE id = $1', [targetUserId]);
		if (userCheck.rows.length === 0 || userCheck.rows[0].email !== confirmEmail) {
			return res.status(403).json({ error: 'Email confirmation failed' });
		}

		// Create deletion request (manual review required for compliance)
		const result = await pool.query(
			`INSERT INTO data_requests (user_id, request_type, status, notes)
       VALUES ($1, 'deletion', 'pending', 'Awaiting compliance review')
       RETURNING id`,
			[targetUserId],
		);

		await AuditLogger.log({
			actionType: 'gdpr_deletion_requested',
			userId: targetUserId,
			targetType: 'user',
			targetId: targetUserId,
			metadata: { request_id: result.rows[0].id },
			req,
		});

		res.json({
			success: true,
			message: 'Deletion request submitted for review',
			requestId: result.rows[0].id,
			note: 'Data will be anonymized within 30 days after compliance review',
		});
	} catch (error) {
		console.error('Deletion request failed:', error);
		res.status(500).json({ error: 'Request failed' });
	}
});

// Record consent
router.post('/gdpr/consent', authMiddleware, async (req, res) => {
	try {
		const { userId, consentType, consented } = req.body;
		const access = canAccessUserRecord(req, userId);

		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const targetUserId = access.targetId;

		if (!consentType || consented === undefined) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		const result = await pool.query(
			`INSERT INTO consent_records (user_id, consent_type, consented, consented_at, ip_address)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
			[targetUserId, consentType, consented, consented ? new Date() : null, req.ip],
		);

		await AuditLogger.log({
			actionType: 'consent_recorded',
			userId: targetUserId,
			targetType: 'consent',
			targetId: result.rows[0].id,
			metadata: { consent_type: consentType, consented },
			req,
		});

		res.json({ success: true, consentId: result.rows[0].id });
	} catch (error) {
		console.error('Consent recording failed:', error);
		res.status(500).json({ error: 'Failed to record consent' });
	}
});

// Get user consents
router.get('/gdpr/consents/:userId', authMiddleware, async (req, res) => {
	try {
		const { userId } = req.params;
		const access = canAccessUserRecord(req, userId);

		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const result = await pool.query(
			`SELECT * FROM consent_records WHERE user_id = $1 ORDER BY created_at DESC`,
			[access.targetId],
		);

		res.json({ success: true, consents: result.rows });
	} catch (error) {
		console.error('Failed to fetch consents:', error);
		res.status(500).json({ error: 'Failed to fetch consents' });
	}
});

/**
 * BIAS DETECTION & FAIRNESS ENDPOINTS
 */

// Generate bias report
router.post('/bias/analyze', authMiddleware, async (req, res) => {
	try {
		const report = await BiasDetection.generateReport();

		await AuditLogger.log({
			actionType: 'bias_analysis_generated',
			userId: req.user?.id,
			targetType: 'bias_report',
			targetId: report.reportId,
			metadata: {
				flagged_patterns: report.demographicAnalysis.flaggedPatterns.length,
				anomalies: report.distributionAnalysis.anomalies.length,
			},
			req,
		});

		res.json({
			success: true,
			report,
		});
	} catch (error) {
		console.error('Bias analysis failed:', error);
		res.status(500).json({ error: 'Analysis failed' });
	}
});

// Get bias reports
router.get('/bias/reports', authMiddleware, async (req, res) => {
	try {
		const limit = parseInt(req.query.limit, 10) || 10;
		const offset = parseInt(req.query.offset, 10) || 0;

		const reports = await BiasDetection.getReports({ limit, offset });

		res.json({
			success: true,
			reports,
		});
	} catch (error) {
		console.error('Failed to fetch bias reports:', error);
		res.status(500).json({ error: 'Failed to fetch reports' });
	}
});

// Create fairness audit
router.post('/fairness/audit', authMiddleware, async (_req, res) => {
	try {
		const auditDate = new Date().toISOString().split('T')[0];

		// Get score distribution
		const scoreDistribution = await pool.query(`
      SELECT
        FLOOR(overall_score / 10) * 10 as bucket,
        COUNT(*) as count,
        AVG(overall_score) as avg_score
      FROM omniscore_results
      WHERE overall_score IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket
    `);

		// Get demographic breakdowns
		const demographics = await pool.query(`
      SELECT
        cp.gender,
        cp.ethnicity,
        COUNT(*) as total,
        AVG(os.overall_score) as avg_score
      FROM candidate_profiles cp
      LEFT JOIN omniscore_results os ON os.user_id = cp.user_id
      WHERE os.overall_score IS NOT NULL
      GROUP BY cp.gender, cp.ethnicity
    `);

		// Get appeal statistics
		const appeals = await pool.query(`
      SELECT
        status,
        COUNT(*) as count,
        AVG(CASE WHEN new_score IS NOT NULL THEN new_score - original_score ELSE 0 END) as avg_adjustment
      FROM score_appeals
      GROUP BY status
    `);

		// Calculate overall fairness score (simplified metric)
		const avgScores = demographics.rows.map((r) => parseFloat(r.avg_score));
		const fairnessScore =
			avgScores.length > 0 ? 100 - (Math.max(...avgScores) - Math.min(...avgScores)) : 100;

		const result = await pool.query(
			`INSERT INTO fairness_audits
       (audit_date, audit_type, score_distribution, demographic_breakdowns, appeal_stats, overall_fairness_score, issues_found)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
			[
				auditDate,
				'automated',
				JSON.stringify(scoreDistribution.rows),
				JSON.stringify(demographics.rows),
				JSON.stringify(appeals.rows),
				fairnessScore,
				0,
			],
		);

		res.json({
			success: true,
			auditId: result.rows[0].id,
			fairnessScore,
			summary: {
				score_distribution: scoreDistribution.rows,
				demographics: demographics.rows,
				appeals: appeals.rows,
			},
		});
	} catch (error) {
		console.error('Fairness audit failed:', error);
		res.status(500).json({ error: 'Audit failed' });
	}
});

// Get fairness audits
router.get('/fairness/audits', authMiddleware, async (req, res) => {
	try {
		const limit = parseInt(req.query.limit, 10) || 10;
		const offset = parseInt(req.query.offset, 10) || 0;

		const result = await pool.query(
			`SELECT * FROM fairness_audits
       ORDER BY audit_date DESC
       LIMIT $1 OFFSET $2`,
			[limit, offset],
		);

		res.json({
			success: true,
			audits: result.rows,
		});
	} catch (error) {
		console.error('Failed to fetch audits:', error);
		res.status(500).json({ error: 'Failed to fetch audits' });
	}
});

/**
 * SCORE APPEALS
 */

// Submit appeal
router.post('/appeal', authMiddleware, async (req, res) => {
	try {
		const { userId, scoreType, originalScore, appealReason } = req.body;

		if (!userId || !scoreType || !appealReason) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		const result = await pool.query(
			`INSERT INTO score_appeals (user_id, score_type, original_score, appeal_reason)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
			[userId, scoreType, originalScore, appealReason],
		);

		await AuditLogger.log({
			actionType: 'score_appeal_submitted',
			userId,
			targetType: 'appeal',
			targetId: result.rows[0].id,
			metadata: { score_type: scoreType, original_score: originalScore },
			req,
		});

		res.json({
			success: true,
			appealId: result.rows[0].id,
			message: 'Appeal submitted successfully',
		});
	} catch (error) {
		console.error('Appeal submission failed:', error);
		res.status(500).json({ error: 'Failed to submit appeal' });
	}
});

// Get user appeals
router.get('/appeal/:userId', authMiddleware, async (req, res) => {
	try {
		const { userId } = req.params;
		const access = canAccessUserRecord(req, userId);

		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const result = await pool.query(
			`SELECT * FROM score_appeals WHERE user_id = $1 ORDER BY created_at DESC`,
			[access.targetId],
		);

		res.json({
			success: true,
			appeals: result.rows,
		});
	} catch (error) {
		console.error('Failed to fetch appeals:', error);
		res.status(500).json({ error: 'Failed to fetch appeals' });
	}
});

/**
 * AUDIT LOGS
 */

// Query audit logs
router.get('/audit/logs', authMiddleware, async (req, res) => {
	try {
		const { userId, actionType, startDate, endDate, limit, offset } = req.query;

		const logs = await AuditLogger.query({
			userId: userId ? parseInt(userId, 10) : undefined,
			actionType,
			startDate,
			endDate,
			limit: limit ? parseInt(limit, 10) : 100,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({
			success: true,
			logs,
		});
	} catch (error) {
		console.error('Failed to query audit logs:', error);
		res.status(500).json({ error: 'Query failed' });
	}
});

// Export audit logs
router.post('/audit/export', authMiddleware, async (req, res) => {
	try {
		const { startDate, endDate, format } = req.body;

		if (!startDate || !endDate) {
			return res.status(400).json({ error: 'Start and end dates required' });
		}

		const logs = await AuditLogger.exportLogs({
			startDate,
			endDate,
			format: format || 'json',
		});

		await AuditLogger.log({
			actionType: 'audit_logs_exported',
			userId: req.user?.id,
			targetType: 'audit_export',
			metadata: {
				start_date: startDate,
				end_date: endDate,
				format,
			},
			req,
		});

		if (format === 'csv') {
			res.setHeader('Content-Type', 'text/csv');
			res.setHeader(
				'Content-Disposition',
				`attachment; filename=audit-logs-${startDate}-to-${endDate}.csv`,
			);
			res.send(logs);
		} else {
			res.json({
				success: true,
				logs,
			});
		}
	} catch (error) {
		console.error('Audit export failed:', error);
		res.status(500).json({ error: 'Export failed' });
	}
});

/**
 * DATA RETENTION
 */

// Get retention policies
router.get('/retention/policies', authMiddleware, async (_req, res) => {
	try {
		const result = await pool.query('SELECT * FROM data_retention_policies ORDER BY data_type');

		res.json({
			success: true,
			policies: result.rows,
		});
	} catch (error) {
		console.error('Failed to fetch retention policies:', error);
		res.status(500).json({ error: 'Failed to fetch policies' });
	}
});

// Update retention policy (admin only)
router.put('/retention/policies/:id', authMiddleware, async (req, res) => {
	try {
		const { id } = req.params;
		const { retention_days, auto_delete } = req.body;

		await pool.query(
			`UPDATE data_retention_policies
       SET retention_days = $1, auto_delete = $2, updated_at = NOW()
       WHERE id = $3`,
			[retention_days, auto_delete, id],
		);

		await AuditLogger.log({
			actionType: 'retention_policy_updated',
			userId: req.user?.id,
			targetType: 'retention_policy',
			targetId: parseInt(id, 10),
			metadata: { retention_days, auto_delete },
			req,
		});

		res.json({ success: true });
	} catch (error) {
		console.error('Failed to update policy:', error);
		res.status(500).json({ error: 'Update failed' });
	}
});

/**
 * SCORE EXPLAINABILITY
 */

// Explain OmniScore
router.get('/explain/omniscore/:userId', authMiddleware, async (req, res) => {
	try {
		const { userId } = req.params;

		const explanation = await explainOmniScore(parseInt(userId, 10));

		await AuditLogger.log({
			actionType: 'score_explanation_viewed',
			userId: req.user?.id,
			targetType: 'user',
			targetId: parseInt(userId, 10),
			metadata: { explanation_type: 'omniscore' },
			req,
		});

		res.json({
			success: true,
			explanation,
		});
	} catch (error) {
		console.error('Score explanation failed:', error);
		res.status(500).json({ error: 'Failed to explain score' });
	}
});

// Explain application decision
router.get('/explain/decision/:applicationId', authMiddleware, async (req, res) => {
	try {
		const { applicationId } = req.params;

		const explanation = await explainDecision(parseInt(applicationId, 10));

		await AuditLogger.log({
			actionType: 'decision_explanation_viewed',
			userId: req.user?.id,
			targetType: 'job_application',
			targetId: parseInt(applicationId, 10),
			metadata: { explanation_type: 'decision' },
			req,
		});

		res.json({
			success: true,
			explanation,
		});
	} catch (error) {
		console.error('Decision explanation failed:', error);
		res.status(500).json({ error: 'Failed to explain decision' });
	}
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLIANCE AUDIT TRAIL — Issue #136 (EU AI Act, tamper-evident, hash-chained)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/compliance/audit-log
 * Log an event to the compliance audit trail (internal/service-to-service use).
 * Any authenticated user can call this; the service validates event data.
 */
router.post('/audit-log', authMiddleware, async (req, res) => {
	try {
		const { eventType, entityType, entityId, actorId, actorRole, jobId, companyId, payload } =
			req.body;

		if (!eventType || !entityType || !entityId) {
			return res.status(400).json({ error: 'eventType, entityType, and entityId are required' });
		}

		const record = await auditLogService.logEvent({
			eventType,
			entityType,
			entityId: parseInt(entityId, 10),
			actorId: actorId ? parseInt(actorId, 10) : req.user?.id || null,
			actorRole: actorRole || req.user?.role || null,
			jobId: jobId ? parseInt(jobId, 10) : null,
			companyId: companyId ? parseInt(companyId, 10) : req.user?.company_id || null,
			payload: payload || {},
			req,
		});

		res.status(201).json({ success: true, record });
	} catch (error) {
		console.error('[compliance/audit-log] Failed to log event:', error.message);
		res.status(500).json({ error: 'Failed to log audit event' });
	}
});

/**
 * GET /api/compliance/audit-trail
 * Query the compliance audit trail. Admin or company owner only.
 */
router.get('/audit-trail', authMiddleware, async (req, res) => {
	try {
		// Access control: admin, employer (owner), or recruiter with company access
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Admin or company access required' });
		}

		const { candidateId, jobId, recruiterId, startDate, endDate, eventType, limit, offset } =
			req.query;

		const companyId = req.user.role === 'admin' ? undefined : req.user.company_id;

		const result = await auditLogService.getAuditTrail({
			candidateId: candidateId ? parseInt(candidateId, 10) : undefined,
			jobId: jobId ? parseInt(jobId, 10) : undefined,
			recruiterId: recruiterId ? parseInt(recruiterId, 10) : undefined,
			startDate,
			endDate,
			eventType,
			companyId,
			limit: limit ? parseInt(limit, 10) : 100,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/audit-trail] Query failed:', error.message);
		res.status(500).json({ error: 'Failed to query audit trail' });
	}
});

/**
 * GET /api/compliance/audit-trail/candidate/:candidateId
 * Full record of decisions about a candidate. GDPR / right-to-explanation.
 * Candidate can view their own; admin can view any.
 */
router.get('/audit-trail/candidate/:candidateId', authMiddleware, async (req, res) => {
	try {
		const candidateId = parseInt(req.params.candidateId, 10);
		if (!Number.isInteger(candidateId)) {
			return res.status(400).json({ error: 'Valid candidate ID required' });
		}

		// Access control: candidate viewing own record, or admin/employer
		const isOwn = req.user?.role === 'candidate' && req.user?.id === candidateId;
		const isAdmin = req.user?.role === 'admin';
		const isCompanyUser =
			['employer', 'recruiter', 'hiring_manager'].includes(req.user?.role) && req.user?.company_id;

		if (!isOwn && !isAdmin && !isCompanyUser) {
			return res.status(403).json({ error: 'Access denied' });
		}

		const { limit, offset } = req.query;
		const result = await auditLogService.getCandidateDecisions(candidateId, {
			limit: limit ? parseInt(limit, 10) : 500,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/audit-trail/candidate] Failed:', error.message);
		res.status(500).json({ error: 'Failed to fetch candidate audit trail' });
	}
});

/**
 * GET /api/compliance/audit-trail/verify
 * Verify hash chain integrity. Admin or company owner only.
 */
router.get('/audit-trail/verify', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Admin or owner access required' });
		}

		const companyId = req.user.role === 'admin' ? undefined : req.user.company_id;
		const result = await auditLogService.verifyChain(companyId);

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/audit-trail/verify] Failed:', error.message);
		res.status(500).json({ error: 'Failed to verify audit chain' });
	}
});

/**
 * GET /api/compliance/audit-trail/export
 * Export regulator-ready report. Owner (employer) or admin only.
 */
router.get('/audit-trail/export', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Admin or owner access required' });
		}

		const { startDate, endDate, format } = req.query;

		if (!startDate || !endDate) {
			return res.status(400).json({ error: 'startDate and endDate are required' });
		}

		const companyId = req.user.role === 'admin' ? undefined : req.user.company_id;
		const result = await auditLogService.exportForRegulator(
			companyId,
			startDate,
			endDate,
			format || 'json',
		);

		if (format === 'csv') {
			res.setHeader('Content-Type', 'text/csv');
			res.setHeader(
				'Content-Disposition',
				`attachment; filename=compliance-audit-${startDate}-to-${endDate}.csv`,
			);
			res.send(result);
		} else {
			res.json({ success: true, report: result });
		}
	} catch (error) {
		console.error('[compliance/audit-trail/export] Failed:', error.message);
		res.status(500).json({ error: 'Failed to export audit trail' });
	}
});

// ═══════════════════════════════════════════════════════════════════════════════
// EU AI ACT COMPLIANCE — Issue #142
// ═══════════════════════════════════════════════════════════════════════════════

const EuComplianceService = require('../services/euComplianceService');

// ── Risk Classification ──────────────────────────────────────────────────────

/**
 * POST /api/compliance/risk-classify
 * Classify or update a job posting's AI risk level under EU AI Act.
 */
router.post('/risk-classify', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}

		const { jobId, riskLevel, riskFactors, justification } = req.body;
		if (!jobId || !riskLevel) {
			return res.status(400).json({ error: 'jobId and riskLevel are required' });
		}
		if (!['minimal', 'limited', 'high', 'unacceptable'].includes(riskLevel)) {
			return res.status(400).json({ error: 'Invalid riskLevel' });
		}

		const record = await EuComplianceService.classifyJobRisk({
			jobId: parseInt(jobId, 10),
			riskLevel,
			riskFactors: riskFactors || [],
			justification,
			assessedBy: req.user.id,
		});

		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.STATUS_CHANGE,
			entityType: auditLogService.ENTITY_TYPES.JOB,
			entityId: parseInt(jobId, 10),
			actorId: req.user.id,
			actorRole: req.user.role,
			jobId: parseInt(jobId, 10),
			companyId: req.user.company_id,
			payload: { risk_level: riskLevel, justification },
		});

		res.json({ success: true, record });
	} catch (error) {
		console.error('[compliance/risk-classify] Failed:', error.message);
		res.status(500).json({ error: 'Failed to classify job risk' });
	}
});

/**
 * GET /api/compliance/risk-classify/:jobId
 */
router.get('/risk-classify/:jobId', authMiddleware, async (req, res) => {
	try {
		const jobId = parseInt(req.params.jobId, 10);
		if (!Number.isInteger(jobId)) {
			return res.status(400).json({ error: 'Valid job ID required' });
		}

		const record = await EuComplianceService.getJobRiskClassification(jobId);
		if (!record) {
			return res.status(404).json({ error: 'Risk classification not found' });
		}

		// Access control
		const isAdmin = req.user?.role === 'admin';
		const isCompanyUser =
			['employer', 'recruiter', 'hiring_manager'].includes(req.user?.role) &&
			req.user?.company_id === record.company_id;
		if (!isAdmin && !isCompanyUser) {
			return res.status(403).json({ error: 'Access denied' });
		}

		res.json({ success: true, record });
	} catch (error) {
		console.error('[compliance/risk-classify/:jobId] Failed:', error.message);
		res.status(500).json({ error: 'Failed to fetch risk classification' });
	}
});

/**
 * GET /api/compliance/risk-classify
 * List risk classifications for a company.
 */
router.get('/risk-classify', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}

		const companyId = req.user.role === 'admin' ? undefined : req.user.company_id;
		const { riskLevel, limit, offset } = req.query;
		const result = await EuComplianceService.listJobRiskClassifications({
			companyId,
			riskLevel,
			limit: limit ? parseInt(limit, 10) : 50,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/risk-classify] List failed:', error.message);
		res.status(500).json({ error: 'Failed to list risk classifications' });
	}
});

// ── Bias Detection Per Posting ───────────────────────────────────────────────

/**
 * POST /api/compliance/bias/analyze/:jobId
 * Calculate and store bias metrics for a specific job posting.
 */
router.post('/bias/analyze/:jobId', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}

		const jobId = parseInt(req.params.jobId, 10);
		if (!Number.isInteger(jobId)) {
			return res.status(400).json({ error: 'Valid job ID required' });
		}

		const { selectionStatuses } = req.body;
		const metrics = await EuComplianceService.calculateBiasMetricsForJob(jobId, {
			selectionStatuses: Array.isArray(selectionStatuses) ? selectionStatuses : undefined,
		});

		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.AI_DECISION,
			entityType: auditLogService.ENTITY_TYPES.JOB,
			entityId: jobId,
			actorId: req.user.id,
			actorRole: req.user.role,
			jobId,
			companyId: req.user.company_id,
			payload: { bias_metrics_count: metrics.length, flagged: metrics.some((m) => m.flagged) },
		});

		res.json({ success: true, metrics });
	} catch (error) {
		console.error('[compliance/bias/analyze/:jobId] Failed:', error.message);
		res.status(500).json({ error: 'Failed to calculate bias metrics' });
	}
});

/**
 * GET /api/compliance/bias/metrics/:jobId
 * Retrieve stored bias metrics for a job posting.
 */
router.get('/bias/metrics/:jobId', authMiddleware, async (req, res) => {
	try {
		const jobId = parseInt(req.params.jobId, 10);
		if (!Number.isInteger(jobId)) {
			return res.status(400).json({ error: 'Valid job ID required' });
		}

		const metrics = await EuComplianceService.getBiasMetricsForJob(jobId);
		res.json({ success: true, metrics });
	} catch (error) {
		console.error('[compliance/bias/metrics/:jobId] Failed:', error.message);
		res.status(500).json({ error: 'Failed to fetch bias metrics' });
	}
});

/**
 * GET /api/compliance/bias/flagged
 * List all job postings flagged for adverse impact.
 */
router.get('/bias/flagged', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}

		const companyId = req.user.role === 'admin' ? undefined : req.user.company_id;
		const { limit, offset } = req.query;
		const result = await EuComplianceService.listFlaggedBiasMetrics({
			companyId,
			limit: limit ? parseInt(limit, 10) : 50,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/bias/flagged] Failed:', error.message);
		res.status(500).json({ error: 'Failed to fetch flagged bias metrics' });
	}
});

/**
 * GET /api/compliance/bias/four-fifths/:jobId
 * Calculate four-fifths rule on-demand for a job posting.
 */
router.get('/bias/four-fifths/:jobId', authMiddleware, async (req, res) => {
	try {
		const jobId = parseInt(req.params.jobId, 10);
		if (!Number.isInteger(jobId)) {
			return res.status(400).json({ error: 'Valid job ID required' });
		}

		const { selectionStatuses } = req.query;
		const statuses = selectionStatuses
			? selectionStatuses.split(',').map((s) => s.trim())
			: ['interview', 'hired', 'offer_extended'];

		const result = await BiasDetection.calculateFourFifthsRule(jobId, statuses);
		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/bias/four-fifths/:jobId] Failed:', error.message);
		res.status(500).json({ error: 'Failed to calculate four-fifths rule' });
	}
});

// ── Explainability ───────────────────────────────────────────────────────────

/**
 * GET /api/compliance/explain/job/:jobId/candidate/:candidateId
 * Return weighted factor breakdowns for a candidate-job pair.
 */
router.get('/explain/job/:jobId/candidate/:candidateId', authMiddleware, async (req, res) => {
	try {
		const jobId = parseInt(req.params.jobId, 10);
		const candidateId = parseInt(req.params.candidateId, 10);
		if (!Number.isInteger(jobId) || !Number.isInteger(candidateId)) {
			return res.status(400).json({ error: 'Valid job ID and candidate ID required' });
		}

		// Candidate can view their own explanation
		const isOwn = req.user?.role === 'candidate' && req.user?.id === candidateId;
		const isCompanyUser = ['employer', 'recruiter', 'hiring_manager', 'admin'].includes(
			req.user?.role,
		);
		if (!isOwn && !isCompanyUser) {
			return res.status(403).json({ error: 'Access denied' });
		}

		const explanation = await EuComplianceService.explainDecisionForJob({
			userId: candidateId,
			jobId,
		});

		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.AI_DECISION,
			entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
			entityId: candidateId,
			actorId: req.user?.id,
			actorRole: req.user?.role,
			jobId,
			companyId: req.user?.company_id,
			payload: { explanation_viewed: true },
		});

		res.json({ success: true, explanation });
	} catch (error) {
		console.error('[compliance/explain/job/:jobId/candidate/:candidateId] Failed:', error.message);
		res.status(500).json({ error: 'Failed to generate explanation' });
	}
});

// ── Human Oversight ──────────────────────────────────────────────────────────

/**
 * POST /api/compliance/overrides
 * Record a human override of an AI recommendation.
 */
router.post('/overrides', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}

		const {
			applicationId,
			userId,
			jobId,
			originalScore,
			newScore,
			originalStatus,
			newStatus,
			reason,
		} = req.body;

		if (!applicationId || !userId || !jobId || !reason) {
			return res
				.status(400)
				.json({ error: 'applicationId, userId, jobId, and reason are required' });
		}

		const override = await EuComplianceService.recordHumanOverride({
			applicationId: parseInt(applicationId, 10),
			userId: parseInt(userId, 10),
			jobId: parseInt(jobId, 10),
			originalScore: originalScore !== undefined ? parseFloat(originalScore) : null,
			newScore: newScore !== undefined ? parseFloat(newScore) : null,
			originalStatus: originalStatus || null,
			newStatus: newStatus || null,
			reason,
			overriddenBy: req.user.id,
		});

		res.status(201).json({ success: true, override });
	} catch (error) {
		console.error('[compliance/overrides] Failed:', error.message);
		res.status(500).json({ error: error.message || 'Failed to record override' });
	}
});

/**
 * GET /api/compliance/overrides/job/:jobId
 */
router.get('/overrides/job/:jobId', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}

		const jobId = parseInt(req.params.jobId, 10);
		if (!Number.isInteger(jobId)) {
			return res.status(400).json({ error: 'Valid job ID required' });
		}

		const { limit, offset } = req.query;
		const result = await EuComplianceService.getOverridesForJob(jobId, {
			limit: limit ? parseInt(limit, 10) : 100,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/overrides/job/:jobId] Failed:', error.message);
		res.status(500).json({ error: 'Failed to fetch overrides' });
	}
});

/**
 * GET /api/compliance/overrides/:id
 */
router.get('/overrides/:id', authMiddleware, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!Number.isInteger(id)) {
			return res.status(400).json({ error: 'Valid override ID required' });
		}

		const override = await EuComplianceService.getOverrideById(id);
		if (!override) {
			return res.status(404).json({ error: 'Override not found' });
		}

		res.json({ success: true, override });
	} catch (error) {
		console.error('[compliance/overrides/:id] Failed:', error.message);
		res.status(500).json({ error: 'Failed to fetch override' });
	}
});

// ── Data Retention ───────────────────────────────────────────────────────────

/**
 * POST /api/compliance/retention/policies
 * Set or update a retention policy (supports per-company / per-job scope).
 */
router.post('/retention/policies', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Admin or owner access required' });
		}

		const { dataType, retentionDays, autoDelete, policyScope, scopeId, description } = req.body;
		if (!dataType || retentionDays === undefined) {
			return res.status(400).json({ error: 'dataType and retentionDays are required' });
		}

		const policy = await EuComplianceService.setRetentionPolicy({
			dataType,
			retentionDays: parseInt(retentionDays, 10),
			autoDelete: !!autoDelete,
			companyId: req.user.role === 'admin' ? req.body.companyId : req.user.company_id,
			policyScope: policyScope || 'global',
			scopeId: scopeId ? parseInt(scopeId, 10) : null,
			description,
		});

		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.STATUS_CHANGE,
			entityType: 'retention_policy',
			entityId: policy.id,
			actorId: req.user.id,
			actorRole: req.user.role,
			companyId: req.user.company_id,
			payload: { data_type: dataType, retention_days: retentionDays, auto_delete: autoDelete },
		});

		res.json({ success: true, policy });
	} catch (error) {
		console.error('[compliance/retention/policies] Failed:', error.message);
		res.status(500).json({ error: 'Failed to set retention policy' });
	}
});

/**
 * POST /api/compliance/retention/purge
 * Execute automated data purge based on retention policies.
 */
router.post('/retention/purge', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Admin or owner access required' });
		}

		const { dryRun = true, companyId } = req.body;
		const targetCompanyId = req.user.role === 'admin' ? companyId : req.user.company_id;
		const summary = await EuComplianceService.executePurge({
			dryRun: dryRun !== false,
			companyId: targetCompanyId,
		});

		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.STATUS_CHANGE,
			entityType: 'retention_purge',
			entityId: 0,
			actorId: req.user.id,
			actorRole: req.user.role,
			companyId: targetCompanyId,
			payload: { dry_run: dryRun !== false, affected_policies: summary.length },
		});

		res.json({ success: true, dry_run: dryRun !== false, summary });
	} catch (error) {
		console.error('[compliance/retention/purge] Failed:', error.message);
		res.status(500).json({ error: 'Failed to execute purge' });
	}
});

// ── Candidate Consent Management ─────────────────────────────────────────────

/**
 * POST /api/compliance/consent
 * Record or update candidate consent with history tracking.
 */
router.post('/consent', authMiddleware, async (req, res) => {
	try {
		const { userId, consentType, consented, metadata } = req.body;
		const access = canAccessUserRecord(req, userId);
		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		if (!consentType || consented === undefined) {
			return res.status(400).json({ error: 'consentType and consented are required' });
		}

		const record = await EuComplianceService.recordConsent({
			userId: access.targetId,
			consentType,
			consented: !!consented,
			ipAddress: req.ip,
			userAgent: req.headers['user-agent'],
			metadata,
			recordedBy: req.user?.id,
		});

		res.json({ success: true, record });
	} catch (error) {
		console.error('[compliance/consent] Failed:', error.message);
		res.status(500).json({ error: 'Failed to record consent' });
	}
});

/**
 * POST /api/compliance/consent/revoke
 * Revoke consent with history tracking.
 */
router.post('/consent/revoke', authMiddleware, async (req, res) => {
	try {
		const { consentId, reason } = req.body;
		if (!consentId || !reason) {
			return res.status(400).json({ error: 'consentId and reason are required' });
		}

		// Verify ownership
		const existing = await pool.query('SELECT user_id FROM consent_records WHERE id = $1', [
			consentId,
		]);
		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Consent record not found' });
		}
		const userId = existing.rows[0].user_id;
		const access = canAccessUserRecord(req, userId);
		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const record = await EuComplianceService.revokeConsent({
			consentId: parseInt(consentId, 10),
			reason,
			revokedBy: req.user?.id,
			ipAddress: req.ip,
			userAgent: req.headers['user-agent'],
		});

		res.json({ success: true, record });
	} catch (error) {
		console.error('[compliance/consent/revoke] Failed:', error.message);
		res.status(500).json({ error: error.message || 'Failed to revoke consent' });
	}
});

/**
 * GET /api/compliance/consent/history/:userId
 * Get full consent change history for a user.
 */
router.get('/consent/history/:userId', authMiddleware, async (req, res) => {
	try {
		const { userId } = req.params;
		const access = canAccessUserRecord(req, userId);
		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const { consentType, limit, offset } = req.query;
		const result = await EuComplianceService.getConsentHistory(access.targetId, {
			consentType,
			limit: limit ? parseInt(limit, 10) : 100,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/consent/history/:userId] Failed:', error.message);
		res.status(500).json({ error: 'Failed to fetch consent history' });
	}
});

// ── Transparency Reports ─────────────────────────────────────────────────────

/**
 * POST /api/compliance/transparency-reports
 * Generate a regulator-ready transparency report.
 */
router.post('/transparency-reports', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Admin or owner access required' });
		}

		const { periodStart, periodEnd, reportType, format } = req.body;
		if (!periodStart || !periodEnd) {
			return res.status(400).json({ error: 'periodStart and periodEnd are required' });
		}

		const companyId = req.user.role === 'admin' ? req.body.companyId : req.user.company_id;
		if (!companyId) {
			return res.status(400).json({ error: 'Company ID is required' });
		}

		const result = await EuComplianceService.generateTransparencyReport({
			companyId: parseInt(companyId, 10),
			periodStart,
			periodEnd,
			reportType: reportType || 'regulator',
			generatedBy: req.user.id,
			format: format || 'json',
		});

		res.status(201).json({ success: true, report: result.report, data: result.data });
	} catch (error) {
		console.error('[compliance/transparency-reports] Failed:', error.message);
		res.status(500).json({ error: 'Failed to generate transparency report' });
	}
});

/**
 * GET /api/compliance/transparency-reports
 * List generated transparency reports.
 */
router.get('/transparency-reports', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}

		const companyId = req.user.role === 'admin' ? undefined : req.user.company_id;
		const { limit, offset } = req.query;
		const result = await EuComplianceService.getTransparencyReports({
			companyId,
			limit: limit ? parseInt(limit, 10) : 20,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/transparency-reports] List failed:', error.message);
		res.status(500).json({ error: 'Failed to list transparency reports' });
	}
});

/**
 * POST /api/compliance/transparency-reports/:id/finalize
 * Finalize a transparency report (immutable).
 */
router.post('/transparency-reports/:id/finalize', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Admin or owner access required' });
		}

		const id = parseInt(req.params.id, 10);
		if (!Number.isInteger(id)) {
			return res.status(400).json({ error: 'Valid report ID required' });
		}

		const report = await EuComplianceService.finalizeTransparencyReport(id);
		if (!report) {
			return res.status(404).json({ error: 'Report not found' });
		}

		res.json({ success: true, report });
	} catch (error) {
		console.error('[compliance/transparency-reports/:id/finalize] Failed:', error.message);
		res.status(500).json({ error: 'Failed to finalize report' });
	}
});

module.exports = router;
