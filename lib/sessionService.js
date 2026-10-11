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
			 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '7 days', 'invited', $8, $9)
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
};

module.exports = SessionService;
