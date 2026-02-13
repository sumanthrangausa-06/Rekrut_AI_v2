// Auto-Fill Service — "Fill it once, use it everywhere"
// Pulls stored data from profile, previous applications, screening answers
const pool = require('../lib/db');

/**
 * Get auto-fill data for a candidate's application form
 * Returns all known data points that can pre-populate forms
 */
async function getCandidateAutoFill(userId) {
  try {
    // 1. Get profile data
    const profileResult = await pool.query(`
      SELECT cp.*, u.name, u.email
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      WHERE u.id = $1
    `, [userId]);
    const profile = profileResult.rows[0] || {};

    // 2. Get latest experience
    const expResult = await pool.query(
      'SELECT * FROM work_experience WHERE user_id = $1 ORDER BY is_current DESC, start_date DESC LIMIT 5',
      [userId]
    );

    // 3. Get skills
    const skillsResult = await pool.query(
      'SELECT skill_name, level, category FROM candidate_skills WHERE user_id = $1 ORDER BY level DESC',
      [userId]
    );

    // 4. Get education
    const eduResult = await pool.query(
      'SELECT * FROM education WHERE user_id = $1 ORDER BY start_date DESC LIMIT 3',
      [userId]
    );

    // 5. Get previous screening answers for reuse
    const answersResult = await pool.query(`
      SELECT sa.question_text, sa.answer_text, sa.reuse_count, sa.updated_at
      FROM screening_answers sa
      WHERE sa.user_id = $1
      ORDER BY sa.reuse_count DESC, sa.updated_at DESC
    `, [userId]);

    // 6. Get recent application data for pattern detection
    const recentApps = await pool.query(`
      SELECT ja.cover_letter, ja.resume_url, j.title as job_title, j.company, j.job_type
      FROM job_applications ja
      JOIN jobs j ON ja.job_id = j.id
      WHERE ja.candidate_id = $1
      ORDER BY ja.applied_at DESC
      LIMIT 3
    `, [userId]);

    return {
      profile: {
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        location: profile.location,
        headline: profile.headline,
        bio: profile.bio,
        linkedin_url: profile.linkedin_url,
        github_url: profile.github_url,
        portfolio_url: profile.portfolio_url,
        resume_url: profile.resume_url,
        years_experience: profile.years_experience,
        salary_min: profile.salary_min,
        salary_max: profile.salary_max,
        remote_preference: profile.remote_preference,
        availability: profile.availability,
        work_authorization: profile.work_authorization,
        notice_period: profile.notice_period,
        willing_to_relocate: profile.willing_to_relocate,
        cover_letter_template: profile.cover_letter_template
      },
      experience: expResult.rows,
      skills: skillsResult.rows,
      education: eduResult.rows,
      screening_answers: answersResult.rows.map(a => ({
        question: a.question_text,
        answer: a.answer_text,
        times_reused: a.reuse_count,
        last_used: a.updated_at
      })),
      recent_applications: recentApps.rows,
      completeness: calculateCompleteness(profile, skillsResult.rows, expResult.rows, eduResult.rows)
    };
  } catch (err) {
    console.error('Get candidate autofill error:', err.message);
    return { profile: {}, experience: [], skills: [], education: [], screening_answers: [], recent_applications: [], completeness: 0 };
  }
}

/**
 * Get auto-fill data for a recruiter's job posting form
 */
async function getRecruiterAutoFill(userId) {
  try {
    // 1. Get recruiter preferences
    const prefsResult = await pool.query(
      'SELECT * FROM recruiter_preferences WHERE user_id = $1',
      [userId]
    );
    const prefs = prefsResult.rows[0] || {};

    // 2. Get most recent job postings as templates
    const recentJobs = await pool.query(`
      SELECT title, description, requirements, location, salary_range, salary_min, salary_max,
             job_type, company, status,
             created_at
      FROM jobs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 5
    `, [userId]);

    // 3. Get question bank
    const questionsResult = await pool.query(`
      SELECT id, question_text, question_type, category, options, usage_count
      FROM question_bank
      WHERE recruiter_id = $1
      ORDER BY usage_count DESC, created_at DESC
    `, [userId]);

    // 4. Get company info
    const companyResult = await pool.query(`
      SELECT c.name, c.description, c.industry, c.company_size, c.website, c.headquarters, c.benefits
      FROM companies c
      JOIN users u ON u.company_id = c.id
      WHERE u.id = $1
    `, [userId]);

    return {
      preferences: {
        default_template: prefs.default_job_template || {},
        common_requirements: prefs.common_requirements || [],
        score_weights: prefs.score_weights || { skills: 0.45, experience: 0.20, omniscore: 0.25, trust: 0.10 }
      },
      recent_postings: recentJobs.rows,
      question_bank: questionsResult.rows,
      company: companyResult.rows[0] || {}
    };
  } catch (err) {
    console.error('Get recruiter autofill error:', err.message);
    return { preferences: {}, recent_postings: [], question_bank: [], company: {} };
  }
}

/**
 * Save screening answer for future reuse
 */
async function saveScreeningAnswer(userId, { questionId, questionText, answerText, jobId, applicationId }) {
  try {
    await pool.query(`
      INSERT INTO screening_answers (user_id, question_id, question_text, answer_text, job_id, application_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, question_text) WHERE question_text IS NOT NULL
      DO UPDATE SET
        answer_text = EXCLUDED.answer_text,
        reuse_count = screening_answers.reuse_count + 1,
        updated_at = NOW()
    `, [userId, questionId, questionText, answerText, jobId, applicationId]);
    return true;
  } catch (err) {
    console.error('Save screening answer error:', err.message);
    return false;
  }
}

/**
 * Save recruiter preferences from their posting patterns
 */
async function updateRecruiterPreferences(userId, updates) {
  try {
    await pool.query(`
      INSERT INTO recruiter_preferences (user_id, default_job_template, common_requirements, posting_patterns, score_weights)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id) DO UPDATE SET
        default_job_template = COALESCE($2, recruiter_preferences.default_job_template),
        common_requirements = COALESCE($3, recruiter_preferences.common_requirements),
        posting_patterns = COALESCE($4, recruiter_preferences.posting_patterns),
        score_weights = COALESCE($5, recruiter_preferences.score_weights),
        updated_at = NOW()
    `, [
      userId,
      JSON.stringify(updates.default_template || {}),
      JSON.stringify(updates.common_requirements || []),
      JSON.stringify(updates.posting_patterns || {}),
      JSON.stringify(updates.score_weights || { skills: 0.45, experience: 0.20, omniscore: 0.25, trust: 0.10 })
    ]);
    return true;
  } catch (err) {
    console.error('Update recruiter preferences error:', err.message);
    return false;
  }
}

/**
 * Calculate profile completeness percentage
 */
function calculateCompleteness(profile, skills, experience, education) {
  let total = 0;
  let filled = 0;

  const checks = [
    ['name', profile.name],
    ['email', profile.email],
    ['phone', profile.phone],
    ['location', profile.location],
    ['headline', profile.headline],
    ['bio', profile.bio],
    ['resume', profile.resume_url],
    ['linkedin', profile.linkedin_url],
    ['years_experience', profile.years_experience],
    ['salary', profile.salary_min || profile.salary_max],
    ['skills', skills && skills.length > 0],
    ['experience', experience && experience.length > 0],
    ['education', education && education.length > 0],
    ['availability', profile.availability],
    ['remote_preference', profile.remote_preference]
  ];

  for (const [, value] of checks) {
    total++;
    if (value) filled++;
  }

  return Math.round((filled / total) * 100);
}

module.exports = {
  getCandidateAutoFill,
  getRecruiterAutoFill,
  saveScreeningAnswer,
  updateRecruiterPreferences,
  calculateCompleteness
};
