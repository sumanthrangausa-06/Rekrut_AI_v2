// TrustScore Service - Employer Credit Score Calculation (0-1000)
const pool = require('../lib/db');

// Score ranges and tiers (0-1000 scale)
const TRUST_SCORE_RANGES = {
  MIN: 0,
  MAX: 1000,
  STARTING: 500,
  TIERS: {
    exceptional: { min: 900, max: 1000, label: 'Exceptional Employer', color: '#10b981' },
    excellent: { min: 800, max: 899, label: 'Excellent', color: '#34d399' },
    trusted: { min: 700, max: 799, label: 'Trusted', color: '#22c55e' },
    good: { min: 600, max: 699, label: 'Good', color: '#84cc16' },
    building: { min: 400, max: 599, label: 'Building Trust', color: '#eab308' },
    new: { min: 0, max: 399, label: 'New Employer', color: '#94a3b8' }
  }
};

// TrustScore component weights (total = 1000 max)
const TRUST_COMPONENTS = {
  verification: {
    max: 200,
    weight: 0.20,
    label: 'Company Verification',
    description: 'Email domain verification, LinkedIn, website confirmation'
  },
  job_authenticity: {
    max: 250,
    weight: 0.25,
    label: 'Job Authenticity',
    description: 'Complete job descriptions, realistic salary ranges, clear requirements'
  },
  hiring_ratio: {
    max: 250,
    weight: 0.25,
    label: 'Interview-to-Offer Ratio',
    description: 'Ratio of interviews conducted to offers made'
  },
  feedback: {
    max: 200,
    weight: 0.20,
    label: 'Candidate Feedback',
    description: 'Ratings from candidates who interviewed'
  },
  behavior: {
    max: 100,
    weight: 0.10,
    label: 'Platform Behavior',
    description: 'Response times, profile completeness, activity'
  }
};

// Get or create TrustScore for a company
async function getOrCreateTrustScore(companyId) {
  const existing = await pool.query(
    'SELECT * FROM trust_scores WHERE company_id = $1',
    [companyId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // Create new score entry with starting score
  const result = await pool.query(
    `INSERT INTO trust_scores (company_id, total_score, score_tier)
     VALUES ($1, $2, 'new')
     RETURNING *`,
    [companyId, TRUST_SCORE_RANGES.STARTING]
  );

  return result.rows[0];
}

// Calculate total TrustScore from components
async function calculateTrustScore(companyId) {
  // Get all components with time decay applied
  const components = await pool.query(`
    SELECT component_type,
           SUM(points * POWER(decay_rate, EXTRACT(DAYS FROM NOW() - created_at) / 30)) as decayed_points,
           SUM(max_points) as max_points
    FROM trust_score_components
    WHERE company_id = $1
      AND (expires_at IS NULL OR expires_at > NOW())
    GROUP BY component_type
  `, [companyId]);

  const scores = {
    verification: 0,
    job_authenticity: 0,
    hiring_ratio: 0,
    feedback: 0,
    behavior: 0
  };

  // Calculate each component score
  for (const comp of components.rows) {
    const type = comp.component_type;
    if (scores.hasOwnProperty(type)) {
      const maxForType = TRUST_COMPONENTS[type].max;
      const ratio = Math.min(1, comp.decayed_points / (comp.max_points || 1));
      scores[type] = Math.round(ratio * maxForType);
    }
  }

  // Calculate total
  const componentTotal = Object.values(scores).reduce((a, b) => a + b, 0);
  const total = Math.min(TRUST_SCORE_RANGES.MAX, componentTotal);

  // Determine tier
  let tier = 'new';
  for (const [key, range] of Object.entries(TRUST_SCORE_RANGES.TIERS)) {
    if (total >= range.min && total <= range.max) {
      tier = key;
      break;
    }
  }

  // Update the score
  await pool.query(`
    UPDATE trust_scores SET
      total_score = $1,
      verification_score = $2,
      job_authenticity_score = $3,
      hiring_ratio_score = $4,
      feedback_score = $5,
      behavior_score = $6,
      score_tier = $7,
      last_updated = NOW()
    WHERE company_id = $8
  `, [total, scores.verification, scores.job_authenticity, scores.hiring_ratio,
      scores.feedback, scores.behavior, tier, companyId]);

  return {
    total_score: total,
    ...scores,
    tier,
    tier_label: TRUST_SCORE_RANGES.TIERS[tier]?.label || 'New Employer',
    tier_color: TRUST_SCORE_RANGES.TIERS[tier]?.color || '#94a3b8'
  };
}

// Add verification component (email domain, company verification)
async function addVerificationComponent(companyId, verificationType, points, maxPoints = 50) {
  await pool.query(`
    INSERT INTO trust_score_components (company_id, component_type, source_type, points, max_points, metadata)
    VALUES ($1, 'verification', $2, $3, $4, $5)
  `, [companyId, verificationType, points, maxPoints, JSON.stringify({ type: verificationType })]);

  return await calculateTrustScore(companyId);
}

// Add job authenticity component (based on AI analysis of job posting)
async function addJobAuthenticityComponent(companyId, jobId, authenticityScore, maxScore = 100) {
  // Convert 0-100 score to points
  const points = Math.round((authenticityScore / maxScore) * 50);

  await pool.query(`
    INSERT INTO trust_score_components (company_id, component_type, source_type, source_id, points, max_points)
    VALUES ($1, 'job_authenticity', 'job_posting', $2, $3, 50)
  `, [companyId, jobId, points]);

  return await calculateTrustScore(companyId);
}

// Update hiring ratio component
async function updateHiringRatioScore(companyId) {
  // Get hiring stats
  const stats = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'interviewed') as interviews,
      COUNT(*) FILTER (WHERE status = 'offered') as offers,
      COUNT(*) FILTER (WHERE status = 'hired') as hires
    FROM job_applications
    WHERE company_id = $1
  `, [companyId]);

  const { interviews, offers, hires } = stats.rows[0];

  // Calculate ratio score (good ratio = more interviews lead to offers)
  let ratioScore = 0;
  if (interviews > 0) {
    const offerRate = offers / interviews;
    // Ideal offer rate is around 20-40%
    if (offerRate >= 0.2 && offerRate <= 0.5) {
      ratioScore = 80 + (offerRate * 40); // 80-100 range for ideal
    } else if (offerRate > 0.5) {
      ratioScore = 70; // Too many offers might indicate low standards
    } else {
      ratioScore = offerRate * 350; // 0-70 range
    }
  }

  // Clear old ratio components and add new
  await pool.query(`
    DELETE FROM trust_score_components
    WHERE company_id = $1 AND component_type = 'hiring_ratio'
  `, [companyId]);

  if (interviews > 0) {
    await pool.query(`
      INSERT INTO trust_score_components (company_id, component_type, source_type, points, max_points, metadata)
      VALUES ($1, 'hiring_ratio', 'calculated', $2, 100, $3)
    `, [companyId, Math.round(ratioScore), JSON.stringify({ interviews, offers, hires })]);
  }

  return await calculateTrustScore(companyId);
}

// Add candidate feedback component
async function addFeedbackComponent(companyId, feedbackId, overallRating) {
  // Convert 1-5 rating to points (max 40 points per feedback, up to 5 = 200 max)
  const points = Math.round((overallRating / 5) * 40);

  await pool.query(`
    INSERT INTO trust_score_components (company_id, component_type, source_type, source_id, points, max_points)
    VALUES ($1, 'feedback', 'candidate_feedback', $2, $3, 40)
  `, [companyId, feedbackId, points]);

  return await calculateTrustScore(companyId);
}

// Add behavior component (response times, activity)
async function addBehaviorComponent(companyId, behaviorType, points, maxPoints = 20) {
  await pool.query(`
    INSERT INTO trust_score_components (company_id, component_type, source_type, points, max_points, metadata)
    VALUES ($1, 'behavior', 'activity', $2, $3, $4)
  `, [companyId, points, maxPoints, JSON.stringify({ type: behaviorType })]);

  return await calculateTrustScore(companyId);
}

// Get detailed score breakdown
async function getTrustScoreBreakdown(companyId) {
  const score = await getOrCreateTrustScore(companyId);
  const currentScores = await calculateTrustScore(companyId);

  // Get recent components
  const recentComponents = await pool.query(`
    SELECT component_type, source_type, points, max_points, created_at
    FROM trust_score_components
    WHERE company_id = $1
    ORDER BY created_at DESC
    LIMIT 20
  `, [companyId]);

  // Get score history
  const history = await pool.query(`
    SELECT previous_score, new_score, change_amount, change_reason, created_at
    FROM trust_score_history
    WHERE company_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `, [companyId]);

  // Get hiring analytics
  const analytics = await pool.query(`
    SELECT
      COUNT(DISTINCT ja.job_id) as active_jobs,
      COUNT(ja.id) as total_applications,
      COUNT(*) FILTER (WHERE ja.status = 'interviewed') as interviews,
      COUNT(*) FILTER (WHERE ja.status = 'offered') as offers,
      COUNT(*) FILTER (WHERE ja.status = 'hired') as hires
    FROM job_applications ja
    WHERE ja.company_id = $1
  `, [companyId]);

  return {
    current: currentScores,
    breakdown: Object.entries(TRUST_COMPONENTS).map(([key, config]) => ({
      type: key,
      score: currentScores[key] || 0,
      max: config.max,
      label: config.label,
      description: config.description
    })),
    recent_activity: recentComponents.rows,
    history: history.rows,
    analytics: analytics.rows[0],
    recommendations: generateTrustRecommendations(currentScores)
  };
}

// Generate improvement recommendations
function generateTrustRecommendations(scores) {
  const recommendations = [];

  if (scores.verification < TRUST_COMPONENTS.verification.max * 0.5) {
    recommendations.push({
      type: 'verification',
      priority: 'high',
      title: 'Complete Company Verification',
      description: 'Verify your company email domain, add LinkedIn profile, and complete your company profile to build trust.',
      potential_gain: Math.round(TRUST_COMPONENTS.verification.max * 0.4)
    });
  }

  if (scores.job_authenticity < TRUST_COMPONENTS.job_authenticity.max * 0.5) {
    recommendations.push({
      type: 'job_authenticity',
      priority: 'high',
      title: 'Improve Job Descriptions',
      description: 'Use our AI optimizer to create detailed, authentic job postings with clear requirements and realistic salary ranges.',
      potential_gain: Math.round(TRUST_COMPONENTS.job_authenticity.max * 0.3)
    });
  }

  if (scores.feedback < TRUST_COMPONENTS.feedback.max * 0.3) {
    recommendations.push({
      type: 'feedback',
      priority: 'medium',
      title: 'Collect Candidate Feedback',
      description: 'After interviews, encourage candidates to leave feedback. Positive experiences boost your TrustScore.',
      potential_gain: Math.round(TRUST_COMPONENTS.feedback.max * 0.3)
    });
  }

  if (scores.behavior < TRUST_COMPONENTS.behavior.max * 0.5) {
    recommendations.push({
      type: 'behavior',
      priority: 'low',
      title: 'Stay Active & Responsive',
      description: 'Respond to applications promptly and maintain regular activity on the platform.',
      potential_gain: Math.round(TRUST_COMPONENTS.behavior.max * 0.3)
    });
  }

  return recommendations;
}

// Record score change history
async function recordScoreChange(companyId, previousScore, newScore, reason, componentType) {
  await pool.query(`
    INSERT INTO trust_score_history (company_id, previous_score, new_score, change_amount, change_reason, component_type)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [companyId, previousScore, newScore, newScore - previousScore, reason, componentType]);
}

module.exports = {
  TRUST_SCORE_RANGES,
  TRUST_COMPONENTS,
  getOrCreateTrustScore,
  calculateTrustScore,
  addVerificationComponent,
  addJobAuthenticityComponent,
  updateHiringRatioScore,
  addFeedbackComponent,
  addBehaviorComponent,
  getTrustScoreBreakdown,
  generateTrustRecommendations,
  recordScoreChange
};
