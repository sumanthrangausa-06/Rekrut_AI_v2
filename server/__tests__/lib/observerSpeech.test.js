/**
 * observerSpeech — Gate A (S-085 #787), Quinn protocol §2/§4/§5.
 * Synthetic corpus with known ground truth + the anti-fabrication suite.
 * The honesty contract: a measurement that cannot be measured is
 * `missing` with a reason — never a fallback, heuristic, or constant.
 */
const fs = require('node:fs');
const path = require('node:path');
const S = require('../../../lib/observerSpeech');

// Static scans (AF-5 / COPY-1) judge CODE, not prose: strip block
// comments and full-line // comments so a negation disclaimer in a
// header comment ("computes no affect, deception, … value", "NO
// fallback, heuristic, … scores") is not read as the thing it forbids.
// Code on mixed lines is kept whole.
const stripComments = (src) => src
	.replace(/\/\*[\s\S]*?\*\//g, '')
	.split('\n')
	.filter((line) => !line.trimStart().startsWith('//'))
	.join('\n');

const SR = 16000;
function tone(freq, seconds, amp = 0.5, sr = SR) {
	const n = Math.floor(seconds * sr);
	const buf = Buffer.alloc(n * 2);
	for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(amp * 32767 * Math.sin(2 * Math.PI * freq * (i / sr))), i * 2);
	return buf;
}
function silence(seconds, sr = SR) { return Buffer.alloc(Math.floor(seconds * sr) * 2); }
function cat(...parts) { return Buffer.concat(parts); }
const approx = (v, target, tol) => Math.abs(v - target) <= tol;

describe('synthetic corpus (known ground truth)', () => {
	test('pure silence ⇒ every measurement missing NO_SPEECH; M10 NOT_VALIDATED', async () => {
		const r = await S.computeSpeechMeasurements(silence(2), SR, { corpusRef: 'silence' });
		for (const k of ['speaking_time_sec', 'utterance_count', 'pitch_median_hz', 'speech_rate_wpm', 'filler_word_rate', 'energy_mean_dbfs']) {
			expect(r[k].status).toBe('missing');
			expect(r[k].value).toBeNull();
			expect(r[k].reason).toBe('NO_SPEECH');
		}
		expect(r.response_latency_ms.reason).toBe('NOT_VALIDATED');
	});

	test('steady 120 Hz tone: speaking time, pitch ±3 Hz, variability < 0.02, energy −9.03 ±1 dBFS', async () => {
		const r = await S.computeSpeechMeasurements(tone(120, 4), SR, {});
		expect(approx(r.speaking_time_sec.value, 4.0, 0.5)).toBe(true);
		expect(r.utterance_count.value).toBe(1);
		expect(approx(r.pitch_median_hz.value, 120, 3)).toBe(true);
		expect(r.pitch_variability.value).toBeLessThan(0.02);
		expect(approx(r.energy_mean_dbfs.value, -9.03, 1.0)).toBe(true);
		expect(r.energy_variance.value).toBeLessThan(1);
	});

	test('F0 ground-truth set within ±3 Hz', async () => {
		for (const f of [60, 85, 200, 320]) {
			const r = await S.computeSpeechMeasurements(tone(f, 3), SR, {});
			expect(r.pitch_median_hz.status).toBe('measured');
			expect(approx(r.pitch_median_hz.value, f, 3)).toBe(true);
		}
	});

	test('segmentation: 800 ms gap splits, 300 ms gap merges, 2.5 s gap is a long pause', async () => {
		let r = await S.computeSpeechMeasurements(cat(tone(120, 1), silence(0.8), tone(120, 1)), SR, {});
		expect(r.utterance_count.value).toBe(2);
		expect(r.pause_stats.value.count).toBe(1);
		expect(r.pause_stats.value.long_pause_count).toBe(0);
		r = await S.computeSpeechMeasurements(cat(tone(120, 1), silence(0.3), tone(120, 1)), SR, {});
		expect(r.utterance_count.value).toBe(1);
		r = await S.computeSpeechMeasurements(cat(tone(120, 1), silence(2.5), tone(120, 1), silence(0.8), tone(120, 1)), SR, {});
		expect(r.utterance_count.value).toBe(3);
		expect(r.pause_stats.value.long_pause_count).toBe(1);
	});

	test('M3 undefined below 3 utterances (INSUFFICIENT_SPEECH, never fabricated)', async () => {
		const r = await S.computeSpeechMeasurements(cat(tone(120, 1), silence(0.8), tone(120, 1)), SR, {});
		expect(r.avg_utterance_sec).toMatchObject({ status: 'missing', reason: 'INSUFFICIENT_SPEECH', value: null });
	});

	test('F0 switch raises IQR and variability vs a steady tone', async () => {
		const steady = await S.computeSpeechMeasurements(tone(150, 4), SR, {});
		const switched = await S.computeSpeechMeasurements(cat(tone(100, 2), tone(200, 2)), SR, {});
		expect(switched.pitch_iqr_hz.value).toBeGreaterThan(20);
		expect(switched.pitch_variability.value).toBeGreaterThan(steady.pitch_variability.value + 0.1);
	});

	test('injected transcript: exact wpm and filler rate (20 words, 5 fillers, 11 s turn)', async () => {
		const fixture = cat(tone(120, 5), silence(1), tone(120, 5));
		const text = 'um i think the answer is uh basically the system works well and you know it handles the load right';
		const r = await S.computeSpeechMeasurements(fixture, SR, { transcript: { text } });
		expect(approx(r.speech_rate_wpm.value, 20 / (11 / 60), 6)).toBe(true);
		expect(r.filler_word_rate.value).toBe(25);
	});

	test('ASR failure taxonomy: EMPTY_TRANSCRIPT / LOW_CONFIDENCE / INSUFFICIENT_SPEECH / ASR_UNAVAILABLE', async () => {
		let r = await S.computeSpeechMeasurements(tone(120, 3), SR, { transcript: { text: '' } });
		expect(r.speech_rate_wpm.reason).toBe('EMPTY_TRANSCRIPT');
		r = await S.computeSpeechMeasurements(tone(120, 3), SR, { transcript: { text: 'a b c d e f g h i j k l m n o p q r s t', confidence: 0.3 } });
		expect(r.speech_rate_wpm.reason).toBe('LOW_CONFIDENCE');
		r = await S.computeSpeechMeasurements(tone(120, 3), SR, { transcript: { text: 'only three words' } });
		expect(r.speech_rate_wpm.reason).toBe('INSUFFICIENT_SPEECH');
		r = await S.computeSpeechMeasurements(tone(120, 3), SR, {
			asrFn: async () => { const e = new Error('no binary'); e.notAvailable = true; throw e; },
		});
		expect(r.speech_rate_wpm.reason).toBe('ASR_UNAVAILABLE');
	});

	test('M10 response_latency_ms is missing NOT_VALIDATED for EVERY input class', async () => {
		const inputs = [silence(1), tone(120, 3), cat(tone(100, 2), silence(1), tone(200, 2)), Buffer.alloc(0)];
		for (const input of inputs) {
			const r = await S.computeSpeechMeasurements(input, SR, { transcript: { text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty' } });
			expect(r.response_latency_ms).toMatchObject({ status: 'missing', value: null, reason: 'NOT_VALIDATED' });
		}
	});

	test('segmentUtterances export: counts, durations, pause classification', () => {
		const seg = S.segmentUtterances(cat(tone(120, 1), silence(0.8), tone(120, 1)), SR);
		expect(seg.utterances).toHaveLength(2);
		expect(approx(seg.speakingTimeSec, 2.0, 0.3)).toBe(true);
		expect(seg.pauses).toHaveLength(1);
		expect(seg.pauses[0].long).toBe(false);
	});

	test('§7.5 schema: measured entries carry numeric uncertainty, enumerated kind, flags, reason null', async () => {
		const r = await S.computeSpeechMeasurements(tone(120, 4), SR, {});
		expect(typeof r.pitch_median_hz.uncertainty).toBe('number');
		expect(r.pitch_median_hz.uncertainty_kind).toBe('f0_confident_frame_ratio');
		expect(r.pitch_median_hz.quality_flags).toEqual([]);
		expect(r.pitch_median_hz.reason).toBeNull();
		expect(r.speaking_time_sec.uncertainty_kind).toBe('segment_count');
		expect(r.method_version).toBe(1);
		for (const k of Object.keys(r)) {
			const m = r[k];
			if (m && typeof m === 'object' && 'status' in m) {
				expect(S.UNCERTAINTY_KINDS).toContain(m.uncertainty_kind);
				if (m.status === 'missing') expect(m.uncertainty).toBeNull();
				else expect(typeof m.uncertainty).toBe('number');
			}
		}
	});

	test('A-8: transcript WITHOUT confidence ⇒ M8/M9 degraded with ASR_CONFIDENCE_UNAVAILABLE', async () => {
		const fixture = cat(tone(120, 5), silence(1), tone(120, 5));
		const text = 'um i think the answer is uh basically the system works well and you know it handles the load right';
		const r = await S.computeSpeechMeasurements(fixture, SR, { transcript: { text } });
		expect(r.speech_rate_wpm.status).toBe('degraded');
		expect(r.speech_rate_wpm.quality_flags).toContain('ASR_CONFIDENCE_UNAVAILABLE');
		expect(r.speech_rate_wpm.uncertainty).toBe(r.speech_rate_wpm.value);
		const withConf = await S.computeSpeechMeasurements(fixture, SR, { transcript: { text, confidence: 0.95 } });
		expect(withConf.speech_rate_wpm.status).toBe('measured');
	});

	test('A-9: zero pauses ⇒ mean/max null (never fabricated 0); gap degrades measured entries', async () => {
		const r = await S.computeSpeechMeasurements(tone(120, 3), SR, {});
		expect(r.pause_stats.value.count).toBe(0);
		expect(r.pause_stats.value.mean_sec).toBeNull();
		expect(r.pause_stats.value.max_sec).toBeNull();
		const gapped = await S.computeSpeechMeasurements(tone(120, 3), SR, { captureGapRatio: 0.2 });
		expect(gapped.speaking_time_sec.status).toBe('degraded');
		expect(gapped.speaking_time_sec.quality_flags).toContain('GAP_IN_CAPTURE');
	});

	test('provenance + frozen filler lexicon', async () => {
		expect(Object.isFrozen(S.FILLER_LEXICON_V1)).toBe(true);
		expect([...S.FILLER_LEXICON_V1]).toEqual(['um', 'uh', 'er', 'erm', 'like', 'you know', 'actually', 'basically', 'literally', 'right']);
		const r = await S.computeSpeechMeasurements(tone(120, 3), SR, {});
		expect(r.method_version).toBe(S.METHOD_VERSION);
		expect(r.speaking_time_sec.provenance.engine_version).toBe(S.ENGINE_VERSION);
		expect(r.speaking_time_sec.provenance.config_hash).toBeTruthy();
	});
});

describe('anti-fabrication suite (Quinn §5)', () => {
	test('AF-1 digital silence ⇒ NO_SPEECH everywhere (see corpus test)', async () => {
		const r = await S.computeSpeechMeasurements(Buffer.alloc(32000), SR, {});
		expect(r.speaking_time_sec.reason).toBe('NO_SPEECH');
	});

	test('AF-2 corrupt fuzz: 50 mutated buffers never throw, never fabricate, schema always valid', async () => {
		let seed = 42;
		const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
		const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
		for (let i = 0; i < 50; i++) {
			const len = Math.floor(rand() * 64000);
			const b = Buffer.alloc(len);
			for (let j = 0; j < len; j++) b[j] = Math.floor(rand() * 256);
			const r = await S.computeSpeechMeasurements(b, SR, { transcript: { text } });
			expect(r.response_latency_ms.status).toBe('missing');
			for (const k of Object.keys(r)) {
				const m = r[k];
				if (m && typeof m === 'object' && 'status' in m) {
					expect(['measured', 'degraded', 'missing']).toContain(m.status);
					if (m.status === 'missing') {
						expect(m.value).toBeNull();
						expect(S.MISSING_REASONS).toContain(m.reason);
					}
				}
			}
		}
	});

	test('AF-4 empty-transcript canary: ASR returning "" ⇒ EMPTY_TRANSCRIPT, transcript text in NO output field', async () => {
		const r = await S.computeSpeechMeasurements(tone(120, 3), SR, { asrFn: async () => ({ text: '', confidence: 0.99 }) });
		expect(r.speech_rate_wpm.reason).toBe('EMPTY_TRANSCRIPT');
		expect(JSON.stringify(r)).not.toMatch(/transcript_text|raw_transcript/);
	});

	test('AF-5 static scan: no fallback score constructs in the new modules', () => {
		const files = ['observerSpeech.js', 'observerCapture.js', 'observerCaptureGate.js', 'r2ObserverAudioStore.js'];
		for (const f of files) {
			const src = stripComments(fs.readFileSync(path.join(__dirname, '../../../lib', f), 'utf8'));
			// No random assignment to measurement values, and EVERY
			// speech_rate_wpm assignment's value token must be missing( or
			// measured( — no constant/computed fallback score. (A single
			// negative regex cannot say this: \s* backtracks, so the old
			// [^m][^e] tail matched " m" of `missing(` itself, and a
			// lookahead after \s* is defeated the same way. Collect the
			// value tokens and judge each one.)
			const badWpmTokens = [...src.matchAll(/speech_rate_wpm\s*[:=]\s*([^\s;,]+)/g)]
				.map((m) => m[1])
				.filter((t) => !t.startsWith('missing(') && !t.startsWith('measured('));
			expect(badWpmTokens).toEqual([]);
			expect(src).not.toMatch(/Math\.random\(\)/);
		}
		const speechSrc = stripComments(fs.readFileSync(path.join(__dirname, '../../../lib/observerSpeech.js'), 'utf8'));
		expect(speechSrc).not.toMatch(/fallback|heuristic/i);
	});

	test('AF-6 schema fuzz: every reason comes from the frozen enum', async () => {
		const r = S.buildMissingMeasurementSet('CAPTURE_INCOMPLETE', {});
		for (const k of Object.keys(r)) {
			const m = r[k];
			if (m && typeof m === 'object' && 'status' in m) {
				expect(m.status).toBe('missing');
				expect(S.MISSING_REASONS).toContain(m.reason);
			}
		}
		expect(() => S.buildMissingMeasurementSet('MADE_UP_REASON', {})).toThrow();
	});

	test('COPY-1: no deception/affect labelling anywhere in the new modules', () => {
		const files = ['observerSpeech.js', 'observerCapture.js', 'observerCaptureGate.js', 'r2ObserverAudioStore.js', 'observerAudioTestDecrypt.js'];
		for (const f of files) {
			const src = stripComments(fs.readFileSync(path.join(__dirname, '../../../lib', f), 'utf8'));
			expect(src).not.toMatch(/stress_score|stress_level|deception|lie_detect|emotion_score|affect_score/i);
		}
		// The physical name is contractual: pitch_variability, never a synonym for an inner state
		const speechSrc = stripComments(fs.readFileSync(path.join(__dirname, '../../../lib/observerSpeech.js'), 'utf8'));
		expect(speechSrc).toMatch(/pitch_variability/);
	});
});
