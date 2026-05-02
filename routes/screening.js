/**
 * Recruiter Screening Routes
 * AI-powered candidate screening for recruiters
 */

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../lib/auth');
const screener = require('../lib/recruiter-screener');
const pool = require('../lib/db');

/**
 * POST /api/screening/analyze
 * Screen a single candidate against a job
 * 
 * Body: { candidate_id, job_id }
 * Returns: { fit_score, recommendation, screening_questions, ... }
 */
router.post('/analyze', authMiddleware, async (req, res) => {
  try {
    const { candidate_id, job_id } = req.body;
    
    if (!candidate_id || !job_id) {
      return res.status(400).json({ error: 'candidate_id and job_id are required' });
    }
    
    // Verify recruiter owns this job
    const jobCheck = await pool.query(
      'SELECT * FROM jobs WHERE id = $1 AND company_id = (SELECT company_id FROM users WHERE id = $2)',
      [job_id, req.user.id]
    );
    
    if (jobCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this job' });
    }
    
    const job = jobCheck.rows[0];
    
    // Get candidate profile with all relevant data
    const candidateResult = await pool.query(`
      SELECT 
        u.id, u.name, u.email,
        cp.headline, cp.years_experience,
        (SELECT json_agg(json_build_object('name', skill, 'level', level)) 
         FROM candidate_skills WHERE user_id = u.id) as skills,
        (SELECT json_agg(json_build_object('degree', degree, 'field', field_of_study, 'institution', institution))
         FROM education WHERE user_id = u.id) as education,
        (SELECT json_agg(json_build_object('title', title, 'company', company_name, 'start_date', start_date, 'end_date', end_date))
         FROM work_experience WHERE user_id = u.id) as experience,
        (SELECT score FROM omni_scores WHERE user_id = u.id ORDER BY calculated_at DESC LIMIT 1) as omni_score,
        (SELECT json_agg(json_build_object('skill', skill_name, 'score', score))
         FROM assessment_results WHERE user_id = u.id AND score IS NOT NULL) as assessment_scores,
        (SELECT AVG(score)::decimal(3,1) FROM interview_evaluations WHERE candidate_id = u.id) as interview_avg_score
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      WHERE u.id = $1
    `, [candidate_id]);
    
    if (candidateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    
    const candidate = candidateResult.rows[0];
    
    // Parse job skills from JSONB
    const jobData = {
      ...job,
      required_skills: job.required_skills || [],
      preferred_skills: job.preferred_skills || [],
      min_years: job.min_years_experience || 0,
    };
    
    // Run AI screening
    const screeningResult = await screener.screenCandidate(candidate, jobData, {
      subscriptionId: req.user.id,
    });
    
    // Store screening result
    await pool.query(`
      INSERT INTO job_application_screenings (application_id, candidate_id, job_id, fit_score, recommendation, screening_data, screened_by, screened_at)
      VALUES (
        (SELECT id FROM job_applications WHERE candidate_id = $1 AND job_id = $2 LIMIT 1),
        $1, $2, $3, $4, $5, $6, NOW()
      )
      ON CONFLICT (application_id) DO UPDATE SET
        fit_score = $3,
        recommendation = $4,
        screening_data = $5,
        screened_by = $6,
        screened_at = NOW()
    `, [candidate_id, job_id, screeningResult.fit_score, screeningResult.recommendation, 
        JSON.stringify(screeningResult), req.user.id]);
    
    res.json({
      success: true,
      candidate: {
        id: candidate.id,
        name: candidate.name,
        omni_score: candidate.omni_score,
      },
      job: {
        id: job.id,
        title: job.title,
      },
      screening: screeningResult,
    });
    
  } catch (err) {
    console.error('[screening] Error:', err);
    res.status(500).json({ error: 'Screening failed', message: err.message });
  }
});

/**
 * POST /api/screening/batch
 * Screen all candidates for a job (batch processing)
 * 
 * Body: { job_id }
 * Returns: { screenings: [{ candidate, fit_score, recommendation }, ...] }
 */
router.post('/batch', authMiddleware, async (req, res) => {
  try {
    const { job_id } = req.body;
    
    if (!job_id) {
      return res.status(400).json({ error: 'job_id is required' });
    }
    
    // Verify recruiter owns this job
    const jobCheck = await pool.query(
      'SELECT * FROM jobs WHERE id = $1 AND company_id = (SELECT company_id FROM users WHERE id = $2)',
      [job_id, req.user.id]
    );
    
    if (jobCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this job' });
    }
    
    const job = jobCheck.rows[0];
    
    // Get all candidates who applied
    const candidatesResult = await pool.query(`
      SELECT 
        u.id, u.name, u.email,
        cp.years_experience,
        (SELECT json_agg(json_build_object('name', skill, 'level', level)) 
         FROM candidate_skills WHERE user_id = u.id) as skills,
        (SELECT score FROM omni_scores WHERE user_id = u.id ORDER BY calculated_at DESC LIMIT 1) as omni_score,
        ja.id as application_id
      FROM job_applications ja
      JOIN users u ON u.id = ja.candidate_id
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      WHERE ja.job_id = $1 AND ja.status != 'rejected'
      ORDER BY ja.applied_at DESC
    `, [job_id]);
    
    const candidates = candidatesResult.rows;
    
    if (candidates.length === 0) {
      return res.json({ success: true, screenings: [], message: 'No candidates to screen' });
    }
    
    // Batch screening
    const screenings = await screener.screenCandidatesBatch(candidates, job, {
      subscriptionId: req.user.id,
    });
    
    // Combine with candidate info
    const results = screenings.map((s, i) => ({
      candidate: {
        id: candidates[i].id,
        name: candidates[i].name,
        omni_score: candidates[i].omni_score,
      },
      ...s,
    }));
    
    res.json({
      success: true,
      job: { id: job.id, title: job.title },
      screenings: results,
      total_candidates: candidates.length,
    });
    
  } catch (err) {
    console.error('[screening/batch] Error:', err);
    res.status(500).json({ error: 'Batch screening failed', message: err.message });
  }
});

/**
 * GET /api/screening/:job_id
 * Get all screening results for a job
 */
router.get('/:job_id', authMiddleware, async (req, res) => {
  try {
    const { job_id } = req.params;
    
    // Verify access
    const accessCheck = await pool.query(
      'SELECT id FROM jobs WHERE id = $1 AND company_id = (SELECT company_id FROM users WHERE id = $2)',
      [job_id, req.user.id]
    );
    
    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const results = await pool.query(`
      SELECT 
        jas.*,
        u.name as candidate_name,
        u.email as candidate_email,
        os.score as omni_score
      FROM job_application_screenings jas
      JOIN users u ON u.id = jas.candidate_id
      LEFT JOIN omni_scores os ON os.user_id = u.id
      WHERE jas.job_id = $1
      ORDER BY jas.fit_score DESC
    `, [job_id]);
    
    res.json({
      success: true,
      screenings: results.rows,
    });
    
  } catch (err) {
    console.error('[screening/get] Error:', err);
    res.status(500).json({ error: 'Failed to get screenings' });
  }
});

/**
 * POST /api/screening/questions
 * Generate tailored interview questions for a candidate/job
 */
router.post('/questions', authMiddleware, async (req, res) => {
  try {
    const { candidate_id, job_id } = req.body;
    
    // Get candidate and job data (simplified)
    const [candidate, job] = await Promise.all([
      pool.query('SELECT * FROM candidate_profiles WHERE user_id = $1', [candidate_id]),
      pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]),
    ]);
    
    if (!candidate.rows.length || !job.rows.length) {
      return res.status(404).json({ error: 'Candidate or job not found' });
    }
    
    const questions = await screener.generateTailoredInterviewQuestions(
      candidate.rows[0],
      job.rows[0]
    );
    
    res.json({
      success: true,
      questions,
    });
    
  } catch (err) {
    console.error('[screening/questions] Error:', err);
    res.status(500).json({ error: 'Failed to generate questions' });
  }
});

/**
 * POST /api/screening/compare
 * Compare two candidates for the same job
 */
router.post('/compare', authMiddleware, async (req, res) => {
  try {
    const { candidate1_id, candidate2_id, job_id } = req.body;
    
    // Get both candidates
    const candidates = await Promise.all([
      pool.query(`
        SELECT u.*, cp.years_experience, 
          (SELECT score FROM omni_scores WHERE user_id = u.id ORDER BY calculated_at DESC LIMIT 1) as omni_score,
          (SELECT json_agg(json_build_object('name', skill)) FROM candidate_skills WHERE user_id = u.id) as skills
        FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id WHERE u.id = $1
      `, [candidate1_id]),
      pool.query(`
        SELECT u.*, cp.years_experience,
          (SELECT score FROM omni_scores WHERE user_id = u.id ORDER BY calculated_at DESC LIMIT 1) as omni_score,
          (SELECT json_agg(json_build_object('name', skill)) FROM candidate_skills WHERE user_id = u.id) as skills
        FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id WHERE u.id = $1
      `, [candidate2_id]),
    ]);
    
    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
    
    if (!candidates[0].rows.length || !candidates[1].rows.length || !job.rows.length) {
      return res.status(404).json({ error: 'Candidate(s) or job not found' });
    }
    
    const comparison = await screener.compareCandidates(
      candidates[0].rows[0],
      candidates[1].rows[0],
      job.rows[0]
    );
    
    res.json({
      success: true,
      comparison,
    });
    
  } catch (err) {
    console.error('[screening/compare] Error:', err);
    res.status(500).json({ error: 'Comparison failed' });
  }
});

module.exports = router;
