/**
 * S-003 (#642): Concurrency guarantee tests — REAL PostgreSQL.
 *
 * Specialist addendum (event-driven-architect, 2026-10-10): the original
 * implementation used a bare `SELECT ... FOR UPDATE` which holds no lock
 * under pool autocommit, and the unit test asserting the query text could
 * not validate the serialization guarantee. The fix was single-statement
 * atomic UPDATEs with the transition table encoded as a status guard in
 * the WHERE clause.
 *
 * These tests run against a REAL database and assert the OUTCOME, not the
 * query text: N concurrent transitions from the same state → exactly ONE
 * wins, the rest get SESSION_STATE_CONFLICT. That is the guarantee the
 * row-locking was supposed to provide.
 *
 * Local-dev only: skipped unless S003_CONCURRENCY_DATABASE_URL is set
 * (e.g. a scratch DB on the local Postgres). Never runs in CI.
 */

// DATABASE_URL must be set before lib/db builds its pool.
const TEST_DATABASE_URL = process.env.S003_CONCURRENCY_DATABASE_URL;
if (TEST_DATABASE_URL) {
	process.env.DATABASE_URL = TEST_DATABASE_URL;
}

const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

describeIfDb('SessionService lifecycle — real-DB concurrency (S-003 #642)', () => {
	let db;
	let SessionService;

	const createSession = async (status) => {
		const { rows } = await db.query(
			`INSERT INTO interview_sessions (status) VALUES ($1) RETURNING id`,
			[status],
		);
		return rows[0].id;
	};

	beforeAll(async () => {
		// eslint-disable-next-line global-require
		db = require('../../../lib/db');
		// eslint-disable-next-line global-require
		SessionService = require('../../../lib/sessionService');

		await db.query(`DROP TABLE IF EXISTS interview_sessions`);
		await db.query(`
			CREATE TABLE interview_sessions (
				id SERIAL PRIMARY KEY,
				status TEXT NOT NULL,
				last_heartbeat_at TIMESTAMPTZ,
				current_question_index INTEGER NOT NULL DEFAULT 0,
				paused_at TIMESTAMPTZ
			)
		`);
	}, 30000);

	afterAll(async () => {
		await db.query(`DROP TABLE IF EXISTS interview_sessions`);
		await db.end();
	});

	test('10 concurrent invited → in_progress transitions: exactly one wins', async () => {
		const sessionId = await createSession('invited');

		const attempts = Array.from({ length: 10 }, () =>
			SessionService.transition(sessionId, 'in_progress'),
		);
		const results = await Promise.allSettled(attempts);

		const winners = results.filter((r) => r.status === 'fulfilled');
		const losers = results.filter((r) => r.status === 'rejected');

		expect(winners).toHaveLength(1);
		expect(winners[0].value.status).toBe('in_progress');
		expect(losers).toHaveLength(9);
		for (const loser of losers) {
			expect(loser.reason).toMatchObject({ code: 'SESSION_STATE_CONFLICT' });
		}

		const { rows } = await db.query(
			'SELECT status FROM interview_sessions WHERE id = $1',
			[sessionId],
		);
		expect(rows[0].status).toBe('in_progress');
	});

	test('competing divergent targets (pause vs complete): exactly one wins', async () => {
		const sessionId = await createSession('in_progress');

		const results = await Promise.allSettled([
			SessionService.transition(sessionId, 'paused'),
			SessionService.transition(sessionId, 'completed'),
		]);

		const winners = results.filter((r) => r.status === 'fulfilled');
		const losers = results.filter((r) => r.status === 'rejected');

		expect(winners).toHaveLength(1);
		expect(losers).toHaveLength(1);
		expect(losers[0].reason).toMatchObject({ code: 'SESSION_STATE_CONFLICT' });
		expect(['paused', 'completed']).toContain(winners[0].value.status);

		const { rows } = await db.query(
			'SELECT status FROM interview_sessions WHERE id = $1',
			[sessionId],
		);
		expect(rows[0].status).toBe(winners[0].value.status);
	});
});

if (!TEST_DATABASE_URL) {
	test('concurrency tests skipped (S003_CONCURRENCY_DATABASE_URL not set)', () => {
		// Placeholder so the file is never empty in CI.
		expect(true).toBe(true);
	});
}
