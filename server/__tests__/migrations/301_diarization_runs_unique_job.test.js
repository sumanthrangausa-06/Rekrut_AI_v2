/**
 * Migration 301 — UNIQUE(job_id) on diarization_runs (#1931 item 1).
 *
 * Mocked-client pattern (as 296/300 suites): runs the REAL up() against
 * a recording mock client and asserts the emitted SQL — (a) a pre-flight
 * duplicate check runs first (database-reviewer MAJOR: fail loud naming
 * offending job_ids, never dedupe), (b) the unique index is created
 * with IF NOT EXISTS (fresh-install idempotency), (c) the post-state
 * assertion reads pg_index (indisunique — a standalone unique index
 * creates no pg_constraint row), (d) down() issues no SQL. The live
 * proof (fresh migrate + duplicate insert rejected with 23505 + NULL
 * semantics) is the recordings-1931-lockfirst integration gate.
 */
const migration = require('../../../migrations/301_diarization_runs_unique_job');

function recordingClient() {
	const calls = [];
	return {
		calls,
		query: jest.fn(async (sql) => {
			calls.push(sql);
			if (/FROM pg_index/.test(sql)) {
				return { rows: [{ indisunique: true, non_partial: true, key_column: 'job_id' }] };
			}
			return { rows: [] };
		}),
	};
}

describe('migration 301 — diarization_runs UNIQUE(job_id) (#1931)', () => {
	it('pre-flight checks for duplicate non-null job_ids before building', async () => {
		const client = recordingClient();
		await migration.up(client);
		expect(client.calls[0]).toMatch(/FROM diarization_runs/);
		expect(client.calls[0]).toMatch(/job_id IS NOT NULL/);
		expect(client.calls[0]).toMatch(/GROUP BY job_id HAVING COUNT\(\*\) > 1/);
	});

	it('pre-flight fails loud naming the offending job_ids and builds nothing', async () => {
		const calls = [];
		const client = {
			calls,
			query: jest.fn(async (sql) => {
				calls.push(sql);
				return { rows: [{ job_id: 42, n: 3 }] };
			}),
		};
		await expect(migration.up(client)).rejects.toThrow(/pre-flight failed.*42 \(x3\)/);
		expect(calls).toHaveLength(1); // no CREATE was issued
	});

	it('creates the unique index idempotently on diarization_runs(job_id)', async () => {
		const client = recordingClient();
		await migration.up(client);
		expect(client.calls[1]).toMatch(
			/CREATE UNIQUE INDEX IF NOT EXISTS ux_diarization_runs_job_id\s+ON diarization_runs\(job_id\)/,
		);
	});

	it('post-state assertion verifies uniqueness via pg_index.indisunique', async () => {
		const client = recordingClient();
		await migration.up(client);
		expect(client.calls[2]).toMatch(/FROM pg_index/);
		expect(client.calls[2]).toMatch(/indisunique/);
		expect(client.calls[2]).toMatch(/ux_diarization_runs_job_id/);
	});

	it('post-state assertion fails loud when the index is missing', async () => {
		const client = {
			query: jest.fn(async (sql) => {
				if (/FROM pg_index/.test(sql)) return { rows: [] };
				return { rows: [] };
			}),
		};
		await expect(migration.up(client)).rejects.toThrow(/post-state assertion failed/);
	});

	it('down() is an intentional no-op (issues no SQL)', async () => {
		const client = recordingClient();
		await migration.down(client);
		expect(client.calls).toHaveLength(0);
	});
});
