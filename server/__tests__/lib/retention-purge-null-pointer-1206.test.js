/**
 * #1206: purgeExpiredRecordings must NULL interview_recordings.storage_path
 * when it marks a row deleted (erasure keep-redacted parity), and must leave
 * the row fully unchanged whenever the storage object was not deleted.
 *
 * The db mock below is a tiny state machine: the purge's UPDATE is applied
 * to the seeded row exactly as written — `storage_path = NULL` in the SQL
 * clears the pointer, its absence retains it — so these tests assert the
 * RESULTING ROW, not just call shapes.
 */
jest.mock('../../../lib/db', () => ({ query: jest.fn() }));
jest.mock('../../../lib/file-storage', () => ({
	deleteStorageObject: jest.fn(),
	deleteFile: jest.fn(),
}));
jest.mock('../../../lib/sessionRecordingStore', () => ({
	deleteRecordingObjectVerified: jest.fn(),
}));
jest.mock('../../../lib/observerCapture', () => ({
	isLegalHoldActive: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../../lib/legalHold', () => ({
	anyHoldActive: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../../services/auditLogService', () => ({
	logEvent: jest.fn().mockResolvedValue({}),
	EVENT_TYPES: { STATUS_CHANGE: 'status_change' },
}));
jest.mock('../../services/livekit', () => ({
	decryptStoragePath: jest.fn(),
}));

const db = require('../../../lib/db');
const { deleteStorageObject } = require('../../../lib/file-storage');
const { deleteRecordingObjectVerified } = require('../../../lib/sessionRecordingStore');
const livekit = require('../../services/livekit');
const EuComplianceService = require('../../../services/euComplianceService');

const S3_KEY = 's3://egress-bucket/rekrut-recordings/room-1-123.mp4.enc';

let row;

function installDb() {
	db.query.mockImplementation(async (sql) => {
		if (sql.includes('FROM interview_recordings')) {
			return { rows: row.status === 'deleted' ? [] : [{ ...row }], rowCount: 1 };
		}
		if (sql.includes('UPDATE interview_recordings')) {
			row.status = 'deleted';
			if (/storage_path\s*=\s*NULL/i.test(sql)) row.storage_path = null;
			return { rows: [], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	require('../../../lib/observerCapture').isLegalHoldActive.mockResolvedValue(false);
	row = {
		id: 9,
		storage_path: Buffer.from('enc-pointer'),
		candidate_id: null,
		interview_session_id: null,
	};
	installDb();
});

test('verified s3 delete ⇒ status deleted AND storage_path NULL', async () => {
	livekit.decryptStoragePath.mockReturnValue(S3_KEY);
	deleteRecordingObjectVerified.mockResolvedValue(undefined);
	const r = await EuComplianceService.purgeExpiredRecordings({ dryRun: false });
	expect(r.errors).toBe(0);
	expect(row.status).toBe('deleted');
	expect(row.storage_path).toBeNull();
});

test('provider-prefixed delete success ⇒ status deleted AND storage_path NULL', async () => {
	livekit.decryptStoragePath.mockReturnValue('r2/frames/x.bin');
	deleteStorageObject.mockResolvedValue({ deleted: true });
	const r = await EuComplianceService.purgeExpiredRecordings({ dryRun: false });
	expect(r.errors).toBe(0);
	expect(row.status).toBe('deleted');
	expect(row.storage_path).toBeNull();
});

test('no-pointer row ⇒ deleted, pointer stays NULL', async () => {
	row.storage_path = null;
	const r = await EuComplianceService.purgeExpiredRecordings({ dryRun: false });
	expect(r.errors).toBe(0);
	expect(row.status).toBe('deleted');
	expect(row.storage_path).toBeNull();
});

test('undecryptable pointer ⇒ row fully unchanged', async () => {
	livekit.decryptStoragePath.mockReturnValue(null);
	const r = await EuComplianceService.purgeExpiredRecordings({ dryRun: false });
	expect(r.errors).toBe(1);
	expect(r.errorClassCounts).toEqual({ storage_path_undecryptable: 1 });
	expect(row.status).not.toBe('deleted');
	expect(row.storage_path).not.toBeNull();
});

test('soft-failed delete ⇒ row fully unchanged', async () => {
	livekit.decryptStoragePath.mockReturnValue('r2/frames/x.bin');
	deleteStorageObject.mockResolvedValue({ deleted: false, reason: 'provider_not_configured' });
	const r = await EuComplianceService.purgeExpiredRecordings({ dryRun: false });
	expect(r.errors).toBe(1);
	expect(row.status).not.toBe('deleted');
	expect(row.storage_path).not.toBeNull();
});

test('dry-run ⇒ row fully unchanged, no storage calls', async () => {
	livekit.decryptStoragePath.mockReturnValue(S3_KEY);
	const r = await EuComplianceService.purgeExpiredRecordings({ dryRun: true });
	expect(r.dryRun).toBe(true);
	expect(deleteRecordingObjectVerified).not.toHaveBeenCalled();
	expect(deleteStorageObject).not.toHaveBeenCalled();
	expect(row.status).not.toBe('deleted');
	expect(row.storage_path).not.toBeNull();
});
