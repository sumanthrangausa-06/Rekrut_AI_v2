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

// Generate complete job description from title + optional notes
router.post('/jobs/generate', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { title, brief_notes, location, job_type } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Job title is required' });
    }

    const generated = await jobOptimizer.generateJobDescription(title, brief_notes, {
      location,
      job_type,
      company: req.user.company_name
    });
    res.json({ success: true, generated });
  } catch (err) {
    console.error('Generate job description error:', err);
    res.status(500).json({ error: 'Failed to generate job description' });
  }
});

// Suggest skills and requirements for a role
router.post('/jobs/suggest-skills', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { title, description, current_skills } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Job title is required' });
    }

    const suggestions = await jobOptimizer.suggestSkillsForRole(title, description, current_skills || []);
    res.json({ success: true, suggestions });
  } catch (err) {
    console.error('Suggest skills error:', err);
    res.status(500).json({ error: 'Failed to suggest skills' });
  }
});

// Suggest optimized job titles
router.post('/jobs/suggest-title', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Current job title is required' });
    }

    const suggestions = await jobOptimizer.suggestJobTitles(title, description);
    res.json({ success: true, suggestions });
  } catch (err) {
    console.error('Suggest title error:', err);
    res.status(500).json({ error: 'Failed to suggest titles' });
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
      const roomId = `Rekrut AI-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`;
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

    // Validate status against pipeline stages
    if (status && !PIPELINE_STAGES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${PIPELINE_STAGES.join(', ')}` });
    }

    // Verify application belongs to company
    const existing = await pool.query(
      'SELECT id, job_id, candidate_id, status as old_status FROM job_applications WHERE id = $1 AND company_id = $2',
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

    // Log to activity feed (events table) for status changes
    if (status && status !== existing.rows[0].old_status) {
      try {
        await pool.query(
          `INSERT INTO events (user_id, event_type, event_data, created_at)
           VALUES ($1, 'application_status_changed', $2, NOW())`,
          [req.user.id, JSON.stringify({
            application_id: parseInt(req.params.id),
            candidate_id: existing.rows[0].candidate_id,
            job_id: existing.rows[0].job_id,
            old_status: existing.rows[0].old_status,
            new_status: status,
            changed_by: req.user.id,
          })]
        );
      } catch (e) { /* non-critical */ }
    }

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
      const roomId = `Rekrut AI-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`;
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
    const { upcoming_only = 'false', status, limit = 50 } = req.query;

    let query = `
      SELECT si.*,
             u.name as candidate_name, u.email as candidate_email,
             j.title as job_title
      FROM scheduled_interviews si
      JOIN users u ON si.candidate_id = u.id
      JOIN jobs j ON si.job_id = j.id
      WHERE si.company_id = $1
    `;
    const params = [req.user.company_id];

    if (upcoming_only === 'true') {
      query += ` AND si.scheduled_at > NOW() AND si.status IN ('scheduled', 'confirmed')`;
    }

    if (status) {
      query += ` AND si.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY si.scheduled_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

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

// Get candidate coaching/practice history (for recruiter review)
router.get('/candidates/:id/coaching', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const candidateId = req.params.id;

    // Verify candidate has applied to one of recruiter's jobs
    const hasRelation = await pool.query(
      `SELECT 1 FROM job_applications ja
       JOIN jobs j ON ja.job_id = j.id
       WHERE ja.candidate_id = $1 AND (j.company_id = $2 OR j.user_id = $3)
       LIMIT 1`,
      [candidateId, req.user.company_id, req.user.id]
    );

    if (hasRelation.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied — candidate has not applied to your jobs' });
    }

    // Get candidate name
    const candidate = await pool.query('SELECT name, email FROM users WHERE id = $1', [candidateId]);

    // Get all coaching sessions
    const sessions = await pool.query(
      `SELECT
        id, question, category, score, coaching_data, response_type,
        duration_seconds, created_at
       FROM practice_sessions
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [candidateId]
    );

    // Get aggregate stats
    const stats = await pool.query(
      `SELECT
        COUNT(*) as total_sessions,
        AVG(score) as average_score,
        MIN(score) as lowest_score,
        MAX(score) as highest_score,
        MIN(created_at) as first_session,
        MAX(created_at) as last_session
       FROM practice_sessions
       WHERE user_id = $1`,
      [candidateId]
    );

    // Calculate improvement trend
    const improvement = await pool.query(
      `WITH ordered AS (
        SELECT score, ROW_NUMBER() OVER (ORDER BY created_at) as rn,
               COUNT(*) OVER () as total
        FROM practice_sessions WHERE user_id = $1
      )
      SELECT
        AVG(CASE WHEN rn <= total/2 THEN score END) as first_half_avg,
        AVG(CASE WHEN rn > total/2 THEN score END) as second_half_avg
      FROM ordered`,
      [candidateId]
    );

    let improvementPercent = null;
    if (improvement.rows[0].first_half_avg && improvement.rows[0].second_half_avg) {
      const firstHalf = parseFloat(improvement.rows[0].first_half_avg);
      const secondHalf = parseFloat(improvement.rows[0].second_half_avg);
      improvementPercent = Math.round(((secondHalf - firstHalf) / firstHalf) * 100);
    }

    // Category breakdown
    const byCategory = await pool.query(
      `SELECT category, COUNT(*) as count, AVG(score) as avg_score
       FROM practice_sessions WHERE user_id = $1
       GROUP BY category ORDER BY avg_score DESC`,
      [candidateId]
    );

    const parsed = sessions.rows.map(row => ({
      ...row,
      coaching_data: typeof row.coaching_data === 'string' ? JSON.parse(row.coaching_data) : row.coaching_data,
    }));

    res.json({
      success: true,
      candidate: candidate.rows[0] || { name: 'Unknown', email: '' },
      stats: {
        total_sessions: parseInt(stats.rows[0].total_sessions) || 0,
        average_score: parseFloat(stats.rows[0].average_score) || null,
        lowest_score: parseFloat(stats.rows[0].lowest_score) || null,
        highest_score: parseFloat(stats.rows[0].highest_score) || null,
        improvement_percent: improvementPercent,
        first_session: stats.rows[0].first_session,
        last_session: stats.rows[0].last_session,
      },
      by_category: byCategory.rows,
      sessions: parsed,
    });
  } catch (err) {
    console.error('Get candidate coaching history error:', err);
    res.status(500).json({ error: 'Failed to fetch coaching history' });
  }
});

// ============= PIPELINE STAGES =============

// Valid pipeline stages in order (canonical)
// Based on industry research: LinkedIn, Greenhouse, Lever, Ashby, SmartRecruiters
const PIPELINE_STAGES = ['applied', 'screening', 'shortlisted', 'reviewing', 'interviewed', 'offered', 'hired', 'rejected', 'withdrawn'];

// GET pipeline stages (so frontend stays in sync)
router.get('/pipeline-stages', authMiddleware, requireRecruiter, (req, res) => {
  const active = PIPELINE_STAGES.filter(s => !['rejected', 'withdrawn'].includes(s));
  const terminal = ['rejected', 'withdrawn'];
  res.json({
    success: true,
    stages: PIPELINE_STAGES,
    active_stages: active,
    terminal_stages: terminal,
    stage_config: {
      applied: { label: 'Applied', color: 'blue', order: 0 },
      screening: { label: 'Screening', color: 'purple', order: 1 },
      shortlisted: { label: 'Shortlisted', color: 'indigo', order: 2 },
      reviewing: { label: 'Reviewing', color: 'amber', order: 3 },
      interviewed: { label: 'Interviewed', color: 'cyan', order: 4 },
      offered: { label: 'Offered', color: 'emerald', order: 5 },
      hired: { label: 'Hired', color: 'green', order: 6 },
      rejected: { label: 'Rejected', color: 'red', order: -1 },
      withdrawn: { label: 'Withdrawn', color: 'gray', order: -1 },
    }
  });
});

// Batch update application status (for bulk actions)
router.put('/applications/batch-status', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { application_ids, status } = req.body;

    if (!application_ids || !Array.isArray(application_ids) || application_ids.length === 0) {
      return res.status(400).json({ error: 'application_ids array required' });
    }

    if (!status || !PIPELINE_STAGES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${PIPELINE_STAGES.join(', ')}` });
    }

    if (application_ids.length > 50) {
      return res.status(400).json({ error: 'Max 50 applications per batch' });
    }

    // Verify all applications belong to the company
    const placeholders = application_ids.map((_, i) => `$${i + 2}`).join(',');
    const verification = await pool.query(
      `SELECT id FROM job_applications WHERE company_id = $1 AND id IN (${placeholders})`,
      [req.user.company_id, ...application_ids]
    );

    const validIds = verification.rows.map(r => r.id);
    if (validIds.length === 0) {
      return res.status(404).json({ error: 'No valid applications found' });
    }

    // Update all valid applications
    const updatePlaceholders = validIds.map((_, i) => `$${i + 2}`).join(',');
    const result = await pool.query(
      `UPDATE job_applications SET status = $1, updated_at = NOW() WHERE id IN (${updatePlaceholders}) RETURNING *`,
      [status, ...validIds]
    );

    // Audit log batch action
    await AuditLogger.log({
      actionType: 'batch_status_change',
      userId: req.user.id,
      targetType: 'job_applications',
      targetId: null,
      metadata: {
        application_ids: validIds,
        new_status: status,
        count: validIds.length
      },
      req
    });

    res.json({
      success: true,
      updated: result.rows.length,
      applications: result.rows
    });
  } catch (err) {
    console.error('Batch status update error:', err);
    res.status(500).json({ error: 'Failed to update applications' });
  }
});

// Get applications grouped by pipeline stage (for kanban view)
router.get('/pipeline/:jobId', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const jobId = req.params.jobId;

    // Verify job belongs to company
    const job = await pool.query(
      'SELECT id, title, status FROM jobs WHERE id = $1 AND (company_id = $2 OR user_id = $3)',
      [jobId, req.user.company_id, req.user.id]
    );

    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Get all applications for this job with candidate details
    const applications = await pool.query(`
      SELECT ja.*,
             u.name as candidate_name, u.email as candidate_email,
             os.total_score as current_omniscore, os.score_tier,
             (SELECT COUNT(*) FROM skill_assessments sa2 JOIN candidate_skills cs2 ON sa2.skill_id = cs2.id WHERE cs2.user_id = ja.candidate_id AND sa2.passed = true) as verified_skills_count,
             (SELECT MAX(i2.overall_score) FROM interviews i2 WHERE i2.user_id = ja.candidate_id AND i2.status = 'completed') as best_interview_score
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      LEFT JOIN omni_scores os ON u.id = os.user_id
      WHERE ja.job_id = $1
      ORDER BY ja.match_score DESC NULLS LAST, ja.applied_at ASC
    `, [jobId]);

    // Group by pipeline stage
    const pipeline = {};
    for (const stage of PIPELINE_STAGES) {
      pipeline[stage] = [];
    }

    for (const app of applications.rows) {
      const stage = PIPELINE_STAGES.includes(app.status) ? app.status : 'applied';
      pipeline[stage].push(app);
    }

    // Get stage counts
    const stageCounts = {};
    for (const stage of PIPELINE_STAGES) {
      stageCounts[stage] = pipeline[stage].length;
    }

    res.json({
      success: true,
      job: job.rows[0],
      pipeline,
      stage_counts: stageCounts,
      total: applications.rows.length,
      stages: PIPELINE_STAGES
    });
  } catch (err) {
    console.error('Get pipeline error:', err);
    res.status(500).json({ error: 'Failed to get pipeline' });
  }
});

// Get ranked candidates for a job (by match score)
router.get('/jobs/:id/ranked-candidates', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const jobId = req.params.id;
    const { min_score = 0 } = req.query;

    // Verify job belongs to company
    const job = await pool.query(
      'SELECT id, title FROM jobs WHERE id = $1 AND (company_id = $2 OR user_id = $3)',
      [jobId, req.user.company_id, req.user.id]
    );

    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Get applications ranked by match score
    const ranked = await pool.query(`
      SELECT ja.*,
             u.name as candidate_name, u.email as candidate_email,
             os.total_score as current_omniscore, os.score_tier,
             cp.headline, cp.location as candidate_location, cp.years_experience,
             (SELECT json_agg(json_build_object('name', cs.skill_name, 'level', cs.level, 'verified', cs.is_verified))
              FROM candidate_skills cs WHERE cs.user_id = ja.candidate_id) as skills,
             mr.matching_skills, mr.missing_skills, mr.similarity_score, mr.match_explanation
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      LEFT JOIN omni_scores os ON u.id = os.user_id
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN match_results mr ON mr.candidate_id = ja.candidate_id AND mr.job_id = ja.job_id
      WHERE ja.job_id = $1
        AND ja.status NOT IN ('withdrawn', 'rejected')
        AND COALESCE(ja.match_score, 0) >= $2
      ORDER BY ja.match_score DESC NULLS LAST, os.total_score DESC NULLS LAST
    `, [jobId, min_score]);

    res.json({
      success: true,
      job: job.rows[0],
      candidates: ranked.rows,
      total: ranked.rows.length
    });
  } catch (err) {
    console.error('Get ranked candidates error:', err);
    res.status(500).json({ error: 'Failed to get ranked candidates' });
  }
});

// ============= AI FEATURES =============

// AI Candidate Summary — one-click strengths/concerns/fit assessment
router.post('/ai/candidate-summary', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { application_id } = req.body;
    if (!application_id) return res.status(400).json({ error: 'application_id required' });
    const { chat } = require('../lib/polsia-ai');

    // Get application with all candidate data
    const app = await pool.query(`
      SELECT ja.*, j.title as job_title, j.description as job_desc, j.requirements as job_reqs,
             j.screening_questions,
             u.name as candidate_name, u.email as candidate_email,
             cp.headline, cp.bio, cp.location as candidate_location, cp.years_experience,
             cp.salary_min, cp.salary_max
      FROM job_applications ja
      JOIN jobs j ON ja.job_id = j.id
      JOIN users u ON ja.candidate_id = u.id
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      WHERE ja.id = $1 AND (j.company_id = $2 OR j.user_id = $3)
    `, [application_id, req.user.company_id, req.user.id]);

    if (app.rows.length === 0) return res.status(404).json({ error: 'Application not found' });
    const a = app.rows[0];

    // Get skills
    const skills = await pool.query('SELECT skill_name, category, years_experience, is_verified FROM candidate_skills WHERE user_id = $1', [a.candidate_id]);
    // Get experience
    const experience = await pool.query('SELECT company_name, title, description FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC LIMIT 5', [a.candidate_id]);

    const prompt = `Provide a comprehensive assessment of this candidate for the ${a.job_title} position.

CANDIDATE: ${a.candidate_name}
Headline: ${a.headline || 'Not set'}
Bio: ${a.bio || 'Not set'}
Location: ${a.candidate_location || 'Not specified'}
Years Experience: ${a.years_experience || 'Unknown'}
Skills: ${skills.rows.map(s => `${s.skill_name}${s.is_verified ? ' ✓' : ''} (${s.years_experience || '?'}y)`).join(', ') || 'None'}
Recent Roles: ${experience.rows.map(e => `${e.title} at ${e.company_name}`).join('; ') || 'None listed'}
Cover Letter: ${a.cover_letter?.substring(0, 500) || 'Not provided'}
Screening Answers: ${JSON.stringify(a.screening_answers || {}).substring(0, 500)}
Match Score: ${a.match_score || 'N/A'}

JOB: ${a.job_title}
Requirements: ${a.job_reqs?.substring(0, 500) || 'Not specified'}

Return JSON:
{
  "fit_score": 0-100,
  "fit_level": "strong_fit|good_fit|moderate_fit|weak_fit",
  "summary": "2-3 sentence executive summary",
  "strengths": ["Top 3 strengths for this role"],
  "concerns": ["Top 2-3 concerns or gaps"],
  "interview_focus_areas": ["2-3 topics to probe in interview"],
  "salary_alignment": "aligned|above_range|below_range|unknown",
  "recommendation": "advance|consider|pass",
  "recommendation_reason": "1 sentence explanation"
}
Only return JSON.`;

    const result = await chat(prompt, {
      system: 'You are a senior recruiter providing candidate assessments. Be objective, data-driven, and concise. Always return valid JSON.'
    });

    let parsed;
    try { parsed = JSON.parse(result); } catch { const m = result.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { error: 'Parse failed' }; }
    res.json({ success: true, summary: parsed });
  } catch (err) {
    console.error('AI candidate summary error:', err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// AI Screening Questions Suggestions — based on job + recruiter's past bank
router.post('/ai/suggest-questions', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { job_title, job_description, existing_questions = [] } = req.body;
    if (!job_title) return res.status(400).json({ error: 'job_title required' });
    const { chat } = require('../lib/polsia-ai');

    // Get recruiter's past screening questions from question_bank
    const pastQuestions = await pool.query(`
      SELECT DISTINCT question_text, category FROM question_bank
      WHERE recruiter_id = $1
      ORDER BY usage_count DESC LIMIT 20
    `, [req.user.id]);

    const prompt = `Suggest screening questions for a ${job_title} position.

Job Description: ${job_description?.substring(0, 500) || 'Not provided'}

Recruiter's Past Questions (for reuse):
${pastQuestions.rows.map(q => `- [${q.category}] ${q.question_text}`).join('\n') || 'None'}

Already Added:
${existing_questions.map(q => `- ${q.question || q.text}`).join('\n') || 'None'}

Suggest 5 screening questions. Mix reusable ones from the bank with new job-specific ones.

Return JSON array:
[
  {
    "question": "The question text",
    "type": "text|yes_no|select",
    "category": "work_authorization|salary|availability|experience|technical|culture",
    "options": ["only if type is select"],
    "required": true/false,
    "from_bank": true/false
  }
]
Only return JSON array.`;

    const result = await chat(prompt, {
      system: 'You are an expert recruiter designing screening questions. Make them practical and relevant. Always return valid JSON.'
    });

    let parsed;
    try { parsed = JSON.parse(result); } catch { const m = result.match(/\[[\s\S]*\]/); parsed = m ? JSON.parse(m[0]) : []; }
    res.json({ success: true, suggestions: parsed });
  } catch (err) {
    console.error('AI suggest questions error:', err);
    res.status(500).json({ error: 'Failed to suggest questions' });
  }
});

// Save questions to recruiter's question bank
router.post('/question-bank', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { questions } = req.body;
    if (!questions || !Array.isArray(questions)) return res.status(400).json({ error: 'questions array required' });

    const saved = [];
    for (const q of questions) {
      const result = await pool.query(`
        INSERT INTO question_bank (recruiter_id, question_text, category, question_type, options)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (recruiter_id, question_text) DO UPDATE SET usage_count = question_bank.usage_count + 1
        RETURNING *
      `, [req.user.id, q.question || q.question_text, q.category || 'general', q.type || 'text', JSON.stringify(q.options || [])]);
      saved.push(result.rows[0]);
    }

    res.json({ success: true, questions: saved });
  } catch (err) {
    console.error('Save question bank error:', err);
    res.status(500).json({ error: 'Failed to save questions' });
  }
});

// Get recruiter's question bank
router.get('/question-bank', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const questions = await pool.query(`
      SELECT * FROM question_bank WHERE recruiter_id = $1 ORDER BY usage_count DESC, created_at DESC
    `, [req.user.id]);
    res.json({ success: true, questions: questions.rows });
  } catch (err) {
    console.error('Get question bank error:', err);
    res.status(500).json({ error: 'Failed to get question bank' });
  }
});

// ============= OFFER MANAGEMENT =============

// Create an offer
router.post('/offers', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const {
      candidate_id, job_id, title, salary, start_date,
      benefits, location, employment_type, reporting_to
    } = req.body;

    if (!candidate_id || !job_id) {
      return res.status(400).json({ error: 'candidate_id and job_id are required' });
    }

    // Verify job belongs to company
    const job = await pool.query(
      'SELECT id, title, company FROM jobs WHERE id = $1 AND (company_id = $2 OR user_id = $3)',
      [job_id, req.user.company_id, req.user.id]
    );
    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Verify candidate has applied
    const application = await pool.query(
      'SELECT id FROM job_applications WHERE job_id = $1 AND candidate_id = $2',
      [job_id, candidate_id]
    );
    if (application.rows.length === 0) {
      return res.status(400).json({ error: 'Candidate has not applied to this job' });
    }

    const result = await pool.query(
      `INSERT INTO offers (
        candidate_id, job_id, recruiter_id, company_id,
        title, company_name, salary, start_date,
        benefits, location, employment_type, reporting_to,
        status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', NOW(), NOW())
      RETURNING *`,
      [
        candidate_id, job_id, req.user.id, req.user.company_id,
        title || job.rows[0].title, req.user.company_name || job.rows[0].company,
        salary || null, start_date || null,
        benefits || null, location || null,
        employment_type || 'full-time', reporting_to || null
      ]
    );

    res.json({ success: true, offer: result.rows[0] });
  } catch (err) {
    console.error('Create offer error:', err);
    res.status(500).json({ error: 'Failed to create offer' });
  }
});

// List offers for company
router.get('/offers', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { status, job_id, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT o.*,
             u.name as candidate_name, u.email as candidate_email,
             j.title as job_title
      FROM offers o
      JOIN users u ON o.candidate_id = u.id
      LEFT JOIN jobs j ON o.job_id = j.id
      WHERE o.company_id = $1
    `;
    const params = [req.user.company_id];

    if (status) {
      query += ` AND o.status = $${params.length + 1}`;
      params.push(status);
    }
    if (job_id) {
      query += ` AND o.job_id = $${params.length + 1}`;
      params.push(job_id);
    }

    query += ` ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);
    res.json({ success: true, offers: result.rows });
  } catch (err) {
    console.error('List offers error:', err);
    res.status(500).json({ error: 'Failed to fetch offers' });
  }
});

// Get single offer
router.get('/offers/:id', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*,
             u.name as candidate_name, u.email as candidate_email,
             j.title as job_title, j.description as job_description
      FROM offers o
      JOIN users u ON o.candidate_id = u.id
      LEFT JOIN jobs j ON o.job_id = j.id
      WHERE o.id = $1 AND o.company_id = $2
    `, [req.params.id, req.user.company_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    res.json({ success: true, offer: result.rows[0] });
  } catch (err) {
    console.error('Get offer error:', err);
    res.status(500).json({ error: 'Failed to fetch offer' });
  }
});

// Update offer (edit draft or add details)
router.put('/offers/:id', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const {
      title, salary, start_date, benefits, location,
      employment_type, reporting_to, offer_letter_html
    } = req.body;

    // Verify offer belongs to company
    const existing = await pool.query(
      'SELECT id, status FROM offers WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.company_id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    const result = await pool.query(
      `UPDATE offers SET
        title = COALESCE($1, title),
        salary = COALESCE($2, salary),
        start_date = COALESCE($3, start_date),
        benefits = COALESCE($4, benefits),
        location = COALESCE($5, location),
        employment_type = COALESCE($6, employment_type),
        reporting_to = COALESCE($7, reporting_to),
        offer_letter_html = COALESCE($8, offer_letter_html),
        offer_letter_generated_at = CASE WHEN $8 IS NOT NULL THEN NOW() ELSE offer_letter_generated_at END,
        updated_at = NOW()
      WHERE id = $9
      RETURNING *`,
      [title, salary, start_date, benefits, location,
       employment_type, reporting_to, offer_letter_html, req.params.id]
    );

    res.json({ success: true, offer: result.rows[0] });
  } catch (err) {
    console.error('Update offer error:', err);
    res.status(500).json({ error: 'Failed to update offer' });
  }
});

// Send offer to candidate (changes status from draft to sent)
router.put('/offers/:id/send', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const existing = await pool.query(
      'SELECT id, status, candidate_id, job_id FROM offers WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.company_id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }
    if (existing.rows[0].status !== 'draft') {
      return res.status(400).json({ error: `Cannot send offer with status: ${existing.rows[0].status}` });
    }

    const result = await pool.query(
      `UPDATE offers SET status = 'sent', sent_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    // Update application status to 'offered'
    await pool.query(
      `UPDATE job_applications SET status = 'offered', updated_at = NOW()
       WHERE job_id = $1 AND candidate_id = $2`,
      [existing.rows[0].job_id, existing.rows[0].candidate_id]
    );

    // Update job analytics
    try {
      await pool.query(
        'UPDATE job_analytics SET offers_made = COALESCE(offers_made, 0) + 1 WHERE job_id = $1',
        [existing.rows[0].job_id]
      );
    } catch (e) { /* non-critical */ }

    // Audit log
    await AuditLogger.log({
      actionType: 'offer_sent',
      userId: req.user.id,
      targetType: 'offer',
      targetId: parseInt(req.params.id),
      metadata: {
        candidate_id: existing.rows[0].candidate_id,
        job_id: existing.rows[0].job_id
      },
      req
    });

    res.json({ success: true, offer: result.rows[0] });
  } catch (err) {
    console.error('Send offer error:', err);
    res.status(500).json({ error: 'Failed to send offer' });
  }
});

// Withdraw/cancel offer (recruiter action)
router.put('/offers/:id/withdraw', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { reason } = req.body;

    const existing = await pool.query(
      'SELECT id, status FROM offers WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.company_id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }
    if (['accepted', 'declined'].includes(existing.rows[0].status)) {
      return res.status(400).json({ error: `Cannot withdraw an ${existing.rows[0].status} offer` });
    }

    const result = await pool.query(
      `UPDATE offers SET status = 'withdrawn', decline_reason = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, reason || 'Withdrawn by recruiter']
    );

    res.json({ success: true, offer: result.rows[0] });
  } catch (err) {
    console.error('Withdraw offer error:', err);
    res.status(500).json({ error: 'Failed to withdraw offer' });
  }
});

module.exports = router;
