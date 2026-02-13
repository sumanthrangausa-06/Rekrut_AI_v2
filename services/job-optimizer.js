// AI-Powered Job Description Optimizer
const { chat } = require('../lib/polsia-ai');

// Analyze job posting and provide authenticity score + suggestions
async function analyzeJobPosting(jobData) {
  const { title, description, requirements, salary_range, location, job_type, company } = jobData;

  const prompt = `Analyze this job posting for authenticity, clarity, and completeness:

Job Title: ${title}
Company: ${company || 'Not specified'}
Location: ${location || 'Not specified'}
Job Type: ${job_type || 'Not specified'}
Salary Range: ${salary_range || 'Not specified'}

Description:
${description || 'No description provided'}

Requirements:
${requirements || 'No requirements listed'}

Analyze and return a JSON object with:
{
  "authenticity_score": 0-100 (how legitimate/realistic this posting appears),
  "completeness_score": 0-100 (how complete the information is),
  "clarity_score": 0-100 (how clear and understandable),
  "overall_score": 0-100 (weighted average),
  "issues": [
    {"severity": "high|medium|low", "issue": "description of the issue", "suggestion": "how to fix it"}
  ],
  "strengths": ["list of strengths in the posting"],
  "missing_elements": ["important elements that are missing"],
  "improvement_suggestions": [
    {"area": "area name", "current": "current state", "suggested": "improved version"}
  ],
  "salary_assessment": "appropriate|low|high|missing" based on title/location,
  "red_flags": ["any potential concerns that might deter candidates"]
}

Only return the JSON object, no other text.`;

  const response = await chat(prompt, {
    system: 'You are an expert HR consultant and job market analyst. Analyze job postings for quality, authenticity, and candidate appeal. Be specific and actionable. Always return valid JSON.',
    module: 'job_optimizer', feature: 'analyze_posting'
  });

  try {
    return JSON.parse(response);
  } catch (e) {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    return {
      authenticity_score: 50,
      completeness_score: 50,
      clarity_score: 50,
      overall_score: 50,
      issues: [{ severity: 'medium', issue: 'Could not fully analyze', suggestion: 'Please provide more details' }],
      strengths: [],
      missing_elements: ['detailed description', 'clear requirements', 'salary information'],
      improvement_suggestions: []
    };
  }
}

// Generate an optimized job description
async function optimizeJobDescription(jobData, targetAudience = 'general') {
  const { title, description, requirements, salary_range, location, job_type, company } = jobData;

  const prompt = `Optimize this job posting to attract top talent:

Current Job Title: ${title}
Company: ${company || 'Company Name'}
Location: ${location || 'Location TBD'}
Job Type: ${job_type || 'full-time'}
Salary Range: ${salary_range || 'Competitive'}

Current Description:
${description || 'No description yet'}

Current Requirements:
${requirements || 'No requirements listed'}

Target Audience: ${targetAudience}

Create an optimized version and return a JSON object with:
{
  "optimized_title": "improved job title if needed",
  "optimized_description": "compelling, detailed job description (3-4 paragraphs)",
  "optimized_requirements": "clear, organized requirements (bulleted list format)",
  "suggested_salary_range": "market-competitive range for this role/location",
  "key_selling_points": ["3-5 reasons why candidates should apply"],
  "keywords": ["relevant keywords for search optimization"],
  "tone_assessment": "description of the current tone",
  "improvements_made": ["list of specific improvements"],
  "preview_snippet": "short 2-sentence preview for job boards"
}

Only return the JSON object.`;

  const response = await chat(prompt, {
    system: 'You are a professional copywriter specializing in job postings. Create compelling, honest job descriptions that attract quality candidates. Use inclusive language and focus on growth opportunities. Always return valid JSON.',
    module: 'job_optimizer', feature: 'optimize_description'
  });

  try {
    return JSON.parse(response);
  } catch (e) {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Failed to generate optimized job description');
  }
}

// Generate interview questions for a job
async function generateInterviewQuestionsForJob(jobData, count = 8) {
  const { title, description, requirements } = jobData;

  const prompt = `Generate ${count} tailored interview questions for this position:

Job Title: ${title}

Job Description:
${description || 'General ' + title + ' role'}

Requirements:
${requirements || 'Standard requirements'}

Create a mix of behavioral, technical, and situational questions. Return a JSON array:
[
  {
    "question": "the interview question",
    "category": "behavioral|technical|situational|culture-fit",
    "difficulty": "easy|medium|hard",
    "purpose": "what this question assesses",
    "what_to_look_for": ["key points in a good answer"],
    "red_flags": ["warning signs in poor answers"],
    "follow_up": "optional follow-up question"
  }
]

Include at least 2 behavioral, 2 technical, and 2 situational questions.
Only return the JSON array.`;

  const response = await chat(prompt, {
    system: 'You are an expert interviewer who designs effective interview processes. Create questions that reveal candidate capabilities and cultural fit. Always return valid JSON.',
    module: 'job_optimizer', feature: 'interview_questions'
  });

  try {
    return JSON.parse(response);
  } catch (e) {
    const match = response.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Failed to generate interview questions');
  }
}

// Analyze a candidate's fit for a job
async function analyzeCandidateFit(candidateProfile, jobData) {
  const prompt = `Analyze how well this candidate fits the job:

CANDIDATE PROFILE:
Name: ${candidateProfile.name || 'Candidate'}
OmniScore: ${candidateProfile.omniscore || 'Not available'}
Skills: ${candidateProfile.skills?.join(', ') || 'Not specified'}
Experience Summary: ${candidateProfile.experience || 'Not provided'}
Recent Interview Performance: ${candidateProfile.interview_score || 'No data'}/10

JOB REQUIREMENTS:
Title: ${jobData.title}
Description: ${jobData.description || 'Not provided'}
Requirements: ${jobData.requirements || 'Not specified'}

Return a JSON object:
{
  "fit_score": 0-100,
  "fit_level": "excellent|good|moderate|low",
  "matching_qualifications": ["list of matching skills/experience"],
  "gaps": ["areas where candidate may need development"],
  "strengths": ["candidate's standout qualities for this role"],
  "interview_focus_areas": ["topics to explore in interview"],
  "recommendation": "brief hiring recommendation",
  "comparison_notes": "how this candidate compares to typical applicants"
}

Only return the JSON object.`;

  const response = await chat(prompt, {
    system: 'You are an experienced recruiter evaluating candidate-job fit. Be objective and data-driven. Always return valid JSON.',
    module: 'job_optimizer', feature: 'candidate_fit'
  });

  try {
    return JSON.parse(response);
  } catch (e) {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    return { fit_score: 50, fit_level: 'moderate', recommendation: 'Unable to fully analyze fit' };
  }
}

// Generate salary insights
async function getSalaryInsights(title, location, experience_level = 'mid') {
  const prompt = `Provide salary market data for this role:

Job Title: ${title}
Location: ${location || 'United States (average)'}
Experience Level: ${experience_level}

Return a JSON object with:
{
  "salary_range": {
    "low": number,
    "median": number,
    "high": number,
    "currency": "USD"
  },
  "market_demand": "high|medium|low",
  "salary_trend": "increasing|stable|decreasing",
  "factors_affecting_salary": ["list of factors"],
  "comparable_titles": ["similar job titles"],
  "benefits_typically_included": ["common benefits for this role"],
  "negotiation_tips": "advice for salary discussions"
}

Use realistic 2024-2025 US market data. Only return the JSON object.`;

  const response = await chat(prompt, {
    system: 'You are a compensation analyst with access to current salary data. Provide accurate, realistic salary ranges based on current market conditions. Always return valid JSON.',
    module: 'job_optimizer', feature: 'salary_insights'
  });

  try {
    return JSON.parse(response);
  } catch (e) {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    return {
      salary_range: { low: 50000, median: 75000, high: 100000, currency: 'USD' },
      market_demand: 'medium',
      salary_trend: 'stable'
    };
  }
}

// Generate a complete job description from just a title + optional brief notes
async function generateJobDescription(title, briefNotes = '', options = {}) {
  const { location, job_type, company } = options;

  const prompt = `Generate a complete, professional job description for this role:

Job Title: ${title}
Company: ${company || 'A growing company'}
Location: ${location || 'Not specified'}
Job Type: ${job_type || 'full-time'}

${briefNotes ? `Additional context from the recruiter:\n${briefNotes}` : 'No additional notes provided.'}

Create a compelling, detailed job description and return a JSON object:
{
  "description": "Full job description (3-4 paragraphs covering role overview, responsibilities, what the team looks like, and why join). Use professional tone. Include bullet points for key responsibilities.",
  "requirements": "Requirements section with: Required qualifications (bulleted), Preferred qualifications (bulleted), and Required experience level.",
  "suggested_skills": ["array of 8-12 relevant technical and soft skills"],
  "suggested_title": "optimized job title if the original could be improved (or same title if already good)",
  "seniority_level": "entry|mid|senior|lead|director|executive",
  "preview_snippet": "2-sentence preview for job boards"
}

Make the description specific to the role, not generic. Use inclusive language.
Only return the JSON object.`;

  const response = await chat(prompt, {
    system: 'You are a senior talent acquisition specialist who writes compelling job descriptions that attract top talent. Your descriptions are specific, inclusive, and highlight growth opportunities. Always return valid JSON.',
    module: 'job_optimizer', feature: 'generate_description'
  });

  try {
    return JSON.parse(response);
  } catch (e) {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Failed to generate job description');
  }
}

// Suggest relevant skills and requirements for a role
async function suggestSkillsForRole(title, description = '', currentSkills = []) {
  const prompt = `Suggest relevant skills and requirements for this job:

Job Title: ${title}
${description ? `Current Description:\n${description}` : ''}
${currentSkills.length > 0 ? `Skills already listed: ${currentSkills.join(', ')}` : ''}

Return a JSON object with:
{
  "required_skills": [
    {"skill": "skill name", "category": "technical|soft|domain", "importance": "must-have|nice-to-have"}
  ],
  "suggested_requirements": [
    "A specific requirement statement (e.g., '5+ years of experience with React and TypeScript')"
  ],
  "experience_level": {
    "min_years": number,
    "max_years": number,
    "ideal": "description of ideal experience"
  },
  "education": ["relevant education suggestions"],
  "certifications": ["relevant certifications if any"],
  "tools_and_technologies": ["specific tools relevant to this role"]
}

Be specific to the role. Don't suggest generic skills like "communication" unless highly relevant.
Only return the JSON object.`;

  const response = await chat(prompt, {
    system: 'You are a technical recruiter with deep knowledge of role requirements across industries. Provide specific, actionable skill requirements. Always return valid JSON.',
    module: 'job_optimizer', feature: 'suggest_skills'
  });

  try {
    return JSON.parse(response);
  } catch (e) {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Failed to suggest skills');
  }
}

// Suggest optimized job titles that attract more candidates
async function suggestJobTitles(currentTitle, description = '') {
  const prompt = `Suggest better job title alternatives for this position:

Current Title: ${currentTitle}
${description ? `Description:\n${description.substring(0, 500)}` : ''}

Return a JSON object with:
{
  "suggestions": [
    {
      "title": "suggested job title",
      "reason": "why this title is better",
      "search_volume": "high|medium|low (estimated candidate search volume)",
      "seniority_match": "how well it conveys the right seniority level"
    }
  ],
  "current_title_assessment": "assessment of the current title",
  "best_recommendation": "the single best title and why"
}

Focus on titles that:
1. Candidates actually search for on job boards
2. Clearly convey role level and function
3. Avoid jargon that deters applicants (e.g. "ninja", "rockstar", "guru")
4. Are ATS-friendly and inclusive

Suggest 3-5 alternatives. Only return the JSON object.`;

  const response = await chat(prompt, {
    system: 'You are a job market expert who optimizes job titles for maximum candidate reach and clarity. You know what candidates search for on LinkedIn, Indeed, and Glassdoor. Always return valid JSON.',
    module: 'job_optimizer', feature: 'suggest_titles'
  });

  try {
    return JSON.parse(response);
  } catch (e) {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Failed to suggest job titles');
  }
}

module.exports = {
  analyzeJobPosting,
  optimizeJobDescription,
  generateInterviewQuestionsForJob,
  analyzeCandidateFit,
  getSalaryInsights,
  generateJobDescription,
  suggestSkillsForRole,
  suggestJobTitles
};
