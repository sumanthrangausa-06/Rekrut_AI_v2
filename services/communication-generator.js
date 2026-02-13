// AI Communication Generator — drafts outreach, follow-ups, rejections, offer letters
const { chat, safeParseJSON } = require('../lib/polsia-ai');
const pool = require('../lib/db');

// ─── COMMUNICATION TYPE GENERATORS ──────────────────────────────────────

async function generateOutreach({ candidate, job, tone = 'professional', companyName, recruiterName }) {
  const candidateContext = buildCandidateContext(candidate);
  const jobContext = buildJobContext(job);

  const prompt = `You are an expert recruiter writing a personalized outreach message to a potential candidate.

CANDIDATE:
${candidateContext}

JOB OPPORTUNITY:
${jobContext}

COMPANY: ${companyName || 'Our company'}
RECRUITER: ${recruiterName || 'The recruiting team'}
TONE: ${tone}

Write a compelling, personalized outreach message that:
1. References specific details from the candidate's background (skills, experience, achievements)
2. Explains why they'd be a great fit for THIS specific role
3. Highlights 1-2 key benefits of the role/company
4. Ends with a clear, low-pressure call to action
5. Feels human, not templated

${toneInstructions(tone)}

Return JSON:
{
  "subject": "Email subject line (concise, personal — NOT generic like 'Exciting Opportunity')",
  "body": "The full message body (use \\n for line breaks, keep it 150-250 words)",
  "personalization_notes": "What specific candidate details you referenced",
  "confidence_score": 1-10
}

Only return JSON.`;

  return callAI(prompt, 'recruiter-outreach');
}

async function generateFollowUp({ candidate, job, previousComms, daysSinceLastContact, tone = 'friendly', companyName }) {
  const candidateContext = buildCandidateContext(candidate);
  const lastComm = previousComms && previousComms.length > 0 ? previousComms[previousComms.length - 1] : null;

  const prompt = `You are a recruiter writing a follow-up message to a candidate who hasn't responded.

CANDIDATE:
${candidateContext}

JOB: ${job?.title || 'Open position'} at ${companyName || 'our company'}
DAYS SINCE LAST CONTACT: ${daysSinceLastContact || 'Unknown'}
PREVIOUS MESSAGE: ${lastComm ? lastComm.body?.substring(0, 500) : 'Initial outreach was sent'}
TOTAL FOLLOW-UPS SENT: ${previousComms ? previousComms.length : 0}
TONE: ${tone}

Write a follow-up that:
1. Doesn't repeat the previous message
2. Adds NEW value (industry insight, team update, deadline mention)
3. Acknowledges they're busy without being passive-aggressive
4. Keeps it shorter than the original outreach (80-120 words)
5. Has a different call to action than last time

${toneInstructions(tone)}

Return JSON:
{
  "subject": "Re: [reference original subject or new angle]",
  "body": "The follow-up message (use \\n for line breaks)",
  "strategy": "What approach you used (value-add, urgency, social-proof, etc.)",
  "confidence_score": 1-10
}

Only return JSON.`;

  return callAI(prompt, 'recruiter-follow-up');
}

async function generateRejection({ candidate, job, reason, feedback, tone = 'empathetic', companyName }) {
  const reasonMap = {
    'experience': 'insufficient experience for the role requirements',
    'skills': 'missing key technical skills required for the position',
    'culture_fit': 'alignment with team culture and working style',
    'other_candidate': 'another candidate was a stronger match for specific requirements',
    'position_filled': 'the position has been filled',
    'position_closed': 'the position has been put on hold',
    'salary': 'compensation expectations did not align',
    'location': 'location/remote work requirements did not align',
    'other': reason || 'the role requirements'
  };

  const reasonText = reasonMap[reason] || reason || 'other candidates were a stronger match';

  const prompt = `You are a recruiter writing a professional rejection email that maintains a positive relationship.

CANDIDATE: ${candidate?.name || 'Candidate'}
JOB: ${job?.title || 'The position'} at ${companyName || 'our company'}
REASON: ${reasonText}
ADDITIONAL FEEDBACK: ${feedback || 'None provided'}
TONE: ${tone}

Write a rejection email that:
1. Thanks them genuinely for their time and interest
2. Delivers the decision clearly (no ambiguity)
3. Provides brief, constructive feedback if available
4. Encourages them to apply for future roles (if appropriate)
5. Maintains their dignity — they may be a future customer, referral, or re-applicant
6. Is concise (100-150 words)

NEVER:
- Use phrases like "Unfortunately" as the opening word
- Be vague about the decision
- Make false promises about future roles
- Include discriminatory language

Return JSON:
{
  "subject": "Email subject (professional, not devastating)",
  "body": "The rejection email (use \\n for line breaks)",
  "feedback_included": true/false,
  "tone_check": "Assessment of the tone — is it empathetic but clear?",
  "confidence_score": 1-10
}

Only return JSON.`;

  return callAI(prompt, 'recruiter-rejection');
}

async function generateOfferLetter({ candidate, job, compensation, benefits, startDate, reportingTo, companyName, location, employmentType }) {
  const prompt = `You are an HR professional drafting a formal offer letter.

CANDIDATE: ${candidate?.name || 'Candidate'}
POSITION: ${job?.title || 'Position'}
COMPANY: ${companyName || 'Company'}
EMPLOYMENT TYPE: ${employmentType || 'Full-time'}
LOCATION: ${location || 'To be confirmed'}
REPORTING TO: ${reportingTo || 'Hiring Manager'}
START DATE: ${startDate || 'To be confirmed'}

COMPENSATION:
- Base Salary: ${compensation?.salary || 'To be confirmed'}
- Bonus: ${compensation?.bonus || 'N/A'}
- Equity: ${compensation?.equity || 'N/A'}
- Sign-on Bonus: ${compensation?.signOnBonus || 'N/A'}

BENEFITS:
${benefits || '- Standard company benefits package'}

Write a complete, professional offer letter that:
1. Opens with enthusiasm about extending the offer
2. Clearly states all compensation details
3. Lists key benefits
4. Specifies start date and reporting structure
5. Includes standard clauses (at-will employment, contingencies)
6. Has a professional sign-off with signature line
7. Includes a response deadline (2 weeks from today)

Return JSON:
{
  "subject": "Offer of Employment — [Position] at [Company]",
  "body": "The complete offer letter (use \\n for line breaks, use proper formatting)",
  "html_body": "HTML version of the offer letter with proper formatting (headers, bold, sections)",
  "key_terms": {
    "salary": "stated salary",
    "start_date": "stated start date",
    "response_deadline": "2 weeks from now"
  },
  "compliance_notes": "Any legal considerations for this offer",
  "confidence_score": 1-10
}

Only return JSON.`;

  return callAI(prompt, 'offer-letter');
}

async function generateInterviewConfirmation({ candidate, job, interviewDate, interviewType, interviewerName, location, companyName }) {
  const prompt = `Write a professional interview confirmation email.

CANDIDATE: ${candidate?.name || 'Candidate'}
POSITION: ${job?.title || 'Position'} at ${companyName || 'our company'}
INTERVIEW DATE: ${interviewDate || 'To be confirmed'}
TYPE: ${interviewType || 'Video call'}
INTERVIEWER: ${interviewerName || 'The hiring team'}
LOCATION/LINK: ${location || 'Video link will be sent separately'}

Include:
1. Confirmation of date/time/format
2. What to prepare
3. Who they'll meet
4. How long it will take
5. Contact info for questions

Return JSON:
{
  "subject": "Interview Confirmation — [Position]",
  "body": "The confirmation email (use \\n for line breaks, 100-150 words)",
  "confidence_score": 1-10
}

Only return JSON.`;

  return callAI(prompt, 'interview-confirmation');
}

// ─── MULTI-AGENT PIPELINE ───────────────────────────────────────────────

async function runCommunicationPipeline({ draft, candidate, job, companyName, type }) {
  // Stage 1: Personalization — enrich with candidate-specific details
  const personalized = await personalizeMessage(draft, candidate);

  // Stage 2: Tone check — ensure appropriate tone for the message type
  const toneChecked = await checkTone(personalized, type);

  // Stage 3: Compliance — check for discriminatory language, legal issues
  const compliant = await checkCompliance(toneChecked, type);

  return {
    final_message: compliant.message,
    pipeline_results: {
      personalization: personalized.changes,
      tone_check: toneChecked.assessment,
      compliance: compliant.assessment,
      passed_all_checks: compliant.passed && toneChecked.passed
    }
  };
}

async function personalizeMessage(draft, candidate) {
  if (!candidate) return { message: draft, changes: 'No candidate data available for personalization' };

  const prompt = `Review this recruiter message and add personalization based on candidate data.

MESSAGE:
${typeof draft === 'string' ? draft : draft.body}

CANDIDATE DATA:
- Name: ${candidate.name || 'Unknown'}
- Skills: ${candidate.skills || 'Unknown'}
- Experience: ${candidate.years_experience || 'Unknown'} years
- Location: ${candidate.location || 'Unknown'}
- Current/Recent Role: ${candidate.headline || 'Unknown'}

If the message already references candidate-specific details, keep it. If it's generic, add 1-2 specific references to their background.

Return JSON:
{
  "message": "The personalized message",
  "changes": "What was personalized or 'Already well-personalized'"
}

Only return JSON.`;

  const result = await callAI(prompt, 'personalization-agent');
  return result || { message: typeof draft === 'string' ? draft : draft.body, changes: 'Personalization unavailable' };
}

async function checkTone(messageData, type) {
  const expectedTones = {
    outreach: 'engaging, professional, not pushy',
    follow_up: 'friendly, persistent but respectful, not desperate',
    rejection: 'empathetic, clear, constructive',
    offer_letter: 'enthusiastic, professional, formal',
    interview_confirmation: 'professional, helpful, clear',
    custom: 'appropriate for context'
  };

  const prompt = `You are a tone analysis agent. Check if this recruiter message has the right tone.

MESSAGE:
${typeof messageData === 'string' ? messageData : messageData.message || messageData}

MESSAGE TYPE: ${type}
EXPECTED TONE: ${expectedTones[type] || 'professional'}

Evaluate:
1. Is the tone appropriate for a ${type} message?
2. Are there any phrases that could come across as rude, desperate, or robotic?
3. Is it professional enough without being cold?

Return JSON:
{
  "passed": true/false,
  "assessment": "Brief tone assessment",
  "message": "The message (modified if needed, or original if fine)",
  "suggestions": ["suggestion if any"]
}

Only return JSON.`;

  const result = await callAI(prompt, 'tone-check-agent');
  return result || { passed: true, assessment: 'Tone check unavailable', message: typeof messageData === 'string' ? messageData : messageData.message || messageData, suggestions: [] };
}

async function checkCompliance(messageData, type) {
  const prompt = `You are a compliance agent reviewing a recruiter message for legal and policy issues.

MESSAGE:
${typeof messageData === 'string' ? messageData : messageData.message || messageData}

MESSAGE TYPE: ${type}

Check for:
1. Age discrimination language (e.g., "young team", "digital native", "recent graduate preferred")
2. Gender-biased language (e.g., "he/she" assumptions, gendered terms)
3. Race/ethnicity references
4. Disability-related assumptions
5. False promises or misleading claims
6. Missing required legal disclaimers (for offer letters)
7. Overly aggressive or pressuring language

Return JSON:
{
  "passed": true/false,
  "assessment": "Brief compliance assessment",
  "message": "The message (modified if issues found, or original if clean)",
  "flags": ["Any compliance flags found"],
  "severity": "none|low|medium|high"
}

Only return JSON.`;

  const result = await callAI(prompt, 'compliance-agent');
  return result || { passed: true, assessment: 'Compliance check unavailable', message: typeof messageData === 'string' ? messageData : messageData.message || messageData, flags: [], severity: 'none' };
}

// ─── HELPERS ────────────────────────────────────────────────────────────

function buildCandidateContext(candidate) {
  if (!candidate) return 'No candidate data available';
  const parts = [];
  if (candidate.name) parts.push(`Name: ${candidate.name}`);
  if (candidate.email) parts.push(`Email: ${candidate.email}`);
  if (candidate.headline) parts.push(`Headline: ${candidate.headline}`);
  if (candidate.bio) parts.push(`Bio: ${candidate.bio}`);
  if (candidate.skills) parts.push(`Skills: ${typeof candidate.skills === 'string' ? candidate.skills : JSON.stringify(candidate.skills)}`);
  if (candidate.years_experience) parts.push(`Experience: ${candidate.years_experience} years`);
  if (candidate.location) parts.push(`Location: ${candidate.location}`);
  if (candidate.education) parts.push(`Education: ${typeof candidate.education === 'string' ? candidate.education : JSON.stringify(candidate.education)}`);
  return parts.join('\n') || 'No candidate data available';
}

function buildJobContext(job) {
  if (!job) return 'No job data available';
  const parts = [];
  if (job.title) parts.push(`Title: ${job.title}`);
  if (job.company) parts.push(`Company: ${job.company}`);
  if (job.description) parts.push(`Description: ${job.description.substring(0, 800)}`);
  if (job.requirements) parts.push(`Requirements: ${job.requirements.substring(0, 500)}`);
  if (job.location) parts.push(`Location: ${job.location}`);
  if (job.salary_range) parts.push(`Salary: ${job.salary_range}`);
  if (job.job_type) parts.push(`Type: ${job.job_type}`);
  return parts.join('\n') || 'No job data available';
}

function toneInstructions(tone) {
  const tones = {
    formal: 'Use formal, corporate language. "Dear [Name]," opening. Professional sign-off.',
    professional: 'Professional but approachable. First-name basis. Clear and direct.',
    conversational: 'Casual and friendly. Like a colleague reaching out. Short sentences.',
    executive: 'Executive-level communication. Sophisticated vocabulary. Concise and impactful.',
    friendly: 'Warm and inviting. Personal touches. Encouraging tone.',
    empathetic: 'Compassionate and understanding. Acknowledge emotions. Supportive language.'
  };
  return `TONE GUIDE: ${tones[tone] || tones.professional}`;
}

async function callAI(prompt, module) {
  try {
    const result = await chat(prompt, {
      system: 'You are an expert recruiter communication specialist. Generate professional, personalized messages. Always return valid JSON only, no markdown fences.',
      maxTokens: 2048,
      module
    });
    return safeParseJSON(result);
  } catch (err) {
    console.error(`[communication-generator] ${module} failed:`, err.message);
    return null;
  }
}

// ─── COMMUNICATION HISTORY ─────────────────────────────────────────────

async function getCommunicationHistory(candidateId, companyId) {
  try {
    const result = await pool.query(`
      SELECT c.*,
        u_recruiter.name as recruiter_name,
        u_candidate.name as candidate_name,
        j.title as job_title
      FROM communications c
      LEFT JOIN users u_recruiter ON c.recruiter_id = u_recruiter.id
      LEFT JOIN users u_candidate ON c.candidate_id = u_candidate.id
      LEFT JOIN jobs j ON c.job_id = j.id
      WHERE c.candidate_id = $1 AND c.company_id = $2
      ORDER BY c.created_at DESC
    `, [candidateId, companyId]);
    return result.rows;
  } catch (err) {
    console.error('[communication-generator] History fetch failed:', err.message);
    return [];
  }
}

async function saveCommunication({ companyId, recruiterId, candidateId, jobId, type, subject, body, tone, status, metadata, parentId, sequenceId, sequenceStep }) {
  try {
    const result = await pool.query(`
      INSERT INTO communications (company_id, recruiter_id, candidate_id, job_id, type, subject, body, tone, status, metadata, parent_id, sequence_id, sequence_step)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [companyId, recruiterId, candidateId, jobId, type, subject, body, tone || 'professional', status || 'draft', JSON.stringify(metadata || {}), parentId, sequenceId, sequenceStep]);
    return result.rows[0];
  } catch (err) {
    console.error('[communication-generator] Save failed:', err.message);
    return null;
  }
}

async function markCommunicationSent(commId) {
  try {
    await pool.query(`UPDATE communications SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = $1`, [commId]);
    return true;
  } catch (err) {
    console.error('[communication-generator] Mark sent failed:', err.message);
    return false;
  }
}

module.exports = {
  generateOutreach,
  generateFollowUp,
  generateRejection,
  generateOfferLetter,
  generateInterviewConfirmation,
  runCommunicationPipeline,
  personalizeMessage,
  checkTone,
  checkCompliance,
  getCommunicationHistory,
  saveCommunication,
  markCommunicationSent,
};
