// =============================================================================
// Voice Interviewer — LiveKit worker entry (Phase 2, #323)
//
// ESM (.mjs): @livekit/agents is ESM-only. Repo modules (CJS) load via
// createRequire. This file is the THIN LiveKit adapter — all turn logic lives
// in pipeline.js (unit-tested). Run: `node agents/voice-interviewer/worker.mjs`
//
// Registration name MUST equal getAgentName() in pipeline.js (which mirrors
// getVoiceAgentName() in server/services/livekit.js): Task 2's dispatch
// targets that name.
//
// Env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET (same as the backend),
//      LIVEKIT_AGENT_NAME (optional override), DATABASE_URL (session load/save).
// =============================================================================

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { defineAgent, cli, WorkerOptions, VADEventType } from '@livekit/agents';
import { VAD } from '@livekit/agents-plugin-silero';
import { AudioStream, AudioSource, AudioFrame, LocalAudioTrack } from '@livekit/rtc-node';

const require = createRequire(import.meta.url);
const {
	VAD_CONFIG,
	REPROMPT_TEXT,
	getAgentName,
	parseDispatchMetadata,
	createInterviewerPipeline,
	createObserverPipeline,
	pcmToWavBuffer,
} = require('./pipeline.js');
const { conductTurn } = require('../../services/conversation-engine.js');
const aiProvider = require('../../lib/ai-provider.js');
const ttsService = require('../../services/tts-service.js');
const pool = require('../../lib/db.js');

// TTS output for LiveKit: raw 16-bit PCM @ 24kHz (AudioSource.captureFrame
// needs PCM samples, not mp3). Cartesia's documented raw output format.
const TTS_SAMPLE_RATE = 24000;
const TTS_PCM_FORMAT = { container: 'raw', encoding: 'pcm_s16le', sample_rate: TTS_SAMPLE_RATE };

// ─── Backend adapters (the pipeline's injected deps, wired to real services) ─

async function transcribeWav(wavBuffer) {
	const result = await aiProvider.transcribeAudio(wavBuffer, 'utterance.wav', 'audio/wav');
	return result?.text ?? null;
}

async function synthesizePcm(text) {
	const pcm = await ttsService.synthesize({ text, outputFormat: TTS_PCM_FORMAT });
	return pcm; // Buffer of int16le samples @ 24kHz mono
}

async function loadSession(sessionId) {
	const res = await pool.query(
		'SELECT id, conversation, config FROM interview_sessions WHERE id = $1',
		[sessionId],
	);
	return res.rows[0] || null;
}

async function persistSession(session) {
	await pool.query('UPDATE interview_sessions SET conversation = $1, config = $2 WHERE id = $3', [
		JSON.stringify(session.conversation || []),
		JSON.stringify(session.config || {}),
		session.id,
	]);
}

// ─── Audio helpers ───────────────────────────────────────────────────────────

function concatInt16(frames) {
	let total = 0;
	for (const f of frames) total += f.length;
	const out = new Int16Array(total);
	let offset = 0;
	for (const f of frames) {
		out.set(f, offset);
		offset += f.length;
	}
	return out;
}

// 10ms PCM chunks for smooth barge-in response.
const PLAYBACK_CHUNK_SAMPLES = Math.floor(TTS_SAMPLE_RATE / 100);

// Prefer the prewarmed Silero instance; fall back to a fresh load (e.g. local runs
// where prewarm ordering isn't guaranteed).
async function getVad(ctx) {
	return ctx.proc.userData.vad || VAD.load({ ...VAD_CONFIG });
}

// ─── Track A: interviewer ────────────────────────────────────────────────────

async function runInterviewer(ctx, sessionId) {
	const session = await loadSession(sessionId);
	if (!session) throw new Error(`voice-interviewer: session ${sessionId} not found`);

	const pipeline = createInterviewerPipeline({
		transcribe: transcribeWav,
		synthesize: synthesizePcm,
		conductTurn,
		persistSession,
	});

	// Publish our voice.
	const audioSource = new AudioSource(TTS_SAMPLE_RATE, 1);
	const audioTrack = LocalAudioTrack.createAudioTrack('agent-voice', audioSource);
	await ctx.agent.publishTrack(audioTrack);

	let currentSession = session;
	let playGeneration = 0; // bumped on barge-in; the playback loop aborts on mismatch

	async function playPcm(pcmBuffer) {
		const samples = new Int16Array(
			pcmBuffer.buffer,
			pcmBuffer.byteOffset,
			Math.floor(pcmBuffer.length / 2),
		);
		const gen = ++playGeneration;
		for (let i = 0; i < samples.length; i += PLAYBACK_CHUNK_SAMPLES) {
			if (gen !== playGeneration) return; // barged in — stop talking
			const chunk = samples.subarray(i, i + PLAYBACK_CHUNK_SAMPLES);
			await audioSource.captureFrame(new AudioFrame(chunk, TTS_SAMPLE_RATE, 1, chunk.length));
		}
	}

	const vad = await getVad(ctx);

	async function handleAudioTrack(track) {
		const stream = new AudioStream(track, VAD_CONFIG.sampleRate, 1);
		const vadStream = vad.stream();
		(async () => {
			for await (const frame of stream) vadStream.pushFrame(frame);
		})().catch((err) => console.error('[voice-interviewer] audio pump error:', err.message));

		for await (const event of vadStream) {
			if (event.type === VADEventType.START_OF_SPEECH) {
				// Barge-in: candidate started talking while we speak — stop TTS now.
				audioSource.clearQueue();
				playGeneration++;
			} else if (event.type === VADEventType.END_OF_SPEECH) {
				const samples = concatInt16((event.frames || []).map((f) => new Int16Array(f.data)));
				if (samples.length === 0) continue;
				const wav = pcmToWavBuffer(samples, VAD_CONFIG.sampleRate);
				try {
					const result = await pipeline.processUtterance({
						audioBuffer: wav,
						session: currentSession,
					});
					currentSession = result.updatedSession;
					await playPcm(result.audioBuffer);
					if (result.isComplete) {
						console.log(`[voice-interviewer] session ${sessionId} complete — engine wrapped up`);
						break;
					}
				} catch (err) {
					console.error('[voice-interviewer] turn error:', err.message);
					await playPcm(await synthesizePcm(REPROMPT_TEXT));
				}
			}
		}
	}

	ctx.room.on('trackSubscribed', (track, _pub, participant) => {
		if (track.kind === 'audio' && participant.identity !== ctx.agent.identity) {
			handleAudioTrack(track).catch((err) =>
				console.error('[voice-interviewer] track handler error:', err.message),
			);
		}
	});
	for (const [, participant] of ctx.room.remoteParticipants) {
		for (const [, pub] of participant.trackPublications) {
			if (pub.track && pub.track.kind === 'audio') {
				handleAudioTrack(pub.track).catch((err) =>
					console.error('[voice-interviewer] track handler error:', err.message),
				);
			}
		}
	}

	// Fresh session: speak the intro the HTTP start already generated, so the
	// voice experience opens with the interviewer's first question.
	const conv = currentSession.conversation || [];
	if (conv.length === 1 && conv[0].role === 'interviewer' && conv[0].text) {
		await playPcm(await synthesizePcm(conv[0].text));
	}

	console.log(`[voice-interviewer] interviewer joined room for session ${sessionId}`);
}

// ─── Track B: observer ───────────────────────────────────────────────────────

async function runObserver(ctx, sessionId) {
	const pipeline = createObserverPipeline({ transcribe: transcribeWav });
	const vad = await getVad(ctx);

	async function handleAudioTrack(track, participant) {
		const speaker = participant.identity || participant.name || 'unknown';
		const stream = new AudioStream(track, VAD_CONFIG.sampleRate, 1);
		const vadStream = vad.stream();
		(async () => {
			for await (const frame of stream) vadStream.pushFrame(frame);
		})().catch((err) => console.error('[voice-interviewer] observer pump error:', err.message));

		for await (const event of vadStream) {
			if (event.type === VADEventType.END_OF_SPEECH) {
				const samples = concatInt16((event.frames || []).map((f) => new Int16Array(f.data)));
				if (samples.length === 0) continue;
				const wav = pcmToWavBuffer(samples, VAD_CONFIG.sampleRate);
				try {
					await pipeline.processUtterance({ audioBuffer: wav, speaker });
				} catch (err) {
					console.error('[voice-interviewer] observer turn error:', err.message);
				}
			}
		}
	}

	const attach = (track, participant) => {
		if (track.kind === 'audio') {
			handleAudioTrack(track, participant).catch((err) =>
				console.error('[voice-interviewer] observer track error:', err.message),
			);
		}
	};
	ctx.room.on('trackSubscribed', (track, _pub, participant) => attach(track, participant));
	for (const [, participant] of ctx.room.remoteParticipants) {
		for (const [, pub] of participant.trackPublications) {
			if (pub.track) attach(pub.track, participant);
		}
	}

	// Persist the speaker-labeled transcript when the job ends. Task 5 owns
	// the Q&A extraction + report; it reads config.observer_transcript (a
	// dedicated column is a later, reversible upgrade).
	ctx.addShutdownCallback(async () => {
		const transcript = pipeline.getTranscript();
		console.log(
			`[voice-interviewer] observer done: ${transcript.length} turns for session ${sessionId}`,
		);
		await pool.query(
			`UPDATE interview_sessions SET config = config || $1 WHERE id = $2`,
			[JSON.stringify({ observer_transcript: transcript }), sessionId],
		);
	});

	console.log(`[voice-interviewer] observer joined room for session ${sessionId} (muted)`);
}

// ─── Agent definition ────────────────────────────────────────────────────────

export default defineAgent({
	prewarm: async (proc) => {
		// Load the Silero model once per process, not per job.
		proc.userData.vad = await VAD.load({ ...VAD_CONFIG });
	},

	entry: async (ctx) => {
		await ctx.connect();
		const { interviewSessionId, mode } = parseDispatchMetadata(ctx.job.metadata);
		console.log(
			`[voice-interviewer] agent "${getAgentName()}" dispatched: session=${interviewSessionId} mode=${mode}`,
		);
		if (mode === 'observer') {
			await runObserver(ctx, interviewSessionId);
		} else {
			await runInterviewer(ctx, interviewSessionId);
		}
	},
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	cli.runApp(new WorkerOptions({ agent: import.meta.filename }));
}
