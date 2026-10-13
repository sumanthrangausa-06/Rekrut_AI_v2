/**
 * observerSpeech — speech-pattern measurements for Gate A capture (S-085 #787).
 *
 * Design: Rex v2 §7 + Quinn's validation protocol §2. The honesty contract
 * is the product:
 *   - Every measurement is measured | degraded | missing. A missing
 *     measurement carries value:null and a mandatory reason from the frozen
 *     enum. There are NO fallback, heuristic, or imputed scores anywhere in
 *     this module — if it cannot be measured, it is reported missing.
 *   - M10 response_latency_ms is ALWAYS missing with NOT_VALIDATED: its
 *     ground truth (the interviewer's end-of-turn instant) is not in the
 *     candidate's audio, and no code path here may ever produce a value.
 *   - M6 is `pitch_variability` (coefficient of variation of F0) — a
 *     physical descriptor only. This module computes no affect, deception,
 *     or emotional-state value of any kind, under any name.
 *   - ASR is self-hosted whisper ONLY (lib/self-hosted-audio.js). No cloud
 *     cascade exists on this path.
 *   - Transcripts live in memory for the duration of ONE call. They are
 *     never logged, never placed in error objects, never persisted. When
 *     whisper runs, its files live only in CAPTURE_WORKDIR (mode 0700)
 *     and are zero-filled before unlink on every exit path (enforced in
 *     lib/self-hosted-audio.js via the tmpDir option + this module's
 *     workdir discipline).
 *
 * Counters hook: opts.onAsrInvocation fires once per whisper invocation so
 * the caller can maintain the §8.1 session counters.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ENGINE_VERSION = 'observer-speech-1.0.0';
const METHOD_VERSION = ENGINE_VERSION;

// Frozen filler lexicon (design §7.2). Whole-token, case-insensitive;
// the 'you know' bigram is matched before single tokens.
const FILLER_LEXICON_V1 = Object.freeze([
	'um',
	'uh',
	'er',
	'erm',
	'like',
	'you know',
	'actually',
	'basically',
	'literally',
	'right',
]);
const FILLER_SINGLES = new Set(FILLER_LEXICON_V1.filter((w) => !w.includes(' ')));

const MISSING_REASONS = Object.freeze([
	'NO_SPEECH',
	'CORRUPT_AUDIO',
	'INSUFFICIENT_SPEECH',
	'STORAGE_ERROR',
	'CONSENT_NOT_ACTIVE',
	'CAPTURE_INCOMPLETE',
	'ASR_UNAVAILABLE',
	'LOW_CONFIDENCE',
	'EMPTY_TRANSCRIPT',
	'NOT_VALIDATED',
]);

const DEFAULT_CONFIG = Object.freeze({
	frameMs: 25,
	hopMs: 10,
	silenceRmsDbfs: -45,
	utteranceGapMs: 700,
	pauseMinMs: 250,
	longPauseMs: 2000,
	pitchMinHz: 50,
	pitchMaxHz: 400,
	pitchConfidenceMin: 0.6,
	pitchWindowMs: 50,
	minUtterancesForCentral: 3,
	minConfidentVoicedRatio: 0.3,
	minConfidentVoicedSec: 2,
	asrConfidenceMin: 0.6,
	minWordsForRate: 20,
});

const CAPTURE_WORKDIR = path.join(os.tmpdir(), 'rekrut-observer-capture');

// ─── Workdir discipline (§7.4) ──────────────────────────────────────────────

function ensureCaptureWorkdir() {
	fs.mkdirSync(CAPTURE_WORKDIR, { recursive: true, mode: 0o700 });
	try {
		fs.chmodSync(CAPTURE_WORKDIR, 0o700);
	} catch {
		/* best-effort — the directory was created 0700 */
	}
	return CAPTURE_WORKDIR;
}

/**
 * Worker-start crash sweep: zero-fill + delete anything a crashed process
 * left in the capture workdir. Returns the number of files swept. Logs are
 * the caller's job (counts only). Never throws.
 */
function sweepCaptureWorkdir() {
	let swept = 0;
	try {
		if (!fs.existsSync(CAPTURE_WORKDIR)) return 0;
		for (const name of fs.readdirSync(CAPTURE_WORKDIR)) {
			const p = path.join(CAPTURE_WORKDIR, name);
			try {
				const st = fs.statSync(p);
				if (st.isFile()) {
					fs.writeFileSync(p, Buffer.alloc(st.size));
					fs.unlinkSync(p);
					swept++;
				}
			} catch {
				/* one bad file must not stop the sweep */
			}
		}
	} catch {
		/* sweep is best-effort hygiene */
	}
	return swept;
}

// ─── DSP helpers ────────────────────────────────────────────────────────────

function decodePcm16(buffer) {
	const n = Math.floor(buffer.length / 2);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		out[i] = buffer.readInt16LE(i * 2) / 32768;
	}
	return out;
}

function frameRmsDbfs(samples, start, len) {
	let sum = 0;
	let count = 0;
	for (let i = start; i < start + len && i < samples.length; i++) {
		sum += samples[i] * samples[i];
		count++;
	}
	if (count === 0) return -Infinity;
	const rms = Math.sqrt(sum / count);
	if (rms <= 0) return -Infinity;
	return 20 * Math.log10(rms);
}

/**
 * Segment PCM into utterances / pauses (design §7.1–7.2).
 * @param {Float32Array|Buffer} input float samples, or a PCM16 buffer
 * @param {number} sampleRate
 * @param {object} [opts] config overrides (see DEFAULT_CONFIG)
 * @returns {{utterances: Array<{startSec:number,endSec:number,durationSec:number}>,
 *   pauses: Array<{startSec:number,durationSec:number,long:boolean}>,
 *   speakingTimeSec: number, voicedFrameCount: number, frameCount: number,
 *   frameEnergiesDbfs: number[]}}
 */
function segmentUtterances(input, sampleRate, opts = {}) {
	const cfg = { ...DEFAULT_CONFIG, ...opts };
	const samples = Buffer.isBuffer(input) ? decodePcm16(input) : input;
	const frameLen = Math.max(1, Math.round((sampleRate * cfg.frameMs) / 1000));
	const hop = Math.max(1, Math.round((sampleRate * cfg.hopMs) / 1000));
	const frameCount = samples.length === 0 ? 0 : Math.max(1, Math.floor((samples.length - 1) / hop) + 1);

	const voiced = new Array(frameCount).fill(false);
	const frameEnergiesDbfs = new Array(frameCount).fill(-Infinity);
	for (let f = 0; f < frameCount; f++) {
		const start = f * hop;
		const db = frameRmsDbfs(samples, start, frameLen);
		frameEnergiesDbfs[f] = db;
		voiced[f] = db > cfg.silenceRmsDbfs;
	}

	// Voiced regions = union of voiced frame windows [start, start+frameLen).
	const regions = [];
	for (let f = 0; f < frameCount; f++) {
		if (!voiced[f]) continue;
		const start = f * hop;
		const end = Math.min(samples.length, start + frameLen);
		const last = regions[regions.length - 1];
		if (last && start <= last.end) {
			if (end > last.end) last.end = end;
		} else {
			regions.push({ start, end });
		}
	}

	const toSec = (s) => s / sampleRate;
	let speakingSamples = 0;
	for (const r of regions) speakingSamples += r.end - r.start;

	// Interior silence gaps between voiced regions.
	const gaps = [];
	for (let i = 1; i < regions.length; i++) {
		gaps.push({ start: regions[i - 1].end, end: regions[i].start, durationMs: ((regions[i].start - regions[i - 1].end) / sampleRate) * 1000 });
	}
	const pauses = gaps
		.filter((g) => g.durationMs >= cfg.pauseMinMs)
		.map((g) => ({ startSec: toSec(g.start), durationSec: g.durationMs / 1000, long: g.durationMs >= cfg.longPauseMs }));

	// Utterances: voiced regions separated by ≤ utteranceGapMs merge.
	const utterances = [];
	for (let i = 0; i < regions.length; i++) {
		const r = regions[i];
		const last = utterances[utterances.length - 1];
		if (last && (r.start - last.endSample) / sampleRate * 1000 <= cfg.utteranceGapMs) {
			last.endSample = r.end;
		} else {
			utterances.push({ startSample: r.start, endSample: r.end });
		}
	}

	return {
		utterances: utterances.map((u) => ({
			startSec: toSec(u.startSample),
			endSec: toSec(u.endSample),
			durationSec: toSec(u.endSample - u.startSample),
		})),
		pauses,
		speakingTimeSec: toSec(speakingSamples),
		voicedFrameCount: voiced.filter(Boolean).length,
		frameCount,
		frameEnergiesDbfs,
	};
}

/**
 * Autocorrelation pitch estimate for one window. Returns {hz, confidence}
 * or null when no lag in [pitchMinHz, pitchMaxHz] is confident enough.
 */
function estimatePitchHz(samples, start, len, sampleRate, cfg) {
	const maxLag = Math.floor(sampleRate / cfg.pitchMinHz);
	const minLag = Math.ceil(sampleRate / cfg.pitchMaxHz);
	const n = Math.min(len, samples.length - start);
	if (n <= maxLag + 1) return null;

	let energy = 0;
	for (let i = 0; i < n; i++) energy += samples[start + i] * samples[start + i];
	if (energy <= 0) return null;

	let bestLag = -1;
	let bestCorr = -1;
	for (let lag = minLag; lag <= maxLag; lag++) {
		let corr = 0;
		for (let i = 0; i + lag < n; i++) corr += samples[start + i] * samples[start + i + lag];
		const norm = corr / energy;
		if (norm > bestCorr) {
			bestCorr = norm;
			bestLag = lag;
		}
	}
	if (bestLag < 0 || bestCorr < cfg.pitchConfidenceMin) return null;
	return { hz: sampleRate / bestLag, confidence: bestCorr };
}

function median(values) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(values, q) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = (sorted.length - 1) * q;
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function countFillers(text) {
	const tokens = String(text).toLowerCase().match(/[a-z']+/g) || [];
	let fillers = 0;
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i] === 'you' && tokens[i + 1] === 'know') {
			fillers++;
			i++; // consume the bigram
			continue;
		}
		if (FILLER_SINGLES.has(tokens[i])) fillers++;
	}
	return { fillers, words: tokens.length };
}

function buildWavBuffer(pcmBuffer, sampleRate) {
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + pcmBuffer.length, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36);
	header.writeUInt32LE(pcmBuffer.length, 40);
	return Buffer.concat([header, pcmBuffer]);
}

// ─── Measurement assembly ───────────────────────────────────────────────────

function measured(value, unit, n, uncertaintyKind, provenance) {
	return { status: 'measured', value, unit, n, uncertainty_kind: uncertaintyKind, provenance };
}
function missing(reason, unit, n, uncertaintyKind, provenance) {
	return { status: 'missing', value: null, unit, reason, n, uncertainty_kind: uncertaintyKind, provenance };
}

function configHash(cfg) {
	return crypto.createHash('sha256').update(JSON.stringify(cfg)).digest('hex').slice(0, 16);
}

/**
 * Compute the M1–M10 speech-pattern measurement set for one session's PCM.
 *
 * @param {Buffer} pcmBuffer PCM16 mono audio (accumulated, resampled)
 * @param {number} sampleRate
 * @param {object} [opts]
 * @param {object} [opts.config] threshold overrides (change config_hash)
 * @param {object|string} [opts.transcript] injected transcript
 *   ({text, confidence?, words?}) — validation injection point; when given,
 *   whisper is NOT invoked.
 * @param {Function} [opts.asrFn] injected ASR (wavBuffer) => {text, confidence}
 * @param {string} [opts.corpusRef] provenance ref (corpus id or session ref)
 * @param {number} [opts.captureGapRatio] header field from the capture layer
 * @param {number} [opts.audioSecondsCaptured] header field from the capture layer
 * @param {Function} [opts.onAsrInvocation] counter hook (§8.1)
 * @returns {Promise<object>} Quinn §2.3 result schema
 */
async function computeSpeechMeasurements(pcmBuffer, sampleRate, opts = {}) {
	const cfg = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
	const provenance = {
		engine_version: ENGINE_VERSION,
		config_hash: configHash(cfg),
		corpus_or_session_ref: opts.corpusRef || null,
		computed_at: new Date().toISOString(),
	};
	const header = {
		capture_gap_ratio: typeof opts.captureGapRatio === 'number' ? opts.captureGapRatio : 0,
		audio_seconds_captured:
			typeof opts.audioSecondsCaptured === 'number'
				? opts.audioSecondsCaptured
				: Buffer.isBuffer(pcmBuffer) && sampleRate > 0
					? pcmBuffer.length / 2 / sampleRate
					: 0,
		method_version: METHOD_VERSION,
	};

	const allMissing = (reason) => ({
		...header,
		speaking_time_sec: missing(reason, 'sec', 0, 'none', provenance),
		utterance_count: missing(reason, 'count', 0, 'none', provenance),
		avg_utterance_sec: missing(reason, 'sec', 0, 'none', provenance),
		median_utterance_sec: missing(reason, 'sec', 0, 'none', provenance),
		pause_stats: missing(reason, 'object', 0, 'none', provenance),
		pitch_median_hz: missing(reason, 'hz', 0, 'model_confidence', provenance),
		pitch_iqr_hz: missing(reason, 'hz', 0, 'model_confidence', provenance),
		pitch_variability: missing(reason, 'ratio', 0, 'model_confidence', provenance),
		energy_mean_dbfs: missing(reason, 'dbfs', 0, 'none', provenance),
		energy_variance: missing(reason, 'dbfs2', 0, 'none', provenance),
		speech_rate_wpm: missing(reason, 'wpm', 0, 'model_confidence', provenance),
		filler_word_rate: missing(reason, 'per_100_words', 0, 'none', provenance),
		response_latency_ms: missing('NOT_VALIDATED', 'ms', 0, 'not_validated', provenance),
	});

	// Input validation — corrupt input is a reason, never a throw (AF-2).
	if (!Buffer.isBuffer(pcmBuffer) || pcmBuffer.length < 2 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
		return allMissing('CORRUPT_AUDIO');
	}
	// (buildMissingMeasurementSet below reuses this assembly for teardown
	// paths — e.g. CAPTURE_INCOMPLETE — where no computation is honest.)

	let seg;
	let samples;
	try {
		samples = decodePcm16(pcmBuffer);
		seg = segmentUtterances(samples, sampleRate, cfg);
	} catch {
		return allMissing('CORRUPT_AUDIO');
	}

	if (seg.voicedFrameCount === 0 || seg.speakingTimeSec <= 0) {
		return allMissing('NO_SPEECH');
	}

	const result = { ...header };
	const uttDurations = seg.utterances.map((u) => u.durationSec);
	const nUtt = seg.utterances.length;

	// M1 speaking time
	result.speaking_time_sec = measured(seg.speakingTimeSec, 'sec', seg.voicedFrameCount, 'none', provenance);
	// M2 utterance count
	result.utterance_count = measured(nUtt, 'count', nUtt, 'none', provenance);
	// M3 central tendency — undefined below 3 utterances, never fabricated
	if (nUtt >= cfg.minUtterancesForCentral) {
		const mean = uttDurations.reduce((a, b) => a + b, 0) / nUtt;
		result.avg_utterance_sec = measured(mean, 'sec', nUtt, 'none', provenance);
		result.median_utterance_sec = measured(median(uttDurations), 'sec', nUtt, 'none', provenance);
	} else {
		result.avg_utterance_sec = missing('INSUFFICIENT_SPEECH', 'sec', nUtt, 'none', provenance);
		result.median_utterance_sec = missing('INSUFFICIENT_SPEECH', 'sec', nUtt, 'none', provenance);
	}
	// M4 pause stats
	if (seg.pauses.length > 0) {
		const durs = seg.pauses.map((p) => p.durationSec);
		result.pause_stats = measured(
			{
				count: durs.length,
				mean_sec: durs.reduce((a, b) => a + b, 0) / durs.length,
				max_sec: Math.max(...durs),
				long_pause_count: seg.pauses.filter((p) => p.long).length,
			},
			'object',
			durs.length,
			'none',
			provenance,
		);
	} else {
		result.pause_stats = measured(
			{ count: 0, mean_sec: 0, max_sec: 0, long_pause_count: 0 },
			'object',
			0,
			'none',
			provenance,
		);
	}

	// M5/M6 pitch — per voiced frame, autocorrelation over a pitch window
	const frameLen = Math.max(1, Math.round((sampleRate * cfg.frameMs) / 1000));
	const hop = Math.max(1, Math.round((sampleRate * cfg.hopMs) / 1000));
	const pitchWin = Math.max(1, Math.round((sampleRate * cfg.pitchWindowMs) / 1000));
	const pitchValues = [];
	let voicedFrames = 0;
	for (let f = 0; f < seg.frameCount; f++) {
		if (!(seg.frameEnergiesDbfs[f] > cfg.silenceRmsDbfs)) continue;
		voicedFrames++;
		const centre = f * hop + Math.floor(frameLen / 2);
		const start = Math.max(0, centre - Math.floor(pitchWin / 2));
		const est = estimatePitchHz(samples, start, pitchWin, sampleRate, cfg);
		if (est) pitchValues.push(est.hz);
	}
	const confidentSec = (pitchValues.length * cfg.hopMs) / 1000;
	const confidentRatio = voicedFrames > 0 ? pitchValues.length / voicedFrames : 0;
	if (
		pitchValues.length > 0 &&
		confidentRatio >= cfg.minConfidentVoicedRatio &&
		confidentSec >= cfg.minConfidentVoicedSec
	) {
		const med = median(pitchValues);
		const iqr = quantile(pitchValues, 0.75) - quantile(pitchValues, 0.25);
		const mean = pitchValues.reduce((a, b) => a + b, 0) / pitchValues.length;
		const sd = Math.sqrt(pitchValues.reduce((a, b) => a + (b - mean) * (b - mean), 0) / pitchValues.length);
		result.pitch_median_hz = measured(med, 'hz', pitchValues.length, 'model_confidence', provenance);
		result.pitch_iqr_hz = measured(iqr, 'hz', pitchValues.length, 'model_confidence', provenance);
		result.pitch_variability = measured(mean > 0 ? sd / mean : 0, 'ratio', pitchValues.length, 'model_confidence', provenance);
	} else {
		result.pitch_median_hz = missing('INSUFFICIENT_SPEECH', 'hz', pitchValues.length, 'model_confidence', provenance);
		result.pitch_iqr_hz = missing('INSUFFICIENT_SPEECH', 'hz', pitchValues.length, 'model_confidence', provenance);
		result.pitch_variability = missing('INSUFFICIENT_SPEECH', 'ratio', pitchValues.length, 'model_confidence', provenance);
	}

	// M7 energy — frame RMS distribution over all frames
	const energies = seg.frameEnergiesDbfs.filter((v) => Number.isFinite(v));
	if (energies.length > 0) {
		const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
		const variance = energies.reduce((a, b) => a + (b - mean) * (b - mean), 0) / energies.length;
		result.energy_mean_dbfs = measured(mean, 'dbfs', energies.length, 'none', provenance);
		result.energy_variance = measured(variance, 'dbfs2', energies.length, 'none', provenance);
	} else {
		result.energy_mean_dbfs = missing('CORRUPT_AUDIO', 'dbfs', 0, 'none', provenance);
		result.energy_variance = missing('CORRUPT_AUDIO', 'dbfs2', 0, 'none', provenance);
	}

	// M8/M9 — transcript-dependent (self-hosted whisper only, or injected)
	let transcript = null;
	let asrFailure = null;
	if (opts.transcript != null) {
		transcript = typeof opts.transcript === 'string' ? { text: opts.transcript } : opts.transcript;
	} else {
		try {
			if (typeof opts.onAsrInvocation === 'function') opts.onAsrInvocation();
			if (typeof opts.asrFn === 'function') {
				transcript = await opts.asrFn(buildWavBuffer(pcmBuffer, sampleRate));
			} else {
				ensureCaptureWorkdir();
				const { transcribe } = require('./self-hosted-audio');
				transcript = await transcribe(buildWavBuffer(pcmBuffer, sampleRate), 'capture.wav', 'audio/wav', {
					tmpDir: CAPTURE_WORKDIR,
					suppressTranscriptLog: true,
				});
			}
		} catch (err) {
			// Reason codes + counts only — error objects never carry transcript text.
			// Every ASR failure mode (missing binary, crash, timeout) maps
			// to the same honest reason — no fabricated transcript, ever.
			asrFailure = 'ASR_UNAVAILABLE';
		}
	}

	if (asrFailure) {
		result.speech_rate_wpm = missing(asrFailure, 'wpm', 0, 'model_confidence', provenance);
		result.filler_word_rate = missing(asrFailure, 'per_100_words', 0, 'none', provenance);
	} else if (!transcript || typeof transcript.text !== 'string' || transcript.text.trim().length === 0) {
		result.speech_rate_wpm = missing('EMPTY_TRANSCRIPT', 'wpm', 0, 'model_confidence', provenance);
		result.filler_word_rate = missing('EMPTY_TRANSCRIPT', 'per_100_words', 0, 'none', provenance);
	} else if (typeof transcript.confidence === 'number' && transcript.confidence < cfg.asrConfidenceMin) {
		result.speech_rate_wpm = missing('LOW_CONFIDENCE', 'wpm', 0, 'model_confidence', provenance);
		result.filler_word_rate = missing('LOW_CONFIDENCE', 'per_100_words', 0, 'none', provenance);
	} else {
		const { fillers, words } = countFillers(transcript.text);
		if (words < cfg.minWordsForRate) {
			result.speech_rate_wpm = missing('INSUFFICIENT_SPEECH', 'wpm', words, 'model_confidence', provenance);
			result.filler_word_rate = missing('INSUFFICIENT_SPEECH', 'per_100_words', words, 'none', provenance);
		} else {
			// Total turn time = first utterance start → last utterance end.
			const turnSec = seg.utterances.length
				? seg.utterances[seg.utterances.length - 1].endSec - seg.utterances[0].startSec
				: seg.speakingTimeSec;
			const wpm = turnSec > 0 ? words / (turnSec / 60) : 0;
			result.speech_rate_wpm = measured(wpm, 'wpm', words, 'model_confidence', provenance);
			result.filler_word_rate = measured((fillers / words) * 100, 'per_100_words', words, 'none', provenance);
		}
	}

	// M10 — always missing, by design and by honesty contract.
	result.response_latency_ms = missing('NOT_VALIDATED', 'ms', 0, 'not_validated', provenance);

	return result;
}

/**
 * Build a complete measurement set in which every measurement is missing
 * with the given reason (M10 always NOT_VALIDATED). Used by capture
 * teardown for interrupted sessions (design §7.3: measurements spanning an
 * interruption are CAPTURE_INCOMPLETE, never computed from partial audio).
 */
function buildMissingMeasurementSet(reason, opts = {}) {
	if (!MISSING_REASONS.includes(reason)) {
		throw new Error(`observerSpeech.buildMissingMeasurementSet: unknown reason "${reason}"`);
	}
	const cfg = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
	const provenance = {
		engine_version: ENGINE_VERSION,
		config_hash: configHash(cfg),
		corpus_or_session_ref: opts.corpusRef || null,
		computed_at: new Date().toISOString(),
	};
	return {
		capture_gap_ratio: typeof opts.captureGapRatio === 'number' ? opts.captureGapRatio : 0,
		audio_seconds_captured: typeof opts.audioSecondsCaptured === 'number' ? opts.audioSecondsCaptured : 0,
		method_version: METHOD_VERSION,
		speaking_time_sec: missing(reason, 'sec', 0, 'none', provenance),
		utterance_count: missing(reason, 'count', 0, 'none', provenance),
		avg_utterance_sec: missing(reason, 'sec', 0, 'none', provenance),
		median_utterance_sec: missing(reason, 'sec', 0, 'none', provenance),
		pause_stats: missing(reason, 'object', 0, 'none', provenance),
		pitch_median_hz: missing(reason, 'hz', 0, 'model_confidence', provenance),
		pitch_iqr_hz: missing(reason, 'hz', 0, 'model_confidence', provenance),
		pitch_variability: missing(reason, 'ratio', 0, 'model_confidence', provenance),
		energy_mean_dbfs: missing(reason, 'dbfs', 0, 'none', provenance),
		energy_variance: missing(reason, 'dbfs2', 0, 'none', provenance),
		speech_rate_wpm: missing(reason, 'wpm', 0, 'model_confidence', provenance),
		filler_word_rate: missing(reason, 'per_100_words', 0, 'none', provenance),
		response_latency_ms: missing('NOT_VALIDATED', 'ms', 0, 'not_validated', provenance),
	};
}

module.exports = {
	ENGINE_VERSION,
	METHOD_VERSION,
	FILLER_LEXICON_V1,
	MISSING_REASONS,
	DEFAULT_CONFIG,
	CAPTURE_WORKDIR,
	ensureCaptureWorkdir,
	sweepCaptureWorkdir,
	segmentUtterances,
	computeSpeechMeasurements,
	buildMissingMeasurementSet,
	// exported for tests
	_decodePcm16: decodePcm16,
	_estimatePitchHz: estimatePitchHz,
	_countFillers: countFillers,
	_buildWavBuffer: buildWavBuffer,
};
