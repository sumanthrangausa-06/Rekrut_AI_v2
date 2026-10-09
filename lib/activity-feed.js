// lib/activity-feed.js — Unified activity feed builders (Issue #529)
//
// Aggregates from existing tables only (no new activity table):
//   Candidate: applications, interviews, notifications, assessments, endorsements
//   Recruiter: new applications, interviews, endorsements given
//
// Each item: { id, type, title, description, timestamp, read }
// Types match frontend ActivityItem: profile_view | application_update |
//   interview_invite | skill_endorsement | job_alert

const pool = require('./db');

// Map notification types to feed types
function mapNotificationType(type) {
	const t = String(type || '').toLowerCase();
	if (t.includes('job_alert') || t.includes('job_match')) return 'job_alert';
	if (t.includes('interview')) return 'interview_invite';
	if (t.includes('endors')) return 'skill_endorsement';
	if (t.includes('profile_view')) return 'profile_view';
	return 'application_update';
}

function sortFeed(items, limit = 50) {
	return items
		.filter((i) => i.timestamp)
		.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
		.slice(0, limit);
}

// ─── Candidate feed ─────────────────────────────────────────────────────────
async function buildCandidateFeed(userId) {
	const items = [];

	// Applications (submitted + status changes)
	try {
		const apps = await pool.query(
			`SELECT ja.id, ja.status, ja.applied_at, ja.updated_at, j.title as job_title
       FROM job_applications ja
       LEFT JOIN jobs j ON j.id = ja.job_id
       WHERE ja.candidate_id = $1
       ORDER BY ja.applied_at DESC
       LIMIT 20`,
			[userId],
		);
		for (const a of apps.rows) {
			items.push({
				id: `app-${a.id}`,
				type: 'application_update',
				title: `Applied to ${a.job_title || 'a job'}`,
				description: `Status: ${a.status || 'applied'}`,
				timestamp: a.applied_at,
				read: true,
			});
			// Status change is a separate event if updated after applying
			if (
				a.updated_at &&
				a.applied_at &&
				new Date(a.updated_at) > new Date(a.applied_at) &&
				a.status &&
				a.status !== 'applied'
			) {
				items.push({
					id: `app-status-${a.id}`,
					type: 'application_update',
					title: `Application ${a.status}: ${a.job_title || 'a job'}`,
					description: `Your application status changed to ${a.status}`,
					timestamp: a.updated_at,
					read: true,
				});
			}
		}
	} catch (err) {
		console.error('[activity-feed] applications failed:', err.message);
	}

	// Interviews (scheduled / completed)
	try {
		const interviews = await pool.query(
			`SELECT si.id, si.status, si.scheduled_at, si.interview_type, j.title as job_title
       FROM scheduled_interviews si
       LEFT JOIN jobs j ON j.id = si.job_id
       WHERE si.candidate_id = $1
       ORDER BY si.scheduled_at DESC
       LIMIT 20`,
			[userId],
		);
		for (const i of interviews.rows) {
			items.push({
				id: `int-${i.id}`,
				type: 'interview_invite',
				title: `${i.interview_type || 'Interview'} ${i.status || 'scheduled'}`,
				description: `${i.job_title || 'Interview'} — ${i.scheduled_at ? new Date(i.scheduled_at).toLocaleDateString() : ''}`,
				timestamp: i.scheduled_at,
				read: true,
			});
		}
	} catch (err) {
		console.error('[activity-feed] interviews failed:', err.message);
	}

	// Notifications (carry real read status)
	try {
		const notifs = await pool.query(
			`SELECT id, type, title, message, read, created_at
       FROM user_notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
			[userId],
		);
		for (const n of notifs.rows) {
			items.push({
				id: `notif-${n.id}`,
				type: mapNotificationType(n.type),
				title: n.title || 'Notification',
				description: n.message || '',
				timestamp: n.created_at,
				read: !!n.read,
			});
		}
	} catch (err) {
		console.error('[activity-feed] notifications failed:', err.message);
	}

	// Assessment completions
	try {
		const assessments = await pool.query(
			`SELECT ata.id, ata.status, ata.score, ata.max_score, ata.completed_at, at.title as test_title
       FROM aptitude_test_attempts ata
       JOIN aptitude_tests at ON at.id = ata.test_id
       WHERE ata.candidate_id = $1 AND ata.status = 'completed'
       ORDER BY ata.completed_at DESC
       LIMIT 10`,
			[userId],
		);
		for (const a of assessments.rows) {
			items.push({
				id: `assess-${a.id}`,
				type: 'application_update',
				title: `Completed assessment: ${a.test_title || 'Aptitude test'}`,
				description:
					a.score != null && a.max_score != null
						? `Score: ${a.score}/${a.max_score}`
						: 'Assessment completed',
				timestamp: a.completed_at,
				read: true,
			});
		}
	} catch (err) {
		console.error('[activity-feed] assessments failed:', err.message);
	}

	// Endorsements received (defensive — table from #527 may not exist yet)
	try {
		const endorsements = await pool.query(
			`SELECT se.id, se.skill_name, se.created_at, u.name as recruiter_name
       FROM skill_endorsements se
       JOIN users u ON u.id = se.recruiter_id
       WHERE se.candidate_id = $1
       ORDER BY se.created_at DESC
       LIMIT 10`,
			[userId],
		);
		for (const e of endorsements.rows) {
			items.push({
				id: `endorse-${e.id}`,
				type: 'skill_endorsement',
				title: `${e.recruiter_name || 'A recruiter'} endorsed your skill`,
				description: e.skill_name || '',
				timestamp: e.created_at,
				read: true,
			});
		}
	} catch (err) {
		console.error('[activity-feed] endorsements failed (table may not exist):', err.message);
	}

	return sortFeed(items);
}

// ─── Recruiter feed ───────────────────────────────────────────────────────────
async function buildRecruiterFeed(userId, companyId) {
	const items = [];

	// New applications to company jobs
	try {
		const apps = await pool.query(
			`SELECT ja.id, ja.status, ja.applied_at, u.name as candidate_name, j.title as job_title
       FROM job_applications ja
       JOIN users u ON u.id = ja.candidate_id
       JOIN jobs j ON j.id = ja.job_id
       WHERE ja.company_id = $1
       ORDER BY ja.applied_at DESC
       LIMIT 20`,
			[companyId],
		);
		for (const a of apps.rows) {
			items.push({
				id: `app-${a.id}`,
				type: 'application_update',
				title: `${a.candidate_name || 'A candidate'} applied`,
				description: `${a.job_title || 'a job'} — Status: ${a.status || 'applied'}`,
				timestamp: a.applied_at,
				read: true,
			});
		}
	} catch (err) {
		console.error('[activity-feed] recruiter applications failed:', err.message);
	}

	// Interviews for company jobs
	try {
		const interviews = await pool.query(
			`SELECT si.id, si.status, si.scheduled_at, si.interview_type,
              u.name as candidate_name, j.title as job_title
       FROM scheduled_interviews si
       JOIN users u ON u.id = si.candidate_id
       LEFT JOIN jobs j ON j.id = si.job_id
       WHERE si.company_id = $1
       ORDER BY si.scheduled_at DESC
       LIMIT 20`,
			[companyId],
		);
		for (const i of interviews.rows) {
			items.push({
				id: `int-${i.id}`,
				type: 'interview_invite',
				title: `Interview ${i.status || 'scheduled'}: ${i.candidate_name || 'candidate'}`,
				description: `${i.job_title || ''} — ${i.interview_type || ''}`.trim(),
				timestamp: i.scheduled_at,
				read: true,
			});
		}
	} catch (err) {
		console.error('[activity-feed] recruiter interviews failed:', err.message);
	}

	// Endorsements given by this recruiter (defensive)
	try {
		const endorsements = await pool.query(
			`SELECT se.id, se.skill_name, se.created_at, u.name as candidate_name
       FROM skill_endorsements se
       JOIN users u ON u.id = se.candidate_id
       WHERE se.recruiter_id = $1
       ORDER BY se.created_at DESC
       LIMIT 10`,
			[userId],
		);
		for (const e of endorsements.rows) {
			items.push({
				id: `endorse-${e.id}`,
				type: 'skill_endorsement',
				title: `You endorsed ${e.candidate_name || 'a candidate'}`,
				description: e.skill_name || '',
				timestamp: e.created_at,
				read: true,
			});
		}
	} catch (err) {
		console.error('[activity-feed] recruiter endorsements failed:', err.message);
	}

	return sortFeed(items);
}

module.exports = { buildCandidateFeed, buildRecruiterFeed, mapNotificationType };
