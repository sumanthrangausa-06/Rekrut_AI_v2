/**
 * lib/notify.js — In-app notification helper for the hiring pipeline.
 *
 * Every pipeline transition (apply, screening invite/complete, status change,
 * assessment assigned/completed, interview scheduled/updated) writes a row to
 * `user_notifications`. Email remains the secondary channel (see lib/email-service.js).
 *
 * Usage:
 *   const { notifyUser } = require('./notify');
 *   await notifyUser(candidateId, 'screening_invited', 'AI screening invited', '...', { application_id, job_id });
 */

const pool = require('./db');

/**
 * Notification priority model (PRD §5d — "Important only" gating).
 * - high: direct human actions the user should never miss. Inserted unconditionally.
 * - normal: everything else (including unknown types). Skipped when the user
 *   has enabled `important_only` in their notification settings.
 */
const HIGH_PRIORITY_TYPES = new Set([
	'message',
	'interview_scheduled',
	'interview_confirmed',
	'offer_received',
	'application_status_changed',
	'application_shortlisted',
	'application_rejected',
]);

function isHighPriority(type) {
	return HIGH_PRIORITY_TYPES.has(type);
}

/**
 * Write an in-app notification. Never throws — callers treat it as non-blocking.
 *
 * When the user has enabled "Important notifications only" (`important_only: true`
 * in user_settings.notifications), normal-priority types are skipped. High-priority
 * types bypass the settings lookup entirely (zero extra query on the hot path).
 * @param {number} userId
 * @param {string} type — e.g. 'application_submitted', 'screening_invited'
 * @param {string} title
 * @param {string} message
 * @param {object} metadata
 * @returns {Promise<number|null>} notification id, or null on failure / when filtered out
 */
async function notifyUser(userId, type, title, message, metadata = {}) {
	if (!userId) return null;
	try {
		if (!isHighPriority(type)) {
			const pref = await pool.query(
				`SELECT notifications->>'important_only' AS important_only FROM user_settings WHERE user_id = $1`,
				[userId],
			);
			if (pref.rows.length > 0 && pref.rows[0].important_only === 'true') {
				return null; // filtered out by "Important only" preference
			}
		}
		const result = await pool.query(
			`INSERT INTO user_notifications (user_id, type, title, message, metadata)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			[userId, type, title, message, JSON.stringify(metadata)],
		);
		return result.rows[0].id;
	} catch (err) {
		console.error('[notify] Failed to create notification:', err.message);
		return null;
	}
}

module.exports = { notifyUser, HIGH_PRIORITY_TYPES, isHighPriority };
