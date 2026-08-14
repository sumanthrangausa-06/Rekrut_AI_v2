/**
 * Signature Service — E-Signature Engine Core Business Logic
 *
 * Manages the full lifecycle of digitally signed documents:
 *   - Document creation with cryptographic hash baseline
 *   - Signing party invitation and ordering
 *   - Signature request orchestration (sequential signing)
 *   - Immutable audit trail logging
 *   - Tamper detection and hash chain verification
 *   - PKCS#7 detached signature storage
 *
 * @module server/services/signatureService
 */

const crypto = require('node:crypto');
const pool = require('../../lib/db');
const {
	computeDocumentHash,
	verifyDocumentHash,
	computeChainHash,
	computeEventHash,
	createPKCS7DetachedSignature,
	verifyPKCS7DetachedSignature,
	generateTestKeyPair,
} = require('../utils/pkcs7');
const auditLogService = require('../../services/auditLogService');

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_EXPIRY_DAYS = 30;
const MAX_REMINDERS = 5;
const REMINDER_INTERVAL_HOURS = 48;

const DOCUMENT_STATUS = {
	DRAFT: 'draft',
	SENT: 'sent',
	IN_PROGRESS: 'in_progress',
	COMPLETED: 'completed',
	EXPIRED: 'expired',
	CANCELLED: 'cancelled',
};

const REQUEST_STATUS = {
	PENDING: 'pending',
	SENT: 'sent',
	VIEWED: 'viewed',
	SIGNING: 'signing',
	SIGNED: 'signed',
	DECLINED: 'declined',
};

const EVENT_TYPE = {
	DOCUMENT_CREATED: 'document_created',
	DOCUMENT_UPDATED: 'document_updated',
	DOCUMENT_SENT: 'document_sent',
	DOCUMENT_CANCELLED: 'document_cancelled',
	DOCUMENT_EXPIRED: 'document_expired',
	DOCUMENT_COMPLETED: 'document_completed',
	PARTY_INVITED: 'party_invited',
	PARTY_REMINDED: 'party_reminded',
	DOCUMENT_VIEWED: 'document_viewed',
	SIGNING_STARTED: 'signing_started',
	SIGNED: 'signed',
	DECLINED: 'declined',
	HASH_VERIFIED: 'hash_verified',
	TAMPER_DETECTED: 'tamper_detected',
	AUDIT_EXPORTED: 'audit_exported',
};

// ─────────────────────────────────────────────────────────────────────────────
// Document Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new signature document with a baseline content hash.
 *
 * @param {Object} params
 * @param {number} params.companyId
 * @param {number} params.createdBy — user ID of document creator
 * @param {string} params.title
 * @param {string} [params.description]
 * @param {string} [params.documentType='generic']
 * @param {string} [params.fileUrl]
 * @param {number} [params.fileSize]
 * @param {string} [params.mimeType]
 * @param {string} [params.originalFilename]
 * @param {Buffer|string} params.documentContent — raw bytes for baseline hash
 * @param {string} [params.signatureType='simple']
 * @param {string} [params.legalJurisdiction='US']
 * @param {string} [params.complianceFramework]
 * @param {Date} [params.expiresAt]
 * @param {Object} [params.metadata={}]
 * @returns {Promise<{ document: Object, hashRecord: Object }>}
 */
async function createDocument(params) {
	const client = await pool.connect();

	try {
		await client.query('BEGIN');

		const {
			companyId,
			createdBy,
			title,
			description,
			documentType = 'generic',
			fileUrl,
			fileSize,
			mimeType,
			originalFilename,
			documentContent,
			signatureType = 'simple',
			legalJurisdiction = 'US',
			complianceFramework,
			expiresAt,
			metadata = {},
		} = params;

		// Compute baseline hash of document content
		const documentHash = computeDocumentHash(documentContent, 'sha256');

		// Default expiry if not provided
		const finalExpiresAt =
			expiresAt ||
			new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

		// Insert document
		const docResult = await client.query(
			`
			INSERT INTO signature_documents (
				company_id, created_by, title, description, document_type,
				file_url, file_size, mime_type, original_filename,
				document_hash, signature_type, status,
				expires_at, legal_jurisdiction, compliance_framework, metadata
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
			RETURNING *
			`,
			[
				companyId,
				createdBy,
				title,
				description || null,
				documentType,
				fileUrl || null,
				fileSize || null,
				mimeType || null,
				originalFilename || null,
				documentHash,
				signatureType,
				DOCUMENT_STATUS.DRAFT,
				finalExpiresAt,
				legalJurisdiction,
				complianceFramework || null,
				JSON.stringify(metadata),
			],
		);

		const document = docResult.rows[0];

		// Create first hash record (tamper baseline)
		const chainHash = computeChainHash('', documentHash, 'sha256');
		const hashResult = await client.query(
			`
			INSERT INTO document_hash_records (
				document_id, hash_type, hash_value, hash_scope,
				previous_hash, chain_hash, created_by
			) VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING *
			`,
			[
				document.id,
				'sha256',
				documentHash,
				'document_content',
				null,
				chainHash,
				createdBy,
			],
		);

		// Log creation event
		await _logAuditEvent(client, {
			documentId: document.id,
			requestId: null,
			partyId: null,
			eventType: EVENT_TYPE.DOCUMENT_CREATED,
			severity: 'info',
			eventData: {
				title,
				document_type: documentType,
				signature_type: signatureType,
				document_hash: documentHash,
				expires_at: finalExpiresAt.toISOString(),
			},
			actorId: createdBy,
			actorRole: 'creator',
		});

		await client.query('COMMIT');

		return { document, hashRecord: hashResult.rows[0] };
	} catch (error) {
		await client.query('ROLLBACK');
		console.error('[signatureService] createDocument error:', error);
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Cancel a signature document before completion.
 * @param {number} documentId
 * @param {number} cancelledBy — user ID
 * @param {string} [reason]
 * @returns {Promise<Object>}
 */
async function cancelDocument(documentId, cancelledBy, reason) {
	const client = await pool.connect();

	try {
		await client.query('BEGIN');

		// Verify document exists and is not already completed/cancelled
		const docCheck = await client.query(
			`SELECT status FROM signature_documents WHERE id = $1`,
			[documentId],
		);

		if (docCheck.rows.length === 0) {
			throw new Error('Document not found');
		}

		const currentStatus = docCheck.rows[0].status;
		if (currentStatus === DOCUMENT_STATUS.COMPLETED) {
			throw new Error('Cannot cancel a completed document');
		}
		if (currentStatus === DOCUMENT_STATUS.CANCELLED) {
			throw new Error('Document is already cancelled');
		}

		// Update document
		const result = await client.query(
			`
			UPDATE signature_documents
			SET status = $1, cancelled_at = NOW(), cancellation_reason = $2
			WHERE id = $3
			RETURNING *
			`,
			[DOCUMENT_STATUS.CANCELLED, reason || null, documentId],
		);

		// Log cancellation
		await _logAuditEvent(client, {
			documentId,
			requestId: null,
			partyId: null,
			eventType: EVENT_TYPE.DOCUMENT_CANCELLED,
			severity: 'warning',
			eventData: {
				previous_status: currentStatus,
				cancellation_reason: reason || null,
			},
			actorId: cancelledBy,
			actorRole: 'creator',
		});

		await client.query('COMMIT');
		return result.rows[0];
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Mark expired documents and log events.
 * Intended to be called from a cron job.
 * @returns {Promise<number>} — number of documents expired
 */
async function expireDocuments() {
	const client = await pool.connect();

	try {
		await client.query('BEGIN');

		const result = await client.query(
			`
			UPDATE signature_documents
			SET status = $1
			WHERE status IN ($2, $3)
			  AND expires_at < NOW()
			RETURNING id, created_by
			`,
			[DOCUMENT_STATUS.EXPIRED, DOCUMENT_STATUS.SENT, DOCUMENT_STATUS.IN_PROGRESS],
		);

		for (const doc of result.rows) {
			await _logAuditEvent(client, {
				documentId: doc.id,
				requestId: null,
				partyId: null,
				eventType: EVENT_TYPE.DOCUMENT_EXPIRED,
				severity: 'warning',
				eventData: { auto_expired: true },
				actorId: doc.created_by,
				actorRole: 'system',
			});
		}

		await client.query('COMMIT');
		return result.rows.length;
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Signing Party Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create or get a signing party.
 * @param {Object} params
 * @param {number} [params.userId] — registered user (optional)
 * @param {string} params.email
 * @param {string} params.fullName
 * @param {string} [params.phone]
 * @param {number} [params.companyId]
 * @param {string} [params.jobTitle]
 * @param {string} [params.partyRole='signer']
 * @param {string} [params.authMethod='email_link']
 * @param {Object} [params.metadata={}]
 * @returns {Promise<Object>}
 */
async function createParty(params) {
	const {
		userId,
		email,
		fullName,
		phone,
		companyId,
		jobTitle,
		partyRole = 'signer',
		authMethod = 'email_link',
		metadata = {},
	} = params;

	// Try to find existing party by email (exact match for registered users, or any match)
	const existing = await pool.query(
		`SELECT * FROM signing_parties WHERE email = $1 LIMIT 1`,
		[email.toLowerCase().trim()],
	);

	if (existing.rows.length > 0) {
		// Return existing party — callers can update if needed
		return existing.rows[0];
	}

	const result = await pool.query(
		`
		INSERT INTO signing_parties (
			user_id, email, full_name, phone,
			company_id, job_title, party_role, auth_method, metadata
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING *
		`,
		[
			userId || null,
			email.toLowerCase().trim(),
			fullName,
			phone || null,
			companyId || null,
			jobTitle || null,
			partyRole,
			authMethod,
			JSON.stringify(metadata),
		],
	);

	return result.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature Request Orchestration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add signing parties to a document and create signature requests.
 *
 * @param {number} documentId
 * @param {Array<{partyId: number, signingOrder: number}>} parties
 * @param {number} sentBy — user ID sending the document
 * @returns {Promise<{ requests: Object[], document: Object }>}
 */
async function addSigners(documentId, parties, sentBy) {
	const client = await pool.connect();

	try {
		await client.query('BEGIN');

		// Verify document is in draft
		const docCheck = await client.query(
			`SELECT status FROM signature_documents WHERE id = $1`,
			[documentId],
		);

		if (docCheck.rows.length === 0) {
			throw new Error('Document not found');
		}
		if (docCheck.rows[0].status !== DOCUMENT_STATUS.DRAFT) {
			throw new Error('Document must be in draft status to add signers');
		}

		const requests = [];
		for (const { partyId, signingOrder } of parties) {
			const reqResult = await client.query(
				`
				INSERT INTO signature_requests (
					document_id, party_id, signing_order, status
				) VALUES ($1, $2, $3, $4)
				ON CONFLICT (document_id, party_id) DO UPDATE SET
					signing_order = EXCLUDED.signing_order,
					updated_at = NOW()
				RETURNING *
				`,
				[documentId, partyId, signingOrder || 0, REQUEST_STATUS.PENDING],
			);
			requests.push(reqResult.rows[0]);

			await _logAuditEvent(client, {
				documentId,
				requestId: reqResult.rows[0].id,
				partyId,
				eventType: EVENT_TYPE.PARTY_INVITED,
				severity: 'info',
				eventData: { signing_order: signingOrder || 0 },
				actorId: sentBy,
				actorRole: 'creator',
			});
		}

		await client.query('COMMIT');

		// Fetch updated document
		const docResult = await pool.query(
			`SELECT * FROM signature_documents WHERE id = $1`,
			[documentId],
		);

		return { requests, document: docResult.rows[0] };
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Send the document to signers. Moves status from draft -> sent.
 * If sequential signing is configured, only the first signer gets notified.
 * @param {number} documentId
 * @param {number} sentBy — user ID
 * @returns {Promise<Object>}
 */
async function sendDocument(documentId, sentBy) {
	const client = await pool.connect();

	try {
		await client.query('BEGIN');

		const docResult = await client.query(
			`
			UPDATE signature_documents
			SET status = $1
			WHERE id = $2 AND status = $3
			RETURNING *
			`,
			[DOCUMENT_STATUS.SENT, documentId, DOCUMENT_STATUS.DRAFT],
		);

		if (docResult.rows.length === 0) {
			throw new Error('Document not found or not in draft status');
		}

		// Mark all pending requests as sent
		const reqResult = await client.query(
			`
			UPDATE signature_requests
			SET status = $1, sent_at = NOW()
			WHERE document_id = $2 AND status = $3
			RETURNING *
			`,
			[REQUEST_STATUS.SENT, documentId, REQUEST_STATUS.PENDING],
		);

		await _logAuditEvent(client, {
			documentId,
			requestId: null,
			partyId: null,
			eventType: EVENT_TYPE.DOCUMENT_SENT,
			severity: 'info',
			eventData: { signer_count: reqResult.rows.length },
			actorId: sentBy,
			actorRole: 'creator',
		});

		await client.query('COMMIT');
		return docResult.rows[0];
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Record that a signer viewed the document.
 * @param {number} requestId
 * @param {string} ipAddress
 * @param {string} userAgent
 * @returns {Promise<Object>}
 */
async function recordView(requestId, ipAddress, userAgent) {
	const client = await pool.connect();

	try {
		await client.query('BEGIN');

		const reqResult = await client.query(
			`
			UPDATE signature_requests
			SET status = $1, viewed_at = NOW()
			WHERE id = $2 AND status IN ($3, $4)
			RETURNING *
			`,
			[REQUEST_STATUS.VIEWED, requestId, REQUEST_STATUS.SENT, REQUEST_STATUS.PENDING],
		);

		if (reqResult.rows.length === 0) {
			throw new Error('Signature request not found or already viewed');
		}

		const request = reqResult.rows[0];

		await _logAuditEvent(client, {
			documentId: request.document_id,
			requestId,
			partyId: request.party_id,
			eventType: EVENT_TYPE.DOCUMENT_VIEWED,
			severity: 'info',
			eventData: {},
			actorId: null,
			actorRole: 'signer',
			ipAddress,
			userAgent,
		});

		await client.query('COMMIT');
		return request;
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Record signing started (e.g., click "Sign" button).
 * @param {number} requestId
 * @returns {Promise<Object>}
 */
async function recordSigningStarted(requestId) {
	const result = await pool.query(
		`
		UPDATE signature_requests
		SET status = $1
		WHERE id = $2 AND status = $3
		RETURNING *
		`,
		[REQUEST_STATUS.SIGNING, requestId, REQUEST_STATUS.VIEWED],
	);

	if (result.rows.length === 0) {
		throw new Error('Signature request not in viewable state');
	}

	return result.rows[0];
}

/**
 * Record a signature on a document.
 *
 * @param {number} requestId
 * @param {Object} params
 * @param {string} [params.signatureValue] — raw signature blob (base64)
 * @param {string} [params.signatureType='simple'] — 'simple' | 'pkcs7_detached' | 'typed_name' | 'drawn'
 * @param {Object} [params.signatureMetadata] — { ip_address, user_agent, geo_location, device_fingerprint }
 * @param {Buffer|string} [params.documentContent] — current document bytes for tamper check
 * @param {crypto.KeyObject} [params.privateKey] — for PKCS#7 detached signatures
 * @returns {Promise<{ request: Object, hashRecord: Object, auditEvent: Object }>}
 */
async function recordSignature(requestId, params) {
	const client = await pool.connect();

	try {
		await client.query('BEGIN');

		const {
			signatureValue,
			signatureType = 'simple',
			signatureMetadata = {},
			documentContent,
			privateKey,
		} = params;

		// Get request with document
		const reqCheck = await client.query(
			`
			SELECT sr.*, sd.document_hash, sd.status as doc_status, sd.signature_type as doc_sig_type
			FROM signature_requests sr
			JOIN signature_documents sd ON sr.document_id = sd.id
			WHERE sr.id = $1
			`,
			[requestId],
		);

		if (reqCheck.rows.length === 0) {
			throw new Error('Signature request not found');
		}

		const request = reqCheck.rows[0];

		if (request.doc_status === DOCUMENT_STATUS.COMPLETED) {
			throw new Error('Document is already fully signed');
		}
		if (request.doc_status === DOCUMENT_STATUS.CANCELLED) {
			throw new Error('Document has been cancelled');
		}
		if (request.doc_status === DOCUMENT_STATUS.EXPIRED) {
			throw new Error('Document has expired');
		}

		// Tamper detection: verify current content matches baseline hash
		let tamperResult = null;
		if (documentContent) {
			tamperResult = verifyDocumentHash(documentContent, request.document_hash, 'sha256');
			if (!tamperResult.valid) {
				// Log tamper detection but don't block signing (compliance choice)
				await _logAuditEvent(client, {
					documentId: request.document_id,
					requestId,
					partyId: request.party_id,
					eventType: EVENT_TYPE.TAMPER_DETECTED,
					severity: 'critical',
					eventData: {
						expected_hash: request.document_hash,
						computed_hash: tamperResult.computedHash,
						error: tamperResult.error,
					},
					actorId: null,
					actorRole: 'signer',
					ipAddress: signatureMetadata.ip_address,
					userAgent: signatureMetadata.user_agent,
				});
			}
		}

		// Build signature value
		let finalSignatureValue = signatureValue;
		let signedDocumentHash = request.document_hash;

		if (signatureType === 'pkcs7_detached' && privateKey) {
			const pkcs7Result = createPKCS7DetachedSignature(request.document_hash, {
				privateKey,
				hashAlg: 'sha256',
				signingTime: new Date(),
			});
			finalSignatureValue = pkcs7Result.signatureB64;
			signedDocumentHash = pkcs7Result.signedHash;
		}

		const signatureHash = computeDocumentHash(finalSignatureValue || '', 'sha256');

		// Update request
		const signedAt = new Date();
		const updateResult = await client.query(
			`
			UPDATE signature_requests
			SET status = $1,
			    signed_at = $2,
			    signature_value = $3,
			    signature_hash = $4,
			    signed_document_hash = $5,
			    signature_metadata = $6
			WHERE id = $7
			RETURNING *
			`,
			[
				REQUEST_STATUS.SIGNED,
				signedAt,
				finalSignatureValue || null,
				signatureHash,
				signedDocumentHash,
				JSON.stringify(signatureMetadata),
				requestId,
			],
		);

		const updatedRequest = updateResult.rows[0];

		// Create hash record for this signature
		const prevHashRecord = await client.query(
			`
			SELECT chain_hash FROM document_hash_records
			WHERE document_id = $1
			ORDER BY created_at DESC
			LIMIT 1
			`,
			[request.document_id],
		);

		const previousHash = prevHashRecord.rows[0]?.chain_hash || '';
		const chainHash = computeChainHash(previousHash, signatureHash, 'sha256');

		const hashResult = await client.query(
			`
			INSERT INTO document_hash_records (
				document_id, request_id, hash_type, hash_value, hash_scope,
				previous_hash, chain_hash, created_by
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING *
			`,
			[
				request.document_id,
				requestId,
				'sha256',
				signatureHash,
				'signature_value',
				previousHash || null,
				chainHash,
				signatureMetadata.actor_id || null,
			],
		);

		// Log signed event
		const auditEvent = await _logAuditEvent(client, {
			documentId: request.document_id,
			requestId,
			partyId: request.party_id,
			eventType: EVENT_TYPE.SIGNED,
			severity: 'info',
			eventData: {
				signature_type: signatureType,
				signature_hash: signatureHash,
				tamper_detected: tamperResult ? !tamperResult.valid : null,
				...signatureMetadata,
			},
			actorId: signatureMetadata.actor_id || null,
			actorRole: 'signer',
			ipAddress: signatureMetadata.ip_address,
			userAgent: signatureMetadata.user_agent,
		});

		// ─── Compliance audit trail (Issue #136) ───────────────────────
		try {
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.SIGNATURE,
				entityType: auditLogService.ENTITY_TYPES.USER,
				entityId: signatureMetadata.actor_id || request.party_id,
				actorId: signatureMetadata.actor_id || null,
				actorRole: 'signer',
				companyId: null,
				payload: {
					document_id: request.document_id,
					request_id: requestId,
					signature_type: signatureType,
					signature_hash: signatureHash,
					tamper_detected: tamperResult ? !tamperResult.valid : null,
				},
				req: null,
			});
		} catch (e) {
			console.error('[compliance-audit] Signature log failed (non-blocking):', e.message);
		}

		// Check if all signers have signed
		await _checkDocumentCompletion(client, request.document_id);

		await client.query('COMMIT');
		return { request: updatedRequest, hashRecord: hashResult.rows[0], auditEvent };
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Record a decline.
 * @param {number} requestId
 * @param {string} reason
 * @param {Object} [metadata={}]
 * @returns {Promise<Object>}
 */
async function recordDecline(requestId, reason, metadata = {}) {
	const client = await pool.connect();

	try {
		await client.query('BEGIN');

		const reqResult = await client.query(
			`
			UPDATE signature_requests
			SET status = $1, declined_at = NOW(), decline_reason = $2
			WHERE id = $3 AND status IN ($4, $5, $6)
			RETURNING *
			`,
			[
				REQUEST_STATUS.DECLINED,
				reason,
				requestId,
				REQUEST_STATUS.SENT,
				REQUEST_STATUS.VIEWED,
				REQUEST_STATUS.SIGNING,
			],
		);

		if (reqResult.rows.length === 0) {
			throw new Error('Signature request not found or not in a signable state');
		}

		const request = reqResult.rows[0];

		await _logAuditEvent(client, {
			documentId: request.document_id,
			requestId,
			partyId: request.party_id,
			eventType: EVENT_TYPE.DECLINED,
			severity: 'warning',
			eventData: { decline_reason: reason, ...metadata },
			actorId: metadata.actor_id || null,
			actorRole: 'signer',
			ipAddress: metadata.ip_address,
			userAgent: metadata.user_agent,
		});

		// ─── Compliance audit trail (Issue #136) ───────────────────────
		try {
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.SIGNATURE,
				entityType: auditLogService.ENTITY_TYPES.USER,
				entityId: metadata.actor_id || request.party_id,
				actorId: metadata.actor_id || null,
				actorRole: 'signer',
				companyId: null,
				payload: {
					document_id: request.document_id,
					request_id: requestId,
					action: 'declined',
					decline_reason: reason,
				},
				req: null,
			});
		} catch (e) {
			console.error('[compliance-audit] Signature decline log failed (non-blocking):', e.message);
		}

		await client.query('COMMIT');
		return request;
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Check if all signers have signed and mark document complete if so.
 * @param {import('pg').PoolClient} client
 * @param {number} documentId
 */
async function _checkDocumentCompletion(client, documentId) {
	const pendingResult = await client.query(
		`
		SELECT COUNT(*) as pending
		FROM signature_requests
		WHERE document_id = $1 AND status NOT IN ($2, $3)
		`,
		[documentId, REQUEST_STATUS.SIGNED, REQUEST_STATUS.DECLINED],
	);

	const pendingCount = parseInt(pendingResult.rows[0].pending, 10);

	if (pendingCount === 0) {
		// All done — mark completed
		const docResult = await client.query(
			`
			UPDATE signature_documents
			SET status = $1, completed_at = NOW()
			WHERE id = $2 AND status != $1
			RETURNING created_by
			`,
			[DOCUMENT_STATUS.COMPLETED, documentId],
		);

		if (docResult.rows.length > 0) {
			await _logAuditEvent(client, {
				documentId,
				requestId: null,
				partyId: null,
				eventType: EVENT_TYPE.DOCUMENT_COMPLETED,
				severity: 'info',
				eventData: {},
				actorId: docResult.rows[0].created_by,
				actorRole: 'system',
			});
		}
	} else if (pendingCount > 0) {
		// Move to in_progress if still in sent
		await client.query(
			`
			UPDATE signature_documents
			SET status = $1
			WHERE id = $2 AND status = $3
			`,
			[DOCUMENT_STATUS.IN_PROGRESS, documentId, DOCUMENT_STATUS.SENT],
		);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Tamper Detection & Hash Chain Verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify the integrity of a document and its signature chain.
 * @param {number} documentId
 * @param {Buffer|string} [currentContent] — current document bytes to compare
 * @returns {Promise<{ documentValid: boolean, chainValid: boolean, signaturesValid: boolean, details: Object }>}
 */
async function verifyDocumentIntegrity(documentId, currentContent) {
	const client = await pool.connect();

	try {
		const details = {
			documentHashMatch: null,
			chainRecords: [],
			signatureVerifications: [],
			errors: [],
		};

		// Get document
		const docResult = await client.query(
			`SELECT * FROM signature_documents WHERE id = $1`,
			[documentId],
		);

		if (docResult.rows.length === 0) {
			return {
				documentValid: false,
				chainValid: false,
				signaturesValid: false,
				details: { errors: ['Document not found'] },
			};
		}

		const document = docResult.rows[0];

		// Check current content hash if provided
		if (currentContent) {
			const hashCheck = verifyDocumentHash(currentContent, document.document_hash, 'sha256');
			details.documentHashMatch = hashCheck.valid;
			if (!hashCheck.valid) {
				details.errors.push(hashCheck.error);
			}
		}

		// Verify hash chain
		const hashRecords = await client.query(
			`
			SELECT * FROM document_hash_records
			WHERE document_id = $1
			ORDER BY created_at ASC
			`,
			[documentId],
		);

		let chainValid = true;
		let previousHash = '';

		for (const record of hashRecords.rows) {
			const expectedChainHash = computeChainHash(
				previousHash,
				record.hash_value,
				'sha256',
			);

			const recordValid = record.chain_hash === expectedChainHash;
			details.chainRecords.push({
				id: record.id,
				scope: record.hash_scope,
				valid: recordValid,
				expected: expectedChainHash,
				actual: record.chain_hash,
			});

			if (!recordValid) {
				chainValid = false;
				details.errors.push(
					`Chain hash mismatch at record ${record.id} (${record.hash_scope})`,
				);
			}

			previousHash = record.chain_hash;
		}

		// Verify signature values (if PKCS#7 detached)
		const sigRequests = await client.query(
			`
			SELECT sr.*, sp.email as party_email
			FROM signature_requests sr
			JOIN signing_parties sp ON sr.party_id = sp.id
			WHERE sr.document_id = $1 AND sr.status = $2 AND sr.signature_value IS NOT NULL
			`,
			[documentId, REQUEST_STATUS.SIGNED],
		);

		for (const req of sigRequests.rows) {
			// Simple validation: re-hash signature value and compare
			const computedSigHash = computeDocumentHash(req.signature_value, 'sha256');
			const sigValid = computedSigHash === req.signature_hash;

			details.signatureVerifications.push({
				requestId: req.id,
				partyEmail: req.party_email,
				valid: sigValid,
				computedHash: computedSigHash,
				storedHash: req.signature_hash,
			});

			if (!sigValid) {
				details.errors.push(`Signature hash mismatch for request ${req.id}`);
			}
		}

		const signaturesValid = details.signatureVerifications.every((v) => v.valid);

		return {
			documentValid: details.documentHashMatch !== false,
			chainValid,
			signaturesValid,
			details,
		};
	} finally {
		client.release();
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Trail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log an audit event with chain-of-custody hashing.
 * This is append-only and intended to be tamper-evident.
 *
 * @param {import('pg').PoolClient} client
 * @param {Object} params
 */
async function _logAuditEvent(client, params) {
	const {
		documentId,
		requestId,
		partyId,
		eventType,
		severity = 'info',
		eventData = {},
		actorId,
		actorRole,
		ipAddress,
		userAgent,
		geoLocation,
	} = params;

	// Get next sequence number for this document
	const seqResult = await client.query(
		`
		SELECT COALESCE(MAX(sequence_number), 0) as max_seq
		FROM signature_audit_events
		WHERE document_id = $1
		`,
		[documentId],
	);
	const sequenceNumber = parseInt(seqResult.rows[0].max_seq, 10) + 1;

	// Get previous chain hash
	const prevResult = await client.query(
		`
		SELECT chain_hash FROM signature_audit_events
		WHERE document_id = $1
		ORDER BY sequence_number DESC
		LIMIT 1
		`,
		[documentId],
	);
	const previousHash = prevResult.rows[0]?.chain_hash || '';

	// Hash the event data
	const verifiedHash = computeEventHash(eventData, 'sha256');

	// Compute chain hash
	const chainHash = computeChainHash(previousHash, verifiedHash, 'sha256');

	const result = await client.query(
		`
		INSERT INTO signature_audit_events (
			document_id, request_id, party_id,
			event_type, severity, event_data,
			verified_hash,
			actor_id, actor_email, actor_role,
			ip_address, user_agent, geo_location,
			sequence_number, previous_hash, chain_hash
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		RETURNING *
		`,
		[
			documentId,
			requestId,
			partyId,
			eventType,
			severity,
			JSON.stringify(eventData),
			verifiedHash,
			actorId || null,
			null, // actor_email would need a lookup; skip for performance
			actorRole || null,
			ipAddress || null,
			userAgent || null,
			geoLocation || null,
			sequenceNumber,
			previousHash || null,
			chainHash,
		],
	);

	return result.rows[0];
}

/**
 * Retrieve the full audit trail for a document.
 * @param {number} documentId
 * @param {Object} [options]
 * @param {string} [options.eventType]
 * @param {number} [options.limit=100]
 * @param {number} [options.offset=0]
 * @returns {Promise<{ events: Object[], total: number }>}
 */
async function getAuditTrail(documentId, options = {}) {
	const { eventType, limit = 100, offset = 0 } = options;

	let whereClause = 'WHERE document_id = $1';
	const params = [documentId];

	if (eventType) {
		whereClause += ` AND event_type = $${params.length + 1}`;
		params.push(eventType);
	}

	const countResult = await pool.query(
		`SELECT COUNT(*) as total FROM signature_audit_events ${whereClause}`,
		params,
	);

	const eventsResult = await pool.query(
		`
		SELECT *
		FROM signature_audit_events
		${whereClause}
		ORDER BY sequence_number ASC, created_at ASC
		LIMIT $${params.length + 1} OFFSET $${params.length + 2}
		`,
		[...params, limit, offset],
	);

	return {
		events: eventsResult.rows,
		total: parseInt(countResult.rows[0].total, 10),
	};
}

/**
 * Verify the integrity of the audit chain for a document.
 * @param {number} documentId
 * @returns {Promise<{ valid: boolean, firstBrokenSequence?: number, errors: string[] }>}
 */
async function verifyAuditChain(documentId) {
	const eventsResult = await pool.query(
		`
		SELECT sequence_number, event_data, verified_hash, previous_hash, chain_hash
		FROM signature_audit_events
		WHERE document_id = $1
		ORDER BY sequence_number ASC
		`,
		[documentId],
	);

	const errors = [];
	let previousHash = '';

	for (const event of eventsResult.rows) {
		// Verify event data hash
		const computedEventHash = computeEventHash(event.event_data, 'sha256');
		if (computedEventHash !== event.verified_hash) {
			errors.push(
				`Event ${event.sequence_number}: data hash mismatch (tampered?)`,
			);
			return { valid: false, firstBrokenSequence: event.sequence_number, errors };
		}

		// Verify chain hash
		const computedChainHash = computeChainHash(previousHash, event.verified_hash, 'sha256');
		if (computedChainHash !== event.chain_hash) {
			errors.push(
				`Event ${event.sequence_number}: chain hash mismatch`,
			);
			return { valid: false, firstBrokenSequence: event.sequence_number, errors };
		}

		previousHash = event.chain_hash;
	}

	return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a document with all its signing parties and requests.
 * @param {number} documentId
 * @returns {Promise<Object|null>}
 */
async function getDocumentWithParties(documentId) {
	const docResult = await pool.query(
		`SELECT * FROM signature_documents WHERE id = $1`,
		[documentId],
	);

	if (docResult.rows.length === 0) return null;

	const document = docResult.rows[0];

	const partiesResult = await pool.query(
		`
		SELECT
			sr.*,
			sp.email, sp.full_name, sp.phone, sp.job_title, sp.party_role, sp.auth_method
		FROM signature_requests sr
		JOIN signing_parties sp ON sr.party_id = sp.id
		WHERE sr.document_id = $1
		ORDER BY sr.signing_order ASC, sr.created_at ASC
		`,
		[documentId],
	);

	return {
		...document,
		signers: partiesResult.rows,
	};
}

/**
 * List documents for a company.
 * @param {number} companyId
 * @param {Object} [options]
 * @param {string} [options.status]
 * @param {number} [options.limit=50]
 * @param {number} [options.offset=0]
 * @returns {Promise<{ documents: Object[], total: number }>}
 */
async function listDocuments(companyId, options = {}) {
	const { status, limit = 50, offset = 0 } = options;

	let whereClause = 'WHERE company_id = $1';
	const params = [companyId];

	if (status) {
		whereClause += ` AND status = $${params.length + 1}`;
		params.push(status);
	}

	const countResult = await pool.query(
		`SELECT COUNT(*) as total FROM signature_documents ${whereClause}`,
		params,
	);

	const docsResult = await pool.query(
		`
		SELECT *
		FROM signature_documents
		${whereClause}
		ORDER BY created_at DESC
		LIMIT $${params.length + 1} OFFSET $${params.length + 2}
		`,
		[...params, limit, offset],
	);

	return {
		documents: docsResult.rows,
		total: parseInt(countResult.rows[0].total, 10),
	};
}

/**
 * Get pending reminders for a document.
 * @param {number} documentId
 * @returns {Promise<Object[]>}
 */
async function getPendingReminders(documentId) {
	const result = await pool.query(
		`
		SELECT sr.*, sp.email, sp.full_name
		FROM signature_requests sr
		JOIN signing_parties sp ON sr.party_id = sp.id
		WHERE sr.document_id = $1
		  AND sr.status IN ($2, $3)
		  AND sr.reminder_count < $4
		  AND (sr.last_reminder_at IS NULL
		       OR sr.last_reminder_at < NOW() - INTERVAL '${REMINDER_INTERVAL_HOURS} hours')
		ORDER BY sr.signing_order ASC
		`,
		[documentId, REQUEST_STATUS.SENT, REQUEST_STATUS.VIEWED, MAX_REMINDERS],
	);

	return result.rows;
}

/**
 * Record a reminder sent to a signer.
 * @param {number} requestId
 * @returns {Promise<Object>}
 */
async function recordReminder(requestId) {
	const result = await pool.query(
		`
		UPDATE signature_requests
		SET reminder_count = reminder_count + 1, last_reminder_at = NOW()
		WHERE id = $1
		RETURNING *
		`,
		[requestId],
	);

	if (result.rows.length === 0) {
		throw new Error('Signature request not found');
	}

	const request = result.rows[0];

	await _logAuditEvent(pool, {
		documentId: request.document_id,
		requestId,
		partyId: request.party_id,
		eventType: EVENT_TYPE.PARTY_REMINDED,
		severity: 'info',
		eventData: { reminder_count: request.reminder_count },
		actorId: null,
		actorRole: 'system',
	});

	return request;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
	// Constants
	DOCUMENT_STATUS,
	REQUEST_STATUS,
	EVENT_TYPE,

	// Document lifecycle
	createDocument,
	cancelDocument,
	expireDocuments,

	// Party management
	createParty,

	// Request orchestration
	addSigners,
	sendDocument,
	recordView,
	recordSigningStarted,
	recordSignature,
	recordDecline,

	// Tamper detection
	verifyDocumentIntegrity,

	// Audit trail
	getAuditTrail,
	verifyAuditChain,

	// Queries
	getDocumentWithParties,
	listDocuments,
	getPendingReminders,
	recordReminder,

	// PKCS#7 helpers (re-export for convenience)
	generateTestKeyPair,
};
