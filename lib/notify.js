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
 * Write an in-app notification. Never throws — callers treat it as non-blocking.
 * @param {number} userId
 * @param {string} type — e.g. 'application_submitted', 'screening_invited'
 * @param {string} title
 * @param {string} message
 * @param {object} metadata
 * @returns {Promise<number|null>} notification id or null on failure
 */
async function notifyUser(userId, type, title, message, metadata = {}) {
	if (!userId) return null;
	try {
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

module.exports = { notifyUser };
