/**
 * Job alert matching + notification helper (#528).
 *
 * Called after a job is created to find active job_alerts that match
 * the new job, then notifies each subscribed candidate via the
 * existing notifyUser() path (user_notifications table).
 *
 * Matching rules:
 *  - keywords: ILIKE against job title + description (required)
 *  - location: ILIKE against job location (only if alert has one)
 *  - job_type: exact match (only if alert has one)
 *  - salary_min: job salary_min >= alert salary_min (only if alert has one)
 *  - only jobs with status = 'active' are matched
 */
const pool = require('./db');
const { notifyUser } = require('./notify');

/**
 * Count currently-active jobs matching a single alert.
 * Used for the frontend `match_count` field.
 */
async function countMatchesForAlert(alert) {
	const { where, params } = buildMatchClause(alert, 1);
	const result = await pool.query(
		`SELECT COUNT(*)::int AS cnt FROM jobs WHERE status = 'active' AND ${where}`,
		params,
	);
	return result.rows[0].cnt;
}

/**
 * Build the WHERE clause (without the status filter) for alert matching.
 * @param {object} alert - { keywords, location, job_type, salary_min }
 * @param {number} startIdx - starting $N index for parameters
 * @returns {{ where: string, params: Array }}
 */
function buildMatchClause(alert, startIdx = 1) {
	const clauses = [];
	const params = [];
	let i = startIdx;

	if (alert.keywords) {
		// Split on whitespace/comma; every term must appear in title or description
		const terms = String(alert.keywords)
			.split(/[\s,]+/)
			.map((t) => t.trim())
			.filter(Boolean);
		for (const term of terms) {
			clauses.push(`(title ILIKE $${i} OR description ILIKE $${i})`);
			params.push(`%${term}%`);
			i += 1;
		}
	}
	if (alert.location) {
		clauses.push(`location ILIKE $${i}`);
		params.push(`%${alert.location}%`);
		i += 1;
	}
	if (alert.job_type) {
		clauses.push(`job_type = $${i}`);
		params.push(alert.job_type);
		i += 1;
	}
	if (alert.salary_min != null) {
		clauses.push(`(salary_min IS NULL OR salary_min >= $${i})`);
		params.push(alert.salary_min);
		i += 1;
	}
	return { where: clauses.length > 0 ? clauses.join(' AND ') : 'TRUE', params };
}

/**
 * Find active alerts matching a newly created job and notify subscribers.
 * Fire-and-forget safe: never throws (logs and returns counts).
 *
 * @param {object} job - the inserted job row ({ id, title, description, location, job_type, salary_min })
 * @returns {Promise<{ matched: number, notified: number }>}
 */
async function matchAndNotifyForJob(job) {
	if (!job || !job.id) return { matched: 0, notified: 0 };
	try {
		// Find active alerts whose criteria match this job
		const alerts = await pool.query(
			`SELECT id, user_id, keywords, location, job_type, salary_min
       FROM job_alerts
       WHERE is_active = true`,
		);
		let matched = 0;
		let notified = 0;
		for (const alert of alerts.rows) {
			const { where, params } = buildMatchClause(alert, 2);
			const check = await pool.query(
				`SELECT 1 FROM jobs WHERE id = $1 AND status = 'active' AND ${where} LIMIT 1`,
				[job.id, ...params],
			);
			if (check.rows.length === 0) continue;
			matched += 1;
			const notifId = await notifyUser(
				alert.user_id,
				'job_alert_match',
				'New job matches your alert',
				`"${job.title}" matches your job alert "${alert.keywords}".`,
				{
					url: `/candidate/jobs/${job.id}`,
					job_id: job.id,
					alert_id: alert.id,
				},
			);
			if (notifId) notified += 1;
		}
		return { matched, notified };
	} catch (err) {
		console.error('[job-alert-matcher] matchAndNotifyForJob failed:', err.message);
		return { matched: 0, notified: 0 };
	}
}

module.exports = { buildMatchClause, countMatchesForAlert, matchAndNotifyForJob };
