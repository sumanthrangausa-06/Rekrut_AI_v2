/**
 * #1204: recording_objects purge consumer cannot address s3:// object_key form.
 *
 * #1130 / GAP-A3 register session recordings as `s3://<bucket>/<key>.enc`
 * (the RECORDING_STORAGE_* egress bucket). purgeRecordingObjects used to
 * pass that verbatim to file-storage deleteStorageObject, which parses the
 * segment before the first `/` as a provider name — `s3:` matches nothing,
 * so the delete soft-failed (provider_not_configured) and the registry row
 * was never stamped deleted.
 *
 * Fix: the purge consumers route s3:// keys to the RECORDING_STORAGE_*
 * client (sessionRecordingStore.deleteRecordingObjectVerified — bucket
 * checked against RECORDING_STORAGE_BUCKET, delete verified). A failure
 * there is a soft-fail exactly like provider_not_configured today: error
 * counted, row left unstamped for retry, never a false stamp.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/file-storage', () => ({
	deleteStorageObject: jest.fn(),
	deleteFile: jest.fn(),
}));
jest.mock('../../../lib/sessionRecordingStore', () => ({
	deleteRecordingObjectVerified: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../services/auditLogService', () => ({
	logEvent: jest.fn().mockResolvedValue({}),
	EVENT_TYPES: { STATUS_CHANGE: 'status_change' },
}));
jest.mock('../../services/livekit', () => ({
	decryptStoragePath: jest.fn(),
}));

const { deleteStorageObject } = require('../../../lib/file-storage');
const { deleteRecordingObjectVerified } = require('../../../lib/sessionRecordingStore');
const db = require('../../../lib/db');

const S3_KEY = 's3://egress-bucket/rekrut-recordings/room-1-123.mp4.enc';
const R2_KEY = 'r2/frames/video-frame-abc123.bin';

function registryRow(objectKey, objectType = 'recording') {
	return {
		object_key: objectKey,
		object_type: objectType,
		expires_at: new Date(Date.now() - 1000),
		candidate_id: 7,
		interview_id: 55,
	};
}

/** Route db.query by SQL shape; registry SELECT returns `rows`. */
function mockDb(rows) {
	db.query.mockImplementation(async (sql) => {
		if (sql.includes('FROM recording_objects')) return { rows, rowCount: rows.length };
		// Legal-hold session resolution (fail-closed when the session row is
		// missing): the fixture session exists and carries no company hold.
		if (sql.includes('FROM interview_sessions'))
			return { rows: [{ candidate_id: 7, company_id: null }], rowCount: 1 };
		return { rows: [], rowCount: 0 };
	});
}

function stampCalls() {
	return db.query.mock.calls.filter((c) =>
		c[0].includes('UPDATE recording_objects SET deleted_at'),
	);
}

beforeEach(() => {
	jest.clearAllMocks();
	db.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('#1204 purgeRecordingObjects — s3:// registry keys', () => {
	test('s3:// key routes to the RECORDING_STORAGE_* verified delete, not deleteStorageObject, and is stamped on success', async () => {
		const EuComplianceService = require('../../../services/euComplianceService');
		mockDb([registryRow(S3_KEY)]);
		deleteRecordingObjectVerified.mockResolvedValue(true);
		deleteStorageObject.mockResolvedValue({ deleted: true });

		const result = await EuComplianceService.purgeRecordingObjects({ dryRun: false });

		expect(deleteRecordingObjectVerified).toHaveBeenCalledTimes(1);
		expect(deleteRecordingObjectVerified).toHaveBeenCalledWith(S3_KEY);
		expect(deleteStorageObject).not.toHaveBeenCalledWith(S3_KEY);
		expect(stampCalls()).toHaveLength(1);
		expect(stampCalls()[0][1]).toEqual([S3_KEY]);
		expect(result.storageDeleted).toBe(1);
		expect(result.errors).toBe(0);
	});

	test('s3:// verified delete failure (bucket mismatch / not configured) → NO stamp, error counted, row left for retry', async () => {
		const EuComplianceService = require('../../../services/euComplianceService');
		mockDb([registryRow(S3_KEY)]);
		deleteRecordingObjectVerified.mockRejectedValue(
			Object.assign(new Error('bucket does not match the RECORDING_STORAGE bucket'), {
				code: 'BUCKET_MISMATCH',
			}),
		);

		const result = await EuComplianceService.purgeRecordingObjects({ dryRun: false });

		expect(deleteRecordingObjectVerified).toHaveBeenCalledWith(S3_KEY);
		expect(stampCalls()).toHaveLength(0);
		expect(result.storageDeleted).toBe(0);
		expect(result.errors).toBeGreaterThan(0);
		// Review F-3: a soft-failed row is not purged and must not be
		// counted as such (the audit entry's objectCount uses purgedCount).
		expect(result.purgedCount).toBe(0);
	});

	test('malformed s3:// keys never reach the recording store and are never stamped (review F-1)', async () => {
		const EuComplianceService = require('../../../services/euComplianceService');
		mockDb([registryRow('s3://egress-bucket'), registryRow('s3:///key.enc')]);
		deleteRecordingObjectVerified.mockResolvedValue(true);

		const result = await EuComplianceService.purgeRecordingObjects({ dryRun: false });

		expect(deleteRecordingObjectVerified).not.toHaveBeenCalled();
		expect(deleteStorageObject).not.toHaveBeenCalled();
		expect(stampCalls()).toHaveLength(0);
		expect(result.storageDeleted).toBe(0);
		expect(result.errors).toBe(2);
		expect(result.purgedCount).toBe(0);
	});

	test('mixed batch: an s3 failure does not block an r2 success, and failure logs never contain the storage key (review F-5/F-8)', async () => {
		const EuComplianceService = require('../../../services/euComplianceService');
		mockDb([registryRow(S3_KEY), registryRow(R2_KEY, 'frame')]);
		deleteRecordingObjectVerified.mockRejectedValue(
			Object.assign(new Error('boom'), { code: 'CONFIG_ERROR' }),
		);
		deleteStorageObject.mockResolvedValue({ deleted: true });
		const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

		try {
			const result = await EuComplianceService.purgeRecordingObjects({ dryRun: false });

			expect(deleteStorageObject).toHaveBeenCalledWith(R2_KEY);
			expect(stampCalls()).toHaveLength(1);
			expect(stampCalls()[0][1]).toEqual([R2_KEY]);
			expect(result.storageDeleted).toBe(1);
			expect(result.purgedCount).toBe(1);
			expect(result.errors).toBe(1);
			const warned = warnSpy.mock.calls.flat().join(' ');
			expect(warned).not.toContain(S3_KEY);
			expect(warned).not.toContain('egress-bucket');
		} finally {
			warnSpy.mockRestore();
		}
	});

	test('provider-prefixed key still routes to deleteStorageObject (unchanged path)', async () => {
		const EuComplianceService = require('../../../services/euComplianceService');
		mockDb([registryRow(R2_KEY, 'frame')]);
		deleteStorageObject.mockResolvedValue({ deleted: true });

		const result = await EuComplianceService.purgeRecordingObjects({ dryRun: false });

		expect(deleteStorageObject).toHaveBeenCalledWith(R2_KEY);
		expect(deleteRecordingObjectVerified).not.toHaveBeenCalled();
		expect(stampCalls()).toHaveLength(1);
		expect(result.storageDeleted).toBe(1);
	});

	test('dry-run (default) makes zero storage calls for s3:// rows', async () => {
		const EuComplianceService = require('../../../services/euComplianceService');
		mockDb([registryRow(S3_KEY)]);

		const result = await EuComplianceService.purgeRecordingObjects();

		expect(result.dryRun).toBe(true);
		expect(deleteRecordingObjectVerified).not.toHaveBeenCalled();
		expect(deleteStorageObject).not.toHaveBeenCalled();
		expect(stampCalls()).toHaveLength(0);
	});
});

describe('#1204 purgeExpiredRecordings — s3:// decrypted pointer (same file, same disease)', () => {
	test('s3:// storage pointer routes to the verified recording delete and the row is marked deleted', async () => {
		const EuComplianceService = require('../../../services/euComplianceService');
		const livekit = require('../../services/livekit');
		db.query.mockImplementation(async (sql) => {
			if (sql.includes('FROM interview_recordings')) {
				return {
					rows: [
						{
							id: 9,
							storage_path: Buffer.from('enc-pointer'),
							candidate_id: 7,
							interview_session_id: 55,
						},
					],
					rowCount: 1,
				};
			}
			if (sql.includes('FROM interview_sessions'))
				return { rows: [{ candidate_id: 7, company_id: null }], rowCount: 1 };
			return { rows: [], rowCount: 0 };
		});
		livekit.decryptStoragePath.mockReturnValue(S3_KEY);
		deleteRecordingObjectVerified.mockResolvedValue(true);

		const result = await EuComplianceService.purgeExpiredRecordings({ dryRun: false });

		expect(deleteRecordingObjectVerified).toHaveBeenCalledWith(S3_KEY);
		expect(deleteStorageObject).not.toHaveBeenCalledWith(S3_KEY);
		const updates = db.query.mock.calls.filter((c) =>
			c[0].includes('UPDATE interview_recordings'),
		);
		expect(updates).toHaveLength(1);
		expect(result.storageDeleted).toBe(1);
		expect(result.errors).toBe(0);
	});

	test('s3:// verified delete failure → recording row NOT marked deleted (left for retry)', async () => {
		const EuComplianceService = require('../../../services/euComplianceService');
		const livekit = require('../../services/livekit');
		db.query.mockImplementation(async (sql) => {
			if (sql.includes('FROM interview_recordings')) {
				return {
					rows: [
						{
							id: 10,
							storage_path: Buffer.from('enc-pointer'),
							candidate_id: 7,
							interview_session_id: 55,
						},
					],
					rowCount: 1,
				};
			}
			if (sql.includes('FROM interview_sessions'))
				return { rows: [{ candidate_id: 7, company_id: null }], rowCount: 1 };
			return { rows: [], rowCount: 0 };
		});
		livekit.decryptStoragePath.mockReturnValue(S3_KEY);
		deleteRecordingObjectVerified.mockRejectedValue(
			Object.assign(new Error('RECORDING_STORAGE_* required'), { code: 'CONFIG_ERROR' }),
		);

		const result = await EuComplianceService.purgeExpiredRecordings({ dryRun: false });

		const updates = db.query.mock.calls.filter((c) =>
			c[0].includes('UPDATE interview_recordings'),
		);
		expect(updates).toHaveLength(0);
		expect(result.errors).toBeGreaterThan(0);
	});

	test('undecryptable storage pointer → recording row NOT marked deleted (review F-2, pre-existing fail-open)', async () => {
		const EuComplianceService = require('../../../services/euComplianceService');
		const livekit = require('../../services/livekit');
		db.query.mockImplementation(async (sql) => {
			if (sql.includes('FROM interview_recordings')) {
				return {
					rows: [
						{
							id: 11,
							storage_path: Buffer.from('enc-pointer'),
							candidate_id: 7,
							interview_session_id: 55,
						},
					],
					rowCount: 1,
				};
			}
			if (sql.includes('FROM interview_sessions'))
				return { rows: [{ candidate_id: 7, company_id: null }], rowCount: 1 };
			return { rows: [], rowCount: 0 };
		});
		// decryptStoragePath returns null on ANY decrypt error.
		livekit.decryptStoragePath.mockReturnValue(null);

		const result = await EuComplianceService.purgeExpiredRecordings({ dryRun: false });

		const updates = db.query.mock.calls.filter((c) =>
			c[0].includes('UPDATE interview_recordings'),
		);
		expect(updates).toHaveLength(0);
		expect(result.errors).toBeGreaterThan(0);
		expect(deleteRecordingObjectVerified).not.toHaveBeenCalled();
		expect(deleteStorageObject).not.toHaveBeenCalled();
	});
});
