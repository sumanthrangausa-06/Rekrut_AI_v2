/**
 * Unified interview-session endpoints — Phase 1 conversational AI interviews (#322).
 *
 * Mounted at /api/interviews (after interviewRoutes in server.js):
 *   POST   /interview-sessions                 create a session (frozen engine config)
 *   POST   /interview-sessions/:id/start       idempotent start + AI intro turn
 *   POST   /interview-sessions/:id/respond     text or audio turn (per-turn persistence)
 *   POST   /interview-sessions/:id/complete    finalize + evaluation report
 *   POST   /interview-sessions/:id/tts         synthesize a turn's text to audio
 *   GET    /interview-sessions                 unified list (unified sessions +
 *                                              read-linked human-scheduled interviews)
 *
 * Every turn delegates to services/conversation-engine (conductTurn) — this
 * router never duplicates turn logic. Conversation is persisted after every
 * turn (crash-resume safe).
 */

const express = require('express');
const crypto = require('node:crypto');
const multer = require('multer');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { conductTurn } = require('../services/conversation-engine');
const { generateScreeningReport } = require('../services/interview-ai');
const aiProvider = require('../lib/ai-provider');
const { textToSpeech } = require('../lib/polsia-ai');

const router = express.Router();
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 25 * 1024 * 1024 },
});

const SESSION_TYPES = ['screening', 'ai_interview', 'practice'];

async function loadSession(id) {
	const result = await pool.query('SELECT * FROM interview_sessions WHERE id = $1', [id]);
	return result.rows[0] || null;
}

function canAccess(session, user) {
	if (!user) return false;
	if (Number(user.id) === Number(session.candidate_id)) return true;
	return user.role === 'recruiter' || user.role === 'admin';
}

function newTimestamp() {
	return new Date().toISOString();
}

// POST /interview-sessions — create a session with the engine config frozen at creation.
// Task 2 contract: the creator writes config.question_source plus every config key the
// engine reads (job/template/current_phase for template source; target_role/base_questions/
// current_question_index/options for personalized source).
router.post('/interview-sessions', authMiddleware, async (req, res) => {
	try {
		const { type, job_id, application_id, candidate_id, company_id, invite_token, config } =
			req.body || {};

		if (!type || !SESSION_TYPES.includes(type)) {
			return res.status(400).json({ error: `type must be one of: ${SESSION_TYPES.join(', ')}` });
		}

		const frozen = { ...(config || {}) };
		if (!frozen.question_source) {
			frozen.question_source = type === 'ai_interview' ? 'personalized' : 'template';
		}
		if (frozen.question_source === 'personalized') {
			if (frozen.current_question_index == null) frozen.current_question_index = 0;
			if (!Array.isArray(frozen.base_questions)) frozen.base_questions = [];
			if (!frozen.options) frozen.options = {};
		} else {
			if (!frozen.current_phase) frozen.current_phase = 'intro';
			if (!frozen.job) frozen.job = {};
			if (!frozen.template) frozen.template = {};
		}

		const token = invite_token || crypto.randomBytes(32).toString('hex');
		const result = await pool.query(
			`INSERT INTO interview_sessions
			   (type, job_id, application_id, candidate_id, company_id, triggered_by, invite_token, status, config, conversation)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, 'invited', $8, $9)
			 RETURNING *`,
			[
				type,
				job_id || null,
				application_id || null,
				candidate_id || req.user.id,
				company_id || null,
				req.user.id,
				token,
				JSON.stringify(frozen),
				JSON.stringify([]),
			],
		);

		res.status(201).json({ success: true, session: result.rows[0] });
	} catch (err) {
		console.error('[interview-sessions] create error:', err.message);
		res.status(500).json({ error: 'Failed to create interview session' });
	}
});

// POST /interview-sessions/:id/start — idempotent start; generates the AI intro turn.
router.post('/interview-sessions/:id/start', authMiddleware, async (req, res) => {
	try {
		const session = await loadSession(req.params.id);
		if (!session) {
			return res.status(404).json({ error: 'Session not found' });
		}
		if (!canAccess(session, req.user)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		if (session.status !== 'invited') {
			return res.json({ success: true, session, already_started: true });
		}

		const config = { ...(session.config || {}) };
		const intro = await conductTurn({ conversation: [], config }, '', []);

		// The intro consumes the first planned question slot for personalized sessions,
		// so the first respond's "next planned question" doesn't repeat it.
		if (config.question_source === 'personalized') {
			config.current_question_index = Math.min(
				(config.current_question_index || 0) + 1,
				Array.isArray(config.base_questions) ? config.base_questions.length : 0,
			);
		} else {
			config.current_phase = intro.phase;
		}

		const conversation = [
			{
				role: 'interviewer',
				text: intro.ai_message,
				phase: intro.phase,
				timestamp: newTimestamp(),
			},
		];
		const updated = await pool.query(
			`UPDATE interview_sessions
			    SET status = 'in_progress', started_at = NOW(), conversation = $1, config = $2
			  WHERE id = $3 RETURNING *`,
			[JSON.stringify(conversation), JSON.stringify(config), session.id],
		);

		res.json({
			success: true,
			session: updated.rows[0],
			ai_message: intro.ai_message,
			phase: intro.phase,
		});
	} catch (err) {
		console.error('[interview-sessions] start error:', err.message);
		res.status(500).json({ error: 'Failed to start interview session' });
	}
});

// POST /interview-sessions/:id/respond — candidate turn (text or audio) + AI turn.
// Persists the conversation after every turn (crash-resume safe).
router.post(
	'/interview-sessions/:id/respond',
	authMiddleware,
	upload.single('audio'),
	async (req, res) => {
		try {
			const session = await loadSession(req.params.id);
			if (!session) {
				return res.status(404).json({ error: 'Session not found' });
			}
			if (!canAccess(session, req.user)) {
				return res.status(403).json({ error: 'Forbidden' });
			}
			if (session.status !== 'in_progress') {
				return res.status(409).json({ error: 'Session is not in progress' });
			}

			let candidateText = (req.body?.text || '').trim();
			let hasAudio = false;

			if (req.file) {
				const filename = req.file.originalname || 'recording.webm';
				try {
					const asrResult = await aiProvider.transcribeAudio(
						req.file.buffer,
						filename,
						req.file.mimetype,
						{ module: 'interview_sessions', feature: 'voice_transcription' },
					);
					if (asrResult?.text?.trim()) {
						candidateText = asrResult.text.trim();
						hasAudio = true;
					}
				} catch (asrErr) {
					console.error('[interview-sessions] transcription failed:', asrErr.message);
				}
				// Client SpeechRecognition fallback (mirrors the mock voice-respond path)
				if (!candidateText && (req.body?.client_transcript || '').trim().length >= 10) {
					candidateText = req.body.client_transcript.trim();
				}
			}

			if (!candidateText || candidateText.length < 2) {
				return res.status(400).json({ error: 'Response too short. Please elaborate.' });
			}

			const conversation = Array.isArray(session.conversation) ? [...session.conversation] : [];
			conversation.push({
				role: 'candidate',
				text: candidateText,
				...(hasAudio ? { has_audio: true } : {}),
				timestamp: newTimestamp(),
			});

			// Crash-resume safety: persist the candidate's answer BEFORE the
			// ≤20s LLM call — a crash/restart mid-turn must never lose it.
			await pool.query(`UPDATE interview_sessions SET conversation = $1 WHERE id = $2`, [
				JSON.stringify(conversation),
				session.id,
			]);

			const config = { ...(session.config || {}) };
			const frames = Array.isArray(req.body?.frames) ? req.body.frames : [];
			const result = await conductTurn({ conversation, config }, candidateText, frames);

			conversation.push({
				role: 'interviewer',
				text: result.ai_message,
				phase: result.phase,
				timestamp: newTimestamp(),
			});

			// Advance the frozen config for the next turn. The engine contract carries
			// no per-turn action, so: screening advances by phase; personalized
			// advances one planned question per turn (documented simplification —
			// the LLM still asks conversational follow-ups from history).
			if (config.question_source === 'personalized') {
				const total = Array.isArray(config.base_questions) ? config.base_questions.length : 0;
				config.current_question_index = Math.min((config.current_question_index || 0) + 1, total);
			} else {
				config.current_phase = result.phase;
			}

			const updated = await pool.query(
				`UPDATE interview_sessions SET conversation = $1, config = $2 WHERE id = $3 RETURNING *`,
				[JSON.stringify(conversation), JSON.stringify(config), session.id],
			);

			res.json({
				success: true,
				session: updated.rows[0],
				ai_message: result.ai_message,
				phase: result.phase,
				is_complete: result.is_complete,
			});
		} catch (err) {
			console.error('[interview-sessions] respond error:', err.message);
			res.status(500).json({ error: 'Failed to process response' });
		}
	},
);

// POST /interview-sessions/:id/complete — finalize the session and generate the report.
router.post('/interview-sessions/:id/complete', authMiddleware, async (req, res) => {
	try {
		const session = await loadSession(req.params.id);
		if (!session) {
			return res.status(404).json({ error: 'Session not found' });
		}
		if (!canAccess(session, req.user)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		if (session.status === 'completed') {
			return res.json({
				success: true,
				session,
				report: session.config?.report || null,
				already_completed: true,
			});
		}

		const config = { ...(session.config || {}) };
		const questions =
			config.question_source === 'personalized'
				? (config.base_questions || []).map((q) => ({
						question_text: typeof q === 'string' ? q : q?.question_text || '',
					}))
				: config.template?.questions || [];

		const report = await generateScreeningReport({
			conversation: session.conversation || [],
			questions,
			responses: [],
		});
		config.report = report;

		const updated = await pool.query(
			`UPDATE interview_sessions
			    SET status = 'completed', completed_at = NOW(), conversation = $1, config = $2
			  WHERE id = $3 RETURNING *`,
			[JSON.stringify(session.conversation || []), JSON.stringify(config), session.id],
		);

		res.json({ success: true, session: updated.rows[0], report });
	} catch (err) {
		console.error('[interview-sessions] complete error:', err.message);
		res.status(500).json({ error: 'Failed to complete interview session' });
	}
});

// POST /interview-sessions/:id/tts — synthesize text to audio (mirrors /mock/tts).
router.post('/interview-sessions/:id/tts', authMiddleware, async (req, res) => {
	try {
		const session = await loadSession(req.params.id);
		if (!session) {
			return res.status(404).json({ error: 'Session not found' });
		}
		if (!canAccess(session, req.user)) {
			return res.status(403).json({ error: 'Forbidden' });
		}

		const { text, voice } = req.body || {};
		if (!text || text.trim().length < 2) {
			return res.status(400).json({ error: 'No text provided' });
		}

		const audioBuffer = await textToSpeech(text.trim(), {
			voice: voice || 'nova',
			subscriptionId: req.user.stripe_subscription_id,
		});

		if (!audioBuffer) {
			// Return 200 with JSON flag instead of 500 — lets frontend fall back to browser speech synthesis
			return res.status(200).json({ tts_unavailable: true, text: text.trim() });
		}

		res.set({
			'Content-Type': 'audio/mpeg',
			'Content-Length': audioBuffer.length,
			'Cache-Control': 'no-cache',
		});
		res.send(audioBuffer);
	} catch (err) {
		console.error('[interview-sessions] TTS error:', err.message);
		res.status(200).json({ tts_unavailable: true, text: req.body?.text || '' });
	}
});

// GET /interview-sessions?candidate_id=|job_id= — unified list.
// interview_sessions rows plus read-linked human-scheduled interviews
// (scheduled_interviews / interview_events), which Task 1 deliberately did not
// backfill. Each entry carries `source` so consumers can distinguish them.
router.get('/interview-sessions', authMiddleware, async (req, res) => {
	try {
		const { candidate_id, job_id } = req.query;
		if (!candidate_id && !job_id) {
			return res.status(400).json({ error: 'candidate_id or job_id is required' });
		}
		if (
			req.user.role === 'candidate' &&
			candidate_id &&
			Number(candidate_id) !== Number(req.user.id)
		) {
			return res.status(403).json({ error: 'Forbidden' });
		}

		const sessions = [];
		if (candidate_id) {
			const unified = await pool.query(
				`SELECT * FROM interview_sessions WHERE candidate_id = $1 ORDER BY created_at DESC`,
				[candidate_id],
			);
			sessions.push(...unified.rows.map((s) => ({ ...s, source: 'interview_session' })));

			const scheduled = await pool.query(
				`SELECT * FROM scheduled_interviews WHERE candidate_id = $1 ORDER BY scheduled_at DESC`,
				[candidate_id],
			);
			sessions.push(
				...scheduled.rows.map((s) => ({
					...s,
					source: 'scheduled_interviews',
					type: 'human_scheduled',
				})),
			);

			const events = await pool.query(
				`SELECT e.*, ja.job_id FROM interview_events e
				   JOIN job_applications ja ON ja.id = e.job_application_id
				 WHERE e.candidate_id = $1 AND e.status <> 'cancelled'
				 ORDER BY e.scheduled_at DESC`,
				[candidate_id],
			);
			sessions.push(
				...events.rows.map((s) => ({ ...s, source: 'interview_events', type: 'human_scheduled' })),
			);
		} else {
			const unified = await pool.query(
				`SELECT * FROM interview_sessions WHERE job_id = $1 ORDER BY created_at DESC`,
				[job_id],
			);
			sessions.push(...unified.rows.map((s) => ({ ...s, source: 'interview_session' })));

			// Read-link human-scheduled interviews for the recruiter's job view
			// too (mirrors the candidate_id branch above).
			const scheduled = await pool.query(
				`SELECT * FROM scheduled_interviews WHERE job_id = $1 ORDER BY scheduled_at DESC`,
				[job_id],
			);
			sessions.push(
				...scheduled.rows.map((s) => ({
					...s,
					source: 'scheduled_interviews',
					type: 'human_scheduled',
				})),
			);

			const events = await pool.query(
				`SELECT e.*, ja.job_id FROM interview_events e
				   JOIN job_applications ja ON ja.id = e.job_application_id
				 WHERE ja.job_id = $1 AND e.status <> 'cancelled'
				 ORDER BY e.scheduled_at DESC`,
				[job_id],
			);
			sessions.push(
				...events.rows.map((s) => ({ ...s, source: 'interview_events', type: 'human_scheduled' })),
			);
		}

		sessions.sort(
			(a, b) => new Date(b.scheduled_at || b.created_at) - new Date(a.scheduled_at || a.created_at),
		);
		res.json({ success: true, sessions });
	} catch (err) {
		console.error('[interview-sessions] list error:', err.message);
		res.status(500).json({ error: 'Failed to list interview sessions' });
	}
});

module.exports = router;
