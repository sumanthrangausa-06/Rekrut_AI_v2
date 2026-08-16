const express = require('express');
const multer = require('multer');
const path = require('node:path');
const pool = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const { encryptToFile, deleteEncryptedFile } = require('../services/encryption');
const auditLogService = require('../services/auditLogService');
const { AuditLogger } = auditLogService;
const { dataAccessAudit } = require('../middleware/dataAccessAudit');
const { VERIFICATION_CONFIG } = require('../lib/verification-config');
const { distributedRateLimiter } = require('../lib/distributed-rate-limiter');

const router = express.Router();

// In-memory upload (encrypt before writing to disk — never store raw)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VERIFICATION_CONFIG.MAX_FILE_SIZE_BYTES },
});

/**
 * Helper: log verification audit entry
 */
async function logVerificationAction(verificationId, actorId, actorType, action, metadata, req) {
  try {
    await pool.query(
      `INSERT INTO verification_audit_log
       (verification_id, actor_id, actor_type, action, metadata, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        verificationId,
        actorId,
        actorType,
        action,
        JSON.stringify(metadata || {}),
        req.ip || req.connection?.remoteAddress || null,
      ],
    );
  } catch (err) {
    console.error('[verification-audit] Failed to log action:', err.message);
    // Non-fatal: audit logging must not break core functionality
  }
}

/**
 * Helper: check if a user can access a candidate's verification data
 * - Candidates can only access their own
 * - Recruiters can view status only (enforced in route, not here)
 * - Admins can access any
 */
function canAccessCandidate(req, candidateId) {
  if (!req.user) return false;
  if (req.user.role === 'admin') return true;
  if (req.user.id === parseInt(candidateId, 10)) return true;
  return false;
}

/**
 * Helper: get client IP for rate limiting
 */
function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

// ════════════════════════════════════════════════════════════════════════
// POST /api/candidates/:id/verification/upload
// Upload ID document + selfie for identity verification
// ════════════════════════════════════════════════════════════════════════

router.post(
  '/:id/verification/upload',
  authMiddleware,
  upload.fields([
    { name: 'id_document', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ]),
  async (req, res) => {
    const candidateId = parseInt(req.params.id, 10);

    try {
      // ─── Authorization ─────────────────────────────────────────────
      if (!canAccessCandidate(req, candidateId)) {
        return res.status(403).json({ error: 'You can only upload verification documents for yourself' });
      }

      // ─── Rate Limiting: 5 uploads per hour per candidate ───────────
      const rateLimitKey = `verification_upload:candidate_${candidateId}`;
      const rateCheck = await distributedRateLimiter.checkLimit(
        rateLimitKey,
        VERIFICATION_CONFIG.UPLOAD_RATE_LIMIT_WINDOW_MS,
        VERIFICATION_CONFIG.UPLOAD_RATE_LIMIT_MAX,
      );
      if (!rateCheck.allowed) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((rateCheck.resetAt - Date.now()) / 1000),
          limit: VERIFICATION_CONFIG.UPLOAD_RATE_LIMIT_MAX,
          window: '1 hour',
        });
      }

      // ─── File validation ───────────────────────────────────────────
      const idDoc = req.files?.id_document?.[0];
      const selfie = req.files?.selfie?.[0];

      if (!idDoc) {
        return res.status(400).json({ error: 'ID document is required' });
      }
      if (!selfie) {
        return res.status(400).json({ error: 'Selfie is required' });
      }

      // Validate ID document type
      const idExt = path.extname(idDoc.originalname).toLowerCase();
      const idMime = idDoc.mimetype;
      if (
        !VERIFICATION_CONFIG.ALLOWED_ID_DOCUMENT_TYPES.includes(idMime) &&
        !VERIFICATION_CONFIG.ALLOWED_ID_EXTENSIONS.includes(idExt)
      ) {
        return res.status(400).json({
          error: `ID document type not allowed. Allowed: ${VERIFICATION_CONFIG.ALLOWED_ID_EXTENSIONS.join(', ')}`,
        });
      }

      // Validate selfie type
      const selfieExt = path.extname(selfie.originalname).toLowerCase();
      const selfieMime = selfie.mimetype;
      if (
        !VERIFICATION_CONFIG.ALLOWED_SELFIE_TYPES.includes(selfieMime) &&
        !VERIFICATION_CONFIG.ALLOWED_SELFIE_EXTENSIONS.includes(selfieExt)
      ) {
        return res.status(400).json({
          error: `Selfie type not allowed. Allowed: ${VERIFICATION_CONFIG.ALLOWED_SELFIE_EXTENSIONS.join(', ')}`,
        });
      }

      // Validate file sizes (multer limits should catch this, but double-check)
      if (idDoc.size > VERIFICATION_CONFIG.MAX_FILE_SIZE_BYTES) {
        return res.status(400).json({
          error: `ID document exceeds ${VERIFICATION_CONFIG.MAX_FILE_SIZE_MB}MB limit`,
        });
      }
      if (selfie.size > VERIFICATION_CONFIG.MAX_FILE_SIZE_BYTES) {
        return res.status(400).json({
          error: `Selfie exceeds ${VERIFICATION_CONFIG.MAX_FILE_SIZE_MB}MB limit`,
        });
      }

      // ─── Detect document type from filename / form field ───────────
      let idDocumentType = req.body.id_document_type || 'other';
      if (!Object.values(VERIFICATION_CONFIG.ID_DOCUMENT_TYPES).includes(idDocumentType)) {
        idDocumentType = VERIFICATION_CONFIG.ID_DOCUMENT_TYPES.OTHER;
      }

      // ─── Encrypt files immediately ─────────────────────────────────
      let idDocPath;
      let selfiePath;
      try {
        idDocPath = encryptToFile(idDoc.buffer, VERIFICATION_CONFIG.STORAGE_BASE_DIR, '.enc');
        selfiePath = encryptToFile(selfie.buffer, VERIFICATION_CONFIG.STORAGE_BASE_DIR, '.enc');
      } catch (encryptErr) {
        // Cleanup partial writes on failure
        if (idDocPath) {
          try { deleteEncryptedFile(idDocPath, VERIFICATION_CONFIG.STORAGE_BASE_DIR); } catch (_e) {}
        }
        console.error('[verification] Encryption failed:', encryptErr.message);
        return res.status(500).json({ error: 'Failed to secure uploaded files' });
      }

      // ─── Create verification request in DB ─────────────────────────
      const client = await pool.connect();
      let verification;
      try {
        await client.query('BEGIN');

        // Check for existing active/pending verification for this candidate
        const existing = await client.query(
          `SELECT id, status FROM verification_requests
           WHERE candidate_id = $1 AND status NOT IN ('approved', 'rejected')
           ORDER BY created_at DESC LIMIT 1`,
          [candidateId],
        );

        if (existing.rows.length > 0) {
          // Update existing pending request instead of creating duplicate
          const existingId = existing.rows[0].id;
          const oldIdPath = (await client.query(
            'SELECT id_document_encrypted_url, selfie_encrypted_url FROM verification_requests WHERE id = $1',
            [existingId],
          )).rows[0];

          // Delete old encrypted files
          if (oldIdPath?.id_document_encrypted_url) {
            try { deleteEncryptedFile(oldIdPath.id_document_encrypted_url, VERIFICATION_CONFIG.STORAGE_BASE_DIR); } catch (_e) {}
          }
          if (oldIdPath?.selfie_encrypted_url) {
            try { deleteEncryptedFile(oldIdPath.selfie_encrypted_url, VERIFICATION_CONFIG.STORAGE_BASE_DIR); } catch (_e) {}
          }

          const updateResult = await client.query(
            `UPDATE verification_requests SET
              status = 'pending',
              id_document_type = $2,
              id_document_encrypted_url = $3,
              selfie_encrypted_url = $4,
              extracted_data = '{}',
              confidence_score = NULL,
              failure_reason = NULL,
              reviewed_by = NULL,
              updated_at = NOW(),
              expires_at = NOW() + INTERVAL '${VERIFICATION_CONFIG.DEFAULT_RETENTION_DAYS} days'
             WHERE id = $1
             RETURNING *`,
            [existingId, idDocumentType, idDocPath, selfiePath],
          );
          verification = updateResult.rows[0];
        } else {
          const insertResult = await client.query(
            `INSERT INTO verification_requests
             (candidate_id, status, id_document_type, id_document_encrypted_url, selfie_encrypted_url, expires_at)
             VALUES ($1, 'pending', $2, $3, $4, NOW() + INTERVAL '${VERIFICATION_CONFIG.DEFAULT_RETENTION_DAYS} days')
             RETURNING *`,
            [candidateId, idDocumentType, idDocPath, selfiePath],
          );
          verification = insertResult.rows[0];
        }

        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        // Cleanup encrypted files on DB failure
        try { deleteEncryptedFile(idDocPath, VERIFICATION_CONFIG.STORAGE_BASE_DIR); } catch (_e) {}
        try { deleteEncryptedFile(selfiePath, VERIFICATION_CONFIG.STORAGE_BASE_DIR); } catch (_e) {}
        throw dbErr;
      } finally {
        client.release();
      }

      // ─── Audit log ─────────────────────────────────────────────────
      await logVerificationAction(
        verification.id,
        req.user.id,
        VERIFICATION_CONFIG.ACTOR_TYPES.CANDIDATE,
        VERIFICATION_CONFIG.ACTIONS.UPLOAD,
        {
          id_document_type: idDocumentType,
          id_document_size: idDoc.size,
          selfie_size: selfie.size,
          id_document_mime: idDoc.mimetype,
          selfie_mime: selfie.mimetype,
          rate_limit_remaining: rateCheck.remaining,
        },
        req,
      );

      // ─── Also log to general audit_logs for compliance ─────────────
      await AuditLogger.log({
        actionType: 'verification_uploaded',
        userId: req.user.id,
        targetType: 'verification_request',
        targetId: verification.id,
        metadata: {
          candidate_id: candidateId,
          id_document_type: idDocumentType,
          id_document_size: idDoc.size,
          selfie_size: selfie.size,
        },
        req,
      });

      // Return verification ID (never raw image URLs)
      res.status(201).json({
        success: true,
        verification_id: verification.id,
        status: verification.status,
        message: 'Identity verification documents uploaded successfully',
      });

    } catch (err) {
      console.error('[verification-upload] Error:', err.message);
      res.status(500).json({ error: 'Failed to process verification upload' });
    }
  },
);

// ════════════════════════════════════════════════════════════════════════
// GET /api/candidates/:id/verification/status
// Get current verification status — RECRUITER-SAFE (no raw images)
// ════════════════════════════════════════════════════════════════════════

router.get('/:id/verification/status', authMiddleware, dataAccessAudit('verification_status', (req) => parseInt(req.params.id, 10)), async (req, res) => {
  const candidateId = parseInt(req.params.id, 10);

  try {
    // ─── Authorization ─────────────────────────────────────────────
    const isSelf = req.user.id === candidateId;
    const isRecruiter = req.user.role === 'recruiter';
    const isAdmin = req.user.role === 'admin';

    if (!isSelf && !isRecruiter && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // ─── Fetch latest verification ─────────────────────────────────
    const result = await pool.query(
      `SELECT id, candidate_id, status, id_document_type, confidence_score,
              failure_reason, reviewed_by, created_at, updated_at, expires_at
       FROM verification_requests
       WHERE candidate_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [candidateId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'No verification request found',
        status: null,
      });
    }

    const verification = result.rows[0];

    // ─── Security: NEVER expose raw image URLs ─────────────────────
    // Recruiters and admins see status summary only
    // Candidates see their own status (but still never the encrypted paths)
    const response = {
      verification_id: verification.id,
      candidate_id: verification.candidate_id,
      status: verification.status,
      id_document_type: verification.id_document_type,
      confidence_score: verification.confidence_score,
      failure_reason: verification.failure_reason,
      created_at: verification.created_at,
      updated_at: verification.updated_at,
      expires_at: verification.expires_at,
    };

    // Only admins get reviewer info
    if (!isAdmin) {
      delete response.reviewed_by;
    }

    // ─── Audit log: every view is logged ───────────────────────────
    const actorType = isAdmin
      ? VERIFICATION_CONFIG.ACTOR_TYPES.ADMIN
      : isRecruiter
        ? VERIFICATION_CONFIG.ACTOR_TYPES.RECRUITER
        : VERIFICATION_CONFIG.ACTOR_TYPES.CANDIDATE;

    await logVerificationAction(
      verification.id,
      req.user.id,
      actorType,
      VERIFICATION_CONFIG.ACTIONS.VIEW,
      { role: req.user.role },
      req,
    );

    res.json({
      success: true,
      verification: response,
    });

  } catch (err) {
    console.error('[verification-status] Error:', err.message);
    res.status(500).json({ error: 'Failed to get verification status' });
  }
});

// ════════════════════════════════════════════════════════════════════════
// GET /api/candidates/:id/verification/history
// Get full verification history with audit trail (candidate + admin only)
// ════════════════════════════════════════════════════════════════════════

router.get('/:id/verification/history', authMiddleware, async (req, res) => {
  const candidateId = parseInt(req.params.id, 10);

  try {
    // ─── Authorization ─────────────────────────────────────────────
    const isSelf = req.user.id === candidateId;
    const isAdmin = req.user.role === 'admin';

    if (!isSelf && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // ─── Fetch all verifications for candidate ─────────────────────
    const verificationsResult = await pool.query(
      `SELECT id, candidate_id, status, id_document_type, confidence_score,
              failure_reason, reviewed_by, created_at, updated_at, expires_at
       FROM verification_requests
       WHERE candidate_id = $1
       ORDER BY created_at DESC`,
      [candidateId],
    );

    if (verificationsResult.rows.length === 0) {
      return res.status(404).json({ error: 'No verification history found' });
    }

    // ─── Fetch audit log for these verifications ───────────────────
    const verificationIds = verificationsResult.rows.map((v) => v.id);
    const auditResult = await pool.query(
      `SELECT id, verification_id, actor_id, actor_type, action, metadata, ip_address, created_at
       FROM verification_audit_log
       WHERE verification_id = ANY($1)
       ORDER BY created_at DESC`,
      [verificationIds],
    );

    // Group audit log by verification_id
    const auditByVerification = {};
    for (const log of auditResult.rows) {
      if (!auditByVerification[log.verification_id]) {
        auditByVerification[log.verification_id] = [];
      }
      auditByVerification[log.verification_id].push(log);
    }

    const history = verificationsResult.rows.map((v) => ({
      verification_id: v.id,
      status: v.status,
      id_document_type: v.id_document_type,
      confidence_score: v.confidence_score,
      failure_reason: v.failure_reason,
      created_at: v.created_at,
      updated_at: v.updated_at,
      expires_at: v.expires_at,
      audit_log: auditByVerification[v.id] || [],
    }));

    res.json({
      success: true,
      history,
    });

  } catch (err) {
    console.error('[verification-history] Error:', err.message);
    res.status(500).json({ error: 'Failed to get verification history' });
  }
});

// ════════════════════════════════════════════════════════════════════════
// POST /api/candidates/:id/verification/review (admin only)
// Approve or reject a verification after manual review
// ════════════════════════════════════════════════════════════════════════

router.post(
  '/:id/verification/review',
  authMiddleware,
  requireRole('admin'),
  async (req, res) => {
    const candidateId = parseInt(req.params.id, 10);
    const { verification_id, decision, reason } = req.body;

    if (!verification_id) {
      return res.status(400).json({ error: 'verification_id is required' });
    }
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify the verification exists and belongs to the candidate
      const verifyResult = await client.query(
        `SELECT id, status FROM verification_requests
         WHERE id = $1 AND candidate_id = $2`,
        [verification_id, candidateId],
      );

      if (verifyResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Verification request not found' });
      }

      const currentStatus = verifyResult.rows[0].status;
      if (currentStatus === 'approved' || currentStatus === 'rejected') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Verification already ${currentStatus}` });
      }

      const newStatus = decision === 'approved' ? 'approved' : 'rejected';
      await client.query(
        `UPDATE verification_requests SET
          status = $3,
          reviewed_by = $4,
          failure_reason = COALESCE($5, failure_reason),
          updated_at = NOW()
         WHERE id = $1 AND candidate_id = $2`,
        [verification_id, candidateId, newStatus, req.user.id, reason || null],
      );

      await client.query('COMMIT');

      // ─── Audit log ─────────────────────────────────────────────────
      await logVerificationAction(
        verification_id,
        req.user.id,
        VERIFICATION_CONFIG.ACTOR_TYPES.ADMIN,
        decision === 'approved' ? VERIFICATION_CONFIG.ACTIONS.APPROVE : VERIFICATION_CONFIG.ACTIONS.REJECT,
        { reason: reason || null, previous_status: currentStatus },
        req,
      );

      // ─── Compliance audit trail (Issue #136) ───────────────────────
      try {
        await auditLogService.logEvent({
          eventType: auditLogService.EVENT_TYPES.VERIFICATION,
          entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
          entityId: candidateId,
          actorId: req.user.id,
          actorRole: req.user.role,
          companyId: null,
          payload: {
            verification_id,
            decision: newStatus,
            previous_status: currentStatus,
            reason: reason || null,
          },
          req,
        });
      } catch (e) {
        console.error('[compliance-audit] Verification log failed (non-blocking):', e.message);
      }

      res.json({
        success: true,
        verification_id,
        status: newStatus,
        reviewed_by: req.user.id,
      });

    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[verification-review] Error:', err.message);
      res.status(500).json({ error: 'Failed to review verification' });
    } finally {
      client.release();
    }
  },
);

// ════════════════════════════════════════════════════════════════════════
// DELETE /api/candidates/:id/verification/:verificationId (admin only)
// Hard delete a verification request and its encrypted files
// ════════════════════════════════════════════════════════════════════════

router.delete(
  '/:id/verification/:verificationId',
  authMiddleware,
  requireRole('admin'),
  async (req, res) => {
    const candidateId = parseInt(req.params.id, 10);
    const verificationId = parseInt(req.params.verificationId, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get encrypted file paths before deleting
      const fileResult = await client.query(
        `SELECT id_document_encrypted_url, selfie_encrypted_url
         FROM verification_requests
         WHERE id = $1 AND candidate_id = $2`,
        [verificationId, candidateId],
      );

      if (fileResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Verification request not found' });
      }

      const { id_document_encrypted_url, selfie_encrypted_url } = fileResult.rows[0];

      // Delete encrypted files from disk
      if (id_document_encrypted_url) {
        try { deleteEncryptedFile(id_document_encrypted_url, VERIFICATION_CONFIG.STORAGE_BASE_DIR); } catch (_e) {}
      }
      if (selfie_encrypted_url) {
        try { deleteEncryptedFile(selfie_encrypted_url, VERIFICATION_CONFIG.STORAGE_BASE_DIR); } catch (_e) {}
      }

      // Delete verification request (cascades to audit_log via FK)
      await client.query(
        'DELETE FROM verification_requests WHERE id = $1 AND candidate_id = $2',
        [verificationId, candidateId],
      );

      await client.query('COMMIT');

      // ─── Audit log (outside transaction — non-blocking) ────────────
      await logVerificationAction(
        verificationId,
        req.user.id,
        VERIFICATION_CONFIG.ACTOR_TYPES.ADMIN,
        VERIFICATION_CONFIG.ACTIONS.DELETE,
        { candidate_id: candidateId },
        req,
      );

      res.json({
        success: true,
        message: 'Verification request deleted',
        verification_id: verificationId,
      });

    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[verification-delete] Error:', err.message);
      res.status(500).json({ error: 'Failed to delete verification' });
    } finally {
      client.release();
    }
  },
);

module.exports = router;
