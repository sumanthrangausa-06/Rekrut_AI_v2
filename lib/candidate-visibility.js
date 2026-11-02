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

/**
 * #2082 — DISCOVERY gate (deliberately different semantics from the
 * #1391 analysis gate above; Rex's naming requirement on #2082: the two
 * semantics are named distinctly, never silently re-defaulted).
 *
 * For read/discovery surfaces that carry NO job context (e.g.
 * GET /omniscore/candidate/:candidateId, GET /omniscore/leaderboard).
 * Mirrors the #416 candidate-search predicate
 * (routes/candidateSearch.js CANDIDATE_VISIBILITY_SQL): a candidate is
 * hidden ONLY on an explicit profile_visible='false', or when
 * soft-deleted. An absent user_settings row — or a settings row whose
 * privacy has no profile_visible key — means VISIBLE: the product
 * default is ON (routes/settings.js DEFAULT_PRIVACY), and search and
 * direct-id reads must agree ('unreachable by search OR by direct ID').
 * There is NO applicant exception here: no job context exists on these
 * surfaces, so the exception cannot be honestly evaluated — it stays
 * on the job-scoped #1391 analysis endpoints above.
 */
async function candidateDiscoverable(candidateId) {
	const { rows } = await pool.query(
		`SELECT u.deleted_at IS NULL AS not_deleted,
		        NOT EXISTS (SELECT 1 FROM user_settings us
		                     WHERE us.user_id = u.id
		                       AND us.privacy->>'profile_visible' = 'false') AS not_hidden
		   FROM users u WHERE u.id = $1`,
		[candidateId],
	);
	const row = rows[0];
	if (!row) return { discoverable: false, reason: 'candidate_not_found' };
	if (!row.not_deleted) return { discoverable: false, reason: 'candidate_deleted' };
	if (!row.not_hidden) return { discoverable: false, reason: 'profile_not_visible' };
	return { discoverable: true, reason: null };
}

/**
 * Discovery gate for one candidate. Returns true when the candidate is
 * discoverable. When denied: writes the denial audit log (distinct
 * actionType from the #1391 analysis gate; minimal metadata — ids,
 * endpoint, reason only, never email or score) and sends the 404
 * response — the caller must `return` immediately on false, BEFORE any
 * fetch/score work, so a denial performs zero writes.
 */
async function denyUnlessCandidateDiscoverable(req, res, { candidateId, endpoint }) {
	const { discoverable, reason } = await candidateDiscoverable(candidateId);
	if (discoverable) return true;
	await AuditLogger.log({
		actionType: 'candidate_visibility_denied',
		userId: req.user?.id ?? null,
		targetType: 'candidate',
		targetId: candidateId,
		metadata: {
			candidate_id: candidateId,
			endpoint,
			reason,
		},
		req,
	});
	res.status(404).json({ error: 'Candidate not found' });
	return false;
}

module.exports = {
	candidateVisibleToRecruiter,
	denyUnlessCandidateVisible,
	candidateDiscoverable,
	denyUnlessCandidateDiscoverable,
};
