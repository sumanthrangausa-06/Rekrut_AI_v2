// TTS (Text-to-Speech) API Routes — Cartesia.ai integration
// Refactored to use services/tts-service.js for clean separation of concerns
// Fixes: GitHub issue #1 from agent-collaboration repo

const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../lib/auth');
const _pool = require('../lib/db');

const ttsService = require('../services/tts-service');
const {
	CartesiaRateLimitError,
	CartesiaAuthError,
	CartesiaNetworkError,
	CartesiaServerError,
	CartesiaError,
} = ttsService;

const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY;
const CARTESIA_DEFAULT_VOICE_ID = process.env.CARTESIA_DEFAULT_VOICE_ID || 'f9fc912e-52f0-448a-8bfa-47e9ca75f25a';

// ─── Middleware ──────────────────────────────────────────────────────────────

function requireCartesiaKey(_req, res, next) {
	if (!CARTESIA_API_KEY) {
		return res.status(503).json({
			error: 'Cartesia API key not configured',
			message: 'Set CARTESIA_API_KEY environment variable',
		});
	}
	next();
}

// ─── Error Response Helper ───────────────────────────────────────────────────

function handleTtsError(res, err) {
	console.error('[tts] Error:', err.message);

	if (err instanceof CartesiaRateLimitError) {
		return res.status(429).json({
			error: 'TTS rate limit exceeded',

			retry_after: err.retryAfter,
		});
	}

	if (err instanceof CartesiaAuthError) {
		return res.status(401).json({
			error: 'TTS authentication failed',

		});
	}

	if (err instanceof CartesiaNetworkError) {
		return res.status(502).json({
			error: 'TTS network error',

		});
	}

	if (err instanceof CartesiaServerError) {
		return res.status(502).json({
			error: 'TTS upstream server error',

		});
	}

	if (err instanceof CartesiaError) {
		return res.status(err.statusCode || 500).json({
			error: 'TTS API error',

		});
	}

	return res.status(500).json({
		error: 'TTS synthesis failed',

	});
}

// ─── POST /api/tts/synthesize ──────────────────────────────────────────────

router.post('/synthesize', authMiddleware, requireCartesiaKey, async (req, res) => {
	try {
		const { text, voice_id, speed, emotion, language } = req.body;

		if (!text || typeof text !== 'string' || text.length === 0) {
			return res.status(400).json({ error: 'text is required and must be a non-empty string' });
		}
		if (text.length > 5000) {
			return res.status(400).json({ error: 'text exceeds 5000 character limit' });
		}

		const voiceId = voice_id || CARTESIA_DEFAULT_VOICE_ID;

		const audioBuffer = await ttsService.synthesize({
			text,
			voiceId,
			speed: speed !== undefined ? parseFloat(speed) : undefined,
			emotion,
			language,
		});

		// Track usage (Phase 1: log only, Phase 2: monthly credit tracking)
		console.log(
			`[tts] user=${req.user?.id || 'unknown'} chars=${text.length} voice=${voiceId}`,
		);

		res.set('Content-Type', 'audio/mpeg');
		res.set('Content-Length', audioBuffer.length);
		res.set('Cache-Control', 'private, max-age=3600');
		res.send(audioBuffer);
	} catch (err) {
		handleTtsError(res, err);
	}
});

// ─── GET /api/tts/voices ───────────────────────────────────────────────────

router.get('/voices', authMiddleware, requireCartesiaKey, async (_req, res) => {
	try {
		const voices = await ttsService.listVoices();
		res.json({ success: true, voices });
	} catch (err) {
		handleTtsError(res, err);
	}
});

// ─── GET /api/tts/health ─────────────────────────────────────────────────────
// Health check for the TTS service (no auth required for monitoring)

router.get('/health', async (_req, res) => {
	try {
		const health = await ttsService.healthCheck();
		const statusCode = health.healthy ? 200 : 503;
		res.status(statusCode).json({
			success: health.healthy,
			service: 'tts',
			provider: 'cartesia',
			configured: health.configured,
			status: health.status,
			error: health.error,
			timestamp: new Date().toISOString(),
		});
	} catch (err) {
		console.error('[tts] Health check error:', err.message);
		res.status(503).json({
			success: false,
			service: 'tts',
			provider: 'cartesia',
			error: 'TTS health check failed',
			timestamp: new Date().toISOString(),
		});
	}
});

module.exports = router;
