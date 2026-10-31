/**
 * #2028 item 4 — HL-003 fresh-install journey for the biometric
 * section of POST /gdpr/export (STOP 1 on #2028, comment 6540273741).
 *
 * NO doubles on the path under test: a fresh throwaway Postgres built
 * ONLY by `node migrate.js`, the REAL compliance router (real lib/db,
 * real auth, real AuditLogger), and the REAL crypto helpers — the
 * speech-measurement envelope is created with the writer's own path
 * (biometricCrypto.encryptWithDEK + r2FrameStore.packEnvelope +
 * r2ObserverAudioStore.measurementAAD, exactly as lib/observerCapture.js
 * writes it) and must come back decrypted over real HTTP.
 *
 * User journey (candidate, Quinn framing): "I ask for a copy of my
 * data" → the export contains my speech measurement VALUES (not the
 * encrypted blob), my recording metadata and speaker labels, the
 * speaker mapping for me — and the OTHER participant is present only
 * as a role, never their user ID; the encrypted envelope and the
 * recording's storage reference appear nowhere.
 *
 * Rig (this run): PostgreSQL 18.6 (postgres-linux-x86_64 build) at
 * 127.0.0.1:55439 with pgvector 0.8.7 extension files from the PGDG
 * .deb; DB `gdpr2028` created empty and built only by migrate.js
 * (exit 0). Supertest against the real app assembly for this router —
 * the full server.js boot is not used (it starts workers/listeners
 * unrelated to this route); the router, auth and DB are all real.
 *
 * Example:
 *   EXPORT2028_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55439/gdpr2028' \
 *   BIOMETRIC_ENCRYPTION_KEY=<64 hex> \
 *     npx jest server/__tests__/routes/compliance-gdpr-export-biometric-realdb-2028.test.js --runInBand --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.EXPORT2028_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_SUBJ = 202801;
const U_REC = 202802;
const U_OTHER = 202803;

const MEASUREMENTS = {
	pitch_mean_hz: 182.5,
	speech_rate_wpm: 141,
	filler_word_rate: 2.4,
	pause_ratio: 0.12,
};

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

describeIfDb('#2028 item 4 POST /gdpr/export biometric — real DB (user journey)', () => {
	let request;
	let app;
	let generateToken;
	let ids;

	async function cleanAndSeed() {
		const q = (sql, params) => seedPool.query(sql, params);
		// FK-safe teardown for re-runs (children first).
		await q('DELETE FROM transcript_speaker_audit WHERE recording_id IN (SELECT id FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1))', [U_SUBJ]);
		await q('DELETE FROM recording_speaker_mappings WHERE recording_id IN (SELECT id FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1))', [U_SUBJ]);
		await q('DELETE FROM interview_transcripts WHERE recording_id IN (SELECT id FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1))', [U_SUBJ]);
		await q('DELETE FROM event_labelling_consent WHERE user_id = $1', [U_SUBJ]);
		await q('DELETE FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1)', [U_SUBJ]);
		await q('DELETE FROM interview_rooms WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1)', [U_SUBJ]);
		await q('DELETE FROM observer_speech_measurements WHERE candidate_id = $1', [U_SUBJ]);
		await q('DELETE FROM interview_events WHERE candidate_id = $1', [U_SUBJ]);
		await q('DELETE FROM interview_sessions WHERE candidate_id = $1', [U_SUBJ]);
		await q('DELETE FROM data_requests WHERE user_id = $1', [U_SUBJ]);
		await q('DELETE FROM audit_logs WHERE user_id = $1', [U_SUBJ]);
		await q('DELETE FROM candidate_data_keys WHERE candidate_id = $1', [U_SUBJ]);
		await q('DELETE FROM users WHERE id = ANY($1::int[])', [[U_SUBJ, U_REC, U_OTHER]]);

		await q(
			`INSERT INTO users (id, email, name, role, company_id) VALUES
			   ($1, 'subj2028@test.local', 'Subject 2028', 'candidate', NULL),
			   ($2, 'rec2028@test.local', 'Recruiter 2028', 'recruiter', NULL),
			   ($3, 'other2028@test.local', 'Other 2028', 'recruiter', NULL)`,
			[U_SUBJ, U_REC, U_OTHER],
		);
		const session = await q(
			`INSERT INTO interview_sessions (candidate_id, type, status) VALUES ($1, 'screening', 'completed') RETURNING id`,
			[U_SUBJ],
		);
		const event = await q(
			`INSERT INTO interview_events (recruiter_id, candidate_id, status) VALUES ($1, $2, 'completed') RETURNING id`,
			[U_REC, U_SUBJ],
		);
		const room = await q(
			`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id) VALUES ($1, 'room-2028', 'lk-2028') RETURNING id`,
			[event.rows[0].id],
		);
		const recording = await q(
			`INSERT INTO interview_recordings
			   (interview_event_id, room_id, status, started_at, stopped_at, duration_seconds,
			    storage_path, encryption_key_id, file_size_bytes, file_format, diarization_status, diarization_updated_at)
			 VALUES ($1, $2, 'completed', NOW() - interval '1 hour', NOW() - interval '30 minutes', 1800,
			    '\\xdeadbeef'::bytea, 'SECRET-KEY-ID-2028', 123456, 'mp4', 'complete', NOW())
			 RETURNING id`,
			[event.rows[0].id, room.rows[0].id],
		);
		const recId = recording.rows[0].id;
		await q(
			`INSERT INTO interview_transcripts (recording_id, speaker_identity, speaker_number, text, start_time_ms, end_time_ms, confidence)
			 VALUES ($1, 'Speaker 1', 1, 'Hello, tell me about yourself.', 0, 4000, 0.98)`,
			[recId],
		);
		await q(
			`INSERT INTO recording_speaker_mappings (recording_id, speaker_number, participant_user_id, participant_role, state, updated_by) VALUES
			   ($1, 1, $2, 'candidate', 'confirmed', $2),
			   ($1, 2, $3, 'interviewer', 'confirmed', $3)`,
			[recId, U_SUBJ, U_OTHER],
		);
		await q(
			`INSERT INTO transcript_speaker_audit (recording_id, speaker_number, from_user_id, to_user_id, actor_user_id, action) VALUES
			   ($1, 2, $3, $2, $3, 'correct'),
			   ($1, 1, $3, $3, $3, 'confirm')`,
			[recId, U_SUBJ, U_OTHER],
		);
		await q(
			`INSERT INTO event_labelling_consent (interview_event_id, user_id, decision, notice_version)
			 VALUES ($1, $2, 'granted', 'v1')`,
			[event.rows[0].id, U_SUBJ],
		);

		// The speech measurement, written through the REAL writer path.
		const biometricCrypto = require('../../../lib/biometricCrypto');
		const { packEnvelope } = require('../../../lib/r2FrameStore');
		const { measurementAAD } = require('../../../lib/r2ObserverAudioStore');
		const { ciphertext, iv, tag } = await biometricCrypto.encryptWithDEK(
			Buffer.from(JSON.stringify(MEASUREMENTS), 'utf8'),
			U_SUBJ,
			measurementAAD(U_SUBJ, session.rows[0].id),
		);
		const envelope = packEnvelope({ iv, tag, ciphertext });
		await q(
			`INSERT INTO observer_speech_measurements (interview_session_id, candidate_id, measurements_envelope, method_version, state, is_test)
			 VALUES ($1, $2, $3, 1, 'recorded', false)`,
			[session.rows[0].id, U_SUBJ, envelope],
		);
		return { sessionId: session.rows[0].id, eventId: event.rows[0].id, recordingId: recId, envelope };
	}

	beforeAll(async () => {
		// server/test/setup.js replaces DATABASE_URL with a dummy;
		// restore the real one before lib/db (and the router) load.
		process.env.DATABASE_URL = DB_URL;
		ids = await cleanAndSeed();
		const express = require('express');
		request = require('supertest');
		({ generateToken } = require('../../../lib/auth'));
		const complianceRoutes = require('../../../routes/compliance');
		app = express();
		app.use(express.json());
		app.use('/api/compliance', complianceRoutes);
	}, 60000);

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('export over HTTP: decrypted values read back, other participant ID absent, envelope absent', async () => {
		const token = generateToken({ id: U_SUBJ, email: 'subj2028@test.local', role: 'candidate' });
		const res = await request(app)
			.post('/api/compliance/gdpr/export')
			.set('Authorization', `Bearer ${token}`)
			.send({ userId: U_SUBJ });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		const bio = res.body.data.biometric;
		expect(bio).toBeDefined();

		// Decrypted measurement values read back exactly as written.
		expect(bio.speech_measurements).toHaveLength(1);
		expect(bio.speech_measurements[0].measurements).toEqual(MEASUREMENTS);
		expect(bio.speech_measurements[0].candidate_id).toBe(U_SUBJ);

		// Recording metadata present; storage reference and key id absent.
		expect(bio.recordings).toHaveLength(1);
		expect(bio.recordings[0].id).toBe(ids.recordingId);
		expect(bio.recordings[0].diarization_status).toBe('complete');
		expect(bio.recordings[0]).not.toHaveProperty('storage_path');
		expect(bio.recordings[0]).not.toHaveProperty('encryption_key_id');

		// Speaker labels present.
		expect(bio.speaker_labels).toHaveLength(1);
		expect(bio.speaker_labels[0].speaker_number).toBe(1);

		// Mappings: subject kept, other participant nulled with role kept.
		const bySpeaker = new Map(bio.speaker_mappings.map((m) => [m.speaker_number, m]));
		expect(bySpeaker.get(1).participant_user_id).toBe(U_SUBJ);
		expect(bySpeaker.get(2).participant_user_id).toBeNull();
		expect(bySpeaker.get(2).updated_by).toBeNull();
		expect(bySpeaker.get(2).participant_role).toBe('interviewer');

		// Audit: only the row involving the subject is exported, with
		// the other party's IDs nulled.
		expect(bio.speaker_label_audit).toHaveLength(1);
		expect(bio.speaker_label_audit[0].to_user_id).toBe(U_SUBJ);
		expect(bio.speaker_label_audit[0].from_user_id).toBeNull();
		expect(bio.speaker_label_audit[0].actor_user_id).toBeNull();

		// Labelling consents present.
		expect(bio.labelling_consents).toHaveLength(1);
		expect(bio.labelling_consents[0].decision).toBe('granted');

		// Raw-response hygiene: the other participant's ID, the
		// envelope (base64), the storage sentinel and the key id
		// appear NOWHERE in the response body.
		const text = JSON.stringify(res.body);
		expect(text).not.toContain(String(U_OTHER));
		expect(text).not.toContain(ids.envelope.toString('base64'));
		expect(text).not.toContain('SECRET-KEY-ID-2028');
		expect(text).not.toContain('measurements_envelope');

		// Existing side-effects preserved: a completed export request
		// row and an audit_logs row for the export.
		const dr = await seedPool.query(
			`SELECT status FROM data_requests WHERE user_id = $1 AND request_type = 'export'`,
			[U_SUBJ],
		);
		expect(dr.rows.length).toBeGreaterThanOrEqual(1);
		expect(dr.rows[0].status).toBe('completed');
		const al = await seedPool.query(
			`SELECT COUNT(*)::int AS c FROM audit_logs WHERE user_id = $1`,
			[U_SUBJ],
		);
		expect(al.rows[0].c).toBeGreaterThanOrEqual(1);
	});
});
