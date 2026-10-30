/**
 * #1915 (S-D13) — Erasure integration for diarization artefacts (JT-D7).
 *
 * Quinn-style user-journey suite on the real rig (HL-003): a candidate
 * exercises erasure and EVERYTHING diarization created about their
 * interviews dies with the interviews — nothing labelled survives
 * anywhere (PRD FR-D18, Architecture §6.4, Lex BR-13).
 *
 * Real erasePersonalData() (lib/erasureService.js) inside a real
 * BEGIN…COMMIT transaction, real Postgres seeded directly, resulting
 * state read back from the DB, and the transcript READ path exercised
 * through the real recordings router over HTTP (supertest) before and
 * after erasure. Synthetic fixtures only; no real recordings.
 *
 * Scenarios:
 *  - Event-linked diarized recording (interview_events.candidate_id).
 *  - Session-linked diarized recording (GAP-A branch: migration 130's
 *    XOR CHECK gives it interview_event_id IS NULL, so the event join
 *    alone can never reach it).
 *  - A control diarized recording belonging to ANOTHER candidate —
 *    must survive untouched.
 *  - diarization_metrics_daily (counts-only, no recording/user
 *    linkage, AC-3) — must be byte-identical after erasure.
 *  - #1944 residuals: the keep-redacted tombstone's diarization
 *    columns are NULL after erasure, and the erasing user's ids are
 *    nulled inside ANOTHER candidate's recording (mapping
 *    participant/updated_by, audit from/to/actor) while those rows
 *    and the other candidate's own artefacts survive.
 *  - #2014 residuals II: the erasing user's id is swept (pair-atomic:
 *    array member removed AND hash nulled, same UPDATE) from OTHER
 *    subjects' panel_expected_user_ids — including an in-flight
 *    recording with no diarization run yet — while a control recording
 *    whose panel set does NOT name the erasing user stays
 *    byte-identical; surviving diarization_runs' proposed_mapping
 *    entries naming the erasing user become JSON null (keys
 *    preserved, other speakers untouched); panel_consent_snapshot
 *    copies stay byte-identical (S-D19 exception, never swept); and
 *    the subject's OWN keep-redacted tombstones lose their whole
 *    panel pair (panel_expected_user_ids + panel_expected_hash NULL).
 *  - #2014 residuals II: the frozen panel pair on OTHER subjects'
 *    recordings loses the erased id (array member removed, hash
 *    nulled — pair-atomic), proposed_mapping entries naming the
 *    erased user become JSON null on surviving runs, the subject's
 *    own tombstone pair is cleared, and panel_consent_snapshot
 *    copies (S-D19 exception) stay byte-identical.
 *
 * Run:
 *   SD13_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd13_e2e' \
 *     npx jest server/__tests__/lib/erasure-diarization-1915.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool, Client } = require('pg');

const DB_URL = process.env.SD13_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(60000);

const U_CAND = 191501;
const U_REC = 191502;
const U_OTHER = 191503;
const C_ID = 19151;
const METRICS_DATE = '2026-10-27';
// #2014: panel freeze hashes are plain SHA-256 hex (mig 299) —
// synthetic distinct values per fixture so a cross-row mix-up fails.
const HASH_OWN = 'a'.repeat(64);
const HASH_CROSS = 'b'.repeat(64);
const HASH_INFLIGHT = 'c'.repeat(64);
const HASH_CONTROL = 'd'.repeat(64);

let app;
let request;
let generateToken;
let erasePersonalData;
let seedPool;

const R = {};

const recToken = () =>
	generateToken({ id: U_REC, email: 'rec1915@test.local', role: 'recruiter' });

async function seedDiarizedRecording({ eventId = null, sessionId = null }) {
	const q = (sql, params) => seedPool.query(sql, params);
	const rec = await q(
		`INSERT INTO interview_recordings
		   (interview_event_id, interview_session_id, status, duration_seconds, storage_path, diarization_status, diarization_updated_at, retention_expires_at)
		 VALUES ($1, $2, 'completed', 3600, NULL, 'complete', NOW(), NOW() + INTERVAL '90 days') RETURNING id`,
		[eventId, sessionId],
	);
	const recordingId = rec.rows[0].id;
	for (const [speaker, text, start, end] of [
		[0, 'Synthetic question one.', 0, 4000],
		[1, 'Synthetic answer one.', 4000, 9000],
	]) {
		await q(
			`INSERT INTO interview_transcripts (recording_id, speaker_identity, text, start_time_ms, end_time_ms, speaker_number)
			 VALUES ($1, 'unknown', $2, $3, $4, $5)`,
			[recordingId, text, start, end, speaker],
		);
	}
	const job = await q(
		`INSERT INTO diarization_jobs (recording_id, status) VALUES ($1, 'complete') RETURNING id`,
		[recordingId],
	);
	await q(
		`INSERT INTO diarization_runs (recording_id, job_id, engine_package, sdk_version, model_version, speaker_count, turns, coverage_end_ms)
		 VALUES ($1, $2, '@desert-ant-labs/who', '4.2.1', 'v0.3.4', 2,
		   '[{"speaker":0,"start_s":0,"end_s":4},{"speaker":1,"start_s":4,"end_s":9}]'::jsonb, 9000)`,
		[recordingId, job.rows[0].id],
	);
	await q(
		`INSERT INTO recording_speaker_mappings (recording_id, speaker_number, participant_user_id, participant_role, state)
		 VALUES ($1, 0, $2, 'interviewer', 'corrected'), ($1, 1, $3, 'candidate', 'corrected')`,
		[recordingId, U_REC, eventId ? U_CAND : U_OTHER],
	);
	await q(
		`INSERT INTO transcript_speaker_audit (recording_id, speaker_number, from_user_id, to_user_id, actor_user_id, action)
		 VALUES ($1, 0, $2, $3, $2, 'correct')`,
		[recordingId, U_REC, U_CAND],
	);
	return recordingId;
}

async function countArtefacts(recordingId) {
	const counts = {};
	for (const table of [
		'diarization_jobs',
		'diarization_runs',
		'recording_speaker_mappings',
		'transcript_speaker_audit',
		'interview_transcripts',
	]) {
		const { rows } = await seedPool.query(
			`SELECT COUNT(*)::int AS n FROM ${table} WHERE recording_id = $1`,
			[recordingId],
		);
		counts[table] = rows[0].n;
	}
	return counts;
}

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	const userIds = [U_CAND, U_REC, U_OTHER];
	// Wipe any prior run's fixtures (idempotent re-runs on the same DB).
	const eventScope = `SELECT id FROM interview_events WHERE recruiter_id = $1 OR candidate_id = ANY($2::int[])`;
	const recScope = `SELECT id FROM interview_recordings WHERE interview_event_id IN (${eventScope})
		OR interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = ANY($2::int[]))`;
	for (const table of [
		'interview_transcripts',
		'recording_speaker_mappings',
		'transcript_speaker_audit',
		'diarization_runs',
		'diarization_jobs',
	]) {
		await q(`DELETE FROM ${table} WHERE recording_id IN (${recScope})`, [U_REC, userIds]);
	}
	await q(`DELETE FROM interview_recordings WHERE id IN (${recScope})`, [U_REC, userIds]);
	await q(
		`DELETE FROM interview_sessions WHERE candidate_id = ANY($1::int[])`,
		[userIds],
	);
	await q(`DELETE FROM interview_events WHERE recruiter_id = $1 OR candidate_id = ANY($2::int[])`, [
		U_REC,
		userIds,
	]);
	await q(`DELETE FROM diarization_metrics_daily WHERE date = $1`, [METRICS_DATE]);
	await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);
	await q(`DELETE FROM companies WHERE id = $1`, [C_ID]);

	await q(`INSERT INTO companies (id, name) VALUES ($1, 'S-D13 Co')`, [C_ID]);
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES
		   ($1, 'cand1915@test.local', 'Cand 1915', 'candidate', NULL),
		   ($2, 'rec1915@test.local', 'Rec 1915', 'recruiter', $4),
		   ($3, 'other1915@test.local', 'Other 1915', 'candidate', NULL)`,
		[U_CAND, U_REC, U_OTHER, C_ID],
	);

	// Event-linked diarized recording for the erasing candidate.
	const ev = await q(
		`INSERT INTO interview_events (recruiter_id, candidate_id, duration_minutes, timezone, status)
		 VALUES ($1, $2, 60, 'UTC', 'completed') RETURNING id`,
		[U_REC, U_CAND],
	);
	R.eventLinked = await seedDiarizedRecording({ eventId: ev.rows[0].id });

	// Session-linked diarized recording for the erasing candidate
	// (GAP-A branch: interview_event_id IS NULL by the XOR CHECK).
	const sess = await q(
		`INSERT INTO interview_sessions (type, candidate_id, company_id) VALUES ('human', $1, $2) RETURNING id`,
		[U_CAND, C_ID],
	);
	R.sessionLinked = await seedDiarizedRecording({ sessionId: sess.rows[0].id });

	// Control: another candidate's diarized recording — must survive.
	const evOther = await q(
		`INSERT INTO interview_events (recruiter_id, candidate_id, duration_minutes, timezone, status)
		 VALUES ($1, $2, 60, 'UTC', 'completed') RETURNING id`,
		[U_REC, U_OTHER],
	);
	R.control = await seedDiarizedRecording({ eventId: evOther.rows[0].id });

	// #1944 cross-recording fixture: ANOTHER candidate's recording on
	// which the ERASING user appears as a mapping participant /
	// updated_by and as audit from/to/actor. Erasure must null only
	// the erasing user's ids there — rows, roles, actions and the
	// other candidate's own artefacts survive.
	const evCross = await q(
		`INSERT INTO interview_events (recruiter_id, candidate_id, duration_minutes, timezone, status)
		 VALUES ($1, $2, 60, 'UTC', 'completed') RETURNING id`,
		[U_REC, U_OTHER],
	);
	R.cross = await seedDiarizedRecording({ eventId: evCross.rows[0].id });
	// Seeded cross state: mapping sp0 participant=U_REC (updated_by set
	// to the erasing user below — updated_by-only case); mapping sp1
	// participant=U_CAND (participant + updated_by case); audit row
	// from=U_REC, to=U_CAND, actor=U_REC (to-only case).
	await q(
		`UPDATE recording_speaker_mappings SET updated_by = $2 WHERE recording_id = $1 AND speaker_number IN (0, 1)`,
		[R.cross, U_CAND],
	);
	// The other candidate's OWN mapping — must stay fully untouched.
	await q(
		`INSERT INTO recording_speaker_mappings (recording_id, speaker_number, participant_user_id, participant_role, state, updated_by)
		 VALUES ($1, 2, $2, 'candidate', 'corrected', $2)`,
		[R.cross, U_OTHER],
	);
	// Second audit row: from + actor are the erasing user.
	await q(
		`INSERT INTO transcript_speaker_audit (recording_id, speaker_number, from_user_id, to_user_id, actor_user_id, action)
		 VALUES ($1, 1, $2, $3, $2, 'correct')`,
		[R.cross, U_CAND, U_OTHER],
	);

	// #2014 fixture — panel freeze pairs (mig 299) + proposed_mapping:
	// (a) the SUBJECT'S OWN recordings carry a frozen panel pair; the
	// event-linked one's array even names the subject (synthetic —
	// construction excludes the candidate, but STOP 1's exclusion must
	// hold regardless: item 1 must not count/sweep own recordings;
	// item 3 nulls the whole pair on the tombstone).
	await q(
		`UPDATE interview_recordings SET panel_expected_user_ids = ARRAY[$2, $3]::int[], panel_expected_hash = $4 WHERE id = $1`,
		[R.eventLinked, U_CAND, U_REC, HASH_OWN],
	);
	await q(
		`UPDATE interview_recordings SET panel_expected_user_ids = ARRAY[$2, $3]::int[], panel_expected_hash = $4 WHERE id = $1`,
		[R.sessionLinked, U_REC, U_OTHER, HASH_OWN],
	);
	// (b) the CROSS recording carries the erasing user as a panellist,
	// and its surviving run's proposed_mapping names the erasing user
	// (speaker "1") beside a control speaker entry (speaker "0", another
	// user) and an already-unassigned entry (speaker "2"). Its job/run
	// panel_consent_snapshot copies also name the erasing user inside
	// a proposed_mapping copy — S-D19: those copies are NEVER swept.
	const crossSnapshot = JSON.stringify({
		notice_version: 'v1',
		proposed_mapping: {
			0: { participant_user_id: U_REC, participant_role: 'interviewer' },
			1: { participant_user_id: U_CAND, participant_role: 'candidate' },
		},
		decisions: [{ user_id: U_CAND, decision: 'granted' }],
	});
	await q(
		`UPDATE interview_recordings SET panel_expected_user_ids = ARRAY[$2, $3]::int[], panel_expected_hash = $4 WHERE id = $1`,
		[R.cross, U_REC, U_CAND, HASH_CROSS],
	);
	await q(
		`UPDATE diarization_runs SET proposed_mapping = $2::jsonb, panel_consent_snapshot = $3::jsonb WHERE recording_id = $1`,
		[
			R.cross,
			JSON.stringify({
				0: { participant_user_id: U_REC, participant_role: 'interviewer' },
				1: { participant_user_id: U_CAND, participant_role: 'candidate' },
				2: null,
			}),
			crossSnapshot,
		],
	);
	await q(
		`UPDATE diarization_jobs SET panel_consent_snapshot = $2::jsonb WHERE recording_id = $1`,
		[R.cross, crossSnapshot],
	);
	// (c) CONTROL recording's panel set does NOT name the erasing
	// user — the pair must stay byte-identical (non-matching rows are
	// never rewritten).
	await q(
		`UPDATE interview_recordings SET panel_expected_user_ids = ARRAY[$2, $3]::int[], panel_expected_hash = $4 WHERE id = $1`,
		[R.control, U_REC, U_OTHER, HASH_CONTROL],
	);
	// (d) IN-FLIGHT recording: another candidate's recording carrying
	// the erasing user as panellist, with NO diarization job/run yet —
	// the panel sweep must still reach it.
	const evInflight = await q(
		`INSERT INTO interview_events (recruiter_id, candidate_id, duration_minutes, timezone, status)
		 VALUES ($1, $2, 60, 'UTC', 'completed') RETURNING id`,
		[U_REC, U_OTHER],
	);
	const inflight = await q(
		`INSERT INTO interview_recordings
		   (interview_event_id, status, duration_seconds, storage_path, retention_expires_at, panel_expected_user_ids, panel_expected_hash)
		 VALUES ($1, 'completed', 1800, NULL, NOW() + INTERVAL '90 days', ARRAY[$2, $3]::int[], $4) RETURNING id`,
		[evInflight.rows[0].id, U_CAND, U_REC, HASH_INFLIGHT],
	);
	R.inflight = inflight.rows[0].id;

	// Counts-only aggregate (AC-3): no recording/user linkage exists in
	// this table; erasure must leave it byte-identical.
	await q(
		`INSERT INTO diarization_metrics_daily (date, labelled_count, corrected_count) VALUES ($1, 3, 1)`,
		[METRICS_DATE],
	);
}

async function getTranscript(recordingId) {
	return request(app)
		.get(`/api/interviews/recordings/${recordingId}/transcript`)
		.set('Authorization', `Bearer ${recToken()}`);
}

describeIfDb('#1915 S-D13 diarization erasure (JT-D7, realdb journey)', () => {
	beforeAll(async () => {
		// Env BEFORE lib/db's pool and the router load — the 1911 pattern.
		process.env.DATABASE_URL = DB_URL;
		process.env.ENCRYPTION_KEY = 'a'.repeat(64);
		process.env.BIOMETRIC_ENCRYPTION_KEY = 'b'.repeat(64);
		process.env.AI_KEYS_JSON = JSON.stringify({ openai: 'test-key' });

		seedPool = new Pool({ connectionString: DB_URL });
		await cleanAndSeed();

		({ erasePersonalData } = require('../../../lib/erasureService'));

		const express = require('express');
		request = require('supertest');
		({ generateToken } = require('../../../lib/auth'));
		const recordingsRouter = require('../../routes/recordings');
		app = express();
		app.use(express.json());
		app.use('/api/interviews/recordings', recordingsRouter);
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('JT-D7 journey: erasure removes every diarization artefact for BOTH recording branches; metrics + control untouched; reads return absence', async () => {
		// Seed sanity: both target recordings are fully diarized, and the
		// label read composes names before erasure (the user's starting
		// state — labels exist and are reachable).
		for (const id of [R.eventLinked, R.sessionLinked, R.control]) {
			expect(await countArtefacts(id)).toEqual({
				diarization_jobs: 1,
				diarization_runs: 1,
				recording_speaker_mappings: 2,
				transcript_speaker_audit: 1,
				interview_transcripts: 2,
			});
		}
		const before = await getTranscript(R.eventLinked);
		expect(before.status).toBe(200);
		expect(before.body.transcript.diarization.status).toBe('complete');
		expect(JSON.stringify(before.body)).toContain('Cand 1915');

		const metricsBefore = await seedPool.query(
			`SELECT date, labelled_count, corrected_count FROM diarization_metrics_daily WHERE date = $1`,
			[METRICS_DATE],
		);
		expect(metricsBefore.rows).toHaveLength(1);

		// #1944 seed sanity: tombstones-to-be carry non-NULL diarization
		// state (so the post-erasure NULL assertions can actually fail),
		// and the cross-recording fixture carries the erasing user's ids.
		for (const id of [R.eventLinked, R.sessionLinked]) {
			const { rows } = await seedPool.query(
				`SELECT diarization_status, diarization_updated_at FROM interview_recordings WHERE id = $1`,
				[id],
			);
			expect(rows[0].diarization_status).toBe('complete');
			expect(rows[0].diarization_updated_at).not.toBeNull();
		}
		const crossMapsBefore = await seedPool.query(
			`SELECT speaker_number, participant_user_id, updated_by FROM recording_speaker_mappings WHERE recording_id = $1 ORDER BY speaker_number`,
			[R.cross],
		);
		expect(crossMapsBefore.rows).toHaveLength(3);
		expect(crossMapsBefore.rows[1].participant_user_id).toBe(U_CAND);
		expect(crossMapsBefore.rows[0].updated_by).toBe(U_CAND);

		// #2014 seed sanity: every new fixture actually carries the
		// state the post-erasure assertions check (so they can fail).
		const panelBefore = {};
		for (const [key, id] of [
			['eventLinked', R.eventLinked],
			['sessionLinked', R.sessionLinked],
			['cross', R.cross],
			['control', R.control],
			['inflight', R.inflight],
		]) {
			const { rows } = await seedPool.query(
				`SELECT panel_expected_user_ids, panel_expected_hash FROM interview_recordings WHERE id = $1`,
				[id],
			);
			panelBefore[key] = rows[0];
			expect(rows[0].panel_expected_hash).not.toBeNull();
		}
		expect(panelBefore.eventLinked.panel_expected_user_ids).toEqual([U_CAND, U_REC]);
		expect(panelBefore.cross.panel_expected_user_ids).toEqual([U_REC, U_CAND]);
		expect(panelBefore.inflight.panel_expected_user_ids).toEqual([U_CAND, U_REC]);
		expect(panelBefore.control.panel_expected_user_ids).toEqual([U_REC, U_OTHER]);
		const crossRunBefore = await seedPool.query(
			`SELECT proposed_mapping, panel_consent_snapshot::text AS snap FROM diarization_runs WHERE recording_id = $1`,
			[R.cross],
		);
		expect(crossRunBefore.rows[0].proposed_mapping['1'].participant_user_id).toBe(U_CAND);
		const crossJobSnapBefore = await seedPool.query(
			`SELECT panel_consent_snapshot::text AS snap FROM diarization_jobs WHERE recording_id = $1`,
			[R.cross],
		);
		expect(crossJobSnapBefore.rows[0].snap).toContain(String(U_CAND));

		// The user journey's act: the candidate's erasure runs, in the
		// production caller shape (one BEGIN…COMMIT transaction client).
		const client = new Client({ connectionString: DB_URL });
		await client.connect();
		let result;
		try {
			await client.query('BEGIN');
			result = await erasePersonalData(U_CAND, { client });
			await client.query('COMMIT');
		} catch (err) {
			await client.query('ROLLBACK').catch(() => {});
			throw err;
		} finally {
			await client.end();
		}

		// AC-1: the audit return discloses the diarization counts.
		expect(result.diarizationJobsDeleted).toBe(2);
		expect(result.diarizationRunsDeleted).toBe(2);
		expect(result.speakerMappingsDeleted).toBe(4);
		expect(result.speakerAuditDeleted).toBe(2);
		expect(result.transcriptsDeleted).toBe(4);

		// AC-1 + AC-2 sweep: zero diarization artefacts remain for either
		// of the candidate's recordings — event-linked AND session-linked.
		for (const id of [R.eventLinked, R.sessionLinked]) {
			expect(await countArtefacts(id)).toEqual({
				diarization_jobs: 0,
				diarization_runs: 0,
				recording_speaker_mappings: 0,
				transcript_speaker_audit: 0,
				interview_transcripts: 0,
			});
		}

		// #1944 F-1: the keep-redacted tombstone rows survive, but their
		// diarization signal must be NULL — as if the feature never ran.
		for (const id of [R.eventLinked, R.sessionLinked]) {
			const { rows } = await seedPool.query(
				`SELECT status, diarization_status, diarization_updated_at FROM interview_recordings WHERE id = $1`,
				[id],
			);
			expect(rows).toHaveLength(1);
			expect(rows[0].status).toBe('deleted');
			expect(rows[0].diarization_status).toBeNull();
			expect(rows[0].diarization_updated_at).toBeNull();
		}

		// #1944 F-2: swept counts disclosed on the result surface.
		// Mappings: participant sweep hits control sp1 + cross sp1 (2);
		// updated_by sweep hits cross sp0 + cross sp1 (2) — 4 field nulls.
		// Audit: control row (to), cross seeded row (to), cross row 2
		// (from/actor) — 3 rows touched.
		expect(result.crossRecordingMappingsNulled).toBe(4);
		expect(result.crossRecordingAuditNulled).toBe(3);

		// #2014: swept counts disclosed on the result surface — panel
		// pair swept on cross + in-flight (2, own recordings excluded
		// by the item-1 predicate), one surviving run's
		// proposed_mapping nulled, two own tombstone pairs cleared.
		expect(result.crossRecordingPanelPairsSwept).toBe(2);
		expect(result.crossRecordingProposedMappingsNulled).toBe(1);
		expect(result.tombstonePanelPairsCleared).toBe(2);

		// #2014 item 1: pair-atomic sweep on OTHER subjects'
		// recordings — array member gone AND hash NULL, together.
		for (const [id, expectedArray] of [
			[R.cross, [U_REC]],
			[R.inflight, [U_REC]],
		]) {
			const { rows } = await seedPool.query(
				`SELECT panel_expected_user_ids, panel_expected_hash FROM interview_recordings WHERE id = $1`,
				[id],
			);
			expect(rows[0].panel_expected_user_ids).toEqual(expectedArray);
			expect(rows[0].panel_expected_hash).toBeNull();
		}
		// #2014 item 1: the control recording's pair does not name the
		// erasing user — byte-identical, never rewritten.
		{
			const { rows } = await seedPool.query(
				`SELECT panel_expected_user_ids, panel_expected_hash FROM interview_recordings WHERE id = $1`,
				[R.control],
			);
			expect(rows[0].panel_expected_user_ids).toEqual([U_REC, U_OTHER]);
			expect(rows[0].panel_expected_hash).toBe(HASH_CONTROL);
		}
		// #2014 item 3: the subject's OWN tombstones lose the whole
		// panel pair — no roster of living third parties survives.
		for (const id of [R.eventLinked, R.sessionLinked]) {
			const { rows } = await seedPool.query(
				`SELECT panel_expected_user_ids, panel_expected_hash FROM interview_recordings WHERE id = $1`,
				[id],
			);
			expect(rows[0].panel_expected_user_ids).toBeNull();
			expect(rows[0].panel_expected_hash).toBeNull();
		}
		// #2014 item 2: the surviving cross run's proposed_mapping —
		// the erased user's entry is JSON null, the key is preserved,
		// the control speaker entry and the already-null entry are
		// untouched.
		{
			const { rows } = await seedPool.query(
				`SELECT proposed_mapping, panel_consent_snapshot::text AS snap FROM diarization_runs WHERE recording_id = $1`,
				[R.cross],
			);
			const mapping = rows[0].proposed_mapping;
			expect(Object.keys(mapping).sort()).toEqual(['0', '1', '2']);
			expect(mapping['0']).toEqual({
				participant_user_id: U_REC,
				participant_role: 'interviewer',
			});
			expect(mapping['1']).toBeNull();
			expect(mapping['2']).toBeNull();
			// PIN (S-D19): the snapshot copy on the run is
			// byte-identical — proposed_mapping copies inside
			// panel_consent_snapshot are NEVER swept.
			expect(rows[0].snap).toBe(crossRunBefore.rows[0].snap);
			expect(rows[0].snap).toContain(String(U_CAND));
		}
		{
			const { rows } = await seedPool.query(
				`SELECT panel_consent_snapshot::text AS snap FROM diarization_jobs WHERE recording_id = $1`,
				[R.cross],
			);
			expect(rows[0].snap).toBe(crossJobSnapBefore.rows[0].snap);
		}

		// #1944 F-2 cross-recording: rows survive with role/action/
		// timestamps; only the erasing user's ids are nulled; the other
		// candidate's own mapping and artefacts are untouched.
		const crossMaps = await seedPool.query(
			`SELECT speaker_number, participant_user_id, participant_role, updated_by, created_at FROM recording_speaker_mappings WHERE recording_id = $1 ORDER BY speaker_number`,
			[R.cross],
		);
		expect(crossMaps.rows).toHaveLength(3);
		expect(crossMaps.rows[0].participant_user_id).toBe(U_REC);
		expect(crossMaps.rows[0].updated_by).toBeNull();
		expect(crossMaps.rows[0].participant_role).toBe('interviewer');
		expect(crossMaps.rows[1].participant_user_id).toBeNull();
		expect(crossMaps.rows[1].updated_by).toBeNull();
		expect(crossMaps.rows[1].participant_role).toBe('candidate');
		expect(crossMaps.rows[2].participant_user_id).toBe(U_OTHER);
		expect(crossMaps.rows[2].updated_by).toBe(U_OTHER);
		expect(crossMaps.rows[2].participant_role).toBe('candidate');
		for (const row of crossMaps.rows) expect(row.created_at).not.toBeNull();

		const crossAudit = await seedPool.query(
			`SELECT speaker_number, from_user_id, to_user_id, actor_user_id, action, created_at FROM transcript_speaker_audit WHERE recording_id = $1 ORDER BY speaker_number`,
			[R.cross],
		);
		expect(crossAudit.rows).toHaveLength(2);
		expect(crossAudit.rows[0].from_user_id).toBe(U_REC);
		expect(crossAudit.rows[0].to_user_id).toBeNull();
		expect(crossAudit.rows[0].actor_user_id).toBe(U_REC);
		expect(crossAudit.rows[0].action).toBe('correct');
		expect(crossAudit.rows[1].from_user_id).toBeNull();
		expect(crossAudit.rows[1].to_user_id).toBe(U_OTHER);
		expect(crossAudit.rows[1].actor_user_id).toBeNull();
		expect(crossAudit.rows[1].action).toBe('correct');
		for (const row of crossAudit.rows) expect(row.created_at).not.toBeNull();

		// The cross recording's own artefacts are untouched.
		expect(await countArtefacts(R.cross)).toEqual({
			diarization_jobs: 1,
			diarization_runs: 1,
			recording_speaker_mappings: 3,
			transcript_speaker_audit: 2,
			interview_transcripts: 2,
		});

		// Control: the other candidate's artefacts are fully intact.
		expect(await countArtefacts(R.control)).toEqual({
			diarization_jobs: 1,
			diarization_runs: 1,
			recording_speaker_mappings: 2,
			transcript_speaker_audit: 1,
			interview_transcripts: 2,
		});

		// AC-3: the counts-only daily aggregate is untouched.
		const metricsAfter = await seedPool.query(
			`SELECT date, labelled_count, corrected_count FROM diarization_metrics_daily WHERE date = $1`,
			[METRICS_DATE],
		);
		expect(metricsAfter.rows).toEqual(metricsBefore.rows);

		// AC-2 read-back: the transcript/label read for an erased
		// recording returns absence consistent with [purged] behaviour —
		// no segments, no label data (empty speakers / null mapping
		// state if the status block is emitted), no names anywhere.
		const after = await getTranscript(R.eventLinked);
		expect([200, 403, 404]).toContain(after.status);
		if (after.status === 200) {
			expect(after.body.transcript.segment_count).toBe(0);
			expect(after.body.transcript.segments).toEqual([]);
			// Label absence: the S-D09 composition may still emit the
			// status block for a post-feature recording, but it must
			// carry NO label data — no speakers, no mapping state, no
			// corrector (the underlying rows no longer exist).
			const d = after.body.transcript.diarization;
			if (d) {
				expect(d.speakers).toEqual([]);
				expect(d.mapping_state).toBeNull();
				expect(d.corrected_by).toBeNull();
			}
		}
		expect(JSON.stringify(after.body)).not.toContain('Cand 1915');
		expect(JSON.stringify(after.body)).not.toContain('Speaker');
	});
});
