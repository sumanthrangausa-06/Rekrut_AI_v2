/**
 * Verification Service
 * Issue #133 — Background check verification workflow
 *
 * Handles:
 * - Creating verification requests
 * - Sending verification emails to employers/institutions
 * - Processing structured responses
 * - Detecting discrepancies between declared and verified data
 * - Generating verification summaries
 */

const crypto = require('node:crypto');
const pool = require('../../lib/db');
const emailService = require('../../lib/email-service');
const discrepancyService = require('./discrepancy-service');
const auditLogService = require('../../services/auditLogService');
const { AuditLogger } = auditLogService;

const BASE_URL = process.env.BASE_URL || process.env.APP_URL || 'https://rekrut.ai';

/**
 * Generate a secure random token for public response links
 */
function generateToken() {
	return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a new verification request and send email to target
 */
async function createVerificationRequest({ candidateId, type, targetId, targetEmail, notes = '' }) {
	const token = generateToken();

	const result = await pool.query(
		`
    INSERT INTO bg_verification_requests
      (candidate_id, type, target_id, status, notes, response_token, target_email, created_at, updated_at)
    VALUES ($1, $2, $3, 'pending', $4, $5, $6, NOW(), NOW())
    RETURNING *
  `,
		[candidateId, type, targetId, notes, token, targetEmail],
	);

	const request = result.rows[0];

	// Log to compliance audit trail
	try {
		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.VERIFICATION,
			entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
			entityId: candidateId,
			payload: {
				verification_id: request.id,
				type,
				target_id: targetId,
				target_email: targetEmail,
				action: 'created',
			},
		});
	} catch (e) {
		console.error('[verification-service] Audit log failed (non-blocking):', e.message);
	}

	return request;
}

/**
 * Send verification request email to employer/institution
 * Returns true if email was sent successfully
 */
async function sendVerificationEmail(verificationId) {
	const result = await pool.query('SELECT * FROM bg_verification_requests WHERE id = $1', [
		verificationId,
	]);
	if (result.rows.length === 0) {
		throw new Error('Verification request not found');
	}

	const request = result.rows[0];
	if (!request.target_email) {
		throw new Error('No target email set for verification request');
	}

	const responseUrl = `${BASE_URL}/api/verification-requests/${request.id}/respond?token=${request.response_token}`;

	let subject, body;
	if (request.type === 'employment') {
		subject = 'Employment Verification Request';
		body = `A former employee has listed your organization as part of their employment history. Please verify the details by completing the form at:\n\n${responseUrl}\n\nThis link is unique and confidential. Thank you for your time.`;
	} else if (request.type === 'education') {
		subject = 'Education Verification Request';
		body = `A former student has listed your institution as part of their education history. Please verify the details by completing the form at:\n\n${responseUrl}\n\nThis link is unique and confidential. Thank you for your time.`;
	} else if (request.type === 'reference') {
		subject = 'Reference Check Request';
		body = `You have been listed as a professional reference. Please complete the questionnaire at:\n\n${responseUrl}\n\nThis link is unique and confidential. Thank you for your time.`;
	}

	const emailResult = await emailService.sendCustomEmail({
		to: request.target_email,
		subject,
		body,
		html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
		userId: request.candidate_id,
		type: 'verification_request',
		metadata: { verification_id: request.id, type: request.type },
	});

	if (emailResult.success) {
		await pool.query(
			"UPDATE bg_verification_requests SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = $1",
			[verificationId],
		);
	}

	return emailResult.success;
}

/**
 * Process a structured response from an employer/institution
 * (public endpoint — no auth, uses token)
 */
async function processResponse(verificationId, token, responseData) {
	const result = await pool.query(
		'SELECT * FROM bg_verification_requests WHERE id = $1 AND response_token = $2',
		[verificationId, token],
	);
	if (result.rows.length === 0) {
		throw new Error('Invalid verification request or token');
	}

	const request = result.rows[0];
	if (request.status === 'verified' || request.status === 'rejected') {
		throw new Error('Verification request already finalized');
	}

	await pool.query(
		`
    UPDATE bg_verification_requests
    SET status = 'responded',
        responded_at = NOW(),
        verification_data = $2,
        updated_at = NOW()
    WHERE id = $1
  `,
		[verificationId, JSON.stringify(responseData)],
	);

	// Detect discrepancies
	const discrepancies = await detectDiscrepancies(verificationId);

	// Log response
	try {
		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.VERIFICATION,
			entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
			entityId: request.candidate_id,
			payload: {
				verification_id: verificationId,
				type: request.type,
				action: 'responded',
				discrepancies_found: discrepancies.length,
			},
		});
	} catch (e) {
		console.error('[verification-service] Audit log failed (non-blocking):', e.message);
	}

	return { success: true, discrepancies_found: discrepancies.length };
}

/**
 * Mark a verification as manually reviewed (recruiter fallback)
 */
async function markManualReview(verificationId, reviewerId, notes = '') {
	await pool.query(
		`
    UPDATE bg_verification_requests
    SET status = 'manual_review', notes = COALESCE(notes, '') || '\n[Manual Review] ' || $2, updated_at = NOW()
    WHERE id = $1
  `,
		[verificationId, notes],
	);

	// Audit log
	const reqResult = await pool.query(
		'SELECT candidate_id FROM bg_verification_requests WHERE id = $1',
		[verificationId],
	);
	if (reqResult.rows.length > 0) {
		try {
			await AuditLogger.log({
				actionType: 'verification_manual_review',
				userId: reviewerId,
				targetType: 'bg_verification_request',
				targetId: verificationId,
				metadata: { candidate_id: reqResult.rows[0].candidate_id, notes },
			});
		} catch (e) {
			console.error('[verification-service] Audit log failed (non-blocking):', e.message);
		}
	}
}

/**
 * Detect discrepancies between declared and verified values.
 * Compares the original employment_history/education_history record
 * against the verification_data JSONB from the response.
 */
async function detectDiscrepancies(verificationId) {
	const result = await pool.query('SELECT * FROM bg_verification_requests WHERE id = $1', [
		verificationId,
	]);
	if (result.rows.length === 0) return [];

	const request = result.rows[0];
	const verified = request.verification_data || {};
	const discrepancies = [];

	if (request.type === 'employment') {
		const empResult = await pool.query('SELECT * FROM employment_history WHERE id = $1', [
			request.target_id,
		]);
		if (empResult.rows.length === 0) return [];
		const declared = empResult.rows[0];

		if (
			verified.company_name &&
			normalized(verified.company_name) !== normalized(declared.company_name)
		) {
			discrepancies.push({
				field: 'company_name',
				declared: declared.company_name,
				verified: verified.company_name,
			});
		}
		if (verified.job_title && normalized(verified.job_title) !== normalized(declared.job_title)) {
			discrepancies.push({
				field: 'job_title',
				declared: declared.job_title,
				verified: verified.job_title,
			});
		}
		if (verified.start_date && !sameDate(verified.start_date, declared.start_date)) {
			discrepancies.push({
				field: 'start_date',
				declared: declared.start_date,
				verified: verified.start_date,
			});
		}
		if (verified.end_date && !sameDate(verified.end_date, declared.end_date)) {
			discrepancies.push({
				field: 'end_date',
				declared: declared.end_date,
				verified: verified.end_date,
			});
		}
		// is_current mismatch only if explicitly stated
		if (typeof verified.is_current === 'boolean' && verified.is_current !== declared.is_current) {
			discrepancies.push({
				field: 'is_current',
				declared: String(declared.is_current),
				verified: String(verified.is_current),
			});
		}
	} else if (request.type === 'education') {
		const eduResult = await pool.query('SELECT * FROM education_history WHERE id = $1', [
			request.target_id,
		]);
		if (eduResult.rows.length === 0) return [];
		const declared = eduResult.rows[0];

		if (
			verified.institution_name &&
			normalized(verified.institution_name) !== normalized(declared.institution_name)
		) {
			discrepancies.push({
				field: 'institution_name',
				declared: declared.institution_name,
				verified: verified.institution_name,
			});
		}
		if (verified.degree && normalized(verified.degree) !== normalized(declared.degree)) {
			discrepancies.push({ field: 'degree', declared: declared.degree, verified: verified.degree });
		}
		if (
			verified.field_of_study &&
			normalized(verified.field_of_study) !== normalized(declared.field_of_study)
		) {
			discrepancies.push({
				field: 'field_of_study',
				declared: declared.field_of_study,
				verified: verified.field_of_study,
			});
		}
		if (verified.start_date && !sameDate(verified.start_date, declared.start_date)) {
			discrepancies.push({
				field: 'start_date',
				declared: declared.start_date,
				verified: verified.start_date,
			});
		}
		if (verified.end_date && !sameDate(verified.end_date, declared.end_date)) {
			discrepancies.push({
				field: 'end_date',
				declared: declared.end_date,
				verified: verified.end_date,
			});
		}
	}

	// Create discrepancy records
	const created = [];
	for (const d of discrepancies) {
		const sev = ['company_name', 'institution_name', 'degree'].includes(d.field)
			? 'major'
			: 'minor';
		const disc = await discrepancyService.createDiscrepancy({
			verificationRequestId: verificationId,
			fieldName: d.field,
			declaredValue: d.declared,
			verifiedValue: d.verified,
			severity: sev,
		});
		created.push(disc);
	}

	return created;
}

/**
 * Generate a summary of a verification request
 */
async function generateSummary(verificationId) {
	const result = await pool.query(
		`
    SELECT v.*,
      CASE
        WHEN v.type = 'employment' THEN (SELECT json_build_object('company_name', company_name, 'job_title', job_title, 'start_date', start_date, 'end_date', end_date) FROM employment_history WHERE id = v.target_id)
        WHEN v.type = 'education' THEN (SELECT json_build_object('institution_name', institution_name, 'degree', degree, 'field_of_study', field_of_study, 'start_date', start_date, 'end_date', end_date) FROM education_history WHERE id = v.target_id)
        ELSE NULL
      END as declared_data,
      (SELECT json_agg(json_build_object('field', field_name, 'severity', severity, 'status', status))
       FROM discrepancies WHERE verification_request_id = v.id) as discrepancy_list
    FROM bg_verification_requests v
    WHERE v.id = $1
  `,
		[verificationId],
	);

	if (result.rows.length === 0) return null;
	return result.rows[0];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalized(str) {
	if (!str) return '';
	return String(str).toLowerCase().replace(/\s+/g, ' ').trim();
}

function sameDate(a, b) {
	if (!a || !b) return false;
	return new Date(a).toISOString().split('T')[0] === new Date(b).toISOString().split('T')[0];
}

module.exports = {
	createVerificationRequest,
	sendVerificationEmail,
	processResponse,
	markManualReview,
	detectDiscrepancies,
	generateSummary,
};
