const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const { AuditLogger } = require('../services/auditLogger');
const BiasDetection = require('../services/biasDetection');

/**
 * GDPR COMPLIANCE ENDPOINTS
 */

// Export user data (Right to portability)
router.post('/gdpr/export', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Gather all user data
    const userData = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const omniscoreData = await pool.query('SELECT * FROM omniscore_results WHERE user_id = $1', [userId]);
    const interviewData = await pool.query('SELECT * FROM interviews WHERE user_id = $1', [userId]);
    const assessmentData = await pool.query('SELECT * FROM assessment_results WHERE user_id = $1', [userId]);
    const profileData = await pool.query('SELECT * FROM candidate_profiles WHERE user_id = $1', [userId]);
    const consentData = await pool.query('SELECT * FROM consent_records WHERE user_id = $1', [userId]);
    const auditData = await pool.query('SELECT * FROM audit_logs WHERE user_id = $1', [userId]);

    const exportData = {
      user: userData.rows[0],
      omniscore: omniscoreData.rows,
      interviews: interviewData.rows,
      assessments: assessmentData.rows,
      profile: profileData.rows[0],
      consents: consentData.rows,
      audit_trail: auditData.rows,
      exported_at: new Date().toISOString()
    };

    // Log the data export request
    await AuditLogger.log({
      actionType: 'gdpr_data_export',
      userId,
      targetType: 'user',
      targetId: userId,
      metadata: { export_size: JSON.stringify(exportData).length },
      req
    });

    // Create data request record
    await pool.query(
      `INSERT INTO data_requests (user_id, request_type, status, processed_at)
       VALUES ($1, 'export', 'completed', NOW())`,
      [userId]
    );

    res.json({
      success: true,
      data: exportData
    });
  } catch (error) {
    console.error('Data export failed:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Right to be forgotten
router.post('/gdpr/delete', async (req, res) => {
  try {
    const { userId, confirmEmail } = req.body;

    if (!userId || !confirmEmail) {
      return res.status(400).json({ error: 'User ID and email confirmation required' });
    }

    // Verify email matches
    const userCheck = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0 || userCheck.rows[0].email !== confirmEmail) {
      return res.status(403).json({ error: 'Email confirmation failed' });
    }

    // Create deletion request (manual review required for compliance)
    const result = await pool.query(
      `INSERT INTO data_requests (user_id, request_type, status, notes)
       VALUES ($1, 'deletion', 'pending', 'Awaiting compliance review')
       RETURNING id`,
      [userId]
    );

    await AuditLogger.log({
      actionType: 'gdpr_deletion_requested',
      userId,
      targetType: 'user',
      targetId: userId,
      metadata: { request_id: result.rows[0].id },
      req
    });

    res.json({
      success: true,
      message: 'Deletion request submitted for review',
      requestId: result.rows[0].id,
      note: 'Data will be anonymized within 30 days after compliance review'
    });
  } catch (error) {
    console.error('Deletion request failed:', error);
    res.status(500).json({ error: 'Request failed' });
  }
});

// Record consent
router.post('/gdpr/consent', async (req, res) => {
  try {
    const { userId, consentType, consented } = req.body;

    if (!userId || !consentType || consented === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO consent_records (user_id, consent_type, consented, consented_at, ip_address)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        userId,
        consentType,
        consented,
        consented ? new Date() : null,
        req.ip
      ]
    );

    await AuditLogger.log({
      actionType: 'consent_recorded',
      userId,
      targetType: 'consent',
      targetId: result.rows[0].id,
      metadata: { consent_type: consentType, consented },
      req
    });

    res.json({ success: true, consentId: result.rows[0].id });
  } catch (error) {
    console.error('Consent recording failed:', error);
    res.status(500).json({ error: 'Failed to record consent' });
  }
});

// Get user consents
router.get('/gdpr/consents/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `SELECT * FROM consent_records WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
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
router.post('/bias/analyze', async (req, res) => {
  try {
    const report = await BiasDetection.generateReport();

    await AuditLogger.log({
      actionType: 'bias_analysis_generated',
      userId: req.session?.userId,
      targetType: 'bias_report',
      targetId: report.reportId,
      metadata: {
        flagged_patterns: report.demographicAnalysis.flaggedPatterns.length,
        anomalies: report.distributionAnalysis.anomalies.length
      },
      req
    });

    res.json({
      success: true,
      report
    });
  } catch (error) {
    console.error('Bias analysis failed:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// Get bias reports
router.get('/bias/reports', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;

    const reports = await BiasDetection.getReports({ limit, offset });

    res.json({
      success: true,
      reports
    });
  } catch (error) {
    console.error('Failed to fetch bias reports:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Create fairness audit
router.post('/fairness/audit', async (req, res) => {
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
    const avgScores = demographics.rows.map(r => parseFloat(r.avg_score));
    const fairnessScore = avgScores.length > 0
      ? 100 - (Math.max(...avgScores) - Math.min(...avgScores))
      : 100;

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
        0
      ]
    );

    res.json({
      success: true,
      auditId: result.rows[0].id,
      fairnessScore,
      summary: {
        score_distribution: scoreDistribution.rows,
        demographics: demographics.rows,
        appeals: appeals.rows
      }
    });
  } catch (error) {
    console.error('Fairness audit failed:', error);
    res.status(500).json({ error: 'Audit failed' });
  }
});

// Get fairness audits
router.get('/fairness/audits', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `SELECT * FROM fairness_audits
       ORDER BY audit_date DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      success: true,
      audits: result.rows
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
router.post('/appeal', async (req, res) => {
  try {
    const { userId, scoreType, originalScore, appealReason } = req.body;

    if (!userId || !scoreType || !appealReason) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO score_appeals (user_id, score_type, original_score, appeal_reason)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, scoreType, originalScore, appealReason]
    );

    await AuditLogger.log({
      actionType: 'score_appeal_submitted',
      userId,
      targetType: 'appeal',
      targetId: result.rows[0].id,
      metadata: { score_type: scoreType, original_score: originalScore },
      req
    });

    res.json({
      success: true,
      appealId: result.rows[0].id,
      message: 'Appeal submitted successfully'
    });
  } catch (error) {
    console.error('Appeal submission failed:', error);
    res.status(500).json({ error: 'Failed to submit appeal' });
  }
});

// Get user appeals
router.get('/appeal/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `SELECT * FROM score_appeals WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      appeals: result.rows
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
router.get('/audit/logs', async (req, res) => {
  try {
    const { userId, actionType, startDate, endDate, limit, offset } = req.query;

    const logs = await AuditLogger.query({
      userId: userId ? parseInt(userId) : undefined,
      actionType,
      startDate,
      endDate,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0
    });

    res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Failed to query audit logs:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

// Export audit logs
router.post('/audit/export', async (req, res) => {
  try {
    const { startDate, endDate, format } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start and end dates required' });
    }

    const logs = await AuditLogger.exportLogs({
      startDate,
      endDate,
      format: format || 'json'
    });

    await AuditLogger.log({
      actionType: 'audit_logs_exported',
      userId: req.session?.userId,
      targetType: 'audit_export',
      metadata: {
        start_date: startDate,
        end_date: endDate,
        format
      },
      req
    });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=audit-logs-${startDate}-to-${endDate}.csv`);
      res.send(logs);
    } else {
      res.json({
        success: true,
        logs
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
router.get('/retention/policies', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM data_retention_policies ORDER BY data_type');

    res.json({
      success: true,
      policies: result.rows
    });
  } catch (error) {
    console.error('Failed to fetch retention policies:', error);
    res.status(500).json({ error: 'Failed to fetch policies' });
  }
});

// Update retention policy (admin only)
router.put('/retention/policies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { retention_days, auto_delete } = req.body;

    await pool.query(
      `UPDATE data_retention_policies
       SET retention_days = $1, auto_delete = $2, updated_at = NOW()
       WHERE id = $3`,
      [retention_days, auto_delete, id]
    );

    await AuditLogger.log({
      actionType: 'retention_policy_updated',
      userId: req.session?.userId,
      targetType: 'retention_policy',
      targetId: parseInt(id),
      metadata: { retention_days, auto_delete },
      req
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update policy:', error);
    res.status(500).json({ error: 'Update failed' });
  }
});

module.exports = router;
