/**
 * diarizationJobs.test.js — S-D03 (#1905)
 * Tests for the diarization job queue (lib/diarizationJobs.js).
 * Cloned from the observerJobs suite's shapes (S-047, #695): the queue
 * is the source of truth for labelling work; interview_recordings.
 * diarization_status is only a denormalized read cache.
 */
const diarizationJobs = require('../../../lib/diarizationJobs');

// Mock the database
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));

const db = require('../../../lib/db');

describe('diarizationJobs', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('enqueue (with supersede-pending, §3.3)', () => {
		it('cancels still-pending jobs for the recording as superseded, then inserts a new pending job', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 1 }); // supersede UPDATE
			db.query.mockResolvedValueOnce({
				rows: [{ id: 2, recording_id: 42, status: 'pending' }],
			});

			const job = await diarizationJobs.enqueue(42);

			const supersedeQuery = db.query.mock.calls[0][0];
			expect(supersedeQuery).toContain('UPDATE diarization_jobs');
			expect(supersedeQuery).toContain("status = 'cancelled'");
			expect(supersedeQuery).toContain(
				"cancel_reason = 'superseded_by_retranscription'",
			);
			// Supersede touches ONLY pending jobs — never one under a worker
			expect(supersedeQuery).toMatch(/status = 'pending'/);
			expect(supersedeQuery).not.toMatch(/'claimed'/);
			expect(db.query.mock.calls[0][1]).toEqual([42]);

			expect(db.query.mock.calls[1][0]).toContain('INSERT INTO diarization_jobs');
			expect(db.query.mock.calls[1][1]).toEqual([42]);
			expect(job.status).toBe('pending');
		});
	});

	describe('claim', () => {
		it('claims with SELECT FOR UPDATE SKIP LOCKED and increments attempt_count', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, recording_id: 42, status: 'claimed', attempt_count: 1 }],
			});

			const job = await diarizationJobs.claim('worker-1');

			const query = db.query.mock.calls[0][0];
			expect(query).toContain('FOR UPDATE SKIP LOCKED');
			expect(query).toContain('attempt_count = attempt_count + 1');
			expect(db.query.mock.calls[0][1]).toEqual(['worker-1']);
			expect(job.status).toBe('claimed');
			expect(job.attempt_count).toBe(1);
		});

		it('also claims retryable failed jobs (attempt_count < 3) but not exhausted ones', async () => {
			db.query.mockResolvedValueOnce({ rows: [] });

			await diarizationJobs.claim('worker-1');

			const query = db.query.mock.calls[0][0];
			expect(query).toMatch(/status = 'failed' AND attempt_count < 3/);
		});

		it('returns null when no claimable jobs', async () => {
			db.query.mockResolvedValueOnce({ rows: [] });

			const job = await diarizationJobs.claim('worker-1');

			expect(job).toBeNull();
		});
	});

	describe('heartbeat', () => {
		it('updates last_heartbeat for the job', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 1 });

			await diarizationJobs.heartbeat(1);

			expect(db.query).toHaveBeenCalledWith(
				expect.stringContaining('last_heartbeat = NOW()'),
				[1],
			);
		});
	});

	describe('markProcessing', () => {
		it('transitions a claimed job to processing and returns rowCount', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 1 });

			const rowCount = await diarizationJobs.markProcessing(1);

			const query = db.query.mock.calls[0][0];
			expect(query).toContain("status = 'processing'");
			expect(query).toMatch(/status = 'claimed'/);
			expect(rowCount).toBe(1);
		});

		it('is guarded — a pending or terminal job cannot jump to processing', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 0 });

			const rowCount = await diarizationJobs.markProcessing(1);

			const query = db.query.mock.calls[0][0];
			expect(query).toMatch(/AND status = 'claimed'/);
			expect(rowCount).toBe(0);
		});
	});

	describe('complete', () => {
		it('marks a processing job complete', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 1 });

			const rowCount = await diarizationJobs.complete(1);

			const query = db.query.mock.calls[0][0];
			expect(query).toContain("status = 'complete'");
			expect(query).toMatch(/status = 'processing'/);
			expect(rowCount).toBe(1);
		});

		it('is guarded — a cancelled job cannot be completed by a late write', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 0 });

			const rowCount = await diarizationJobs.complete(1);

			const query = db.query.mock.calls[0][0];
			expect(query).toMatch(/AND status = 'processing'/);
			expect(rowCount).toBe(0);
		});
	});

	describe('cancel (with structured reason)', () => {
		it('marks job cancelled and stores the reason in cancel_reason', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 1 });

			const rowCount = await diarizationJobs.cancel(
				1,
				'consent_blocked_at_claim:NO_CONSENT',
			);

			const query = db.query.mock.calls[0][0];
			expect(query).toContain("status = 'cancelled'");
			expect(query).toContain('cancel_reason = $2');
			expect(db.query.mock.calls[0][1]).toEqual([
				1,
				'consent_blocked_at_claim:NO_CONSENT',
			]);
			expect(rowCount).toBe(1);
		});

		it('is guarded — terminal jobs are no-ops', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 0 });

			const rowCount = await diarizationJobs.cancel(1, 'segments_unavailable');

			const query = db.query.mock.calls[0][0];
			expect(query).toMatch(/status IN \('pending', 'claimed', 'processing'\)/);
			expect(query).not.toMatch(/'complete'/);
			expect(rowCount).toBe(0);
		});
	});

	describe('fail (error class + attempt budget)', () => {
		it('records error_class and error_message for a retryable failure', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 1 });

			const rowCount = await diarizationJobs.fail(1, 'engine_timeout', 'child killed');

			const query = db.query.mock.calls[0][0];
			expect(query).toContain("status = 'failed'");
			expect(query).toContain('error_class = $2');
			// Retryable: attempt floor param is 0 (budget untouched)
			expect(db.query.mock.calls[0][1]).toEqual([1, 'engine_timeout', 'child killed', 0]);
			expect(rowCount).toBe(1);
		});

		it('exhausts the attempt budget for deterministic failures (decode_failed)', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 1 });

			await diarizationJobs.fail(1, 'decode_failed', 'ffmpeg exit 1');

			// Attempt floor = MAX_ATTEMPTS (3) so claim() never retries it
			expect(db.query.mock.calls[0][1]).toEqual([1, 'decode_failed', 'ffmpeg exit 1', 3]);
			const query = db.query.mock.calls[0][0];
			expect(query).toContain('attempt_count = GREATEST(attempt_count, $4)');
		});

		it('is guarded — terminal jobs are no-ops', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 0 });

			const rowCount = await diarizationJobs.fail(1, 'engine_failed', 'boom');

			const query = db.query.mock.calls[0][0];
			expect(query).toMatch(/status IN \('pending', 'claimed', 'processing'\)/);
			expect(rowCount).toBe(0);
		});
	});

	describe('recoverStale (stale-claim sweep)', () => {
		it('resets claimed/processing jobs with dead heartbeats (>5 min) to pending', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 2 });

			const count = await diarizationJobs.recoverStale();

			const query = db.query.mock.calls[0][0];
			expect(query).toContain("status = 'pending'");
			expect(query).toMatch(/status IN \('claimed', 'processing'\)/);
			expect(query).toContain("INTERVAL '5 minutes'");
			expect(count).toBe(2);
		});

		it('explicitly excludes terminal states — a consent-cancelled job is never resurrected', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 0 });

			await diarizationJobs.recoverStale();

			const query = db.query.mock.calls[0][0];
			expect(query).toMatch(/status NOT IN \('cancelled', 'failed', 'complete'\)/);
		});
	});

	describe('getStatus', () => {
		it('returns the latest job for the recording', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 3, recording_id: 42, status: 'pending' }],
			});

			const job = await diarizationJobs.getStatus(42);

			const query = db.query.mock.calls[0][0];
			expect(query).toContain('FROM diarization_jobs WHERE recording_id = $1');
			expect(query).toMatch(/ORDER BY created_at DESC/);
			expect(job.id).toBe(3);
		});

		it('returns null when the recording has no jobs', async () => {
			db.query.mockResolvedValueOnce({ rows: [] });

			const job = await diarizationJobs.getStatus(42);

			expect(job).toBeNull();
		});
	});
});
