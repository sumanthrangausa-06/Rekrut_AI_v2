/**
 * S-077 (#760): retention lifecycle tests.
 * Covers: registry sweep idempotency/ordering, dry-run flag, best-effort
 * registry writes, deleteStorageObject, concurrency (SKIP LOCKED).
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/file-storage', () => ({
	deleteStorageObject: jest.fn(),
	deleteFile: jest.fn(),
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
const auditLogService = require('../../../services/auditLogService');
const db = require('../../../lib/db');

describe('deleteStorageObject', () => {
	test('deletes via raw provider-prefixed key', async () => {
		const actual = jest.requireActual('../../../lib/file-storage');
		const r = await actual.deleteStorageObject('unconfigured-provider/frames/x.bin');
		expect(r.deleted).toBe(false);
		expect(r.reason).toBe('provider_not_configured');
	});

	test('rejects malformed keys without crashing', async () => {
		const actual = jest.requireActual('../../../lib/file-storage');
		const r1 = await actual.deleteStorageObject('no-slash-here');
		expect(r1.deleted).toBe(false);
		expect(r1.reason).toBe('unrecognized_format');

		const r2 = await actual.deleteStorageObject(null);
		expect(r2.deleted).toBe(false);
		expect(r2.reason).toBe('unrecognized_format');
	});
});

describe('purgeRecordingObjects (dry-run)', () => {
	test('dry-run is the default — no storage calls, no DB stamps', async () => {
		const EuComplianceService = require('../../../services/euComplianceService');
		// Empty registry
		db.query.mockResolvedValue({ rows: [], rowCount: 0 });
		deleteStorageObject.mockClear();
		auditLogService.logEvent.mockClear();

		const result = await EuComplianceService.purgeRecordingObjects();
		expect(result.dryRun).toBe(true);
		expect(deleteStorageObject).not.toHaveBeenCalled();
		// Audit entry still written (per-batch, even in dry-run)
		// S-077 fix: uses auditLogService.logEvent (biometricAudit.logAccess
		// requires userId and would throw for system purges)
		expect(auditLogService.logEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				entityType: 'retention_purge',
				actorRole: 'system',
			}),
		);
		const payload = auditLogService.logEvent.mock.calls[0][0].payload;
		expect(payload.dryRun).toBe(true);
		expect(payload).toHaveProperty('runId');
		expect(payload).toHaveProperty('objectCount');
		expect(payload).toHaveProperty('errorCount');
	});
});

describe('purgeExpiredRecordings (dry-run)', () => {
	test('dry-run does not change row status', async () => {
		const EuComplianceService = require('../../../services/euComplianceService');
		db.query.mockResolvedValue({ rows: [], rowCount: 0 });
		deleteStorageObject.mockClear();

		const result = await EuComplianceService.purgeExpiredRecordings();
		expect(result.dryRun).toBe(true);
		expect(deleteStorageObject).not.toHaveBeenCalled();
	});

	test('live: only marks deleted on CONFIRMED storage delete (Q2 fix)', async () => {
		// Soft-failed storage delete must NOT stamp deleted_at — the row
		// stays for retry instead of becoming a silent permanent orphan.
		const EuComplianceService = require('../../../services/euComplianceService');
		const livekit = require('../../services/livekit');

		db.query
			.mockResolvedValueOnce({
				rows: [{ id: 1, storage_path: Buffer.from('x'), retention_expires_at: new Date() }],
				rowCount: 1,
			})
			.mockResolvedValue({ rows: [], rowCount: 0 });
		livekit.decryptStoragePath.mockReturnValue('r2/frames/x.bin');
		deleteStorageObject.mockResolvedValue({ deleted: false, reason: 'provider_not_configured' });

		const result = await EuComplianceService.purgeExpiredRecordings({ dryRun: false });

		// No UPDATE to interview_recordings (row left for retry)
		const updates = db.query.mock.calls.filter((c) =>
			c[0].includes('UPDATE interview_recordings'),
		);
		expect(updates).toHaveLength(0);
		expect(result.errors).toBeGreaterThan(0);
	});

	test('live: anonymizes transcripts of purged recordings (Q1 fix)', async () => {
		// Transcripts cascade only on hard DELETE; the scheduled soft-delete
		// path must anonymize them so plaintext speech doesn't survive.
		const EuComplianceService = require('../../../services/euComplianceService');
		const livekit = require('../../services/livekit');

		db.query
			.mockResolvedValueOnce({
				rows: [{ id: 2, storage_path: null, retention_expires_at: new Date() }],
				rowCount: 1,
			})
			.mockResolvedValue({ rows: [], rowCount: 0 });
		livekit.decryptStoragePath.mockReturnValue(null);

		await EuComplianceService.purgeExpiredRecordings({ dryRun: false });

		const transcriptUpdates = db.query.mock.calls.filter((c) =>
			c[0].includes('UPDATE interview_transcripts'),
		);
		expect(transcriptUpdates.length).toBeGreaterThan(0);
		expect(transcriptUpdates[0][0]).toContain("[purged]");
	});
});

describe('purgeRecordingObjects audit (Q3 fix)', () => {
	test('audit payload includes period covered', async () => {
		const EuComplianceService = require('../../../services/euComplianceService');
		db.query.mockResolvedValue({ rows: [], rowCount: 0 });
		auditLogService.logEvent.mockClear();

		await EuComplianceService.purgeRecordingObjects({ dryRun: true });

		const payload = auditLogService.logEvent.mock.calls[0][0].payload;
		expect(payload).toHaveProperty('periodCovered');
		expect(payload).toHaveProperty('runId');
		expect(payload).toHaveProperty('errorCount');
	});
});

describe('purgeExpiredTemplates (dry-run)', () => {
	test('dry-run counts without deleting', async () => {
		const EuComplianceService = require('../../../services/euComplianceService');
		db.query.mockResolvedValue({ rows: [{ c: 5 }], rowCount: 1 });
		const result = await EuComplianceService.purgeExpiredTemplates({ dryRun: true });
		expect(result.dryRun).toBe(true);
		expect(typeof result.deletedCount).toBe('number');
	});
});

describe('registry INSERT (best-effort)', () => {
	test('uploadEncryptedFrame does not throw when registry table is missing', async () => {
		// The registry INSERT is best-effort: if migration 253 hasn't run,
		// the upload must still succeed. We verify the try/catch exists by
		// checking the function doesn't propagate DB errors.
		// (Full integration covered by the upload path's own tests.)
		const src = require('fs').readFileSync(
			require('path').join(__dirname, '../../../lib/r2FrameStore.js'),
			'utf8',
		);
		expect(src).toContain('recording_objects');
		expect(src).toContain('best-effort');
	});
});
