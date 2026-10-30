/**
 * Migration 300 — widen compliance_audit_trail entity_type CHECK with
 * 'interview_event' (#1961 item 5, following migration 254's precedent).
 *
 * Mocked-client pattern (as 254/299 suites): runs the REAL up() against a
 * recording mock client and asserts the emitted SQL — (a) the constraint
 * lookup is the pg_constraint contype='c' rule (never the PG18-vulnerable
 * information_schema rule, #1329), (b) the re-added named CHECK keeps every
 * previously allowed value AND adds 'interview_event', (c) down() is a
 * no-op. The live proof (fresh migrate + 'interview_event' rows written and
 * read back) is the panel-labelling-1955 integration gate (T-C11).
 */
const migration = require('../../../migrations/300_audit_entity_interview_event');

function recordingClient() {
	const calls = [];
	return { calls, query: jest.fn(async (sql) => { calls.push(sql); return { rows: [] }; }) };
}

describe('migration 300 — audit entity_type interview_event (#1961)', () => {
	it('lookup uses pg_constraint contype=c, never information_schema', async () => {
		const client = recordingClient();
		await migration.up(client);
		const lookup = client.calls[0];
		expect(lookup).toMatch(/FROM pg_constraint/);
		expect(lookup).toMatch(/contype = 'c'/);
		expect(lookup).not.toMatch(/information_schema/);
	});

	it('re-adds the named CHECK with all prior values plus interview_event', async () => {
		const client = recordingClient();
		await migration.up(client);
		const add = client.calls[1];
		expect(add).toMatch(/ADD CONSTRAINT compliance_audit_trail_entity_type_check/);
		for (const v of ['candidate', 'job', 'company', 'user', 'retention_purge', 'interview_event']) {
			expect(add).toContain(`'${v}'`);
		}
	});

	it('down() is an intentional no-op (issues no SQL)', async () => {
		const client = recordingClient();
		await migration.down(client);
		expect(client.calls).toHaveLength(0);
	});
});
