/**
 * Self-hosted Audio Processing — CPU-based TTS/STT requiring zero API keys.
 *
 * Layer 2 in the audio fallback chain: OpenAI → Self-hosted → Deepgram
 *
 * STT: whisper.cpp (tiny.en model, ~75MB, English-only, fastest CPU inference)
 * TTS: Piper TTS (en_US-lessac-medium voice, ~35MB, natural-sounding)
 *
 * Both run as child processes — no in-process memory overhead.
 * If binaries aren't installed, these functions throw and the fallback chain
 * automatically skips to Deepgram (Layer 3).
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// ─── Paths ───────────────────────────────────────────────────
const BASE_DIR = path.join(process.cwd(), 'bin', 'audio');
const MODELS_DIR = path.join(BASE_DIR, 'models');

const WHISPER_CLI = path.join(BASE_DIR, 'whisper-cli');
const WHISPER_MODEL = path.join(MODELS_DIR, 'ggml-tiny.en.bin');
const PIPER_BIN = path.join(BASE_DIR, 'piper', 'piper');
const PIPER_LIB_DIR = path.join(BASE_DIR, 'piper', 'lib');
const PIPER_ESPEAK_DIR = path.join(BASE_DIR, 'piper', 'espeak-ng-data');
const PIPER_MODEL = path.join(MODELS_DIR, 'en_US-lessac-medium.onnx');

// ─── State ───────────────────────────────────────────────────
let sttAvailable = false;
let ttsAvailable = false;

/**
 * Check if binaries + models are present AND actually runnable. Call once at startup.
 * File existence alone is NOT sufficient — binary may exist but fail at runtime
 * due to missing shared libraries (e.g., libwhisper.so.1 on Render).
 */
function initialize() {
	// Step 1: Check file existence (fast)
	const sttFilesExist = fs.existsSync(WHISPER_CLI) && fs.existsSync(WHISPER_MODEL);
	const ttsFilesExist = fs.existsSync(PIPER_BIN) && fs.existsSync(PIPER_MODEL);

	// Step 2: Actually verify binaries can execute (catches missing shared libs)
	if (sttFilesExist) {
		try {
			const { execFileSync } = require('node:child_process');
			execFileSync(WHISPER_CLI, ['--help'], { timeout: 5000, stdio: 'pipe' });
			sttAvailable = true;
		} catch (e) {
			sttAvailable = false;
			console.warn(
				`[self-hosted-audio] STT binary exists but can't run: ${(e.message || '').substring(0, 120)}`,
			);
		}
	} else {
		sttAvailable = false;
	}

	if (ttsFilesExist) {
		try {
			const { execFileSync } = require('node:child_process');
			execFileSync(PIPER_BIN, ['--help'], { timeout: 5000, stdio: 'pipe' });
			ttsAvailable = true;
		} catch (e) {
			ttsAvailable = false;
			console.warn(
				`[self-hosted-audio] TTS binary exists but can't run: ${(e.message || '').substring(0, 120)}`,
			);
		}
	} else {
		ttsAvailable = false;
	}

	console.log(
		`[self-hosted-audio] STT (whisper.cpp tiny.en): ${sttAvailable ? 'READY' : 'not installed'}`,
	);
	console.log(
		`[self-hosted-audio] TTS (Piper lessac-medium): ${ttsAvailable ? 'READY' : 'not installed'}`,
	);

	return { sttAvailable, ttsAvailable };
}

// ─── Helper: run a child process with timeout ────────────────
function runProcess(command, args, opts = {}) {
	return new Promise((resolve, reject) => {
		const timeout = opts.timeout || 30000;
		const env = opts.env || process.env;
		const input = opts.input || null;

		const proc = spawn(command, args, {
			env,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let stdout = Buffer.alloc(0);
		let stderr = '';
		let killed = false;

		proc.stdout.on('data', (chunk) => {
			stdout = Buffer.concat([stdout, chunk]);
		});
		proc.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});

		const timer = setTimeout(() => {
			killed = true;
			proc.kill('SIGKILL');
			// Reject only once the process is actually dead (2 s grace):
			// callers clean up files the process was writing — Gate A's
			// secure wipe (zero-fill + unlink) must not race a still-running
			// whisper that could rewrite plaintext output afterwards
			// (security review SEC-MAJOR-2).
			const grace = setTimeout(() => {
				reject(new Error(`Process timeout after ${timeout}ms`));
			}, 2000);
			proc.once('close', () => {
				clearTimeout(grace);
				reject(new Error(`Process timeout after ${timeout}ms`));
			});
		}, timeout);

		proc.on('close', (code) => {
			clearTimeout(timer);
			if (killed) return;
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(new Error(`Exit code ${code}: ${stderr.substring(0, 300)}`));
			}
		});

		proc.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});

		if (input) {
			proc.stdin.write(input);
			proc.stdin.end();
		} else {
			proc.stdin.end();
		}
	});
}

// ─── STT: whisper.cpp ────────────────────────────────────────

/**
 * Transcribe audio using local whisper.cpp (CPU, no API key).
 *
 * @param {Buffer} audioBuffer - Raw audio data (WAV/MP3/WebM)
 * @param {string} filename - Original filename for format detection
 * @param {string} contentType - MIME type
 * @param {object} [options] - Gate A (S-085 #787, design §7.4) capture-path
 *   options. Defaults preserve existing callers' behaviour exactly:
 *   - options.tmpDir: write whisper's files here instead of the shared
 *     os.tmpdir() (the capture path passes its mode-0700 workdir), and
 *     zero-fill files before unlinking instead of plain-unlink cleanup.
 *   - options.suppressTranscriptLog: never put transcript text in the log
 *     line — the success line reports byte/char counts only.
 * @returns {Object} OpenAI Whisper-compatible JSON result
 */
async function transcribe(audioBuffer, filename, contentType, options = {}) {
	if (!sttAvailable) {
		const err = new Error('Self-hosted STT not available (whisper.cpp binaries missing)');
		err.notAvailable = true;
		throw err;
	}

	const id = crypto.randomBytes(6).toString('hex');
	const ext = getExtFromMime(contentType, filename);
	const workDir = options.tmpDir || os.tmpdir();
	const tmpInput = path.join(workDir, `wh-in-${id}${ext}`);
	const tmpOutputBase = path.join(workDir, `wh-out-${id}`);

	try {
		fs.writeFileSync(tmpInput, audioBuffer);

		// whisper.cpp args: model, input file, output JSON, 2 threads (conserve CPU)
		const args = [
			'-m',
			WHISPER_MODEL,
			'-f',
			tmpInput,
			'-oj', // output JSON
			'-of',
			tmpOutputBase, // output file base path
			'-t',
			'2', // threads
			'-p',
			'1', // processors
			'--no-prints', // suppress progress output
		];

		await runProcess(WHISPER_CLI, args, { timeout: 30000 });

		// Parse JSON output
		const jsonPath = `${tmpOutputBase}.json`;
		let transcript = '';

		if (fs.existsSync(jsonPath)) {
			const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
			// whisper.cpp JSON format: { transcription: [{ text: "..." }] }
			if (raw.transcription && Array.isArray(raw.transcription)) {
				transcript = raw.transcription
					.map((s) => s.text)
					.join(' ')
					.trim();
			} else if (raw.text) {
				transcript = raw.text.trim();
			}
		}

		if (!transcript || transcript.trim().length === 0) {
			throw new Error('Self-hosted STT: empty transcript');
		}

		if (options.suppressTranscriptLog) {
			// Gate A §7.4: transcript text must never reach a log on the
			// capture path — counts only.
			console.log(
				`[self-hosted-audio] STT OK: ${audioBuffer.length} bytes → ${transcript.length} chars (transcript logging suppressed)`,
			);
		} else {
			console.log(
				`[self-hosted-audio] STT OK: ${audioBuffer.length} bytes → "${transcript.substring(0, 80)}..."`,
			);
		}

		// Return OpenAI Whisper-compatible format
		return {
			text: transcript,
			language: 'en',
			duration: 0,
			segments: [],
			_provider: 'self-hosted-whisper',
		};
	} finally {
		const files = [
			tmpInput,
			`${tmpOutputBase}.json`,
			`${tmpOutputBase}.txt`,
			`${tmpOutputBase}.srt`,
			`${tmpOutputBase}.vtt`,
		];
		if (options.tmpDir) {
			// Gate A §7.4: capture-path files are zero-filled over their full
			// length before unlink, on EVERY exit path (the default shared-
			// tmpdir path keeps the historical plain-unlink behaviour).
			secureCleanup(...files);
		} else {
			cleanup(...files);
		}
	}
}

// ─── TTS: Piper ──────────────────────────────────────────────

/**
 * Synthesize speech using local Piper TTS (CPU, no API key).
 *
 * @param {string} text - Text to convert to speech
 * @param {Object} options - { voice, speed }
 * @returns {Buffer} WAV audio buffer
 */
async function synthesize(text, options = {}) {
	if (!ttsAvailable) {
		const err = new Error('Self-hosted TTS not available (Piper binaries missing)');
		err.notAvailable = true;
		throw err;
	}

	const truncated = text.length > 4000 ? text.substring(0, 4000) : text;
	const id = crypto.randomBytes(6).toString('hex');
	const tmpOutput = path.join(os.tmpdir(), `piper-${id}.wav`);

	try {
		// Build environment with library paths for Piper's bundled deps
		const env = { ...process.env };
		if (fs.existsSync(PIPER_LIB_DIR)) {
			env.LD_LIBRARY_PATH = `${PIPER_LIB_DIR}${env.LD_LIBRARY_PATH ? `:${env.LD_LIBRARY_PATH}` : ''}`;
		}
		if (fs.existsSync(PIPER_ESPEAK_DIR)) {
			env.PIPER_ESPEAK_DATA = PIPER_ESPEAK_DIR;
		}

		const args = ['--model', PIPER_MODEL, '--output_file', tmpOutput];

		// Speed adjustment (Piper uses --length-scale, <1 = faster, >1 = slower)
		if (options.speed && options.speed !== 1.0) {
			const lengthScale = 1.0 / options.speed; // invert: speed 1.2 → scale 0.83
			args.push('--length-scale', String(Math.max(0.5, Math.min(2.0, lengthScale))));
		}

		await runProcess(PIPER_BIN, args, {
			timeout: 15000,
			env,
			input: truncated,
		});

		if (!fs.existsSync(tmpOutput)) {
			throw new Error('Piper produced no output file');
		}

		const buffer = fs.readFileSync(tmpOutput);

		if (buffer.length < 100) {
			throw new Error('Piper returned empty/invalid audio');
		}

		console.log(
			`[self-hosted-audio] TTS OK: ${truncated.length} chars → ${buffer.length} bytes WAV`,
		);
		return buffer;
	} finally {
		cleanup(tmpOutput);
	}
}

// ─── Utilities ───────────────────────────────────────────────

function getExtFromMime(contentType, filename) {
	const mimeToExt = {
		'audio/wav': '.wav',
		'audio/webm': '.webm',
		'audio/mp3': '.mp3',
		'audio/mpeg': '.mp3',
		'audio/mp4': '.mp4',
		'audio/ogg': '.ogg',
		'audio/flac': '.flac',
	};
	if (contentType && mimeToExt[contentType]) return mimeToExt[contentType];
	if (filename) {
		const ext = path.extname(filename);
		if (ext) return ext;
	}
	return '.wav';
}

function cleanup(...files) {
	for (const f of files) {
		try {
			fs.unlinkSync(f);
		} catch {}
	}
}

/** Zero-fill each file over its full length, then unlink (Gate A §7.4). */
function secureCleanup(...files) {
	for (const f of files) {
		try {
			const st = fs.statSync(f);
			if (st.isFile() && st.size > 0) {
				fs.writeFileSync(f, Buffer.alloc(st.size));
			}
			fs.unlinkSync(f);
		} catch {}
	}
}

// ─── Exports ─────────────────────────────────────────────────
module.exports = {
	initialize,
	transcribe,
	synthesize,
	isSTTAvailable: () => sttAvailable,
	isTTSAvailable: () => ttsAvailable,
};
