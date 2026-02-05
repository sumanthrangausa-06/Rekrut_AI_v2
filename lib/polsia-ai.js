const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  baseURL: process.env.POLSIA_API_URL || 'https://polsia.com/api/proxy/ai',
  apiKey: process.env.POLSIA_API_KEY,
});

async function chat(message, options = {}) {
  // Handle both string messages and arrays of message objects
  let messages;
  if (Array.isArray(message)) {
    // Filter out system messages and extract them
    const systemMessages = message.filter(m => m.role === 'system');
    const nonSystemMessages = message.filter(m => m.role !== 'system');

    // Use the first system message content as the system prompt if not already set
    if (systemMessages.length > 0 && !options.system) {
      options.system = systemMessages[0].content;
    }

    // Ensure messages have proper format (content must be string or array)
    messages = nonSystemMessages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : String(m.content)
    }));
  } else {
    // Simple string message
    messages = [{ role: 'user', content: String(message) }];
  }

  // Ensure we have at least one message
  if (messages.length === 0) {
    messages = [{ role: 'user', content: 'Hello' }];
  }

  const response = await anthropic.messages.create({
    max_tokens: options.maxTokens || options.max_tokens || 8192,
    messages: messages,
    system: options.system,
  }, {
    headers: options.subscriptionId ? { 'X-Subscription-ID': options.subscriptionId } : {}
  });
  return response.content[0].text;
}

async function generateInterviewQuestions(jobTitle, jobDescription, count = 5) {
  const prompt = `Generate ${count} interview questions for a ${jobTitle} position.

Job Description:
${jobDescription || 'General ' + jobTitle + ' role'}

Return a JSON array with objects containing:
- question: The interview question
- category: behavioral/technical/situational
- difficulty: easy/medium/hard
- key_points: Array of 3-5 key points to look for in a good answer

Only return the JSON array, no other text.`;

  const response = await chat(prompt, {
    system: 'You are an expert interviewer. Generate thoughtful, role-specific interview questions. Always return valid JSON.'
  });

  try {
    return JSON.parse(response);
  } catch (e) {
    const match = response.match(/\[.*\]/s);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Failed to parse interview questions');
  }
}

async function analyzeInterviewResponse(question, response, keyPoints, options = {}) {
  const prompt = `Analyze this interview response:

Question: ${question}

Candidate's Response:
${response}

Key points to evaluate:
${keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Provide a JSON object with:
- score: 1-10 rating
- strengths: Array of 2-3 strengths
- improvements: Array of 2-3 areas for improvement
- covered_points: Array of which key points were addressed
- missed_points: Array of key points that were missed
- detailed_feedback: A 2-3 sentence constructive feedback paragraph

Only return the JSON object, no other text.`;

  const result = await chat(prompt, {
    system: 'You are an expert interview coach providing constructive, actionable feedback. Be encouraging but honest. Always return valid JSON.',
    subscriptionId: options.subscriptionId
  });

  try {
    return JSON.parse(result);
  } catch (e) {
    const match = result.match(/\{.*\}/s);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Failed to parse analysis');
  }
}

async function generateOverallFeedback(questionResults, options = {}) {
  const avgScore = questionResults.reduce((sum, r) => sum + r.score, 0) / questionResults.length;
  
  const prompt = `Based on these interview question results, provide overall feedback:

Results:
${questionResults.map((r, i) => `Q${i + 1}: Score ${r.score}/10 - ${r.detailed_feedback}`).join('\n\n')}

Average Score: ${avgScore.toFixed(1)}/10

Provide a JSON object with:
- overall_score: Rounded average (1-10)
- summary: 2-3 sentence overall assessment
- top_strengths: Array of 3 key strengths demonstrated
- priority_improvements: Array of 3 highest priority areas to work on
- recommended_practice: Array of 3 specific practice recommendations
- interview_readiness: "ready"/"almost_ready"/"needs_work" based on score

Only return the JSON object.`;

  const result = await chat(prompt, {
    system: 'You are a supportive career coach. Provide actionable, encouraging feedback. Always return valid JSON.',
    subscriptionId: options.subscriptionId
  });

  try {
    return JSON.parse(result);
  } catch (e) {
    const match = result.match(/\{.*\}/s);
    if (match) {
      return JSON.parse(match[0]);
    }
    return {
      overall_score: Math.round(avgScore),
      summary: 'Your interview performance has been evaluated.',
      interview_readiness: avgScore >= 7 ? 'ready' : avgScore >= 5 ? 'almost_ready' : 'needs_work'
    };
  }
}

async function parseResume(resumeText, options = {}) {
  const prompt = `Parse this resume and extract structured information:

${resumeText}

Return a JSON object with:
{
  "contact": {
    "name": "Full name",
    "email": "Email if found",
    "phone": "Phone if found",
    "location": "Location if found",
    "linkedin": "LinkedIn URL if found",
    "github": "GitHub URL if found",
    "portfolio": "Portfolio URL if found"
  },
  "headline": "A professional headline/title (max 100 chars)",
  "bio": "A professional summary (2-3 sentences, max 300 chars)",
  "experience": [
    {
      "company": "Company name",
      "title": "Job title",
      "location": "Location",
      "start_date": "YYYY-MM or YYYY",
      "end_date": "YYYY-MM or 'Present'",
      "is_current": boolean,
      "description": "Role description",
      "achievements": ["Achievement 1", "Achievement 2"],
      "skills_used": ["Skill 1", "Skill 2"]
    }
  ],
  "education": [
    {
      "institution": "School name",
      "degree": "Degree type",
      "field": "Field of study",
      "start_date": "YYYY",
      "end_date": "YYYY or 'Present'",
      "gpa": number or null,
      "achievements": ["Honor 1", "Activity 1"]
    }
  ],
  "skills": [
    {
      "name": "Skill name",
      "category": "technical|soft_skill|tool|language",
      "level": 1-5 (inferred from context, 3 is intermediate)
    }
  ],
  "certifications": ["Cert 1", "Cert 2"],
  "years_experience": total years of work experience
}

Only return the JSON object, no other text.`;

  const result = await chat(prompt, {
    system: 'You are an expert resume parser. Extract accurate, structured data from resumes. Always return valid JSON. Be thorough but do not fabricate information.',
    subscriptionId: options.subscriptionId
  });

  try {
    return JSON.parse(result);
  } catch (e) {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Failed to parse resume data');
  }
}

async function generateSkillAssessment(skillName, skillLevel, category, options = {}) {
  const difficultyMap = { 1: 'beginner', 2: 'intermediate', 3: 'intermediate', 4: 'advanced', 5: 'expert' };
  const difficulty = difficultyMap[skillLevel] || 'intermediate';

  const prompt = `Generate a skill assessment for ${skillName} at ${difficulty} level.

Category: ${category}

Create 5 multiple-choice questions that test practical knowledge.

Return a JSON array:
[
  {
    "question": "The question text",
    "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
    "correct_answer": "A",
    "explanation": "Brief explanation of why this is correct",
    "difficulty": "easy|medium|hard"
  }
]

Make questions progressively harder. Include at least one scenario-based question.
Only return the JSON array, no other text.`;

  const result = await chat(prompt, {
    system: 'You are an expert technical interviewer. Create fair, practical assessment questions that test real-world knowledge. Always return valid JSON.',
    subscriptionId: options.subscriptionId
  });

  try {
    return JSON.parse(result);
  } catch (e) {
    const match = result.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Failed to generate assessment');
  }
}

async function evaluateSkillAssessment(questions, responses, skillName, options = {}) {
  const prompt = `Evaluate these skill assessment responses for ${skillName}:

Questions and Responses:
${questions.map((q, i) => `
Q${i + 1}: ${q.question}
Options: ${q.options.join(', ')}
Correct Answer: ${q.correct_answer}
User Answer: ${responses[i] || 'No answer'}
Explanation: ${q.explanation}
`).join('\n')}

Calculate the score and provide feedback.

Return a JSON object:
{
  "score": percentage correct (0-100),
  "passed": boolean (70+ is passing),
  "correct_count": number of correct answers,
  "total_questions": total number of questions,
  "question_results": [
    {
      "question_index": 0,
      "is_correct": boolean,
      "user_answer": "A",
      "correct_answer": "B",
      "explanation": "Why the correct answer is right"
    }
  ],
  "strengths": ["Strength 1", "Strength 2"],
  "areas_to_improve": ["Area 1", "Area 2"],
  "recommended_level": 1-5 skill level based on performance,
  "feedback_summary": "2-3 sentence overall feedback"
}

Only return the JSON object.`;

  const result = await chat(prompt, {
    system: 'You are an expert assessor. Provide fair, constructive evaluation. Always return valid JSON.',
    subscriptionId: options.subscriptionId
  });

  try {
    return JSON.parse(result);
  } catch (e) {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Failed to evaluate assessment');
  }
}

async function generateJobMatchScore(candidateProfile, job, options = {}) {
  const prompt = `Calculate how well this candidate matches this job:

CANDIDATE PROFILE:
- Skills: ${candidateProfile.skills?.map(s => s.skill_name).join(', ') || 'None listed'}
- Experience: ${candidateProfile.years_experience || 0} years
- Location: ${candidateProfile.location || 'Not specified'}
- OmniScore: ${candidateProfile.omniscore || 300}
- Recent titles: ${candidateProfile.titles?.join(', ') || 'Not specified'}

JOB POSTING:
- Title: ${job.title}
- Company: ${job.company}
- Requirements: ${job.requirements || 'Not specified'}
- Location: ${job.location || 'Not specified'}
- Description: ${job.description?.substring(0, 500) || 'Not specified'}

Calculate a match score and explain why.

Return a JSON object:
{
  "match_score": 0-100,
  "match_level": "excellent|good|fair|poor",
  "matching_skills": ["skill1", "skill2"],
  "missing_skills": ["skill1", "skill2"],
  "strengths": ["Why this candidate is a good fit"],
  "gaps": ["Potential concerns"],
  "recommendation": "1-2 sentence recommendation"
}

Only return the JSON object.`;

  const result = await chat(prompt, {
    system: 'You are an expert recruiter matching candidates to jobs. Be fair and accurate. Always return valid JSON.',
    subscriptionId: options.subscriptionId
  });

  try {
    return JSON.parse(result);
  } catch (e) {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    return { match_score: 50, match_level: 'fair', recommendation: 'Unable to calculate detailed match' };
  }
}

async function generateInterviewCoaching(question, response, feedback, options = {}) {
  const prompt = `Provide personalized coaching for this interview response:

QUESTION: ${question}

CANDIDATE'S RESPONSE: ${response}

INITIAL FEEDBACK: ${JSON.stringify(feedback)}

Provide detailed coaching:

Return a JSON object:
{
  "improved_response": "A better version of their response using the STAR method if applicable",
  "specific_tips": [
    "Specific tip 1 for this response",
    "Specific tip 2"
  ],
  "body_language_tips": ["Tip about delivery"],
  "common_mistake": "What mistake they made and how to avoid it",
  "practice_prompt": "A follow-up question they should practice"
}

Only return the JSON object.`;

  const result = await chat(prompt, {
    system: 'You are an expert interview coach. Be supportive, specific, and actionable. Always return valid JSON.',
    subscriptionId: options.subscriptionId
  });

  try {
    return JSON.parse(result);
  } catch (e) {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Failed to generate coaching');
  }
}

module.exports = {
  anthropic,
  chat,
  generateInterviewQuestions,
  analyzeInterviewResponse,
  generateOverallFeedback,
  parseResume,
  generateSkillAssessment,
  evaluateSkillAssessment,
  generateJobMatchScore,
  generateInterviewCoaching
};