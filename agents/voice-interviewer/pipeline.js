// =============================================================================
// Voice Interviewer — Turn Pipeline (Phase 2, #323)
//
// Pure turn logic for the LiveKit voice agent. Zero LiveKit imports: STT, TTS,
// the interview engine, and session persistence are injected, so this module
// is fully unit-testable. The LiveKit wiring (room join, VAD loop, audio
// publish, barge-in) lives in worker.mjs and adapts these pipelines.
//
// Two modes:
//   - interviewer (Track A): candidate speaks -> STT -> conductTurn -> TTS.
//     The Phase 1 engine (services/conversation-engine.js) stays the brain;
//     this pipeline is ears and mouth only.
//   - observer (Track B): muted. Both sides' speech -> STT -> speaker-labeled
//     transcript. No TTS, ever.
// =============================================================================

'use strict';

// ─── VAD tuning ──────────────────────────────────────────────────────────────
// Conservative barge-in: the agent yields the floor. minSilenceDuration is the
// "yield delay" — trailing silence required before the agent treats speech as
// a finished utterance and cuts in. Units are milliseconds (Silero plugin).
const VAD_CONFIG = {
	/** Ignore sub-100ms blips so noise/coughs don't start a turn. */
	minSpeechDuration: 100,
	/** Yield delay: wait 600ms of trailing silence before cutting in. */
	minSilenceDuration: 600,
	/** Keep 500ms of pre-speech audio so word onsets aren't clipped. */
	prefixPaddingDuration: 500,
	/** Cap a single buffered utterance at 60s. */
	maxBufferedSpeech: 60000,
	/** Silero supports 8kHz/16kHz; 16kHz is the Whisper-friendly choice. */
	sampleRate: 16000,
};

// Spoken when STT returns empty/garbage. The engine is never fed silence.
const REPROMPT_TEXT = "Sorry, I didn't quite catch that — could you say that again?";

// ─── Agent registration name ─────────────────────────────────────────────────
// MUST match getVoiceAgentName() in server/services/livekit.js — Task 2's
// dispatch targets this name, and a mismatch means dispatch succeeds with no
// agent joining. Both read the same env var with the same default; the deploy
// README instructs passing LIVEKIT_AGENT_NAME explicitly when customized.
function getAgentName() {
	return process.env.LIVEKIT_AGENT_NAME || 'rekrut-interviewer';
}

// ─── Dispatch metadata ───────────────────────────────────────────────────────
// Task 2 dispatches with metadata: {"interview_session_id": <n>, "mode": ...}.
function parseDispatchMetadata(metadata) {
	let parsed;
	try {
		parsed = JSON.parse(metadata);
	} catch (err) {
		throw new Error(`voice-interviewer: dispatch metadata is not valid JSON: ${err.message}`);
	}
	const interviewSessionId = Number(parsed.interview_session_id);
	if (!Number.isInteger(interviewSessionId) || interviewSessionId <= 0) {
		throw new Error(
			'voice-interviewer: dispatch metadata missing a valid interview_session_id',
		);
	}
	if (parsed.mode !== 'interviewer' && parsed.mode !== 'observer') {
		throw new Error(
			`voice-interviewer: unknown mode "${parsed.mode}" — expected "interviewer" or "observer"`,
		);
	}
	return { interviewSessionId, mode: parsed.mode };
}

function newTimestamp() {
	return new Date().toISOString();
}

// Mirrors the config-advance logic in routes/interview-sessions.js so the
// voice transport and the HTTP transport move the interview identically.
function advanceConfig(config, turnResult) {
	const next = { ...(config || {}) };
	if (next.question_source === 'personalized') {
		const total = Array.isArray(next.base_questions) ? next.base_questions.length : 0;
		next.current_question_index = Math.min((next.current_question_index || 0) + 1, total);
	} else {
		next.current_phase = turnResult.phase;
	}
	return next;
}

// ─── Track A: interviewer pipeline ───────────────────────────────────────────

/**
 * @param {Object} deps
 * @param {(audioBuffer: Buffer) => Promise<string|null>} deps.transcribe — STT, resolves transcript text
 * @param {(text: string, opts?: Object) => Promise<Buffer>} deps.synthesize — TTS, resolves audio bytes
 * @param {(session, candidateText, frames) => Promise<{ai_message, phase, is_complete}>} deps.conductTurn
 * @param {(session) => Promise<void>} deps.persistSession — writes the session row (crash-resume safety)
 */
function createInterviewerPipeline({ transcribe, synthesize, conductTurn, persistSession }) {
	return {
		vadConfig: VAD_CONFIG,

		/**
		 * Process one finished candidate utterance.
		 * @returns {Promise<{type: 'reply'|'reprompt', text, audioBuffer, updatedSession, isComplete}>}
		 */
		async processUtterance({ audioBuffer, session }) {
			const raw = await transcribe(audioBuffer);
			const text = (raw || '').trim();

			// Empty/garbage STT: re-prompt via TTS. The engine never sees silence,
			// and nothing is persisted — a non-utterance is not a conversation turn.
			if (!text) {
				const audio = await synthesize(REPROMPT_TEXT, {});
				return {
					type: 'reprompt',
					text: REPROMPT_TEXT,
					audioBuffer: audio,
					updatedSession: session,
					isComplete: false,
				};
			}

			// Crash-resume safety (mirrors routes/interview-sessions.js): persist the
			// candidate's answer BEFORE the LLM call so a crash mid-turn never loses it.
			const conversation = [...(session.conversation || [])];
			conversation.push({ role: 'candidate', text, has_audio: true, timestamp: newTimestamp() });
			await persistSession({ ...session, conversation });

			const result = await conductTurn({ conversation, config: session.config || {} }, text, null);
			const replyText = result.ai_message || '';
			conversation.push({
				role: 'interviewer',
				text: replyText,
				phase: result.phase,
				timestamp: newTimestamp(),
			});
			const updatedSession = {
				...session,
				conversation,
				config: advanceConfig(session.config, result),
			};
			await persistSession(updatedSession);

			const audio = await synthesize(replyText, {});
			return {
				type: 'reply',
				text: replyText,
				audioBuffer: audio,
				updatedSession,
				isComplete: !!result.is_complete,
			};
		},
	};
}

// ─── Track B: observer pipeline ──────────────────────────────────────────────

/**
 * Muted observer: subscribes to both sides' audio, transcribes with speaker
 * labels from LiveKit participant identities. Never synthesizes audio.
 */
function createObserverPipeline({ transcribe }) {
	const transcript = [];
	return {
		vadConfig: VAD_CONFIG,

		/** @returns {Array<{speaker, text, at}>} — the accumulated speaker-labeled transcript. */
		getTranscript() {
			return [...transcript];
		},

		/**
		 * @param {Object} args
		 * @param {Buffer} args.audioBuffer — one finished utterance
		 * @param {string} args.speaker — LiveKit participant identity (no ML diarization needed)
		 * @returns {Promise<{speaker, text, at}|null>} — null when STT heard nothing (not appended)
		 */
		async processUtterance({ audioBuffer, speaker }) {
			const raw = await transcribe(audioBuffer);
			const text = (raw || '').trim();
			if (!text) return null;
			const entry = { speaker, text, at: newTimestamp() };
			transcript.push(entry);
			return entry;
		},
	};
}

// ─── Audio helpers ───────────────────────────────────────────────────────────

/**
 * Encode 16-bit PCM samples as a WAV buffer for Whisper (audio/wav).
 * Pure function — the worker feeds it VAD-collected int16 frames.
 */
function pcmToWavBuffer(samples, sampleRate) {
	const dataSize = samples.length * 2;
	const buf = Buffer.alloc(44 + dataSize);
	buf.write('RIFF', 0);
	buf.writeUInt32LE(36 + dataSize, 4);
	buf.write('WAVE', 8);
	buf.write('fmt ', 12);
	buf.writeUInt32LE(16, 16); // fmt chunk size
	buf.writeUInt16LE(1, 20); // PCM
	buf.writeUInt16LE(1, 22); // mono
	buf.writeUInt32LE(sampleRate, 24);
	buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
	buf.writeUInt16LE(2, 32); // block align
	buf.writeUInt16LE(16, 34); // bits per sample
	buf.write('data', 36);
	buf.writeUInt32LE(dataSize, 40);
	Buffer.from(samples.buffer, samples.byteOffset, dataSize).copy(buf, 44);
	return buf;
}

module.exports = {
	VAD_CONFIG,
	REPROMPT_TEXT,
	getAgentName,
	parseDispatchMetadata,
	createInterviewerPipeline,
	createObserverPipeline,
	pcmToWavBuffer,
};
