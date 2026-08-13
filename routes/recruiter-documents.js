/**
 * Recruiter Document View Routes
 * Mounted at /api/recruiter/candidates/:candidateId/documents
 *
 * Recruiters can view (but not modify) documents belonging to candidates
 * who have applied to jobs at their company.
 *
 * Security rules:
 * - Never expose raw file_url — use authenticated download endpoint
 * - Log every recruiter access to document_access_logs
 * - Verify company relationship via job_applications
 */

const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { logDocumentAccess } = require('../services/document-verification');

const router = express.Router({ mergeParams: true });

/**
 * Middleware: verify the requesting user is a recruiter/hiring_manager/admin
 * and that the candidate has applied to a job at the recruiter's company.
 */
async function verifyCompanyAccess(req, res, next) {
  const userRole = req.user.role;
  const userCompanyId = req.user.company_id;
  const candidateId = parseInt(req.params.candidateId, 10);

  const recruiterRoles = ['recruiter', 'hiring_manager', 'employer', 'admin'];
  if (!recruiterRoles.includes(userRole)) {
    return res.status(403).json({ error: 'Recruiter access required' });
  }

  if (!userCompanyId) {
    return res.status(403).json({ error: 'No company associated with account' });
  }

  // Verify candidate applied to a job at this company
  const relationResult = await pool.query(
    `
    SELECT 1 FROM job_applications a
    JOIN jobs j ON a.job_id = j.id
    WHERE a.candidate_id = $1 AND j.company_id = $2
    LIMIT 1
  `,
    [candidateId, userCompanyId],
  );

  if (relationResult.rows.length === 0) {
    return res.status(403).json({ error: 'No application relationship with this candidate' });
  }

  next();
}

// ════════════════════════════════════════════════════════════════════════
// GET /api/recruiter/candidates/:candidateId/documents — list documents
// ════════════════════════════════════════════════════════════════════════
router.get('/', authMiddleware, async (req, res) => {
  try {
    const candidateId = parseInt(req.params.candidateId, 10);
    const userId = req.user.id;
    const userCompanyId = req.user.company_id;

    // Verify access
    await verifyCompanyAccess(req, res, () => {});
    if (res.headersSent) return;

    const result = await pool.query(
      `
      SELECT
        vd.id,
        vd.document_type,
        vd.original_filename AS name,
        vd.file_size AS size,
        vd.mime_type,
        vd.status,
        vd.uploaded_at,
        vd.processed_at,
        vd.extracted_text,
        vd.authenticity_score,
        dv.authenticity_score AS verification_score,
        dv.fraud_risk,
        dv.is_duplicate,
        dv.confidence_score,
        dv.verified_at,
        vc.credential_name,
        vc.issuer,
        vc.verification_status AS credential_status
      FROM verification_documents vd
      LEFT JOIN document_verifications dv ON vd.id = dv.document_id
      LEFT JOIN verified_credentials vc ON vc.document_id = vd.id
      WHERE vd.user_id = $1
      ORDER BY vd.created_at DESC
    `,
      [candidateId],
    );

    // Strip raw R2 URLs and encryption metadata
    const documents = result.rows.map((row) => {
      const { file_url, encryption_iv, encryption_tag, encryption_algorithm, ...doc } = row;
      return doc;
    });

    // Log recruiter access
    if (documents.length > 0) {
      for (const doc of documents) {
        await logDocumentAccess(doc.id, userId, 'recruiter_list', userCompanyId, req.ip);
      }
    }

    res.json({ success: true, documents });
  } catch (error) {
    console.error('[recruiter-documents] List error:', error);
    res.status(500).json({ error: 'Failed to retrieve documents' });
  }
});

// ════════════════════════════════════════════════════════════════════════
// GET /api/recruiter/candidates/:candidateId/documents/:id — view details
// ════════════════════════════════════════════════════════════════════════
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const candidateId = parseInt(req.params.candidateId, 10);
    const userId = req.user.id;
    const userCompanyId = req.user.company_id;

    // Verify access
    await verifyCompanyAccess(req, res, () => {});
    if (res.headersSent) return;

    const result = await pool.query(
      `
      SELECT
        vd.id,
        vd.document_type,
        vd.original_filename AS name,
        vd.file_size AS size,
        vd.mime_type,
        vd.status,
        vd.uploaded_at,
        vd.created_at,
        vd.updated_at,
        vd.processed_at,
        vd.extracted_text,
        vd.authenticity_score,
        vd.fraud_flags,
        vd.verification_details,
        dv.authenticity_score AS verification_score,
        dv.fraud_risk,
        dv.fraud_indicators,
        dv.inconsistencies_found,
        dv.is_duplicate,
        dv.confidence_score,
        dv.verified_at,
        vc.credential_name,
        vc.issuer,
        vc.verification_status AS credential_status
      FROM verification_documents vd
      LEFT JOIN document_verifications dv ON vd.id = dv.document_id
      LEFT JOIN verified_credentials vc ON vc.document_id = vd.id
      WHERE vd.id = $1 AND vd.user_id = $2
    `,
      [id, candidateId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Strip sensitive fields
    const { file_url, encryption_iv, encryption_tag, encryption_algorithm, ...doc } = result.rows[0];

    // Log access
    await logDocumentAccess(id, userId, 'recruiter_view', userCompanyId, req.ip);

    res.json({ success: true, document: doc });
  } catch (error) {
    console.error('[recruiter-documents] Get details error:', error);
    res.status(500).json({ error: 'Failed to retrieve document' });
  }
});

// ════════════════════════════════════════════════════════════════════════
// GET /api/recruiter/candidates/:candidateId/documents/:id/verification
// ════════════════════════════════════════════════════════════════════════
router.get('/:id/verification', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const candidateId = parseInt(req.params.candidateId, 10);
    const userId = req.user.id;
    const userCompanyId = req.user.company_id;

    // Verify access
    await verifyCompanyAccess(req, res, () => {});
    if (res.headersSent) return;

    // Verify document belongs to candidate
    const docResult = await pool.query(
      `SELECT id FROM verification_documents WHERE id = $1 AND user_id = $2`,
      [id, candidateId],
    );
    if (docResult.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const result = await pool.query(
      `
      SELECT
        dv.*,
        vd.document_type,
        vd.status AS document_status,
        dsi.score_impact,
        dsi.applied_to_omniscore
      FROM document_verifications dv
      JOIN verification_documents vd ON dv.document_id = vd.id
      LEFT JOIN document_score_impacts dsi ON dsi.document_id = vd.id
      WHERE dv.document_id = $1
    `,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Verification not found' });
    }

    // Log access
    await logDocumentAccess(id, userId, 'recruiter_verification', userCompanyId, req.ip);

    res.json({ success: true, verification: result.rows[0] });
  } catch (error) {
    console.error('[recruiter-documents] Verification error:', error);
    res.status(500).json({ error: 'Failed to retrieve verification status' });
  }
});

module.exports = router;
