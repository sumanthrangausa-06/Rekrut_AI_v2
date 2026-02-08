// Recruiter Dashboard & Job Management Routes
const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const trustscoreService = require('../services/trustscore');
const jobOptimizer = require('../services/job-optimizer');
const { AuditLogger } = require('../services/auditLogger');

const router = express.Router();

// Middleware to require recruiter role
function requireRecruiter(req, res, next) {
  if (!req.user.company_id || !['recruiter', 'hiring_manager', 'employer', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Recruiter access required' });
  }
  next();
}

// Dashboard overview
router.get('/dashboard', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const companyId = req.user.company_id;

    // Get TrustScore
    const trustScore = await trustscoreService.calculateTrustScore(companyId);

    // Get job stats
    const jobStats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active') as active_jobs,
        COUNT(*) FILTER (WHERE status = 'paused') as paused_jobs,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_jobs
      FROM jobs WHERE company_id = $1
    `, [companyId]);

    // Get application stats
    const appStats = await pool.query(`
      SELECT
        COUNT(*) as total_applications,
        COUNT(*) FILTER (WHERE status = 'applied') as new_applications,
        COUNT(*) FILTER (WHERE status = 'reviewing') as reviewing,
        COUNT(*) FILTER (WHERE status = 'interviewed') as interviewed,
        COUNT(*) FILTER (WHERE status = 'offered') as offered,
        COUNT(*) FILTER (WHERE status = 'hired') as hired
      FROM job_applications WHERE company_id = $1
    `, [companyId]);

    // Get upcoming interviews
    const upcomingInterviews = await pool.query(`
      SELECT si.id, si.scheduled_at, si.interview_type, si.status,
             u.name as candidate_name, u.email as candidate_email,
             j.title as job_title
      FROM scheduled_interviews si
      JOIN users u ON si.candidate_id = u.id
      JOIN jobs j ON si.job_id = j.id
      WHERE si.company_id = $1
        AND si.scheduled_at > NOW()
        AND si.status = 'scheduled'
      ORDER BY si.scheduled_at
      LIMIT 5
    `, [companyId]);

    // Get recent applications
    const recentApps = await pool.query(`
      SELECT ja.id, ja.status, ja.applied_at, ja.omniscore_at_apply,
             u.name as candidate_name, u.email as candidate_email,
             j.title as job_title, j.id as job_id
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      JOIN jobs j ON ja.job_id = j.id
      WHERE ja.company_id = $1
      ORDER BY ja.applied_at DESC
      LIMIT 10
    `, [companyId]);

    res.json({
      success: true,
      trust_score: trustScore,
      job_stats: jobStats.rows[0],
      application_stats: appStats.rows[0],
      upcoming_interviews: upcomingInterviews.rows,
      recent_applications: recentApps.rows
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// Get all jobs for company
router.get('/jobs', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT j.*,
             COALESCE(ja.views, 0) as views,
             COALESCE((SELECT COUNT(*) FROM job_applications japp WHERE japp.job_id = j.id), 0) as application_count,
             COALESCE(ja.interviews_scheduled, 0) as interviews
      FROM jobs j
      LEFT JOIN job_analytics ja ON j.id = ja.job_id
      WHERE (j.company_id = $1 OR j.user_id = $2)
    `;
    const params = [req.user.company_id, req.user.id];

    if (status) {
      query += ` AND j.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY j.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({ jobs: result.rows });
  } catch (err) {
    console.error('Get jobs error:', err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// Create job with optional AI optimization
router.post('/jobs', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const {
      title, description, requirements, location, salary_range, job_type,
      screening_questions,
      optimize = false // Flag to run AI optimization
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Job title is required' });
    }

    let finalDescription = description;
    let finalRequirements = requirements;
    let optimizationResult = null;

    // Run AI optimization if requested
    if (optimize) {
      try {
        optimizationResult = await jobOptimizer.optimizeJobDescription({
          title, description, requirements, location, salary_range, job_type,
          company: req.user.company_name
        });
        finalDescription = optimizationResult.optimized_description || description;
        finalRequirements = optimizationResult.optimized_requirements || requirements;
      } catch (e) {
        console.error('Job optimization error:', e);
        // Continue without optimization
      }
    }

    // Create job
    const result = await pool.query(
      `INSERT INTO jobs (user_id, company_id, title, company, description, requirements, location, salary_range, job_type, screening_questions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [req.user.id, req.user.company_id, title, req.user.company_name,
       finalDescription, finalRequirements, location, salary_range, job_type || 'full-time',
       screening_questions ? JSON.stringify(screening_questions) : null]
    );

    const job = result.rows[0];

    // Create analytics entry
    await pool.query(
      'INSERT INTO job_analytics (job_id) VALUES ($1)',
      [job.id]
    );

    // Analyze and add authenticity score
    try {
      const analysis = await jobOptimizer.analyzeJobPosting({
        title, description: finalDescription, requirements: finalRequirements,
        location, salary_range, job_type, company: req.user.company_name
      });

      await trustscoreService.addJobAuthenticityComponent(
        req.user.company_id,
        job.id,
        analysis.overall_score
      );

      res.json({
        success: true,
        job,
        optimization: optimizationResult,
        analysis,
        message: optimize ? 'Job created with AI optimization!' : 'Job created successfully'
      });
    } catch (e) {
      // Return job without analysis
      res.json({ success: true, job });
    }

  } catch (err) {
    console.error('Create job error:', err);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// Analyze job posting
router.post('/jobs/analyze', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const analysis = await jobOptimizer.analyzeJobPosting(req.body);
    res.json({ success: true, analysis });
  } catch (err) {
    console.error('Analyze job error:', err);
    res.status(500).json({ error: 'Failed to analyze job' });
  }
});

// Optimize job description with AI
router.post('/jobs/optimize', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const optimized = await jobOptimizer.optimizeJobDescription(req.body);
    res.json({ success: true, optimized });
  } catch (err) {
    console.error('Optimize job error:', err);
    res.status(500).json({ error: 'Failed to optimize job' });
  }
});

// Get salary insights
router.get('/salary-insights', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { title, location, experience_level } = req.query;

    if (!title) {
      return res.status(400).json({ error: 'Job title is required' });
    }

    const insights = await jobOptimizer.getSalaryInsights(title, location, experience_level);
    res.json({ success: true, insights });
  } catch (err) {
    console.error('Salary insights error:', err);
    res.status(500).json({ error: 'Failed to get salary insights' });
  }
});

// Update job
router.put('/jobs/:id', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { title, description, requirements, location, salary_range, job_type, status, screening_questions } = req.body;

    // Verify ownership (company_id or user_id)
    const existing = await pool.query(
      'SELECT id FROM jobs WHERE id = $1 AND (company_id = $2 OR user_id = $3)',
      [req.params.id, req.user.company_id, req.user.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const result = await pool.query(
      `UPDATE jobs SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        requirements = COALESCE($3, requirements),
        location = COALESCE($4, location),
        salary_range = COALESCE($5, salary_range),
        job_type = COALESCE($6, job_type),
        status = COALESCE($7, status),
        screening_questions = COALESCE($8, screening_questions),
        updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [title, description, requirements, location, salary_range, job_type, status, screening_questions || null, req.params.id]
    );

    res.json({ success: true, job: result.rows[0] });
  } catch (err) {
    console.error('Update job error:', err);
    res.status(500).json({ error: 'Failed to update job' });
  }
});

// Get ALL applications for the company
router.get('/applications', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { status, job_id, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT ja.*,
             u.name as candidate_name, u.email as candidate_email,
             j.title as job_title, j.id as job_id,
             j.screening_questions,
             os.total_score as current_omniscore, os.score_tier,
             (SELECT COUNT(*) FROM skill_assessments sa2 JOIN candidate_skills cs2 ON sa2.skill_id = cs2.id WHERE cs2.user_id = ja.candidate_id AND sa2.passed = true) as verified_skills_count,
             (SELECT MAX(i2.overall_score) FROM interviews i2 WHERE i2.user_id = ja.candidate_id AND i2.status = 'completed') as best_interview_score,
             (SELECT COUNT(*) FROM interviews i3 WHERE i3.user_id = ja.candidate_id AND i3.status = 'completed') as completed_interviews
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      JOIN jobs j ON ja.job_id = j.id
      LEFT JOIN omni_scores os ON u.id = os.user_id
      WHERE ja.company_id = $1
    `;
    const params = [req.user.company_id];

    if (status) {
      query += ` AND ja.status = $${params.length + 1}`;
      params.push(status);
    }

    if (job_id) {
      query += ` AND ja.job_id = $${params.length + 1}`;
      params.push(job_id);
    }

    query += ` ORDER BY ja.applied_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({ applications: result.rows });
  } catch (err) {
    console.error('Get applications error:', err);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// Update application status (alternative route)
router.put('/applications/:id/status', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { status } = req.body;

    // Verify application belongs to company
    const existing = await pool.query(
      'SELECT id, job_id, candidate_id FROM job_applications WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.company_id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const result = await pool.query(
      `UPDATE job_applications SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );

    // Audit log
    await AuditLogger.log({
      actionType: 'application_status_changed',
      userId: req.user.id,
      targetType: 'job_application',
      targetId: parseInt(req.params.id),
      metadata: {
        candidate_id: existing.rows[0].candidate_id,
        job_id: existing.rows[0].job_id,
        new_status: status
      },
      req
    });

    res.json({ success: true, application: result.rows[0] });
  } catch (err) {
    console.error('Update application status error:', err);
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// Create interview (POST to /interviews)
router.post('/interviews', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const {
      application_id, scheduled_at, duration = 60,
      interview_type = 'video', notes
    } = req.body;

    // Get application details
    const app = await pool.query(
      'SELECT ja.job_id, ja.candidate_id FROM job_applications ja WHERE ja.id = $1 AND ja.company_id = $2',
      [application_id, req.user.company_id]
    );

    if (app.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const { job_id, candidate_id } = app.rows[0];

    // Auto-generate Jitsi meeting link for video interviews
    let meeting_link = null;
    if (interview_type === 'video') {
      const roomId = `HireLoop-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`;
      meeting_link = `https://meet.jit.si/${roomId}`;
    }

    const result = await pool.query(
      `INSERT INTO scheduled_interviews
       (company_id, job_id, candidate_id, recruiter_id, scheduled_at, duration_minutes, interview_type, meeting_link, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [req.user.company_id, job_id, candidate_id, req.user.id, scheduled_at, duration, interview_type, meeting_link, notes]
    );

    // Update application status
    await pool.query(
      `UPDATE job_applications SET status = 'interviewed', updated_at = NOW() WHERE id = $1`,
      [application_id]
    );

    res.json({ success: true, interview: result.rows[0] });
  } catch (err) {
    console.error('Create interview error:', err);
    res.status(500).json({ error: 'Failed to create interview' });
  }
});

// Delete/cancel interview
router.delete('/interviews/:id', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM scheduled_interviews WHERE id = $1 AND company_id = $2 RETURNING id',
      [req.params.id, req.user.company_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete interview error:', err);
    res.status(500).json({ error: 'Failed to delete interview' });
  }
});

// Get all candidates who have applied (for offer creation dropdown)
router.get('/candidates', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (u.id)
        u.id, u.name, u.email
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      WHERE ja.company_id = $1
      ORDER BY u.id, ja.applied_at DESC
    `, [req.user.company_id]);

    res.json({ candidates: result.rows });
  } catch (err) {
    console.error('Get candidates error:', err);
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
});

// Get applications for a job
router.get('/jobs/:id/applications', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    // Verify job belongs to company or user
    const job = await pool.query(
      'SELECT id, title, screening_questions FROM jobs WHERE id = $1 AND (company_id = $2 OR user_id = $3)',
      [req.params.id, req.user.company_id, req.user.id]
    );

    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const applications = await pool.query(`
      SELECT ja.*,
             u.name as candidate_name, u.email as candidate_email,
             os.total_score as current_omniscore, os.score_tier
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      LEFT JOIN omni_scores os ON u.id = os.user_id
      WHERE ja.job_id = $1
      ORDER BY ja.applied_at DESC
    `, [req.params.id]);

    res.json({
      job: job.rows[0],
      applications: applications.rows
    });
  } catch (err) {
    console.error('Get applications error:', err);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// Update application status
router.put('/applications/:id', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { status, recruiter_notes } = req.body;

    // Verify application belongs to company
    const existing = await pool.query(
      'SELECT id, job_id, candidate_id FROM job_applications WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.company_id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const result = await pool.query(
      `UPDATE job_applications SET
        status = COALESCE($1, status),
        recruiter_notes = COALESCE($2, recruiter_notes),
        updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, recruiter_notes, req.params.id]
    );

    // Update job analytics
    if (status) {
      const app = existing.rows[0];

      // Update counters based on status
      if (status === 'interviewed') {
        await pool.query(
          'UPDATE job_analytics SET interviews_scheduled = interviews_scheduled + 1 WHERE job_id = $1',
          [app.job_id]
        );
      } else if (status === 'offered') {
        await pool.query(
          'UPDATE job_analytics SET offers_made = offers_made + 1 WHERE job_id = $1',
          [app.job_id]
        );

        // Update hiring ratio score
        await trustscoreService.updateHiringRatioScore(req.user.company_id);
      } else if (status === 'hired') {
        await pool.query(
          'UPDATE job_analytics SET offers_accepted = offers_accepted + 1 WHERE job_id = $1',
          [app.job_id]
        );
      }
    }

    // Audit log: Application status change
    if (status) {
      await AuditLogger.log({
        actionType: 'application_status_changed',
        userId: req.user.id,
        targetType: 'job_application',
        targetId: parseInt(req.params.id),
        metadata: {
          candidate_id: existing.rows[0].candidate_id,
          job_id: existing.rows[0].job_id,
          new_status: status,
          recruiter_notes: recruiter_notes || null
        },
        req
      });
    }

    res.json({ success: true, application: result.rows[0] });
  } catch (err) {
    console.error('Update application error:', err);
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// Schedule interview
router.post('/interviews/schedule', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    let {
      job_id, candidate_id, scheduled_at, duration_minutes = 60,
      interview_type = 'video', meeting_link, notes
    } = req.body;

    if (!job_id || !candidate_id || !scheduled_at) {
      return res.status(400).json({ error: 'Job, candidate, and scheduled time are required' });
    }

    // Verify job belongs to company
    const job = await pool.query(
      'SELECT id FROM jobs WHERE id = $1 AND company_id = $2',
      [job_id, req.user.company_id]
    );

    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Auto-generate Jitsi meeting link for video interviews if not provided
    if (interview_type === 'video' && !meeting_link) {
      const roomId = `HireLoop-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`;
      meeting_link = `https://meet.jit.si/${roomId}`;
    }

    const result = await pool.query(
      `INSERT INTO scheduled_interviews
       (company_id, job_id, candidate_id, recruiter_id, scheduled_at, duration_minutes, interview_type, meeting_link, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [req.user.company_id, job_id, candidate_id, req.user.id,
       scheduled_at, duration_minutes, interview_type, meeting_link, notes]
    );

    // Update application status
    await pool.query(
      `UPDATE job_applications SET status = 'interviewed', updated_at = NOW()
       WHERE job_id = $1 AND candidate_id = $2`,
      [job_id, candidate_id]
    );

    // Update job analytics
    await pool.query(
      'UPDATE job_analytics SET interviews_scheduled = interviews_scheduled + 1 WHERE job_id = $1',
      [job_id]
    );

    // Add behavior points for scheduling
    await trustscoreService.addBehaviorComponent(req.user.company_id, 'interview_scheduled', 5, 10);

    res.json({ success: true, interview: result.rows[0] });
  } catch (err) {
    console.error('Schedule interview error:', err);
    res.status(500).json({ error: 'Failed to schedule interview' });
  }
});

// Get scheduled interviews
router.get('/interviews', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { upcoming_only = 'true', limit = 20 } = req.query;

    let query = `
      SELECT si.*,
             u.name as candidate_name, u.email as candidate_email,
             j.title as job_title
      FROM scheduled_interviews si
      JOIN users u ON si.candidate_id = u.id
      JOIN jobs j ON si.job_id = j.id
      WHERE si.company_id = $1
    `;

    if (upcoming_only === 'true') {
      query += ` AND si.scheduled_at > NOW() AND si.status = 'scheduled'`;
    }

    query += ` ORDER BY si.scheduled_at LIMIT $2`;

    const result = await pool.query(query, [req.user.company_id, limit]);

    res.json({ interviews: result.rows });
  } catch (err) {
    console.error('Get interviews error:', err);
    res.status(500).json({ error: 'Failed to fetch interviews' });
  }
});

// Update interview outcome
router.put('/interviews/:id', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { status, outcome, feedback, meeting_link } = req.body;

    const result = await pool.query(
      `UPDATE scheduled_interviews SET
        status = COALESCE($1, status),
        outcome = COALESCE($2, outcome),
        feedback = COALESCE($3, feedback),
        meeting_link = COALESCE($4, meeting_link),
        updated_at = NOW()
       WHERE id = $5 AND company_id = $6
       RETURNING *`,
      [status, outcome, feedback ? JSON.stringify(feedback) : null, meeting_link, req.params.id, req.user.company_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    res.json({ success: true, interview: result.rows[0] });
  } catch (err) {
    console.error('Update interview error:', err);
    res.status(500).json({ error: 'Failed to update interview' });
  }
});

// Generate interview questions for a job
router.post('/jobs/:id/questions', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const job = await pool.query(
      'SELECT title, description, requirements FROM jobs WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.company_id]
    );

    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const { count = 8 } = req.body;
    const questions = await jobOptimizer.generateInterviewQuestionsForJob(job.rows[0], count);

    res.json({ success: true, questions });
  } catch (err) {
    console.error('Generate questions error:', err);
    res.status(500).json({ error: 'Failed to generate questions' });
  }
});

// Analyze candidate fit for a job
router.post('/jobs/:id/analyze-candidate', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { candidate_id } = req.body;

    // Get job details
    const job = await pool.query(
      'SELECT * FROM jobs WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.company_id]
    );

    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Get candidate profile
    const candidate = await pool.query(`
      SELECT u.*, os.total_score as omniscore, os.score_tier,
             AVG(i.overall_score) as avg_interview_score
      FROM users u
      LEFT JOIN omni_scores os ON u.id = os.user_id
      LEFT JOIN interviews i ON u.id = i.user_id AND i.status = 'completed'
      WHERE u.id = $1
      GROUP BY u.id, os.total_score, os.score_tier
    `, [candidate_id]);

    if (candidate.rows.length === 0) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    const analysis = await jobOptimizer.analyzeCandidateFit(
      {
        name: candidate.rows[0].name,
        omniscore: candidate.rows[0].omniscore,
        interview_score: candidate.rows[0].avg_interview_score
      },
      job.rows[0]
    );

    res.json({ success: true, analysis });
  } catch (err) {
    console.error('Analyze candidate error:', err);
    res.status(500).json({ error: 'Failed to analyze candidate' });
  }
});

module.exports = router;
