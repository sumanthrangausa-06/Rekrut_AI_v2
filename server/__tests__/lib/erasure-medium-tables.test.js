/**
 * S-078 (#756): Erasure completeness — MEDIUM tables (GDPR Art. 17).
 *
 * Extends erasePersonalData() (S-067/S-075/S-076) to hard-delete the MEDIUM
 * family tables on erasure:
 *   messages (sender_id!), user_memory, match_results (candidate_id),
 *   practice_sessions, screening_sessions (candidate_id),
 *   interview_transcripts (via interview_recordings → interview_events),
 *   omni_scores, role_scores
 *
 * Key-mismatch lesson (STOP 1): messages uses sender_id, NOT user_id.
 * match_results and screening_sessions use candidate_id.
 * interview_transcripts has no user key — joins through
 * interview_recordings.interview_event_id → interview_events.candidate_id.
 *
 * messages.file_url attachments follow the S-076 two-phase pattern:
 * RETURNING file_url → pending_storage_deletions ledger → Phase 2 deletes.
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

const erasureService = require('../../../lib/erasureService');

// Helper: mock the Phase 1 query sequence through the S-076 tables,
// then fall back to a generic success for the S-078 MEDIUM deletes.
function mockPhase1WithMedium(overrides = {}) {
	const client = { query: jest.fn() };
	const q = (rows = [], rowCount = 0) => ({ rows, rowCount });
	// S-067/S-075/S-076 sequence (must match erasureService.js order).
	client.query
		.mockResolvedValueOnce(q([], 0)) // #799: legal-hold check (no hold)
		.mockResolvedValueOnce(q([], 1)) // destroyDEK UPDATE
		.mockResolvedValueOnce(q([], 1)) // embeddings DELETE
		.mockResolvedValueOnce(q([], 1)) // search-index DELETE
		.mockResolvedValueOnce(q([], 0)) // cv_uploads
		.mockResolvedValueOnce(q([], 0)) // parsed_resumes
		.mockResolvedValueOnce(q([], 0)) // candidate_profiles
		.mockResolvedValueOnce(q([], 0)) // identity_verifications
		.mockResolvedValueOnce(q([], 0)) // cv_analyses
		.mockResolvedValueOnce(q([], 0)) // cv_reviews
		.mockResolvedValueOnce(q([], 0)) // verification_requests
		.mockResolvedValueOnce(q([], 0)) // verification_documents
		.mockResolvedValueOnce(q([], 0)) // work_experience
		.mockResolvedValueOnce(q([], 0)) // education
		.mockResolvedValueOnce(q([], 0)) // candidate_skills
		.mockResolvedValueOnce(q([], 0)) // linkedin_profiles
		.mockResolvedValueOnce(q([], 0)) // career_diagnoses
		.mockResolvedValueOnce(q([], 1)) // users avatar_url UPDATE
		// S-078 MEDIUM sequence.
		.mockResolvedValueOnce(q(overrides.messages || [], 0)) // messages
		.mockResolvedValueOnce(q([], 0)) // user_memory
		.mockResolvedValueOnce(q([], 0)) // match_results
		.mockResolvedValueOnce(q([], 0)) // practice_sessions
		.mockResolvedValueOnce(q([], 0)) // screening_sessions
		.mockResolvedValueOnce(q([], 0)) // interview_transcripts
		.mockResolvedValueOnce(q([], 0)) // omni_scores
		.mockResolvedValueOnce(q([], 0)) // role_scores
		// Privacy-engineer S-078 SHOULD-FIX: 6 more leaf tables.
		.mockResolvedValueOnce(q([], 0)) // screening_answers
		.mockResolvedValueOnce(q([], 0)) // interview_evaluations
		.mockResolvedValueOnce(q([], 0)) // interview_composite_scores
		.mockResolvedValueOnce(q([], 0)) // score_components
		.mockResolvedValueOnce(q([], 0)) // score_history
		.mockResolvedValueOnce(q([], 0)) // job_recommendations
		.mockResolvedValueOnce(q([], 0)) // recording_consent redaction
		.mockResolvedValueOnce(q([], 0)) // #780: job_applications SELECT (no applications)
		// S-047 (E-008): observer tables.
		.mockResolvedValueOnce(q([], 0)) // ai_observer_reports
		.mockResolvedValueOnce(q([], 0)); // observer_jobs
	// Ledger INSERTs + any overflow.
	client.query.mockResolvedValue({ rows: [], rowCount: 1 });
	return client;
}

describe('S-078 erasePersonalData — MEDIUM tables (in-tx)', () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	test('deletes rows from all 8 MEDIUM tables', async () => {
		const client = mockPhase1WithMedium();

		await erasureService.erasePersonalData(7, { client });

		const sqls = client.query.mock.calls.map(([sql]) => sql);
		for (const table of [
			'messages',
			'user_memory',
			'match_results',
			'practice_sessions',
			'screening_sessions',
			'interview_transcripts',
			'omni_scores',
			'role_scores',
			'screening_answers',
			'interview_evaluations',
			'interview_composite_scores',
			'score_components',
			'score_history',
			'job_recommendations',
		]) {
			const found = sqls.find((s) => new RegExp(`DELETE FROM ${table}`, 'i').test(s));
			expect(found).toBeDefined();
		}
	});

	test('messages uses sender_id (not user_id)', async () => {
		const client = mockPhase1WithMedium();

		await erasureService.erasePersonalData(7, { client });

		const msgCall = client.query.mock.calls.find(([sql]) =>
			/DELETE FROM messages/i.test(sql),
		);
		expect(msgCall[0]).toMatch(/sender_id/);
		expect(msgCall[0]).not.toMatch(/user_id/);
		expect(msgCall[1]).toEqual([7]);
	});

	test('match_results and screening_sessions use candidate_id', async () => {
		const client = mockPhase1WithMedium();

		await erasureService.erasePersonalData(7, { client });

		const calls = client.query.mock.calls;
		const mrCall = calls.find(([sql]) => /DELETE FROM match_results/i.test(sql));
		const ssCall = calls.find(([sql]) => /DELETE FROM screening_sessions/i.test(sql));
		expect(mrCall[0]).toMatch(/candidate_id/);
		expect(ssCall[0]).toMatch(/candidate_id/);
		expect(mrCall[1]).toEqual([7]);
		expect(ssCall[1]).toEqual([7]);
	});

	test('interview_transcripts deletes via recording → event join', async () => {
		const client = mockPhase1WithMedium();

		await erasureService.erasePersonalData(7, { client });

		const tCall = client.query.mock.calls.find(([sql]) =>
			/DELETE FROM interview_transcripts/i.test(sql),
		);
		expect(tCall).toBeDefined();
		// Must reach the candidate through the recording/event chain —
		// interview_transcripts has no user key of its own.
		expect(tCall[0]).toMatch(/interview_recordings/i);
		expect(tCall[0]).toMatch(/interview_events/i);
		expect(tCall[1]).toEqual([7]);
	});

	test('message attachments go to the storage ledger (Phase 2)', async () => {
		const attachUrl = '/api/files/r2/chat/789-xyz.png';
		const client = mockPhase1WithMedium({
			messages: [{ file_url: attachUrl }],
		});

		const result = await erasureService.erasePersonalData(7, { client });

		const ledgerInserts = client.query.mock.calls.filter(([sql]) =>
			/INSERT INTO pending_storage_deletions/i.test(sql),
		);
		const attachInsert = ledgerInserts.find(([, params]) => params[1] === attachUrl);
		expect(attachInsert).toBeDefined();
		expect(attachInsert[1]).toEqual([7, attachUrl]);
		expect(result.storageKeys).toContain(attachUrl);
	});

	test('result flags report MEDIUM deletions', async () => {
		const client = mockPhase1WithMedium();

		const result = await erasureService.erasePersonalData(7, { client });

		for (const flag of [
			'messagesDeleted',
			'userMemoryDeleted',
			'matchResultsDeleted',
			'practiceSessionsDeleted',
			'screeningSessionsDeleted',
			'interviewTranscriptsDeleted',
			'omniScoresDeleted',
			'roleScoresDeleted',
			'screeningAnswersDeleted',
			'interviewEvaluationsDeleted',
			'interviewCompositeScoresDeleted',
			'scoreComponentsDeleted',
			'scoreHistoryDeleted',
			'jobRecommendationsDeleted',
			'recordingConsentRedacted',
			'observerReportsDeleted',
			'observerJobsDeleted',
			'observerAudioChunksDeleted',
			'observerSpeechMeasurementsDeleted',
			'observerCaptureOutcomesDeleted',
		]) {
			expect(flag in result).toBe(true);
		}
	});

	test('recording_consent keeps the row, redacts ip/user_agent', async () => {
		const client = mockPhase1WithMedium();

		const result = await erasureService.erasePersonalData(7, { client });

		const rcCall = client.query.mock.calls.find(([sql]) =>
			/UPDATE recording_consent/i.test(sql),
		);
		expect(rcCall).toBeDefined();
		expect(rcCall[0]).toMatch(/ip_address = NULL/i);
		expect(rcCall[0]).toMatch(/user_agent = NULL/i);
		expect(rcCall[0]).not.toMatch(/DELETE/i);
		expect(result.recordingConsentRedacted).toBe(false); // no rows in mock
	});
});
