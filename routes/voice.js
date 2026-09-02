// Voice API Routes — Cartesia.ai TTS + STT integration
// Provides unified voice endpoints: POST /api/voice/tts and POST /api/voice/stt
// Includes rate limiting, auth, file upload, and comprehensive error handling

const express = require('express');
const router = express.Router();
const multer = require('multer');

const { authMiddleware } = require('../lib/auth');
const { rateLimits } = require('../lib/distributed-rate-limiter');
const voiceService = require('../services/cartesia-voice');
const {
	CartesiaRateLimitError,
	CartesiaAuthError,
	CartesiaNetworkError,
	CartesiaServerError,
	CartesiaValidationError,
	CartesiaError,
} = voiceService;

const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY;

// ─── Multer Configuration ──────────────────────────────────────────────────

const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 25 * 1024 * 1024, // 25MB max (Cartesia limit)
		files: 1,
	},
	fileFilter: (_req, file, cb) => {
		const allowed = /audio\/.+|application\/octet-stream/;
		if (allowed.test(file.mimetype)) {
			cb(null, true);
		} else {
			cb(new Error('Invalid file type. Only audio files are allowed.'), false);
		}
	},
});

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

// ─── Error Response Helper ─────────────────────────────────────────────────

function handleVoiceError(res, err) {
	console.error('[voice] Error:', err.message);

	if (err instanceof CartesiaRateLimitError) {
		return res.status(429).json({
			error: 'Voice API rate limit exceeded',

			retry_after: err.retryAfter,
		});
	}

	if (err instanceof CartesiaAuthError) {
		return res.status(401).json({
			error: 'Voice API authentication failed',
		});
	}

	if (err instanceof CartesiaNetworkError) {
		return res.status(502).json({
			error: 'Voice API network error',
		});
	}

	if (err instanceof CartesiaServerError) {
		return res.status(502).json({
			error: 'Voice upstream server error',
		});
	}

	if (err instanceof CartesiaValidationError) {
		return res.status(400).json({
			error: 'Voice API validation error',
		});
	}

	if (err instanceof CartesiaError) {
		return res.status(err.statusCode || 500).json({
			error: 'Voice API error',
		});
	}

	return res.status(500).json({
		error: 'Voice processing failed',
	});
}

// ─── Multer Error Handler ──────────────────────────────────────────────────

function handleMulterError(err, res) {
	if (err.code === 'LIMIT_FILE_SIZE') {
		return res.status(413).json({
			error: 'File too large',
			message: 'Audio file exceeds 25MB limit',
		});
	}
	if (err.message?.includes('Invalid file type')) {
		return res.status(415).json({
			error: 'Unsupported media type',
		});
	}
	return res.status(400).json({
		error: 'File upload error',
	});
}

// ─── POST /api/voice/tts — Text-to-Speech ──────────────────────────────────

router.post('/tts', authMiddleware, requireCartesiaKey, rateLimits.ai, async (req, res) => {
	try {
		const { text, voice_id, speed, emotion, language, model_id } = req.body;

		if (!text || typeof text !== 'string' || text.length === 0) {
			return res.status(400).json({ error: 'text is required and must be a non-empty string' });
		}
		if (text.length > 5000) {
			return res.status(400).json({ error: 'text exceeds 5000 character limit' });
		}

		const result = await voiceService.synthesize({
			text,
			voiceId: voice_id,
			speed: speed !== undefined ? parseFloat(speed) : undefined,
			emotion,
			language,
			modelId: model_id,
		});

		// Track usage
		console.log(
			`[voice/tts] user=${req.user?.id || 'unknown'} chars=${text.length} voice=${voice_id || 'default'} file=${result.fileName} cached=${result.cached}`,
		);

		res.json({
			success: true,
			audio_url: result.publicUrl,
			file_name: result.fileName,
			duration: result.duration,
			text_length: result.textLength,
			credits_used: result.creditsUsed,
			format: result.format,
			voice_id: voice_id || process.env.CARTESIA_DEFAULT_VOICE_ID,
			cached: result.cached || false,
			timestamp: new Date().toISOString(),
		});
	} catch (err) {
		handleVoiceError(res, err);
	}
});

// ─── POST /api/voice/interview-feedback-audio — Interview feedback TTS ─────

router.post('/interview-feedback-audio', authMiddleware, requireCartesiaKey, async (req, res) => {
	try {
		const { interview_id, feedback_text, voice_id } = req.body;

		if (!interview_id || typeof interview_id !== 'string') {
			return res.status(400).json({ error: 'interview_id is required and must be a string' });
		}
		if (!feedback_text || typeof feedback_text !== 'string' || feedback_text.length === 0) {
			return res
				.status(400)
				.json({ error: 'feedback_text is required and must be a non-empty string' });
		}
		if (feedback_text.length > 5000) {
			return res.status(400).json({ error: 'feedback_text exceeds 5000 character limit' });
		}

		const result = await voiceService.synthesize({
			text: feedback_text,
			voiceId: voice_id,
		});

		console.log(
			`[voice/interview-feedback-audio] user=${req.user?.id || 'unknown'} interview=${interview_id} chars=${feedback_text.length} voice=${voice_id || 'default'} file=${result.fileName} cached=${result.cached}`,
		);

		res.json({
			success: true,
			audio_url: result.publicUrl,
			duration: result.duration,
			cached: result.cached || false,
			timestamp: new Date().toISOString(),
		});
	} catch (err) {
		console.error('[voice/interview-feedback-audio] TTS failed:', err.message);
		// Graceful fallback: don't propagate Cartesia errors to the client
		res.json({
			success: false,
			error: 'TTS unavailable',
			fallback_text: req.body.feedback_text,
			timestamp: new Date().toISOString(),
		});
	}
});

// ─── POST /api/voice/stt — Speech-to-Text ──────────────────────────────────

router.post(
	'/stt',
	authMiddleware,
	requireCartesiaKey,
	rateLimits.ai,
	upload.single('audio'),
	async (req, res) => {
		try {
			if (!req.file) {
				return res.status(400).json({ error: 'audio file is required (field name: "audio")' });
			}

			const { language, model } = req.body;

			const result = await voiceService.transcribe({
				audioBuffer: req.file.buffer,
				fileName: req.file.originalname,
				language,
				model,
			});

			// Track usage
			console.log(
				`[voice/stt] user=${req.user?.id || 'unknown'} file=${req.file.originalname} duration=${result.duration || 'unknown'}`,
			);

			res.json({
				success: true,
				transcript: result.transcript,
				duration: result.duration,
				language: result.language,
				word_timestamps: result.wordTimestamps,
				model: result.model,
				credits_used: result.creditsUsed,
				file_name: req.file.originalname,
				file_size: req.file.size,
				timestamp: new Date().toISOString(),
			});
		} catch (err) {
			handleVoiceError(res, err);
		}
	},
);

// ─── Multer error middleware for /stt ──────────────────────────────────────

router.use('/stt', (err, _req, res, _next) => {
	if (err instanceof multer.MulterError || err.message?.includes('Invalid file type')) {
		return handleMulterError(err, res);
	}
	// Pass other errors to default handler
	handleVoiceError(res, err);
});

// ─── GET /api/voice/voices — List available voices ─────────────────────────

router.get('/voices', authMiddleware, requireCartesiaKey, async (_req, res) => {
	try {
		const voices = await voiceService.listVoices();
		res.json({ success: true, voices });
	} catch (err) {
		handleVoiceError(res, err);
	}
});

// ─── GET /api/voice/health — Health check (no auth required) ───────────────

router.get('/health', async (_req, res) => {
	try {
		const health = await voiceService.healthCheck();
		const statusCode = health.healthy ? 200 : 503;
		res.status(statusCode).json({
			success: health.healthy,
			service: 'voice',
			provider: 'cartesia',
			configured: health.configured,
			stt_healthy: health.sttHealthy,
			tts_healthy: health.ttsHealthy,
			status: health.status,
			error: health.error,
			timestamp: new Date().toISOString(),
		});
	} catch (err) {
		console.error('[voice] Health check error:', err.message);
		res.status(503).json({
			success: false,
			service: 'voice',
			provider: 'cartesia',
			error: 'Voice health check failed',
			timestamp: new Date().toISOString(),
		});
	}
});

// ─── DELETE /api/voice/audio/:fileName — Delete stored audio ───────────────

router.delete('/audio/:fileName', authMiddleware, async (req, res) => {
	try {
		const { fileName } = req.params;
		if (!fileName || !/^[a-zA-Z0-9_-]+\.\w+$/.test(fileName)) {
			return res.status(400).json({ error: 'Invalid file name' });
		}

		const result = await voiceService.deleteAudio(fileName);
		if (result.success) {
			res.json({ success: true, message: `Audio ${fileName} deleted` });
		} else {
			res.status(404).json({ error: 'Audio file not found', message: result.error });
		}
	} catch (_err) {
		res.status(500).json({ error: 'Failed to delete audio' });
	}
});

module.exports = router;
