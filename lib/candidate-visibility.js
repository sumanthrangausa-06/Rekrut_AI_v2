/**
 * #1391 — Candidate visibility gate for recruiter CV analysis.
 *
 * Founder ruling (2026-11-02): access follows the candidate's own
 * Public-profile switch (Settings -> Privacy, "Allow recruiters to view
 * your profile and contact you"). The switch lives in
 * `user_settings.privacy->>'profile_visible'` (migration 060;
 * routes/settings.js DEFAULT_PRIVACY) — there is NO
 * candidate_profiles.profile_visible column.
 *
 *   switch ON  -> any recruiter may view/analyse the candidate
 *   switch OFF -> blocked, EXCEPT recruiter(s) of jobs the candidate
 *                 actually applied to, scoped to THAT job only
 *   no user_settings row / missing-or-null key -> FAIL CLOSED (private)
 *                 for these analysis endpoints (stricter than the
 *                 discovery search's #416 default-true-on-absent; see
 *                 the STOP 1 note on #1391)
 *
 * Denial semantics (panel record, retained by the ruling): HTTP 404 —
 * never 403, so a blocked id is indistinguishable from a nonexistent
 * one — the denial is audit-logged, and the caller must run this gate
 * BEFORE any profile fetch beyond this check, any AI/screener spend,
 * and any screening-record write.
 */
const pool = require('./db');
const { AuditLogger } = require('../services/auditLogService');

/**
 * True when `candidateId` may be viewed/analysed in the context of
 * `jobId`: publicly visible, or an applicant to that exact job.
 */
async function candidateVisibleToRecruiter(candidateId, jobId) {
	const { rows } = await pool.query(
		`SELECT
		   (SELECT (privacy->>'profile_visible') = 'true'
		      FROM user_settings WHERE user_id = $1) AS visible,
		   EXISTS (SELECT 1 FROM job_applications
		            WHERE candidate_id = $1 AND job_id = $2) AS is_applicant`,
		[candidateId, jobId],
	);
	const row = rows[0] || {};
	return row.visible === true || row.is_applicant === true;
}

/**
 * Gate for one candidate/job pair. Returns true when access is allowed.
 * When denied: writes the denial audit log and sends the 404 response —
 * the caller must `return` immediately on false.
 */
async function denyUnlessCandidateVisible(req, res, { candidateId, jobId, endpoint }) {
	if (await candidateVisibleToRecruiter(candidateId, jobId)) return true;
	await AuditLogger.log({
		actionType: 'screening_visibility_denied',
		userId: req.user?.id ?? null,
		targetType: 'candidate',
		targetId: candidateId,
		metadata: {
			candidate_id: candidateId,
			job_id: jobId,
			endpoint,
			reason: 'profile_not_visible',
		},
		req,
	});
	res.status(404).json({ error: 'Candidate not found' });
	return false;
}

module.exports = { candidateVisibleToRecruiter, denyUnlessCandidateVisible };
