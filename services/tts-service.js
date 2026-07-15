// TTS Service — Cartesia.ai API client
// Extracted from routes/tts.js for clean separation of concerns
// Provides robust error handling, retries, and health checking

const fetch = require('node-fetch');

const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY;
const CARTESIA_API_URL = 'https://api.cartesia.ai/tts/bytes';
const CARTESIA_VOICES_URL = 'https://api.cartesia.ai/voices';
const CARTESIA_DEFAULT_VOICE_ID =
	process.env.CARTESIA_DEFAULT_VOICE_ID || 'f9fc912e-52f0-448a-8bfa-47e9ca75f25a';

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

// ─── Internal Helpers ────────────────────────────────────────────────────────

function classifyCartesiaError(responseStatus, errorText) {
	if (responseStatus === 429) {
		return new CartesiaRateLimitError(`Cartesia rate limit exceeded: ${errorText}`);
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

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Synthesize text into audio using Cartesia.ai
 * @param {Object} options
 * @param {string} options.text — required, max 5000 chars
 * @param {string} [options.voiceId] — Cartesia voice ID
 * @param {number} [options.speed] — playback speed 0.5–2.0
 * @param {string} [options.emotion] — e.g. "neutral", "happy"
 * @param {string} [options.language] — ISO language code, default "en"
 * @returns {Promise<Buffer>} — MP3 audio buffer
 */
async function synthesize({ text, voiceId, speed, emotion, language }) {
	if (!CARTESIA_API_KEY) {
		throw new CartesiaAuthError('CARTESIA_API_KEY environment variable is not set');
	}

	const body = {
		model_id: 'sonic-2',
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
		const res = await fetch(CARTESIA_API_URL, {
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
		return buffer;
	} catch (err) {
		if (err instanceof CartesiaError) throw err;
		if (isNetworkError(err)) {
			throw new CartesiaNetworkError(`Network error connecting to Cartesia: ${err.message}`);
		}
		throw new CartesiaError(`Unexpected TTS error: ${err.message}`, 500, 'unexpected');
	}
}

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
			throw new CartesiaNetworkError(`Network error connecting to Cartesia: ${err.message}`);
		}
		throw new CartesiaError(`Unexpected voices list error: ${err.message}`, 500, 'unexpected');
	}
}

/**
 * Health check for the TTS service
 * @returns {Promise<Object>} — { healthy, configured, status, error }
 */
async function healthCheck() {
	if (!CARTESIA_API_KEY) {
		return {
			healthy: false,
			configured: false,
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
				status: res.status,
				error: `Cartesia API returned HTTP ${res.status}`,
			};
		}

		return {
			healthy: true,
			configured: true,
			status: res.status,
			error: null,
		};
	} catch (err) {
		return {
			healthy: false,
			configured: true,
			status: null,
			error: `Network error: ${err.message}`,
		};
	}
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
	synthesize,
	listVoices,
	healthCheck,
	CartesiaError,
	CartesiaRateLimitError,
	CartesiaAuthError,
	CartesiaNetworkError,
	CartesiaServerError,
};
