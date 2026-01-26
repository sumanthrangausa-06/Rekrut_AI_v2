const express = require('express');
const router = express.Router();
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
const pool = require('../lib/db');
const {
  verifyDocument,
  applyDocumentScoresToOmniScore,
  logDocumentAccess
} = require('../services/document-verification');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, images, and Word documents allowed.'));
    }
  }
});

/**
 * Upload and verify a document
 * POST /api/documents/upload
 */
router.post('/upload', upload.single('document'), async (req, res) => {
  try {
    const { document_type } = req.body;
    const userId = req.session?.user?.id || req.body.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!document_type) {
      return res.status(400).json({ error: 'Document type required' });
    }

    const validTypes = ['resume', 'education_certificate', 'employment_letter', 'id_document', 'certification', 'reference_letter'];
    if (!validTypes.includes(document_type)) {
      return res.status(400).json({ error: 'Invalid document type' });
    }

    // Upload to R2
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    const uploadRes = await fetch('https://polsia.com/api/proxy/r2/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    const uploadResult = await uploadRes.json();
    if (!uploadResult.success) {
      throw new Error(uploadResult.error?.message || 'File upload failed');
    }

    const fileUrl = uploadResult.file.url;

    // Create document record
    const result = await pool.query(`
      INSERT INTO verification_documents (
        user_id, document_type, original_filename, file_url,
        file_size, mime_type, status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING *
    `, [
      userId,
      document_type,
      req.file.originalname,
      fileUrl,
      req.file.size,
      req.file.mimetype
    ]);

    const document = result.rows[0];

    // Start verification process asynchronously
    verifyDocument(document.id, userId)
      .then(async (verificationResult) => {
        console.log(`Document ${document.id} verified:`, verificationResult);

        // Apply scores to OmniScore if verification passed
        if (verificationResult.fraud_risk !== 'high') {
          await applyDocumentScoresToOmniScore(userId);
        }
      })
      .catch(error => {
        console.error(`Verification failed for document ${document.id}:`, error);
      });

    res.json({
      success: true,
      document: {
        id: document.id,
        document_type: document.document_type,
        filename: document.original_filename,
        file_url: document.file_url,
        status: document.status,
        uploaded_at: document.uploaded_at
      },
      message: 'Document uploaded successfully. Verification in progress.'
    });

  } catch (error) {
    console.error('Document upload error:', error);
    res.status(500).json({
      error: 'Failed to upload document',
      message: error.message
    });
  }
});

/**
 * Get all documents for a user
 * GET /api/documents
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.session?.user?.id || req.query.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await pool.query(`
      SELECT
        vd.*,
        dv.authenticity_score as verification_score,
        dv.fraud_risk,
        dv.is_duplicate,
        dv.verified_at
      FROM verification_documents vd
      LEFT JOIN document_verifications dv ON vd.id = dv.document_id
      WHERE vd.user_id = $1
      ORDER BY vd.created_at DESC
    `, [userId]);

    res.json({
      success: true,
      documents: result.rows
    });

  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ error: 'Failed to retrieve documents' });
  }
});

/**
 * Get document details with verification results
 * GET /api/documents/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.user?.id || req.query.user_id;
    const accessorId = req.session?.user?.id;

    if (!userId && !accessorId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get document with verification details
    const result = await pool.query(`
      SELECT
        vd.*,
        dv.authenticity_score,
        dv.fraud_risk,
        dv.fraud_indicators,
        dv.inconsistencies_found,
        dv.is_duplicate,
        dv.confidence_score,
        dv.verified_at,
        vc.credential_name,
        vc.issuer,
        vc.verification_status as credential_status
      FROM verification_documents vd
      LEFT JOIN document_verifications dv ON vd.id = dv.document_id
      LEFT JOIN verified_credentials vc ON vc.document_id = vd.id
      WHERE vd.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const document = result.rows[0];

    // Check access permission
    const hasAccess = document.user_id === parseInt(userId) ||
                     req.session?.user?.role === 'recruiter';

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Log access if accessed by someone other than owner
    if (accessorId && accessorId !== document.user_id) {
      await logDocumentAccess(
        document.id,
        accessorId,
        'view',
        req.session?.user?.company_id,
        req.ip
      );
    }

    res.json({
      success: true,
      document
    });

  } catch (error) {
    console.error('Get document details error:', error);
    res.status(500).json({ error: 'Failed to retrieve document' });
  }
});

/**
 * Get verification status for a document
 * GET /api/documents/:id/verification
 */
router.get('/:id/verification', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.user?.id || req.query.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await pool.query(`
      SELECT
        dv.*,
        vd.document_type,
        vd.status as document_status,
        dsi.score_impact,
        dsi.applied_to_omniscore
      FROM document_verifications dv
      JOIN verification_documents vd ON dv.document_id = vd.id
      LEFT JOIN document_score_impacts dsi ON dsi.document_id = vd.id
      WHERE dv.document_id = $1 AND vd.user_id = $2
    `, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Verification not found' });
    }

    res.json({
      success: true,
      verification: result.rows[0]
    });

  } catch (error) {
    console.error('Get verification status error:', error);
    res.status(500).json({ error: 'Failed to retrieve verification status' });
  }
});

/**
 * Get all verified credentials for a user
 * GET /api/documents/credentials
 */
router.get('/credentials/list', async (req, res) => {
  try {
    const userId = req.session?.user?.id || req.query.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await pool.query(`
      SELECT
        vc.*,
        vd.file_url,
        vd.document_type
      FROM verified_credentials vc
      LEFT JOIN verification_documents vd ON vc.document_id = vd.id
      WHERE vc.user_id = $1
      ORDER BY vc.verified_at DESC
    `, [userId]);

    res.json({
      success: true,
      credentials: result.rows
    });

  } catch (error) {
    console.error('Get credentials error:', error);
    res.status(500).json({ error: 'Failed to retrieve credentials' });
  }
});

/**
 * Get document access audit log (for candidate to see who viewed their documents)
 * GET /api/documents/:id/access-log
 */
router.get('/:id/access-log', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.user?.id || req.query.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify document ownership
    const docCheck = await pool.query(`
      SELECT user_id FROM verification_documents WHERE id = $1
    `, [id]);

    if (docCheck.rows.length === 0 || docCheck.rows[0].user_id !== parseInt(userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(`
      SELECT
        dal.*,
        u.name as accessor_name,
        u.email as accessor_email,
        c.name as company_name
      FROM document_access_logs dal
      LEFT JOIN users u ON dal.accessed_by = u.id
      LEFT JOIN companies c ON dal.company_id = c.id
      WHERE dal.document_id = $1
      ORDER BY dal.accessed_at DESC
    `, [id]);

    res.json({
      success: true,
      access_log: result.rows
    });

  } catch (error) {
    console.error('Get access log error:', error);
    res.status(500).json({ error: 'Failed to retrieve access log' });
  }
});

/**
 * Delete a document (candidate only)
 * DELETE /api/documents/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.user?.id || req.body.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await pool.query(`
      DELETE FROM verification_documents
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found or access denied' });
    }

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });

  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

/**
 * Get document verification stats for a candidate
 * GET /api/documents/stats
 */
router.get('/stats/summary', async (req, res) => {
  try {
    const userId = req.session?.user?.id || req.query.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const stats = await pool.query(`
      SELECT
        COUNT(DISTINCT vd.id) as total_documents,
        COUNT(DISTINCT CASE WHEN vd.status = 'processed' THEN vd.id END) as verified_documents,
        COUNT(DISTINCT CASE WHEN vd.status = 'flagged' THEN vd.id END) as flagged_documents,
        COUNT(DISTINCT vc.id) as verified_credentials,
        COALESCE(SUM(dsi.score_impact), 0) as total_score_impact,
        COALESCE(AVG(dv.authenticity_score), 0) as avg_authenticity_score
      FROM verification_documents vd
      LEFT JOIN document_verifications dv ON vd.id = dv.document_id
      LEFT JOIN verified_credentials vc ON vc.user_id = vd.user_id
      LEFT JOIN document_score_impacts dsi ON dsi.user_id = vd.user_id AND dsi.applied_to_omniscore = true
      WHERE vd.user_id = $1
    `, [userId]);

    res.json({
      success: true,
      stats: stats.rows[0]
    });

  } catch (error) {
    console.error('Get document stats error:', error);
    res.status(500).json({ error: 'Failed to retrieve stats' });
  }
});

module.exports = router;
