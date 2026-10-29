/**
 * #1973 — Erasure cleanup sweep: delete K-12 panel-kept skeleton
 * events once their last panel row is gone (#1964 follow-on).
 *
 * Quinn user-journey E2E on the fresh-install dev rig (HL-003),
 * written from STOP 1 as amended three times (issue comments
 * 6499901121 + 6499937562 + 6499960851 + 6499979485; the binding
 * predicate set is Amendment 3's C-4).
 *
 * The user's journey, in the order a user lives it:
 *  1. A candidate erases their account; one interview event is kept
 *     as a K-12 skeleton ONLY because panel speakers'
 *     event_labelling_consent rows parent it (the #1972 posture).
 *  2. Later the panel members erase their own accounts; the S-D19
 *     step deletes their panel rows — the skeleton's last keep basis
 *     ends.
 *  3. The recurring retention tick runs the deferred sweep
 *     (sweepPanelSkeletonEvents, beside sweepPendingStorageDeletions,
 *     NOT gated by RETENTION_PURGE_LIVE).
 *  4. The skeleton is gone. Everything that is NOT a provable
 *     skeleton-class row survives untouched.
 *
 * Seeded postures (one fresh-migrated DB, state read back after
 * every sweep run):
 *  S1  skeleton, panel rows present at seed, then BOTH panel rows
 *      removed (mixed decisions granted/declined — the last-row-gone
 *      signal is absence of rows, any decision) ⇒ swept.
 *  S2  skeleton with TWO panel rows, only ONE removed ⇒ persists.
 *  S3  held skeletons — one per C-2 attribution branch:
 *      (a) user hold on the candidate, (b) company hold on the
 *      DERIVED company (job_application_id → job_applications.
 *      company_id — the operative branch, GAP-G NULLs the
 *      candidate's users.company_id), (c) company hold on the
 *      candidate's users.company_id, (d) company hold via an
 *      interview_sessions row for the candidate ⇒ all persist,
 *      counted heldSkipped.
 *  S4  live-shaped event, tombstoned candidate, created AFTER the
 *      candidate's deleted_at (C-1 chronology — reachable via the
 *      event-create route, which never checks deleted_at) ⇒
 *      persists. This is B-5's seed: if the sweep deletes it, the
 *      conjunction is unsound and the story flips to the founder-
 *      gated marker route — this test goes red and STAYS red.
 *  S5  live-shaped event, LIVE candidate (mig-126 defaults match
 *      the K-12 signature exactly) ⇒ persists.
 *  S6  skeleton WITH a recording ⇒ excluded (A-2 dependents block).
 *  S7  skeleton WITH a proposed_slot ⇒ excluded (A-2).
 *  S8  skeleton WITH an interview_room ⇒ excluded (A-2).
 *  S9  partial tombstone (deleted_at set, name NOT 'Deleted User')
 *      ⇒ excluded (B-3 conjunction, fail-closed).
 *  S10 partial tombstone (name + deleted_at, email embeds a
 *      DIFFERENT candidate id) ⇒ excluded (B-3 embedded-id equality).
 *  R1  held skeleton whose hold is RELEASED between runs ⇒ re-queued
 *      only: deleted by the NEXT sweep under full re-derivation,
 *      never by the release itself (B-1/C-5).
 *  AC-5 posture audit: after the final sweep, NO event anywhere
 *      matches the full C-4 conjunction (zero panel rows, zero
 *      recordings, zero slots, zero rooms, no active hold).
 *
 * Run:
 *   SKELETON1973_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/skel1973_e2e' \
 *     npx jest server/__tests__/lib/erasure-skeleton-sweep-1973.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.SKELETON1973_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(120000);

const REC = 197303;
const PAN1 = 197304;
const PAN2 = 197305;
const CAND = 197301; // main tombstoned candidate (S1, S2, S6, S7, S8)
const CAND_LIVE = 197302; // S5
const CAND_HOLD_USER = 197307; // S3a
const CAND_HOLD_DERIVED = 197308; // S3b
const CAND_HOLD_OWNCO = 197310; // S3c
const CAND_HOLD_SESSION = 197309; // S3d
const CAND_POST = 197312; // S4 post-erasure-created live event
const CAND_PARTIAL_NAME = 197313; // S9
const CAND_WRONG_ID = 197314; // S10
const CAND_REL = 197311; // R1 hold-release

const CO_REC = 19731;
const CO_DERIVED = 19732;
const CO_SESSION = 19733;
const CO_OWN = 19734;

const DELETED_AT = '2026-10-25T00:00:00Z';
const EVENT_AT = '2026-10-20T15:00:00Z'; // before DELETED_AT (chronology passes)
const POST_EVENT_AT = '2026-10-27T15:00:00Z'; // after DELETED_AT (C-1 excludes)

let seedPool;
let sweepPanelSkeletonEvents;

const R = {};

function tombstoneEmail(id) {
	return `deleted_${id}_ab12cd34@deleted.local`;
}

async function mkUser(q, id, { tombstoned = true, companyId = null, name = null } = {}) {
	if (tombstoned) {
		await q(
			`INSERT INTO users (id, email, name, role, company_id, deleted_at)
			 VALUES ($1, $2, 'Deleted User', 'candidate', $3, $4)`,
			[id, tombstoneEmail(id), companyId, DELETED_AT],
		);
	} else {
		await q(
			`INSERT INTO users (id, email, name, role, company_id)
			 VALUES ($1, $2, $3, 'candidate', $4)`,
			[id, `user-${id}@test.local`, name || `User ${id}`, companyId],
		);
	}
}

// A K-12 skeleton exactly as GAP-C leaves it: the five assignments
// (notes/meeting_link/livekit_room_url/calendar_event_ids NULL,
// panel_member_ids '{}'), created BEFORE the candidate's erasure.
async function mkSkeleton(q, candId, { createdAt = EVENT_AT, jobApplicationId = null } = {}) {
	const { rows } = await q(
		`INSERT INTO interview_events
		   (recruiter_id, candidate_id, job_application_id, panel_member_ids, scheduled_at,
		    duration_minutes, timezone, status, calendar_event_ids, livekit_room_url,
		    meeting_link, notes, created_at, updated_at)
		 VALUES ($1, $2, $3, '{}', '2026-10-20T15:00:00Z', 45, 'America/Los_Angeles', 'completed',
		         NULL, NULL, NULL, NULL, $4, $4) RETURNING id`,
		[REC, candId, jobApplicationId, createdAt],
	);
	return rows[0].id;
}

// A live-shaped event matching the K-12 signature ONLY through the
// migration-126 defaults (never redacted, never erased content).
async function mkLiveShaped(q, candId, { createdAt }) {
	const { rows } = await q(
		`INSERT INTO interview_events
		   (recruiter_id, candidate_id, scheduled_at, duration_minutes, timezone, status, created_at, updated_at)
		 VALUES ($1, $2, '2026-10-28T15:00:00Z', 60, 'UTC', 'proposed', $3, $3) RETURNING id`,
		[REC, candId, createdAt],
	);
	return rows[0].id;
}

async function mkPanel(q, eventId, userId, decision) {
	const { rows } = await q(
		`INSERT INTO event_labelling_consent
		   (interview_event_id, user_id, decision, notice_version, decided_at, ip_address, user_agent_hash)
		 VALUES ($1, $2, $3, 'v1', '2026-10-20T15:05:00Z', '10.0.0.1', 'uah-1973') RETURNING id`,
		[eventId, userId, decision],
	);
	return rows[0].id;
}

async function eventExists(eventId) {
	const { rows } = await seedPool.query(`SELECT id FROM interview_events WHERE id = $1`, [eventId]);
	return rows.length === 1;
}

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	const candIds = [
		CAND,
		CAND_LIVE,
		CAND_HOLD_USER,
		CAND_HOLD_DERIVED,
		CAND_HOLD_OWNCO,
		CAND_HOLD_SESSION,
		CAND_POST,
		CAND_PARTIAL_NAME,
		CAND_WRONG_ID,
		CAND_REL,
	];
	const allUsers = [...candIds, REC, PAN1, PAN2];
	await q(`DELETE FROM legal_holds WHERE user_id = ANY($1::int[]) OR company_id = ANY($2::int[])`, [
		allUsers,
		[CO_REC, CO_DERIVED, CO_SESSION, CO_OWN],
	]);
	await q(
		`DELETE FROM event_labelling_consent WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = ANY($1::int[]))`,
		[candIds],
	);
	await q(
		`DELETE FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = ANY($1::int[]))`,
		[candIds],
	);
	await q(
		`DELETE FROM proposed_slots WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = ANY($1::int[]))`,
		[candIds],
	);
	await q(
		`DELETE FROM interview_rooms WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = ANY($1::int[]))`,
		[candIds],
	);
	await q(`DELETE FROM interview_sessions WHERE candidate_id = ANY($1::int[])`, [candIds]);
	await q(`DELETE FROM interview_events WHERE candidate_id = ANY($1::int[])`, [candIds]);
	await q(`DELETE FROM job_applications WHERE candidate_id = ANY($1::int[])`, [candIds]);
	await q(`DELETE FROM jobs WHERE company_id = ANY($1::int[])`, [
		[CO_REC, CO_DERIVED, CO_SESSION, CO_OWN],
	]);
	await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [allUsers]);
	await q(`DELETE FROM companies WHERE id = ANY($1::int[])`, [
		[CO_REC, CO_DERIVED, CO_SESSION, CO_OWN],
	]);

	await q(
		`INSERT INTO companies (id, name) VALUES ($1,'Sweep Co'),($2,'Derived Co'),($3,'Session Co'),($4,'Own Co')`,
		[CO_REC, CO_DERIVED, CO_SESSION, CO_OWN],
	);
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES ($1,'rec-1973@test.local','Rec 1973','recruiter',$4),($2,'pan1-1973@test.local','Pan One','recruiter',$4),($3,'pan2-1973@test.local','Pan Two','recruiter',$4)`,
		[REC, PAN1, PAN2, CO_REC],
	);

	for (const id of [
		CAND,
		CAND_HOLD_USER,
		CAND_HOLD_DERIVED,
		CAND_HOLD_SESSION,
		CAND_POST,
		CAND_REL,
	]) {
		await mkUser(q, id, {});
	}
	await mkUser(q, CAND_HOLD_OWNCO, { companyId: CO_OWN });
	await mkUser(q, CAND_LIVE, { tombstoned: false, name: 'Live Candidate' });
	// S9: deleted_at + synthetic email, but name is NOT 'Deleted User'.
	await q(
		`INSERT INTO users (id, email, name, role, deleted_at) VALUES ($1, $2, 'Not Deleted Name', 'candidate', $3)`,
		[CAND_PARTIAL_NAME, tombstoneEmail(CAND_PARTIAL_NAME), DELETED_AT],
	);
	// S10: full tombstone shape, but the email embeds a DIFFERENT
	// id (999999 — no such user; users.email is UNIQUE so it cannot
	// embed CAND's own live tombstone address).
	await q(
		`INSERT INTO users (id, email, name, role, deleted_at) VALUES ($1, $2, 'Deleted User', 'candidate', $3)`,
		[CAND_WRONG_ID, tombstoneEmail(999999), DELETED_AT],
	);

	// S1: skeleton with two panel rows (mixed decisions).
	R.s1 = await mkSkeleton(q, CAND);
	await mkPanel(q, R.s1, PAN1, 'granted');
	await mkPanel(q, R.s1, PAN2, 'declined');
	// S2: skeleton with two panel rows; only one will be removed.
	R.s2 = await mkSkeleton(q, CAND);
	R.s2panelKeep = await mkPanel(q, R.s2, PAN1, 'granted');
	await mkPanel(q, R.s2, PAN2, 'withdrawn');

	// S3 holds — one skeleton per attribution branch.
	R.s3a = await mkSkeleton(q, CAND_HOLD_USER);
	await q(
		`INSERT INTO legal_holds (user_id, reason, set_by) VALUES ($1, 'test hold a', '1973-test')`,
		[CAND_HOLD_USER],
	);
	// S3b: derived company via job_application.
	const job = await q(
		`INSERT INTO jobs (title, company_id) VALUES ('Derived Job', $1) RETURNING id`,
		[CO_DERIVED],
	);
	const ja = await q(
		`INSERT INTO job_applications (job_id, candidate_id, company_id) VALUES ($1, $2, $3) RETURNING id`,
		[job.rows[0].id, CAND_HOLD_DERIVED, CO_DERIVED],
	);
	R.s3b = await mkSkeleton(q, CAND_HOLD_DERIVED, { jobApplicationId: ja.rows[0].id });
	await q(
		`INSERT INTO legal_holds (company_id, reason, set_by) VALUES ($1, 'test hold b', '1973-test')`,
		[CO_DERIVED],
	);
	// S3c: candidate's own users.company_id.
	R.s3c = await mkSkeleton(q, CAND_HOLD_OWNCO);
	await q(
		`INSERT INTO legal_holds (company_id, reason, set_by) VALUES ($1, 'test hold c', '1973-test')`,
		[CO_OWN],
	);
	// S3d: company via an interview_sessions row for the candidate.
	R.s3d = await mkSkeleton(q, CAND_HOLD_SESSION);
	await q(`INSERT INTO interview_sessions (candidate_id, company_id) VALUES ($1, $2)`, [
		CAND_HOLD_SESSION,
		CO_SESSION,
	]);
	await q(
		`INSERT INTO legal_holds (company_id, reason, set_by) VALUES ($1, 'test hold d', '1973-test')`,
		[CO_SESSION],
	);

	// S4: B-5/C-1 — tombstoned candidate, live-shaped event created
	// AFTER the erasure (the reachable false positive).
	R.s4 = await mkLiveShaped(q, CAND_POST, { createdAt: POST_EVENT_AT });
	// S5: live candidate, live-shaped event (mig-126 defaults).
	R.s5 = await mkLiveShaped(q, CAND_LIVE, { createdAt: EVENT_AT });

	// S6/S7/S8: skeletons with dependents (A-2 — excluded, never
	// cascade-disposed).
	R.s6 = await mkSkeleton(q, CAND);
	await q(
		`INSERT INTO interview_recordings (interview_event_id, status, retention_expires_at) VALUES ($1, 'completed', NOW() + INTERVAL '90 days')`,
		[R.s6],
	);
	R.s7 = await mkSkeleton(q, CAND);
	await q(
		`INSERT INTO proposed_slots (interview_event_id, proposed_by, slot_start, slot_end) VALUES ($1, $2, '2026-10-21T15:00:00Z', '2026-10-21T15:45:00Z')`,
		[R.s7, REC],
	);
	R.s8 = await mkSkeleton(q, CAND);
	await q(
		`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id) VALUES ($1, 'room-1973', 'lk-1973')`,
		[R.s8],
	);

	// S9/S10: partial-tombstone skeletons.
	R.s9 = await mkSkeleton(q, CAND_PARTIAL_NAME);
	R.s10 = await mkSkeleton(q, CAND_WRONG_ID);

	// R1: held skeleton; the hold is released between sweep runs.
	R.r1 = await mkSkeleton(q, CAND_REL);
	const hold = await q(
		`INSERT INTO legal_holds (user_id, reason, set_by) VALUES ($1, 'test hold r1', '1973-test') RETURNING id`,
		[CAND_REL],
	);
	R.r1HoldId = hold.rows[0].id;
}

describeIfDb('#1973 skeleton cleanup sweep (Quinn E2E, realdb)', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		seedPool = new Pool({ connectionString: DB_URL });
		await cleanAndSeed();
		({ sweepPanelSkeletonEvents } = require('../../../lib/erasureService'));
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('the sweep function is exported (red until Nova builds it)', () => {
		expect(typeof sweepPanelSkeletonEvents).toBe('function');
	});

	test('journey: last panel row gone ⇒ skeleton swept; every other posture survives', async () => {
		// The panel members' own erasures remove their panel rows —
		// S1 loses BOTH rows, S2 loses only PAN2's row.
		await seedPool.query(`DELETE FROM event_labelling_consent WHERE interview_event_id = $1`, [
			R.s1,
		]);
		await seedPool.query(
			`DELETE FROM event_labelling_consent WHERE interview_event_id = $1 AND user_id = $2`,
			[R.s2, PAN2],
		);

		const res = await sweepPanelSkeletonEvents({ queryable: seedPool });

		// Counts are labelled skeleton-class (C-5), never "panel-kept".
		expect(res.label).toBe('skeleton-class');
		expect(res.deleted).toBe(1);
		expect(res.heldSkipped).toBe(5); // S3a–d (4) + R1 (1)
		expect(res.lookupFailedSkipped).toBe(0);
		// Scanned = signature + tombstone + chronology + zero panel
		// rows: S1, S3a–d, S6, S7, S8, R1 (S2 still has a panel row).
		expect(res.scanned).toBe(9);

		// S1 gone; S2 persists (one panel row remains).
		expect(await eventExists(R.s1)).toBe(false);
		expect(await eventExists(R.s2)).toBe(true);

		// Held skeletons persist (all four C-2 branches + R1).
		for (const id of [R.s3a, R.s3b, R.s3c, R.s3d, R.r1]) {
			expect(await eventExists(id)).toBe(true);
		}
		// False-positive guards persist: S4 (chronology), S5 (live).
		expect(await eventExists(R.s4)).toBe(true);
		expect(await eventExists(R.s5)).toBe(true);
		// Dependents block, never cascade: S6/S7/S8 persist whole.
		expect(await eventExists(R.s6)).toBe(true);
		expect(await eventExists(R.s7)).toBe(true);
		expect(await eventExists(R.s8)).toBe(true);
		const { rows: depRows } = await seedPool.query(
			`SELECT (SELECT COUNT(*)::int FROM interview_recordings WHERE interview_event_id = $1) AS recs,
			        (SELECT COUNT(*)::int FROM proposed_slots WHERE interview_event_id = $2) AS slots,
			        (SELECT COUNT(*)::int FROM interview_rooms WHERE interview_event_id = $3) AS rooms`,
			[R.s6, R.s7, R.s8],
		);
		expect(depRows[0]).toEqual({ recs: 1, slots: 1, rooms: 1 });
		// Partial tombstones persist (B-3 fail-closed).
		expect(await eventExists(R.s9)).toBe(true);
		expect(await eventExists(R.s10)).toBe(true);

		// Idempotent: a second run deletes nothing new.
		const res2 = await sweepPanelSkeletonEvents({ queryable: seedPool });
		expect(res2.deleted).toBe(0);
		expect(res2.heldSkipped).toBe(5);
	});

	test('hold release only re-queues: the NEXT sweep deletes under full re-derivation (B-1/C-5)', async () => {
		await seedPool.query(
			`UPDATE legal_holds SET released_at = NOW(), released_by = '1973-test' WHERE id = $1`,
			[R.r1HoldId],
		);
		// The release itself deleted nothing.
		expect(await eventExists(R.r1)).toBe(true);

		const res = await sweepPanelSkeletonEvents({ queryable: seedPool });
		expect(res.deleted).toBe(1);
		expect(await eventExists(R.r1)).toBe(false);
		// The still-held S3 skeletons remain.
		for (const id of [R.s3a, R.s3b, R.s3c, R.s3d]) {
			expect(await eventExists(id)).toBe(true);
		}
	});

	test('AC-5 posture audit: no C-4-matching event survives unheld anywhere', async () => {
		const { rows } = await seedPool.query(
			`SELECT ie.id FROM interview_events ie
			 JOIN users u ON u.id = ie.candidate_id
			 WHERE ie.notes IS NULL AND ie.meeting_link IS NULL
			   AND ie.livekit_room_url IS NULL AND ie.calendar_event_ids IS NULL
			   AND ie.panel_member_ids = '{}'
			   AND u.deleted_at IS NOT NULL AND u.name = 'Deleted User'
			   AND u.email ~ ('^deleted_' || ie.candidate_id || '_[^@]+@deleted\\.local$')
			   AND ie.created_at <= u.deleted_at
			   AND NOT EXISTS (SELECT 1 FROM interview_recordings ir WHERE ir.interview_event_id = ie.id)
			   AND NOT EXISTS (SELECT 1 FROM event_labelling_consent elc WHERE elc.interview_event_id = ie.id)
			   AND NOT EXISTS (SELECT 1 FROM proposed_slots ps WHERE ps.interview_event_id = ie.id)
			   AND NOT EXISTS (SELECT 1 FROM interview_rooms rm WHERE rm.interview_event_id = ie.id)
			   AND NOT EXISTS (
			     SELECT 1 FROM legal_holds lh WHERE lh.released_at IS NULL AND (
			       lh.user_id = ie.candidate_id
			       OR lh.company_id = (SELECT ja.company_id FROM job_applications ja WHERE ja.id = ie.job_application_id)
			       OR lh.company_id = u.company_id
			       OR lh.company_id IN (SELECT s.company_id FROM interview_sessions s WHERE s.candidate_id = ie.candidate_id)
			     ))`,
		);
		// Every remaining C-4-shaped row must be one of the knowingly
		// excluded postures: S6/S7/S8 carry dependents (already
		// excluded above, so this set must in fact be EMPTY).
		expect(rows).toEqual([]);
	});
});
