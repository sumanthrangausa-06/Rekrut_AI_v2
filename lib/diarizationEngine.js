/**
 * diarizationEngine — supervisor side of the engine child process
 * (S-D05, #1907; Architecture §3.5, ADR-D01).
 *
 * Owns: ffmpeg decode (pipe-to-memory) and the per-job child process
 * lifecycle — spawn, PCM-over-stdin, hard timeout, error taxonomy.
 * Does NOT own: consent (the worker's gate runs before this is ever
 * called), persistence (the worker inserts the run row behind its
 * write-time gate), or the model (the child, workers/diarization/
 * engine-child.mjs, is the only place the vendor package loads).
 *
 * Memory-only path (BR-4/BR-5, NFR-D05): the recording's audio is
 * decoded by ffmpeg with stdout piping into a Buffer, converted PCM
 * is streamed to the child over stdin, and the child returns turns
 * JSON on stdout. No temp file of plaintext audio is created by this
 * code anywhere; voice-print embeddings exist only inside the child
 * and die at its exit — success, failure, timeout-kill, or crash.
 *
 * Failure taxonomy (§3.5), carried on `errorClass`:
 *   decode_failed  — ffmpeg exited non-zero, produced no PCM, or
 *                    exceeded the decode timeout (#1927)
 *   engine_timeout — supervisor killed the child at the hard timeout
 *   engine_oom     — child terminated by an external signal (OOM kill)
 *   engine_failed  — everything else (spawn error, non-zero exit,
 *                    malformed child output)
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const ENGINE_PACKAGE = '@desert-ant-labs/who';
// Step-0 measured model version for the pinned weights (BR-8: any
// package/weights change is a code change and must update this).
const MODEL_VERSION = 'v0.3.4';
// Pinned SDK version (BR-8 pattern, #1927): the worker package pins
// @desert-ant-labs/who at exactly this; a child reporting anything
// else (including its own 'unknown' fallback) is the wrong package
// and its output must never reach a run row.
const EXPECTED_SDK_VERSION = '4.2.1';
const SAMPLE_RATE = 16000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // §3.5 hard timeout
const CHILD_PATH = path.join(__dirname, '..', 'workers', 'diarization', 'engine-child.mjs');
const STDERR_CAP = 4096;
// Decode is a pure transcode running many times faster than realtime
// (a 60-min recording decodes in ~1–3 min on a modest vCPU); 10 min
// is generous headroom, but finite — a hung ffmpeg must fail the job
// instead of stalling the worker's poll loop behind a heartbeat-fresh
// claim, defeating stale-claim recovery (#1927).
const DEFAULT_DECODE_TIMEOUT_MS = 10 * 60 * 1000;
// Turns JSON is ~50–60 bytes/turn; a pathological 60-min recording
// (a turn every 2 s) is ~110 KB. 1 MiB is ~9x headroom and bounds
// supervisor memory against a runaway child (#1927).
const STDOUT_CAP = 1024 * 1024;

class DiarizationEngineError extends Error {
	constructor(errorClass, message) {
		super(message);
		this.name = 'DiarizationEngineError';
		this.errorClass = errorClass;
	}
}

/**
 * Decode an audio buffer to raw PCM (s16le, 16 kHz mono) entirely in
 * memory: ffmpeg reads stdin, writes stdout. Never touches disk.
 * @param {Buffer} audioBuffer
 * @param {object} [opts] - { ffmpegPath, spawnFn, decodeTimeoutMs } (spawnFn is a test seam)
 * @returns {Promise<Buffer>} PCM bytes
 */
function decodeToPcm(audioBuffer, opts = {}) {
	const spawnFn = opts.spawnFn || spawn;
	const ffmpegPath = opts.ffmpegPath || 'ffmpeg';
	const decodeTimeoutMs = opts.decodeTimeoutMs ?? DEFAULT_DECODE_TIMEOUT_MS;
	return new Promise((resolve, reject) => {
		const child = spawnFn(
			ffmpegPath,
			['-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', String(SAMPLE_RATE), 'pipe:1'],
			{ stdio: ['pipe', 'pipe', 'pipe'] },
		);
		const chunks = [];
		let stderr = '';
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
		}, decodeTimeoutMs);
		child.stdout.on('data', (d) => chunks.push(d));
		child.stderr.on('data', (d) => {
			if (stderr.length < STDERR_CAP) stderr += d.toString();
		});
		child.on('error', (err) => {
			clearTimeout(timer);
			reject(new DiarizationEngineError('decode_failed', `ffmpeg spawn failed: ${err.message}`));
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			if (timedOut) {
				reject(
					new DiarizationEngineError(
						'decode_failed',
						`ffmpeg exceeded ${decodeTimeoutMs}ms decode timeout`,
					),
				);
				return;
			}
			const pcm = Buffer.concat(chunks);
			if (code !== 0) {
				reject(
					new DiarizationEngineError(
						'decode_failed',
						`ffmpeg exited ${code}: ${stderr.trim().slice(0, 500)}`,
					),
				);
				return;
			}
			if (pcm.length === 0) {
				reject(new DiarizationEngineError('decode_failed', 'ffmpeg produced no PCM output'));
				return;
			}
			resolve(pcm);
		});
		// The child may die before consuming stdin (bad input) — the
		// close handler above reports the real failure; swallow EPIPE.
		child.stdin.on('error', () => {});
		child.stdin.end(audioBuffer);
	});
}

/**
 * Spawn the engine child for one job and collect its turns.
 * @param {Buffer} pcm - s16le PCM at SAMPLE_RATE
 * @param {object} [opts] - { childPath, timeoutMs, weightsDir, spawnFn, env }
 * @returns {Promise<{speakerCount:number, turns:Array<{speaker:number,start_s:number,end_s:number}>, engine:{package:string, sdkVersion:string, modelVersion:string}}>}
 */
function runEngineChild(pcm, opts = {}) {
	const spawnFn = opts.spawnFn || spawn;
	const childPath = opts.childPath || CHILD_PATH;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const env = { ...process.env, ...(opts.env || {}) };
	if (opts.weightsDir) env.DIARIZATION_WEIGHTS_DIR = opts.weightsDir;
	return new Promise((resolve, reject) => {
		const child = spawnFn(process.execPath, [childPath], {
			stdio: ['pipe', 'pipe', 'pipe'],
			env,
		});
		let stdout = '';
		let stdoutBytes = 0;
		let stdoutExceeded = false;
		let stderr = '';
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
		}, timeoutMs);
		child.stdout.on('data', (d) => {
			if (stdoutExceeded) return;
			stdoutBytes += d.length;
			if (stdoutBytes > STDOUT_CAP) {
				// Fail loudly and kill — never silently truncate, which
				// would surface as a misleading malformed-output error
				// while a runaway child kept running (#1927).
				stdoutExceeded = true;
				clearTimeout(timer);
				child.kill('SIGKILL');
				reject(
					new DiarizationEngineError(
						'engine_failed',
						`engine child stdout exceeded ${STDOUT_CAP}-byte cap`,
					),
				);
				return;
			}
			stdout += d.toString();
		});
		child.stderr.on('data', (d) => {
			if (stderr.length < STDERR_CAP) stderr += d.toString();
		});
		child.on('error', (err) => {
			clearTimeout(timer);
			reject(new DiarizationEngineError('engine_failed', `engine child spawn failed: ${err.message}`));
		});
		child.on('close', (code, signal) => {
			clearTimeout(timer);
			// The stdout-cap path already rejected engine_failed and
			// SIGKILLed the child (#2002): this close (with that signal)
			// must not fall through to the engine_oom branch and attempt
			// a second, dead reject.
			if (stdoutExceeded) return;
			if (timedOut) {
				reject(
					new DiarizationEngineError('engine_timeout', `engine child exceeded ${timeoutMs}ms timeout`),
				);
				return;
			}
			if (signal) {
				reject(
					new DiarizationEngineError('engine_oom', `engine child terminated by signal ${signal}`),
				);
				return;
			}
			if (code !== 0) {
				reject(
					new DiarizationEngineError(
						'engine_failed',
						`engine child exited ${code}: ${stderr.trim().slice(0, 500)}`,
					),
				);
				return;
			}
			const line = stdout.trim().split('\n').filter(Boolean).pop();
			let parsed;
			try {
				parsed = JSON.parse(line);
			} catch {
				reject(new DiarizationEngineError('engine_failed', 'engine child returned malformed output'));
				return;
			}
			const turnsOk =
				Array.isArray(parsed?.turns) &&
				parsed.turns.every(
					(t) =>
						Number.isFinite(t.speaker) && Number.isFinite(t.start_s) && Number.isFinite(t.end_s),
				);
			if (!Number.isInteger(parsed?.speakerCount) || !turnsOk) {
				reject(new DiarizationEngineError('engine_failed', 'engine child output failed validation'));
				return;
			}
			if (parsed.engine?.sdkVersion !== EXPECTED_SDK_VERSION) {
				reject(
					new DiarizationEngineError(
						'engine_failed',
						`engine child reported sdkVersion ${JSON.stringify(parsed.engine?.sdkVersion ?? null)}, expected pinned ${EXPECTED_SDK_VERSION}`,
					),
				);
				return;
			}
			resolve({
				speakerCount: parsed.speakerCount,
				// Strip to the §3.5 shape — nothing a child prints beyond
				// these three fields can reach persistence (privacy
				// review observation, PR #1926 comment 6468427118).
				turns: parsed.turns.map((t) => ({
					speaker: t.speaker,
					start_s: t.start_s,
					end_s: t.end_s,
				})),
				engine: {
					package: parsed.engine.package || ENGINE_PACKAGE,
					sdkVersion: parsed.engine.sdkVersion,
					modelVersion: parsed.engine.modelVersion || MODEL_VERSION,
				},
			});
		});
		child.stdin.on('error', () => {});
		child.stdin.end(pcm);
	});
}

/**
 * Full engine path for one recording's audio: decode, then diarize.
 * @param {Buffer} audioBuffer - the recording's audio (any ffmpeg-readable format)
 * @param {object} [opts] - forwarded decode/child options
 */
async function diarizeAudio(audioBuffer, opts = {}) {
	if (!audioBuffer || audioBuffer.length === 0) {
		throw new DiarizationEngineError('decode_failed', 'no audio to diarize');
	}
	const pcm = await decodeToPcm(audioBuffer, opts);
	return runEngineChild(pcm, opts);
}

/**
 * Provision the pinned weights cache (AC-1): spawns the child in
 * --provision mode; Who.load() downloads the pinned HF revision and
 * SHA-256-verifies it against the SDK's own manifest. Resolves true
 * on success; rejects with engine_failed otherwise (the caller —
 * worker start — logs and continues; jobs will fail honestly if the
 * cache is unusable).
 */
function provisionWeights(opts = {}) {
	const spawnFn = opts.spawnFn || spawn;
	const childPath = opts.childPath || CHILD_PATH;
	const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
	const env = { ...process.env, ...(opts.env || {}) };
	if (opts.weightsDir) env.DIARIZATION_WEIGHTS_DIR = opts.weightsDir;
	return new Promise((resolve, reject) => {
		const child = spawnFn(process.execPath, [childPath, '--provision'], {
			stdio: ['ignore', 'pipe', 'pipe'],
			env,
		});
		let stderr = '';
		const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
		child.stderr.on('data', (d) => {
			if (stderr.length < STDERR_CAP) stderr += d.toString();
		});
		child.on('error', (err) => {
			clearTimeout(timer);
			reject(new DiarizationEngineError('engine_failed', `provision spawn failed: ${err.message}`));
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			if (code !== 0) {
				reject(
					new DiarizationEngineError(
						'engine_failed',
						`weights provisioning exited ${code}: ${stderr.trim().slice(0, 500)}`,
					),
				);
				return;
			}
			resolve(true);
		});
	});
}

module.exports = {
	ENGINE_PACKAGE,
	MODEL_VERSION,
	EXPECTED_SDK_VERSION,
	STDOUT_CAP,
	DEFAULT_DECODE_TIMEOUT_MS,
	SAMPLE_RATE,
	DEFAULT_TIMEOUT_MS,
	CHILD_PATH,
	DiarizationEngineError,
	decodeToPcm,
	runEngineChild,
	diarizeAudio,
	provisionWeights,
};
