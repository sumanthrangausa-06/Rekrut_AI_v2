const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  baseURL: process.env.POLSIA_API_URL || 'https://polsia.com/api/proxy/ai',
  apiKey: process.env.POLSIA_API_KEY,
});

async function chat(message, options = {}) {
  const response = await anthropic.messages.create({
    max_tokens: options.maxTokens || 8192,
    messages: [{ role: 'user', content: message }],
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

module.exports = {
  anthropic,
  chat,
  generateInterviewQuestions,
  analyzeInterviewResponse,
  generateOverallFeedback
};