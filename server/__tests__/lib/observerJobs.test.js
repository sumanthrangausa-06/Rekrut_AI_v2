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
