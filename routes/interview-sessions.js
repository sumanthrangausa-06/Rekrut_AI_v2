/**
 * Unified interview-session endpoints — Phase 1 conversational AI interviews (#322).
 *
 * Mounted at /api/interviews (after interviewRoutes in server.js):
 *   POST   /interview-sessions                 create a session (frozen engine config)
 *   POST   /interview-sessions/trigger          recruiter triggers a personalized AI interview (Task 6)
 *   GET    /interview-sessions/by-token/:token  resolve an invite token (anonymous, Task 8)
 *   POST   /interview-sessions/:id/start       idempotent start + AI intro turn
 *   POST   /interview-sessions/:id/respond     text or audio turn (per-turn persistence)
 *   POST   /interview-sessions/:id/complete    finalize + evaluation report
 *   POST   /interview-sessions/:id/tts         synthesize a turn's text to audio
 *   POST   /interview-sessions/:id/observer/enable  hiring team enables the AI
 *                                              observer (Track B, consent-gated)
 *   POST   /interview-sessions/:id/observer/report  observer analysis report
 *                                              (Q&A extraction + analysis stack)
 *   GET    /interview-sessions                 unified list (unified sessions +
 *                                              read-linked human-scheduled interviews)
 *   POST   /interview-flows                    create an interview flow (Task 7)
 *   GET    /interview-flows                    list active flows
 *   GET    /interview-flows/:id                read one flow
 *   PUT    /interview-flows/:id                update a flow
 *   DELETE /interview-flows/:id                archive a flow
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
// Task 5 (#323): Track B observer — Q&A extraction + analysis over the muted
// observer agent's transcript (config.observer_transcript).
const { extractQAPairs, analyzeObserverSession } = require('../services/qa-extraction');
const { notifyUser } = require('../lib/notify');
// Task 11 (#322): company audit log (#251 pattern — routes/audit.js
// insertAuditLog → audit_logs table). No new table, no new event schema.
const { insertAuditLog } = require('./audit');
const livekitService = require('../server/services/livekit');
const aiProvider = require('../lib/ai-provider');
const { textToSpeech } = require('../lib/polsia-ai');

const router = express.Router();
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 25 * 1024 * 1024 },
});

// Track B (#323): 'human' sessions are unified-session rows for human
// interviews — the recruiter + candidate talk, and the muted AI observer
// (not an AI interviewer) may transcribe. Same room/token/consent/recording
// flow as every other session type; no AI turns.
const SESSION_TYPES = ['screening', 'ai_interview', 'practice', 'human'];

// Hiring-team roles with session visibility (spec §2, #322): recruiter +
// hiring_manager. Distinct from TRIGGER_ROLES (which also includes employer
// for trigger/flow management): employers cannot open session transcripts,
// reports, or recordings.
const HIRING_ROLES = ['recruiter', 'hiring_manager'];

async function loadSession(id) {
	const result = await pool.query('SELECT * FROM interview_sessions WHERE id = $1', [id]);
	return result.rows[0] || null;
}

function canAccess(session, user) {
	if (!user) return false;
	if (Number(user.id) === Number(session.candidate_id)) return true;
	if (user.role === 'admin') return true;
	// Hiring-team visibility (spec §2, #322): recruiter + hiring_manager of the
	// session's company only. Fail-closed: a missing company_id never matches.
	return (
		HIRING_ROLES.includes(user.role) &&
		user.company_id != null &&
		Number(user.company_id) === Number(session.company_id)
	);
}

function newTimestamp() {
	return new Date().toISOString();
}

// ─── Audit events (Task 11, #322) ──────────────────────────────────────────
// Every interview lifecycle transition emits an event into the company audit
// log carrying the actor (actor_id) and a timestamp (created_at, set by
// insertAuditLog via NOW()). Emission is strictly non-blocking: an audit
// write failure is logged and never fails the primary operation — the same
// discipline as Task 4's recording bookkeeping.
async function emitInterviewAudit({ company_id, actor_id, target_id, action, metadata = {} }) {
	try {
		await insertAuditLog({
			company_id: company_id ?? null,
			actor_id: actor_id ?? null,
			target_id: target_id ?? null,
			action,
			metadata,
		});
	} catch (auditErr) {
		console.error('[interview-sessions] audit event failed:', action, auditErr.message);
	}
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

		// Track B (#323): a human interview is scheduled BY the hiring team FOR a
		// candidate — a candidate cannot create their own human interview.
		if (type === 'human' && req.user.role !== 'admin' && !HIRING_ROLES.includes(req.user.role)) {
			return res.status(403).json({ error: 'Only the hiring team can schedule a human interview' });
		}

		// C3 (#322): hiring-side callers cannot create sessions for another
		// company. A mismatched company_id is rejected; an absent one is
		// derived from the caller. Candidates keep passing their own (or none).
		let sessionCompanyId = company_id || null;
		if (req.user.role !== 'admin' && HIRING_ROLES.includes(req.user.role)) {
			if (company_id != null && Number(company_id) !== Number(req.user.company_id)) {
				return res.status(403).json({ error: 'Forbidden' });
			}
			sessionCompanyId = req.user.company_id ?? null;
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
				sessionCompanyId,
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

// Hiring-side roles that may trigger an AI interview (matches lib/auth recruiterRoles).
const TRIGGER_ROLES = ['recruiter', 'hiring_manager', 'employer', 'admin'];

// Flatten a parsed_resumes.parsed_data JSONB blob into interview-usable text.
// Kept small and defensive: the shape varies by parser version.
function flattenResumeText(parsed) {
	if (!parsed || typeof parsed !== 'object') return '';
	const parts = [];
	if (parsed.headline) parts.push(String(parsed.headline));
	if (parsed.bio) parts.push(String(parsed.bio));
	if (parsed.years_experience) parts.push(`${parsed.years_experience} years of experience`);
	if (Array.isArray(parsed.skills) && parsed.skills.length) {
		parts.push(`Skills: ${parsed.skills.join(', ')}`);
	}
	if (Array.isArray(parsed.experience)) {
		for (const e of parsed.experience.slice(0, 8)) {
			const line = [e.title || e.role || '', e.company || ''].filter(Boolean).join(' at ');
			const desc = Array.isArray(e.bullets) ? e.bullets.join(' ') : e.description || '';
			parts.push([line, desc].filter(Boolean).join(' — '));
		}
	}
	if (Array.isArray(parsed.education)) {
		for (const e of parsed.education.slice(0, 4)) {
			parts.push([e.degree, e.school].filter(Boolean).join(', '));
		}
	}
	return parts.filter(Boolean).join('\n').slice(0, 4000);
}

// POST /interview-sessions/trigger — recruiter triggers a personalized AI interview
// for one application. Freezes the JD + resume snapshot + role-grounded base
// questions into the engine config (Task 2 contract: question_source='personalized',
// base_questions/current_question_index/target_role/options).
router.post('/interview-sessions/trigger', authMiddleware, async (req, res) => {
	try {
		if (!TRIGGER_ROLES.includes(req.user.role)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const { application_id } = req.body || {};
		if (!application_id) {
			return res.status(400).json({ error: 'application_id is required' });
		}

		const appResult = await pool.query('SELECT * FROM job_applications WHERE id = $1', [
			application_id,
		]);
		if (appResult.rows.length === 0) {
			return res.status(404).json({ error: 'Application not found' });
		}
		const application = appResult.rows[0];

		const jobResult = await pool.query('SELECT * FROM jobs WHERE id = $1', [application.job_id]);
		if (jobResult.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}
		const job = jobResult.rows[0];

		// The recruiter must own the job's company; admins bypass.
		if (req.user.role !== 'admin' && Number(job.company_id) !== Number(req.user.company_id)) {
			return res.status(403).json({ error: 'Forbidden' });
		}

		// Idempotency: one AI interview per application.
		const existing = await pool.query(
			`SELECT * FROM interview_sessions WHERE application_id = $1 AND type = 'ai_interview' LIMIT 1`,
			[application.id],
		);
		if (existing.rows.length > 0) {
			return res
				.status(200)
				.json({ success: true, session: existing.rows[0], already_triggered: true });
		}

		// Latest parsed resume for the candidate (may not exist — JD-grounded only then).
		const resumeResult = await pool.query(
			`SELECT id, original_filename, parsed_data FROM parsed_resumes
			  WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
			[application.candidate_id],
		);
		const resumeRow = resumeResult.rows[0] || null;

		// Role-grounded base questions from the bank (cheap freeze; the engine
		// personalizes at turn time). An empty bank is fine — the engine then
		// converses from the frozen JD + resume.
		const bankResult = await pool.query(
			`SELECT id, question_text, question_type, difficulty, key_points
			   FROM question_bank WHERE LOWER(role) = LOWER($1) ORDER BY RANDOM() LIMIT 10`,
			[job.title],
		);

		const config = {
			question_source: 'personalized',
			job: {
				id: job.id,
				title: job.title,
				company_name: job.company_name || job.company || null,
				description: job.description || null,
			},
			resume: resumeRow
				? {
						filename: resumeRow.original_filename || null,
						text: flattenResumeText(resumeRow.parsed_data),
					}
				: null,
			target_role: job.title,
			base_questions: bankResult.rows.map((q) => ({
				id: q.id,
				question_text: q.question_text,
				question_type: q.question_type,
				difficulty: q.difficulty,
				key_points: q.key_points || [],
			})),
			current_question_index: 0,
			options: {},
		};

		const token = crypto.randomBytes(32).toString('hex');
		const result = await pool.query(
			`INSERT INTO interview_sessions
			   (type, job_id, application_id, candidate_id, company_id, triggered_by, invite_token, status, config, conversation)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, 'invited', $8, $9)
			 RETURNING *`,
			[
				'ai_interview',
				job.id,
				application.id,
				application.candidate_id,
				job.company_id,
				req.user.id,
				token,
				JSON.stringify(config),
				JSON.stringify([]),
			],
		);
		const session = result.rows[0];

		// Non-blocking: notifyUser never throws.
		await notifyUser(
			application.candidate_id,
			'ai_interview_invited',
			`AI interview invited: ${job.title}`,
			`${job.company_name || 'The hiring team'} invited you to a personalized AI interview for the ${job.title} role.`,
			{
				session_id: session.id,
				application_id: application.id,
				job_id: job.id,
				invite_token: token,
			},
		);

		// Task 11 (#322): audit event — non-blocking, never fails the trigger.
		await emitInterviewAudit({
			company_id: job.company_id,
			actor_id: req.user.id,
			target_id: session.id,
			action: 'session.sent',
			metadata: {
				session_id: session.id,
				type: 'ai_interview',
				job_id: job.id,
				application_id: application.id,
			},
		});

		res.status(201).json({ success: true, session });
	} catch (err) {
		console.error('[interview-sessions] trigger error:', err.message);
		res.status(500).json({ error: 'Failed to trigger AI interview' });
	}
});

// GET /interview-sessions/by-token/:token — resolve an invite token to a session.
// Task 8 (#322): closes the token→session gap. The auto-send/trigger
// notifications carry the invite token and the candidate's join link uses it.
//
// Auth model (deliberate, mirrors the legacy /screening/session/:token
// endpoints): ANONYMOUS. The token is a 256-bit unguessable capability, and
// the join link must work before the candidate logs in. The response is a
// REDACTED shape (no conversation, no full config) — just enough to render
// the invite landing. Every mutation (start/respond/complete/tts/consent)
// still requires auth + candidate ownership via canAccess.
router.get('/interview-sessions/by-token/:token', async (req, res) => {
	try {
		const result = await pool.query(
			`SELECT id, type, status, job_id, company_id, candidate_id, invite_token,
			        config, created_at
			   FROM interview_sessions WHERE invite_token = $1`,
			[req.params.token],
		);
		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Interview not found' });
		}
		const s = result.rows[0];
		const job = s.config?.job || null;
		res.json({
			success: true,
			session: {
				id: s.id,
				type: s.type,
				status: s.status,
				job_id: s.job_id,
				company_id: s.company_id,
				candidate_id: s.candidate_id,
				invite_token: s.invite_token,
				job: job
					? {
							title: job.title || null,
							company_name: job.company_name || null,
							description: job.description || null,
						}
					: null,
				created_at: s.created_at,
			},
		});
	} catch (err) {
		console.error('[interview-sessions] by-token error:', err.message);
		res.status(500).json({ error: 'Failed to resolve interview' });
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
		let conversation = session.conversation || [];
		let ai_message = null;
		let phase = null;

		if (session.type === 'human') {
			// Track B (#323): no AI intro turn — the humans talk. The session
			// still moves to in_progress and the recording row is created below,
			// so the consent gate covers the observer flow.
		} else {
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

			conversation = [
				{
					role: 'interviewer',
					text: intro.ai_message,
					phase: intro.phase,
					timestamp: newTimestamp(),
				},
			];
			ai_message = intro.ai_message;
			phase = intro.phase;
		}
		const updated = await pool.query(
			`UPDATE interview_sessions
			    SET status = 'in_progress', started_at = NOW(), conversation = $1, config = $2
			  WHERE id = $3 RETURNING *`,
			[JSON.stringify(conversation), JSON.stringify(config), session.id],
		);

		// Task 4 (#322): create the session-linked recording row (status
		// 'pending' — consent is written before capture begins, so no capture
		// has happened yet). Idempotent: re-start returns the existing row.
		// Non-blocking: a recording-row failure must not fail the session start.
		let recording = null;
		try {
			recording = await livekitService.findRecordingBySessionId(session.id);
			if (!recording) {
				recording = await livekitService.createRecordingRecord({
					interviewSessionId: session.id,
					status: 'pending',
				});
			}
		} catch (recErr) {
			console.error('[interview-sessions] recording row creation failed:', recErr.message);
		}

		// Task 11 (#322): audit event — non-blocking, never fails the start.
		await emitInterviewAudit({
			company_id: session.company_id,
			actor_id: req.user.id,
			target_id: session.id,
			action: 'session.started',
			metadata: { session_id: session.id, type: session.type },
		});

		res.json({
			success: true,
			session: updated.rows[0],
			ai_message,
			phase,
			recording: recording
				? {
						id: recording.id,
						interview_session_id: recording.interview_session_id,
						status: recording.status,
						started_at: recording.started_at,
					}
				: null,
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

			// Track B (#323): human interviews have no AI turns — the humans talk.
			if (session.type === 'human') {
				return res.status(400).json({ error: 'AI turns are not available for human interviews' });
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

			const frames = Array.isArray(req.body?.frames) ? req.body.frames : [];
			const frameIndicators =
				req.body?.frame_indicators && typeof req.body.frame_indicators === 'object'
					? req.body.frame_indicators
					: null;

			// Task 4 (#322): frame capture requires active consent.
			// Consent is written to recording_consent before any capture
			// begins: a missing consent row blocks capture just like a
			// withdrawn one does. Text-only answers still go through.
			// Consent governs media capture (frames, recordings, frame
			// analysis); the conversational transcript is the interview
			// record and exists regardless.
			if (frames.length > 0 || frameIndicators) {
				const recording = await livekitService.findRecordingBySessionId(session.id);
				if (!recording || !(await livekitService.hasActiveConsent(recording.id, req.user.id))) {
					return res.status(403).json({
						error: 'Recording consent required',
						code: 'CONSENT_REQUIRED',
					});
				}
			}

			const conversation = Array.isArray(session.conversation) ? [...session.conversation] : [];
			conversation.push({
				role: 'candidate',
				text: candidateText,
				...(hasAudio ? { has_audio: true } : {}),
				...(frameIndicators ? { frame_indicators: frameIndicators } : {}),
				timestamp: newTimestamp(),
			});

			// Crash-resume safety: persist the candidate's answer BEFORE the
			// ≤20s LLM call — a crash/restart mid-turn must never lose it.
			await pool.query(`UPDATE interview_sessions SET conversation = $1 WHERE id = $2`, [
				JSON.stringify(conversation),
				session.id,
			]);

			const config = { ...(session.config || {}) };
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
				transcript: candidateText,
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

		const config = session.config || {};

		// Track B (#323): if the muted observer captured a transcript, the
		// report comes from the observer analysis (Q&A extraction + the
		// mock-interview analysis stack) — the turn conversation is empty for
		// human interviews, so the standard path would score nothing.
		const observerTranscript = config.observer_transcript;
		let report;
		if (Array.isArray(observerTranscript) && observerTranscript.length > 0) {
			const qaPairs = await extractQAPairs(observerTranscript);
			report = await analyzeObserverSession({
				session,
				qaPairs,
				rubricWeights: await getRubricWeightsForSession(session),
				job: await getJobForSession(session),
			});
		} else if (session.type === 'human') {
			// Full-branch review I1 (#323): a human interview completed with
			// no observer data has an empty conversation — running the LLM
			// report on it would fabricate candidate scores. Emit an explicit
			// no-data report instead.
			report = {
				overall_score: null,
				recommendation: null,
				note: 'No interview data captured: the AI observer was not enabled for this human interview.',
				observer_enabled: false,
			};
		} else {
			const questions =
				config.question_source === 'personalized'
					? (config.base_questions || []).map((q) => ({
							question_text: typeof q === 'string' ? q : q?.question_text || '',
						}))
					: config.template?.questions || [];

			report = await generateScreeningReport({
				conversation: session.conversation || [],
				questions,
				responses: [],
			});
		}
		const updated = await pool.query(
			// M1 (#323): jsonb merge instead of read-modify-write — the agent's
			// shutdown callback persists observer_transcript the same way, so
			// concurrent writes can't clobber each other.
			`UPDATE interview_sessions
			    SET status = 'completed', completed_at = NOW(), conversation = $1, config = config || $2::jsonb
			  WHERE id = $3 RETURNING *`,
			[JSON.stringify(session.conversation || []), JSON.stringify({ report }), session.id],
		);

		// Task 4 (#322): persist transcript segments against the session's
		// recording, aggregate per-turn frame indicators into frame_analysis,
		// and finalize the recording row. Non-blocking: the report above is
		// the primary outcome; capture failures are logged, not thrown.
		// Task 6 (#323): stop the session's room egress (best-effort) and
		// finalize the recording even when the turn conversation is empty
		// (Track B human interviews) — retention re-asserted per the Phase 1
		// policy when missing.
		let egressResult = null;
		try {
			try {
				egressResult = await livekitService.stopSessionEgress(session.id);
			} catch (stopErr) {
				console.error('[interview-sessions] session egress stop failed:', stopErr.message);
			}
			const recording = await livekitService.findRecordingBySessionId(session.id);
			const turns = Array.isArray(session.conversation) ? session.conversation : [];
			if (recording && turns.length > 0) {
				const baseMs = new Date(turns[0].timestamp).getTime();
				const base = Number.isFinite(baseMs) ? baseMs : Date.now();
				for (let i = 0; i < turns.length; i++) {
					const turn = turns[i];
					const tMs = new Date(turn.timestamp).getTime();
					const startMs = Number.isFinite(tMs) ? Math.max(0, tMs - base) : i * 1000;
					const nextMs = new Date(turns[i + 1]?.timestamp).getTime();
					const endMs =
						i + 1 < turns.length && Number.isFinite(nextMs)
							? Math.max(startMs, nextMs - base)
							: startMs + 1000;
					await pool.query(
						`INSERT INTO interview_transcripts
						 (recording_id, speaker_identity, text, start_time_ms, end_time_ms, confidence)
						 VALUES ($1, $2, $3, $4, $5, NULL)`,
						[recording.id, turn.role || 'unknown', turn.text || '', startMs, endMs],
					);
				}
			}
			if (recording) {
				// I2 (#323): backfill the R2 file location + duration from
				// egress completion so the recording row points at the actual
				// file (spec §6: analysis re-runnable from the recording).
				// completeRecordingRecord encrypts storage_path (BYTEA) the
				// same way the event-flow does.
				if (egressResult?.fileLocation) {
					await livekitService.completeRecordingRecord(
						recording.id,
						egressResult.fileLocation,
						egressResult.durationSeconds ?? null,
						egressResult.fileSizeBytes ?? null,
					);
				}
				await pool.query(
					`UPDATE interview_recordings
					    SET status = 'completed', stopped_at = NOW(), updated_at = NOW(),
					        retention_expires_at = COALESCE(retention_expires_at, $2)
					  WHERE id = $1`,
					[recording.id, livekitService.getRecordingRetentionDate()],
				);
			}
			const indicators = turns.filter((t) => t?.frame_indicators).map((t) => t.frame_indicators);
			if (indicators.length > 0) {
				await pool.query(`UPDATE interview_sessions SET frame_analysis = $1 WHERE id = $2`, [
					JSON.stringify({
						per_turn: indicators,
						turn_count: indicators.length,
						aggregated_at: new Date().toISOString(),
					}),
					session.id,
				]);
			}
		} catch (transcriptErr) {
			console.error('[interview-sessions] transcript/finalize failed:', transcriptErr.message);
		}

		// Task 11 (#322): audit events — non-blocking, never fail the completion.
		// session.scored carries the generated report's score + recommendation.
		await emitInterviewAudit({
			company_id: session.company_id,
			actor_id: req.user.id,
			target_id: session.id,
			action: 'session.completed',
			metadata: { session_id: session.id, type: session.type, report_generated: !!report },
		});
		await emitInterviewAudit({
			company_id: session.company_id,
			actor_id: req.user.id,
			target_id: session.id,
			action: 'session.scored',
			metadata: {
				session_id: session.id,
				overall_score: report?.overall_score ?? null,
				recommendation: report?.recommendation ?? null,
			},
		});

		// Mirror the legacy screening flow (routes/interviews.js): mark the
		// linked application as screened so dashboards/kanban reflect it.
		// Non-blocking: the report above is the primary outcome.
		if (session.application_id) {
			try {
				await pool.query(
					`UPDATE job_applications
					    SET screening_status = 'completed', screening_score = $1, updated_at = NOW()
					  WHERE id = $2`,
					[report?.overall_score ?? null, session.application_id],
				);
			} catch (appErr) {
				console.error(
					'[interview-sessions] application screening_status update failed:',
					appErr.message,
				);
			}
		}

		res.json({ success: true, session: updated.rows[0], report });
	} catch (err) {
		console.error('[interview-sessions] complete error:', err.message);
		res.status(500).json({ error: 'Failed to complete interview session' });
	}
});

// GET /interview-sessions/:id/report — candidate-facing screening report.
// Candidate-scoped: only the session owner (or hiring team via canAccess)
// may read it. Returns candidate-safe report fields only — never raw AI
// prompts or internal metadata.
router.get('/interview-sessions/:id/report', authMiddleware, async (req, res) => {
	try {
		const session = await loadSession(req.params.id);
		if (!session) {
			return res.status(404).json({ error: 'Session not found' });
		}
		if (!canAccess(session, req.user)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const report = session.config?.report || null;
		if (!report) {
			return res.status(404).json({ error: 'Report not available yet' });
		}
		// Whitelist candidate-safe fields.
		res.json({
			success: true,
			report: {
				overall_score: report.overall_score ?? null,
				recommendation: report.recommendation ?? null,
				recommendation_reasoning: report.recommendation_reasoning ?? null,
				strengths: report.strengths || [],
				red_flags: report.red_flags || [],
				dimension_scores: report.dimension_scores || {},
				question_scores: report.question_scores || [],
				key_moments: report.key_moments || [],
				communication_clarity: report.communication_clarity || null,
				technical_depth: report.technical_depth || null,
				confidence_enthusiasm: report.confidence_enthusiasm || null,
			},
		});
	} catch (err) {
		console.error('[interview-sessions] report error:', err.message);
		res.status(500).json({ error: 'Failed to load report' });
	}
});

// ─── Track B observer (Phase 2, #323) ───────────────────────────────────────
// The hiring team enables a muted AI observer on a human interview (explicit
// toggle, default off). The observer agent transcribes both speakers into
// config.observer_transcript (Task 3); these endpoints gate, analyze, and
// report on it.

/**
 * Recruiter-defined rubric weights for the session's job, from the active
 * interview flow. Returns {} when none are defined (default rubric applies).
 */
async function getRubricWeightsForSession(session) {
	if (!session.job_id) return {};
	try {
		const r = await pool.query(
			`SELECT rubric_weights FROM interview_flows
			  WHERE job_id = $1 AND status = 'active'
			  ORDER BY updated_at DESC LIMIT 1`,
			[session.job_id],
		);
		return r.rows[0]?.rubric_weights || {};
	} catch (err) {
		console.error('[interview-sessions] rubric weights lookup failed:', err.message);
		return {};
	}
}

/** Job context for the analysis prompts. Never throws. */
async function getJobForSession(session) {
	if (!session.job_id) return {};
	try {
		const r = await pool.query('SELECT title, description FROM jobs WHERE id = $1', [
			session.job_id,
		]);
		return r.rows[0] || {};
	} catch (err) {
		console.error('[interview-sessions] job lookup failed:', err.message);
		return {};
	}
}

/** Hiring-team membership for a session (admin bypasses; candidate never qualifies). */
function isHiringTeamForSession(session, user) {
	if (!user) return false;
	if (user.role === 'admin') return true;
	return (
		HIRING_ROLES.includes(user.role) &&
		user.company_id != null &&
		Number(user.company_id) === Number(session.company_id)
	);
}

// POST /interview-sessions/:id/observer/enable — hiring team enables the AI
// observer on a human interview. Consent-gated: without the candidate's
// active recording consent the observer may not subscribe (403
// CONSENT_REQUIRED, and the agent is never dispatched). Dispatch failure
// leaves the flag unset — enabling the observer IS the dispatch.
router.post('/interview-sessions/:id/observer/enable', authMiddleware, async (req, res) => {
	try {
		const session = await loadSession(req.params.id);
		if (!session) {
			return res.status(404).json({ error: 'Session not found' });
		}
		if (!isHiringTeamForSession(session, req.user)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		if (session.status === 'completed') {
			return res.status(409).json({ error: 'Observer cannot be enabled on a completed session' });
		}

		if (session.config?.observer_enabled) {
			return res.json({ success: true, observer_enabled: true, already_enabled: true });
		}

		// Review Focus #5: subscription blocked without candidate consent —
		// mirrors the Phase 1 frame-capture gate (respond endpoint).
		const recording = await livekitService.findRecordingBySessionId(session.id);
		if (
			!recording ||
			!(await livekitService.hasActiveConsent(recording.id, session.candidate_id))
		) {
			return res.status(403).json({
				error: 'Recording consent required',
				code: 'CONSENT_REQUIRED',
			});
		}

		let dispatched;
		try {
			dispatched = await livekitService.dispatchVoiceAgent(session.id, 'observer');
		} catch (err) {
			console.error('[interview-sessions] observer dispatch failed:', err.message);
			return res.status(502).json({ error: 'Failed to dispatch observer agent' });
		}

		// Task 6 (#323): the human call is live — start room-composite egress
		// (both humans' media) so the observer has a recording to analyze.
		// Non-blocking, consent-gated on the candidate — same contract as the
		// dispatch route's hook.
		try {
			await livekitService.startSessionEgress(session.id, {
				consentUserId: session.candidate_id,
			});
		} catch (egressErr) {
			console.error('[interview-sessions] observer egress start failed:', egressErr.message);
		}

		// M1 (#323): jsonb merge instead of read-modify-write — matches the
		// agent shutdown callback (worker.mjs), so concurrent writes merge.
		await pool.query('UPDATE interview_sessions SET config = config || $1::jsonb WHERE id = $2', [
			JSON.stringify({ observer_enabled: true }),
			session.id,
		]);

		// Task 11 (#322) pattern: audit events are non-blocking.
		await emitInterviewAudit({
			company_id: session.company_id,
			actor_id: req.user.id,
			target_id: session.id,
			action: 'session.observer_enabled',
			metadata: { session_id: session.id },
		});

		res.json({ success: true, observer_enabled: true, dispatched });
	} catch (err) {
		console.error('[interview-sessions] observer enable error:', err.message);
		res.status(500).json({ error: 'Failed to enable observer' });
	}
});

// POST /interview-sessions/:id/observer/report — generate the observer
// analysis report on demand: Q&A extraction over the observer transcript,
// then the mock-interview analysis stack with the job's rubric weights
// (recruiter-defined when present, default otherwise).
router.post('/interview-sessions/:id/observer/report', authMiddleware, async (req, res) => {
	try {
		const session = await loadSession(req.params.id);
		if (!session) {
			return res.status(404).json({ error: 'Session not found' });
		}
		if (!canAccess(session, req.user)) {
			return res.status(403).json({ error: 'Forbidden' });
		}

		const transcript = session.config?.observer_transcript;
		if (!Array.isArray(transcript) || transcript.length === 0) {
			return res.status(422).json({ error: 'No observer transcript available yet' });
		}

		const qaPairs = await extractQAPairs(transcript);
		const rubricWeights = await getRubricWeightsForSession(session);
		const job = await getJobForSession(session);
		const report = await analyzeObserverSession({ session, qaPairs, rubricWeights, job });

		// M1 (#323): jsonb merge instead of read-modify-write — the agent's
		// shutdown callback persists observer_transcript the same way.
		await pool.query('UPDATE interview_sessions SET config = config || $1::jsonb WHERE id = $2', [
			JSON.stringify({ report }),
			session.id,
		]);

		await emitInterviewAudit({
			company_id: session.company_id,
			actor_id: req.user.id,
			target_id: session.id,
			action: 'session.scored',
			metadata: {
				session_id: session.id,
				overall_score: report?.overall_score ?? null,
				recommendation: report?.recommendation ?? null,
				source: 'observer',
			},
		});

		res.json({ success: true, report, qa_pair_count: qaPairs.length });
	} catch (err) {
		console.error('[interview-sessions] observer report error:', err.message);
		res.status(500).json({ error: 'Failed to generate observer report' });
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
		// The job_id view is the recruiter's unified panel (Task 9): candidates
		// have no legitimate use for it and must not enumerate other candidates'
		// sessions and transcripts.
		if (req.user.role === 'candidate' && job_id) {
			return res.status(403).json({ error: 'Forbidden' });
		}

		// C3 (#322): non-admin, non-candidate callers only see their own
		// company's rows (session transcripts, AI reports, and configs embed
		// PII like resume text). Candidates are restricted to themselves above;
		// admins bypass. Fail-closed on a missing company_id.
		const scopedToCompany = req.user.role !== 'admin' && req.user.role !== 'candidate';
		const scopeCompanyId = scopedToCompany ? (req.user.company_id ?? null) : null;
		const withCompany = (column) => (scopedToCompany ? ` AND ${column}company_id = $2` : '');
		const withParams = (id) => (scopedToCompany ? [id, scopeCompanyId] : [id]);

		const sessions = [];
		if (candidate_id) {
			const unified = await pool.query(
				`SELECT * FROM interview_sessions WHERE candidate_id = $1${withCompany('')} ORDER BY created_at DESC`,
				withParams(candidate_id),
			);
			sessions.push(...unified.rows.map((s) => ({ ...s, source: 'interview_session' })));

			const scheduled = await pool.query(
				`SELECT * FROM scheduled_interviews WHERE candidate_id = $1${withCompany('')} ORDER BY scheduled_at DESC`,
				withParams(candidate_id),
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
				 WHERE e.candidate_id = $1 AND e.status <> 'cancelled'${withCompany('ja.')}
				 ORDER BY e.scheduled_at DESC`,
				withParams(candidate_id),
			);
			sessions.push(
				...events.rows.map((s) => ({ ...s, source: 'interview_events', type: 'human_scheduled' })),
			);
		} else {
			const unified = await pool.query(
				`SELECT * FROM interview_sessions WHERE job_id = $1${withCompany('')} ORDER BY created_at DESC`,
				withParams(job_id),
			);
			sessions.push(...unified.rows.map((s) => ({ ...s, source: 'interview_session' })));

			// Read-link human-scheduled interviews for the recruiter's job view
			// too (mirrors the candidate_id branch above).
			const scheduled = await pool.query(
				`SELECT * FROM scheduled_interviews WHERE job_id = $1${withCompany('')} ORDER BY scheduled_at DESC`,
				withParams(job_id),
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
				 WHERE ja.job_id = $1 AND e.status <> 'cancelled'${withCompany('ja.')}
				 ORDER BY e.scheduled_at DESC`,
				withParams(job_id),
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

// GET /interview-sessions/:id/recording — the session's linked recording (Task 9).
// The recruiter report view uses this to offer playback of the session recording.
router.get('/interview-sessions/:id/recording', authMiddleware, async (req, res) => {
	try {
		const session = await loadSession(req.params.id);
		if (!session) {
			return res.status(404).json({ error: 'Session not found' });
		}
		if (!canAccess(session, req.user)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const recording = await livekitService.findRecordingBySessionId(session.id);
		// Task 11 (#322): audit event — the Task 9 report view reads through
		// this endpoint. Non-blocking, never fails the read.
		await emitInterviewAudit({
			company_id: session.company_id,
			actor_id: req.user.id,
			target_id: session.id,
			action: 'report.viewed',
			metadata: { session_id: session.id, recording_id: recording?.id ?? null },
		});
		if (!recording) {
			return res.json({ success: true, recording: null });
		}
		res.json({
			success: true,
			recording: {
				id: recording.id,
				status: recording.status,
				started_at: recording.started_at,
				stopped_at: recording.stopped_at,
				duration_seconds: recording.duration_seconds,
				file_size_bytes: recording.file_size_bytes,
				file_format: recording.file_format,
				retention_expires_at: recording.retention_expires_at,
			},
		});
	} catch (err) {
		console.error('[interview-sessions] recording lookup error:', err.message);
		res.status(500).json({ error: 'Failed to load session recording' });
	}
});

// ─── Interview flows (Task 7) ──────────────────────────────────────────────
// Generalized per-job interview configuration: screening AND AI-interview
// flows with phases, topics/questions, rubric weights, and triggers.
// screening_templates stays readable during the transition; the recruiter
// flow-config UI (Task 10) will cut over to these endpoints.

const FLOW_TYPES = ['screening', 'ai_interview'];
const FLOW_WRITABLE = [
	'name',
	'type',
	'description',
	'phases',
	'topics',
	'questions',
	'rubric_weights',
	'triggers',
	'status',
	'job_id',
];
const FLOW_JSONB = new Set(['phases', 'topics', 'questions', 'rubric_weights', 'triggers']);

async function loadFlow(id) {
	const r = await pool.query('SELECT * FROM interview_flows WHERE id = $1', [id]);
	return r.rows[0] || null;
}

function canManageFlow(flow, user) {
	if (user.role === 'admin') return true;
	return TRIGGER_ROLES.includes(user.role) && Number(flow.company_id) === Number(user.company_id);
}

// POST /interview-flows — create a flow (recruiter roles only).
router.post('/interview-flows', authMiddleware, async (req, res) => {
	try {
		if (!TRIGGER_ROLES.includes(req.user.role)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const body = req.body || {};
		if (!body.name || !String(body.name).trim()) {
			return res.status(400).json({ error: 'name is required' });
		}
		const type = body.type || 'screening';
		if (!FLOW_TYPES.includes(type)) {
			return res.status(400).json({ error: `type must be one of: ${FLOW_TYPES.join(', ')}` });
		}
		const company_id =
			req.user.role === 'admin' && body.company_id ? body.company_id : req.user.company_id;

		const result = await pool.query(
			`INSERT INTO interview_flows
			   (company_id, job_id, created_by, name, type, description,
			    phases, topics, questions, rubric_weights, triggers)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			 RETURNING *`,
			[
				company_id,
				body.job_id || null,
				req.user.id,
				String(body.name).trim(),
				type,
				body.description || null,
				JSON.stringify(body.phases || []),
				JSON.stringify(body.topics || []),
				JSON.stringify(body.questions || []),
				JSON.stringify(body.rubric_weights || {}),
				JSON.stringify(body.triggers || { manual: true }),
			],
		);
		// Task 11 (#322): audit event — non-blocking, never fails the creation.
		await emitInterviewAudit({
			company_id: result.rows[0].company_id,
			actor_id: req.user.id,
			target_id: result.rows[0].id,
			action: 'flow.created',
			metadata: {
				flow_id: result.rows[0].id,
				name: result.rows[0].name,
				type: result.rows[0].type,
			},
		});

		res.status(201).json({ success: true, flow: result.rows[0] });
	} catch (err) {
		console.error('[interview-flows] create error:', err.message);
		res.status(500).json({ error: 'Failed to create interview flow' });
	}
});

// GET /interview-flows?job_id=|company_id= — list active flows (recruiter roles).
router.get('/interview-flows', authMiddleware, async (req, res) => {
	try {
		if (!TRIGGER_ROLES.includes(req.user.role)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const { job_id, company_id } = req.query;
		const conditions = ["status = 'active'"];
		const params = [];
		if (job_id) {
			params.push(job_id);
			conditions.push(`job_id = $${params.length}`);
		}
		if (req.user.role === 'admin' && company_id) {
			params.push(company_id);
			conditions.push(`company_id = $${params.length}`);
		} else if (req.user.role !== 'admin') {
			params.push(req.user.company_id);
			conditions.push(`company_id = $${params.length}`);
		}
		const result = await pool.query(
			`SELECT * FROM interview_flows WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
			params,
		);
		res.json({ success: true, flows: result.rows });
	} catch (err) {
		console.error('[interview-flows] list error:', err.message);
		res.status(500).json({ error: 'Failed to list interview flows' });
	}
});

// GET /interview-flows/:id — read one flow.
router.get('/interview-flows/:id', authMiddleware, async (req, res) => {
	try {
		const flow = await loadFlow(req.params.id);
		if (!flow) {
			return res.status(404).json({ error: 'Flow not found' });
		}
		if (!canManageFlow(flow, req.user)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		res.json({ success: true, flow });
	} catch (err) {
		console.error('[interview-flows] read error:', err.message);
		res.status(500).json({ error: 'Failed to read interview flow' });
	}
});

// PUT /interview-flows/:id — update whitelisted fields.
router.put('/interview-flows/:id', authMiddleware, async (req, res) => {
	try {
		const flow = await loadFlow(req.params.id);
		if (!flow) {
			return res.status(404).json({ error: 'Flow not found' });
		}
		if (!canManageFlow(flow, req.user)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const body = req.body || {};
		const sets = [];
		const params = [];
		const updatedFields = [];
		for (const key of FLOW_WRITABLE) {
			if (body[key] === undefined) continue;
			if (key === 'type' && !FLOW_TYPES.includes(body[key])) {
				return res.status(400).json({ error: `type must be one of: ${FLOW_TYPES.join(', ')}` });
			}
			params.push(FLOW_JSONB.has(key) ? JSON.stringify(body[key]) : body[key]);
			sets.push(`${key} = $${params.length}`);
			updatedFields.push(key);
		}
		if (sets.length === 0) {
			return res.status(400).json({ error: 'No updatable fields provided' });
		}
		params.push(flow.id);
		const result = await pool.query(
			`UPDATE interview_flows SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
			params,
		);

		// Task 11 (#322): audit event — non-blocking, never fails the update.
		await emitInterviewAudit({
			company_id: flow.company_id,
			actor_id: req.user.id,
			target_id: flow.id,
			action: 'flow.updated',
			metadata: { flow_id: flow.id, updated_fields: updatedFields },
		});

		res.json({ success: true, flow: result.rows[0] });
	} catch (err) {
		console.error('[interview-flows] update error:', err.message);
		res.status(500).json({ error: 'Failed to update interview flow' });
	}
});

// DELETE /interview-flows/:id — archive (keeps history; nothing references flows yet).
router.delete('/interview-flows/:id', authMiddleware, async (req, res) => {
	try {
		const flow = await loadFlow(req.params.id);
		if (!flow) {
			return res.status(404).json({ error: 'Flow not found' });
		}
		if (!canManageFlow(flow, req.user)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const result = await pool.query(
			`UPDATE interview_flows SET status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING *`,
			[flow.id],
		);
		res.json({ success: true, flow: result.rows[0] });
	} catch (err) {
		console.error('[interview-flows] delete error:', err.message);
		res.status(500).json({ error: 'Failed to archive interview flow' });
	}
});

module.exports = router;
