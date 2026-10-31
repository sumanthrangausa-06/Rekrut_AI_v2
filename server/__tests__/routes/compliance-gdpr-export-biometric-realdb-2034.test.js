/**
 * #2034 item 9 — Quinn erasure-symmetry journey (HL-003) for the
 * completed GDPR-export biometric section, plus the item-10
 * pre-migration-296 guard on a real database.
 *
 * NO doubles on the paths under test: fresh throwaway Postgres built
 * ONLY by `node migrate.js`, the REAL compliance router, REAL crypto
 * (writer path: encryptWithDEK + packEnvelope + measurementAAD), and
 * the REAL erasure path (erasePersonalData inside BEGIN…COMMIT, the
 * production caller shape).
 *
 * Journey: seed a subject with the full biometric fixture set —
 * event-linked AND session-linked (GAP-A dual branch) recordings,
 * speaker labels/mappings/audit, diarization run+job (with a
 * panel_consent_snapshot sentinel that must never leave the DB),
 * consent receipts (biometric + observer_capture; a `recording`
 * receipt must NOT appear), observer outcome + audio chunk (with an
 * object_key sentinel), a real speech measurement and an is_test one
 * — export over HTTP (complete), erase via the real erasure path,
 * export again over HTTP: the biometric DATA arrays come back empty.
 *
 * Two honest exceptions, both by prior Lex design (see the assertions
 * at the bottom of the journey test):
 *  - interview_recordings rows are keep-REDACTED tombstones under
 *    erasure (GAP-A (c)): the row survives with status='deleted' and
 *    every diarization/storage field NULL — it carries no biometric
 *    data, and the second export must show exactly that shape.
 *  - consent_receipts SURVIVE erasure by design (erasureService GAP-H
 *    disposition: "Out of scope, untouched: consent_receipts
 *    (hash/linkage-only, mig 244 family)" — the consent FACT is kept
 *    under K-1). The second export therefore still lists the receipts
 *    — facts of consent, not biometric data.
 * The post-erasure export is made with an ADMIN token: erasure
 * tombstones the account (deleted_at), so the subject can no longer
 * authenticate — the DSAR-after-erasure path is an admin export.
 *
 * Rig (this run): PostgreSQL 18.6 at 127.0.0.1:55441; DBs
 * `n2034_red` / `n2034_green` (journey) and `n2034_pre296` (guard —
 * the 296 family is dropped from that test DB AFTER migrate.js built
 * it, simulating a pre-296 database) created empty and built only by
 * migrate.js (exit 0).
 *
 * Example:
 *   EXPORT2034_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55441/n2034_green' \
 *   EXPORT2034_PRE296_DB_URL='postgresql://postgres@127.0.0.1:55441/n2034_pre296' \
 *   BIOMETRIC_ENCRYPTION_KEY=<64 hex> \
 *     npx jest server/__tests__/routes/compliance-gdpr-export-biometric-realdb-2034.test.js --runInBand --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool, Client } = require('pg');

const DB_URL = process.env.EXPORT2034_INTEGRATION_DB_URL;
const PRE296_URL = process.env.EXPORT2034_PRE296_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;
const describeIfPre296 = PRE296_URL ? describe : describe.skip;

jest.setTimeout(120000);

const U_SUBJ = 203401;
const U_REC = 203402;
const U_ADMIN = 203403;
const U_OTHER = 203404;

const MEASUREMENTS = { pitch_mean_hz: 190.25, speech_rate_wpm: 133, filler_word_rate: 1.9, pause_ratio: 0.1 };
const SNAPSHOT_SENTINEL = 'SNAPSHOT-SENTINEL-2034';
const OBJECT_KEY_SENTINEL = 'OBJECT-KEY-SENTINEL-2034';

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

describeIfDb('#2034 POST /gdpr/export biometric — real DB erasure-symmetry journey', () => {
	let request;
	let app;
	let generateToken;
	let ids;

	async function cleanAndSeed() {
		const q = (sql, params) => seedPool.query(sql, params);
		// FK-safe teardown for re-runs (children first).
		await q('DELETE FROM transcript_speaker_audit WHERE recording_id IN (SELECT id FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1) OR interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1))', [U_SUBJ]);
		await q('DELETE FROM recording_speaker_mappings WHERE recording_id IN (SELECT id FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1) OR interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1))', [U_SUBJ]);
		await q('DELETE FROM diarization_runs WHERE recording_id IN (SELECT id FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1) OR interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1))', [U_SUBJ]);
		await q('DELETE FROM diarization_jobs WHERE recording_id IN (SELECT id FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1) OR interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1))', [U_SUBJ]);
		await q('DELETE FROM interview_transcripts WHERE recording_id IN (SELECT id FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1) OR interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1))', [U_SUBJ]);
		await q('DELETE FROM event_labelling_consent WHERE user_id = $1', [U_SUBJ]);
		await q('DELETE FROM consent_receipts WHERE candidate_id = $1', [U_SUBJ]);
		await q('DELETE FROM observer_audio_chunks WHERE candidate_id = $1', [U_SUBJ]);
		await q('DELETE FROM observer_capture_outcomes WHERE candidate_id = $1', [U_SUBJ]);
		await q('DELETE FROM observer_speech_measurements WHERE candidate_id = $1', [U_SUBJ]);
		await q('DELETE FROM interview_recordings WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1) OR interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1)', [U_SUBJ]);
		await q('DELETE FROM interview_rooms WHERE interview_event_id IN (SELECT id FROM interview_events WHERE candidate_id = $1)', [U_SUBJ]);
		await q('DELETE FROM interview_events WHERE candidate_id = $1', [U_SUBJ]);
		await q('DELETE FROM interview_sessions WHERE candidate_id = $1', [U_SUBJ]);
		await q('DELETE FROM data_requests WHERE user_id = $1', [U_SUBJ]);
		await q('DELETE FROM audit_logs WHERE user_id = $1', [U_SUBJ]);
		await q('DELETE FROM biometric_audit_log WHERE candidate_id = $1', [U_SUBJ]);
		await q('DELETE FROM candidate_data_keys WHERE candidate_id = $1', [U_SUBJ]);
		await q('DELETE FROM users WHERE id = ANY($1::int[])', [[U_SUBJ, U_REC, U_ADMIN, U_OTHER]]);

		await q(
			`INSERT INTO users (id, email, name, role, company_id) VALUES
			   ($1, 'subj2034@test.local', 'Subject 2034', 'candidate', NULL),
			   ($2, 'rec2034@test.local', 'Recruiter 2034', 'recruiter', NULL),
			   ($3, 'admin2034@test.local', 'Admin 2034', 'admin', NULL),
			   ($4, 'other2034@test.local', 'Other 2034', 'recruiter', NULL)`,
			[U_SUBJ, U_REC, U_ADMIN, U_OTHER],
		);
		const session = await q(
			`INSERT INTO interview_sessions (candidate_id, type, status) VALUES ($1, 'screening', 'completed') RETURNING id`,
			[U_SUBJ],
		);
		const sessionId = session.rows[0].id;
		const session2 = await q(
			`INSERT INTO interview_sessions (candidate_id, type, status) VALUES ($1, 'screening', 'completed') RETURNING id`,
			[U_SUBJ],
		);
		const testSessionId = session2.rows[0].id;
		const event = await q(
			`INSERT INTO interview_events (recruiter_id, candidate_id, status) VALUES ($1, $2, 'completed') RETURNING id`,
			[U_REC, U_SUBJ],
		);
		const eventId = event.rows[0].id;
		const room = await q(
			`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id) VALUES ($1, 'room-2034', 'lk-2034') RETURNING id`,
			[eventId],
		);
		// Event-linked recording (branch 1 of the dual scope).
		const recEvent = await q(
			`INSERT INTO interview_recordings
			   (interview_event_id, room_id, status, started_at, stopped_at, duration_seconds,
			    storage_path, encryption_key_id, file_size_bytes, file_format, diarization_status, diarization_updated_at)
			 VALUES ($1, $2, 'completed', NOW() - interval '2 hours', NOW() - interval '90 minutes', 1800,
			    NULL, 'SECRET-KEY-ID-2034', 123456, 'mp4', 'complete', NOW())
			 RETURNING id`,
			[eventId, room.rows[0].id],
		);
		// Session-linked recording (branch 2 — GAP-A: interview_event_id
		// IS NULL under migration 130's XOR CHECK).
		const recSession = await q(
			`INSERT INTO interview_recordings
			   (interview_session_id, status, started_at, stopped_at, duration_seconds,
			    storage_path, encryption_key_id, file_size_bytes, file_format, diarization_status, diarization_updated_at)
			 VALUES ($1, 'completed', NOW() - interval '1 hour', NOW() - interval '30 minutes', 1800,
			    NULL, 'SECRET-KEY-ID-2034', 654321, 'mp4', 'complete', NOW())
			 RETURNING id`,
			[sessionId],
		);
		const recEventId = recEvent.rows[0].id;
		const recSessionId = recSession.rows[0].id;

		for (const recId of [recEventId, recSessionId]) {
			await q(
				`INSERT INTO interview_transcripts (recording_id, speaker_identity, speaker_number, text, start_time_ms, end_time_ms, confidence)
				 VALUES ($1, 'Speaker 1', 1, 'Synthetic question.', 0, 4000, 0.98)`,
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
				   ($1, 2, $3, $2, $3, 'correct')`,
				[recId, U_SUBJ, U_OTHER],
			);
			const job = await q(
				`INSERT INTO diarization_jobs (recording_id, status, attempt_count, worker_id, error_message, panel_consent_snapshot)
				 VALUES ($1, 'complete', 1, 'WORKER-SENTINEL-2034', 'ERR-SENTINEL-2034', $2::jsonb) RETURNING id`,
				[recId, JSON.stringify({ secret: SNAPSHOT_SENTINEL })],
			);
			await q(
				`INSERT INTO diarization_runs (recording_id, job_id, engine_package, sdk_version, model_version, speaker_count, turns, proposed_mapping, coverage_end_ms, panel_consent_snapshot)
				 VALUES ($1, $2, '@desert-ant-labs/who', '4.2.1', 'v0.3.4', 2, $3::jsonb, $4::jsonb, 1800000, $5::jsonb)`,
				[
					recId,
					job.rows[0].id,
					JSON.stringify([{ speaker: 1, start_ms: 0, end_ms: 4000 }]),
					JSON.stringify({
						1: { participant_user_id: U_SUBJ, participant_role: 'candidate' },
						2: { participant_user_id: U_OTHER, participant_role: 'interviewer' },
					}),
					JSON.stringify({ secret: SNAPSHOT_SENTINEL }),
				],
			);
		}
		await q(
			`INSERT INTO event_labelling_consent (interview_event_id, user_id, decision, notice_version)
			 VALUES ($1, $2, 'granted', 'v1')`,
			[eventId, U_SUBJ],
		);

		// Consent receipts: biometric + observer_capture are in scope;
		// a `recording` receipt must NOT be exported by item 3. The
		// observer_capture consent TEXT is test-fixture-only (migration
		// 257 deliberately seeds none in production).
		await q(
			`INSERT INTO consent_texts (consent_type, version, text_en, text_hi)
			 VALUES ('observer_capture', 'v1', 'fixture text', 'fixture text')
			 ON CONFLICT (consent_type, version) DO NOTHING`,
		);
		await q(
			`INSERT INTO consent_receipts (interview_session_id, candidate_id, consent_type, consent_text_version, consent_text_hash, granted_at) VALUES
			   ($1, $2, 'biometric', '1.3', 'hash-biometric-2034', NOW()),
			   ($1, $2, 'observer_capture', 'v1', 'hash-observer-2034', NOW()),
			   ($1, $2, 'recording', '1.1', 'hash-recording-2034', NOW())`,
			[sessionId, U_SUBJ],
		);

		// Observer siblings: outcome + chunk (object_key is a sentinel).
		await q(
			`INSERT INTO observer_capture_outcomes (interview_session_id, candidate_id, scope, is_test, chunks_persisted, chunks_dropped, audio_seconds_captured, stop_reason, started_at, stopped_at)
			 VALUES ($1, $2, 'activation', false, 2, 0, 60, 'session_end', NOW() - interval '1 hour', NOW() - interval '30 minutes')`,
			[sessionId, U_SUBJ],
		);
		await q(
			`INSERT INTO observer_audio_chunks (interview_session_id, candidate_id, chunk_index, object_key, byte_size, captured_at, is_test)
			 VALUES ($1, $2, 0, $3, 48000, NOW() - interval '59 minutes', false)`,
			[sessionId, U_SUBJ, OBJECT_KEY_SENTINEL],
		);

		// Speech measurements through the REAL writer path: one real
		// row (session 1) and one is_test row (session 2).
		const biometricCrypto = require('../../../lib/biometricCrypto');
		const { packEnvelope } = require('../../../lib/r2FrameStore');
		const { measurementAAD } = require('../../../lib/r2ObserverAudioStore');
		for (const [sessId, isTest] of [[sessionId, false], [testSessionId, true]]) {
			const { ciphertext, iv, tag } = await biometricCrypto.encryptWithDEK(
				Buffer.from(JSON.stringify(MEASUREMENTS), 'utf8'),
				U_SUBJ,
				measurementAAD(U_SUBJ, sessId),
			);
			await q(
				`INSERT INTO observer_speech_measurements (interview_session_id, candidate_id, measurements_envelope, method_version, state, is_test)
				 VALUES ($1, $2, $3, 1, 'recorded', $4)`,
				[sessId, U_SUBJ, packEnvelope({ iv, tag, ciphertext }), isTest],
			);
		}
		return { sessionId, eventId, recEventId, recSessionId };
	}

	beforeAll(async () => {
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

	const doExport = (tokenUser) =>
		request(app)
			.post('/api/compliance/gdpr/export')
			.set('Authorization', `Bearer ${generateToken(tokenUser)}`)
			.send({ userId: U_SUBJ });

	test('export complete → erase (real path) → export again: biometric data empty', async () => {
		// ── Export 1: complete bundle ────────────────────────────────
		const res1 = await doExport({ id: U_SUBJ, email: 'subj2034@test.local', role: 'candidate' });
		expect(res1.status).toBe(200);
		const bio = res1.body.data.biometric;

		// Speech: only the non-test row, decrypted values read back.
		expect(bio.speech_measurements).toHaveLength(1);
		expect(bio.speech_measurements[0].measurements).toEqual(MEASUREMENTS);
		expect(bio.speech_measurements[0].is_test).toBe(false);
		expect(bio.note).toMatch(/test/i);

		// Recordings: BOTH scope branches present.
		expect(bio.recordings.map((r) => r.id).sort()).toEqual([ids.recEventId, ids.recSessionId].sort());
		expect(bio.speaker_labels).toHaveLength(2);
		expect(bio.speaker_mappings).toHaveLength(4);
		expect(bio.speaker_label_audit).toHaveLength(2);
		expect(bio.labelling_consents).toHaveLength(1);

		// Receipts: biometric + observer_capture only.
		expect(bio.consent_receipts.map((r) => r.consent_type).sort()).toEqual(['biometric', 'observer_capture']);

		// Runs sanitised; jobs metadata only.
		expect(bio.diarization_runs).toHaveLength(2);
		for (const run of bio.diarization_runs) {
			expect(run.proposed_mapping['1'].participant_user_id).toBe(U_SUBJ);
			expect(run.proposed_mapping['2'].participant_user_id).toBeNull();
			expect(run.proposed_mapping['2'].participant_role).toBe('interviewer');
			expect(run).not.toHaveProperty('panel_consent_snapshot');
		}
		expect(bio.diarization_jobs).toHaveLength(2);
		for (const job of bio.diarization_jobs) {
			expect(job.status).toBe('complete');
			expect(job).not.toHaveProperty('worker_id');
			expect(job).not.toHaveProperty('error_message');
			expect(job).not.toHaveProperty('panel_consent_snapshot');
		}

		// Observer siblings without object_key.
		expect(bio.observer_capture_outcomes).toHaveLength(1);
		expect(bio.observer_audio_chunks).toHaveLength(1);
		expect(bio.observer_audio_chunks[0].byte_size).toBe(48000);
		expect(bio.observer_audio_chunks[0]).not.toHaveProperty('object_key');

		// Raw-response hygiene: no other participant ID, no sentinels,
		// no envelope, no storage/key identifiers anywhere.
		const text1 = JSON.stringify(res1.body);
		for (const bad of [String(U_OTHER), SNAPSHOT_SENTINEL, OBJECT_KEY_SENTINEL, 'SECRET-KEY-ID-2034', 'WORKER-SENTINEL-2034', 'ERR-SENTINEL-2034', 'measurements_envelope', 'hash-recording-2034']) {
			expect(text1).not.toContain(bad);
		}

		// Items 8+11 evidence in the DB: the AuditLogger row's metadata
		// and a biometric_audit_log 'export' entry exist; neither
		// contains measurement values.
		const al = await seedPool.query(
			`SELECT metadata FROM audit_logs WHERE user_id = $1 AND action_type = 'gdpr_data_export' ORDER BY id DESC LIMIT 1`,
			[U_SUBJ],
		).catch(() => seedPool.query(`SELECT metadata FROM audit_logs WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [U_SUBJ]));
		expect(al.rows.length).toBe(1);
		const meta = typeof al.rows[0].metadata === 'string' ? JSON.parse(al.rows[0].metadata) : al.rows[0].metadata;
		expect(meta.biometric_included).toBe(true);
		expect(meta.biometric_decrypted_rows).toBe(1);
		const bal = await seedPool.query(
			`SELECT action, data_type, metadata FROM biometric_audit_log WHERE candidate_id = $1 AND action = 'export'`,
			[U_SUBJ],
		);
		expect(bal.rows.length).toBeGreaterThanOrEqual(1);
		expect(JSON.stringify(bal.rows)).not.toContain('pitch_mean_hz');
		expect(JSON.stringify(al.rows)).not.toContain('pitch_mean_hz');

		// ── Erasure via the REAL path (production caller shape) ─────
		const { erasePersonalData } = require('../../../lib/erasureService');
		const client = new Client({ connectionString: DB_URL });
		await client.connect();
		try {
			await client.query('BEGIN');
			await erasePersonalData(U_SUBJ, { client });
			await client.query('COMMIT');
		} catch (err) {
			await client.query('ROLLBACK').catch(() => {});
			throw err;
		} finally {
			await client.end();
		}

		// ── Export 2 (admin — the erased account cannot authenticate) ─
		const res2 = await doExport({ id: U_ADMIN, email: 'admin2034@test.local', role: 'admin' });
		expect(res2.status).toBe(200);
		const bio2 = res2.body.data.biometric;
		expect(bio2.speech_measurements).toEqual([]);
		expect(bio2.speaker_labels).toEqual([]);
		expect(bio2.speaker_mappings).toEqual([]);
		expect(bio2.speaker_label_audit).toEqual([]);
		expect(bio2.diarization_runs).toEqual([]);
		expect(bio2.diarization_jobs).toEqual([]);
		expect(bio2.labelling_consents).toEqual([]);
		expect(bio2.observer_capture_outcomes).toEqual([]);
		expect(bio2.observer_audio_chunks).toEqual([]);
		// Keep-redacted tombstones (GAP-A (c)): any recordings still
		// listed are deleted-status rows with no diarization signal.
		for (const r of bio2.recordings) {
			expect(r.status).toBe('deleted');
			expect(r.diarization_status).toBeNull();
		}
		// Consent FACTS survive erasure by design (GAP-H / K-1) — the
		// receipts are hash/linkage records, not biometric data.
		expect(bio2.consent_receipts.map((r) => r.consent_type).sort()).toEqual(['biometric', 'observer_capture']);
	});
});

describeIfPre296('#2034 item 10 — pre-migration-296 database guard (real DB)', () => {
	let request2;
	let app2;
	let generateToken2;
	const pool2 = PRE296_URL ? new Pool({ connectionString: PRE296_URL }) : null;

	beforeAll(async () => {
		// Simulate a pre-296 database: drop the 296 family + the
		// speaker_number column from THIS test DB only (built by
		// migrate.js first). Migration 299's consent table goes too —
		// it did not exist pre-296 either.
		await pool2.query('DROP TABLE IF EXISTS diarization_runs, diarization_jobs, recording_speaker_mappings, transcript_speaker_audit, event_labelling_consent CASCADE');
		await pool2.query('ALTER TABLE interview_transcripts DROP COLUMN IF EXISTS speaker_number');
		await pool2.query('DELETE FROM users WHERE id = $1', [U_SUBJ]);
		await pool2.query(
			`INSERT INTO users (id, email, name, role) VALUES ($1, 'pre296-2034@test.local', 'Pre296 2034', 'candidate')`,
			[U_SUBJ],
		);
		process.env.DATABASE_URL = PRE296_URL;
		jest.resetModules();
		const express = require('express');
		request2 = require('supertest');
		({ generateToken: generateToken2 } = require('../../../lib/auth'));
		const complianceRoutes = require('../../../routes/compliance');
		app2 = express();
		app2.use(express.json());
		app2.use('/api/compliance', complianceRoutes);
	}, 60000);

	afterAll(async () => {
		if (pool2) await pool2.end();
	});

	test('export returns 200 with empty diarization arrays + honest note instead of 500', async () => {
		const token = generateToken2({ id: U_SUBJ, email: 'pre296-2034@test.local', role: 'candidate' });
		const res = await request2(app2)
			.post('/api/compliance/gdpr/export')
			.set('Authorization', `Bearer ${token}`)
			.send({ userId: U_SUBJ });
		expect(res.status).toBe(200);
		const bio = res.body.data.biometric;
		expect(bio.speaker_labels).toEqual([]);
		expect(bio.speaker_mappings).toEqual([]);
		expect(bio.speaker_label_audit).toEqual([]);
		expect(bio.diarization_runs).toEqual([]);
		expect(bio.diarization_jobs).toEqual([]);
		expect(bio.labelling_consents).toEqual([]);
		expect(bio.note).toMatch(/speaker labelling/i);
	});
});
