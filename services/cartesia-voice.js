// Cartesia Voice Service — TTS + STT integration for Rekrut AI
// Provides unified voice AI capabilities: text-to-speech and speech-to-text
// Stores generated audio locally; supports Cartesia Sonic (TTS) and Ink-Whisper (STT)

const fetch = require('node-fetch');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const crypto = require('node:crypto');

const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY;
const CARTESIA_API_URL = 'https://api.cartesia.ai';
const CARTESIA_TTS_BYTES_URL = `${CARTESIA_API_URL}/tts/bytes`;
const CARTESIA_STT_URL = `${CARTESIA_API_URL}/stt`;
const CARTESIA_VOICES_URL = `${CARTESIA_API_URL}/voices`;
const CARTESIA_DEFAULT_VOICE_ID =
	process.env.CARTESIA_DEFAULT_VOICE_ID || 'f9fc912e-52f0-448a-8bfa-47e9ca75f25a';

// Local audio storage directory (relative to project root)
const AUDIO_STORAGE_DIR = path.join(__dirname, '..', 'public', 'audio');

// ─── Error Classes ─────────────────────────────────────────────────────────

class CartesiaError extends Error {
	constructor(message, statusCode, type) {
		super(message);
		this.statusCode = statusCode;
		this.type = type;
	}
}

class CartesiaRateLimitError extends CartesiaError {
	constructor(message, retryAfter) {
		super(message, 429, 'rate_limit');
		this.retryAfter = retryAfter || 60;
	}
}

class CartesiaAuthError extends CartesiaError {
	constructor(message) {
		super(message, 401, 'auth_error');
	}
}

class CartesiaNetworkError extends CartesiaError {
	constructor(message) {
		super(message, 502, 'network_error');
	}
}

class CartesiaServerError extends CartesiaError {
	constructor(message, statusCode) {
		super(message, statusCode || 500, 'server_error');
	}
}

class CartesiaValidationError extends CartesiaError {
	constructor(message) {
		super(message, 400, 'validation_error');
	}
}

// ─── Internal Helpers ──────────────────────────────────────────────────────

function classifyCartesiaError(responseStatus, errorText) {
	if (responseStatus === 429) {
		return new CartesiaRateLimitError(
			`Cartesia rate limit exceeded: ${errorText}`,
		);
	}
	if (responseStatus === 401 || responseStatus === 403) {
		return new CartesiaAuthError(
			`Cartesia authentication failed (${responseStatus}): ${errorText}`,
		);
	}
	if (responseStatus >= 500) {
		return new CartesiaServerError(
			`Cartesia server error ${responseStatus}: ${errorText}`,
			responseStatus,
		);
	}
	return new CartesiaError(
		`Cartesia API error ${responseStatus}: ${errorText}`,
		responseStatus,
		'api_error',
	);
}

function isNetworkError(err) {
	return (
		err.code === 'ECONNRESET' ||
		err.code === 'ETIMEDOUT' ||
		err.code === 'ENOTFOUND' ||
		err.code === 'ECONNREFUSED' ||
		err.type === 'request-timeout' ||
		err.message?.includes('network') ||
		err.message?.includes('timeout')
	);
}

async function ensureAudioDir() {
	try {
		await mkdir(AUDIO_STORAGE_DIR, { recursive: true });
	} catch (err) {
		if (err.code !== 'EEXIST') throw err;
	}
}

function generateAudioFileName(ext = 'mp3') {
	const uuid = crypto.randomUUID();
	return `${uuid}.${ext}`;
}

// ─── TTS: Text-to-Speech ───────────────────────────────────────────────────

/**
 * Synthesize text into audio using Cartesia.ai, save locally, and return file info
 * @param {Object} options
 * @param {string} options.text — required, max 5000 chars
 * @param {string} [options.voiceId] — Cartesia voice ID
 * @param {number} [options.speed] — playback speed 0.5–2.0
 * @param {string} [options.emotion] — e.g. "neutral", "happy"
 * @param {string} [options.language] — ISO language code, default "en"
 * @param {string} [options.modelId] — TTS model, default "sonic-2"
 * @returns {Promise<Object>} — { fileName, filePath, publicUrl, duration, textLength }
 */
async function synthesize({ text, voiceId, speed, emotion, language, modelId }) {
	if (!CARTESIA_API_KEY) {
		throw new CartesiaAuthError('CARTESIA_API_KEY environment variable is not set');
	}
	if (!text || typeof text !== 'string' || text.length === 0) {
		throw new CartesiaValidationError('text is required and must be a non-empty string');
	}
	if (text.length > 5000) {
		throw new CartesiaValidationError('text exceeds 5000 character limit');
	}

	const body = {
		model_id: modelId || 'sonic-2',
		transcript: text,
		voice: { mode: 'id', id: voiceId || CARTESIA_DEFAULT_VOICE_ID },
		output_format: {
			container: 'mp3',
			encoding: 'mp3',
			sample_rate: 44100,
		},
		language: language || 'en',
	};

	if (speed !== undefined && speed !== null) {
		body.speed = parseFloat(speed);
	}
	if (emotion) {
		body.emotion = emotion;
	}

	try {
		const res = await fetch(CARTESIA_TTS_BYTES_URL, {
			method: 'POST',
			headers: {
				'Cartesia-Version': '2024-06-10',
				'X-API-Key': CARTESIA_API_KEY,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
			timeout: 30000, // 30s
		});

		if (!res.ok) {
			const errText = await res.text();
			throw classifyCartesiaError(res.status, errText);
		}

		const buffer = Buffer.from(await res.arrayBuffer());

		// Save to local storage
		await ensureAudioDir();
		const fileName = generateAudioFileName('mp3');
		const filePath = path.join(AUDIO_STORAGE_DIR, fileName);
		await writeFile(filePath, buffer);

		// Estimate duration: ~150 chars per 10 seconds at normal speed
		const estimatedDuration = Math.ceil((text.length / 150) * 10 / (body.speed || 1));

		return {
			fileName,
			filePath,
			publicUrl: `/audio/${fileName}`,
			audioUrl: `/audio/${fileName}`,
			duration: estimatedDuration,
			textLength: text.length,
			creditsUsed: text.length,
			format: 'mp3',
			sampleRate: 44100,
		};
	} catch (err) {
		if (err instanceof CartesiaError) throw err;
		if (isNetworkError(err)) {
			throw new CartesiaNetworkError(
				`Network error connecting to Cartesia: ${err.message}`,
			);
		}
		throw new CartesiaError(
			`Unexpected TTS error: ${err.message}`,
			500,
			'unexpected',
		);
	}
}

// ─── STT: Speech-to-Text ───────────────────────────────────────────────────

/**
 * Transcribe audio file to text using Cartesia Ink-Whisper
 * @param {Object} options
 * @param {Buffer} options.audioBuffer — audio file buffer
 * @param {string} [options.fileName] — original file name (for extension detection)
 * @param {string} [options.language] — ISO language code, default "en"
 * @param {string} [options.model] — STT model, default "ink-whisper"
 * @returns {Promise<Object>} — { transcript, duration, language, wordTimestamps }
 */
async function transcribe({ audioBuffer, fileName, language, model }) {
	if (!CARTESIA_API_KEY) {
		throw new CartesiaAuthError('CARTESIA_API_KEY environment variable is not set');
	}
	if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
		throw new CartesiaValidationError('audioBuffer is required and must be a Buffer');
	}
	if (audioBuffer.length === 0) {
		throw new CartesiaValidationError('audioBuffer is empty');
	}
	// Max 25MB per Cartesia batch STT docs
	if (audioBuffer.length > 25 * 1024 * 1024) {
		throw new CartesiaValidationError('audio file exceeds 25MB limit');
	}

	const ext = path.extname(fileName || 'audio.wav').slice(1) || 'wav';
	const mimeType = ext === 'mp3' || ext === 'mpeg' ? 'audio/mpeg' :
		ext === 'm4a' ? 'audio/mp4' :
		ext === 'ogg' ? 'audio/ogg' :
		ext === 'webm' ? 'audio/webm' :
		'audio/wav';

	// Build multipart form data manually (no form-data dependency needed for simple cases)
	const boundary = `----CartesiaFormBoundary${crypto.randomBytes(16).toString('hex')}`;
	const formParts = [];

	// file field
	formParts.push(
		Buffer.from(
			`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="file"; filename="audio.${ext}"\r\n` +
			`Content-Type: ${mimeType}\r\n\r\n`,
		),
	);
	formParts.push(audioBuffer);
	formParts.push(Buffer.from('\r\n'));

	// model field
	formParts.push(
		Buffer.from(
			`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="model"\r\n\r\n` +
			`${model || 'ink-whisper'}\r\n`,
		),
	);

	// language field
	formParts.push(
		Buffer.from(
			`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="language"\r\n\r\n` +
			`${language || 'en'}\r\n`,
		),
	);

	// timestamp_granularities field (word-level)
	formParts.push(
		Buffer.from(
			`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\n` +
			`word\r\n`,
		),
	);

	formParts.push(Buffer.from(`--${boundary}--\r\n`));

	const formBody = Buffer.concat(formParts);

	try {
		const res = await fetch(CARTESIA_STT_URL, {
			method: 'POST',
			headers: {
				'Cartesia-Version': '2024-06-10',
				'X-API-Key': CARTESIA_API_KEY,
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
			},
			body: formBody,
			timeout: 60000, // 60s for STT (longer audio files)
		});

		if (!res.ok) {
			const errText = await res.text();
			throw classifyCartesiaError(res.status, errText);
		}

		const data = await res.json();

		return {
			transcript: data.text || '',
			duration: data.duration || null,
			language: data.language || language || 'en',
			wordTimestamps: data.words || null,
			model: model || 'ink-whisper',
			creditsUsed: data.duration ? Math.ceil(data.duration) : 0, // 1 credit/sec
		};
	} catch (err) {
		if (err instanceof CartesiaError) throw err;
		if (isNetworkError(err)) {
			throw new CartesiaNetworkError(
				`Network error connecting to Cartesia: ${err.message}`,
			);
		}
		throw new CartesiaError(
			`Unexpected STT error: ${err.message}`,
			500,
			'unexpected',
		);
	}
}

// ─── Voice Listing ─────────────────────────────────────────────────────────

/**
 * List available Cartesia voices
 * @returns {Promise<Array>} — voices array
 */
async function listVoices() {
	if (!CARTESIA_API_KEY) {
		throw new CartesiaAuthError('CARTESIA_API_KEY environment variable is not set');
	}

	try {
		const res = await fetch(CARTESIA_VOICES_URL, {
			headers: {
				'Cartesia-Version': '2024-06-10',
				'X-API-Key': CARTESIA_API_KEY,
			},
			timeout: 15000, // 15s
		});

		if (!res.ok) {
			const errText = await res.text();
			throw classifyCartesiaError(res.status, errText);
		}

		return await res.json();
	} catch (err) {
		if (err instanceof CartesiaError) throw err;
		if (isNetworkError(err)) {
			throw new CartesiaNetworkError(
				`Network error connecting to Cartesia: ${err.message}`,
			);
		}
		throw new CartesiaError(
			`Unexpected voices list error: ${err.message}`,
			500,
			'unexpected',
		);
	}
}

// ─── Health Check ──────────────────────────────────────────────────────────

/**
 * Health check for the Cartesia voice service
 * @returns {Promise<Object>} — { healthy, configured, status, error }
 */
async function healthCheck() {
	if (!CARTESIA_API_KEY) {
		return {
			healthy: false,
			configured: false,
			sttHealthy: false,
			ttsHealthy: false,
			error: 'CARTESIA_API_KEY environment variable is not set',
		};
	}

	try {
		const res = await fetch(CARTESIA_VOICES_URL, {
			headers: {
				'Cartesia-Version': '2024-06-10',
				'X-API-Key': CARTESIA_API_KEY,
			},
			timeout: 10000, // 10s
		});

		if (!res.ok) {
			return {
				healthy: false,
				configured: true,
				sttHealthy: false,
				ttsHealthy: false,
				status: res.status,
				error: `Cartesia API returned HTTP ${res.status}`,
			};
		}

		return {
			healthy: true,
			configured: true,
			sttHealthy: true,
			ttsHealthy: true,
			status: res.status,
			error: null,
		};
	} catch (err) {
		return {
			healthy: false,
			configured: true,
			sttHealthy: false,
			ttsHealthy: false,
			status: null,
			error: `Network error: ${err.message}`,
		};
	}
}

// ─── Storage Utilities ─────────────────────────────────────────────────────

/**
 * Delete an audio file from local storage
 * @param {string} fileName — audio file name
 */
async function deleteAudio(fileName) {
	const filePath = path.join(AUDIO_STORAGE_DIR, fileName);
	try {
		fs.unlinkSync(filePath);
		return { success: true };
	} catch (err) {
		return { success: false, error: err.message };
	}
}

/**
 * Get the full local path for an audio file
 * @param {string} fileName
 * @returns {string}
 */
function getAudioPath(fileName) {
	return path.join(AUDIO_STORAGE_DIR, fileName);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
	synthesize,
	transcribe,
	listVoices,
	healthCheck,
	deleteAudio,
	getAudioPath,
	ensureAudioDir,
	CartesiaError,
	CartesiaRateLimitError,
	CartesiaAuthError,
	CartesiaNetworkError,
	CartesiaServerError,
	CartesiaValidationError,
};
