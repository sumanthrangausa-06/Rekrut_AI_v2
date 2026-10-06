/**
 * Task 5 (#323) — Track B observer: Q&A extraction + analysis.
 *
 * The muted observer agent persists a speaker-labeled transcript to
 * interview_sessions.config.observer_transcript (Task 3). This module turns
 * that free-form transcript into scored Q&A pairs and runs the SAME analysis
 * stack as the mock interview (generateScreeningReport + background
 * runMultiEvaluation) — per Sumanth's scope decision, not a new analysis
 * system.
 */

const aiProvider = require('../lib/ai-provider');
const { generateScreeningReport, runMultiEvaluation } = require('./interview-ai');

/**
 * Default rubric weights, mirroring the 5 evaluation dimensions in
 * generateScreeningReport's prompt. Used when the recruiter has not defined
 * rubric_weights on the job's interview flow. Sums to 100.
 */
const DEFAULT_RUBRIC_WEIGHTS = {
	can_do_the_work: 30,
	wants_the_move: 15,
	logistics_fit: 10,
	communication_quality: 25,
	technical_depth: 20,
};

/**
 * Extract interviewer-question / candidate-answer pairs from a free-form,
 * speaker-labeled transcript.
 *
 * @param {Array<{speaker: string, text: string, at?: string}>} transcript
 * @returns {Promise<Array<{question: string, answer: string, asker: string, answerer: string}>>}
 *   Never throws: returns [] when the transcript is empty, the LLM fails,
 *   or its output is not parseable — a partial/failed extraction must never
 *   break the observer pipeline.
 */
async function extractQAPairs(transcript) {
	if (!Array.isArray(transcript) || transcript.length === 0) {
		return [];
	}

	const lines = transcript
		.filter((t) => t && typeof t.text === 'string' && t.text.trim().length > 0)
		.map((t) => `${t.speaker || 'unknown'}: ${t.text.trim()}`);
	if (lines.length === 0) {
		return [];
	}

	const prompt = `You are analyzing a transcript of a human job interview between a recruiter/hiring manager and a candidate. The transcript is labeled with speaker identities.

Identify each interview question asked and the candidate's answer to it. Ignore greetings, small talk, and closing remarks.

TRANSCRIPT:
${lines.join('\n')}

Return ONLY a JSON array (no markdown fences, no commentary). Each element:
{"question": "<the interviewer's question>", "answer": "<the candidate's answer, or empty string if unanswered>", "asker": "<speaker identity who asked>", "answerer": "<speaker identity who answered>"}

If the transcript contains no real interview questions, return [].`;

	let raw;
	try {
		raw = await aiProvider.chat(prompt, {
			module: 'qa_extraction',
			feature: 'track_b_observer',
		});
	} catch (err) {
		console.error('[qa-extraction] LLM extraction failed:', err.message);
		return [];
	}

	return parseQAPairs(raw);
}

/**
 * Parse and validate the LLM's Q&A output. Defensive: anything that is not
 * a JSON array of {question, answer} objects is discarded.
 */
function parseQAPairs(raw) {
	if (typeof raw !== 'string' || raw.trim().length === 0) {
		return [];
	}
	let parsed;
	try {
		parsed = JSON.parse(raw.trim());
	} catch {
		// Try to salvage a JSON array embedded in prose.
		const match = raw.match(/\[[\s\S]*\]/);
		if (!match) return [];
		try {
			parsed = JSON.parse(match[0]);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) {
		return [];
	}
	return parsed
		.filter(
			(p) =>
				p &&
				typeof p.question === 'string' &&
				p.question.trim().length > 0 &&
				typeof p.answer === 'string',
		)
		.map((p) => ({
			question: p.question.trim(),
			answer: p.answer.trim(),
			asker: typeof p.asker === 'string' && p.asker ? p.asker : 'interviewer',
			answerer: typeof p.answerer === 'string' && p.answerer ? p.answerer : 'candidate',
		}));
}

/**
 * Resolve which rubric weights the report used.
 * @returns {{weights: object, source: 'recruiter'|'default'}}
 */
function resolveRubricWeights(rubricWeights) {
	const isNonEmptyObject =
		rubricWeights && typeof rubricWeights === 'object' && Object.keys(rubricWeights).length > 0;
	return isNonEmptyObject
		? { weights: rubricWeights, source: 'recruiter' }
		: { weights: { ...DEFAULT_RUBRIC_WEIGHTS }, source: 'default' };
}

/**
 * Run the mock-interview analysis stack over extracted Q&A pairs.
 *
 * @param {object} args
 * @param {object} args.session - interview_sessions row (id, candidate_id, job_id, company_id)
 * @param {Array} args.qaPairs - from extractQAPairs
 * @param {object} [args.rubricWeights] - from the job's interview_flows row
 * @param {object} [args.job] - {title, description}
 * @returns {Promise<object>} the screening-style report, with
 *   rubric_weights_used + rubric_source attached.
 */
async function analyzeObserverSession({ session, qaPairs, rubricWeights, job = {} }) {
	const pairs = Array.isArray(qaPairs) ? qaPairs : [];

	// Map Q&A pairs onto the conversation shape the analysis stack expects.
	const conversation = [];
	for (const p of pairs) {
		conversation.push({ role: 'interviewer', text: p.question });
		conversation.push({ role: 'candidate', text: p.answer });
	}
	const questions = pairs.map((p) => ({ question_text: p.question }));
	const responses = pairs.map((p) => ({ response_text: p.answer }));

	const { weights, source } = resolveRubricWeights(rubricWeights);

	// I1 (#323): the resolved weights are USED in scoring (threaded into the
	// prompt), not just stamped on the report.
	const report = await generateScreeningReport(
		{ conversation, questions, responses },
		{ rubricWeights: weights, rubricSource: source },
	);

	report.rubric_weights_used = weights;
	report.rubric_source = source;

	// Multi-evaluator scoring in the background — mirrors the screening
	// complete flow. Never blocks or fails the primary report (also guards
	// against a synchronous throw from the evaluator).
	Promise.resolve()
		.then(() =>
			runMultiEvaluation(session.candidate_id, session.job_id, session.company_id, {
				interviewId: session.id,
				conversation,
				responses,
				jobTitle: job.title,
				jobDescription: job.description,
			}),
		)
		.catch((err) =>
			console.error('[qa-extraction] background multi-evaluation failed:', err.message),
		);

	return report;
}

module.exports = {
	extractQAPairs,
	analyzeObserverSession,
	parseQAPairs,
	DEFAULT_RUBRIC_WEIGHTS,
};
