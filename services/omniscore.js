// OmniScore Service - Candidate Credit Score Calculation
const pool = require('../lib/db');

// Score ranges and tiers
const SCORE_RANGES = {
  MIN: 300,
  MAX: 850,
  TIERS: {
    exceptional: { min: 800, max: 850, label: 'Exceptional' },
    excellent: { min: 740, max: 799, label: 'Excellent' },
    good: { min: 670, max: 739, label: 'Good' },
    fair: { min: 580, max: 669, label: 'Fair' },
    needs_work: { min: 300, max: 579, label: 'Needs Work' }
  }
};

// Score component weights (total = 850 max)
const COMPONENT_WEIGHTS = {
  interview: { max: 200, weight: 0.24 },    // Interview performance
  technical: { max: 200, weight: 0.24 },    // Technical assessments
  resume: { max: 200, weight: 0.24 },       // Resume quality
  behavior: { max: 250, weight: 0.29 }      // Platform behavior & consistency
};

// Get or create OmniScore for a user
async function getOrCreateScore(userId) {
  const existing = await pool.query(
    'SELECT * FROM omni_scores WHERE user_id = $1',
    [userId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // Create new score entry
  const result = await pool.query(
    `INSERT INTO omni_scores (user_id, total_score, score_tier)
     VALUES ($1, $2, 'new')
     RETURNING *`,
    [userId, SCORE_RANGES.MIN]
  );

  return result.rows[0];
}

// Calculate total OmniScore from components
async function calculateScore(userId) {
  // Get all non-expired components with time decay applied
  const components = await pool.query(`
    SELECT component_type,
           SUM(points * POWER(decay_rate, EXTRACT(DAYS FROM NOW() - created_at) / 30)) as decayed_points,
           SUM(max_points) as max_points
    FROM score_components
    WHERE user_id = $1
      AND (expires_at IS NULL OR expires_at > NOW())
    GROUP BY component_type
  `, [userId]);

  const scores = {
    interview: 0,
    technical: 0,
    resume: 0,
    behavior: 0
  };

  // Calculate each component score
  for (const comp of components.rows) {
    const type = comp.component_type;
    if (scores.hasOwnProperty(type)) {
      const maxForType = COMPONENT_WEIGHTS[type].max;
      const ratio = Math.min(1, comp.decayed_points / (comp.max_points || 1));
      scores[type] = Math.round(ratio * maxForType);
    }
  }

  // Calculate total (base 300 + components up to 550 more = 850 max)
  const componentTotal = scores.interview + scores.technical + scores.resume + scores.behavior;
  const total = Math.min(SCORE_RANGES.MAX, SCORE_RANGES.MIN + componentTotal);

  // Determine tier
  let tier = 'needs_work';
  for (const [key, range] of Object.entries(SCORE_RANGES.TIERS)) {
    if (total >= range.min && total <= range.max) {
      tier = key;
      break;
    }
  }

  // Update the score
  await pool.query(`
    UPDATE omni_scores SET
      total_score = $1,
      interview_score = $2,
      technical_score = $3,
      resume_score = $4,
      behavior_score = $5,
      score_tier = $6,
      last_updated = NOW()
    WHERE user_id = $7
  `, [total, scores.interview, scores.technical, scores.resume, scores.behavior, tier, userId]);

  return {
    total_score: total,
    ...scores,
    tier,
    tier_label: SCORE_RANGES.TIERS[tier]?.label || 'New'
  };
}

// Add score component from interview completion
async function addInterviewComponent(userId, interviewId, score, maxScore = 10) {
  // Convert 1-10 score to points (max 40 points per interview, up to 5 interviews = 200 max)
  const points = Math.round((score / maxScore) * 40);

  await pool.query(`
    INSERT INTO score_components (user_id, component_type, source_type, source_id, points, max_points)
    VALUES ($1, 'interview', 'interview', $2, $3, 40)
  `, [userId, interviewId, points]);

  // Record history
  const oldScore = await getOrCreateScore(userId);
  const newScoreData = await calculateScore(userId);

  await pool.query(`
    INSERT INTO score_history (user_id, previous_score, new_score, change_amount, change_reason, component_type)
    VALUES ($1, $2, $3, $4, $5, 'interview')
  `, [userId, oldScore.total_score, newScoreData.total_score, newScoreData.total_score - oldScore.total_score, 'Completed mock interview']);

  // Update role-specific score if job_title is provided
  return newScoreData;
}

// Add behavior component (for platform activity)
async function addBehaviorComponent(userId, reason, points, maxPoints = 10) {
  await pool.query(`
    INSERT INTO score_components (user_id, component_type, source_type, points, max_points, metadata)
    VALUES ($1, 'behavior', 'activity', $2, $3, $4)
  `, [userId, points, maxPoints, JSON.stringify({ reason })]);

  return await calculateScore(userId);
}

// Get score breakdown for display
async function getScoreBreakdown(userId) {
  const score = await getOrCreateScore(userId);

  // Get recent components
  const recentComponents = await pool.query(`
    SELECT component_type, source_type, points, max_points, created_at
    FROM score_components
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 20
  `, [userId]);

  // Get score history
  const history = await pool.query(`
    SELECT previous_score, new_score, change_amount, change_reason, created_at
    FROM score_history
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `, [userId]);

  // Calculate current scores with decay
  const currentScores = await calculateScore(userId);

  return {
    current: currentScores,
    breakdown: {
      interview: {
        score: currentScores.interview,
        max: COMPONENT_WEIGHTS.interview.max,
        label: 'Interview Performance',
        description: 'Based on your mock interview scores'
      },
      technical: {
        score: currentScores.technical,
        max: COMPONENT_WEIGHTS.technical.max,
        label: 'Technical Ability',
        description: 'Based on skill assessments'
      },
      resume: {
        score: currentScores.resume,
        max: COMPONENT_WEIGHTS.resume.max,
        label: 'Resume Quality',
        description: 'Based on resume analysis'
      },
      behavior: {
        score: currentScores.behavior,
        max: COMPONENT_WEIGHTS.behavior.max,
        label: 'Platform Activity',
        description: 'Based on consistent engagement'
      }
    },
    recent_activity: recentComponents.rows,
    history: history.rows,
    recommendations: generateRecommendations(currentScores)
  };
}

// Generate improvement recommendations
function generateRecommendations(scores) {
  const recommendations = [];

  if (scores.interview < COMPONENT_WEIGHTS.interview.max * 0.6) {
    recommendations.push({
      type: 'interview',
      priority: 'high',
      title: 'Complete More Mock Interviews',
      description: 'Your interview score could improve significantly. Complete 3-5 more mock interviews to boost your OmniScore.',
      potential_gain: Math.round(COMPONENT_WEIGHTS.interview.max * 0.3)
    });
  }

  if (scores.behavior < COMPONENT_WEIGHTS.behavior.max * 0.5) {
    recommendations.push({
      type: 'behavior',
      priority: 'medium',
      title: 'Stay Active on Platform',
      description: 'Regular activity boosts your score. Log in daily and complete at least one practice session per week.',
      potential_gain: Math.round(COMPONENT_WEIGHTS.behavior.max * 0.2)
    });
  }

  if (scores.technical < COMPONENT_WEIGHTS.technical.max * 0.5) {
    recommendations.push({
      type: 'technical',
      priority: 'medium',
      title: 'Take Skill Assessments',
      description: 'Complete role-specific skill assessments to prove your technical abilities.',
      potential_gain: Math.round(COMPONENT_WEIGHTS.technical.max * 0.4)
    });
  }

  return recommendations;
}

// Get role-specific scores
async function getRoleScores(userId) {
  const result = await pool.query(`
    SELECT role_name, score, interview_count, last_updated
    FROM role_scores
    WHERE user_id = $1
    ORDER BY score DESC
  `, [userId]);

  return result.rows;
}

// Update role-specific score
async function updateRoleScore(userId, roleName, interviewScore) {
  // Upsert role score
  const result = await pool.query(`
    INSERT INTO role_scores (user_id, role_name, score, interview_count)
    VALUES ($1, $2, $3, 1)
    ON CONFLICT (user_id, role_name) DO UPDATE SET
      score = GREATEST(role_scores.score, EXCLUDED.score),
      interview_count = role_scores.interview_count + 1,
      last_updated = NOW()
    RETURNING *
  `, [userId, roleName, SCORE_RANGES.MIN + Math.round((interviewScore / 10) * 550)]);

  return result.rows[0];
}

module.exports = {
  SCORE_RANGES,
  COMPONENT_WEIGHTS,
  getOrCreateScore,
  calculateScore,
  addInterviewComponent,
  addBehaviorComponent,
  getScoreBreakdown,
  generateRecommendations,
  getRoleScores,
  updateRoleScore
};
