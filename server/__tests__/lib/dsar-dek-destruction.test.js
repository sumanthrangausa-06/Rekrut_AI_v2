/**
 * S-067 (#720): Wire destroyDEK into DSAR and account deletion.
 *
 * RED tests — destroyDEK gains an optional `options` param:
 *   - options.client: pg client/pool used for the UPDATE (transaction support)
 *   - options.audit: { userId, userRole, ipAddress } → writes a biometric_audit_log
 *     'purge' entry on the same client (atomic with the destruction)
 *
 * AC-3: every DEK destruction writes an audit log entry (who/when/why).
 * DEKNotFound → no destruction happened → no audit entry.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn(),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const db = require('../../../lib/db');
const biometricAudit = require('../../../lib/biometricAudit');
const { destroyDEK } = require('../../../lib/biometricCrypto');
const { erasePersonalData } = require('../../../lib/erasureService');

describe('S-067 destroyDEK options (DSAR wiring)', () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	test('uses the provided client for the UPDATE (transaction support)', async () => {
		const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
		await destroyDEK(7, { client });
		expect(client.query).toHaveBeenCalledTimes(1);
		const [sql, params] = client.query.mock.calls[0];
		expect(sql).toMatch(/UPDATE candidate_data_keys/);
		expect(params[0]).toBe(7);
		// Pool must NOT be touched when a transaction client is given.
		expect(db.query).not.toHaveBeenCalled();
	});

	test('falls back to the default pool when no client is given (backward compat)', async () => {
		db.query.mockResolvedValueOnce({ rowCount: 1 });
		await destroyDEK(7);
		expect(db.query).toHaveBeenCalledTimes(1);
	});

	test('writes a biometric audit purge entry on the same client when audit is provided', async () => {
		const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
		biometricAudit.logAccess.mockResolvedValueOnce({ id: 1 });
		await destroyDEK(7, {
			client,
			audit: { userId: 7, userRole: 'candidate', ipAddress: '10.0.0.1' },
		});
		expect(biometricAudit.logAccess).toHaveBeenCalledTimes(1);
		const [params, passedClient] = biometricAudit.logAccess.mock.calls[0];
		expect(passedClient).toBe(client);
		expect(params).toMatchObject({
			userId: 7,
			userRole: 'candidate',
			action: 'purge',
			dataType: 'dek',
			candidateId: 7,
			ipAddress: '10.0.0.1',
		});
	});

	test('writes no audit entry when audit is not provided', async () => {
		db.query.mockResolvedValueOnce({ rowCount: 1 });
		await destroyDEK(7);
		expect(biometricAudit.logAccess).not.toHaveBeenCalled();
	});

	test('DEKNotFound: throws and writes NO audit entry (nothing was destroyed)', async () => {
		const client = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
		const err = await destroyDEK(7, {
			client,
			audit: { userId: 7, userRole: 'candidate' },
		}).catch((e) => e);
		expect(err.code).toBe('DEKNotFound');
		expect(biometricAudit.logAccess).not.toHaveBeenCalled();
	});
});

describe('S-067 erasePersonalData (shared erasure routine)', () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	test('returns { shredded: true } and audits when a DEK is destroyed', async () => {
		const client = { query: jest.fn() };
		client.query
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #799: legal-hold check (no hold)
			.mockResolvedValueOnce({ rowCount: 1 }) // destroyDEK UPDATE
			.mockResolvedValueOnce({ rowCount: 0 }) // embeddings DELETE: no row
			.mockResolvedValueOnce({ rowCount: 0 }) // search-index DELETE: no row
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #1123: verified_credentials SELECT (FK-ordered, no rows)
			.mockResolvedValueOnce({ rowCount: 0, rows: [] }) // S-076: cv_uploads
			.mockResolvedValueOnce({ rowCount: 0, rows: [] }) // S-076: parsed_resumes
			.mockResolvedValueOnce({ rowCount: 0, rows: [] }) // S-076: candidate_profiles
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: identity_verifications
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: cv_analyses
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: cv_reviews
			.mockResolvedValueOnce({ rowCount: 0, rows: [] }) // S-076: verification_requests
			.mockResolvedValueOnce({ rowCount: 0, rows: [] }) // S-076: verification_documents
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: work_experience
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: education
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: candidate_skills
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: linkedin_profiles
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: career_diagnoses
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: avatar_url clear
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // S-078: messages
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: user_memory
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: match_results
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: practice_sessions
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: screening_sessions
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: interview_transcripts
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: omni_scores
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: role_scores
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: screening_answers
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: interview_evaluations
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: interview_composite_scores
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: score_components
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: score_history
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: job_recommendations
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: recording_consent
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #780: job_applications SELECT (no applications)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #813: screening_responses SELECT (no rows)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #813: job_application_screenings SELECT (no rows)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #813: ai_screenings SELECT (no rows)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #813: outreach_attempts SELECT (no rows)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #813: auto_apply_profiles SELECT (no rows)
			.mockResolvedValueOnce({ rowCount: 0 }) // S-047: ai_observer_reports
			.mockResolvedValueOnce({ rowCount: 0 }); // S-047: observer_jobs
		biometricAudit.logAccess.mockResolvedValueOnce({ id: 1 });
		const result = await erasePersonalData(7, {
			client,
			audit: { userId: 7, userRole: 'candidate', ipAddress: '10.0.0.1' },
		});
		expect(result).toEqual({
			shredded: true,
			embeddingsDeleted: false,
			searchIndexDeleted: false,
			cvUploadsDeleted: false,
			parsedResumesDeleted: false,
			candidateProfileDeleted: false,
			identityVerificationsDeleted: false,
			cvAnalysesDeleted: false,
			cvReviewsDeleted: false,
			verificationRequestsDeleted: false,
			verificationDocumentsDeleted: false,
			workExperienceDeleted: false,
			educationDeleted: false,
			candidateSkillsDeleted: false,
			linkedinProfileDeleted: false,
			careerDiagnosesDeleted: false,
			messagesDeleted: false,
			userMemoryDeleted: false,
			matchResultsDeleted: false,
			practiceSessionsDeleted: false,
			screeningSessionsDeleted: false,
			interviewTranscriptsDeleted: false,
			omniScoresDeleted: false,
			roleScoresDeleted: false,
			screeningAnswersDeleted: false,
			interviewEvaluationsDeleted: false,
			interviewCompositeScoresDeleted: false,
			scoreComponentsDeleted: false,
			scoreHistoryDeleted: false,
			jobRecommendationsDeleted: false,
			jobApplicationsRedacted: false, // #780
			jobApplicationRowsHeld: 0, // #780
			screeningResponsesDeleted: false, // #813
			jobApplicationScreeningsDeleted: false, // #813
			aiScreeningsDeleted: false, // #813
			outreachAttemptsDeleted: false, // #813
			autoApplyProfileDeleted: false, // #813
			aiScreeningAuditLogsDeleted: 0, // #813
			aiScreeningHumanReviewsDeleted: 0, // #813
			applicationKeyedRowsHeld: 0, // #813
			applicationKeyedHeldDetails: [], // #813
			autoApplyConsentTombstone: null, // #813
			recordingConsentRedacted: false,
			observerReportsDeleted: false,
			observerJobsDeleted: false,
			observerAudioChunksDeleted: false,
			observerSpeechMeasurementsDeleted: false,
			observerCaptureOutcomesDeleted: false,
			interviewSessionsStripped: false, // GAP-A (#1120)
			sessionsStripped: 0,
			sessionsHeld: 0,
			transcriptsDeleted: 0,
			recordingsLedgered: 0,
			recordingsRedacted: 0,
			recordingsHeld: 0,
			recordingsUndecryptable: 0,
			recordingFramesLedgered: false,
			framesLedgered: 0,
			framesHeld: 0,
			gapAHeldSkips: 0,
			gapB: {
				scoreSnapshots: 0,
				omniscoreResults: 0,
				scoreAppeals: 0,
				mutualMatches: 0,
				screeningLogs: 0,
				skillAssessments: 0,
				jobAssessmentAttempts: 0,
				assessmentConversations: 0,
				assessmentSessions: 0,
				assessmentEvents: 0,
				rowsHeld: 0,
				heldTables: [],
			},
			gapC: {
				scheduledInterviews: 0,
				interviewReminders: 0,
				interviewFeedback: 0,
				candidateFeedback: 0,
				interviewPanels: 0,
				panelNotes: 0,
				panelMembers: 0,
				scorecards: 0,
				scorecardItems: 0,
				interviewEventsRedacted: 0,
				interviewEventsDeleted: 0,
				proposedSlots: 0,
				interviewRooms: 0,
				interviewRoomsKeptForRecordings: 0,
				mockInterviewSessions: 0,
				interviews: 0,
				interviewAnalysis: 0,
				humanInterviewRequests: 0,
				rowsHeld: 0,
				heldTables: [],
				storageLedgered: 0,
				nonPatternStorageUrls: [],
			},
			gapD: {
				candidateOnboardingData: 0,
				onboardingDocuments: 0,
				onboardingChecklists: 0,
				onboardingChats: 0,
				onboardingPlans: 0,
				onboardingTasks: 0,
				bgVerificationRequests: 0,
				discrepancies: 0,
				educationHistory: 0,
				employmentHistory: 0,
				referenceChecks: 0,
				verifiedCredentials: 0,
				offersRedacted: 0,
				signatureRequests: 0,
				signingPartiesDeleted: 0,
				signingPartiesRedacted: 0,
				signatureDocuments: 0,
				documentHashRecords: 0,
				signatureAuditEvents: 0,
				rowsHeld: 0,
				heldTables: [],
				storageLedgered: 0,
				nonPatternStorageUrls: [],
				signatureAuditResidual: 0,
			},
			gapE: {
				candidateDemographics: 0,
				recruiterFeedback: 0,
				sharedNotes: 0,
				skillEndorsements: 0,
				candidateInvites: 0,
				careerRecommendations: 0,
				skillGapAnalyses: 0,
				learningPaths: 0,
				companyResearchBriefs: 0,
				salaryPracticeSessions: 0,
				profileToolProgress: 0,
				careerCoachSessions: 0,
				applicationOptimizations: 0,
				comments: 0,
				commentMentions: 0,
				portfolioProjects: 0,
				candidateJobActions: 0,
				savedJobs: 0,
				jobAlerts: 0,
				rowsHeld: 0,
				heldTables: [],
				holdLookupFailed: 0,
				lookupFailedTables: [],
				storageLedgered: 0,
			},
			storageKeys: [],
		});
		expect(biometricAudit.logAccess).toHaveBeenCalledTimes(1);
	});

	test('returns { shredded: false } on DEKNotFound (no DEK → not an error)', async () => {
		const client = { query: jest.fn() };
		client.query
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #799: legal-hold check (no hold)
			.mockResolvedValueOnce({ rowCount: 0 }) // destroyDEK: DEKNotFound
			.mockResolvedValueOnce({ rowCount: 1 }) // Gate A: DEK tombstone INSERT (pre-existing chain gap, repaired #799)
			.mockResolvedValueOnce({ rowCount: 0 }) // embeddings DELETE: no row
			.mockResolvedValueOnce({ rowCount: 0 }) // search-index DELETE: no row
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #1123: verified_credentials SELECT (FK-ordered, no rows)
			.mockResolvedValueOnce({ rowCount: 0, rows: [] }) // S-076: cv_uploads
			.mockResolvedValueOnce({ rowCount: 0, rows: [] }) // S-076: parsed_resumes
			.mockResolvedValueOnce({ rowCount: 0, rows: [] }) // S-076: candidate_profiles
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: identity_verifications
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: cv_analyses
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: cv_reviews
			.mockResolvedValueOnce({ rowCount: 0, rows: [] }) // S-076: verification_requests
			.mockResolvedValueOnce({ rowCount: 0, rows: [] }) // S-076: verification_documents
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: work_experience
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: education
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: candidate_skills
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: linkedin_profiles
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: career_diagnoses
			.mockResolvedValueOnce({ rowCount: 0 }) // S-076: avatar_url clear
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // S-078: messages
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: user_memory
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: match_results
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: practice_sessions
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: screening_sessions
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: interview_transcripts
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: omni_scores
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: role_scores
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: screening_answers
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: interview_evaluations
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: interview_composite_scores
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: score_components
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: score_history
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: job_recommendations
			.mockResolvedValueOnce({ rowCount: 0 }) // S-078: recording_consent
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #780: job_applications SELECT (no applications)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #813: screening_responses SELECT (no rows)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #813: job_application_screenings SELECT (no rows)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #813: ai_screenings SELECT (no rows)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #813: outreach_attempts SELECT (no rows)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #813: auto_apply_profiles SELECT (no rows)
			.mockResolvedValueOnce({ rowCount: 0 }) // S-047: ai_observer_reports
			.mockResolvedValueOnce({ rowCount: 0 }); // S-047: observer_jobs
		const result = await erasePersonalData(7, {
			client,
			audit: { userId: 7, userRole: 'candidate' },
		});
		expect(result).toEqual({
			shredded: false,
			embeddingsDeleted: false,
			searchIndexDeleted: false,
			cvUploadsDeleted: false,
			parsedResumesDeleted: false,
			candidateProfileDeleted: false,
			identityVerificationsDeleted: false,
			cvAnalysesDeleted: false,
			cvReviewsDeleted: false,
			verificationRequestsDeleted: false,
			verificationDocumentsDeleted: false,
			workExperienceDeleted: false,
			educationDeleted: false,
			candidateSkillsDeleted: false,
			linkedinProfileDeleted: false,
			careerDiagnosesDeleted: false,
			messagesDeleted: false,
			userMemoryDeleted: false,
			matchResultsDeleted: false,
			practiceSessionsDeleted: false,
			screeningSessionsDeleted: false,
			interviewTranscriptsDeleted: false,
			omniScoresDeleted: false,
			roleScoresDeleted: false,
			screeningAnswersDeleted: false,
			interviewEvaluationsDeleted: false,
			interviewCompositeScoresDeleted: false,
			scoreComponentsDeleted: false,
			scoreHistoryDeleted: false,
			jobRecommendationsDeleted: false,
			jobApplicationsRedacted: false, // #780
			jobApplicationRowsHeld: 0, // #780
			screeningResponsesDeleted: false, // #813
			jobApplicationScreeningsDeleted: false, // #813
			aiScreeningsDeleted: false, // #813
			outreachAttemptsDeleted: false, // #813
			autoApplyProfileDeleted: false, // #813
			aiScreeningAuditLogsDeleted: 0, // #813
			aiScreeningHumanReviewsDeleted: 0, // #813
			applicationKeyedRowsHeld: 0, // #813
			applicationKeyedHeldDetails: [], // #813
			autoApplyConsentTombstone: null, // #813
			recordingConsentRedacted: false,
			observerReportsDeleted: false,
			observerJobsDeleted: false,
			observerAudioChunksDeleted: false,
			observerSpeechMeasurementsDeleted: false,
			observerCaptureOutcomesDeleted: false,
			interviewSessionsStripped: false, // GAP-A (#1120)
			sessionsStripped: 0,
			sessionsHeld: 0,
			transcriptsDeleted: 0,
			recordingsLedgered: 0,
			recordingsRedacted: 0,
			recordingsHeld: 0,
			recordingsUndecryptable: 0,
			recordingFramesLedgered: false,
			framesLedgered: 0,
			framesHeld: 0,
			gapAHeldSkips: 0,
			gapB: {
				scoreSnapshots: 0,
				omniscoreResults: 0,
				scoreAppeals: 0,
				mutualMatches: 0,
				screeningLogs: 0,
				skillAssessments: 0,
				jobAssessmentAttempts: 0,
				assessmentConversations: 0,
				assessmentSessions: 0,
				assessmentEvents: 0,
				rowsHeld: 0,
				heldTables: [],
			},
			gapC: {
				scheduledInterviews: 0,
				interviewReminders: 0,
				interviewFeedback: 0,
				candidateFeedback: 0,
				interviewPanels: 0,
				panelNotes: 0,
				panelMembers: 0,
				scorecards: 0,
				scorecardItems: 0,
				interviewEventsRedacted: 0,
				interviewEventsDeleted: 0,
				proposedSlots: 0,
				interviewRooms: 0,
				interviewRoomsKeptForRecordings: 0,
				mockInterviewSessions: 0,
				interviews: 0,
				interviewAnalysis: 0,
				humanInterviewRequests: 0,
				rowsHeld: 0,
				heldTables: [],
				storageLedgered: 0,
				nonPatternStorageUrls: [],
			},
			gapD: {
				candidateOnboardingData: 0,
				onboardingDocuments: 0,
				onboardingChecklists: 0,
				onboardingChats: 0,
				onboardingPlans: 0,
				onboardingTasks: 0,
				bgVerificationRequests: 0,
				discrepancies: 0,
				educationHistory: 0,
				employmentHistory: 0,
				referenceChecks: 0,
				verifiedCredentials: 0,
				offersRedacted: 0,
				signatureRequests: 0,
				signingPartiesDeleted: 0,
				signingPartiesRedacted: 0,
				signatureDocuments: 0,
				documentHashRecords: 0,
				signatureAuditEvents: 0,
				rowsHeld: 0,
				heldTables: [],
				storageLedgered: 0,
				nonPatternStorageUrls: [],
				signatureAuditResidual: 0,
			},
			gapE: {
				candidateDemographics: 0,
				recruiterFeedback: 0,
				sharedNotes: 0,
				skillEndorsements: 0,
				candidateInvites: 0,
				careerRecommendations: 0,
				skillGapAnalyses: 0,
				learningPaths: 0,
				companyResearchBriefs: 0,
				salaryPracticeSessions: 0,
				profileToolProgress: 0,
				careerCoachSessions: 0,
				applicationOptimizations: 0,
				comments: 0,
				commentMentions: 0,
				portfolioProjects: 0,
				candidateJobActions: 0,
				savedJobs: 0,
				jobAlerts: 0,
				rowsHeld: 0,
				heldTables: [],
				holdLookupFailed: 0,
				lookupFailedTables: [],
				storageLedgered: 0,
			},
			storageKeys: [],
		});
		expect(biometricAudit.logAccess).not.toHaveBeenCalled();
	});

	test('rethrows non-DEKNotFound errors (caller rolls back)', async () => {
		// #799: the FIRST query is now the legal-hold check, and it is
		// fail-closed — a DB error there aborts the erasure with a typed
		// LegalHoldError (nothing is deleted), which the caller rolls
		// back exactly like any other erasure error.
		const client = { query: jest.fn().mockRejectedValue(new Error('db down')) };
		const err = await erasePersonalData(7, { client }).catch((e) => e);
		expect(err.code).toBe('LEGAL_HOLD');
		expect(biometricAudit.logAccess).not.toHaveBeenCalled();
	});

	test('F-8 (PR-gate fix round): a destroyDEK-stage error still propagates RAW once the hold check has passed', async () => {
		// Privacy F-8: the test above now asserts the hold-check stage's
		// fail-closed semantics, which removed coverage that an error at
		// the destroyDEK stage itself (hold check passed, DEK UPDATE
		// fails) propagates unchanged — not wrapped as LEGAL_HOLD.
		const client = {
			query: jest
				.fn()
				.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // #799 legal-hold check: no hold
				.mockRejectedValueOnce(new Error('dek db down')), // destroyDEK UPDATE fails
		};
		const err = await erasePersonalData(7, { client }).catch((e) => e);
		expect(err.message).toBe('dek db down');
		expect(err.code).not.toBe('LEGAL_HOLD');
		expect(biometricAudit.logAccess).not.toHaveBeenCalled();
	});
});
