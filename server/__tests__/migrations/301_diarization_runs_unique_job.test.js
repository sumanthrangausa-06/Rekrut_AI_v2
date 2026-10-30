/**
 * Migration 301 — UNIQUE(job_id) on diarization_runs (#1931 item 1).
 *
 * Mocked-client pattern (as 296/300 suites): runs the REAL up() against
 * a recording mock client and asserts the emitted SQL — (a) the unique
 * index is created with IF NOT EXISTS (fresh-install idempotency),
 * (b) the post-state assertion reads pg_indexes, (c) down() issues no
 * SQL. The live proof (fresh migrate + duplicate insert rejected with
 * 23505 + NULL semantics) is the recordings-1931-lockfirst integration
 * gate.
 */
const migration = require('../../../migrations/301_diarization_runs_unique_job');

function recordingClient() {
	const calls = [];
	return {
		calls,
		query: jest.fn(async (sql) => {
			calls.push(sql);
			if (/FROM pg_indexes/.test(sql)) {
				return {
					rows: [
						{
							indexdef:
								'CREATE UNIQUE INDEX ux_diarization_runs_job_id ON public.diarization_runs USING btree (job_id)',
						},
					],
				};
			}
			return { rows: [] };
		}),
	};
}

describe('migration 301 — diarization_runs UNIQUE(job_id) (#1931)', () => {
	it('creates the unique index idempotently on diarization_runs(job_id)', async () => {
		const client = recordingClient();
		await migration.up(client);
		expect(client.calls[0]).toMatch(
			/CREATE UNIQUE INDEX IF NOT EXISTS ux_diarization_runs_job_id\s+ON diarization_runs\(job_id\)/,
		);
	});

	it('post-state assertion verifies the index via pg_indexes', async () => {
		const client = recordingClient();
		await migration.up(client);
		expect(client.calls[1]).toMatch(/FROM pg_indexes/);
		expect(client.calls[1]).toMatch(/ux_diarization_runs_job_id/);
	});

	it('post-state assertion fails loud when the index is missing', async () => {
		const client = { query: jest.fn(async () => ({ rows: [] })) };
		await expect(migration.up(client)).rejects.toThrow(/post-state assertion failed/);
	});

	it('down() is an intentional no-op (issues no SQL)', async () => {
		const client = recordingClient();
		await migration.down(client);
		expect(client.calls).toHaveLength(0);
	});
});
