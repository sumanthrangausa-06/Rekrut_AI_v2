/**
 * observerReportWriter.test.js — S-049a (#776)
 * Tests for the AI Observer report writer (lib/observerReportWriter.js).
 *
 * The writer persists ONE honest report row per completed, consented
 * session (spec §4.3/§4.4). Scaffold scope: every analysis section is a
 * state skeleton resolved through lib/observerReportStates.js — `missing`
 * until the real pipeline (E-004/E-005, S-049b) exists. No fabricated
 * data, no scores, ever.
 *
 * Write rules (panel decision 2026-10-12):
 * - Fires ONLY for granted sessions; written rows always carry
 *   consent_state = 'granted'. Declined/unknown sessions get NO row.
 * - AC-4: INSERT … ON CONFLICT DO NOTHING — first write wins.
 * - AC-5: inside the write transaction, abort if the observer_jobs row
 *   is gone or not `flushing` (erasure deletes both tables — a missing
 *   job row means erasure is in progress or complete).
 * - AC-6 (HARD): consent revoked OR erasure requested between session
 *   end and flush → no row written.
 * - AC-7: the writer never touches the Track B config.report.
 */

// Mock the database pool (query for session load, connect for the tx client)
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
	connect: jest.fn(),
}));

// Mock the job queue — guard SQL itself is unit-tested in observerJobs.test.js
jest.mock('../../../lib/observerJobs', () => ({
	markFlushing: jest.fn(),
	complete: jest.fn(),
}));

const db = require('../../../lib/db');
const observerJobs = require('../../../lib/observerJobs');
const { flushReport, buildReportSkeleton } = require('../../../lib/observerReportWriter');

const GRANTED_SESSION = {
	id: 42,
	candidate_id: 7,
	status: 'completed',
	config: { biometric_collection: true, livekit_room: 'room-42' },
};

/** Stage a fake tx client whose query() answers in call order. */
function stageClient({ jobRow, insertRowCount = 1 } = {}) {
	const client = {
		query: jest.fn(async (sql) => {
			if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
			if (sql.includes('FROM observer_jobs')) {
				return { rows: jobRow === undefined ? [{ id: 9, status: 'flushing' }] : jobRow };
			}
			if (sql.includes('INSERT INTO ai_observer_reports')) {
				return { rowCount: insertRowCount };
			}
			throw new Error(`unexpected client query: ${sql}`);
		}),
		release: jest.fn(),
	};
	db.connect.mockResolvedValue(client);
	return client;
}

/** All SQL issued anywhere (pool + tx client), for isolation assertions. */
function allSql(client) {
	const poolSql = db.query.mock.calls.map((c) => c[0]);
	const clientSql = client ? client.query.mock.calls.map((c) => c[0]) : [];
	return [...poolSql, ...clientSql];
}

describe('observerReportWriter.flushReport', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		observerJobs.markFlushing.mockResolvedValue(1);
		observerJobs.complete.mockResolvedValue(1);
	});

	it('happy path: writes one granted skeleton row in a tx and completes the job', async () => {
		db.query.mockResolvedValueOnce({ rows: [GRANTED_SESSION] });
		const client = stageClient();

		const result = await flushReport({ jobId: 9, sessionId: 42 });

		expect(result.written).toBe(true);
		expect(observerJobs.markFlushing).toHaveBeenCalledWith(9);

		// Transaction discipline: BEGIN … job re-check … INSERT … COMMIT, released.
		const sqls = client.query.mock.calls.map((c) => c[0]);
		expect(sqls[0]).toBe('BEGIN');
		expect(sqls[sqls.length - 1]).toBe('COMMIT');
		expect(client.release).toHaveBeenCalled();

		// In-tx job check locks the row (AC-5)
		const jobCheck = sqls.find((s) => s.includes('FROM observer_jobs'));
		expect(jobCheck).toMatch(/FOR UPDATE/);

		// The INSERT: explicit 'granted', ON CONFLICT DO NOTHING (AC-3, AC-4)
		const insertCall = client.query.mock.calls.find((c) =>
			c[0].includes('INSERT INTO ai_observer_reports'),
		);
		expect(insertCall[0]).toMatch(/ON CONFLICT \(interview_session_id\) DO NOTHING/);
		const params = insertCall[1];
		expect(params[0]).toBe(42); // interview_session_id
		expect(params[1]).toBe('room-42'); // livekit_room_name
		expect(params[2]).toBe('ai-observer-42'); // observer_identity
		expect(params[5]).toBe('granted'); // consent_state — always explicit

		// Skeleton: every section honest `missing`, no fabricated values
		const analysis = JSON.parse(params[3]);
		expect(analysis.vocal).toEqual({ state: 'missing' });
		expect(analysis.visual).toEqual({ state: 'missing' });
		expect(analysis.conversation.state).toBe('missing');
		expect(analysis.conversation.transcript_available).toBe(false);
		const integrity = JSON.parse(params[4]);
		expect(integrity.state).toBe('missing');
		expect(integrity.events).toEqual([]);
		expect(integrity.total_events).toBe(0);

		// Job lifecycle completes after the write
		expect(observerJobs.complete).toHaveBeenCalledWith(9);
		expect(result.jobCompleted).toBe(true);
	});

	it('AC-3: declined session gets NO row (no tx, no job transition)', async () => {
		db.query.mockResolvedValueOnce({
			rows: [{ ...GRANTED_SESSION, config: { biometric_collection: false } }],
		});

		const result = await flushReport({ jobId: 9, sessionId: 42 });

		expect(result.written).toBe(false);
		expect(observerJobs.markFlushing).not.toHaveBeenCalled();
		expect(db.connect).not.toHaveBeenCalled();
	});

	it('AC-3: unknown consent (never presented) gets NO row', async () => {
		db.query.mockResolvedValueOnce({
			rows: [{ ...GRANTED_SESSION, config: {} }],
		});

		const result = await flushReport({ jobId: 9, sessionId: 42 });

		expect(result.written).toBe(false);
		expect(db.connect).not.toHaveBeenCalled();
	});

	it('F2 (privacy-engineer): session not completed → no write, even with consent granted', async () => {
		// The writer's contract is a report for a COMPLETED session. It must
		// not depend on the caller checking: a premature flush would make
		// the empty skeleton the permanent first write (ON CONFLICT).
		db.query.mockResolvedValueOnce({
			rows: [{ ...GRANTED_SESSION, status: 'in_progress' }],
		});

		const result = await flushReport({ jobId: 9, sessionId: 42 });

		expect(result.written).toBe(false);
		expect(result.reason).toBe('session_not_completed');
		expect(observerJobs.markFlushing).not.toHaveBeenCalled();
		expect(db.connect).not.toHaveBeenCalled();
	});

	it('F3 (privacy-engineer): post-commit complete() outcome is surfaced, not discarded', async () => {
		// If a cancel landed after COMMIT, the row exists but the job is
		// `cancelled` — the result must say the job did NOT complete.
		db.query.mockResolvedValueOnce({ rows: [GRANTED_SESSION] });
		stageClient();
		observerJobs.complete.mockResolvedValue(0);

		const result = await flushReport({ jobId: 9, sessionId: 42 });

		expect(result.written).toBe(true);
		expect(result.jobCompleted).toBe(false);
	});

	it('AC-6 RACE (revocation arm): consent revoked between session end and flush → no row', async () => {
		// The session completed while consent was granted; by flush time the
		// candidate has revoked — config now shows biometric_collection=false.
		// The writer's own gate re-check must refuse the write.
		db.query.mockResolvedValueOnce({
			rows: [
				{
					...GRANTED_SESSION,
					config: { biometric_collection: false, livekit_room: 'room-42' },
				},
			],
		});

		const result = await flushReport({ jobId: 9, sessionId: 42 });

		expect(result.written).toBe(false);
		expect(result.reason).toMatch(/consent/);
		expect(db.connect).not.toHaveBeenCalled();
		expect(observerJobs.complete).not.toHaveBeenCalled();
	});

	it('AC-5/AC-6 RACE (job-state arm): job leaves `flushing` between markFlushing and tx → ROLLBACK, no row', async () => {
		// Gate passed and the job transitioned to `flushing`, but a job-state
		// change landed before the write transaction read the row — the
		// in-tx re-check (AC-5) must abort the write. Honest scope note
		// (privacy-engineer F1): this proves the job-state guard itself.
		// The production withdrawal path flips config (covered by the
		// revocation arm above) and does not itself cancel the job — the
		// fully-concurrent withdrawal-mid-flush window is S-049b scope,
		// alongside the erasure advisory lock. Not claimed closed here.
		db.query.mockResolvedValueOnce({ rows: [GRANTED_SESSION] });
		const client = stageClient({ jobRow: [{ id: 9, status: 'cancelled' }] });

		const result = await flushReport({ jobId: 9, sessionId: 42 });

		expect(result.written).toBe(false);
		const sqls = client.query.mock.calls.map((c) => c[0]);
		expect(sqls).toContain('ROLLBACK');
		expect(sqls.some((s) => s.includes('INSERT INTO ai_observer_reports'))).toBe(false);
		expect(client.release).toHaveBeenCalled();
		expect(observerJobs.complete).not.toHaveBeenCalled();
	});

	it('AC-6 RACE (erasure arm): job row deleted by erasure before flush → no row, no tx', async () => {
		// Erasure deletes the observer_jobs row (lib/erasureService.js). The
		// guarded markFlushing transition then affects 0 rows and the writer
		// aborts before opening a transaction.
		db.query.mockResolvedValueOnce({ rows: [GRANTED_SESSION] });
		observerJobs.markFlushing.mockResolvedValue(0);

		const result = await flushReport({ jobId: 9, sessionId: 42 });

		expect(result.written).toBe(false);
		expect(db.connect).not.toHaveBeenCalled();
		expect(observerJobs.complete).not.toHaveBeenCalled();
	});

	it('AC-5/AC-6 RACE (erasure mid-flush): job row vanishes inside the tx window → ROLLBACK, no row', async () => {
		// Erasure committed between markFlushing and the write transaction:
		// the locked SELECT finds no job row. Writing now would resurrect
		// erased data — abort.
		db.query.mockResolvedValueOnce({ rows: [GRANTED_SESSION] });
		const client = stageClient({ jobRow: [] });

		const result = await flushReport({ jobId: 9, sessionId: 42 });

		expect(result.written).toBe(false);
		const sqls = client.query.mock.calls.map((c) => c[0]);
		expect(sqls).toContain('ROLLBACK');
		expect(sqls.some((s) => s.includes('INSERT INTO ai_observer_reports'))).toBe(false);
		expect(observerJobs.complete).not.toHaveBeenCalled();
	});

	it('AC-4: double-flush — existing report wins, job still completes, no overwrite', async () => {
		db.query.mockResolvedValueOnce({ rows: [GRANTED_SESSION] });
		const client = stageClient({ insertRowCount: 0 }); // ON CONFLICT DO NOTHING

		const result = await flushReport({ jobId: 9, sessionId: 42 });

		expect(result.written).toBe(false);
		expect(result.duplicate).toBe(true);
		const sqls = client.query.mock.calls.map((c) => c[0]);
		expect(sqls).toContain('COMMIT');
		expect(sqls.some((s) => /UPDATE ai_observer_reports/.test(s))).toBe(false);
		expect(observerJobs.complete).toHaveBeenCalledWith(9);
	});

	it('AC-7: never writes the Track B config.report (no interview_sessions UPDATE anywhere)', async () => {
		db.query.mockResolvedValueOnce({ rows: [GRANTED_SESSION] });
		const client = stageClient();

		await flushReport({ jobId: 9, sessionId: 42 });

		for (const sql of allSql(client)) {
			expect(sql).not.toMatch(/UPDATE\s+interview_sessions/);
			expect(sql).not.toMatch(/config\.report/);
		}
	});

	it('session not found → no write, no tx', async () => {
		db.query.mockResolvedValueOnce({ rows: [] });

		const result = await flushReport({ jobId: 9, sessionId: 999 });

		expect(result.written).toBe(false);
		expect(result.reason).toBe('session_not_found');
		expect(db.connect).not.toHaveBeenCalled();
	});

	it('tx failure → ROLLBACK, error propagates, client released, job not completed', async () => {
		db.query.mockResolvedValueOnce({ rows: [GRANTED_SESSION] });
		const client = {
			query: jest.fn(async (sql) => {
				if (sql === 'BEGIN' || sql === 'ROLLBACK') return {};
				if (sql.includes('FROM observer_jobs')) return { rows: [{ id: 9, status: 'flushing' }] };
				throw new Error('insert exploded');
			}),
			release: jest.fn(),
		};
		db.connect.mockResolvedValue(client);

		await expect(flushReport({ jobId: 9, sessionId: 42 })).rejects.toThrow('insert exploded');

		const sqls = client.query.mock.calls.map((c) => c[0]);
		expect(sqls).toContain('ROLLBACK');
		expect(client.release).toHaveBeenCalled();
		expect(observerJobs.complete).not.toHaveBeenCalled();
	});
});

describe('observerReportWriter.buildReportSkeleton', () => {
	it('granted session → all sections missing, zero fabricated metrics', () => {
		const { analysis, integrity_summary } = buildReportSkeleton(GRANTED_SESSION);

		expect(analysis.vocal).toEqual({ state: 'missing' });
		expect(analysis.visual).toEqual({ state: 'missing' });
		// No score-like fields anywhere in the biometric sections
		expect(Object.keys(analysis.vocal)).toEqual(['state']);
		expect(Object.keys(analysis.visual)).toEqual(['state']);
		expect(integrity_summary.events).toEqual([]);
		expect(integrity_summary.total_events).toBe(0);
		expect(integrity_summary.critical_count).toBe(0);
		expect(integrity_summary.warning_count).toBe(0);
		expect(integrity_summary.info_count).toBe(0);
	});

	it('skeleton states resolve through observerReportStates (declined session → declined)', () => {
		// The writer never fires for declined sessions (AC-3), but the
		// skeleton builder must still resolve states via the shared module —
		// proof it is not hardcoding 'missing'.
		const declined = { ...GRANTED_SESSION, config: { biometric_collection: false } };
		const { analysis, integrity_summary } = buildReportSkeleton(declined);

		expect(analysis.vocal.state).toBe('declined');
		expect(analysis.visual.state).toBe('declined');
		expect(integrity_summary.state).toBe('declined');
	});
});
