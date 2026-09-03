/**
 * Candidate Document Management Routes
 * Mounted at /api/candidate/documents
 *
 * Features:
 * - List, upload, download, delete candidate documents
 * - AES-256 encryption at rest
 * - Virus scanning before storage
 * - Access logging
 * - Reuses logic from routes/documents.js where possible
 */

const express = require('express');
const multer = require('multer');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { encryptBuffer, decryptBuffer } = require('../lib/document-crypto');
const { scanFile, logScanEvent } = require('../lib/virus-scanner');
const {
	verifyDocument,
	applyDocumentScoresToOmniScore,
} = require('../services/document-verification');

const router = express.Router();

// ── Multer config (same as documents.js) ──
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 50 * 1024 * 1024 },
	fileFilter: (_req, file, cb) => {
		const allowedTypes = [
			'application/pdf',
			'image/jpeg',
			'image/jpg',
			'image/png',
			'image/webp',
			'application/msword',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		];
		if (allowedTypes.includes(file.mimetype)) {
			cb(null, true);
		} else {
			cb(new Error('Invalid file type. Only PDF, images, and Word documents allowed.'));
		}
	},
});

// ── Document type whitelist ──
const VALID_DOCUMENT_TYPES = [
	'resume',
	'education_certificate',
	'employment_letter',
	'id_document',
	'certification',
	'reference_letter',
];

// ════════════════════════════════════════════════════════════════════════
// GET /api/candidate/documents — list user's documents
// ════════════════════════════════════════════════════════════════════════
router.get('/', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;
		if (!userId) return res.status(401).json({ error: 'Authentication required' });

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
        dv.authenticity_score AS verification_score,
        dv.fraud_risk,
        dv.is_duplicate,
        dv.confidence_score,
        dv.verified_at,
        dv.inconsistencies_found,
        vc.credential_name,
        vc.issuer,
        vc.verification_status AS credential_status
      FROM verification_documents vd
      LEFT JOIN document_verifications dv ON vd.id = dv.document_id
      LEFT JOIN verified_credentials vc ON vc.document_id = vd.id
      WHERE vd.user_id = $1
      ORDER BY vd.created_at DESC
    `,
			[userId],
		);

		// Strip raw R2 URLs — clients must use authenticated download endpoint
		const documents = result.rows.map((row) => {
			const { file_url, encryption_key, ...rest } = row;
			return rest;
		});

		res.json({ success: true, documents });
	} catch (error) {
		console.error('[candidate-documents] List error:', error);
		res.status(500).json({ error: 'Failed to retrieve documents' });
	}
});

// ════════════════════════════════════════════════════════════════════════
// POST /api/candidate/documents/upload — upload with encryption + virus scan
// ════════════════════════════════════════════════════════════════════════
router.post('/upload', authMiddleware, upload.single('document'), async (req, res) => {
	try {
		const { document_type } = req.body;
		const userId = req.user.id;

		if (!userId) return res.status(401).json({ error: 'Authentication required' });
		if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
		if (!document_type) return res.status(400).json({ error: 'Document type required' });
		if (!VALID_DOCUMENT_TYPES.includes(document_type)) {
			return res.status(400).json({ error: 'Invalid document type' });
		}

		// ── 1. Virus scan ──
		const scanResult = scanFile(req.file.buffer, req.file.mimetype, req.file.originalname);
		logScanEvent(userId, req.file.originalname, req.file.mimetype, scanResult, req).catch((err) =>
			console.warn('[candidate-documents] Scan log failed:', err.message),
		);

		if (!scanResult.clean) {
			console.warn(
				`[candidate-documents] File rejected by virus scanner for user ${userId}:`,
				scanResult.reason,
			);
			return res.status(400).json({
				error: 'File upload rejected',
				reason: scanResult.reason,
				code: 'VIRUS_SCAN_FAILED',
			});
		}

		// ── 2. AES-256 encryption ──
		const { encryptedBuffer, iv, tag, algorithm } = encryptBuffer(req.file.buffer, userId);

		// ── 3. Upload encrypted file to R2 ──
		const formData = new FormData();
		formData.append(
			'file',
			new Blob([encryptedBuffer], { type: 'application/octet-stream' }),
			req.file.originalname,
		);

		const uploadRes = await fetch('https://polsia.com/api/proxy/r2/upload', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${process.env.POLSIA_API_KEY}`,
			},
			body: formData,
		});

		const uploadResult = await uploadRes.json();
		if (!uploadResult.success) {
			throw new Error(uploadResult.error?.message || 'File upload failed');
		}

		const fileUrl = uploadResult.file.url;

		// ── 4. Create document record with encryption metadata ──
		const result = await pool.query(
			`
      INSERT INTO verification_documents (
        user_id, document_type, original_filename, file_url,
        file_size, mime_type, status,
        encryption_iv, encryption_tag, encryption_algorithm
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
      RETURNING *
    `,
			[
				userId,
				document_type,
				req.file.originalname,
				fileUrl,
				req.file.size,
				req.file.mimetype,
				iv,
				tag,
				algorithm,
			],
		);

		const document = result.rows[0];

		// ── 5. Start async verification ──
		verifyDocument(document.id, userId)
			.then(async (verificationResult) => {
				console.log(`[candidate-documents] Document ${document.id} verified:`, verificationResult);
				if (verificationResult.fraud_risk !== 'high') {
					await applyDocumentScoresToOmniScore(userId);
				}
			})
			.catch((error) => {
				console.error(
					`[candidate-documents] Verification failed for document ${document.id}:`,
					error,
				);
			});

		res.json({
			success: true,
			document: {
				id: document.id,
				document_type: document.document_type,
				name: document.original_filename,
				status: document.status,
				size: document.file_size,
				uploadedAt: document.uploaded_at,
			},
			message: 'Document uploaded successfully. Verification in progress.',
		});
	} catch (error) {
		console.error('[candidate-documents] Upload error:', error);
		if (error.message?.includes('File upload failed')) {
			return res.status(502).json({ error: 'File storage service unavailable' });
		}
		res.status(500).json({ error: 'Failed to upload document' });
	}
});

// ════════════════════════════════════════════════════════════════════════
// GET /api/candidate/documents/:id — get document details
// ════════════════════════════════════════════════════════════════════════
router.get('/:id', authMiddleware, async (req, res) => {
	try {
		const { id } = req.params;
		const userId = req.user.id;

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
			[id, userId],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Document not found' });
		}

		// Strip sensitive fields
		const { file_url, encryption_key, encryption_iv, encryption_tag, ...doc } = result.rows[0];

		res.json({ success: true, document: doc });
	} catch (error) {
		console.error('[candidate-documents] Get details error:', error);
		res.status(500).json({ error: 'Failed to retrieve document' });
	}
});

// ════════════════════════════════════════════════════════════════════════
// GET /api/candidate/documents/:id/download — proxy download with decryption
// ════════════════════════════════════════════════════════════════════════
router.get('/:id/download', authMiddleware, async (req, res) => {
	try {
		const { id } = req.params;
		const userId = req.user.id;

		const result = await pool.query(
			`
      SELECT id, user_id, original_filename, file_url, mime_type,
             encryption_iv, encryption_tag, encryption_algorithm
      FROM verification_documents
      WHERE id = $1 AND user_id = $2
    `,
			[id, userId],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Document not found' });
		}

		const document = result.rows[0];

		// ── Fetch encrypted file from R2 ──
		const fileRes = await fetch(document.file_url);
		if (!fileRes.ok) {
			console.error('[candidate-documents] R2 fetch failed:', fileRes.status);
			return res.status(502).json({ error: 'Failed to retrieve file' });
		}

		const encryptedBuffer = Buffer.from(await fileRes.arrayBuffer());

		// ── Decrypt ──
		const decryptedBuffer = decryptBuffer(
			encryptedBuffer,
			document.encryption_iv,
			document.encryption_tag,
			userId,
		);

		// ── Stream response ──
		const filename = document.original_filename || 'document';
		const encodedFilename = encodeURIComponent(filename);
		res.setHeader('Content-Type', document.mime_type || 'application/octet-stream');
		res.setHeader(
			'Content-Disposition',
			`attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
		);
		res.setHeader('Content-Length', decryptedBuffer.length);
		res.send(decryptedBuffer);
	} catch (error) {
		console.error('[candidate-documents] Download error:', error);
		res.status(500).json({ error: 'Failed to download document' });
	}
});

// ════════════════════════════════════════════════════════════════════════
// DELETE /api/candidate/documents/:id — delete document
// ════════════════════════════════════════════════════════════════════════
router.delete('/:id', authMiddleware, async (req, res) => {
	try {
		const { id } = req.params;
		const userId = req.user.id;

		const result = await pool.query(
			`
      DELETE FROM verification_documents
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `,
			[id, userId],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Document not found or access denied' });
		}

		res.json({ success: true, message: 'Document deleted successfully' });
	} catch (error) {
		console.error('[candidate-documents] Delete error:', error);
		res.status(500).json({ error: 'Failed to delete document' });
	}
});

// ════════════════════════════════════════════════════════════════════════
// GET /api/candidate/documents/:id/verification — verification status
// ════════════════════════════════════════════════════════════════════════
router.get('/:id/verification', authMiddleware, async (req, res) => {
	try {
		const { id } = req.params;
		const userId = req.user.id;

		// Verify ownership
		const docResult = await pool.query(`SELECT user_id FROM verification_documents WHERE id = $1`, [
			id,
		]);
		if (docResult.rows.length === 0) {
			return res.status(404).json({ error: 'Document not found' });
		}
		if (docResult.rows[0].user_id !== userId) {
			return res.status(403).json({ error: 'Access denied' });
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

		res.json({ success: true, verification: result.rows[0] });
	} catch (error) {
		console.error('[candidate-documents] Verification error:', error);
		res.status(500).json({ error: 'Failed to retrieve verification status' });
	}
});

// ════════════════════════════════════════════════════════════════════════
// GET /api/candidate/documents/stats — summary stats
// ════════════════════════════════════════════════════════════════════════
router.get('/stats', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;
		if (!userId) return res.status(401).json({ error: 'Authentication required' });

		const stats = await pool.query(
			`
      SELECT
        COUNT(DISTINCT vd.id) AS total_documents,
        COUNT(DISTINCT CASE WHEN vd.status = 'verified' THEN vd.id END) AS verified_documents,
        COUNT(DISTINCT CASE WHEN vd.status = 'rejected' THEN vd.id END) AS rejected_documents,
        COUNT(DISTINCT CASE WHEN vd.status = 'pending' THEN vd.id END) AS pending_documents,
        COUNT(DISTINCT CASE WHEN vd.status = 'expired' THEN vd.id END) AS expired_documents,
        COUNT(DISTINCT vc.id) AS verified_credentials,
        COALESCE(SUM(dsi.score_impact), 0) AS total_score_impact,
        COALESCE(AVG(dv.authenticity_score), 0) AS avg_authenticity_score
      FROM verification_documents vd
      LEFT JOIN document_verifications dv ON vd.id = dv.document_id
      LEFT JOIN verified_credentials vc ON vc.user_id = vd.user_id
      LEFT JOIN document_score_impacts dsi
        ON dsi.user_id = vd.user_id AND dsi.applied_to_omniscore = true
      WHERE vd.user_id = $1
    `,
			[userId],
		);

		res.json({ success: true, stats: stats.rows[0] });
	} catch (error) {
		console.error('[candidate-documents] Stats error:', error);
		res.status(500).json({ error: 'Failed to retrieve stats' });
	}
});

module.exports = router;
