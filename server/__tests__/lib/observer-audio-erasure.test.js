/**
 * observer-audio erasure composition (T8/T9) — Gate A (S-085 #787), design §5.2.
 * erasePersonalData must collect observer_audio registry + chunk keys into
 * the migration-252 deletion ledger (source_family='observer_audio'), drop
 * chunk/measurement/outcome rows, and stamp (not delete) the registry row.
 */
const mockErasure = { regRows: [], chunkKeyRows: [], calls: [] };
const mockPool = {
	query: jest.fn(async (sql, params = []) => {
		mockErasure.calls.push(sql);
		// #799/#915: legal-hold check (lib/legalHold.js) — this suite seeds
		// no holds; held behaviour is covered by legal-hold.test.js. This
		// branch must precede the interview_sessions branch: since the
		// #915 F-1 fix, the legal_holds query itself contains an
		// interview_sessions subquery (candidate company attribution).
		if (sql.includes('FROM legal_holds')) return { rows: [], rowCount: 0 };
		if (sql.includes('FROM interview_sessions')) return { rows: [{ id: 42, candidate_name: 'x', candidate_email: 'x@y.z' }] };
		if (sql.includes("registration_state = 'confirmed'") && sql.includes('recording_objects')) return { rows: mockErasure.regRows };
		if (sql.includes('SELECT object_key FROM observer_audio_chunks')) return { rows: mockErasure.chunkKeyRows };
		if (sql.includes('INSERT INTO pending_storage_deletions')) return { rows: [], rowCount: 1 };
		if (sql.includes('DELETE FROM ai_screening_sessions')) return { rows: [], rowCount: 0 };
		if (sql.includes('DELETE FROM')) return { rows: [], rowCount: 1 };
		if (sql.includes('UPDATE recording_objects SET deleted_at')) return { rows: [], rowCount: 1 };
		if (sql.includes('SELECT')) return { rows: [] };
		return { rows: [], rowCount: 0 };
	}),
	connect: jest.fn(async () => ({ query: mockPool.query, release: jest.fn() })),
};
jest.mock('../../../lib/db', () => mockPool);
jest.mock('../../../lib/biometricAudit', () => ({ logAccess: jest.fn(async () => {}) }));
jest.mock('../../../lib/file-storage', () => ({
	deleteStorageObject: jest.fn(async () => ({ deleted: true })),
	storageKeysToFileUrls: (keys) => keys.map((key) => `/api/files/${encodeURIComponent(key)}`),
}));
jest.mock('../../../lib/notificationScheduler', () => ({ cancelNotificationsForUser: jest.fn(async () => {}) }), { virtual: true });
process.env.BIOMETRIC_ENCRYPTION_KEY = process.env.BIOMETRIC_ENCRYPTION_KEY || 'c'.repeat(64);

const { erasePersonalData, deleteErasedStorageFiles } = require('../../../lib/erasureService');

const REG_KEY = 'r2/observer-audio-test/audio-aaaa.enc';
const CHUNK_KEY_2 = 'r2/observer-audio-test/audio-bbbb.enc';

describe('erasePersonalData — observer_audio composition (§5.2)', () => {
	beforeEach(() => {
		mockErasure.regRows = [{ object_key: REG_KEY }];
		mockErasure.chunkKeyRows = [{ object_key: REG_KEY }, { object_key: CHUNK_KEY_2 }];
		mockErasure.calls = [];
		mockPool.query.mockClear();
	});

	test('T8: registry + chunk keys reach the ledger deduped with source_family, rows dropped, registry stamped', async () => {
		const result = await erasePersonalData(7, { client: { query: mockPool.query } });
		expect(result.observerAudioChunksDeleted).toBe(true);
		expect(result.observerSpeechMeasurementsDeleted).toBe(true);
		expect(result.observerCaptureOutcomesDeleted).toBe(true);
		expect(result.storageKeys).toEqual(expect.arrayContaining([
			`/api/files/${encodeURIComponent(REG_KEY)}`,
			`/api/files/${encodeURIComponent(CHUNK_KEY_2)}`,
		]));
		const ledgerInserts = mockErasure.calls.filter((s) => s.includes('INSERT INTO pending_storage_deletions'));
		expect(ledgerInserts.length).toBe(2); // deduped — REG_KEY appears in both sources, inserted once per key
		expect(mockErasure.calls.some((s) => s.includes('DELETE FROM observer_audio_chunks'))).toBe(true);
		expect(mockErasure.calls.some((s) => s.includes('DELETE FROM observer_speech_measurements'))).toBe(true);
		expect(mockErasure.calls.some((s) => s.includes('DELETE FROM observer_capture_outcomes'))).toBe(true);
		expect(mockErasure.calls.some((s) => s.includes('DELETE FROM recording_objects'))).toBe(false);
		expect(mockErasure.calls.some((s) => s.includes('UPDATE recording_objects SET deleted_at'))).toBe(true);
		// The observer block runs on the caller's transaction client
		// under the per-candidate advisory lock (§5.2 lock order)
		expect(mockErasure.calls.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
	});

	test('erasure with no observer artefacts ⇒ flags false, no ledger writes for them', async () => {
		mockErasure.regRows = [];
		mockErasure.chunkKeyRows = [];
		const result = await erasePersonalData(7, { client: { query: mockPool.query } });
		expect(result.observerAudioChunksDeleted).toBe(false);
		expect(result.storageKeys.filter((k) => k.includes('observer-audio'))).toHaveLength(0);
	});

	test('#780: job_applications SELECT is issued in sequence; no applications ⇒ flags false/0', async () => {
		const result = await erasePersonalData(7, { client: { query: mockPool.query } });
		// The generic SELECT branch of this router answers the #780
		// job_applications lookup with no rows — no per-row hold consults,
		// no UPDATE, and the §4 return additions report false/0.
		expect(mockErasure.calls.some((s) => s.includes('FROM job_applications'))).toBe(true);
		expect(mockErasure.calls.some((s) => s.includes('UPDATE job_applications'))).toBe(false);
		expect(result.jobApplicationsRedacted).toBe(false);
		expect(result.jobApplicationRowsHeld).toBe(0);
	});

	test('#813: C2 SELECTs are issued in sequence; no rows ⇒ flags false/0, tombstone null', async () => {
		const result = await erasePersonalData(7, { client: { query: mockPool.query } });
		// The generic SELECT branch answers the five C2 lookups with no
		// rows — no DELETEs on the five, no D-1 child DELETEs.
		for (const t of ['screening_responses', 'job_application_screenings', 'ai_screenings', 'outreach_attempts', 'auto_apply_profiles']) {
			expect(mockErasure.calls.some((x) => x.includes(`FROM ${t}`))).toBe(true);
			expect(mockErasure.calls.some((x) => x.includes(`DELETE FROM ${t}`))).toBe(false);
		}
		expect(result.screeningResponsesDeleted).toBe(false);
		expect(result.aiScreeningsDeleted).toBe(false);
		expect(result.autoApplyProfileDeleted).toBe(false);
		expect(result.applicationKeyedRowsHeld).toBe(0);
		expect(result.autoApplyConsentTombstone).toBeNull();
	});

	test('T9: Phase 2 deletes the ledger URLs (objects actually removed)', async () => {
		const result = await erasePersonalData(7, { client: { query: mockPool.query } });
		const phase2 = await deleteErasedStorageFiles(result.storageKeys);
		expect(phase2.failed).toBe(0);
		expect(phase2.deleted).toBe(result.storageKeys.length);
	});
});
