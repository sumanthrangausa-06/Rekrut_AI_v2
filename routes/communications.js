// AI Communication Hub Routes — outreach, follow-ups, rejections, offer letters
const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const commGenerator = require('../services/communication-generator');

const router = express.Router();

// Middleware: require recruiter role
function requireRecruiter(req, res, next) {
  if (!req.user.company_id || !['recruiter', 'hiring_manager', 'employer', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Recruiter access required' });
  }
  next();
}

// ─── GENERATE AI COMMUNICATION ──────────────────────────────────────────
// POST /api/communications/generate
router.post('/generate', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { type, candidate_id, job_id, tone, options } = req.body;

    if (!type) return res.status(400).json({ error: 'Communication type is required' });

    // Fetch candidate data if provided
    let candidate = null;
    if (candidate_id) {
      const candResult = await pool.query(`
        SELECT u.id, u.name, u.email,
          cp.headline, cp.bio, cp.skills, cp.years_experience, cp.location, cp.education
        FROM users u
        LEFT JOIN candidate_profiles cp ON u.id = cp.user_id
        WHERE u.id = $1
      `, [candidate_id]);
      candidate = candResult.rows[0] || null;

      // Parse skills if stored as JSONB
      if (candidate && candidate.skills && typeof candidate.skills === 'string') {
        try { candidate.skills = JSON.parse(candidate.skills); } catch(e) {}
      }
      if (candidate && Array.isArray(candidate.skills)) {
        candidate.skills = candidate.skills.map(s => s.skill_name || s.name || s).join(', ');
      }
    }

    // Fetch job data if provided
    let job = null;
    if (job_id) {
      const jobResult = await pool.query('SELECT * FROM jobs WHERE id = $1 AND company_id = $2', [job_id, req.user.company_id]);
      job = jobResult.rows[0] || null;
    }

    // Get company name
    const companyName = req.user.company_name || 'Our company';
    const recruiterName = req.user.name || 'Recruiting Team';

    // Get previous communications for context (follow-ups)
    let previousComms = [];
    if (candidate_id && (type === 'follow_up' || type === 'followup')) {
      const commResult = await pool.query(`
        SELECT subject, body, type, created_at FROM communications
        WHERE candidate_id = $1 AND company_id = $2
        ORDER BY created_at DESC LIMIT 5
      `, [candidate_id, req.user.company_id]);
      previousComms = commResult.rows;
    }

    let result = null;

    switch (type) {
      case 'outreach':
        result = await commGenerator.generateOutreach({
          candidate, job, tone: tone || 'professional', companyName, recruiterName
        });
        break;

      case 'follow_up':
      case 'followup':
        const daysSince = options?.days_since_last_contact || 3;
        result = await commGenerator.generateFollowUp({
          candidate, job, previousComms, daysSinceLastContact: daysSince,
          tone: tone || 'friendly', companyName
        });
        break;

      case 'rejection':
        result = await commGenerator.generateRejection({
          candidate, job, reason: options?.reason || 'other_candidate',
          feedback: options?.feedback, tone: tone || 'empathetic', companyName
        });
        break;

      case 'offer_letter':
        result = await commGenerator.generateOfferLetter({
          candidate, job,
          compensation: options?.compensation || {},
          benefits: options?.benefits,
          startDate: options?.start_date,
          reportingTo: options?.reporting_to,
          companyName,
          location: options?.location || job?.location,
          employmentType: options?.employment_type || 'Full-time'
        });
        break;

      case 'interview_confirmation':
        result = await commGenerator.generateInterviewConfirmation({
          candidate, job,
          interviewDate: options?.interview_date,
          interviewType: options?.interview_type || 'Video call',
          interviewerName: options?.interviewer_name,
          location: options?.location,
          companyName
        });
        break;

      default:
        return res.status(400).json({ error: `Unknown communication type: ${type}. Supported: outreach, follow_up, rejection, offer_letter, interview_confirmation` });
    }

    if (!result) {
      return res.status(500).json({ error: 'AI generation failed — please try again' });
    }

    res.json({
      success: true,
      type,
      generated: result,
      candidate: candidate ? { id: candidate.id, name: candidate.name, email: candidate.email } : null,
      job: job ? { id: job.id, title: job.title } : null
    });
  } catch (err) {
    console.error('[communications] Generate error:', err.message);
    res.status(500).json({ error: 'Failed to generate communication', message: err.message });
  }
});

// ─── SEND COMMUNICATION ────────────────────────────────────────────────
// POST /api/communications/send
router.post('/send', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { candidate_id, job_id, type, subject, body, tone, run_pipeline } = req.body;

    if (!candidate_id || !body) {
      return res.status(400).json({ error: 'candidate_id and body are required' });
    }

    let finalBody = body;
    let finalSubject = subject;
    let pipelineResults = null;

    // Run through multi-agent pipeline if requested
    if (run_pipeline) {
      let candidate = null;
      const candResult = await pool.query(`
        SELECT u.id, u.name, u.email, cp.headline, cp.skills, cp.years_experience, cp.location
        FROM users u LEFT JOIN candidate_profiles cp ON u.id = cp.user_id
        WHERE u.id = $1
      `, [candidate_id]);
      candidate = candResult.rows[0] || null;

      let job = null;
      if (job_id) {
        const jobResult = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
        job = jobResult.rows[0] || null;
      }

      const pipeline = await commGenerator.runCommunicationPipeline({
        draft: body,
        candidate,
        job,
        companyName: req.user.company_name,
        type: type || 'custom'
      });

      if (pipeline && pipeline.final_message) {
        finalBody = typeof pipeline.final_message === 'string' ? pipeline.final_message : pipeline.final_message;
        pipelineResults = pipeline.pipeline_results;
      }
    }

    // Save communication
    const saved = await commGenerator.saveCommunication({
      companyId: req.user.company_id,
      recruiterId: req.user.id,
      candidateId: candidate_id,
      jobId: job_id || null,
      type: type || 'custom',
      subject: finalSubject,
      body: finalBody,
      tone: tone || 'professional',
      status: 'sent',
      metadata: pipelineResults ? { pipeline: pipelineResults } : {}
    });

    if (saved) {
      await commGenerator.markCommunicationSent(saved.id);
    }

    res.json({
      success: true,
      communication: saved,
      pipeline_results: pipelineResults
    });
  } catch (err) {
    console.error('[communications] Send error:', err.message);
    res.status(500).json({ error: 'Failed to send communication', message: err.message });
  }
});

// ─── SAVE DRAFT ────────────────────────────────────────────────────────
// POST /api/communications/draft
router.post('/draft', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { candidate_id, job_id, type, subject, body, tone } = req.body;

    if (!body) return res.status(400).json({ error: 'body is required' });

    const saved = await commGenerator.saveCommunication({
      companyId: req.user.company_id,
      recruiterId: req.user.id,
      candidateId: candidate_id || null,
      jobId: job_id || null,
      type: type || 'custom',
      subject,
      body,
      tone: tone || 'professional',
      status: 'draft'
    });

    res.json({ success: true, communication: saved });
  } catch (err) {
    console.error('[communications] Draft save error:', err.message);
    res.status(500).json({ error: 'Failed to save draft', message: err.message });
  }
});

// ─── COMMUNICATION PIPELINE ────────────────────────────────────────────
// POST /api/communications/pipeline — run draft through multi-agent pipeline
router.post('/pipeline', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { draft, candidate_id, job_id, type } = req.body;

    if (!draft) return res.status(400).json({ error: 'draft text is required' });

    let candidate = null;
    if (candidate_id) {
      const candResult = await pool.query(`
        SELECT u.id, u.name, u.email, cp.headline, cp.skills, cp.years_experience, cp.location
        FROM users u LEFT JOIN candidate_profiles cp ON u.id = cp.user_id
        WHERE u.id = $1
      `, [candidate_id]);
      candidate = candResult.rows[0] || null;
    }

    let job = null;
    if (job_id) {
      const jobResult = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
      job = jobResult.rows[0] || null;
    }

    const result = await commGenerator.runCommunicationPipeline({
      draft,
      candidate,
      job,
      companyName: req.user.company_name,
      type: type || 'custom'
    });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[communications] Pipeline error:', err.message);
    res.status(500).json({ error: 'Pipeline failed', message: err.message });
  }
});

// ─── COMMUNICATION HISTORY ─────────────────────────────────────────────
// GET /api/communications/history/:candidateId
router.get('/history/:candidateId', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const history = await commGenerator.getCommunicationHistory(
      parseInt(req.params.candidateId),
      req.user.company_id
    );
    res.json({ success: true, communications: history, total: history.length });
  } catch (err) {
    console.error('[communications] History error:', err.message);
    res.status(500).json({ error: 'Failed to fetch history', message: err.message });
  }
});

// ─── LIST ALL COMMUNICATIONS ───────────────────────────────────────────
// GET /api/communications
router.get('/', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { type, status, limit = 50, offset = 0 } = req.query;
    let query = `
      SELECT c.*,
        u_cand.name as candidate_name, u_cand.email as candidate_email,
        j.title as job_title
      FROM communications c
      LEFT JOIN users u_cand ON c.candidate_id = u_cand.id
      LEFT JOIN jobs j ON c.job_id = j.id
      WHERE c.company_id = $1
    `;
    const params = [req.user.company_id];
    let paramIdx = 2;

    if (type) {
      query += ` AND c.type = $${paramIdx++}`;
      params.push(type);
    }
    if (status) {
      query += ` AND c.status = $${paramIdx++}`;
      params.push(status);
    }

    query += ` ORDER BY c.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM communications WHERE company_id = $1`;
    const countParams = [req.user.company_id];
    let countIdx = 2;
    if (type) { countQuery += ` AND type = $${countIdx++}`; countParams.push(type); }
    if (status) { countQuery += ` AND status = $${countIdx++}`; countParams.push(status); }
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      success: true,
      communications: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('[communications] List error:', err.message);
    res.status(500).json({ error: 'Failed to list communications', message: err.message });
  }
});

// ─── BULK GENERATE ─────────────────────────────────────────────────────
// POST /api/communications/bulk — generate personalized messages for multiple candidates
router.post('/bulk', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { candidate_ids, job_id, type, tone, options } = req.body;

    if (!candidate_ids || !Array.isArray(candidate_ids) || candidate_ids.length === 0) {
      return res.status(400).json({ error: 'candidate_ids array is required' });
    }

    if (candidate_ids.length > 25) {
      return res.status(400).json({ error: 'Maximum 25 candidates per bulk operation' });
    }

    // Fetch job
    let job = null;
    if (job_id) {
      const jobResult = await pool.query('SELECT * FROM jobs WHERE id = $1 AND company_id = $2', [job_id, req.user.company_id]);
      job = jobResult.rows[0] || null;
    }

    const companyName = req.user.company_name || 'Our company';
    const recruiterName = req.user.name || 'Recruiting Team';

    // Generate for each candidate (sequentially to avoid rate limits)
    const results = [];
    for (const candId of candidate_ids) {
      try {
        // Fetch candidate
        const candResult = await pool.query(`
          SELECT u.id, u.name, u.email,
            cp.headline, cp.bio, cp.skills, cp.years_experience, cp.location
          FROM users u
          LEFT JOIN candidate_profiles cp ON u.id = cp.user_id
          WHERE u.id = $1
        `, [candId]);
        const candidate = candResult.rows[0] || null;

        if (!candidate) {
          results.push({ candidate_id: candId, success: false, error: 'Candidate not found' });
          continue;
        }

        // Parse skills
        if (candidate.skills && typeof candidate.skills === 'string') {
          try { candidate.skills = JSON.parse(candidate.skills); } catch(e) {}
        }
        if (Array.isArray(candidate.skills)) {
          candidate.skills = candidate.skills.map(s => s.skill_name || s.name || s).join(', ');
        }

        let generated = null;
        const commType = type || 'outreach';

        if (commType === 'outreach') {
          generated = await commGenerator.generateOutreach({ candidate, job, tone: tone || 'professional', companyName, recruiterName });
        } else if (commType === 'follow_up') {
          generated = await commGenerator.generateFollowUp({ candidate, job, previousComms: [], daysSinceLastContact: options?.days_since_last_contact || 3, tone: tone || 'friendly', companyName });
        } else if (commType === 'rejection') {
          generated = await commGenerator.generateRejection({ candidate, job, reason: options?.reason || 'other_candidate', feedback: options?.feedback, tone: tone || 'empathetic', companyName });
        }

        if (generated) {
          // Auto-save as draft
          const saved = await commGenerator.saveCommunication({
            companyId: req.user.company_id,
            recruiterId: req.user.id,
            candidateId: candId,
            jobId: job_id || null,
            type: commType,
            subject: generated.subject,
            body: generated.body,
            tone: tone || 'professional',
            status: 'draft',
            metadata: { bulk_generated: true, confidence_score: generated.confidence_score }
          });

          results.push({
            candidate_id: candId,
            candidate_name: candidate.name,
            success: true,
            communication_id: saved?.id,
            generated
          });
        } else {
          results.push({ candidate_id: candId, candidate_name: candidate?.name, success: false, error: 'Generation failed' });
        }
      } catch (err) {
        results.push({ candidate_id: candId, success: false, error: err.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
      success: true,
      total: candidate_ids.length,
      generated: successCount,
      failed: candidate_ids.length - successCount,
      results
    });
  } catch (err) {
    console.error('[communications] Bulk error:', err.message);
    res.status(500).json({ error: 'Bulk generation failed', message: err.message });
  }
});

// ─── SEQUENCE MANAGEMENT ───────────────────────────────────────────────
// POST /api/communications/sequences — create a follow-up sequence
router.post('/sequences', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { name, description, steps } = req.body;

    if (!name || !steps || !Array.isArray(steps)) {
      return res.status(400).json({ error: 'name and steps array are required' });
    }

    const result = await pool.query(`
      INSERT INTO communication_sequences (company_id, name, description, steps)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [req.user.company_id, name, description || '', JSON.stringify(steps)]);

    res.json({ success: true, sequence: result.rows[0] });
  } catch (err) {
    console.error('[communications] Sequence create error:', err.message);
    res.status(500).json({ error: 'Failed to create sequence', message: err.message });
  }
});

// GET /api/communications/sequences — list sequences
router.get('/sequences', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cs.*,
        (SELECT COUNT(*) FROM sequence_enrollments se WHERE se.sequence_id = cs.id AND se.status = 'active') as active_enrollments
      FROM communication_sequences cs
      WHERE cs.company_id = $1
      ORDER BY cs.created_at DESC
    `, [req.user.company_id]);

    res.json({ success: true, sequences: result.rows });
  } catch (err) {
    console.error('[communications] Sequence list error:', err.message);
    res.status(500).json({ error: 'Failed to list sequences', message: err.message });
  }
});

// POST /api/communications/sequences/:id/enroll — enroll candidate in sequence
router.post('/sequences/:id/enroll', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const sequenceId = parseInt(req.params.id);
    const { candidate_id, job_id } = req.body;

    if (!candidate_id) return res.status(400).json({ error: 'candidate_id is required' });

    // Verify sequence exists
    const seqResult = await pool.query('SELECT * FROM communication_sequences WHERE id = $1 AND company_id = $2', [sequenceId, req.user.company_id]);
    if (seqResult.rows.length === 0) return res.status(404).json({ error: 'Sequence not found' });

    const sequence = seqResult.rows[0];
    const steps = typeof sequence.steps === 'string' ? JSON.parse(sequence.steps) : sequence.steps;
    const firstStep = steps[0];
    const delayDays = firstStep?.delay_days || 0;

    // Calculate next send time
    const nextSend = new Date();
    nextSend.setDate(nextSend.getDate() + delayDays);

    // Check if already enrolled
    const existing = await pool.query(
      'SELECT id FROM sequence_enrollments WHERE sequence_id = $1 AND candidate_id = $2 AND status = $3',
      [sequenceId, candidate_id, 'active']
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Candidate already enrolled in this sequence' });
    }

    const enrollment = await pool.query(`
      INSERT INTO sequence_enrollments (sequence_id, candidate_id, job_id, company_id, current_step, next_send_at)
      VALUES ($1, $2, $3, $4, 0, $5)
      RETURNING *
    `, [sequenceId, candidate_id, job_id || null, req.user.company_id, nextSend]);

    // Update sequence enrollment count
    await pool.query('UPDATE communication_sequences SET total_enrolled = total_enrolled + 1 WHERE id = $1', [sequenceId]);

    res.json({ success: true, enrollment: enrollment.rows[0] });
  } catch (err) {
    console.error('[communications] Enroll error:', err.message);
    res.status(500).json({ error: 'Failed to enroll candidate', message: err.message });
  }
});

// ─── TEMPLATES ─────────────────────────────────────────────────────────
// GET /api/communications/templates
router.get('/templates', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { type } = req.query;
    let query = 'SELECT * FROM communication_templates WHERE company_id = $1';
    const params = [req.user.company_id];

    if (type) {
      query += ' AND type = $2';
      params.push(type);
    }

    query += ' ORDER BY usage_count DESC, created_at DESC';

    const result = await pool.query(query, params);
    res.json({ success: true, templates: result.rows });
  } catch (err) {
    console.error('[communications] Templates error:', err.message);
    res.status(500).json({ error: 'Failed to list templates', message: err.message });
  }
});

// POST /api/communications/templates — save a template
router.post('/templates', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { name, type, subject_template, body_template, tone, variables } = req.body;

    if (!name || !type || !body_template) {
      return res.status(400).json({ error: 'name, type, and body_template are required' });
    }

    const result = await pool.query(`
      INSERT INTO communication_templates (company_id, name, type, subject_template, body_template, tone, variables)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [req.user.company_id, name, type, subject_template || '', body_template, tone || 'professional', JSON.stringify(variables || [])]);

    res.json({ success: true, template: result.rows[0] });
  } catch (err) {
    console.error('[communications] Template save error:', err.message);
    res.status(500).json({ error: 'Failed to save template', message: err.message });
  }
});

// ─── ANALYTICS ─────────────────────────────────────────────────────────
// GET /api/communications/analytics
router.get('/analytics', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const companyId = req.user.company_id;

    const [totals, byType, byStatus, recentActivity] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'sent') as sent,
          COUNT(*) FILTER (WHERE status = 'draft') as drafts,
          COUNT(*) FILTER (WHERE status = 'replied') as replied,
          CASE WHEN COUNT(*) FILTER (WHERE status = 'sent') > 0
            THEN ROUND(COUNT(*) FILTER (WHERE status = 'replied')::numeric / COUNT(*) FILTER (WHERE status = 'sent') * 100, 1)
            ELSE 0 END as response_rate
        FROM communications WHERE company_id = $1
      `, [companyId]),
      pool.query(`
        SELECT type, COUNT(*) as count,
          COUNT(*) FILTER (WHERE status = 'replied') as replied
        FROM communications WHERE company_id = $1
        GROUP BY type ORDER BY count DESC
      `, [companyId]),
      pool.query(`
        SELECT status, COUNT(*) as count
        FROM communications WHERE company_id = $1
        GROUP BY status
      `, [companyId]),
      pool.query(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM communications WHERE company_id = $1 AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at) ORDER BY date DESC
      `, [companyId])
    ]);

    res.json({
      success: true,
      analytics: {
        totals: totals.rows[0],
        by_type: byType.rows,
        by_status: byStatus.rows,
        daily_activity: recentActivity.rows
      }
    });
  } catch (err) {
    console.error('[communications] Analytics error:', err.message);
    res.status(500).json({ error: 'Failed to fetch analytics', message: err.message });
  }
});

module.exports = router;
