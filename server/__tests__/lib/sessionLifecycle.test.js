/**
 * S-003 (#642): Session lifecycle state machine tests.
 *
 * SessionService owns the state machine (per story Technical Notes).
 * All mutations are ATOMIC single-statement UPDATEs with the transition
 * table encoded as a status guard in the WHERE clause — no lock-holding
 * window, no TOCTOU (specialist review 2026-10-10).
 *
 * Transition table (architecture §3.10, v3):
 *   invited      → in_progress, calibrating, expired, abandoned
 *   calibrating  → in_progress, abandoned   (in table; phase not implemented yet)
 *   in_progress  → paused, completed, abandoned
 *   paused       → in_progress, abandoned, expired
 *   completed    → (terminal)
 *   abandoned    → (terminal)
 *   expired      → (terminal)
 *
 * AC-1: in_progress + stale heartbeat (>60s) → paused (lazy, atomic, in SQL)
 * AC-2: resume via valid token → current_question_index preserved
 * AC-3: invalid transition → 409 SESSION_STATE_CONFLICT
 */
const SessionService = require('../../../lib/sessionService');

// Mock the database pool
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));

const db = require('../../../lib/db');

describe('SessionService lifecycle', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('transition (atomic)', () => {
		test('invited → in_progress succeeds with single UPDATE', async () => {
			db.query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'in_progress' }] });

			const session = await SessionService.transition(1, 'in_progress');
			expect(session.status).toBe('in_progress');
			// Atomic: exactly ONE query (no SELECT-then-UPDATE)
			expect(db.query).toHaveBeenCalledTimes(1);
			expect(db.query.mock.calls[0][0]).toMatch(/UPDATE interview_sessions/i);
		});

		test('transition guard encodes allowed from-states in WHERE clause', async () => {
			db.query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'paused' }] });

			await SessionService.transition(1, 'paused');

			const sql = db.query.mock.calls[0][0];
			expect(sql).toMatch(/status = ANY\(\$3\)/i);
			// Only in_progress may → paused (per TRANSITIONS table)
			// db.query called as (sql, [toState, sessionId, allowedFromStates])
			const guardStates = db.query.mock.calls[0][1][2];
			expect(guardStates).toContain('in_progress');
			expect(guardStates).not.toContain('completed');
		});

		test('in_progress → paused succeeds', async () => {
			db.query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'paused' }] });

			const session = await SessionService.transition(1, 'paused');
			expect(session.status).toBe('paused');
		});

		test('paused → in_progress succeeds (resume path)', async () => {
			db.query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'in_progress' }] });

			const session = await SessionService.transition(1, 'in_progress');
			expect(session.status).toBe('in_progress');
		});

		test('AC-3: completed → in_progress throws SESSION_STATE_CONFLICT', async () => {
			db.query
				.mockResolvedValueOnce({ rows: [] }) // UPDATE: 0 rows (guard blocked)
				.mockResolvedValueOnce({ rows: [{ id: 1, status: 'completed' }] }); // error-report read

			await expect(SessionService.transition(1, 'in_progress')).rejects.toMatchObject({
				code: 'SESSION_STATE_CONFLICT',
			});
			expect(db.query).toHaveBeenCalledTimes(2); // UPDATE + reporting SELECT
		});

		test('AC-3: invited → completed throws SESSION_STATE_CONFLICT', async () => {
			db.query
				.mockResolvedValueOnce({ rows: [] })
				.mockResolvedValueOnce({ rows: [{ id: 1, status: 'invited' }] });

			await expect(SessionService.transition(1, 'completed')).rejects.toMatchObject({
				code: 'SESSION_STATE_CONFLICT',
			});
		});

		test('calibrating is in the transition table (invited → calibrating allowed)', async () => {
			db.query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'calibrating' }] });

			const session = await SessionService.transition(1, 'calibrating');
			expect(session.status).toBe('calibrating');
		});

		test('unknown target state throws SESSION_STATE_CONFLICT (no DB call)', async () => {
			await expect(SessionService.transition(1, 'flying')).rejects.toMatchObject({
				code: 'SESSION_STATE_CONFLICT',
			});
			expect(db.query).not.toHaveBeenCalled();
		});

		test('missing session throws SESSION_NOT_FOUND', async () => {
			db.query
				.mockResolvedValueOnce({ rows: [] }) // UPDATE: 0 rows
				.mockResolvedValueOnce({ rows: [] }); // reporting SELECT: not found

			await expect(SessionService.transition(999, 'paused')).rejects.toMatchObject({
				code: 'SESSION_NOT_FOUND',
			});
		});
	});

	describe('heartbeat (atomic, in_progress only)', () => {
		test('updates last_heartbeat_at for in_progress session', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, status: 'in_progress' }],
			});

			const session = await SessionService.heartbeat(1);
			expect(session.id).toBe(1);
			expect(db.query).toHaveBeenCalledTimes(1);
			expect(db.query.mock.calls[0][0]).toMatch(/last_heartbeat_at\s*=\s*NOW\(\)/i);
			expect(db.query.mock.calls[0][0]).toMatch(/status = 'in_progress'/i);
		});

		test('heartbeat on paused session throws SESSION_STATE_CONFLICT', async () => {
			db.query
				.mockResolvedValueOnce({ rows: [] }) // UPDATE: 0 rows
				.mockResolvedValueOnce({ rows: [{ id: 1, status: 'paused' }] });

			await expect(SessionService.heartbeat(1)).rejects.toMatchObject({
				code: 'SESSION_STATE_CONFLICT',
			});
		});

		test('heartbeat on completed session throws SESSION_STATE_CONFLICT', async () => {
			db.query
				.mockResolvedValueOnce({ rows: [] })
				.mockResolvedValueOnce({ rows: [{ id: 1, status: 'completed' }] });

			await expect(SessionService.heartbeat(1)).rejects.toMatchObject({
				code: 'SESSION_STATE_CONFLICT',
			});
		});
	});

	describe('getState (atomic lazy pause)', () => {
		test('AC-1: in_progress with stale heartbeat → paused atomically', async () => {
			db.query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'paused' }] });

			const session = await SessionService.getState(1);
			expect(session.status).toBe('paused');

			// Staleness computed in SQL (no app-clock skew, no read-then-write)
			const sql = db.query.mock.calls[0][0];
			expect(sql).toMatch(/last_heartbeat_at < NOW\(\) - make_interval/i);
			expect(sql).toMatch(/status = 'in_progress'/i);
		});

		test('in_progress with fresh heartbeat → returned as-is (second query)', async () => {
			db.query
				.mockResolvedValueOnce({ rows: [] }) // lazy-pause UPDATE: no stale rows
				.mockResolvedValueOnce({
					rows: [{ id: 1, status: 'in_progress' }],
				}); // SELECT

			const session = await SessionService.getState(1);
			expect(session.status).toBe('in_progress');
			expect(db.query).toHaveBeenCalledTimes(2);
		});

		test('missing session throws SESSION_NOT_FOUND', async () => {
			db.query
				.mockResolvedValueOnce({ rows: [] })
				.mockResolvedValueOnce({ rows: [] });

			await expect(SessionService.getState(999)).rejects.toMatchObject({
				code: 'SESSION_NOT_FOUND',
			});
		});
	});

	describe('resume (token-validated, atomic)', () => {
		test('AC-2: paused + valid token → in_progress with question index', async () => {
			db.query
				.mockResolvedValueOnce({
					rows: [
						{
							id: 1,
							status: 'paused',
							invite_token: 'tok123',
							current_question_index: 5,
						},
					],
				}) // SELECT for token check
				.mockResolvedValueOnce({
					rows: [{ id: 1, status: 'in_progress', current_question_index: 5 }],
				}); // guarded UPDATE

			const session = await SessionService.resume(1, 'tok123');
			expect(session.status).toBe('in_progress');
			expect(session.current_question_index).toBe(5);
			// Final UPDATE re-guards status='paused' (TOCTOU-safe)
			expect(db.query.mock.calls[1][0]).toMatch(/AND status = 'paused'/i);
		});

		test('resume with wrong token throws INVALID_TOKEN (no UPDATE)', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, status: 'paused', invite_token: 'tok123' }],
			});

			await expect(SessionService.resume(1, 'wrong')).rejects.toMatchObject({
				code: 'INVALID_TOKEN',
			});
			expect(db.query).toHaveBeenCalledTimes(1);
		});

		test('resume on non-paused session throws SESSION_STATE_CONFLICT', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, status: 'completed', invite_token: 'tok123' }],
			});

			await expect(SessionService.resume(1, 'tok123')).rejects.toMatchObject({
				code: 'SESSION_STATE_CONFLICT',
			});
		});
	});

	describe('_loadOwned (per-session authorization)', () => {
		const owner = { id: 42, role: 'candidate', company_id: null };
		const stranger = { id: 99, role: 'candidate', company_id: null };
		const recruiter = { id: 7, role: 'recruiter', company_id: 5 };

		test('candidate_id owner is authorized', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, candidate_id: 42, triggered_by: 7, company_id: 5 }],
			});

			const session = await SessionService._loadOwned(1, owner);
			expect(session.id).toBe(1);
		});

		test('triggered_by owner is authorized', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, candidate_id: 42, triggered_by: 7, company_id: 5 }],
			});

			const session = await SessionService._loadOwned(1, { id: 7, role: 'recruiter', company_id: 5 });
			expect(session.id).toBe(1);
		});

		test('hiring team with company match is authorized', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, candidate_id: 42, triggered_by: 8, company_id: 5 }],
			});

			const session = await SessionService._loadOwned(1, recruiter);
			expect(session.id).toBe(1);
		});

		test('unrelated user gets FORBIDDEN', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, candidate_id: 42, triggered_by: 7, company_id: 5 }],
			});

			await expect(SessionService._loadOwned(1, stranger)).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		});

		test('recruiter from another company gets FORBIDDEN', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, candidate_id: 42, triggered_by: 7, company_id: 5 }],
			});

			await expect(
				SessionService._loadOwned(1, { id: 8, role: 'recruiter', company_id: 999 }),
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});

		test('missing session throws SESSION_NOT_FOUND', async () => {
			db.query.mockResolvedValueOnce({ rows: [] });

			await expect(SessionService._loadOwned(999, owner)).rejects.toMatchObject({
				code: 'SESSION_NOT_FOUND',
			});
		});
	});
});
