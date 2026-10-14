/**
 * S-076 (#759): Erasure completeness — resume/profile family (HIGH priority).
 *
 * Extends erasePersonalData() (S-067/S-075) to hard-delete the resume/profile
 * family tables on erasure (GDPR Art. 17). Privacy-engineer review found the
 * initial 6-table scope missed 7 more tables — all now covered:
 *   Phase 1 tables: cv_uploads, parsed_resumes, candidate_profiles,
 *     identity_verifications, cv_analyses, cv_reviews,
 *     verification_requests (candidate_id!), verification_documents,
 *     work_experience, education, candidate_skills, linkedin_profiles,
 *     career_diagnoses
 *
 * Two-phase design (Q3: crash-safe via pending_storage_deletions ledger):
 *   Phase 1 (in-tx): DELETEs + INSERT ledger rows
 *   Phase 2 (post-commit): deleteErasedStorageFiles(userId) reads ledger,
 *     deletes files (R2/B2 via deleteFile, local via deleteEncryptedFile),
 *     marks entries deleted/failed, per-file audit with metadata (Q4).
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn(),
}));
jest.mock('../../../lib/file-storage', () => ({
	deleteFile: jest.fn(),
}));
jest.mock('../../../services/encryption', () => ({
	deleteEncryptedFile: jest.fn(),
}));
jest.mock('@aws-sdk/client-s3', () => ({
	S3Client: jest.fn(),
	PutObjectCommand: jest.fn(),
	GetObjectCommand: jest.fn(),
	DeleteObjectCommand: jest.fn(),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const biometricAudit = require('../../../lib/biometricAudit');
const erasureService = require('../../../lib/erasureService');
const fileStorage = require('../../../lib/file-storage');
const { deleteEncryptedFile } = require('../../../lib/../services/encryption');

// Helper: mock the full Phase 1 query sequence.
// Returns the mock client. Customize row counts via overrides.
function mockPhase1(overrides = {}) {
	const client = { query: jest.fn() };
	const q = (rows = [], rowCount = 0) => ({ rows, rowCount });
	client.query
		.mockResolvedValueOnce(q([], 0)) // #799: legal-hold check (no hold)
		.mockResolvedValueOnce(q([], 1)) // destroyDEK UPDATE
		.mockResolvedValueOnce(q([], 1)) // embeddings DELETE
		.mockResolvedValueOnce(q([], 1)) // search-index DELETE
		.mockResolvedValueOnce(q([], 0)) // #1123: verified_credentials SELECT (FK-ordered, no rows)
		.mockResolvedValueOnce(q(overrides.cvUploads || [], 0)) // cv_uploads
		.mockResolvedValueOnce(q(overrides.parsedResumes || [], 0)) // parsed_resumes
		.mockResolvedValueOnce(q(overrides.profiles || [], 0)) // candidate_profiles
		.mockResolvedValueOnce(q([], 0)) // identity_verifications
		.mockResolvedValueOnce(q([], 0)) // cv_analyses
		.mockResolvedValueOnce(q([], 0)) // cv_reviews
		.mockResolvedValueOnce(q(overrides.verificationRequests || [], 0)) // verification_requests
		.mockResolvedValueOnce(q(overrides.verificationDocs || [], 0)) // verification_documents
		.mockResolvedValueOnce(q([], 0)) // work_experience
		.mockResolvedValueOnce(q([], 0)) // education
		.mockResolvedValueOnce(q([], 0)) // candidate_skills
		.mockResolvedValueOnce(q([], 0)) // linkedin_profiles
		.mockResolvedValueOnce(q([], 0)) // career_diagnoses
		.mockResolvedValueOnce(q([], 1)) // users avatar_url UPDATE
		// S-078 (#756) MEDIUM tables — same order as erasureService.js.
		.mockResolvedValueOnce(q([], 0)) // messages
		.mockResolvedValueOnce(q([], 0)) // user_memory
		.mockResolvedValueOnce(q([], 0)) // match_results
		.mockResolvedValueOnce(q([], 0)) // practice_sessions
		.mockResolvedValueOnce(q([], 0)) // screening_sessions
		.mockResolvedValueOnce(q([], 0)) // interview_transcripts
		.mockResolvedValueOnce(q([], 0)) // omni_scores
		.mockResolvedValueOnce(q([], 0)) // role_scores
		.mockResolvedValueOnce(q([], 0)) // screening_answers
		.mockResolvedValueOnce(q([], 0)) // interview_evaluations
		.mockResolvedValueOnce(q([], 0)) // interview_composite_scores
		.mockResolvedValueOnce(q([], 0)) // score_components
		.mockResolvedValueOnce(q([], 0)) // score_history
		.mockResolvedValueOnce(q([], 0)) // job_recommendations
		.mockResolvedValueOnce(q([], 0)) // recording_consent redaction
		.mockResolvedValueOnce(q([], 0)) // #1127: consent_records SELECT (no rows)
		.mockResolvedValueOnce(q([], 0)) // #1127: consent_history SELECT (no rows)
		.mockResolvedValueOnce(q([], 0)) // #780: job_applications SELECT (no applications)
		.mockResolvedValueOnce(q([], 0)) // #813: screening_responses SELECT (no rows)
		.mockResolvedValueOnce(q([], 0)) // #813: job_application_screenings SELECT (no rows)
		.mockResolvedValueOnce(q([], 0)) // #813: ai_screenings SELECT (no rows)
		.mockResolvedValueOnce(q([], 0)) // #813: outreach_attempts SELECT (no rows)
		.mockResolvedValueOnce(q([], 0)) // #813: auto_apply_profiles SELECT (no rows)
		.mockResolvedValueOnce(q([], 0)) // S-047: ai_observer_reports
		.mockResolvedValueOnce(q([], 0)); // S-047: observer_jobs
	// Ledger INSERTs: one per storage key (mocked as needed per test).
	return client;
}

describe('S-076 erasePersonalData — Phase 1 (in-tx)', () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	test('deletes rows from all 13 resume-family tables', async () => {
		const client = mockPhase1();
		// Ledger INSERTs for the (empty) key lists.
		client.query.mockResolvedValue({ rowCount: 1 });

		await erasureService.erasePersonalData(7, { client });

		const sqls = client.query.mock.calls.map(([sql]) => sql);
		for (const table of [
			'cv_uploads',
			'parsed_resumes',
			'candidate_profiles',
			'identity_verifications',
			'cv_analyses',
			'cv_reviews',
			'verification_requests',
			'verification_documents',
			'work_experience',
			'education',
			'candidate_skills',
			'linkedin_profiles',
			'career_diagnoses',
		]) {
			const found = sqls.find((s) => new RegExp(`DELETE FROM ${table}`, 'i').test(s));
			expect(found).toBeDefined();
		}
		// users.avatar_url cleared (dangling pointer fix).
		expect(
			sqls.find((s) => /UPDATE users SET avatar_url = NULL/i.test(s)),
		).toBeDefined();
	});

	test('verification_requests uses candidate_id (not user_id)', async () => {
		const client = mockPhase1();
		client.query.mockResolvedValue({ rowCount: 1 });

		await erasureService.erasePersonalData(7, { client });

		const vrCall = client.query.mock.calls.find(([sql]) =>
			/DELETE FROM verification_requests/i.test(sql),
		);
		expect(vrCall[0]).toMatch(/candidate_id/);
		expect(vrCall[1]).toEqual([7]);
	});

	test('collects R2 keys + local paths, writes ledger in-tx', async () => {
		const cvUrl = '/api/files/r2/cv/123-abc.pdf';
		const localPath = 'ab/cd1234.enc';
		const client = mockPhase1({
			cvUploads: [{ file_url: cvUrl }],
			verificationRequests: [
				{ id_document_encrypted_url: localPath, selfie_encrypted_url: null },
			],
		});

		const result = await erasureService.erasePersonalData(7, { client });

		// Ledger INSERTs happened in-tx.
		const ledgerInserts = client.query.mock.calls.filter(([sql]) =>
			/INSERT INTO pending_storage_deletions/i.test(sql),
		);
		expect(ledgerInserts.length).toBe(2);
		// R2 key.
		expect(ledgerInserts[0][1]).toEqual([7, cvUrl]);
		expect(ledgerInserts[0][0]).toMatch(/'r2'/);
		// Local path.
		expect(ledgerInserts[1][1]).toEqual([7, localPath]);
		expect(ledgerInserts[1][0]).toMatch(/'local'/);
		// Storage keys in result (local prefixed for Phase 2 routing).
		expect(result.storageKeys).toContain(cvUrl);
		expect(result.storageKeys).toContain(`local:${localPath}`);
	});

	test('dedupes parsed_resumes.file_url === candidate_profiles.resume_url', async () => {
		const resumeUrl = '/api/files/b2/resumes/456-def.pdf';
		const client = mockPhase1({
			parsedResumes: [{ file_url: resumeUrl }],
			profiles: [{ resume_url: resumeUrl, photo_url: null }],
		});

		const result = await erasureService.erasePersonalData(7, { client });

	 const r2Keys = result.storageKeys.filter((k) => !k.startsWith('local:'));
		expect(r2Keys).toEqual([resumeUrl]); // deduped to one
	});
});

describe('S-076 deleteErasedStorageFiles — Phase 2 (ledger-driven)', () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	test('reads pending ledger entries and deletes R2 files', async () => {
		const db = require('../../../lib/db');
		db.query
			.mockResolvedValueOnce({
				rows: [{ id: 1, file_url: '/api/files/r2/cv/a.pdf', storage_type: 'r2' }],
			}) // SELECT pending
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #799: legal-hold check (no hold)
			.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE status
		fileStorage.deleteFile.mockResolvedValue({ deleted: true });
		biometricAudit.logAccess.mockResolvedValue({ id: 1 });

		const result = await erasureService.deleteErasedStorageFiles(7, {
			audit: { userId: 7, userRole: 'candidate' },
		});

		expect(fileStorage.deleteFile).toHaveBeenCalledWith('/api/files/r2/cv/a.pdf');
		expect(result.deleted).toBe(1);
		expect(result.failed).toBe(0);
		// Ledger marked deleted.
		const updateCall = db.query.mock.calls.find(([sql]) =>
			/UPDATE pending_storage_deletions/i.test(sql),
		);
		expect(updateCall[1][0]).toBe('deleted');
	});

	test('deletes local files via deleteEncryptedFile', async () => {
		const db = require('../../../lib/db');
		db.query
			.mockResolvedValueOnce({
				rows: [{ id: 2, file_url: 'ab/cd1234.enc', storage_type: 'local' }],
			})
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #799: legal-hold check (no hold)
			.mockResolvedValueOnce({ rowCount: 1 });
		biometricAudit.logAccess.mockResolvedValue({ id: 1 });

		const result = await erasureService.deleteErasedStorageFiles(7, {});

		expect(deleteEncryptedFile).toHaveBeenCalledWith('ab/cd1234.enc');
		expect(result.deleted).toBe(1);
	});

	test('no pending entries is a no-op', async () => {
		const db = require('../../../lib/db');
		db.query.mockResolvedValueOnce({ rows: [] });

		const result = await erasureService.deleteErasedStorageFiles(7, {});

		expect(result).toEqual({ deleted: 0, failed: 0, failures: [], heldSkips: 0 });
		expect(fileStorage.deleteFile).not.toHaveBeenCalled();
	});

	test('persistent failure marks ledger failed + per-file audit with metadata', async () => {
		const db = require('../../../lib/db');
		db.query
			.mockResolvedValueOnce({
				rows: [{ id: 3, file_url: '/api/files/r2/cv/dead.pdf', storage_type: 'r2' }],
			})
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #799: legal-hold check (no hold)
			.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE status=failed
		fileStorage.deleteFile.mockRejectedValue(new Error('storage down'));
		biometricAudit.logAccess.mockResolvedValue({ id: 1 });

		const result = await erasureService.deleteErasedStorageFiles(7, {
			audit: { userId: 7, userRole: 'candidate', ipAddress: '1.2.3.4' },
		});

		expect(result.failed).toBe(1);
		expect(result.failures).toEqual(['/api/files/r2/cv/dead.pdf']);
		// Ledger marked failed.
		const updateCall = db.query.mock.calls.find(([sql]) =>
			/UPDATE pending_storage_deletions/i.test(sql),
		);
		expect(updateCall[1][0]).toBe('failed');
		// Per-file audit with metadata (Q4).
		expect(biometricAudit.logAccess).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'delete',
				dataType: 'storage_file',
				metadata: expect.objectContaining({
					file_url: '/api/files/r2/cv/dead.pdf',
					outcome: 'failed',
				}),
			}),
		);
	});
});

describe('S-076 deleteFile — storage deletion helper', () => {
	test('is exported from lib/file-storage', () => {
		// Note: file-storage is mocked in this file; verify via real module.
		jest.resetModules();
		const real = jest.requireActual('../../../lib/file-storage');
		expect(typeof real.deleteFile).toBe('function');
	});

	test('parses provider + key from /api/files URL', async () => {
		jest.resetModules();
		const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
		const sendMock = jest.fn().mockResolvedValue({});
		S3Client.mockImplementation(() => ({ send: sendMock }));
		process.env.R2_ACCOUNT_ID = 'test-account';
		process.env.R2_ACCESS_KEY_ID = 'test-key';
		process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
		process.env.R2_BUCKET_NAME = 'test-bucket';
		const real = jest.requireActual('../../../lib/file-storage');
		real._clearClients();

		const result = await real.deleteFile('/api/files/r2/cv/123-abc.pdf');

		expect(result.deleted).toBe(true);
		expect(DeleteObjectCommand).toHaveBeenCalledWith({
			Bucket: 'test-bucket',
			Key: 'cv/123-abc.pdf',
		});

		delete process.env.R2_ACCOUNT_ID;
		delete process.env.R2_ACCESS_KEY_ID;
		delete process.env.R2_SECRET_ACCESS_KEY;
		delete process.env.R2_BUCKET_NAME;
	});

	test('unrecognized URL format skips gracefully', async () => {
		jest.resetModules();
		const real = jest.requireActual('../../../lib/file-storage');
		const result = await real.deleteFile('https://example.com/file.pdf');
		expect(result.deleted).toBe(false);
		expect(result.reason).toBe('unrecognized_format');
	});

	test('NoSuchKey is idempotent success', async () => {
		jest.resetModules();
		const { S3Client } = require('@aws-sdk/client-s3');
		const err = new Error('not found');
		err.name = 'NoSuchKey';
		S3Client.mockImplementation(() => ({ send: jest.fn().mockRejectedValue(err) }));
		process.env.R2_ACCOUNT_ID = 'test-account';
		process.env.R2_ACCESS_KEY_ID = 'test-key';
		process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
		process.env.R2_BUCKET_NAME = 'test-bucket';
		const real = jest.requireActual('../../../lib/file-storage');
		real._clearClients();

		const result = await real.deleteFile('/api/files/r2/cv/gone.pdf');

		expect(result.deleted).toBe(true);
		expect(result.alreadyGone).toBe(true);

		delete process.env.R2_ACCOUNT_ID;
		delete process.env.R2_ACCESS_KEY_ID;
		delete process.env.R2_SECRET_ACCESS_KEY;
		delete process.env.R2_BUCKET_NAME;
	});
});
