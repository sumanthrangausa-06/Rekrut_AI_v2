/**
 * #1125 GAP-F — send-time guard (STOP 1 §5).
 *
 * Deleting queued rows cannot stop a send already claimed into
 * memory, and legal-held rows survive erasure as pending — so both
 * LIVE processors re-check at send time:
 *
 *   1. lib/email-queue.js processBatch — per item, immediately
 *      before processorFn: (a) re-read the row; gone or no longer
 *      'pending' ⇒ skip (erasure won the race); (b) resolve the
 *      recipient against users — tombstoned/deleted OR not resolving
 *      to any live user ⇒ suppress. Suppression NEVER mutates the
 *      row (no markSent/markFailed — a held row stays pending and
 *      re-suppresses each pass until the hold resolves).
 *      (§5.4 build-entry check: sendEmailWithQueue has zero callers
 *      in the repo, so clause (b) breaks no designed non-user flow.)
 *   2. lib/email-service.js processQueue — guard at the top of the
 *      per-item loop, BEFORE the 'processing' UPDATE: user_id
 *      resolving to a tombstoned/deleted user, or (for user_id-less
 *      items) the email failing the same liveness rule ⇒
 *      result.skipped++ and continue, row untouched.
 *
 * Nothing is guarded in server/services/email-service.js (dead code,
 * zero requires — STOP 1 §1.2).
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn(),
}));
jest.mock('../../../lib/file-storage', () => ({
	deleteFile: jest.fn().mockResolvedValue({ deleted: true }),
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

const pool = require('../../../lib/db');
const emailQueue = require('../../../lib/email-queue');
const emailService = require('../../../lib/email-service');

function callsMatching(re) {
	return pool.query.mock.calls.filter(([sql]) => re.test(sql));
}

describe('#1125 GAP-F guard — lib/email-queue processBatch', () => {
	let processorFn;
	beforeEach(() => {
		jest.clearAllMocks();
		emailQueue.processing = false;
		processorFn = jest.fn().mockResolvedValue(undefined);
		emailQueue.processorFn = processorFn;
	});

	function mockQueue({ pending = [], fresh = {}, usersByEmail = {} } = {}) {
		pool.query.mockImplementation(async (sql, params = []) => {
			if (/SELECT \* FROM email_queue/i.test(sql)) return { rows: pending, rowCount: pending.length };
			if (/SELECT id, status FROM email_queue WHERE id = \$1/i.test(sql)) {
				const row = fresh[params[0]];
				return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
			}
			if (/FROM users WHERE email = \$1/i.test(sql)) {
				const rows = usersByEmail[params[0]] || [];
				return { rows, rowCount: rows.length };
			}
			return { rows: [], rowCount: 1 };
		});
	}

	const pendingRow = {
		id: 5,
		recipient: 'candidate@example.com',
		subject: 'Hi',
		body: 'Body',
		html_body: null,
		metadata: '{}',
		status: 'pending',
	};

	test('row-gone skip: a row deleted after getPending (erasure won the race) is not sent and not mutated', async () => {
		mockQueue({ pending: [pendingRow], fresh: {}, usersByEmail: {} });
		await emailQueue.processBatch();

		expect(processorFn).not.toHaveBeenCalled();
		expect(callsMatching(/UPDATE email_queue/i)).toHaveLength(0);
	});

	test('no-longer-pending skip: a row claimed/sent by another path is not re-sent', async () => {
		mockQueue({
			pending: [pendingRow],
			fresh: { 5: { id: 5, status: 'sent' } },
			usersByEmail: { 'candidate@example.com': [{ id: 7, deleted_at: null }] },
		});
		await emailQueue.processBatch();

		expect(processorFn).not.toHaveBeenCalled();
		expect(callsMatching(/UPDATE email_queue/i)).toHaveLength(0);
	});

	test('tombstoned recipient: suppressed WITHOUT row mutation (no markSent/markFailed — held material stays unaltered)', async () => {
		mockQueue({
			pending: [pendingRow],
			fresh: { 5: { id: 5, status: 'pending' } },
			usersByEmail: {
				'candidate@example.com': [{ id: 7, deleted_at: new Date('2026-10-14T00:00:00Z') }],
			},
		});
		await emailQueue.processBatch();

		expect(processorFn).not.toHaveBeenCalled();
		expect(callsMatching(/UPDATE email_queue/i)).toHaveLength(0);
	});

	test('unresolvable recipient: no live user with that address ⇒ suppressed without mutation', async () => {
		mockQueue({
			pending: [{ ...pendingRow, recipient: 'ghost@example.com' }],
			fresh: { 5: { id: 5, status: 'pending' } },
			usersByEmail: {},
		});
		await emailQueue.processBatch();

		expect(processorFn).not.toHaveBeenCalled();
		expect(callsMatching(/UPDATE email_queue/i)).toHaveLength(0);
	});

	test('live recipient passes: processorFn runs and the row is marked sent', async () => {
		mockQueue({
			pending: [pendingRow],
			fresh: { 5: { id: 5, status: 'pending' } },
			usersByEmail: { 'candidate@example.com': [{ id: 7, deleted_at: null }] },
		});
		await emailQueue.processBatch();

		expect(processorFn).toHaveBeenCalledTimes(1);
		expect(processorFn.mock.calls[0][0]).toMatchObject({ id: 5, to: 'candidate@example.com' });
		const updates = callsMatching(/UPDATE email_queue/i);
		expect(updates).toHaveLength(1);
		expect(updates[0][0]).toMatch(/SET status = 'sent'/);
	});
});

describe('#1125 GAP-F guard — lib/email-service processQueue', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	function mockQueue({ items = [], usersById = {}, usersByEmail = {} } = {}) {
		pool.query.mockImplementation(async (sql, params = []) => {
			if (/FROM notification_queue nq/i.test(sql)) return { rows: items, rowCount: items.length };
			if (/FROM users WHERE id = \$1/i.test(sql)) {
				const row = usersById[params[0]];
				return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
			}
			if (/FROM users WHERE email = \$1/i.test(sql)) {
				const rows = usersByEmail[params[0]] || [];
				return { rows, rowCount: rows.length };
			}
			return { rows: [], rowCount: 1 };
		});
	}

	const queueItem = {
		id: 9,
		user_id: 7,
		email: 'candidate@example.com',
		type: 'custom',
		template_name: null,
		template_data: JSON.stringify({ subject: 'Hi', body: 'Body' }),
	};

	test('tombstoned user_id: skipped++ BEFORE the processing UPDATE, row untouched', async () => {
		mockQueue({
			items: [queueItem],
			usersById: { 7: { id: 7, deleted_at: new Date('2026-10-14T00:00:00Z') } },
		});
		const result = await emailService.processQueue(20);

		expect(result.skipped).toBe(1);
		expect(result.succeeded).toBe(0);
		expect(result.failed).toBe(0);
		expect(callsMatching(/UPDATE notification_queue/i)).toHaveLength(0);
	});

	test('deleted user_id (row gone): skipped++, row untouched', async () => {
		mockQueue({ items: [queueItem], usersById: {} });
		const result = await emailService.processQueue(20);

		expect(result.skipped).toBe(1);
		expect(callsMatching(/UPDATE notification_queue/i)).toHaveLength(0);
	});

	test('NULL user_id with an unresolvable email: skipped++, row untouched', async () => {
		mockQueue({
			items: [{ ...queueItem, user_id: null, email: 'ghost@example.com' }],
			usersByEmail: {},
		});
		const result = await emailService.processQueue(20);

		expect(result.skipped).toBe(1);
		expect(callsMatching(/UPDATE notification_queue/i)).toHaveLength(0);
	});

	test('NULL user_id with a tombstoned email owner: skipped++, row untouched', async () => {
		mockQueue({
			items: [{ ...queueItem, user_id: null }],
			usersByEmail: {
				'candidate@example.com': [{ id: 7, deleted_at: new Date('2026-10-14T00:00:00Z') }],
			},
		});
		const result = await emailService.processQueue(20);

		expect(result.skipped).toBe(1);
		expect(callsMatching(/UPDATE notification_queue/i)).toHaveLength(0);
	});

	test('live recipient passes the guard: the processing UPDATE is issued and skipped stays 0', async () => {
		mockQueue({
			items: [queueItem],
			usersById: { 7: { id: 7, deleted_at: null } },
		});
		const result = await emailService.processQueue(20);

		expect(result.skipped).toBe(0);
		const updates = callsMatching(/UPDATE notification_queue/i);
		expect(updates.length).toBeGreaterThanOrEqual(1);
		expect(updates[0][0]).toMatch(/SET status = \$1/);
		expect(updates[0][1]).toEqual(['processing', 9]);
	});
});
