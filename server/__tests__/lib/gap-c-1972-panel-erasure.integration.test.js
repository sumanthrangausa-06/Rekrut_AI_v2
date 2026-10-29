/**
 * #1972 (GAP-C panel-consent partition, K-12 clause ruled on #1964) —
 * Quinn user-journey E2E on the fresh-install dev rig (HL-003).
 *
 * A candidate deletes their account. One of their interview events
 * carries panel speakers' event_labelling_consent rows but NO
 * recording. Before this fix, erasePersonalData() whole-DELETEd that
 * event, migration 299's ON DELETE RESTRICT aborted the statement,
 * and the candidate's ENTIRE erasure rolled back — the account could
 * not be deleted at all.
 *
 * Two drives of the REAL erasure path against a real fresh-migrated
 * Postgres, state read back from the DB after each:
 *  - Candidate A through the REAL HTTP door: DELETE
 *    /api/auth/delete-account (routes/auth.js, the production
 *    caller), incl. the disclosure check — the sanitised erasure
 *    result persisted in the account_deleted audit metadata must
 *    carry gapC.interviewEventsKeptForPanelConsent.
 *  - Candidate B through the exported erasePersonalData() in the
 *    production caller shape (one BEGIN…COMMIT transaction client),
 *    for the full result-object counts + the idempotent repeat.
 *
 * Quinn's 7 acceptance postures (issue #1972), seeded in ONE run:
 *  1. recording + panel rows — existing K-12 behaviour unchanged.
 *  2. panel rows, NO recording (the bug) — erasure COMPLETES; event
 *     is a redacted skeleton; panel rows byte-identical; counted as
 *     interviewEventsKeptForPanelConsent, not as deleted.
 *  3. no panel rows, no recording — whole-DELETE still happens.
 *  4. no panel rows, with recording — baseline unchanged.
 *  5. skeleton content audit — every column of the retained event
 *     enumerated against K-12 (kept set vs stripped set).
 *  6. repeat erasure on posture 2 — idempotent, no error, state
 *     unchanged, no double-count within a run.
 *  7. counts reconcile — deleted + redacted + kept-for-panel + held
 *     + lookup-failed = seeded total.
 *
 * Run:
 *   GAPC1972_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/gapc1972_e2e' \
 *     npx jest server/__tests__/lib/gap-c-1972-panel-erasure.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool, Client } = require('pg');

const DB_URL = process.env.GAPC1972_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(120000);

const U_REC = 197202;
const U_PAN1 = 197203;
const U_PAN2 = 197204;
const U_OTHER = 197205;
const CAND_A = 197201;
const CAND_B = 197206;
const C_ID = 19721;
const PASSWORD = 'Passw0rd!1972';

let app;
let request;
let generateToken;
let erasePersonalData;
let bcrypt;
let seedPool;

const R = { A: {}, B: {} };

async function seedCandidateEvents(candId, tag) {
	const q = (sql, params) => seedPool.query(sql, params);
	const out = {};
	const mkEvent = async (label) => {
		const ev = await q(
			`INSERT INTO interview_events
			   (recruiter_id, candidate_id, panel_member_ids, scheduled_at, duration_minutes, timezone, status,
			    calendar_event_ids, livekit_room_url, meeting_link, notes)
			 VALUES ($1, $2, $3, '2026-10-20T15:00:00Z', 45, 'America/Los_Angeles', 'completed',
			    $4, $5, $6, $7) RETURNING id`,
			[
				U_REC,
				candId,
				[U_PAN1, U_PAN2],
				JSON.stringify({ [U_REC]: `ext-${tag}-${label}` }),
				`https://livekit.example/${tag}-${label}`,
				`https://meet.example/${tag}-${label}`,
				`confidential notes ${tag}-${label}`,
			],
		);
		return ev.rows[0].id;
	};
	const mkRecording = async (eventId) => {
		const rec = await q(
			`INSERT INTO interview_recordings
			   (interview_event_id, interview_session_id, status, duration_seconds, storage_path, diarization_status, retention_expires_at)
			 VALUES ($1, NULL, 'completed', 1800, NULL, 'unavailable', NOW() + INTERVAL '90 days') RETURNING id`,
			[eventId],
		);
		return rec.rows[0].id;
	};
	const mkPanel = async (eventId, userId, decision, ip, hash) => {
		const p = await q(
			`INSERT INTO event_labelling_consent
			   (interview_event_id, user_id, decision, notice_version, decided_at, ip_address, user_agent_hash)
			 VALUES ($1, $2, $3, 'v1', '2026-10-20T15:05:00Z', $4, $5) RETURNING id`,
			[eventId, userId, decision, ip, hash],
		);
		return p.rows[0].id;
	};

	// Posture 1: recording + panel.
	out.e1 = await mkEvent('e1');
	out.r1 = await mkRecording(out.e1);
	await mkPanel(out.e1, U_PAN1, 'granted', '10.0.0.1', 'uah-e1-pan1');
	await mkPanel(out.e1, U_PAN2, 'declined', '10.0.0.2', 'uah-e1-pan2');
	// Posture 2: panel only, NO recording (the bug posture).
	out.e2 = await mkEvent('e2');
	await mkPanel(out.e2, U_PAN1, 'granted', '10.0.1.1', 'uah-e2-pan1');
	await mkPanel(out.e2, U_PAN2, 'withdrawn', '10.0.1.2', 'uah-e2-pan2');
	// Posture 3: neither.
	out.e3 = await mkEvent('e3');
	// Posture 4: recording only.
	out.e4 = await mkEvent('e4');
	out.r4 = await mkRecording(out.e4);
	return out;
}

async function panelRows(eventId) {
	const { rows } = await seedPool.query(
		`SELECT id, interview_event_id, user_id, decision, notice_version, decided_at, ip_address, user_agent_hash, created_at
		 FROM event_labelling_consent WHERE interview_event_id = $1 ORDER BY id`,
		[eventId],
	);
	return rows;
}

async function eventRow(eventId) {
	const { rows } = await seedPool.query(`SELECT * FROM interview_events WHERE id = $1`, [eventId]);
	return rows[0] || null;
}

function expectSkeleton(row, seeded) {
	expect(row).not.toBeNull();
	// K-12 kept set: linkage + scheduling facts survive as seeded.
	expect(row.id).toBe(seeded.id);
	expect(row.job_application_id).toBe(seeded.job_application_id);
	expect(row.interview_session_id).toBe(seeded.interview_session_id);
	expect(row.candidate_id).toBe(seeded.candidate_id);
	expect(row.recruiter_id).toBe(seeded.recruiter_id);
	expect(new Date(row.scheduled_at).getTime()).toBe(new Date(seeded.scheduled_at).getTime());
	expect(row.duration_minutes).toBe(seeded.duration_minutes);
	expect(row.timezone).toBe(seeded.timezone);
	expect(row.status).toBe(seeded.status);
	expect(new Date(row.created_at).getTime()).toBe(new Date(seeded.created_at).getTime());
	// Stripped set: exactly the five K-12 assignments.
	expect(row.notes).toBeNull();
	expect(row.meeting_link).toBeNull();
	expect(row.livekit_room_url).toBeNull();
	expect(row.calendar_event_ids).toBeNull();
	expect(row.panel_member_ids).toEqual([]);
}

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	const userIds = [CAND_A, CAND_B, U_REC, U_PAN1, U_PAN2, U_OTHER];
	await q(`DELETE FROM event_labelling_consent WHERE user_id = ANY($1::int[]) OR interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = ANY($1::int[]))`, [userIds]);
	await q(`DELETE FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = ANY($1::int[]))`, [userIds]);
	await q(`DELETE FROM interview_events WHERE candidate_id = ANY($1::int[])`, [userIds]);
	await q(`DELETE FROM audit_logs WHERE user_id = ANY($1::int[])`, [userIds]).catch(() => {});
	await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);
	await q(`DELETE FROM companies WHERE id = $1`, [C_ID]);

	await q(`INSERT INTO companies (id, name) VALUES ($1, 'GAP-C 1972 Co')`, [C_ID]);
	const hash = await bcrypt.hash(PASSWORD, 10);
	await q(
		`INSERT INTO users (id, email, name, role, company_id, password_hash) VALUES
		   ($1, 'cand-a-1972@test.local', 'Cand A 1972', 'candidate', NULL, $7),
		   ($2, 'cand-b-1972@test.local', 'Cand B 1972', 'candidate', NULL, $7),
		   ($3, 'rec-1972@test.local', 'Rec 1972', 'recruiter', $6, $7),
		   ($4, 'pan1-1972@test.local', 'Pan One', 'recruiter', $6, NULL),
		   ($5, 'pan2-1972@test.local', 'Pan Two', 'recruiter', $6, NULL),
		   ($8, 'other-1972@test.local', 'Other 1972', 'candidate', NULL, NULL)`,
		[CAND_A, CAND_B, U_REC, U_PAN1, U_PAN2, C_ID, hash, U_OTHER],
	);

	R.A = await seedCandidateEvents(CAND_A, 'a');
	R.B = await seedCandidateEvents(CAND_B, 'b');

	// Control: another candidate's event with a panel row — a
	// candidate erasure must never touch it or its panel rows.
	const ev = await q(
		`INSERT INTO interview_events (recruiter_id, candidate_id, duration_minutes, timezone, status, notes)
		 VALUES ($1, $2, 60, 'UTC', 'completed', 'other candidate notes') RETURNING id`,
		[U_REC, U_OTHER],
	);
	R.controlEvent = ev.rows[0].id;
	await q(
		`INSERT INTO event_labelling_consent (interview_event_id, user_id, decision, notice_version, ip_address, user_agent_hash)
		 VALUES ($1, $2, 'granted', 'v1', '10.9.9.9', 'uah-control')`,
		[R.controlEvent, U_PAN1],
	);
	// The erasing candidate's OWN panel row on the control event:
	// the S-D19 step deletes it by user_id (it is their own record).
	await q(
		`INSERT INTO event_labelling_consent (interview_event_id, user_id, decision, notice_version, ip_address, user_agent_hash)
		 VALUES ($1, $2, 'declined', 'v1', '10.9.9.8', 'uah-own')`,
		[R.controlEvent, CAND_A],
	);
}

async function runErasureViaService(userId) {
	const client = new Client({ connectionString: DB_URL });
	await client.connect();
	try {
		await client.query('BEGIN');
		const result = await erasePersonalData(userId, { client });
		await client.query('COMMIT');
		return result;
	} catch (err) {
		await client.query('ROLLBACK').catch(() => {});
		throw err;
	} finally {
		await client.end();
	}
}

describeIfDb('#1972 GAP-C panel-consent partition (Quinn E2E, realdb)', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		process.env.JWT_SECRET = 'gapc1972-test-secret';
		process.env.ENCRYPTION_KEY = 'a'.repeat(64);
		process.env.BIOMETRIC_ENCRYPTION_KEY = 'b'.repeat(64);
		process.env.AI_KEYS_JSON = JSON.stringify({ openai: 'test-key' });

		seedPool = new Pool({ connectionString: DB_URL });
		bcrypt = require('bcryptjs');
		await cleanAndSeed();

		({ erasePersonalData } = require('../../../lib/erasureService'));
		({ generateToken } = require('../../../lib/auth'));

		const express = require('express');
		request = require('supertest');
		const authRouter = require('../../../routes/auth');
		app = express();
		app.use(express.json());
		app.use('/api/auth', authRouter);
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('postures 1-5 + disclosure via the REAL HTTP door (DELETE /api/auth/delete-account)', async () => {
		const ids = R.A;
		// Seed sanity + byte-level panel snapshots before erasure.
		const panelE1Before = await panelRows(ids.e1);
		const panelE2Before = await panelRows(ids.e2);
		expect(panelE1Before).toHaveLength(2);
		expect(panelE2Before).toHaveLength(2);
		const seededE1 = await eventRow(ids.e1);
		const seededE2 = await eventRow(ids.e2);
		const seededE4 = await eventRow(ids.e4);
		expect(seededE2.notes).toBe('confidential notes a-e2');
		const controlPanelBefore = await panelRows(R.controlEvent);
		expect(controlPanelBefore).toHaveLength(2);

		// The user's act: delete my account, through the real door.
		const token = generateToken({ id: CAND_A, email: 'cand-a-1972@test.local', role: 'candidate' });
		const res = await request(app)
			.delete('/api/auth/delete-account')
			.set('Authorization', `Bearer ${token}`)
			.send({ password: PASSWORD });

		// Posture 2 headline: erasure COMPLETES (pre-fix this rolled
		// back on mig 299 RESTRICT and the door answered 500).
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);

		// Postures 1 & 4: recording-linked events are K-12 skeletons
		// (kept fields exactly as seeded, stripped fields nulled).
		expectSkeleton(await eventRow(ids.e1), seededE1);
		expectSkeleton(await eventRow(ids.e4), seededE4);

		// Posture 2: panel-only event is a redacted skeleton, and its
		// panel rows are BYTE-IDENTICAL (other users' records).
		const e2 = await eventRow(ids.e2);
		expectSkeleton(e2, seededE2);
		expect(await panelRows(ids.e2)).toEqual(panelE2Before);
		expect(await panelRows(ids.e1)).toEqual(panelE1Before);

		// Posture 3: neither-flag event is whole-DELETED.
		expect(await eventRow(ids.e3)).toBeNull();

		// Posture 5: skeleton audit — EVERY column of the retained
		// posture-2 event is in the K-12 kept set or the stripped set.
		const { rows: cols } = await seedPool.query(
			`SELECT column_name FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'interview_events' ORDER BY column_name`,
		);
		// Kept = the K-12 linkage/scheduling set PLUS interview_session_id
		// (mig 129's structural session link — same linkage class as
		// job_application_id; NULL on these event-native rows, verified
		// unchanged by expectSkeleton's full-row comparisons elsewhere).
		const kept = new Set([
			'id', 'job_application_id', 'candidate_id', 'recruiter_id', 'scheduled_at',
			'duration_minutes', 'timezone', 'status', 'created_at', 'updated_at',
			'interview_session_id',
		]);
		const stripped = new Set(['notes', 'meeting_link', 'livekit_room_url', 'calendar_event_ids', 'panel_member_ids']);
		for (const { column_name } of cols) {
			expect(kept.has(column_name) || stripped.has(column_name)).toBe(true);
		}

		// Control event + its panel row untouched; the candidate's OWN
		// panel row on it is gone (S-D19, by user_id).
		const controlAfter = await eventRow(R.controlEvent);
		expect(controlAfter.notes).toBe('other candidate notes');
		const controlPanelAfter = await panelRows(R.controlEvent);
		expect(controlPanelAfter).toHaveLength(1);
		expect(controlPanelAfter[0].user_id).toBe(U_PAN1);

		// Disclosure: the account_deleted audit metadata (sanitised
		// erasure result) carries the separate kept-for-panel count —
		// never "everything deleted" while the skeleton stands.
		const { rows: auditRows } = await seedPool.query(
			`SELECT metadata FROM audit_logs WHERE user_id = $1 AND action_type = 'account_deleted' ORDER BY id DESC LIMIT 1`,
			[CAND_A],
		);
		expect(auditRows).toHaveLength(1);
		const meta = typeof auditRows[0].metadata === 'string' ? JSON.parse(auditRows[0].metadata) : auditRows[0].metadata;
		expect(meta.gapC.interviewEventsKeptForPanelConsent).toBe(1);
		expect(meta.gapC.interviewEventsRedacted).toBe(2);
		expect(meta.gapC.interviewEventsDeleted).toBe(1);
	});

	test('postures 6-7: counts reconcile in the result object; repeat erasure on posture 2 is idempotent', async () => {
		const ids = R.B;
		const panelE2Before = await panelRows(ids.e2);
		expect(panelE2Before).toHaveLength(2);

		const result = await runErasureViaService(CAND_B);

		// Posture 7 reconciliation (no holds seeded → held/lookupFailed 0):
		// deleted(e3) 1 + redacted(e1,e4) 2 + kept-for-panel(e2) 1 = 4 seeded.
		expect(result.gapC.interviewEventsDeleted).toBe(1);
		expect(result.gapC.interviewEventsRedacted).toBe(2);
		expect(result.gapC.interviewEventsKeptForPanelConsent).toBe(1);
		expect(result.gapC.rowsHeld).toBe(0);
		expect(result.gapC.holdLookupFailed).toBe(0);
		expect(
			result.gapC.interviewEventsDeleted +
				result.gapC.interviewEventsRedacted +
				result.gapC.interviewEventsKeptForPanelConsent +
				result.gapC.rowsHeld +
				result.gapC.holdLookupFailed,
		).toBe(4);

		const e2AfterFirst = await eventRow(ids.e2);
		expect(e2AfterFirst.notes).toBeNull();
		expect(await panelRows(ids.e2)).toEqual(panelE2Before);

		// Posture 6: repeat the whole erasure — completes, no error,
		// posture-2 state byte-identical afterwards, panel rows
		// unchanged, and the repeat run's own counts do not
		// double-count (kept-for-panel is 1 again, deleted is 0 —
		// the skeleton was never deleted).
		const repeat = await runErasureViaService(CAND_B);
		expect(repeat.gapC.interviewEventsKeptForPanelConsent).toBe(1);
		expect(repeat.gapC.interviewEventsDeleted).toBe(0);
		expect(await eventRow(ids.e2)).toEqual(e2AfterFirst);
		expect(await panelRows(ids.e2)).toEqual(panelE2Before);
	});
});
