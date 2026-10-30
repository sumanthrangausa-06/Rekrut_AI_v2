/**
 * S-D18 (#1955) — BR-7 capture: T-C1..T-C6 + freeze, REAL-DB integration (HL-003).
 * STOP 1 amendments over design §14: foreign user_id is REJECTED + audited
 * (security BLOCK-2, supersedes design T-C1 "ignored"); roster_version is a
 * keyed HMAC-SHA256 (security BLOCK-1); panel_expected_hash is DB-only plain
 * SHA-256 hex, never API-returned.
 *
 * Run:
 *   SD18_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd18_fresh' \
 *     npx jest server/__tests__/routes/panel-labelling-1955.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');
// #1961: the global setup (server/test/setup.js) also stubs
// lib/distributed-rate-limiter with a checkLimit that ALWAYS allows —
// under that stub the capture handler's 429 path can never fire, which
// is exactly how the S-D18 rate limit shipped untested. Unmock it so
// T-C8/T-C10 exercise the real DB-backed limiter (HL-003).
jest.unmock('../../../lib/distributed-rate-limiter');

const { Pool } = require('pg');
const DB_URL = process.env.SD18_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;
jest.setTimeout(60000);

const U_REC = 195501;
const U_CAND = 195502;
const U_PANEL = 195503;
const U_STRANGER = 195504;
const EV = 19551;
const EV_OVERLAP = 19552; // candidate also in panel_member_ids
const EV_FAIL = 19553; // #1961 T-C9 rollback event (cleaned by seed so the suite is re-runnable)
const EV_RL = 19554; // #1961 T-C8 exact-threshold event (fresh bucket per run)

let app;
let request;
let generateToken;
let seedPool;
let roomId;
let overlapRoomId;
let rosterVersion;

const tok = (id, email, role) => generateToken({ id, email, role });
const recTok = () => tok(U_REC, 'rec1955@test.local', 'recruiter');
const panelTok = () => tok(U_PANEL, 'panel1955@test.local', 'recruiter');
const candTok = () => tok(U_CAND, 'cand1955@test.local', 'candidate');

async function seed() {
	await seedPool.query(`DELETE FROM event_labelling_consent WHERE interview_event_id IN ($1,$2,$3,$4)`, [EV, EV_OVERLAP, EV_FAIL, EV_RL]).catch(() => {});
	await seedPool.query(`DELETE FROM interview_rooms WHERE interview_event_id IN ($1,$2,$3,$4)`, [EV, EV_OVERLAP, EV_FAIL, EV_RL]);
	await seedPool.query(`DELETE FROM interview_recordings WHERE interview_event_id IN ($1,$2,$3,$4)`, [EV, EV_OVERLAP, EV_FAIL, EV_RL]);
	await seedPool.query(`DELETE FROM interview_events WHERE id IN ($1,$2,$3,$4)`, [EV, EV_OVERLAP, EV_FAIL, EV_RL]);
	// #1961: rate-limit buckets persist across suite runs in the same DB —
	// clear this suite's keys so cap counts are deterministic per run.
	await seedPool.query(`DELETE FROM rate_limit_buckets WHERE key LIKE 'panel-labelling%'`).catch(() => {});
	await seedPool.query(`DELETE FROM users WHERE id = ANY($1)`, [[U_REC, U_CAND, U_PANEL, U_STRANGER]]);
	for (const [id, email, name, role] of [
		[U_REC, 'rec1955@test.local', 'Rec 1955', 'recruiter'],
		[U_CAND, 'cand1955@test.local', 'Cand 1955', 'candidate'],
		[U_PANEL, 'panel1955@test.local', 'Panel 1955', 'recruiter'],
		[U_STRANGER, 'stranger1955@test.local', 'Stranger 1955', 'recruiter'],
	]) {
		await seedPool.query(
			`INSERT INTO users (id, email, name, role, password_hash) VALUES ($1,$2,$3,$4,'x')`,
			[id, email, name, role],
		);
	}
	await seedPool.query(
		`INSERT INTO interview_events (id, recruiter_id, candidate_id, panel_member_ids, status)
		 VALUES ($1,$2,$3,$4,'confirmed'), ($5,$2,$3,$6,'confirmed')`,
		[EV, U_REC, U_CAND, [U_PANEL], EV_OVERLAP, [U_CAND, U_PANEL]],
	);
	const r1 = await seedPool.query(
		`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id, status)
		 VALUES ($1,'room-1955-a','RM_a','active') RETURNING id`, [EV]);
	roomId = r1.rows[0].id;
	const r2 = await seedPool.query(
		`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id, status)
		 VALUES ($1,'room-1955-b','RM_b','active') RETURNING id`, [EV_OVERLAP]);
	overlapRoomId = r2.rows[0].id;
}

async function getToken(room, token) {
	return request(app).post(`/api/livekit/rooms/${room}/token`)
		.set('Authorization', `Bearer ${token}`).send({});
}
async function capture(eventId, token, body) {
	return request(app).post(`/api/interviews/events/${eventId}/labelling-consent`)
		.set('Authorization', `Bearer ${token}`).send(body);
}
async function consentRows(eventId, userId) {
	const r = await seedPool.query(
		`SELECT * FROM event_labelling_consent WHERE interview_event_id=$1 AND user_id=$2 ORDER BY id`,
		[eventId, userId]);
	return r.rows;
}

describeIfDb('S-D18 BR-7 capture (#1955, realdb)', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		process.env.JWT_SECRET = 'sd18-test-secret';
		process.env.LIVEKIT_API_KEY = 'test-key';
		process.env.LIVEKIT_API_SECRET = 'test-secret';
		process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
		seedPool = new Pool({ connectionString: DB_URL });
		await seed();
		const express = require('express');
		request = require('supertest');
		({ generateToken } = require('../../../lib/auth'));
		const eventsRouter = require('../../../routes/interview-events');
		const livekitRouter = require('../../routes/livekit');
		app = express();
		app.use(express.json());
		app.use('/api/interviews', eventsRouter);
		app.use('/api/livekit', livekitRouter);
		// Roster version as the server presents it (via a panel token).
		const t = await getToken(roomId, panelTok());
		rosterVersion = t.body.labelling_notice?.roster_version;
	});

	afterAll(async () => { if (seedPool) await seedPool.end(); });

	test('T-C4: token for panel carries own-decision-only labelling_notice; candidate gets none; no IP/UA anywhere', async () => {
		const p = await getToken(roomId, panelTok());
		expect(p.status).toBe(200);
		expect(p.body.labelling_notice).toBeDefined();
		expect(p.body.labelling_notice.event_id).toBe(EV);
		expect(p.body.labelling_notice.notice_version).toBe('br7-1');
		expect(p.body.labelling_notice.roster_version).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
		expect(p.body.labelling_notice.own_decision).toBeNull();
		expect(p.body.labelling_notice.decision_scope).toBe('panel_leg_only');
		expect(JSON.stringify(p.body)).not.toMatch(/panel_expected_hash|ip_address|user_agent/);
		const c = await getToken(roomId, candTok());
		expect(c.status).toBe(200);
		expect(c.body.labelling_notice).toBeUndefined();
	});

	test('T-C1: capture keys row to caller; forged notice_version/timestamp ignored', async () => {
		const res = await capture(EV, panelTok(), {
			decision: 'granted', room_id: roomId, roster_version: rosterVersion,
			notice_version: 'forged-9', decided_at: '1970-01-01T00:00:00Z',
		});
		expect(res.status).toBe(200);
		expect(res.body.decision_scope).toBe('panel_leg_only');
		expect(res.body.own_decision).toBe('granted');
		expect(JSON.stringify(res.body)).not.toMatch(/ip_address|user_agent|panel_expected_hash/);
		const rows = await consentRows(EV, U_PANEL);
		expect(rows).toHaveLength(1);
		expect(rows[0].decision).toBe('granted');
		expect(rows[0].notice_version).toBe('br7-1');
		expect(new Date(rows[0].decided_at).getFullYear()).toBeGreaterThan(2020);
	});

	test('T-C2: candidate 403 no row; non-participant 404; nonexistent event 404 indistinguishable; foreign user_id rejected + audited', async () => {
		const cand = await capture(EV, candTok(), { decision: 'granted', room_id: roomId, roster_version: rosterVersion });
		expect(cand.status).toBe(403);
		expect(await consentRows(EV, U_CAND)).toHaveLength(0);

		const stranger = await capture(EV, tok(U_STRANGER, 'stranger1955@test.local', 'recruiter'),
			{ decision: 'granted', room_id: roomId, roster_version: rosterVersion });
		expect(stranger.status).toBe(404);
		const ghost = await capture(999999, panelTok(), { decision: 'granted', room_id: roomId, roster_version: rosterVersion });
		expect(ghost.status).toBe(404);
		expect(ghost.body).toEqual(stranger.body);

		const before = (await seedPool.query(
			`SELECT COUNT(*)::int n FROM compliance_audit_trail WHERE actor_id=$1 AND payload->>'outcome'='foreign_user_id_rejected'`, [U_PANEL])).rows[0].n;
		const foreign = await capture(EV, panelTok(), {
			decision: 'granted', room_id: roomId, roster_version: rosterVersion, user_id: U_REC,
		});
		expect(foreign.status).toBe(400);
		expect(await consentRows(EV, U_PANEL)).toHaveLength(1); // still only T-C1 row
		const after = (await seedPool.query(
			`SELECT COUNT(*)::int n FROM compliance_audit_trail WHERE actor_id=$1 AND payload->>'outcome'='foreign_user_id_rejected'`, [U_PANEL])).rows[0].n;
		expect(after).toBe(before + 1);
	});

	test('T-C3: re-decision inserts a NEW row; prior row byte-identical; token reads greatest-id row', async () => {
		const before = await consentRows(EV, U_PANEL);
		const res = await capture(EV, panelTok(), { decision: 'declined', room_id: roomId, roster_version: rosterVersion });
		expect(res.status).toBe(200);
		const rows = await consentRows(EV, U_PANEL);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual(before[0]);
		expect(rows[1].decision).toBe('declined');
		const t = await getToken(roomId, panelTok());
		expect(t.body.labelling_notice.own_decision).toBe('declined');
	});

	test('first-ever withdrawn is rejected (privacy condition)', async () => {
		const res = await capture(EV, recTok(), { decision: 'withdrawn', room_id: roomId, roster_version: rosterVersion });
		expect(res.status).toBe(400);
		expect(await consentRows(EV, U_REC)).toHaveLength(0);
	});

	test('T-C6: wrong room 404, other-event room 404, stale roster 409 ROSTER_CHANGED, audit + notification on success', async () => {
		const wrongRoom = await capture(EV, panelTok(), { decision: 'granted', room_id: overlapRoomId, roster_version: rosterVersion });
		expect(wrongRoom.status).toBe(404);
		const stale = await capture(EV, panelTok(), { decision: 'granted', room_id: roomId, roster_version: 'hmac-sha256:' + '0'.repeat(64) });
		expect(stale.status).toBe(409);
		expect(stale.body.code).toBe('ROSTER_CHANGED');
		expect(await consentRows(EV, U_PANEL)).toHaveLength(2);

		const ok = await capture(EV, recTok(), { decision: 'granted', room_id: roomId, roster_version: rosterVersion });
		expect(ok.status).toBe(200);
		const notif = await seedPool.query(
			`SELECT * FROM user_notifications WHERE user_id=$1 AND type='labelling_decision'`, [U_REC]);
		expect(notif.rows.length).toBeGreaterThanOrEqual(1);
		const audit = await seedPool.query(
			`SELECT * FROM compliance_audit_trail WHERE actor_id=$1 AND payload->>'outcome'='recorded'`, [U_REC]);
		expect(audit.rows.length).toBeGreaterThanOrEqual(1);
	});

	test('T-C5: candidate-in-panel overlap resolves as candidate (no notice, capture 403)', async () => {
		const t = await getToken(overlapRoomId, candTok());
		expect(t.status).toBe(200);
		expect(t.body.labelling_notice).toBeUndefined();
		const c = await capture(EV_OVERLAP, candTok(), { decision: 'granted', room_id: overlapRoomId, roster_version: rosterVersion });
		expect(c.status).toBe(403);
		expect(await consentRows(EV_OVERLAP, U_CAND)).toHaveLength(0);
	});

	test('T-C7 (#1961 item 1): lawful granted → withdrawn transition appends a row; token reads withdrawn', async () => {
		const before = await consentRows(EV, U_REC);
		expect(before.length).toBeGreaterThanOrEqual(1);
		expect(before[before.length - 1].decision).toBe('granted');
		const res = await capture(EV, recTok(), { decision: 'withdrawn', room_id: roomId, roster_version: rosterVersion });
		expect(res.status).toBe(200);
		expect(res.body.own_decision).toBe('withdrawn');
		const rows = await consentRows(EV, U_REC);
		expect(rows).toHaveLength(before.length + 1);
		expect(rows.slice(0, before.length)).toEqual(before);
		expect(rows[rows.length - 1].decision).toBe('withdrawn');
		const t = await getToken(roomId, recTok());
		expect(t.body.labelling_notice.own_decision).toBe('withdrawn');
	});

	test('T-C8 (#1961 item 1): per-(user,event) rate limit — uniform 429 past the cap; other user / other event unaffected', async () => {
		// Exact-threshold leg (review minor, #1961): on a FRESH (user,event)
		// bucket the cap is exactly 10 — the first 10 captures succeed and
		// the 11th and 12th are the uniform 429. (The EV leg below cannot
		// pin the exact number: earlier tests legitimately consumed part
		// of that bucket, so it asserts shape — 200s, then only 429s.)
		await seedPool.query(
			`INSERT INTO interview_events (id, recruiter_id, candidate_id, panel_member_ids, status)
			 VALUES ($1,$2,$3,$4,'confirmed')`,
			[EV_RL, U_REC, U_CAND, [U_PANEL]]);
		const rlRoom = await seedPool.query(
			`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id, status)
			 VALUES ($1,'room-1955-rl','RM_rl','active') RETURNING id`, [EV_RL]);
		const rlTok = await getToken(rlRoom.rows[0].id, panelTok());
		const rlRoster = rlTok.body.labelling_notice.roster_version;
		for (let i = 0; i < 10; i++) {
			const r = await capture(EV_RL, panelTok(), { decision: 'granted', room_id: rlRoom.rows[0].id, roster_version: rlRoster });
			expect(r.status).toBe(200);
		}
		for (let i = 0; i < 2; i++) {
			const r = await capture(EV_RL, panelTok(), { decision: 'granted', room_id: rlRoom.rows[0].id, roster_version: rlRoster });
			expect(r.status).toBe(429);
			expect(r.body).toEqual({ error: 'Too many requests', code: 'RATE_LIMITED' });
		}
		expect(await consentRows(EV_RL, U_PANEL)).toHaveLength(10);

		const statuses = [];
		for (let i = 0; i < 16; i++) {
			const r = await capture(EV, panelTok(), { decision: 'granted', room_id: roomId, roster_version: rosterVersion });
			statuses.push(r.status);
			if (r.status === 429) expect(r.body).toEqual({ error: 'Too many requests', code: 'RATE_LIMITED' });
			else expect(r.status).toBe(200);
		}
		expect(statuses).toContain(429);
		const first429 = statuses.indexOf(429);
		expect(statuses.slice(0, first429).every((s) => s === 200)).toBe(true);
		expect(statuses.slice(first429).every((s) => s === 429)).toBe(true);
		// Per-user isolation: the recruiter on the SAME event is still served
		// (re-grant after the T-C7 withdrawal).
		const rec = await capture(EV, recTok(), { decision: 'granted', room_id: roomId, roster_version: rosterVersion });
		expect(rec.status).toBe(200);
		// Per-event isolation: the SAME (rate-limited) panel user on a
		// DIFFERENT event is still served.
		const t = await getToken(overlapRoomId, panelTok());
		const ov = await capture(EV_OVERLAP, panelTok(), {
			decision: 'granted', room_id: overlapRoomId, roster_version: t.body.labelling_notice.roster_version,
		});
		expect(ov.status).toBe(200);
	});

	test('T-C9 (#1961 item 2): mid-transaction failure (notification insert) rolls back — zero consent rows, zero recorded-audit rows', async () => {
		await seedPool.query(`DELETE FROM event_labelling_consent WHERE interview_event_id=$1`, [EV_FAIL]).catch(() => {});
		await seedPool.query(`DELETE FROM interview_rooms WHERE interview_event_id=$1`, [EV_FAIL]);
		await seedPool.query(`DELETE FROM interview_events WHERE id=$1`, [EV_FAIL]);
		// Audit rows are append-only (never deleted, even by seed), so the
		// rollback claim is asserted as a DELTA: the failed capture must
		// add zero 'recorded' rows. On a fresh DB the baseline is 0, so
		// this is also the literal zero the issue asks for; the delta
		// form keeps the suite re-runnable on the same DB (review minor).
		const recordedCount = async () => (await seedPool.query(
			`SELECT COUNT(*)::int n FROM compliance_audit_trail
			 WHERE payload->>'kind'='panel_labelling_capture'
			   AND (payload->>'event_id')::int=$1 AND payload->>'outcome'='recorded'`, [EV_FAIL])).rows[0].n;
		const recordedBefore = await recordedCount();
		await seedPool.query(
			`INSERT INTO interview_events (id, recruiter_id, candidate_id, panel_member_ids, status)
			 VALUES ($1,$2,$3,$4,'confirmed')`,
			[EV_FAIL, U_REC, U_CAND, [U_PANEL]]);
		const rr = await seedPool.query(
			`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id, status)
			 VALUES ($1,'room-1955-fail','RM_fail','active') RETURNING id`, [EV_FAIL]);
		const failRoomId = rr.rows[0].id;
		const t = await getToken(failRoomId, panelTok());
		const rv = t.body.labelling_notice.roster_version;
		await seedPool.query(
			`CREATE OR REPLACE FUNCTION sd1961_fail_notif() RETURNS trigger AS $f$
			 BEGIN RAISE EXCEPTION 'injected failure (#1961 T-C9)'; END; $f$ LANGUAGE plpgsql`);
		try {
			await seedPool.query(
				`CREATE TRIGGER trg_sd1961_fail_notif BEFORE INSERT ON user_notifications
				 FOR EACH ROW WHEN (NEW.type = 'labelling_decision') EXECUTE FUNCTION sd1961_fail_notif()`);
			const res = await capture(EV_FAIL, panelTok(), { decision: 'granted', room_id: failRoomId, roster_version: rv });
			expect(res.status).toBe(500);
			expect(await consentRows(EV_FAIL, U_PANEL)).toHaveLength(0);
			expect(await recordedCount()).toBe(recordedBefore);
		} finally {
			await seedPool.query(`DROP TRIGGER IF EXISTS trg_sd1961_fail_notif ON user_notifications`);
			await seedPool.query(`DROP FUNCTION IF EXISTS sd1961_fail_notif()`);
		}
		// Security review (#1961): a subsequent capture for the SAME event
		// succeeds — both advisory locks (panel-event + audit-chain) were
		// released on rollback and the pooled client was not poisoned.
		const ok = await capture(EV_FAIL, panelTok(), { decision: 'granted', room_id: failRoomId, roster_version: rv });
		expect(ok.status).toBe(200);
		expect(await consentRows(EV_FAIL, U_PANEL)).toHaveLength(1);
		expect(await recordedCount()).toBe(recordedBefore + 1);
	});

	test('T-C10 (#1961 item 3): denied-path auditing is capped per user — a 404 flood cannot grow the audit trail unboundedly', async () => {
		const countFor = async () => (await seedPool.query(
			`SELECT COUNT(*)::int n FROM compliance_audit_trail
			 WHERE actor_id=$1 AND payload->>'kind'='panel_labelling_capture'`, [U_STRANGER])).rows[0].n;
		const before = await countFor();
		for (let i = 0; i < 30; i++) {
			const r = await capture(999998, tok(U_STRANGER, 'stranger1955@test.local', 'recruiter'),
				{ decision: 'granted', room_id: roomId, roster_version: rosterVersion });
			expect(r.status).toBe(404);
		}
		const delta = (await countFor()) - before;
		expect(delta).toBeGreaterThanOrEqual(1);
		expect(delta).toBeLessThanOrEqual(20);
		expect(delta).toBeLessThan(30);
	});

	test('T-C11 (#1961 items 4+5): concurrent audit appends keep ONE hash chain; panel rows are labelled interview_event', async () => {
		const panelLib = require('../../../lib/panelLabelling');
		await Promise.all(Array.from({ length: 8 }, () =>
			panelLib.writePanelAudit(seedPool, {
				eventId: EV, actorId: U_PANEL, actorRole: 'recruiter', outcome: 'concurrency_probe', decision: null,
			})));
		const panelRows = (await seedPool.query(
			`SELECT id, entity_type, entity_id, payload FROM compliance_audit_trail
			 WHERE payload->>'kind'='panel_labelling_capture' ORDER BY id`)).rows;
		expect(panelRows.length).toBeGreaterThanOrEqual(8);
		for (const r of panelRows) {
			expect(r.entity_type).toBe('interview_event');
			expect(Number(r.entity_id)).toBe(Number(r.payload.event_id));
		}
		// Chain integrity as a pointer walk (ids are UUIDs — row order
		// proves nothing): exactly one genesis row, every previous_hash
		// resolves, no previous_hash has two children (a fork), and the
		// walk from genesis visits every row exactly once.
		const all = (await seedPool.query(
			`SELECT previous_hash, current_hash FROM compliance_audit_trail`)).rows;
		expect(all.length).toBeGreaterThanOrEqual(8);
		const byPrev = new Map();
		for (const r of all) {
			expect(byPrev.has(r.previous_hash)).toBe(false);
			byPrev.set(r.previous_hash, r);
		}
		expect(byPrev.has('0')).toBe(true);
		let visited = 0;
		let cursor = byPrev.get('0');
		while (cursor) {
			visited++;
			cursor = byPrev.get(cursor.current_hash);
		}
		expect(visited).toBe(all.length);
	});

	test('freeze: createRecordingRecord freezes expected set + 64-hex hash on event recordings; session recordings stay NULL', async () => {
		const livekitService = require('../../services/livekit');
		const rec = await livekitService.createRecordingRecord({ interviewEventId: EV, roomId, egressId: 'EG_t' });
		expect(rec.panel_expected_user_ids).toEqual([U_REC, U_PANEL].sort((a, b) => a - b));
		expect(rec.panel_expected_hash).toMatch(/^[0-9a-f]{64}$/);
		const s = await seedPool.query(
			`INSERT INTO interview_sessions (candidate_id) VALUES ($1) RETURNING id`, [U_CAND]);
		const sess = await livekitService.createRecordingRecord({ interviewSessionId: s.rows[0].id, status: 'pending' });
		expect(sess.panel_expected_user_ids).toBeNull();
		expect(sess.panel_expected_hash).toBeNull();
	});
});
