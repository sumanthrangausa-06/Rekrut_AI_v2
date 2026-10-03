/**
 * Verification Configuration Constants
 * Centralized config for identity verification to avoid magic numbers.
 */

const VERIFICATION_CONFIG = {
	// File upload constraints
	MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
	MAX_FILE_SIZE_MB: 10,

	// Allowed MIME types
	ALLOWED_ID_DOCUMENT_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'],
	ALLOWED_ID_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.pdf'],

	ALLOWED_SELFIE_TYPES: ['image/jpeg', 'image/jpg', 'image/png'],
	ALLOWED_SELFIE_EXTENSIONS: ['.jpg', '.jpeg', '.png'],

	// Rate limiting
	UPLOAD_RATE_LIMIT_MAX: 5, // uploads per window
	UPLOAD_RATE_LIMIT_WINDOW_MS: 60 * 60 * 1000, // 1 hour

	// Data retention
	DEFAULT_RETENTION_DAYS: 90,
	RETENTION_GRACE_DAYS: 7, // extra days before hard delete

	// Status workflow
	STATUSES: {
		PENDING: 'pending',
		OCR_PROCESSING: 'ocr_processing',
		FACE_MATCH: 'face_match',
		REVIEW: 'review',
		APPROVED: 'approved',
		REJECTED: 'rejected',
	},

	// ID document types
	ID_DOCUMENT_TYPES: {
		PASSPORT: 'passport',
		DRIVERS_LICENSE: 'drivers_license',
		NATIONAL_ID: 'national_id',
		RESIDENCE_PERMIT: 'residence_permit',
		OTHER: 'other',
	},

	// Actor types for audit log
	ACTOR_TYPES: {
		SYSTEM: 'system',
		CANDIDATE: 'candidate',
		RECRUITER: 'recruiter',
		ADMIN: 'admin',
	},

	// Actions for audit log
	ACTIONS: {
		UPLOAD: 'upload',
		VIEW: 'view',
		APPROVE: 'approve',
		REJECT: 'reject',
		AUTO_CHECK: 'auto_check',
		DELETE: 'delete',
	},

	// Storage path
	STORAGE_BASE_DIR: './uploads/verification',
};

module.exports = { VERIFICATION_CONFIG };
