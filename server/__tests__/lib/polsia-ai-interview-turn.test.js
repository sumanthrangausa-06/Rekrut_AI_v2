/**
 * Unit tests for buildInterviewTurnPrompt (lib/polsia-ai).
 *
 * #322: recruiter-triggered AI interviews freeze the JD + resume snapshot into
 * the session config; the conversation engine passes them through options so
 * turn-time prompts probe the candidate's actual experience.
 */

// lib/ai-provider opens a DB connection at import time (retries on
// ECONNREFUSED); stub it so this unit test stays hermetic.
jest.mock('../../../lib/ai-provider', () => ({
	transcribeAudio: jest.fn(),
}));

const { buildInterviewTurnPrompt } = require('../../../lib/polsia-ai');

const BASE_ARGS = {
	targetRole: 'Data Engineer',
	remainingCount: 3,
	convoText: 'INTERVIEWER: Tell me about yourself.\n\nCANDIDATE: I am a data engineer.',
	nextPlannedQuestion: 'Describe the hardest data problem you solved.',
	consecutiveFollowUps: 1,
	candidateTurnCount: 2,
};

// Verbatim pre-personalization template (from lib/polsia-ai.js before #322):
// when resumeText/jobDescription are absent the builder must produce exactly
// this string.
const PRE_PERSONALIZATION_TEMPLATE = `You are conducting a mock interview for a "Data Engineer" position. You have 3 planned questions remaining.

CONVERSATION SO FAR:
INTERVIEWER: Tell me about yourself.

CANDIDATE: I am a data engineer.

NEXT PLANNED QUESTION (use when ready to move on): "Describe the hardest data problem you solved."

FOLLOW-UP COUNT on current topic: 1

YOUR TASK: Act like a real interviewer. After the candidate answers:

1. **FOLLOW UP** if the answer is:
   - Vague or surface-level ("I worked on a project" → ask WHAT project, what was the challenge)
   - Missing specifics (no metrics, no concrete examples, no details about their role)
   - Interesting but unexplored (they mentioned something worth digging into)
   - Missing the "so what" (they described what happened but not the impact/result)
   You can ask MULTIPLE follow-ups on the same topic. Keep probing until you have real depth.

2. **TRANSITION** to the next planned question when:
   - The candidate gave a thorough, specific answer with concrete examples
   - You've already asked 2-3 follow-ups and have sufficient depth
   - The candidate clearly has nothing more to add on this topic

3. **WRAP UP** when: NOT YET — keep interviewing, only 2 exchanges so far

React to their answer specifically (1-2 sentences — reference something concrete they said, NOT generic filler like "Thank you for that response" or "That's helpful"). Show you actually listened. Example good reactions: "That 40% improvement in pipeline throughput is impressive — how did you measure that?" or "Interesting that you chose to refactor first rather than ship the feature." Example bad reactions: "Thank you for sharing that." or "That's great, thanks."

Return JSON: {"reaction":"1-2 sentences referencing SPECIFIC details from their answer","action":"follow_up|challenge|transition|wrap_up","question":"your next question","score_hint":1-10,"notes":"brief note on answer quality"}`;

describe('buildInterviewTurnPrompt', () => {
	test('prompt is byte-identical to the pre-personalization template when context is absent', () => {
		expect(buildInterviewTurnPrompt(BASE_ARGS)).toBe(PRE_PERSONALIZATION_TEMPLATE);
	});

	test('empty-string context is treated as absent', () => {
		const prompt = buildInterviewTurnPrompt({
			...BASE_ARGS,
			resumeText: '',
			jobDescription: '',
		});
		expect(prompt).toBe(PRE_PERSONALIZATION_TEMPLATE);
		expect(prompt).not.toContain('CANDIDATE RESUME');
		expect(prompt).not.toContain('JOB DESCRIPTION');
	});

	test('includes the resume and JD context blocks when provided', () => {
		const prompt = buildInterviewTurnPrompt({
			...BASE_ARGS,
			resumeText: 'Jane Doe: 5 years building Spark pipelines.',
			jobDescription: 'We need a Spark expert for real-time ingestion.',
		});

		expect(prompt).toContain('CANDIDATE RESUME - probe their ACTUAL experience');
		expect(prompt).toContain('Jane Doe: 5 years building Spark pipelines.');
		expect(prompt).toContain('JOB DESCRIPTION - the role being interviewed for');
		expect(prompt).toContain('We need a Spark expert for real-time ingestion.');
		// The context block sits between the header and the conversation.
		const headerEnd =
			prompt.indexOf('planned questions remaining.') + 'planned questions remaining.'.length;
		const convoStart = prompt.indexOf('CONVERSATION SO FAR:');
		const middle = prompt.slice(headerEnd, convoStart);
		expect(middle).toContain('CANDIDATE RESUME');
		expect(middle).toContain('JOB DESCRIPTION');
		// Everything after the context block is unchanged.
		expect(prompt).toContain('CONVERSATION SO FAR:\nINTERVIEWER: Tell me about yourself.');
	});
});
