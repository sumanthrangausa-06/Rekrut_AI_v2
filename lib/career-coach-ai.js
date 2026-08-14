/**
 * Career Coach AI Service — Issue #121
 *
 * Every recommendation is grounded in real platform data:
 * - actual job postings from the jobs table
 * - actual skill demand from candidate_skills + job requirements
 * - candidate's OmniScore factors
 * - company TrustScore and profile data
 *
 * Uses lib/polsia-ai.js for provider-agnostic AI calls.
 */

const pool = require('./db');
const { chat, safeParseJSON, withTimeout, handleAIError } = require('./polsia-ai');
const { incrementUsage } = require('./subscription');

// ─────────────────────────────────────────────────────────────
// Grounding: fetch real platform data
// ─────────────────────────────────────────────────────────────

/**
 * Fetch candidate profile + skills + experience + OmniScore
 */
async function getCandidateContext(userId) {
	const [profileRes, skillsRes, expRes, eduRes, omniRes, projectsRes] = await Promise.all([
		pool.query('SELECT * FROM candidate_profiles WHERE user_id = $1', [userId]),
		pool.query('SELECT skill_name, category, level, years_experience, is_verified FROM candidate_skills WHERE user_id = $1 ORDER BY level DESC', [userId]),
		pool.query('SELECT company_name, title, start_date, end_date, is_current, description, skills_used FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC', [userId]),
		pool.query('SELECT institution, degree, field_of_study, end_date FROM education WHERE user_id = $1 ORDER BY end_date DESC', [userId]),
		pool.query('SELECT total_score, interview_score, technical_score, resume_score, behavior_score, score_tier FROM omni_scores WHERE user_id = $1', [userId]),
		pool.query('SELECT title, technologies, highlights FROM portfolio_projects WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5', [userId]),
	]);

	return {
		profile: profileRes.rows[0] || null,
		skills: skillsRes.rows,
		experience: expRes.rows,
		education: eduRes.rows,
		omniscore: omniRes.rows[0] || null,
		projects: projectsRes.rows,
	};
}

/**
 * Fetch active jobs relevant to a candidate's skills/target
 */
async function getRelevantJobs(skills, targetRole, limit = 20) {
	const skillNames = (skills || []).map((s) => s.skill_name).filter(Boolean);
	let sql = `
    SELECT j.id, j.title, j.company, j.description, j.requirements, j.location,
           j.salary_min, j.salary_max, j.currency_code, j.job_type, j.created_at,
           c.id as company_id, c.name as company_name, c.industry, c.company_size
    FROM jobs j
    LEFT JOIN companies c ON j.company_id = c.id
    WHERE j.status = 'active'
  `;
	const params = [];

	if (targetRole) {
		sql += ` AND (j.title ILIKE $1 OR j.description ILIKE $1)`;
		params.push(`%${targetRole}%`);
	}

	if (skillNames.length > 0) {
		const ilikes = skillNames.map((_, i) => `j.requirements ILIKE $${params.length + i + 1}`).join(' OR ');
		sql += ` AND (${ilikes})`;
		skillNames.forEach((s) => params.push(`%${s}%`));
	}

	sql += ` ORDER BY j.created_at DESC LIMIT $${params.length + 1}`;
	params.push(limit);

	const result = await pool.query(sql, params);
	return result.rows;
}

/**
 * Fetch company data including TrustScore
 */
async function getCompanyContext(companyId) {
	const [companyRes, trustRes, feedbackRes, jobsRes] = await Promise.all([
		pool.query('SELECT * FROM companies WHERE id = $1', [companyId]),
		pool.query('SELECT * FROM trust_scores WHERE company_id = $1', [companyId]),
		pool.query(`SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM candidate_feedback WHERE company_id = $1`, [companyId]),
		pool.query('SELECT COUNT(*) as count FROM jobs WHERE company_id = $1 AND status = $2', [companyId, 'active']),
	]);

	return {
		company: companyRes.rows[0] || null,
		trustscore: trustRes.rows[0] || null,
		feedback: feedbackRes.rows[0] || null,
		activeJobs: parseInt(jobsRes.rows[0]?.count || '0', 10),
	};
}

/**
 * Fetch job application context for optimizer
 */
async function getApplicationContext(userId, jobId) {
	const [appRes, jobRes, userRes] = await Promise.all([
		pool.query('SELECT cover_letter, status, applied_at FROM job_applications WHERE candidate_id = $1 AND job_id = $2', [userId, jobId]),
		pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]),
		pool.query('SELECT name, email, headline FROM users WHERE id = $1', [userId]),
	]);

	return {
		application: appRes.rows[0] || null,
		job: jobRes.rows[0] || null,
		user: userRes.rows[0] || null,
	};
}

// ─────────────────────────────────────────────────────────────
// Prompt builders
// ─────────────────────────────────────────────────────────────

function buildSystemPrompt() {
	return `You are Rekrut AI's Career Coach — an expert career strategist with deep knowledge of tech hiring markets, salary negotiation, and professional development.

RULES:
1. Ground EVERY recommendation in real data provided in the context. Never hallucinate job titles, companies, or salary figures.
2. When citing jobs, use exact titles and company names from the job list.
3. When citing skills, reference the candidate's verified skills and the skill gaps identified.
4. Be specific and actionable. Avoid vague advice like "improve your skills." Say "Learn TypeScript to qualify for the Senior Frontend role at Acme Corp."
5. For salary data, use the provided benchmarks or say "market data unavailable" — never invent numbers.
6. Output structured JSON matching the requested schema exactly.`;
}

// ─────────────────────────────────────────────────────────────
// Career Path Recommendations
// ─────────────────────────────────────────────────────────────

async function generateCareerPaths(userId, { targetRole = null, yearsAhead = 5 } = {}) {
	const candidate = await getCandidateContext(userId);
	const jobs = await getRelevantJobs(candidate.skills, targetRole, 20);

	const prompt = `${buildSystemPrompt()}

CANDIDATE CONTEXT:
- Current role: ${candidate.profile?.headline || 'Unknown'}
- Years experience: ${candidate.profile?.years_experience || 0}
- Skills: ${candidate.skills.map((s) => `${s.skill_name} (L${s.level}, ${s.years_experience}y)`).join(', ')}
- OmniScore: ${candidate.omniscore?.total_score || 'N/A'} (Tier: ${candidate.omniscore?.score_tier || 'N/A'})
- OmniScore breakdown: Interview ${candidate.omniscore?.interview_score}, Technical ${candidate.omniscore?.technical_score}, Resume ${candidate.omniscore?.resume_score}, Behavior ${candidate.omniscore?.behavior_score}
- Work history: ${candidate.experience.map((e) => `${e.title} at ${e.company_name} (${e.is_current ? 'current' : e.end_date})`).join('; ')}
- Education: ${candidate.education.map((e) => `${e.degree} in ${e.field_of_study} from ${e.institution}`).join('; ')}

OPEN JOBS ON PLATFORM (ground truth for market demand):
${jobs.map((j, i) => `${i + 1}. ${j.title} at ${j.company || j.company_name} — ${j.location || 'Remote'} — $${j.salary_min || '?'}-${j.salary_max || '?'} ${j.currency_code || ''} — Type: ${j.job_type}`).join('\n')}

TARGET: ${targetRole || 'Suggest based on profile'}
TIME HORIZON: ${yearsAhead} years

Generate a career pathway. Return JSON:
{
  "pathways": [
    {
      "pathway_name": "string",
      "steps": [
        {
          "step_number": 1,
          "role": "string",
          "timeframe": "string (e.g. '0-12 months')",
          "required_skills": ["string"],
          "skills_to_acquire": ["string"],
          "avg_salary_range": "string",
          "confidence": "high|medium|low",
          "grounded_jobs": [{ "job_id": number, "title": "string", "company": "string" }],
          "action_items": ["string"]
        }
      ],
      "overall_confidence": "high|medium|low",
      "market_trend": "growing|stable|declining"
    }
  ],
  "summary": "string"
}`;

	const response = await withTimeout(
		chat([{ role: 'user', content: prompt }]),
		45000,
	);

	const parsed = safeParseJSON(response.content, { pathways: [], summary: '' });
	return { result: parsed, jobs, candidate };
}

// ─────────────────────────────────────────────────────────────
// Skill Gap Analysis
// ─────────────────────────────────────────────────────────────

async function analyzeSkillGaps(userId, { targetRole }) {
	const candidate = await getCandidateContext(userId);
	const jobs = await getRelevantJobs(candidate.skills, targetRole, 15);

	const prompt = `${buildSystemPrompt()}

CANDIDATE CONTEXT:
- Skills: ${candidate.skills.map((s) => `${s.skill_name} (level ${s.level}/5, ${s.years_experience}y, ${s.is_verified ? 'verified' : 'unverified'})`).join(', ')}
- Experience: ${candidate.experience.map((e) => `${e.title} at ${e.company_name}`).join('; ')}
- OmniScore Technical: ${candidate.omniscore?.technical_score || 'N/A'}
- Projects: ${candidate.projects.map((p) => `${p.title} (${p.technologies?.join(', ')})`).join('; ')}

TARGET ROLE: ${targetRole}

RELEVANT OPEN JOBS (these are REAL jobs on our platform):
${jobs.map((j, i) => `${i + 1}. ${j.title} at ${j.company || j.company_name} — ${j.location || 'Remote'} — Requirements: ${j.requirements || 'N/A'}`).join('\n')}

Analyze skill gaps. Return JSON:
{
  "target_role": "string",
  "current_skills": [{ "skill": "string", "level": 1-5, "verified": boolean }],
  "required_skills": [{ "skill": "string", "level": 1-5, "frequency_in_jobs": "high|medium|low" }],
  "gap_analysis": [
    {
      "skill": "string",
      "current_level": 1-5,
      "required_level": 1-5,
      "gap": "string (e.g. '2 levels')",
      "priority": "critical|high|medium|low",
      "jobs_requiring_it": [{ "job_id": number, "title": "string", "company": "string" }]
    }
  ],
  "qualifying_jobs_now": [{ "job_id": number, "title": "string", "company": "string", "missing_skills": ["string"] }],
  "qualifying_jobs_after_gaps": [{ "job_id": number, "title": "string", "company": "string" }],
  "action_plan": [
    {
      "skill": "string",
      "estimated_hours": number,
      "priority": "critical|high|medium|low",
      "resource_suggestions": ["string"],
      "milestone": "string"
    }
  ],
  "summary": "string"
}`;

	const response = await withTimeout(
		chat([{ role: 'user', content: prompt }]),
		45000,
	);

	const parsed = safeParseJSON(response.content, { gap_analysis: [], action_plan: [], summary: '' });
	return { result: parsed, jobs, candidate };
}

// ─────────────────────────────────────────────────────────────
// Learning Path Generation
// ─────────────────────────────────────────────────────────────

async function generateLearningPath(userId, { targetRole, focusSkills = [] }) {
	const candidate = await getCandidateContext(userId);

	const prompt = `${buildSystemPrompt()}

CANDIDATE CONTEXT:
- Current skills: ${candidate.skills.map((s) => s.skill_name).join(', ')}
- Target role: ${targetRole}
- Focus skills (if any): ${focusSkills.join(', ') || 'Auto-detect from gap analysis'}
- Years experience: ${candidate.profile?.years_experience || 0}

Generate a personalized learning path. Return JSON:
{
  "path_name": "string",
  "target_role": "string",
  "total_estimated_hours": number,
  "steps": [
    {
      "order": 1,
      "title": "string",
      "type": "course|project|certification|book|practice|community",
      "description": "string",
      "skill_tags": ["string"],
      "resource_suggestions": [
        { "name": "string", "type": "course|book|video|documentation", "url_hint": "string (e.g. 'coursera.org/xyz')", "free": boolean }
      ],
      "estimated_hours": number,
      "prerequisites": ["string"],
      "deliverable": "string (what the candidate should produce)"
    }
  ],
  "milestones": [
    { "week": 1, "achievement": "string", "skills_gained": ["string"] }
  ],
  "summary": "string"
}`;

	const response = await withTimeout(
		chat([{ role: 'user', content: prompt }]),
		45000,
	);

	return safeParseJSON(response.content, { steps: [], summary: '' });
}

// ─────────────────────────────────────────────────────────────
// Company Research Brief
// ─────────────────────────────────────────────────────────────

async function generateCompanyBrief(userId, { companyId }) {
	const { company, trustscore, feedback, activeJobs } = await getCompanyContext(companyId);
	const candidate = await getCandidateContext(userId);

	if (!company) throw new Error('Company not found');

	const prompt = `${buildSystemPrompt()}

COMPANY DATA (from Rekrut AI platform):
- Name: ${company.name}
- Industry: ${company.industry || 'N/A'}
- Size: ${company.company_size || 'N/A'}
- Headquarters: ${company.headquarters || 'N/A'}
- Description: ${company.description || 'N/A'}
- Verified: ${company.is_verified ? 'Yes' : 'No'}
- TrustScore: ${trustscore?.total_score || 'N/A'}/1000
  - Verification: ${trustscore?.verification_score || 0}
  - Job Authenticity: ${trustscore?.job_authenticity_score || 0}
  - Hiring Ratio: ${trustscore?.hiring_ratio_score || 0}
  - Feedback: ${trustscore?.feedback_score || 0}
  - Behavior: ${trustscore?.behavior_score || 0}
- Candidate Feedback: ${feedback?.avg_rating ? `Avg ${Number(feedback.avg_rating).toFixed(1)}/5 (${feedback.count} reviews)` : 'No reviews yet'}
- Active Job Openings: ${activeJobs}

CANDIDATE CONTEXT:
- Role: ${candidate.profile?.headline || 'N/A'}
- Skills: ${candidate.skills.map((s) => s.skill_name).join(', ')}
- OmniScore: ${candidate.omniscore?.total_score || 'N/A'}

Generate a company research brief for this candidate. Return JSON:
{
  "summary": "string (2-3 sentence overview)",
  "culture": {
    "overview": "string",
    "work_life_balance": "string",
    "growth_opportunities": "string",
    "diversity_inclusion": "string"
  },
  "interview_process": {
    "stages": ["string"],
    "typical_timeline": "string",
    "tips": ["string"]
  },
  "salary_benchmarks": {
    "range_for_role": "string",
    "negotiation_leverage": ["string"],
    "benefits_notes": "string"
  },
  "trustscore_analysis": {
    "score": number,
    "tier": "string",
    "strengths": ["string"],
    "concerns": ["string"],
    "red_flags": ["string"]
  },
  "recommended_questions": [
    { "category": "string", "question": "string", "why_ask": "string" }
  ],
  "competitor_comparison": "string",
  "verdict": "strong_recommend|recommend|caution|avoid"
}`;

	const response = await withTimeout(
		chat([{ role: 'user', content: prompt }]),
		45000,
	);

	return {
		result: safeParseJSON(response.content, { summary: '', verdict: 'recommend' }),
		company,
		trustscore,
		feedback,
		activeJobs,
	};
}

// ─────────────────────────────────────────────────────────────
// Application Optimizer
// ─────────────────────────────────────────────────────────────

async function optimizeApplication(userId, { jobId, coverLetter = null, answers = [] }) {
	const { application, job, user } = await getApplicationContext(userId, jobId);
	const candidate = await getCandidateContext(userId);

	if (!job) throw new Error('Job not found');

	const originalCoverLetter = coverLetter || application?.cover_letter || '';

	const prompt = `${buildSystemPrompt()}

JOB CONTEXT:
- Title: ${job.title}
- Company: ${job.company}
- Description: ${job.description || 'N/A'}
- Requirements: ${job.requirements || 'N/A'}
- Location: ${job.location || 'N/A'}
- Type: ${job.job_type || 'N/A'}

CANDIDATE CONTEXT:
- Name: ${user?.name || 'Candidate'}
- Headline: ${user?.headline || 'N/A'}
- Skills: ${candidate.skills.map((s) => s.skill_name).join(', ')}
- Experience: ${candidate.experience.map((e) => `${e.title} at ${e.company_name} (${e.start_date} to ${e.end_date || 'present'})`).join('; ')}
- OmniScore: ${candidate.omniscore?.total_score || 'N/A'}

ORIGINAL COVER LETTER:
"""${originalCoverLetter}"""

ORIGINAL ANSWERS:
${answers.map((a, i) => `Q${i + 1}: ${a.question}\nA: ${a.answer}`).join('\n\n')}

Optimize the application. Return JSON:
{
  "optimized_cover_letter": "string (the full improved cover letter)",
  "optimized_answers": [
    { "question": "string", "original": "string", "optimized": "string", "improvement": "string" }
  ],
  "diff_highlights": [
    { "type": "add|remove|keep|rewrite", "text": "string", "reason": "string" }
  ],
  "score_before": 1-100,
  "score_after": 1-100,
  "feedback": {
    "strengths": ["string"],
    "weaknesses": ["string"],
    "key_improvements": ["string"],
    "tailoring": "string (how well it's tailored to this specific job)"
  }
}`;

	const response = await withTimeout(
		chat([{ role: 'user', content: prompt }]),
		45000,
	);

	return {
		result: safeParseJSON(response.content, { optimized_cover_letter: '', score_before: 0, score_after: 0 }),
		job,
		originalCoverLetter,
		originalAnswers: answers,
	};
}

// ─────────────────────────────────────────────────────────────
// Salary Negotiation Practice
// ─────────────────────────────────────────────────────────────

async function startSalaryPractice(userId, { jobId, offeredSalary, targetSalary }) {
	const { job } = await getApplicationContext(userId, jobId);
	const candidate = await getCandidateContext(userId);

	if (!job) throw new Error('Job not found');

	// Determine market benchmark from job salary range or platform data
	const marketBenchmark = job.salary_max || targetSalary || offeredSalary;

	const prompt = `${buildSystemPrompt()}

You are a salary negotiation coach. The user is about to practice negotiating their salary for a real job.

JOB: ${job.title} at ${job.company}
OFFERED: $${offeredSalary}
TARGET: $${targetSalary}
MARKET BENCHMARK (from job posting): $${job.salary_min || '?'}-${job.salary_max || '?'} ${job.currency_code || 'USD'}

CANDIDATE CONTEXT:
- Skills: ${candidate.skills.map((s) => s.skill_name).join(', ')}
- Years experience: ${candidate.profile?.years_experience || 0}
- OmniScore: ${candidate.omniscore?.total_score || 'N/A'}

Start the conversation. The AI (recruiter) has just made the offer. Return JSON:
{
  "ai_message": "string (the recruiter's opening message)",
  "scenario_setup": "string",
  "tips": ["string"],
  "suggested_openers": ["string"],
  "market_context": {
    "benchmark": number,
    "currency": "string",
    "notes": "string"
  }
}`;

	const response = await withTimeout(
		chat([{ role: 'user', content: prompt }]),
		45000,
	);

	return {
		result: safeParseJSON(response.content, { ai_message: "We're excited to offer you this position at $" + offeredSalary + ".", tips: [] }),
		job,
		offeredSalary,
		targetSalary,
		marketBenchmark,
	};
}

async function continueSalaryPractice(userId, { conversationHistory, userMessage, jobId, offeredSalary, targetSalary }) {
	const { job } = await getApplicationContext(userId, jobId);

	const conversationText = conversationHistory
		.map((m) => `${m.role === 'user' ? 'CANDIDATE' : 'RECRUITER'}: ${m.text}`)
		.join('\n');

	const prompt = `${buildSystemPrompt()}

You are a salary negotiation coach simulating a recruiter. Respond naturally to the candidate's message.

JOB: ${job?.title || 'Unknown'} at ${job?.company || 'Unknown'}
OFFERED: $${offeredSalary}
TARGET: $${targetSalary}

CONVERSATION SO FAR:
${conversationText}

CANDIDATE'S LATEST MESSAGE:
"""${userMessage}"""

Respond as the recruiter. Then provide coaching feedback. Return JSON:
{
  "ai_message": "string (recruiter's response)",
  "coaching_feedback": {
    "this_move": {
      "score": 1-100,
      "what_worked": ["string"],
      "what_to_improve": ["string"]
    },
    "tactics_used": ["string"],
    "suggested_next_move": "string",
    "negotiation_health": "strong|good|neutral|weak|collapsing"
  },
  "is_offer_improved": boolean,
  "new_offer_amount": number|null,
  "conversation_should_end": boolean,
  "end_reason": "string|null"
}`;

	const response = await withTimeout(
		chat([{ role: 'user', content: prompt }]),
		45000,
	);

	return safeParseJSON(response.content, { ai_message: '', coaching_feedback: {} });
}

async function finalizeSalaryPractice(userId, { conversationHistory, finalOffer, accepted }) {
	const conversationText = conversationHistory
		.map((m) => `${m.role === 'user' ? 'CANDIDATE' : 'RECRUITER'}: ${m.text}`)
		.join('\n');

	const prompt = `${buildSystemPrompt()}

Provide a final debrief of this salary negotiation practice session.

CONVERSATION:
${conversationText}

FINAL OFFER: $${finalOffer || 'N/A'}
ACCEPTED: ${accepted ? 'Yes' : 'No'}

Return JSON:
{
  "overall_score": 1-100,
  "grade": "A|B|C|D|F",
  "summary": "string",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "tactics_used_well": ["string"],
  "missed_opportunities": ["string"],
  "specific_improvements": ["string"],
  "next_time_recommendations": ["string"],
  "what_they_should_have_asked_for": "string"
}`;

	const response = await withTimeout(
		chat([{ role: 'user', content: prompt }]),
		45000,
	);

	return safeParseJSON(response.content, { overall_score: 0, grade: 'C', summary: '' });
}

// ─────────────────────────────────────────────────────────────
// Session persistence helpers
// ─────────────────────────────────────────────────────────────

async function saveSession(userId, sessionType, inputData, resultData, aiModel = null, tokensUsed = 0) {
	const result = await pool.query(
		`INSERT INTO career_coach_sessions (user_id, session_type, input_data, result_data, ai_model, tokens_used)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
		[userId, sessionType, JSON.stringify(inputData), JSON.stringify(resultData), aiModel, tokensUsed],
	);
	return result.rows[0].id;
}

async function getSessionHistory(userId, sessionType = null, limit = 20) {
	let sql = `SELECT * FROM career_coach_sessions WHERE user_id = $1`;
	const params = [userId];
	if (sessionType) {
		sql += ` AND session_type = $2`;
		params.push(sessionType);
	}
	sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
	params.push(limit);
	const result = await pool.query(sql, params);
	return result.rows;
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

module.exports = {
	// AI generation
	generateCareerPaths,
	analyzeSkillGaps,
	generateLearningPath,
	generateCompanyBrief,
	optimizeApplication,
	startSalaryPractice,
	continueSalaryPractice,
	finalizeSalaryPractice,

	// Grounding helpers (exported for testing / advanced use)
	getCandidateContext,
	getRelevantJobs,
	getCompanyContext,
	getApplicationContext,

	// Session persistence
	saveSession,
	getSessionHistory,
};
