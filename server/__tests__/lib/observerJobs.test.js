/**
 * observerJobs.test.js — S-047 (#695)
 * Tests for the AI Observer job queue (lib/observerJobs.js).
 *
 * The job queue is the source of truth for observer dispatch.
 * config.observer_enabled is intent only; observer_jobs.status is reality.
 */
const observerJobs = require('../../../lib/observerJobs');

// Mock the database
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));

const db = require('../../../lib/db');

describe('observerJobs', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('enqueue', () => {
		it('inserts a pending job for the session', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, interview_session_id: 42, status: 'pending' }],
			});

			const job = await observerJobs.enqueue(42);

			expect(db.query).toHaveBeenCalledWith(
				expect.stringContaining('INSERT INTO observer_jobs'),
				expect.arrayContaining([42]),
			);
			expect(job.status).toBe('pending');
		});

		it('returns existing job on duplicate session (idempotent)', async () => {
			// First call: INSERT succeeds
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, interview_session_id: 42, status: 'pending' }],
			});
			// Second call: unique violation, then SELECT returns existing
			const uniqueViolation = new Error('duplicate key');
			uniqueViolation.code = '23505';
			db.query.mockRejectedValueOnce(uniqueViolation);
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, interview_session_id: 42, status: 'pending' }],
			});

			await observerJobs.enqueue(42);
			const job2 = await observerJobs.enqueue(42);

			expect(job2.id).toBe(1);
		});
	});

	describe('claim', () => {
		it('claims a pending job with SELECT FOR UPDATE SKIP LOCKED', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, interview_session_id: 42, status: 'claimed' }],
			});

			const job = await observerJobs.claim('worker-1');

			expect(db.query).toHaveBeenCalledWith(
				expect.stringContaining('FOR UPDATE SKIP LOCKED'),
				expect.arrayContaining(['worker-1']),
			);
			expect(job.status).toBe('claimed');
		});

		it('returns null when no pending jobs', async () => {
			db.query.mockResolvedValueOnce({ rows: [] });

			const job = await observerJobs.claim('worker-1');

			expect(job).toBeNull();
		});
	});

	describe('heartbeat', () => {
		it('updates last_heartbeat for the job', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 1 });

			await observerJobs.heartbeat(1);

			expect(db.query).toHaveBeenCalledWith(
				expect.stringContaining('last_heartbeat = NOW()'),
				[1],
			);
		});
	});

	describe('complete', () => {
		it('marks job complete', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 1 });

			await observerJobs.complete(1);

			expect(db.query).toHaveBeenCalledWith(
				expect.stringContaining("status = 'complete'"),
				[1],
			);
		});

		// S-049a AC-4: status guard — a late flush must not "complete" a
		// job that was cancelled (consent revoked) in the meantime.
		it('is guarded to flushing jobs only (cannot complete a cancelled job)', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 0 });

			const rowCount = await observerJobs.complete(1);

			const query = db.query.mock.calls[0][0];
			expect(query).toMatch(/status = 'flushing'/);
			expect(rowCount).toBe(0);
		});
	});

	describe('markFlushing (S-049a AC-4)', () => {
		it('transitions an observing job to flushing', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 1 });

			const rowCount = await observerJobs.markFlushing(1);

			expect(db.query).toHaveBeenCalledWith(
				expect.stringContaining("status = 'flushing'"),
				[1],
			);
			expect(rowCount).toBe(1);
		});

		it('is guarded — terminal jobs (cancelled/complete) cannot re-enter flushing', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 0 });

			const rowCount = await observerJobs.markFlushing(1);

			const query = db.query.mock.calls[0][0];
			// Guard admits only pre-flush lifecycle states, never terminal ones
			expect(query).toMatch(/status IN \('observing', 'claimed'\)/);
			expect(query).not.toMatch(/'cancelled'.*'complete'/);
			expect(rowCount).toBe(0);
		});
	});

	describe('cancel', () => {
		it('marks job cancelled (consent withdrawn)', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 1 });

			await observerJobs.cancel(1, 'consent_withdrawn');

			expect(db.query).toHaveBeenCalledWith(
				expect.stringContaining("status = 'cancelled'"),
				expect.arrayContaining([1]),
			);
		});

		it('returns rowCount like the other guarded transitions', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 1 });

			const rowCount = await observerJobs.cancel(1, 'consent_withdrawn');

			expect(rowCount).toBe(1);
		});

		// #779 (F4): status guard — a late cancel racing a completed flush
		// must not overwrite the terminal 'complete' state.
		it('is guarded to non-terminal states only (cancel-after-complete is a no-op)', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 0 });

			const rowCount = await observerJobs.cancel(1, 'consent_withdrawn');

			const query = db.query.mock.calls[0][0];
			expect(query).toMatch(
				/status IN \('pending', 'claimed', 'observing', 'flushing'\)/,
			);
			expect(rowCount).toBe(0);
		});
	});

	describe('fail', () => {
		it('marks job failed with the error message', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 1 });

			const rowCount = await observerJobs.fail(1, 'room_connect_failed:boom');

			expect(db.query).toHaveBeenCalledWith(
				expect.stringContaining("status = 'failed'"),
				[1, 'room_connect_failed:boom'],
			);
			expect(rowCount).toBe(1);
		});

		// #779 (F4): status guard — a late fail racing a completed flush
		// must not overwrite the terminal 'complete' state.
		it('is guarded to non-terminal states only (fail-after-complete is a no-op)', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 0 });

			const rowCount = await observerJobs.fail(1, 'late_error');

			const query = db.query.mock.calls[0][0];
			expect(query).toMatch(
				/status IN \('pending', 'claimed', 'observing', 'flushing'\)/,
			);
			expect(rowCount).toBe(0);
		});
	});

	describe('recoverStale', () => {
		it('resets stale claimed jobs to pending, excluding terminal states', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 2 });

			const count = await observerJobs.recoverStale();

			// Must exclude cancelled, failed, complete — never resurrect them
			const query = db.query.mock.calls[0][0];
			expect(query).toMatch(/cancelled/);
			expect(query).toMatch(/failed/);
			expect(query).toMatch(/complete/);
			expect(count).toBe(2);
		});
	});

	describe('getStatus', () => {
		it('returns job status for a session', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, status: 'observing', worker_id: 'worker-1' }],
			});

			const status = await observerJobs.getStatus(42);

			expect(status.status).toBe('observing');
		});

		it('returns null when no job exists', async () => {
			db.query.mockResolvedValueOnce({ rows: [] });

			const status = await observerJobs.getStatus(42);

			expect(status).toBeNull();
		});
	});
});
