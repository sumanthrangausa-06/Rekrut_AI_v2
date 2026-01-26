const pool = require('../lib/db');

/**
 * Score Explainability Service
 * Provides transparent explanations for OmniScore and assessment results
 */
class ScoreExplainer {
  /**
   * Generate a human-readable explanation for a user's OmniScore
   */
  static async explainOmniScore(userId) {
    try {
      // Get current score
      const scoreResult = await pool.query(
        'SELECT * FROM omniscore_results WHERE user_id = $1',
        [userId]
      );

      if (scoreResult.rows.length === 0) {
        throw new Error('No OmniScore found for this user');
      }

      const score = scoreResult.rows[0];

      // Get score components breakdown
      const components = await pool.query(`
        SELECT component_type, source_type, points_earned, weight, created_at, metadata
        FROM score_components
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [userId]);

      // Get score history
      const history = await pool.query(`
        SELECT previous_score, new_score, change_amount, change_reason, component_type, created_at
        FROM score_history
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 10
      `, [userId]);

      // Group components by type
      const componentsByType = {
        technical: [],
        behavioral: [],
        experience: []
      };

      components.rows.forEach(comp => {
        if (componentsByType[comp.component_type]) {
          componentsByType[comp.component_type].push(comp);
        }
      });

      // Calculate contributions
      const totalPoints = components.rows.reduce((sum, c) => sum + parseFloat(c.points_earned), 0);

      const explanation = {
        overall_score: parseFloat(score.overall_score),
        score_breakdown: {
          technical: {
            score: parseFloat(score.technical_score),
            weight: 0.4,
            contribution: parseFloat(score.technical_score) * 0.4,
            components: componentsByType.technical.map(c => ({
              source: c.source_type,
              points: parseFloat(c.points_earned),
              weight: parseFloat(c.weight),
              date: c.created_at,
              details: c.metadata
            }))
          },
          behavioral: {
            score: parseFloat(score.behavioral_score),
            weight: 0.3,
            contribution: parseFloat(score.behavioral_score) * 0.3,
            components: componentsByType.behavioral.map(c => ({
              source: c.source_type,
              points: parseFloat(c.points_earned),
              weight: parseFloat(c.weight),
              date: c.created_at,
              details: c.metadata
            }))
          },
          experience: {
            score: parseFloat(score.experience_score),
            weight: 0.3,
            contribution: parseFloat(score.experience_score) * 0.3,
            components: componentsByType.experience.map(c => ({
              source: c.source_type,
              points: parseFloat(c.points_earned),
              weight: parseFloat(c.weight),
              date: c.created_at,
              details: c.metadata
            }))
          }
        },
        recent_changes: history.rows.map(h => ({
          date: h.created_at,
          previous: parseFloat(h.previous_score),
          new: parseFloat(h.new_score),
          change: parseFloat(h.change_amount),
          reason: h.change_reason,
          component: h.component_type
        })),
        how_calculated: this._generateCalculationExplanation(score),
        improvement_factors: this._generateImprovementFactors(componentsByType)
      };

      return explanation;
    } catch (error) {
      console.error('Score explanation failed:', error);
      throw error;
    }
  }

  /**
   * Generate plain-English explanation of how the score is calculated
   */
  static _generateCalculationExplanation(score) {
    return {
      formula: "Overall Score = (Technical × 40%) + (Behavioral × 30%) + (Experience × 30%)",
      calculation: `${score.overall_score} = (${score.technical_score} × 0.4) + (${score.behavioral_score} × 0.3) + (${score.experience_score} × 0.3)`,
      breakdown: [
        `Technical contribution: ${(score.technical_score * 0.4).toFixed(1)} points`,
        `Behavioral contribution: ${(score.behavioral_score * 0.3).toFixed(1)} points`,
        `Experience contribution: ${(score.experience_score * 0.3).toFixed(1)} points`
      ]
    };
  }

  /**
   * Identify which factors could most improve the score
   */
  static _generateImprovementFactors(componentsByType) {
    const factors = [];

    // Check technical components
    const techSources = new Set(componentsByType.technical.map(c => c.source_type));
    if (!techSources.has('github_profile')) {
      factors.push({
        category: 'technical',
        action: 'Connect your GitHub profile',
        potential_impact: 'high',
        points: '+15-30 points'
      });
    }
    if (!techSources.has('coding_assessment')) {
      factors.push({
        category: 'technical',
        action: 'Complete a coding assessment',
        potential_impact: 'high',
        points: '+20-40 points'
      });
    }

    // Check behavioral components
    const behaviorSources = new Set(componentsByType.behavioral.map(c => c.source_type));
    if (behaviorSources.size < 3) {
      factors.push({
        category: 'behavioral',
        action: 'Complete behavioral interviews',
        potential_impact: 'medium',
        points: '+10-20 points'
      });
    }

    // Check experience components
    const expSources = new Set(componentsByType.experience.map(c => c.source_type));
    if (!expSources.has('work_history')) {
      factors.push({
        category: 'experience',
        action: 'Add work experience to your profile',
        potential_impact: 'high',
        points: '+15-25 points'
      });
    }

    return factors;
  }

  /**
   * Explain why a specific score decision was made
   * (e.g., why a candidate was rejected)
   */
  static async explainDecision(applicationId) {
    try {
      const app = await pool.query(`
        SELECT ja.*, j.title as job_title,
               u.name as candidate_name, u.email as candidate_email,
               os.overall_score, os.technical_score, os.behavioral_score, os.experience_score
        FROM job_applications ja
        JOIN jobs j ON ja.job_id = j.id
        JOIN users u ON ja.candidate_id = u.id
        LEFT JOIN omniscore_results os ON os.user_id = ja.candidate_id
        WHERE ja.id = $1
      `, [applicationId]);

      if (app.rows.length === 0) {
        throw new Error('Application not found');
      }

      const application = app.rows[0];

      // Get matching score if available
      const matchResult = await pool.query(`
        SELECT overall_match_score, skill_match_score, experience_match_score, cultural_match_score,
               match_explanation, skills_matched, skills_missing
        FROM candidate_job_matches
        WHERE candidate_id = $1 AND job_id = $2
      `, [application.candidate_id, application.job_id]);

      const explanation = {
        application_id: applicationId,
        candidate: {
          name: application.candidate_name,
          email: application.candidate_email
        },
        job: {
          title: application.job_title
        },
        decision: {
          status: application.status,
          decided_at: application.updated_at,
          recruiter_notes: application.recruiter_notes
        },
        omniscore_at_apply: parseFloat(application.omniscore_at_apply),
        current_omniscore: parseFloat(application.overall_score),
        factors: []
      };

      // Explain based on status
      if (application.status === 'rejected') {
        if (application.omniscore_at_apply < 60) {
          explanation.factors.push({
            factor: 'Low OmniScore',
            value: application.omniscore_at_apply,
            impact: 'negative',
            explanation: `OmniScore of ${application.omniscore_at_apply} was below the competitive threshold of 60`
          });
        }

        if (matchResult.rows.length > 0) {
          const match = matchResult.rows[0];
          if (parseFloat(match.overall_match_score) < 70) {
            explanation.factors.push({
              factor: 'Low Job Match Score',
              value: match.overall_match_score,
              impact: 'negative',
              explanation: `Overall match score of ${match.overall_match_score}% indicates limited fit for this role`
            });
          }

          if (match.skills_missing && match.skills_missing.length > 0) {
            explanation.factors.push({
              factor: 'Missing Required Skills',
              value: match.skills_missing,
              impact: 'negative',
              explanation: `Candidate lacks: ${match.skills_missing.join(', ')}`
            });
          }
        }
      }

      return explanation;
    } catch (error) {
      console.error('Decision explanation failed:', error);
      throw error;
    }
  }
}

module.exports = ScoreExplainer;
