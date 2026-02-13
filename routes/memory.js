// AI Memory + Auto-Fill + Screening Answer Routes
const express = require('express');
const { authMiddleware } = require('../lib/auth');
const memoryService = require('../services/memory-service');
const autofillService = require('../services/autofill-service');
const pool = require('../lib/db');

const router = express.Router();

// ============================================================
// AUTO-FILL ENDPOINTS
// ============================================================

// Get auto-fill data for candidate application forms
router.get('/autofill/candidate', authMiddleware, async (req, res) => {
  try {
    const data = await autofillService.getCandidateAutoFill(req.user.id);
    res.json({ success: true, autofill: data });
  } catch (err) {
    console.error('Candidate autofill error:', err);
    res.status(500).json({ error: 'Failed to get autofill data' });
  }
});

// Get auto-fill data for recruiter job posting forms
router.get('/autofill/recruiter', authMiddleware, async (req, res) => {
  try {
    if (!['recruiter', 'hiring_manager', 'employer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }
    const data = await autofillService.getRecruiterAutoFill(req.user.id);
    res.json({ success: true, autofill: data });
  } catch (err) {
    console.error('Recruiter autofill error:', err);
    res.status(500).json({ error: 'Failed to get autofill data' });
  }
});

// ============================================================
// SCREENING ANSWERS
// ============================================================

// Get candidate's saved screening answers
router.get('/screening-answers', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sa.id, sa.question_text, sa.answer_text, sa.reuse_count, sa.updated_at,
             qb.category, qb.question_type
      FROM screening_answers sa
      LEFT JOIN question_bank qb ON sa.question_id = qb.id
      WHERE sa.user_id = $1
      ORDER BY sa.reuse_count DESC, sa.updated_at DESC
    `, [req.user.id]);

    res.json({ success: true, answers: result.rows });
  } catch (err) {
    console.error('Get screening answers error:', err);
    res.status(500).json({ error: 'Failed to get screening answers' });
  }
});

// Save a screening answer
router.post('/screening-answers', authMiddleware, async (req, res) => {
  try {
    const { question_id, question_text, answer_text, job_id } = req.body;
    if (!question_text || !answer_text) {
      return res.status(400).json({ error: 'question_text and answer_text required' });
    }

    await autofillService.saveScreeningAnswer(req.user.id, {
      questionId: question_id,
      questionText: question_text,
      answerText: answer_text,
      jobId: job_id
    });

    // Also extract memory from the answer
    await memoryService.addMemory(req.user.id, {
      type: 'observation',
      key: `screening_${question_text.substring(0, 50).replace(/\s+/g, '_').toLowerCase()}`,
      value: `Q: ${question_text.substring(0, 100)} → A: ${answer_text.substring(0, 200)}`,
      source: 'screening_answer'
    });

    res.json({ success: true, message: 'Answer saved for future reuse' });
  } catch (err) {
    console.error('Save screening answer error:', err);
    res.status(500).json({ error: 'Failed to save screening answer' });
  }
});

// ============================================================
// AI MEMORY ENDPOINTS
// ============================================================

// Get user's AI memory context
router.get('/memories', authMiddleware, async (req, res) => {
  try {
    const { type, limit = 30 } = req.query;
    const memories = await memoryService.getMemories(req.user.id, { type, limit: parseInt(limit) });
    res.json({ success: true, memories });
  } catch (err) {
    console.error('Get memories error:', err);
    res.status(500).json({ error: 'Failed to get memories' });
  }
});

// Get memory context as AI prompt (for internal use)
router.get('/memory-context', authMiddleware, async (req, res) => {
  try {
    const context = await memoryService.buildMemoryContext(req.user.id);
    res.json({ success: true, context });
  } catch (err) {
    console.error('Get memory context error:', err);
    res.status(500).json({ error: 'Failed to build memory context' });
  }
});

// ============================================================
// RECRUITER QUESTION BANK
// ============================================================

// Get recruiter's question bank
router.get('/question-bank', authMiddleware, async (req, res) => {
  try {
    if (!['recruiter', 'hiring_manager', 'employer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    const { category } = req.query;
    let query = `
      SELECT id, question_text, question_type, category, options, usage_count, created_at
      FROM question_bank
      WHERE recruiter_id = $1
    `;
    const params = [req.user.id];

    if (category) {
      query += ` AND category = $2`;
      params.push(category);
    }

    query += ` ORDER BY usage_count DESC, created_at DESC`;

    const result = await pool.query(query, params);
    res.json({ success: true, questions: result.rows });
  } catch (err) {
    console.error('Get question bank error:', err);
    res.status(500).json({ error: 'Failed to get question bank' });
  }
});

// Add question to bank
router.post('/question-bank', authMiddleware, async (req, res) => {
  try {
    if (!['recruiter', 'hiring_manager', 'employer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    const { question_text, question_type = 'text', category = 'general', options = [] } = req.body;
    if (!question_text) {
      return res.status(400).json({ error: 'question_text is required' });
    }

    const result = await pool.query(`
      INSERT INTO question_bank (question_text, question_type, category, options, recruiter_id, usage_count)
      VALUES ($1, $2, $3, $4, $5, 0)
      ON CONFLICT (recruiter_id, question_text) WHERE recruiter_id IS NOT NULL
      DO UPDATE SET
        question_type = EXCLUDED.question_type,
        category = EXCLUDED.category,
        options = EXCLUDED.options
      RETURNING *
    `, [question_text, question_type, category, JSON.stringify(options), req.user.id]);

    // Store in memory as recruiter pattern
    await memoryService.addMemory(req.user.id, {
      type: 'recruiter_pattern',
      key: `question_bank_${category}`,
      value: `Added screening question in ${category}: "${question_text.substring(0, 80)}"`,
      source: 'question_bank'
    });

    res.json({ success: true, question: result.rows[0] });
  } catch (err) {
    console.error('Add question error:', err);
    res.status(500).json({ error: 'Failed to add question' });
  }
});

// Delete question from bank
router.delete('/question-bank/:id', authMiddleware, async (req, res) => {
  try {
    if (!['recruiter', 'hiring_manager', 'employer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    await pool.query(
      'DELETE FROM question_bank WHERE id = $1 AND recruiter_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Delete question error:', err);
    res.status(500).json({ error: 'Failed to delete question' });
  }
});

// ============================================================
// RECRUITER PREFERENCES
// ============================================================

// Get recruiter preferences
router.get('/recruiter-preferences', authMiddleware, async (req, res) => {
  try {
    if (!['recruiter', 'hiring_manager', 'employer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    const result = await pool.query(
      'SELECT * FROM recruiter_preferences WHERE user_id = $1',
      [req.user.id]
    );
    res.json({ success: true, preferences: result.rows[0] || {} });
  } catch (err) {
    console.error('Get preferences error:', err);
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

// Update recruiter preferences
router.put('/recruiter-preferences', authMiddleware, async (req, res) => {
  try {
    if (!['recruiter', 'hiring_manager', 'employer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    await autofillService.updateRecruiterPreferences(req.user.id, req.body);
    res.json({ success: true, message: 'Preferences updated' });
  } catch (err) {
    console.error('Update preferences error:', err);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// ============================================================
// RECRUITER FEEDBACK ON CANDIDATES
// ============================================================

// Give feedback on a candidate (thumbs up/down)
router.post('/recruiter-feedback', authMiddleware, async (req, res) => {
  try {
    if (!['recruiter', 'hiring_manager', 'employer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    const { candidate_id, job_id, feedback_type, notes } = req.body;
    if (!candidate_id || !feedback_type) {
      return res.status(400).json({ error: 'candidate_id and feedback_type required' });
    }

    if (!['positive', 'negative', 'neutral'].includes(feedback_type)) {
      return res.status(400).json({ error: 'feedback_type must be positive, negative, or neutral' });
    }

    const result = await pool.query(`
      INSERT INTO recruiter_feedback (recruiter_id, candidate_id, job_id, feedback_type, notes)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (recruiter_id, candidate_id, job_id) DO UPDATE SET
        feedback_type = EXCLUDED.feedback_type,
        notes = EXCLUDED.notes,
        created_at = NOW()
      RETURNING *
    `, [req.user.id, candidate_id, job_id || null, feedback_type, notes || null]);

    // Store in memory
    await memoryService.extractFromRecruiterAction(req.user.id, {
      type: 'candidate_feedback',
      feedback_type,
      job_title: 'position'
    });

    // Trigger OmniScore recalculation for the candidate
    try {
      const omniscoreService = require('../services/omniscore');
      if (feedback_type === 'positive') {
        await omniscoreService.addBehaviorComponent(candidate_id, 'recruiter_positive_feedback', 8, 10);
      } else if (feedback_type === 'negative') {
        await omniscoreService.addBehaviorComponent(candidate_id, 'recruiter_negative_feedback', -3, 10);
      }
    } catch (e) {
      console.warn('OmniScore recalc after feedback failed:', e.message);
    }

    res.json({ success: true, feedback: result.rows[0] });
  } catch (err) {
    console.error('Recruiter feedback error:', err);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// ============================================================
// ENHANCED MATCH RESULTS WITH ALL DIMENSIONS
// ============================================================

// Get detailed match breakdown for a candidate-job pair
router.get('/match-breakdown/:candidateId/:jobId', authMiddleware, async (req, res) => {
  try {
    const candidateId = parseInt(req.params.candidateId);
    const jobId = parseInt(req.params.jobId);

    // Auth check: candidates can only see their own
    if (req.user.role === 'candidate' && req.user.id !== candidateId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Get existing match result
    const matchResult = await pool.query(
      'SELECT * FROM match_results WHERE candidate_id = $1 AND job_id = $2',
      [candidateId, jobId]
    );

    // Get candidate profile
    const profileResult = await pool.query(`
      SELECT cp.*, u.name, u.email
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      WHERE u.id = $1
    `, [candidateId]);
    const profile = profileResult.rows[0] || {};

    // Get job details
    const jobResult = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    const job = jobResult.rows[0] || {};

    // Get candidate skills
    const skillsResult = await pool.query(
      'SELECT skill_name, level FROM candidate_skills WHERE user_id = $1',
      [candidateId]
    );

    // Get candidate experience
    const expResult = await pool.query(
      'SELECT title, company_name, start_date, end_date, is_current FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC',
      [candidateId]
    );

    // Get education
    const eduResult = await pool.query(
      'SELECT degree, field_of_study, institution FROM education WHERE user_id = $1',
      [candidateId]
    );

    // Get OmniScore
    const omniResult = await pool.query(
      'SELECT * FROM omni_scores WHERE user_id = $1',
      [candidateId]
    );
    const omni = omniResult.rows[0] || {};

    // Get interview scores if any (from interviews table, not interview_analysis)
    const interviewResult = await pool.query(`
      SELECT AVG(i.overall_score) as avg_interview_score, COUNT(*) as interview_count
      FROM interviews i
      WHERE i.user_id = $1 AND i.overall_score IS NOT NULL
    `, [candidateId]);

    // Get assessment scores if any
    const assessmentResult = await pool.query(`
      SELECT AVG(score) as avg_assessment_score, COUNT(*) as assessment_count
      FROM dynamic_assessments
      WHERE user_id = $1 AND status = 'completed'
    `, [candidateId]);

    // Calculate dimension scores
    const totalYears = profile.years_experience || 0;
    const jobMinYears = job.min_experience || 0;
    const experienceScore = jobMinYears > 0
      ? Math.min(100, Math.round((totalYears / jobMinYears) * 100))
      : (totalYears > 0 ? 75 : 50);

    const salaryFit = calculateSalaryFit(profile, job);
    const locationFit = calculateLocationFit(profile, job);
    const educationScore = eduResult.rows.length > 0 ? 70 + Math.min(30, eduResult.rows.length * 10) : 40;

    const interviewScore = interviewResult.rows[0]?.avg_interview_score
      ? Math.round(interviewResult.rows[0].avg_interview_score * 10)
      : null;

    const assessmentScore = assessmentResult.rows[0]?.avg_assessment_score
      ? Math.round(assessmentResult.rows[0].avg_assessment_score)
      : null;

    const match = matchResult.rows[0] || {};

    const breakdown = {
      overall_score: match.weighted_score || 0,
      match_level: match.match_level || 'none',
      dimensions: {
        skills: {
          score: match.weighted_score ? Math.round((JSON.parse(match.matching_skills || '[]').length / Math.max(1, JSON.parse(match.matching_skills || '[]').length + JSON.parse(match.missing_skills || '[]').length)) * 100) : 50,
          label: 'Skills Match',
          matching: JSON.parse(match.matching_skills || '[]'),
          missing: JSON.parse(match.missing_skills || '[]'),
          weight: 0.30
        },
        experience: {
          score: experienceScore,
          label: 'Experience',
          detail: `${totalYears} years (${jobMinYears > 0 ? `${jobMinYears}+ required` : 'no minimum'})`,
          weight: 0.20
        },
        education: {
          score: educationScore,
          label: 'Education',
          detail: eduResult.rows.map(e => `${e.degree || ''} ${e.field_of_study || ''}`).join(', ') || 'Not specified',
          weight: 0.10
        },
        salary_fit: {
          score: salaryFit,
          label: 'Salary Fit',
          detail: formatSalaryFitDetail(profile, job),
          weight: 0.10
        },
        location: {
          score: locationFit,
          label: 'Location Fit',
          detail: `${profile.location || 'Not specified'} → ${job.location || 'Not specified'}`,
          weight: 0.10
        },
        interview_performance: {
          score: interviewScore,
          label: 'Interview Performance',
          detail: interviewScore !== null
            ? `${interviewResult.rows[0].interview_count} interviews, avg ${interviewScore}%`
            : 'No interviews yet',
          weight: 0.10,
          available: interviewScore !== null
        },
        assessments: {
          score: assessmentScore,
          label: 'Assessments',
          detail: assessmentScore !== null
            ? `${assessmentResult.rows[0].assessment_count} completed, avg ${assessmentScore}%`
            : 'No assessments yet',
          weight: 0.10,
          available: assessmentScore !== null
        }
      },
      omniscore: {
        total: omni.total_score || 300,
        tier: omni.score_tier || 'new',
        interview: omni.interview_score || 0,
        technical: omni.technical_score || 0,
        resume: omni.resume_score || 0,
        behavior: omni.behavior_score || 0
      },
      profile_completeness: autofillService_calculateCompleteness(profile, skillsResult.rows, expResult.rows, eduResult.rows),
      improvement_tips: generateImprovementTips(match, interviewScore, assessmentScore, profile)
    };

    res.json({ success: true, breakdown });
  } catch (err) {
    console.error('Match breakdown error:', err);
    res.status(500).json({ error: 'Failed to get match breakdown' });
  }
});

// ============================================================
// OMNISCORE TREND
// ============================================================

// Get OmniScore trend for charts
router.get('/omniscore-trend', authMiddleware, async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const result = await pool.query(`
      SELECT new_score as score, change_amount, change_reason, component_type, created_at
      FROM score_history
      WHERE user_id = $1
        AND created_at > NOW() - INTERVAL '1 day' * $2
      ORDER BY created_at ASC
    `, [req.user.id, parseInt(days)]);

    // Also get current score
    const currentResult = await pool.query(
      'SELECT total_score, score_tier, last_updated FROM omni_scores WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      success: true,
      current: currentResult.rows[0] || { total_score: 300, score_tier: 'new' },
      history: result.rows,
      period_days: parseInt(days)
    });
  } catch (err) {
    console.error('OmniScore trend error:', err);
    res.status(500).json({ error: 'Failed to get OmniScore trend' });
  }
});

// ============================================================
// HELPERS
// ============================================================

function calculateSalaryFit(profile, job) {
  const candMin = profile.salary_min;
  const candMax = profile.salary_max;
  const jobMin = job.salary_min;
  const jobMax = job.salary_max;

  if (!candMin && !candMax) return 70; // Unknown = neutral
  if (!jobMin && !jobMax) return 70;

  const candMid = ((candMin || 0) + (candMax || candMin || 0)) / 2;
  const jobMid = ((jobMin || 0) + (jobMax || jobMin || 0)) / 2;

  if (jobMid === 0) return 70;

  const overlap = 1 - Math.abs(candMid - jobMid) / Math.max(candMid, jobMid);
  return Math.max(20, Math.min(100, Math.round(overlap * 100)));
}

function formatSalaryFitDetail(profile, job) {
  const candRange = profile.salary_min || profile.salary_max
    ? `$${(profile.salary_min || 0).toLocaleString()}-$${(profile.salary_max || 0).toLocaleString()}`
    : 'Not specified';
  const jobRange = job.salary_min || job.salary_max
    ? `$${(job.salary_min || 0).toLocaleString()}-$${(job.salary_max || 0).toLocaleString()}`
    : job.salary_range || 'Not specified';
  return `Your range: ${candRange} | Job: ${jobRange}`;
}

function calculateLocationFit(profile, job) {
  if (!profile.location || !job.location) return 70;
  if (job.location.toLowerCase().includes('remote')) return 95;
  if (profile.remote_preference === 'remote' && !job.location.toLowerCase().includes('remote')) return 40;
  if (profile.location.toLowerCase().includes(job.location.toLowerCase()) ||
      job.location.toLowerCase().includes(profile.location.toLowerCase())) return 95;
  return 55;
}

function autofillService_calculateCompleteness(profile, skills, experience, education) {
  let total = 0, filled = 0;
  const checks = [
    profile.name, profile.email, profile.phone, profile.location,
    profile.headline, profile.bio, profile.resume_url, profile.linkedin_url,
    profile.years_experience, profile.salary_min || profile.salary_max,
    skills && skills.length > 0, experience && experience.length > 0,
    education && education.length > 0, profile.availability, profile.remote_preference
  ];
  for (const v of checks) { total++; if (v) filled++; }
  return Math.round((filled / total) * 100);
}

function generateImprovementTips(match, interviewScore, assessmentScore, profile) {
  const tips = [];
  const matchingSkills = JSON.parse(match.matching_skills || '[]');
  const missingSkills = JSON.parse(match.missing_skills || '[]');

  if (missingSkills.length > 0) {
    tips.push({
      type: 'skills',
      priority: 'high',
      tip: `Add ${missingSkills.slice(0, 3).join(', ')} to your profile to improve match score`
    });
  }

  if (interviewScore === null) {
    tips.push({
      type: 'interview',
      priority: 'medium',
      tip: 'Complete a mock interview to unlock interview performance scoring'
    });
  }

  if (assessmentScore === null) {
    tips.push({
      type: 'assessment',
      priority: 'medium',
      tip: 'Take a skill assessment to validate your expertise'
    });
  }

  if (!profile.bio) {
    tips.push({
      type: 'profile',
      priority: 'low',
      tip: 'Add a professional bio to improve your profile match'
    });
  }

  return tips;
}

module.exports = router;
