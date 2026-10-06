/**
 * Unified conversation engine for Phase 1 conversational AI interviews (#322).
 *
 * Single entry point: conductTurn(session, candidateText, frames).
 *
 * The engine is a thin dispatcher. It does NOT duplicate the two existing
 * turn strategies:
 *  - screening sessions    -> conductScreeningTurn (services/interview-ai)
 *  - ai_interview sessions -> conductInterviewTurn (lib/polsia-ai)
 *
 * Session config is frozen at session creation; the engine branches on
 * session.config.question_source. Per-turn persistence (crash-resume safety)
 * is the endpoint layer's job — this function is pure conversation logic and
 * never mutates the session.
 *
 * Frames ride along on respond calls for the frame-analysis pipeline (Task 4);
 * they are not inputs to the turn prompt — neither wrapped turn function
 * accepts them.
 */

const { conductScreeningTurn } = require('./interview-ai');
const { conductInterviewTurn } = require('../lib/polsia-ai');

// 20s cap per spec: Render kills requests at ~30s, and the AI provider chain
// can hang far longer. The timeout guarantees we hit the scripted fallback
// BEFORE the request is killed. Same race pattern as routes/interviews.js.
const TURN_TIMEOUT_MS = 20000;

function withTimeout(promise, ms, label = 'Operation') {
	return Promise.race([
		promise,
		new Promise((_, reject) =>
			setTimeout(() => {
				reject(new Error(`${label} timed out after ${ms}ms`));
			}, ms),
		),
	]);
}

// Scripted fallback acknowledgments — never leave the candidate hanging when
// the provider throws or times out. Mirrors the NATURAL_ACKS rotation in the
// existing mock-interview respond path (routes/interviews.js).
const FALLBACK_ACKS = [
	'Thanks for that. Really helpful to understand your perspective.',
	'Appreciate you sharing that. It gives me good insight into how you think.',
	"Good to hear. That's exactly the kind of detail I was looking for.",
	'Understood. That paints a clear picture of your experience.',
	'Thanks for walking me through that. Let me ask you something else.',
];

const FALLBACK_QUESTION = "Let's continue — could you tell me a bit more about your experience?";

/**
 * Which question source drives this session?
 * 'template'     — standardized recruiter-defined topics (screening)
 * 'personalized' — JD + resume + role grounded questions (AI interview)
 * Defaults to 'template' when the config is absent.
 */
function selectQuestionSource(session) {
	return session?.config?.question_source === 'personalized' ? 'personalized' : 'template';
}

function candidateTurnCount(conversation) {
	return conversation.filter((t) => t.role === 'candidate').length;
}

// BUG FIX (restored from the old /mock + /mock/voice-respond shims): the LLM
// sometimes emits generic reactions ("Thank you for your response") instead of
// real acknowledgments. Replace them with natural ones, rotating by candidate
// turn count so they don't repeat.
//
// Note: the original shim regex had `\.?` inside the second alternative only,
// so "Thank you for your response." (with period) slipped through. Moved here
// so the optional period applies to all generic patterns — that's the evident
// intent of the original fix.
const GENERIC_REACTION_RE =
	/^(Thank you for (that|sharing|your) (response|answer)|That's (helpful|great|good|interesting))\.?\s*$/i;
const NATURAL_AI_ACKS = [
	'Interesting perspective. Let me follow up on that.',
	"That gives me good context. I'd like to dig a little deeper.",
	"That's a thoughtful response. Let me explore another angle.",
	'I appreciate the detail. Let me build on that.',
];

// Spoken message composition — same as the existing respond paths:
// "<reaction> <question>".
function composeMessage(turn, conversation = []) {
	let reaction = (turn?.reaction || '').trim();
	if (reaction && GENERIC_REACTION_RE.test(reaction)) {
		reaction = NATURAL_AI_ACKS[candidateTurnCount(conversation) % NATURAL_AI_ACKS.length];
	}
	const question = (turn?.question || '').trim();
	if (reaction && question) return `${reaction} ${question}`;
	return question || reaction;
}

function scriptedFallback(session, conversation, source, err) {
	console.warn(
		`[conversation-engine] ${source} turn failed (${err.message}), using scripted fallback`,
	);
	const config = session?.config || {};
	const ack = FALLBACK_ACKS[candidateTurnCount(conversation) % FALLBACK_ACKS.length];
	const question = config.fallback_question || FALLBACK_QUESTION;
	return {
		ai_message: `${ack} ${question}`,
		phase: config.current_phase || (source === 'personalized' ? 'interview' : 'screening'),
		is_complete: false,
	};
}

/**
 * Run one conversational turn.
 *
 * @param {Object} session - interview_sessions row shape: { conversation, config }
 * @param {string} candidateText - the candidate's latest message (appended to the
 *   working history if the caller hasn't appended it already; the session itself
 *   is never mutated)
 * @param {Array} _frames - captured video frames (passed through to the
 *   frame-analysis pipeline by the caller; not used by the turn prompt)
 * @returns {Promise<{ai_message: string, phase: string, is_complete: boolean}>}
 */
async function conductTurn(session, candidateText, _frames) {
	const stored = Array.isArray(session?.conversation) ? session.conversation : [];
	// Defensive: work on a copy with the candidate's latest turn included, so the
	// turn functions see it whether or not the caller appended it first.
	const conversation = [...stored];
	const lastTurn = conversation[conversation.length - 1];
	if (candidateText && (lastTurn?.role !== 'candidate' || lastTurn.text !== candidateText)) {
		conversation.push({ role: 'candidate', text: candidateText });
	}

	const source = selectQuestionSource(session);
	const config = session?.config || {};

	try {
		let turn;
		if (source === 'personalized') {
			turn = await withTimeout(
				conductInterviewTurn(
					conversation,
					config.base_questions || [],
					config.current_question_index || 0,
					config.target_role || '',
					config.options || {},
				),
				TURN_TIMEOUT_MS,
				'Interview AI turn generation',
			);
		} else {
			turn = await withTimeout(
				conductScreeningTurn(
					conversation,
					config.job || {},
					config.template || {},
					config.current_phase || 'intro',
				),
				TURN_TIMEOUT_MS,
				'Screening AI turn generation',
			);
		}

		return {
			ai_message: composeMessage(turn, conversation),
			phase:
				turn.phase ||
				config.current_phase ||
				(source === 'personalized' ? 'interview' : 'screening'),
			is_complete: turn.action === 'wrap_up',
		};
	} catch (err) {
		return scriptedFallback(session, conversation, source, err);
	}
}

module.exports = {
	conductTurn,
	selectQuestionSource,
	withTimeout,
	FALLBACK_ACKS,
	TURN_TIMEOUT_MS,
};
