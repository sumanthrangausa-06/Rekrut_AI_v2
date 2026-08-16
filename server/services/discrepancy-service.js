/**
 * Discrepancy Service
 * Issue #133 — Discrepancy detection and candidate-first fairness
 *
 * Handles:
 * - Creating discrepancy records when declared != verified
 * - Notifying candidates before recruiters see negative signals
 * - Managing candidate responses and recruiter resolutions
 */

const pool = require('../../lib/db');
const emailService = require('../../lib/email-service');
const auditLogService = require('../../services/auditLogService');
const { AuditLogger } = auditLogService;

const BASE_URL = process.env.FRONTEND_URL || 'https://rekrut.ai';

/**
 * Create a discrepancy record.
 * Does NOT notify the candidate automatically — caller decides when.
 */
async function createDiscrepancy({ verificationRequestId, fieldName, declaredValue, verifiedValue, severity }) {
	const result = await pool.query(
		`
    INSERT INTO discrepancies
      (verification_request_id, field_name, declared_value, verified_value, severity, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, 'open', NOW(), NOW())
    RETURNING *
  `,
		[verificationRequestId, fieldName, declaredValue, verifiedValue, severity],
	);

	return result.rows[0];
}

/**
 * Notify candidate about discrepancies on a verification request.
 * Fairness: candidate sees discrepancy FIRST and can explain before recruiter.
 */
async function notifyCandidate(verificationRequestId) {
	const discResult = await pool.query(
		`SELECT d.*, v.candidate_id, v.type
     FROM discrepancies d
     JOIN bg_verification_requests v ON v.id = d.verification_request_id
     WHERE d.verification_request_id = $1 AND d.status = 'open'`,
		[verificationRequestId],
	);

	if (discResult.rows.length === 0) return { notified: false, reason: 'no_open_discrepancies' };

	const candidateId = discResult.rows[0].candidate_id;

	// Get candidate email
	const userResult = await pool.query('SELECT email, name FROM users WHERE id = $1', [candidateId]);
	if (userResult.rows.length === 0) return { notified: false, reason: 'candidate_not_found' };

	const candidate = userResult.rows[0];
	const count = discResult.rows.length;

	// Build discrepancy list for email
	const list = discResult.rows
		.map((d, i) => `${i + 1}. ${d.field_name}: you declared "${d.declared_value || '(empty)'}", but verification shows "${d.verified_value || '(empty)'}" (${d.severity})`)
		.join('\n');

	const responseUrl = `${BASE_URL}/candidate/background-check/discrepancies?verification_id=${verificationRequestId}`;

	await emailService.sendCustomEmail({
		to: candidate.email,
		subject: 'Action Required: Background Check Discrepancy Detected',
		body: `Hi ${candidate.name || 'there'},\n\nDuring the background check process, ${count} discrepancy(ies) were found between your declared information and what the verifier provided:\n\n${list}\n\nPlease review and respond here:\n${responseUrl}\n\nYou have the opportunity to explain any discrepancies before they are shared with the recruiter.\n\nBest,\nRekrut AI`,
		html: `<p>Hi ${candidate.name || 'there'},</p><p>During the background check process, <strong>${count} discrepancy(ies)</strong> were found:</p><ul>${discResult.rows.map(d => `<li><strong>${d.field_name}</strong>: declared "${d.declared_value || '(empty)'}", verified "${d.verified_value || '(empty)'}" (${d.severity})</li>`).join('')}</ul><p><a href="${responseUrl}">Review and respond</a></p><p>You have the opportunity to explain before this is shared with the recruiter.</p>`,
		userId: candidateId,
		type: 'discrepancy_notification',
		metadata: { verification_request_id: verificationRequestId, discrepancy_count: count },
	});

	return { notified: true, candidate_id: candidateId, discrepancy_count: count };
}

/**
 * Get all discrepancies for a candidate (for candidate-facing UI)
 */
async function getDiscrepanciesForCandidate(candidateId) {
	const result = await pool.query(
		`
    SELECT d.*, v.type as verification_type, v.target_id
    FROM discrepancies d
    JOIN bg_verification_requests v ON v.id = d.verification_request_id
    WHERE v.candidate_id = $1
    ORDER BY d.created_at DESC
  `,
		[candidateId],
	);
	return result.rows;
}

/**
 * Candidate responds to a discrepancy
 */
async function respondToDiscrepancy(discrepancyId, candidateId, candidateResponse) {
	// Verify the discrepancy belongs to this candidate
	const verifyResult = await pool.query(
		`
    SELECT d.id FROM discrepancies d
    JOIN bg_verification_requests v ON v.id = d.verification_request_id
    WHERE d.id = $1 AND v.candidate_id = $2
  `,
		[discrepancyId, candidateId],
	);
	if (verifyResult.rows.length === 0) {
		throw new Error('Discrepancy not found or not owned by candidate');
	}

	const result = await pool.query(
		`
    UPDATE discrepancies
    SET status = 'candidate_responded',
        candidate_response = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `,
		[discrepancyId, candidateResponse],
	);

	// Audit log
	try {
		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.HUMAN_OVERRIDE,
			entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
			entityId: candidateId,
			payload: {
				discrepancy_id: discrepancyId,
				action: 'candidate_responded',
				response_preview: candidateResponse?.slice(0, 200),
			},
		});
	} catch (e) {
		console.error('[discrepancy-service] Audit log failed (non-blocking):', e.message);
	}

	return result.rows[0];
}

/**
 * Recruiter resolves a discrepancy
 */
async function resolveDiscrepancy(discrepancyId, resolverId, resolution) {
	const result = await pool.query(
		`
    UPDATE discrepancies
    SET status = 'resolved',
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `,
		[discrepancyId],
	);

	if (result.rows.length === 0) {
		throw new Error('Discrepancy not found');
	}

	// Audit log
	try {
		await AuditLogger.log({
			actionType: 'discrepancy_resolved',
			userId: resolverId,
			targetType: 'discrepancy',
			targetId: discrepancyId,
			metadata: { resolution },
		});
	} catch (e) {
		console.error('[discrepancy-service] Audit log failed (non-blocking):', e.message);
	}

	return result.rows[0];
}

/**
 * Dismiss a discrepancy (admin or recruiter decides it's not an issue)
 */
async function dismissDiscrepancy(discrepancyId, dismisserId) {
	const result = await pool.query(
		`
    UPDATE discrepancies
    SET status = 'dismissed',
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `,
		[discrepancyId],
	);

	if (result.rows.length === 0) {
		throw new Error('Discrepancy not found');
	}

	try {
		await AuditLogger.log({
			actionType: 'discrepancy_dismissed',
			userId: dismisserId,
			targetType: 'discrepancy',
			targetId: discrepancyId,
			metadata: {},
		});
	} catch (e) {
		console.error('[discrepancy-service] Audit log failed (non-blocking):', e.message);
	}

	return result.rows[0];
}

module.exports = {
	createDiscrepancy,
	notifyCandidate,
	getDiscrepanciesForCandidate,
	respondToDiscrepancy,
	resolveDiscrepancy,
	dismissDiscrepancy,
};
