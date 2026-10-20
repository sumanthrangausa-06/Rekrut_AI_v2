/**
 * #1520 — email-queue send path: two dormant defects found by Quinn at
 * the PR #1516 HL-003 gate.
 *
 * Defect 1 — lib/email-queue.js processBatch did
 *   `metadata: JSON.parse(email.metadata || '{}')`.
 * enqueue() writes metadata via JSON.stringify into a jsonb column, and
 * node-pg returns jsonb as a JS OBJECT — so on every real enqueue-shaped
 * row JSON.parse received an object and threw
 * `"[object Object]" is not valid JSON`; guard-passed sends were
 * markFailed before the sender ever ran. The GAP-F guard tests missed
 * it because they drive rows with metadata as the STRING '{}' — the one
 * shape JSON.parse survives. These tests drive REAL row shapes:
 * metadata as object (pg jsonb), as string (legacy/other drivers),
 * as null, and as a malformed string.
 *
 * Defect 2 — server.js's processorFn called sendTemplatedEmail with
 * `{ template, data }` where lib/email-service expects
 * `{ templateName, templateData }` (see the correct call at
 * lib/email-service.js sendEmailWithQueue) — templateName was undefined
 * and logEmail failed on notification_logs.type NOT NULL. processBatch
 * also never passed the row's template_name (written by enqueue into
 * its own column) through to the processor at all. The payload →
 * sendTemplatedEmail mapping is the exported pure helper
 * `toSendTemplatedEmailArgs` (STOP 1 §3, Rex seat: untestable inline
 * wiring is how this class shipped — #1306), which server.js calls.
 *
 * The #1125 GAP-F guard behaviour must stay intact: suppression never
 * mutates the row, and the send acts on the FRESH recipient.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));

const pool = require('../../../lib/db');
const emailQueue = require('../../../lib/email-queue');
const { toSendTemplatedEmailArgs } = require('../../../lib/email-queue');

function callsMatching(re) {
	return pool.query.mock.calls.filter(([sql]) => re.test(sql));
}

describe('#1520 defect 1 — processBatch with real jsonb-shaped rows', () => {
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
			if (/SELECT id, status(, recipient)? FROM email_queue WHERE id = \$1/i.test(sql)) {
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

	const liveUser = { 'candidate@example.com': [{ id: 7, deleted_at: null }] };
	const freshPending = { 5: { id: 5, status: 'pending', recipient: 'candidate@example.com' } };

	function enqueueShapedRow(metadata) {
		return {
			id: 5,
			recipient: 'candidate@example.com',
			template_name: 'welcome_email',
			subject: 'Welcome',
			body: 'Body',
			html_body: null,
			metadata,
			status: 'pending',
		};
	}

	test('jsonb OBJECT metadata (the real pg shape): sender runs with the object, template_name passes through, row marked sent — never failed', async () => {
		const metadata = { candidateName: 'Ada', template: 'welcome_email' };
		mockQueue({ pending: [enqueueShapedRow(metadata)], fresh: freshPending, usersByEmail: liveUser });
		await emailQueue.processBatch();

		expect(processorFn).toHaveBeenCalledTimes(1);
		expect(processorFn.mock.calls[0][0]).toEqual({
			id: 5,
			to: 'candidate@example.com',
			subject: 'Welcome',
			body: 'Body',
			html: null,
			template: 'welcome_email',
			metadata: { candidateName: 'Ada', template: 'welcome_email' },
		});
		const updates = callsMatching(/UPDATE email_queue/i);
		expect(updates).toHaveLength(1);
		expect(updates[0][0]).toMatch(/SET status = 'sent'/);
	});

	test('string metadata (legacy/other drivers): parsed to an object, template passes through, row marked sent', async () => {
		mockQueue({
			pending: [enqueueShapedRow('{"candidateName":"Ada"}')],
			fresh: freshPending,
			usersByEmail: liveUser,
		});
		await emailQueue.processBatch();

		expect(processorFn).toHaveBeenCalledTimes(1);
		expect(processorFn.mock.calls[0][0]).toMatchObject({
			template: 'welcome_email',
			metadata: { candidateName: 'Ada' },
		});
		const updates = callsMatching(/UPDATE email_queue/i);
		expect(updates).toHaveLength(1);
		expect(updates[0][0]).toMatch(/SET status = 'sent'/);
	});

	test('null metadata: normalised to {}, template passes through, row marked sent', async () => {
		mockQueue({ pending: [enqueueShapedRow(null)], fresh: freshPending, usersByEmail: liveUser });
		await emailQueue.processBatch();

		expect(processorFn).toHaveBeenCalledTimes(1);
		expect(processorFn.mock.calls[0][0]).toMatchObject({ template: 'welcome_email', metadata: {} });
		const updates = callsMatching(/UPDATE email_queue/i);
		expect(updates).toHaveLength(1);
		expect(updates[0][0]).toMatch(/SET status = 'sent'/);
	});

	test('malformed string metadata: normalised to {} instead of throwing — row marked sent, not failed', async () => {
		mockQueue({ pending: [enqueueShapedRow('{"oops"')], fresh: freshPending, usersByEmail: liveUser });
		await emailQueue.processBatch();

		expect(processorFn).toHaveBeenCalledTimes(1);
		expect(processorFn.mock.calls[0][0]).toMatchObject({ metadata: {} });
		const updates = callsMatching(/UPDATE email_queue/i);
		expect(updates).toHaveLength(1);
		expect(updates[0][0]).toMatch(/SET status = 'sent'/);
	});

	test('guard intact: tombstoned recipient with object metadata is still suppressed WITHOUT row mutation', async () => {
		mockQueue({
			pending: [enqueueShapedRow({ candidateName: 'Ada' })],
			fresh: freshPending,
			usersByEmail: { 'candidate@example.com': [{ id: 7, deleted_at: new Date('2026-10-14T00:00:00Z') }] },
		});
		await emailQueue.processBatch();

		expect(processorFn).not.toHaveBeenCalled();
		expect(callsMatching(/UPDATE email_queue/i)).toHaveLength(0);
	});
});

describe('#1520 defect 2 — toSendTemplatedEmailArgs maps the queue payload to the sendTemplatedEmail contract', () => {
	test('helper is exported', () => {
		expect(typeof toSendTemplatedEmailArgs).toBe('function');
	});

	test('template_name from processBatch wins: { templateName, templateData } — no template/data keys', () => {
		const args = toSendTemplatedEmailArgs({
			to: 'candidate@example.com',
			template: 'welcome_email',
			metadata: { candidateName: 'Ada' },
		});
		expect(args).toEqual({
			to: 'candidate@example.com',
			templateName: 'welcome_email',
			templateData: { candidateName: 'Ada' },
		});
		expect(args).not.toHaveProperty('template');
		expect(args).not.toHaveProperty('data');
	});

	test('falls back to metadata.template when no template was passed through', () => {
		const args = toSendTemplatedEmailArgs({
			to: 'candidate@example.com',
			metadata: { template: 'interview_reminder' },
		});
		expect(args.templateName).toBe('interview_reminder');
		expect(args.templateData).toEqual({ template: 'interview_reminder' });
	});

	test("defaults to 'custom' with {} templateData when neither source names a template", () => {
		expect(toSendTemplatedEmailArgs({ to: 'candidate@example.com', metadata: {} })).toEqual({
			to: 'candidate@example.com',
			templateName: 'custom',
			templateData: {},
		});
		expect(toSendTemplatedEmailArgs({ to: 'candidate@example.com', metadata: null })).toEqual({
			to: 'candidate@example.com',
			templateName: 'custom',
			templateData: {},
		});
	});

	test('string metadata is normalised before mapping', () => {
		const args = toSendTemplatedEmailArgs({
			to: 'candidate@example.com',
			metadata: '{"template":"x_tpl","n":1}',
		});
		expect(args.templateName).toBe('x_tpl');
		expect(args.templateData).toEqual({ template: 'x_tpl', n: 1 });
	});
});
