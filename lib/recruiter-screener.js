/**
 * Recruiter AI Screener - Reuses existing AI infrastructure
 * 
 * This module provides AI-powered candidate screening for recruiters.
 * It leverages the same chat() function and AI providers already built
 * in polsia-ai.js and ai-provider.js.
 * 
 * The difference is just the PROMPT - instead of coaching a candidate,
 * we're evaluating a candidate for a job.
 */

const { chat, safeParseJSON } = require('./polsia-ai');
const pool = require('./db');

/**
 * Main screening function - Analyzes candidate against job requirements
 * 
 * @param {Object} candidate - Candidate profile with OmniScore, skills, experience
 * @param {Object} job - Job requirements, skills needed, experience level
 * @param {Object} options - Additional options (subscriptionId, etc.)
 * @returns {Object} - Fit score, red flags, screening questions, recommendation
 */
async function screenCandidate(candidate, job, options = {}) {
  const prompt = `You are an expert recruiter AI screening a candidate for a job opening.

CANDIDATE PROFILE:
- Name: ${candidate.name || 'Anonymous'}
- OmniScore: ${candidate.omni_score || 'N/A'}/850
- Skills: ${(candidate.skills || []).map(s => `${s.name} (${s.level || 'intermediate'})`).join(', ')}
- Experience: ${candidate.years_experience || 0} years total
- Recent Roles: ${(candidate.experience || []).slice(0, 3).map(e => `${e.title} at ${e.company}`).join(', ')}
- Education: ${(candidate.education || []).map(e => `${e.degree} in ${e.field}`).join(', ') || 'Not specified'}
- Assessment Scores: ${(candidate.assessment_scores || []).map(a => `${a.skill}: ${a.score}%`).join(', ') || 'No assessments'}
- Interview Performance: ${candidate.interview_avg_score ? `${candidate.interview_avg_score}/10 average` : 'No interviews yet'}

JOB REQUIREMENTS:
- Title: ${job.title}
- Department: ${job.department || 'General'}
- Required Skills: ${(job.required_skills || []).join(', ')}
- Preferred Skills: ${(job.preferred_skills || []).join(', ') || 'None specified'}
- Experience Level: ${job.experience_level || 'Mid-level'}
- Experience Years: ${job.min_years || 0}+ years required
- Salary Range: ${job.salary_min ? `$${job.salary_min}-${job.salary_max || 'open'}` : 'Not specified'}
- Location: ${job.location || 'Remote'}
- Job Type: ${job.job_type || 'Full-time'}

Analyze this candidate for this job. Be thorough but concise.

Return a JSON object with this EXACT structure:
{
  "fit_score": 85,
  "fit_breakdown": {
    "skills_match": 90,
    "experience_match": 80,
    "education_match": 75,
    "location_match": 100,
    "salary_match": 60,
    "culture_fit_estimate": 80
  },
  "matched_skills": ["React", "TypeScript", "Node.js"],
  "missing_skills": ["GraphQL", "AWS"],
  "strengths": [
    "Strong frontend skills with 5 years React experience",
    "OmniScore of 720 indicates reliable, verified abilities"
  ],
  "concerns": [
    "No GraphQL experience which is listed as preferred",
    "Salary expectation may be above budget"
  ],
  "red_flags": [
    {
      "type": "gap",
      "severity": "medium",
      "description": "8-month employment gap in 2023",
      "follow_up": "Ask about this gap in screening call"
    }
  ],
  "screening_questions": [
    "Can you explain the 8-month gap in your employment history?",
    "What's your experience with GraphQL, and how would you approach learning it?",
    "Describe a challenging React project you led recently."
  ],
  "interview_focus_areas": [
    "Technical depth on React and state management",
    "Problem-solving approach",
    "Salary expectations and flexibility"
  ],
  "recommendation": "interview",
  "recommendation_reason": "Strong technical fit for core requirements. Address gaps and salary in interview.",
  "estimated_success_probability": 75,
  "next_steps": [
    "Schedule technical screening",
    "Clarify salary expectations early",
    "Assess GraphQL learning willingness"
  ]
}

Rules:
- fit_score: 0-100 overall match
- recommendation: "interview" | "reject" | "more_info" | "hold"
- Be specific in strengths/concerns - reference actual data
- red_flags.severity: "low" | "medium" | "high"
- Only flag genuine concerns, not missing preferred skills
- screening_questions: 3-5 questions for the recruiter to ask
- Be honest - don't inflate scores

Only return the JSON object, no other text.`;

  const result = await chat(prompt, {
    system: 'You are an expert technical recruiter with 15 years of experience. You screen candidates efficiently and fairly. Always return valid JSON.',
    module: 'recruiter_screener',
    feature: 'candidate_screening',
    subscriptionId: options.subscriptionId,
  });

  const parsed = safeParseJSON(result);
  if (parsed && parsed.fit_score !== undefined) {
    // Log the screening for analytics
    try {
      await pool.query(
        `INSERT INTO screening_logs (candidate_id, job_id, fit_score, recommendation, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [candidate.id, job.id, parsed.fit_score, parsed.recommendation]
      );
    } catch (logErr) {
      // Non-fatal - screening still works even if logging fails
      console.warn('[screener] Failed to log screening:', logErr.message);
    }
    return parsed;
  }

  // Fallback with basic calculation if AI fails
  return calculateBasicFitScore(candidate, job);
}

/**
 * Batch screening - Analyze multiple candidates for a job
 */
async function screenCandidatesBatch(candidates, job, options = {}) {
  const results = [];
  
  // Process in parallel (max 10 at a time to avoid rate limits)
  const batchSize = 10;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(candidate => 
        screenCandidate(candidate, job, options)
          .catch(err => ({
            candidate_id: candidate.id,
            error: err.message,
            fit_score: 0,
            recommendation: 'error'
          }))
      )
    );
    results.push(...batchResults);
  }
  
  // Sort by fit score descending
  return results.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
}

/**
 * Generate interview questions tailored to candidate's profile and gaps
 */
async function generateTailoredInterviewQuestions(candidate, job, options = {}) {
  const prompt = `Generate interview questions for this candidate for this job.

CANDIDATE GAPS & CONCERNS:
- Missing skills: ${(job.required_skills || []).filter(s => !(candidate.skills || []).some(cs => cs.name === s)).join(', ') || 'None'}
- Experience level: ${candidate.years_experience || 0} years vs ${job.min_years || 0}+ required
- Red flags from screening: ${candidate.red_flags || 'None identified'}

JOB FOCUS AREAS:
${job.interview_focus || job.description?.substring(0, 500) || 'General role competency'}

Generate 5-7 interview questions that:
1. Address any skill gaps or concerns
2. Verify the candidate's stated experience
3. Assess problem-solving and culture fit
4. Are specific to this role

Return JSON array:
[
  {
    "question": "The question text",
    "category": "technical|behavioral|situational|culture",
    "purpose": "What this question assesses",
    "follow_ups": ["Follow-up 1 if they answer well", "Follow-up 2 if they struggle"],
    "good_answer_signals": ["What to look for in a strong answer"],
    "bad_answer_signals": ["Red flags in the response"]
  }
]`;

  const result = await chat(prompt, {
    system: 'You are an expert interviewer. Generate insightful questions that reveal candidate quality. Return valid JSON.',
    module: 'recruiter_screener',
    feature: 'interview_questions',
  });

  return safeParseJSON(result) || [];
}

/**
 * Quick fit calculation without AI (fallback)
 */
function calculateBasicFitScore(candidate, job) {
  let score = 50; // Base score
  
  // Skills matching
  const candidateSkills = new Set((candidate.skills || []).map(s => s.name?.toLowerCase()));
  const requiredSkills = (job.required_skills || []).map(s => s?.toLowerCase());
  const matchedSkills = requiredSkills.filter(s => candidateSkills.has(s));
  score += (matchedSkills.length / Math.max(requiredSkills.length, 1)) * 20;
  
  // Experience matching
  const expRatio = (candidate.years_experience || 0) / Math.max(job.min_years || 1, 1);
  score += Math.min(expRatio, 1.5) * 10;
  
  // OmniScore factor
  if (candidate.omni_score) {
    score += ((candidate.omni_score - 300) / 550) * 10; // 300-850 range
  }
  
  // Clamp to 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));
  
  return {
    fit_score: score,
    fit_breakdown: {
      skills_match: Math.round((matchedSkills.length / Math.max(requiredSkills.length, 1)) * 100),
      experience_match: Math.min(100, Math.round(expRatio * 100)),
    },
    matched_skills: matchedSkills,
    missing_skills: requiredSkills.filter(s => !candidateSkills.has(s)),
    strengths: ['Profile available for review'],
    concerns: ['Automated screening - recommend manual review'],
    red_flags: [],
    screening_questions: [
      'Walk me through your relevant experience for this role.',
      'What interests you most about this position?'
    ],
    recommendation: score >= 60 ? 'interview' : score >= 40 ? 'more_info' : 'reject',
    recommendation_reason: 'Basic automated screening - recommend detailed review',
  };
}

/**
 * Compare two candidates for the same job
 */
async function compareCandidates(candidate1, candidate2, job, options = {}) {
  const prompt = `Compare these two candidates for the same job.

JOB: ${job.title}

CANDIDATE 1:
- Name: ${candidate1.name}
- OmniScore: ${candidate1.omni_score}
- Key Skills: ${(candidate1.skills || []).slice(0, 5).map(s => s.name).join(', ')}
- Experience: ${candidate1.years_experience} years

CANDIDATE 2:
- Name: ${candidate2.name}
- OmniScore: ${candidate2.omni_score}
- Key Skills: ${(candidate2.skills || []).slice(0, 5).map(s => s.name).join(', ')}
- Experience: ${candidate2.years_experience} years

Compare them and recommend which to prioritize.

Return JSON:
{
  "recommended": "candidate1" | "candidate2" | "tie",
  "comparison": {
    "skills": { "winner": "candidate1", "reason": "..." },
    "experience": { "winner": "candidate2", "reason": "..." },
    "reliability": { "winner": "candidate1", "reason": "Higher OmniScore" }
  },
  "summary": "2-3 sentence comparison",
  "interview_both": true/false
}`;

  const result = await chat(prompt, {
    system: 'You are a hiring expert. Compare candidates fairly. Return valid JSON.',
    module: 'recruiter_screener',
    feature: 'candidate_comparison',
  });

  return safeParseJSON(result) || { recommended: 'tie', summary: 'Both candidates merit consideration' };
}

module.exports = {
  screenCandidate,
  screenCandidatesBatch,
  generateTailoredInterviewQuestions,
  compareCandidates,
  calculateBasicFitScore,
};
