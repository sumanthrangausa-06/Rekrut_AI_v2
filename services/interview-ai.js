// Interview AI Service — Smart Scheduling, Screening Evaluation, Multi-Agent Scoring
const pool = require('../lib/db');
const crypto = require('crypto');
const omniscoreService = require('./omniscore');

// ============ SMART SCHEDULING ============

/**
 * Suggest optimal interview slots based on recruiter preferences and candidate availability
 */
async function suggestSlots(recruiterId, candidateTimezone = 'America/New_York', options = {}) {
  const { daysAhead = 7, slotsCount = 6, durationMinutes = 60 } = options;

  // Get recruiter preferences
  let prefs;
  const prefsResult = await pool.query(
    'SELECT * FROM scheduling_preferences WHERE user_id = $1',
    [recruiterId]
  );

  if (prefsResult.rows.length > 0) {
    prefs = prefsResult.rows[0];
  } else {
    prefs = {
      timezone: 'America/New_York',
      available_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      available_hours: { start: '09:00', end: '17:00' },
      buffer_minutes: 15,
      preferred_duration: 60,
      blackout_dates: []
    };
  }

  const duration = durationMinutes || prefs.preferred_duration || 60;
  const buffer = prefs.buffer_minutes || 15;
  const availDays = Array.isArray(prefs.available_days) ? prefs.available_days : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const hours = prefs.available_hours || { start: '09:00', end: '17:00' };
  const blackoutDates = Array.isArray(prefs.blackout_dates) ? prefs.blackout_dates : [];

  // Get existing scheduled interviews for conflict detection
  const existingInterviews = await pool.query(
    `SELECT scheduled_at, duration_minutes FROM scheduled_interviews
     WHERE recruiter_id = $1 AND status IN ('scheduled', 'confirmed')
     AND scheduled_at > NOW() AND scheduled_at < NOW() + INTERVAL '${Math.min(daysAhead, 30)} days'`,
    [recruiterId]
  );

  const busySlots = existingInterviews.rows.map(r => ({
    start: new Date(r.scheduled_at),
    end: new Date(new Date(r.scheduled_at).getTime() + (r.duration_minutes || 60) * 60000)
  }));

  // Generate available slots
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const slots = [];
  const now = new Date();

  for (let d = 1; d <= daysAhead && slots.length < slotsCount; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() + d);
    const dayName = dayNames[date.getDay()];

    // Skip unavailable days
    if (!availDays.includes(dayName)) continue;

    // Skip blackout dates
    const dateStr = date.toISOString().split('T')[0];
    if (blackoutDates.includes(dateStr)) continue;

    // Parse available hours
    const [startH, startM] = hours.start.split(':').map(Number);
    const [endH, endM] = hours.end.split(':').map(Number);

    // Generate slots every (duration + buffer) minutes
    const slotStep = duration + buffer;
    for (let h = startH; h < endH && slots.length < slotsCount; h++) {
      for (let m = (h === startH ? startM : 0); m < 60 && slots.length < slotsCount; m += slotStep) {
        // Check if slot fits before end time
        const slotEnd = h * 60 + m + duration;
        if (slotEnd > endH * 60 + endM) break;

        const slotStart = new Date(date);
        slotStart.setHours(h, m, 0, 0);

        // Skip past slots
        if (slotStart <= now) continue;

        // Check for conflicts
        const hasConflict = busySlots.some(busy => {
          const bufferedStart = new Date(busy.start.getTime() - buffer * 60000);
          const bufferedEnd = new Date(busy.end.getTime() + buffer * 60000);
          return slotStart >= bufferedStart && slotStart < bufferedEnd;
        });

        if (!hasConflict) {
          slots.push({
            start: slotStart.toISOString(),
            end: new Date(slotStart.getTime() + duration * 60000).toISOString(),
            duration_minutes: duration,
            day: dayName,
            date: dateStr,
            recruiter_timezone: prefs.timezone,
            candidate_timezone: candidateTimezone
          });
        }
      }
    }
  }

  return slots;
}

/**
 * Create reminders for a scheduled interview
 */
async function createReminders(interviewId, candidateId, recruiterId, scheduledAt) {
  const time = new Date(scheduledAt);

  // 1 day before
  const dayBefore = new Date(time.getTime() - 24 * 60 * 60000);
  // 1 hour before
  const hourBefore = new Date(time.getTime() - 60 * 60000);

  const reminders = [];

  // Only create future reminders
  const now = new Date();
  if (dayBefore > now) {
    reminders.push(
      { interview_id: interviewId, recipient_id: candidateId, reminder_type: '1_day_before', send_at: dayBefore },
      { interview_id: interviewId, recipient_id: recruiterId, reminder_type: '1_day_before', send_at: dayBefore }
    );
  }
  if (hourBefore > now) {
    reminders.push(
      { interview_id: interviewId, recipient_id: candidateId, reminder_type: '1_hour_before', send_at: hourBefore },
      { interview_id: interviewId, recipient_id: recruiterId, reminder_type: '1_hour_before', send_at: hourBefore }
    );
  }

  for (const r of reminders) {
    await pool.query(
      `INSERT INTO interview_reminders (interview_id, recipient_id, reminder_type, send_at)
       VALUES ($1, $2, $3, $4)`,
      [r.interview_id, r.recipient_id, r.reminder_type, r.send_at]
    );
  }

  return reminders.length;
}

/**
 * Suggest alternative slots when an interview is cancelled/needs rescheduling
 */
async function suggestRescheduleSlots(interviewId) {
  const interview = await pool.query(
    'SELECT * FROM scheduled_interviews WHERE id = $1',
    [interviewId]
  );
  if (interview.rows.length === 0) return [];

  const { recruiter_id, candidate_id } = interview.rows[0];
  return suggestSlots(recruiter_id, 'America/New_York', { daysAhead: 10, slotsCount: 5 });
}

// ============ SCREENING TEMPLATES & SESSIONS ============

/**
 * Generate screening questions from a job description using AI
 */
async function generateScreeningQuestions(jobTitle, jobDescription, options = {}) {
  const aiProvider = require('../lib/ai-provider');

  const prompt = `Generate 6-8 screening interview questions for a "${jobTitle}" position.
Job Description: ${(jobDescription || '').substring(0, 2000)}

Return a JSON array of questions. Each should have:
- question_text: the question to ask
- question_type: "behavioral", "technical", "situational", or "competency"
- difficulty: "easy", "medium", or "hard"
- evaluation_criteria: array of 3-4 things to look for in the answer
- time_limit_seconds: suggested time limit (60-180)

Mix types: 2 behavioral, 2-3 technical/competency, 2 situational. Start easy, progress to harder.
Return ONLY valid JSON array, no markdown.`;

  try {
    const text = await aiProvider.chat(prompt, {
      maxTokens: 2000,
      task: 'screening-question-generation',
      module: 'interview_screening', feature: 'question_generation'
    });

    // Parse response
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const questions = JSON.parse(match[0]);
      if (Array.isArray(questions) && questions.length > 0) {
        return questions;
      }
    }
  } catch (err) {
    console.error('[screening] AI question generation failed:', err.message);
  }

  // Fallback questions
  return [
    { question_text: `Tell me about your experience relevant to the ${jobTitle} role.`, question_type: 'behavioral', difficulty: 'easy', evaluation_criteria: ['Relevant experience', 'Clear communication', 'Role alignment'], time_limit_seconds: 120 },
    { question_text: 'Describe a challenging project you led or contributed to significantly. What was your approach?', question_type: 'behavioral', difficulty: 'medium', evaluation_criteria: ['Problem-solving', 'Leadership', 'Technical depth', 'Impact'], time_limit_seconds: 150 },
    { question_text: `What specific skills make you a strong candidate for this ${jobTitle} position?`, question_type: 'competency', difficulty: 'easy', evaluation_criteria: ['Self-awareness', 'Skill alignment', 'Specific examples'], time_limit_seconds: 120 },
    { question_text: 'Walk me through how you would approach a task you\'ve never done before with a tight deadline.', question_type: 'situational', difficulty: 'medium', evaluation_criteria: ['Problem-solving', 'Time management', 'Resourcefulness', 'Communication'], time_limit_seconds: 150 },
    { question_text: 'Tell me about a time you received difficult feedback. How did you respond?', question_type: 'behavioral', difficulty: 'medium', evaluation_criteria: ['Growth mindset', 'Self-awareness', 'Adaptability', 'Professional maturity'], time_limit_seconds: 120 },
    { question_text: 'Where do you see yourself in 2-3 years and how does this role fit?', question_type: 'situational', difficulty: 'easy', evaluation_criteria: ['Career vision', 'Role alignment', 'Ambition', 'Commitment'], time_limit_seconds: 90 },
  ];
}

/**
 * Generate structured evaluation report from screening responses
 */
async function generateScreeningReport(session) {
  const aiProvider = require('../lib/ai-provider');

  const questions = session.questions || [];
  const responses = session.responses || [];
  const conversation = session.conversation || [];

  // Build context
  const qaContext = questions.map((q, i) => {
    const response = responses[i];
    return `Q${i+1} (${q.question_type}, ${q.difficulty}): ${q.question_text}
Evaluation Criteria: ${(q.evaluation_criteria || []).join(', ')}
Candidate Answer: ${response?.response_text || '(no response)'}`;
  }).join('\n\n');

  const prompt = `You are an expert interview evaluator. Analyze this AI screening interview and produce a structured evaluation report.

${qaContext}

Return ONLY valid JSON with this structure:
{
  "question_scores": [
    {"question_index": 0, "score": 0-100, "feedback": "brief assessment"}
  ],
  "communication_clarity": {"score": 0-100, "feedback": "assessment"},
  "technical_depth": {"score": 0-100, "feedback": "assessment"},
  "confidence_enthusiasm": {"score": 0-100, "indicators": ["list of observed indicators"]},
  "red_flags": ["list any inconsistencies, evasiveness, or concerns"],
  "strengths": ["top 3-5 strengths observed"],
  "overall_score": 0-100,
  "recommendation": "advance|consider|decline",
  "recommendation_reasoning": "2-3 sentence justification"
}`;

  try {
    const text = await aiProvider.chat(prompt, {
      maxTokens: 2000,
      task: 'screening-evaluation-report',
      module: 'interview_screening', feature: 'evaluation_report'
    });

    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const report = JSON.parse(match[0]);
      return report;
    }
  } catch (err) {
    console.error('[screening] AI report generation failed:', err.message);
  }

  // Fallback basic report
  const avgResponseLen = responses.reduce((sum, r) => sum + (r?.response_text?.length || 0), 0) / Math.max(responses.length, 1);
  const answeredCount = responses.filter(r => r?.response_text?.length > 20).length;
  const completionRate = (answeredCount / Math.max(questions.length, 1)) * 100;
  const baseScore = Math.min(100, Math.round(completionRate * 0.6 + Math.min(avgResponseLen / 5, 40)));

  return {
    question_scores: questions.map((q, i) => ({
      question_index: i,
      score: responses[i]?.response_text ? Math.round(baseScore * (0.8 + Math.random() * 0.4)) : 0,
      feedback: responses[i]?.response_text ? 'Response provided' : 'No response'
    })),
    communication_clarity: { score: baseScore, feedback: 'AI analysis unavailable — basic scoring applied' },
    technical_depth: { score: baseScore, feedback: 'AI analysis unavailable — basic scoring applied' },
    confidence_enthusiasm: { score: baseScore, indicators: ['Completed screening'] },
    red_flags: answeredCount < questions.length ? ['Did not answer all questions'] : [],
    strengths: answeredCount > 0 ? ['Completed the screening'] : [],
    overall_score: baseScore,
    recommendation: baseScore >= 70 ? 'advance' : baseScore >= 50 ? 'consider' : 'decline',
    recommendation_reasoning: `Candidate answered ${answeredCount}/${questions.length} questions. AI detailed analysis unavailable at this time.`
  };
}

// ============ MULTI-AGENT EVALUATION ============

/**
 * Run 3 independent AI evaluators + synthesis on interview/screening data
 */
async function runMultiEvaluation(candidateId, jobId, companyId, context) {
  const aiProvider = require('../lib/ai-provider');
  const { interviewId, screeningSessionId, conversation, responses, jobTitle, jobDescription } = context;

  // Build the interview transcript for evaluators
  let transcript = '';
  if (conversation && conversation.length > 0) {
    transcript = conversation.map(m =>
      `${m.role === 'candidate' ? 'Candidate' : 'Interviewer'}: ${m.text}`
    ).join('\n\n');
  } else if (responses && responses.length > 0) {
    transcript = responses.map((r, i) =>
      `Q${i+1}: ${r.question || 'Question'}\nCandidate: ${r.response_text || '(no response)'}`
    ).join('\n\n');
  }

  if (!transcript || transcript.length < 50) {
    return null; // Not enough data to evaluate
  }

  const jobCtx = `Role: ${jobTitle || 'Not specified'}\n${jobDescription ? 'Description: ' + jobDescription.substring(0, 1000) : ''}`;

  // Run 3 evaluators in parallel
  const evaluatorPrompts = {
    technical: `You are a TECHNICAL SKILLS evaluator. Assess ONLY technical competency and domain knowledge.
${jobCtx}

Interview Transcript:
${transcript}

Return JSON only:
{"score": 0-100, "breakdown": {"domain_knowledge": 0-100, "problem_solving": 0-100, "technical_communication": 0-100, "depth_of_experience": 0-100}, "reasoning": "2-3 sentences", "key_observations": ["list 3-5 specific observations"]}`,

    culture: `You are a CULTURE FIT and COMMUNICATION evaluator. Assess ONLY interpersonal skills, communication style, and cultural alignment.
${jobCtx}

Interview Transcript:
${transcript}

Return JSON only:
{"score": 0-100, "breakdown": {"communication_clarity": 0-100, "enthusiasm": 0-100, "team_orientation": 0-100, "professionalism": 0-100}, "reasoning": "2-3 sentences", "key_observations": ["list 3-5 specific observations"]}`,

    experience: `You are an EXPERIENCE and GROWTH POTENTIAL evaluator. Assess ONLY career trajectory, relevant experience, and future potential.
${jobCtx}

Interview Transcript:
${transcript}

Return JSON only:
{"score": 0-100, "breakdown": {"relevance_of_experience": 0-100, "career_progression": 0-100, "learning_agility": 0-100, "leadership_potential": 0-100}, "reasoning": "2-3 sentences", "key_observations": ["list 3-5 specific observations"]}`
  };

  const evaluations = {};
  const evaluatorTypes = ['technical', 'culture', 'experience'];

  // Run in parallel with fallbacks
  const results = await Promise.allSettled(
    evaluatorTypes.map(type =>
      aiProvider.chat(evaluatorPrompts[type], {
        maxTokens: 1000,
        task: `multi-eval-${type}`,
        module: 'interview_evaluation', feature: `evaluator_${type}`
      })
    )
  );

  for (let i = 0; i < evaluatorTypes.length; i++) {
    const type = evaluatorTypes[i];
    if (results[i].status === 'fulfilled') {
      try {
        const match = results[i].value.match(/\{[\s\S]*\}/);
        if (match) {
          evaluations[type] = JSON.parse(match[0]);
        }
      } catch (e) {
        console.error(`[multi-eval] Failed to parse ${type} evaluation:`, e.message);
      }
    } else {
      console.error(`[multi-eval] ${type} evaluator failed:`, results[i].reason?.message);
    }
  }

  // Provide fallback scores for any failed evaluators
  for (const type of evaluatorTypes) {
    if (!evaluations[type]) {
      evaluations[type] = {
        score: 50,
        breakdown: {},
        reasoning: 'AI evaluation unavailable — using neutral score',
        key_observations: ['Evaluator was unable to process this response']
      };
    }
  }

  // Save individual evaluations
  for (const type of evaluatorTypes) {
    await pool.query(
      `INSERT INTO interview_evaluations
       (interview_id, screening_session_id, candidate_id, job_id, company_id, evaluator_type, score, max_score, breakdown, reasoning)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 100, $8, $9)`,
      [
        interviewId || null,
        screeningSessionId || null,
        candidateId,
        jobId,
        companyId,
        type,
        evaluations[type].score,
        JSON.stringify(evaluations[type].breakdown || {}),
        evaluations[type].reasoning || ''
      ]
    );
  }

  // Synthesis: weighted composite
  const techScore = evaluations.technical.score || 50;
  const cultureScore = evaluations.culture.score || 50;
  const expScore = evaluations.experience.score || 50;
  const compositeScore = Math.round(techScore * 0.4 + cultureScore * 0.3 + expScore * 0.3);

  // Recommendation logic
  let recommendation = 'consider';
  let recReasoning = '';
  if (compositeScore >= 75) {
    recommendation = 'strong_hire';
    recReasoning = `Strong candidate (${compositeScore}/100). Technical: ${techScore}, Culture: ${cultureScore}, Experience: ${expScore}.`;
  } else if (compositeScore >= 60) {
    recommendation = 'hire';
    recReasoning = `Solid candidate (${compositeScore}/100) with room for growth. Worth advancing to next round.`;
  } else if (compositeScore >= 45) {
    recommendation = 'consider';
    recReasoning = `Mixed signals (${compositeScore}/100). May be worth a second look depending on candidate pool.`;
  } else {
    recommendation = 'no_hire';
    recReasoning = `Below threshold (${compositeScore}/100). Significant gaps identified.`;
  }

  // Save composite score
  await pool.query(
    `INSERT INTO interview_composite_scores
     (interview_id, screening_session_id, candidate_id, job_id, company_id,
      technical_score, culture_score, experience_score, composite_score,
      recommendation, recommendation_reasoning)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      interviewId || null,
      screeningSessionId || null,
      candidateId,
      jobId,
      companyId,
      techScore,
      cultureScore,
      expScore,
      compositeScore,
      recommendation,
      recReasoning
    ]
  );

  // Feed into OmniScore
  try {
    await omniscoreService.addInterviewComponent(candidateId, interviewId || `screening-${screeningSessionId}`, compositeScore / 10);
    console.log(`[multi-eval] OmniScore updated for candidate ${candidateId}: ${compositeScore}/100`);
  } catch (err) {
    console.error('[multi-eval] OmniScore update failed:', err.message);
  }

  return {
    evaluations,
    composite: {
      technical_score: techScore,
      culture_score: cultureScore,
      experience_score: expScore,
      composite_score: compositeScore,
      recommendation,
      recommendation_reasoning: recReasoning
    }
  };
}

module.exports = {
  suggestSlots,
  createReminders,
  suggestRescheduleSlots,
  generateScreeningQuestions,
  generateScreeningReport,
  runMultiEvaluation
};
