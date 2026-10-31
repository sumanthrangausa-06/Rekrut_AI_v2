/**
 * #2011 Part B — panel_consent_snapshot retention-clock sweep (JT-D7 family).
 *
 * Quinn-style user-journey suite on the real rig (HL-003), written from
 * Rex's design (docs/sdlc/rekrut-ai-v2/03-solutioning/speaker-labelled-
 * transcripts/snapshot-retention-sweep-design.md, STOP 1 on #2011).
 *
 * The journey, in the order it happens in the world:
 *  1. Panellists consent to labelling on other people's interviews; the
 *     diarization gate freezes a copy of each consent decision inside
 *     the diarization job/run records (panel_consent_snapshot).
 *  2. Time passes. Some source consent records are erased (the panel
 *     user's own erasure deletes their event_labelling_consent rows);
 *     some host recordings reach their end (retention expiry, or the
 *     GAP-A keep-redacted tombstone when the host candidate erases).
 *  3. The 24h retention tick runs sweepPanelConsentSnapshots().
 *  4. A retained copy must never outlive its source: a reference is
 *     removed ONLY when its source row is gone AND its host recording
 *     has ended (design §3). Everything else stays byte-identical.
 *
 * Seeded matrix (panel user PAN unless noted; §6 of the design):
 *  A live recording      × source present  ⇒ untouched
 *  B live recording      × source deleted  ⇒ untouched (host-end leg)
 *  C retention-expired   × source present  ⇒ untouched (source leg);
 *    job AND run copies seeded
 *  D retention-expired   × source deleted  ⇒ retention leg: counted
 *    under dry-run, removed only in a live sweep; the snapshot
 *    references PAN alone, so the column becomes NULL and the host
 *    job row itself survives
 *  E tombstone           × source deleted  ⇒ erasure-completion leg:
 *    removed even under dry-run. The job snapshot is SHARED with
 *    PAN2 (source present) — only PAN's reference is removed, PAN2's
 *    stays; the run snapshot references PAN alone ⇒ NULL
 *  F tombstone           × source deleted, panel user under an
 *    active legal hold     ⇒ untouched in every mode, counted
 *    heldSkipped (§4: held rows are counted, never silently retained)
 *  G tombstone, snapshot references only PAN2 (source present)
 *                          ⇒ byte-identical (negative fixture: a
 *    snapshot not referencing an expired user is never rewritten)
 *  H tombstone           × source deleted, PAN referenced via
 *    expected_user_ids ONLY (decisions name only PAN2, source
 *    present)               ⇒ PAN leaves expected_user_ids; the
 *    decisions array is untouched; snapshot not emptied (PAN2 stays)
 *  I retention-expired   × source deleted, PAN referenced via
 *    decisions ONLY          ⇒ PAN's decision entry becomes JSON
 *    null (entries nulled, never deleted); expected_user_ids
 *    untouched; snapshot not emptied
 *
 * Run:
 *   SNAPSHOT2011_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/snap2011_e2e' \
 *     npx jest server/__tests__/lib/erasure-snapshot-sweep-2011.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.SNAPSHOT2011_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(120000);

const HOST = 201101; // candidate who owns every host recording/event
const PAN = 201102; // panel user whose references expire
const PAN2 = 201103; // panel user whose references stay live
const PAN_HELD = 201104; // panel user under an active legal hold
const REC = 201105; // recruiter
const HASH = 'e'.repeat(64);

let seedPool;
let sweepPanelConsentSnapshots;

const R = {}; // cell -> { eventId, recordingId, jobId, runId }
const SNAP_TEXT = {}; // "cell:kind" -> panel_consent_snapshot::text before any sweep

function snap(entries) {
	// Canonical gate shape (lib/diarizationGate.js P5).
	return JSON.stringify({
		expected_user_ids: entries.map((e) => e.user),
		expected_hash: HASH,
		decisions: entries.map((e) => ({
			user_id: e.user,
			record_id: e.recordId,
			decision: 'granted',
			notice_version: 'v1',
			decided_at: '2026-10-20T00:00:00.000Z',
		})),
	});
}

async function mkEvent(q) {
	const { rows } = await q(
		`INSERT INTO interview_events (recruiter_id, candidate_id, duration_minutes, timezone, status)
		 VALUES ($1, $2, 60, 'UTC', 'completed') RETURNING id`,
		[REC, HOST],
	);
	return rows[0].id;
}

async function mkConsent(q, eventId, userId) {
	const { rows } = await q(
		`INSERT INTO event_labelling_consent (interview_event_id, user_id, decision, notice_version, decided_at)
		 VALUES ($1, $2, 'granted', 'v1', '2026-10-20T00:05:00Z') RETURNING id`,
		[eventId, userId],
	);
	return rows[0].id;
}

async function mkRecording(q, eventId, { status = 'completed', retention = 'future' } = {}) {
	const { rows } = await q(
		`INSERT INTO interview_recordings (interview_event_id, status, retention_expires_at)
		 VALUES ($1, $2, CASE WHEN $3 = 'past' THEN NOW() - INTERVAL '1 day' ELSE NOW() + INTERVAL '90 days' END)
		 RETURNING id`,
		[eventId, status, retention],
	);
	return rows[0].id;
}

async function mkJob(q, recordingId, snapshot) {
	const { rows } = await q(
		`INSERT INTO diarization_jobs (recording_id, status, panel_consent_snapshot)
		 VALUES ($1, 'complete', $2::jsonb) RETURNING id`,
		[recordingId, snapshot],
	);
	return rows[0].id;
}

async function mkRun(q, recordingId, jobId, snapshot) {
	const { rows } = await q(
		`INSERT INTO diarization_runs (recording_id, job_id, panel_consent_snapshot)
		 VALUES ($1, $2, $3::jsonb) RETURNING id`,
		[recordingId, jobId, snapshot],
	);
	return rows[0].id;
}

async function snapText(table, id) {
	const { rows } = await seedPool.query(
		`SELECT panel_consent_snapshot::text AS snap FROM ${table} WHERE id = $1`,
		[id],
	);
	return rows[0]?.snap ?? null;
}

async function snapJson(table, id) {
	const { rows } = await seedPool.query(
		`SELECT panel_consent_snapshot AS snap FROM ${table} WHERE id = $1`,
		[id],
	);
	return rows[0]?.snap ?? null;
}

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	const userIds = [HOST, PAN, PAN2, PAN_HELD, REC];
	await q(`DELETE FROM legal_holds WHERE user_id = ANY($1::int[])`, [userIds]);
	await q(
		`DELETE FROM diarization_runs WHERE recording_id IN (SELECT id FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1))`,
		[HOST],
	);
	await q(
		`DELETE FROM diarization_jobs WHERE recording_id IN (SELECT id FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1))`,
		[HOST],
	);
	await q(
		`DELETE FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1)`,
		[HOST],
	);
	await q(`DELETE FROM event_labelling_consent WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1)`, [HOST]);
	await q(`DELETE FROM interview_events WHERE candidate_id = $1`, [HOST]);
	await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);
	await q(
		`INSERT INTO users (id, email, name, role) VALUES
		   ($1,'host-2011@test.local','Host Cand','candidate'),
		   ($2,'pan-2011@test.local','Pan One','recruiter'),
		   ($3,'pan2-2011@test.local','Pan Two','recruiter'),
		   ($4,'panheld-2011@test.local','Pan Held','recruiter'),
		   ($5,'rec-2011@test.local','Rec 2011','recruiter')`,
		userIds,
	);

	// One cell builder: event + consent rows (some deleted after the
	// snapshot froze their record_id — the erasure posture), recording,
	// job, optional run.
	async function cell(key, { status, retention, panSource, pan2Source = false, jobSnap, runSnap = null, held = false }) {
		const eventId = await mkEvent(q);
		const panRecord = await mkConsent(q, eventId, PAN);
		let pan2Record = null;
		if (pan2Source || jobSnap?.includes('PAN2')) pan2Record = await mkConsent(q, eventId, PAN2);
		if (held) {
			const heldRecord = await mkConsent(q, eventId, PAN_HELD);
			if (!panSource) await q(`DELETE FROM event_labelling_consent WHERE id = $1`, [heldRecord]);
			await q(`INSERT INTO legal_holds (user_id, reason, set_by) VALUES ($1, 'test hold 2011', '2011-test')`, [PAN_HELD]);
			const recordingId = await mkRecording(q, eventId, { status, retention });
			const jobId = await mkJob(q, recordingId, snap([{ user: PAN_HELD, recordId: heldRecord }]));
			R[key] = { eventId, recordingId, jobId };
			return;
		}
		const recordingId = await mkRecording(q, eventId, { status, retention });
		const build = (which) =>
			snap(
				jobSnap.map((who) => {
					if (who === 'PAN') return { user: PAN, recordId: panRecord };
					if (who === 'PAN2') return { user: PAN2, recordId: pan2Record };
					throw new Error(`bad fixture entry ${who}`);
				}),
			);
		const jobId = await mkJob(q, recordingId, build('job'));
		let runId = null;
		if (runSnap) runId = await mkRun(q, recordingId, jobId, snap(runSnap.map((who) => ({ user: who === 'PAN' ? PAN : PAN2, recordId: who === 'PAN' ? panRecord : pan2Record }))));
		if (!panSource) await q(`DELETE FROM event_labelling_consent WHERE id = $1`, [panRecord]);
		R[key] = { eventId, recordingId, jobId, runId };
	}

	await cell('A', { status: 'completed', retention: 'future', panSource: true, jobSnap: ['PAN'] });
	await cell('B', { status: 'completed', retention: 'future', panSource: false, jobSnap: ['PAN'] });
	await cell('C', { status: 'completed', retention: 'past', panSource: true, jobSnap: ['PAN'], runSnap: ['PAN'] });
	await cell('D', { status: 'completed', retention: 'past', panSource: false, jobSnap: ['PAN'] });
	await cell('E', { status: 'deleted', retention: 'future', panSource: false, pan2Source: true, jobSnap: ['PAN', 'PAN2'], runSnap: ['PAN'] });
	await cell('F', { status: 'deleted', retention: 'future', panSource: false, held: true });
	await cell('G', { status: 'deleted', retention: 'future', panSource: true, pan2Source: true, jobSnap: ['PAN2'] });

	// H: PAN only in expected_user_ids; decisions name only PAN2.
	{
		const eventId = await mkEvent(q);
		const panRecord = await mkConsent(q, eventId, PAN);
		const pan2Record = await mkConsent(q, eventId, PAN2);
		const recordingId = await mkRecording(q, eventId, { status: 'deleted', retention: 'future' });
		const snapshot = JSON.stringify({
			expected_user_ids: [PAN, PAN2],
			expected_hash: HASH,
			decisions: [
				{ user_id: PAN2, record_id: pan2Record, decision: 'granted', notice_version: 'v1', decided_at: '2026-10-20T00:00:00.000Z' },
			],
		});
		const jobId = await mkJob(q, recordingId, snapshot);
		await q(`DELETE FROM event_labelling_consent WHERE id = $1`, [panRecord]);
		R.H = { eventId, recordingId, jobId };
	}
	// I: PAN only in decisions; expected_user_ids names only PAN2.
	{
		const eventId = await mkEvent(q);
		const panRecord = await mkConsent(q, eventId, PAN);
		const pan2Record = await mkConsent(q, eventId, PAN2);
		const recordingId = await mkRecording(q, eventId, { status: 'completed', retention: 'past' });
		const snapshot = JSON.stringify({
			expected_user_ids: [PAN2],
			expected_hash: HASH,
			decisions: [
				{ user_id: PAN, record_id: panRecord, decision: 'granted', notice_version: 'v1', decided_at: '2026-10-20T00:00:00.000Z' },
				{ user_id: PAN2, record_id: pan2Record, decision: 'granted', notice_version: 'v1', decided_at: '2026-10-20T00:00:00.000Z' },
			],
		});
		const jobId = await mkJob(q, recordingId, snapshot);
		await q(`DELETE FROM event_labelling_consent WHERE id = $1`, [panRecord]);
		R.I = { eventId, recordingId, jobId };
	}

	for (const [key, cellR] of Object.entries(R)) {
		SNAP_TEXT[`${key}:job`] = await snapText('diarization_jobs', cellR.jobId);
		if (cellR.runId) SNAP_TEXT[`${key}:run`] = await snapText('diarization_runs', cellR.runId);
	}
}

describeIfDb('#2011 Part B snapshot retention-clock sweep (Quinn E2E, realdb)', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		seedPool = new Pool({ connectionString: DB_URL });
		await cleanAndSeed();
		({ sweepPanelConsentSnapshots } = require('../../../lib/erasureService'));
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('the sweep function is exported (red until Nova builds it)', () => {
		expect(typeof sweepPanelConsentSnapshots).toBe('function');
	});

	test('dry-run sweep: erasure-completion leg removes live, retention leg is counted not removed, held is counted', async () => {
		const res = await sweepPanelConsentSnapshots({ queryable: seedPool, dryRun: true });

		expect(res.scanned).toBe(11); // A,B,C(job+run),D,E(job+run),F,G,H,I jobs/runs with a snapshot
		expect(res.referencesRemoved).toBe(3); // E job PAN, E run PAN, H expected PAN
		expect(res.erasureLegRemoved).toBe(3);
		expect(res.retentionLegRemoved).toBe(0);
		expect(res.retentionLegDryRunSkipped).toBe(2); // D and I
		expect(res.snapshotsExpired).toBe(3); // E job, E run, H job modified
		expect(res.heldSkipped).toBe(1); // F
		expect(res.lookupFailedSkipped).toBe(0);

		// Untouched cells stay byte-identical.
		for (const key of ['A', 'B', 'C', 'D', 'F', 'G', 'I']) {
			expect(await snapText('diarization_jobs', R[key].jobId)).toBe(SNAP_TEXT[`${key}:job`]);
		}
		expect(await snapText('diarization_runs', R.C.runId)).toBe(SNAP_TEXT['C:run']);

		// E run: PAN was the only reference ⇒ column NULL, row survives.
		expect(await snapText('diarization_runs', R.E.runId)).toBeNull();
		const { rows: runRows } = await seedPool.query(`SELECT id FROM diarization_runs WHERE id = $1`, [R.E.runId]);
		expect(runRows.length).toBe(1);

		// E job: shared snapshot — only PAN's reference is gone.
		const eJob = await snapJson('diarization_jobs', R.E.jobId);
		expect(eJob.expected_user_ids).toEqual([PAN2]);
		expect(eJob.decisions[0]).toBeNull();
		expect(eJob.decisions[1].user_id).toBe(PAN2);

		// H: PAN left expected_user_ids; decisions untouched (PAN2 only).
		const hJob = await snapJson('diarization_jobs', R.H.jobId);
		expect(hJob.expected_user_ids).toEqual([PAN2]);
		expect(hJob.decisions).toHaveLength(1);
		expect(hJob.decisions[0].user_id).toBe(PAN2);
	});

	test('live sweep: retention leg now removes D and I; everything else already settled stays settled', async () => {
		const res = await sweepPanelConsentSnapshots({ queryable: seedPool, dryRun: false });

		expect(res.scanned).toBe(10); // E run snapshot is NULL now — no longer scanned
		expect(res.referencesRemoved).toBe(2); // D job PAN, I decisions PAN
		expect(res.retentionLegRemoved).toBe(2);
		expect(res.erasureLegRemoved).toBe(0);
		expect(res.retentionLegDryRunSkipped).toBe(0);
		expect(res.snapshotsExpired).toBe(2); // D job, I job
		expect(res.heldSkipped).toBe(1); // F still held, still counted
		expect(res.lookupFailedSkipped).toBe(0);

		// D: PAN was the only reference ⇒ NULL; the host job row survives.
		expect(await snapText('diarization_jobs', R.D.jobId)).toBeNull();
		const { rows: jobRows } = await seedPool.query(`SELECT id FROM diarization_jobs WHERE id = $1`, [R.D.jobId]);
		expect(jobRows.length).toBe(1);

		// I: PAN's decision entry nulled, never deleted; expected untouched.
		const iJob = await snapJson('diarization_jobs', R.I.jobId);
		expect(iJob.expected_user_ids).toEqual([PAN2]);
		expect(iJob.decisions).toHaveLength(2);
		expect(iJob.decisions[0]).toBeNull();
		expect(iJob.decisions[1].user_id).toBe(PAN2);

		// Live-source and live-host cells are STILL byte-identical.
		for (const key of ['A', 'B', 'C', 'F', 'G']) {
			expect(await snapText('diarization_jobs', R[key].jobId)).toBe(SNAP_TEXT[`${key}:job`]);
		}
		expect(await snapText('diarization_runs', R.C.runId)).toBe(SNAP_TEXT['C:run']);
	});

	test('third sweep is idempotent: nothing left to remove, held still counted honestly', async () => {
		const res = await sweepPanelConsentSnapshots({ queryable: seedPool, dryRun: false });
		expect(res.referencesRemoved).toBe(0);
		expect(res.snapshotsExpired).toBe(0);
		expect(res.heldSkipped).toBe(1);
		expect(res.lookupFailedSkipped).toBe(0);
		// F's held reference is still there, untouched.
		expect(await snapText('diarization_jobs', R.F.jobId)).toBe(SNAP_TEXT['F:job']);
	});
});
