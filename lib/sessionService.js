/**
 * SessionService — Unified interview session creation (S-001 #640).
 *
 * SessionService.create() → ModeAdapter.getDefaults(type) → writes to interview_sessions.
 * Session type is immutable after creation.
 */
const crypto = require('node:crypto');
const db = require('./db');
const { ModeAdapter, normalizeType, toStorageType } = require('../shared/interview-modes/modes');

const HIRING_ROLES = ['recruiter', 'hiring_manager', 'employer', 'admin'];

const SessionService = {
	/**
	 * Create a new interview session.
	 *
	 * @param {object} params
	 * @param {string} params.type - session type (ai-interview, screening, practice, human)
	 * @param {number} params.triggeredBy - user ID creating the session (required)
	 * @param {number} [params.companyId] - company scope
	 * @param {number} [params.jobId] - associated job
	 * @param {number} [params.applicationId] - associated application
	 * @param {number} [params.candidateId] - candidate (defaults to triggeredBy for self-serve)
	 * @param {object} [params.config] - caller config overrides (Zod-validated)
	 * @param {string} [params.callerRole] - role of the caller (for human-type authorization)
	 * @returns {Promise<object>} created session row
	 * @throws {Error} INVALID_SESSION_TYPE, VALIDATION_ERROR (with .errors), or auth errors
	 */
	async create({ type, triggeredBy, companyId, jobId, applicationId, candidateId, config, callerRole }) {
		// Validate required fields
		if (triggeredBy == null) {
			const err = new Error('SessionService.create: triggeredBy is required');
			err.code = 'VALIDATION_ERROR';
			err.errors = [{ field: 'triggeredBy', message: 'Required', code: 'invalid_type' }];
			throw err;
		}

		// Normalize and validate type
		const normalized = normalizeType(type);
		if (!normalized) {
			const err = new Error(`Invalid session type "${type}". Must be one of: ${['screening', 'ai-interview', 'practice', 'human'].join(', ')}`);
			err.code = 'INVALID_SESSION_TYPE';
			throw err;
		}

		// Human interviews can only be scheduled by the hiring team (fail-closed)
		if (normalized === 'human') {
			if (!callerRole || !HIRING_ROLES.includes(callerRole)) {
				const err = new Error('Only the hiring team can schedule a human interview');
				err.code = 'FORBIDDEN';
				throw err;
			}
		}

		// Build and validate config (throws VALIDATION_ERROR with .errors on failure)
		const finalConfig = ModeAdapter.buildConfig(normalized, config);

		// Generate invite token
		const inviteToken = crypto.randomBytes(32).toString('hex');

		// Write to interview_sessions (AC-1: status invited)
		const dbType = toStorageType(normalized);
		const { rows } = await db.query(
			`INSERT INTO interview_sessions
			   (type, job_id, application_id, candidate_id, company_id, triggered_by,
			    invite_token, invite_expires_at, status, config, conversation)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '7 weeks', 'invited', $8, $9)
			 RETURNING *`,
			[
				dbType,
				jobId || null,
				applicationId || null,
				candidateId || triggeredBy,
				companyId || null,
				triggeredBy,
				inviteToken,
				JSON.stringify(finalConfig),
				JSON.stringify([]),
			],
		);

		return rows[0];
	},

	// ─── Lifecycle state machine (S-003 #642) ────────────────────────────────
	//
	// Transition table (architecture §3.10, v3):
	//   invited      → in_progress, calibrating, expired, abandoned
	//   calibrating  → in_progress, abandoned   (in table; phase not implemented yet)
	//   in_progress  → paused, completed, abandoned
	//   paused       → in_progress, abandoned, expired
	//   completed/abandoned/expired → (terminal)
	//
	// Concurrency design (specialist review 2026-10-10):
	//   - ATOMIC single-statement transitions. The status guard lives in the
	//     UPDATE's WHERE clause, so the check-and-write is one statement —
	//     no lock-holding window, no TOCTOU. (A bare SELECT ... FOR UPDATE
	//     without an explicit transaction holds no lock under pool autocommit.)
	//   - Lazy heartbeat evaluation: no cron. getState() pauses a stale
	//     in_progress session atomically, staleness computed in SQL (no clock skew).
	//   - Per-session authorization: _loadOwned() gates every route.
	//
	// Client contract: heartbeat every ≤ HEARTBEAT_TIMEOUT_SEC/3 seconds
	// (default 20s for the 60s timeout). iOS Safari suspends background
	// timers — expect pauses after backgrounding; resume via invite token.

	/** Allowed transitions: from-state → [to-states]. */
	TRANSITIONS: {
		invited: ['in_progress', 'calibrating', 'expired', 'abandoned'],
		calibrating: ['in_progress', 'abandoned'],
		in_progress: ['paused', 'completed', 'abandoned'],
		paused: ['in_progress', 'abandoned', 'expired'],
		completed: [],
		abandoned: [],
		expired: [],
	},

	/**
	 * Heartbeat staleness threshold in seconds (AC-1: pause within 60s).
	 * Env-overridable. Client must heartbeat at ≤ timeout/3.
	 */
	HEARTBEAT_TIMEOUT_SEC: Number(process.env.SESSION_HEARTBEAT_TIMEOUT_SEC) || 60,

	/**
	 * Throw a coded error for state machine violations.
	 */
	_stateError(code, message) {
		const err = new Error(message);
		err.code = code;
		return err;
	},

	/**
	 * Load a session and verify the caller may act on it.
	 * Owner (candidate_id / triggered_by) or hiring team (role + company match).
	 *
	 * @throws {Error} SESSION_NOT_FOUND, FORBIDDEN (→ 403)
	 */
	async _loadOwned(sessionId, user) {
		const { rows } = await db.query(
			'SELECT * FROM interview_sessions WHERE id = $1',
			[sessionId],
		);
		if (rows.length === 0) {
			throw this._stateError('SESSION_NOT_FOUND', `Session ${sessionId} not found`);
		}
		const session = rows[0];

		const isOwner =
			user && (user.id === session.candidate_id || user.id === session.triggered_by);
		const isHiring =
			user &&
			HIRING_ROLES.includes(user.role) &&
			(user.role === 'admin' || user.company_id === session.company_id);
		if (!isOwner && !isHiring) {
			throw this._stateError('FORBIDDEN', 'Not authorized for this session');
		}
		return session;
	},

	/**
	 * From-states that may transition to the given target (for the atomic guard).
	 */
	_allowedFrom(toState) {
		return Object.keys(this.TRANSITIONS).filter((from) =>
			this.TRANSITIONS[from].includes(toState),
		);
	},

	/**
	 * Transition a session to a new state — ATOMIC.
	 *
	 * Single UPDATE with the transition table encoded as a status guard:
	 * 0 rows returned means either the session doesn't exist or the current
	 * status doesn't allow the transition (distinguished by a follow-up read
	 * used only for error reporting, never for the decision).
	 *
	 * @param {number} sessionId
	 * @param {string} toState
	 * @returns {Promise<object>} updated session row
	 * @throws {Error} SESSION_NOT_FOUND, SESSION_STATE_CONFLICT (→ 409)
	 */
	async transition(sessionId, toState) {
		if (!Object.prototype.hasOwnProperty.call(this.TRANSITIONS, toState)) {
			throw this._stateError('SESSION_STATE_CONFLICT', `Unknown state "${toState}"`);
		}

		// State-specific side effects
		let extra = '';
		if (toState === 'paused') {
			extra = ', paused_at = NOW()';
		} else if (toState === 'in_progress') {
			// Entering active state clears pause marker and refreshes heartbeat
			extra = ', paused_at = NULL, last_heartbeat_at = NOW()';
		}

		const { rows } = await db.query(
			`UPDATE interview_sessions
			   SET status = $1${extra}
			 WHERE id = $2 AND status = ANY($3)
			 RETURNING *`,
			[toState, sessionId, this._allowedFrom(toState)],
		);
		if (rows.length > 0) return rows[0];

		// 0 rows: distinguish not-found from invalid transition (read-only, for the message)
		const { rows: check } = await db.query(
			'SELECT id, status FROM interview_sessions WHERE id = $1',
			[sessionId],
		);
		if (check.length === 0) {
			throw this._stateError('SESSION_NOT_FOUND', `Session ${sessionId} not found`);
		}
		throw this._stateError(
			'SESSION_STATE_CONFLICT',
			`Invalid transition ${check[0].status} → ${toState}`,
		);
	},

	/**
	 * Refresh the heartbeat for an in_progress session — ATOMIC.
	 *
	 * Restricted to in_progress only: heartbeating a paused session is a no-op
	 * (nothing reads the heartbeat while paused; resume re-arms it).
	 *
	 * @param {number} sessionId
	 * @returns {Promise<object>} session row
	 * @throws {Error} SESSION_NOT_FOUND, SESSION_STATE_CONFLICT
	 */
	async heartbeat(sessionId) {
		const { rows } = await db.query(
			`UPDATE interview_sessions
			   SET last_heartbeat_at = NOW()
			 WHERE id = $1 AND status = 'in_progress'
			 RETURNING *`,
			[sessionId],
		);
		if (rows.length > 0) return rows[0];

		const { rows: check } = await db.query(
			'SELECT id, status FROM interview_sessions WHERE id = $1',
			[sessionId],
		);
		if (check.length === 0) {
			throw this._stateError('SESSION_NOT_FOUND', `Session ${sessionId} not found`);
		}
		throw this._stateError(
			'SESSION_STATE_CONFLICT',
			`Cannot heartbeat a ${check[0].status} session`,
		);
	},

	/**
	 * Read session state with LAZY pause evaluation (AC-1) — ATOMIC.
	 *
	 * ⚠️ SIDE EFFECT ON READ: a GET to the state endpoint can write.
	 * If the session is in_progress and last_heartbeat_at is older than
	 * HEARTBEAT_TIMEOUT_SEC, it is transitioned to paused. Staleness is
	 * computed in SQL (no app-clock skew, no read-then-write race).
	 * No cron, no background process.
	 *
	 * @param {number} sessionId
	 * @returns {Promise<object>} session row (with effective status)
	 * @throws {Error} SESSION_NOT_FOUND
	 */
	async getState(sessionId) {
		// Atomic lazy pause: staleness evaluated in the database
		const { rows: paused } = await db.query(
			`UPDATE interview_sessions
			   SET status = 'paused', paused_at = NOW()
			 WHERE id = $1
			   AND status = 'in_progress'
			   AND last_heartbeat_at IS NOT NULL
			   AND last_heartbeat_at < NOW() - make_interval(secs => $2)
			 RETURNING *`,
			[sessionId, this.HEARTBEAT_TIMEOUT_SEC],
		);
		if (paused.length > 0) return paused[0];

		const { rows } = await db.query(
			'SELECT * FROM interview_sessions WHERE id = $1',
			[sessionId],
		);
		if (rows.length === 0) {
			throw this._stateError('SESSION_NOT_FOUND', `Session ${sessionId} not found`);
		}
		return rows[0];
	},

	/**
	 * Resume a paused session via its invite token (AC-2) — ATOMIC.
	 *
	 * Token comparison uses crypto.timingSafeEqual. The final UPDATE carries
	 * a status='paused' guard so a concurrent transition can't slip between
	 * the token check and the write.
	 *
	 * Returns the session including current_question_index so the client can
	 * resume at the right question.
	 *
	 * @param {number} sessionId
	 * @param {string} inviteToken
	 * @returns {Promise<object>} session row with current_question_index
	 * @throws {Error} SESSION_NOT_FOUND, INVALID_TOKEN, SESSION_STATE_CONFLICT
	 */
	async resume(sessionId, inviteToken) {
		const { rows } = await db.query(
			'SELECT id, status, invite_token FROM interview_sessions WHERE id = $1',
			[sessionId],
		);
		if (rows.length === 0) {
			throw this._stateError('SESSION_NOT_FOUND', `Session ${sessionId} not found`);
		}
		const session = rows[0];

		// Constant-time token comparison (invite_token is a bearer secret)
		const expected = Buffer.from(session.invite_token || '', 'utf8');
		const provided = Buffer.from(inviteToken || '', 'utf8');
		const tokenOk =
			expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
		if (!tokenOk) {
			throw this._stateError('INVALID_TOKEN', 'Invalid resume token');
		}
		if (session.status !== 'paused') {
			throw this._stateError(
				'SESSION_STATE_CONFLICT',
				`Cannot resume a ${session.status} session`,
			);
		}

		const { rows: updated } = await db.query(
			`UPDATE interview_sessions
			   SET status = 'in_progress', paused_at = NULL, last_heartbeat_at = NOW()
			 WHERE id = $1 AND status = 'paused'
			 RETURNING *`,
			[sessionId],
		);
		if (updated.length === 0) {
			throw this._stateError(
				'SESSION_STATE_CONFLICT',
				'Session is no longer paused',
			);
		}
		return updated[0];
	},
};

module.exports = SessionService;
