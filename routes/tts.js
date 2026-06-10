// TTS (Text-to-Speech) API Routes — Cartesia.ai integration
// Phase 1: Basic synthesis endpoint
// Fixes: GitHub issue #1 from agent-collaboration repo

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../lib/auth');
const _pool = require('../lib/db');

const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY;
const CARTESIA_API_URL = 'https://api.cartesia.ai/tts/bytes';
const CARTESIA_DEFAULT_VOICE_ID = process.env.CARTESIA_DEFAULT_VOICE_ID || 'sonic-2';

// ─── Helpers ───────────────────────────────────────────────────────────────

function requireCartesiaKey(_req, res, next) {
	if (!CARTESIA_API_KEY) {
		return res.status(503).json({
			error: 'Cartesia API key not configured',
			message: 'Set CARTESIA_API_KEY environment variable',
		});
	}
	next();
}

async function cartesiaSynthesize({ text, voiceId, speed, emotion, language }) {
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

	if (speed) {
		body.speed = speed; // 0.5 - 2.0
	}

	const res = await fetch(CARTESIA_API_URL, {
		method: 'POST',
		headers: {
			'Cartesia-Version': '2024-06-10',
			'X-API-Key': CARTESIA_API_KEY,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`Cartesia API error ${res.status}: ${errText}`);
	}

	const buffer = Buffer.from(await res.arrayBuffer());
	return buffer;
}

// ─── POST /api/tts/synthesize ──────────────────────────────────────────────

router.post('/synthesize', authMiddleware, requireCartesiaKey, async (req, res) => {
	try {
		const { text, voice_id, speed, emotion, language } = req.body;

		if (!text || typeof text !== 'string' || text.length === 0) {
			return res.status(400).json({ error: 'text is required' });
		}
		if (text.length > 5000) {
			return res.status(400).json({ error: 'text exceeds 5000 character limit' });
		}

		const voiceId = voice_id || CARTESIA_DEFAULT_VOICE_ID;

		// Simple in-memory cache key (no persistence for Phase 1)
		// Phase 2: add DB cache table to avoid re-synthesis
		const audioBuffer = await cartesiaSynthesize({
			text,
			voiceId,
			speed: speed ? parseFloat(speed) : undefined,
			emotion,
			language,
		});

		// Track usage (Phase 1: log only, Phase 2: monthly credit tracking)
		console.log(`[tts] ${req.user.id} synthesized ${text.length} chars, voice=${voiceId}`);

		res.set('Content-Type', 'audio/mpeg');
		res.set('Content-Length', audioBuffer.length);
		res.send(audioBuffer);
	} catch (err) {
		console.error('[tts] Synthesis error:', err.message);
		res.status(502).json({
			error: 'TTS synthesis failed',
			message: err.message,
		});
	}
});

// ─── GET /api/tts/voices ───────────────────────────────────────────────────

router.get('/voices', authMiddleware, requireCartesiaKey, async (_req, res) => {
	try {
		const response = await fetch('https://api.cartesia.ai/voices', {
			headers: {
				'Cartesia-Version': '2024-06-10',
				'X-API-Key': CARTESIA_API_KEY,
			},
		});

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`Cartesia API error ${response.status}: ${errText}`);
		}

		const voices = await response.json();
		res.json({ success: true, voices });
	} catch (err) {
		console.error('[tts] Voices list error:', err.message);
		res.status(502).json({
			error: 'Failed to fetch voices',
			message: err.message,
		});
	}
});

// ─── GET /api/tts/health ───────────────────────────────────────────────────

router.get('/health', requireCartesiaKey, async (_req, res) => {
	try {
		const response = await fetch('https://api.cartesia.ai/voices', {
			headers: {
				'Cartesia-Version': '2024-06-10',
				'X-API-Key': CARTESIA_API_KEY,
			},
		});

		res.json({
			success: true,
			cartesia_connected: response.ok,
			api_key_configured: true,
		});
	} catch (err) {
		res.json({
			success: false,
			cartesia_connected: false,
			api_key_configured: true,
			error: err.message,
		});
	}
});

module.exports = router;
