/**
 * #2031 — HL-003 fresh-install journey for the biometric-consent gate on
 * the mock-interview audio routes (Lex ruling 6544214423 + AMENDMENT
 * 6544238952). User perspective: a candidate answering a mock interview
 * by voice/frames must have their audio leave to an external
 * speech-to-text provider ONLY under a valid `biometric` consent; a
 * candidate who declined must still be able to answer in text.
 *
 * NO doubles on the path under test: a fresh throwaway Postgres built
 * ONLY by `node migrate.js`, the REAL interviews router (real lib/db,
 * real auth, real requireBiometricConsent middleware, real
 * consentService). The six cases are Lex's amendment, verbatim:
 *   1. text-only, no consent            -> succeeds; no transcription
 *   2. text + audio_data, no consent    -> 403 CONSENT_REQUIRED;
 *      transcription never called (proved by the handler never
 *      running: the session conversation in the DB is unchanged —
 *      transcription lives only inside the handler/background path
 *      the handler invokes)
 *   3. text + frames, no consent        -> 403 CONSENT_REQUIRED
 *   4. text + audio_data, stale consent -> 403 CONSENT_VERSION_STALE
 *   5. text + audio_data, valid consent -> passes (200; the candidate
 *      turn is persisted with has_audio metadata, as today)
 *   6. /voice-respond, no consent       -> 403 CONSENT_REQUIRED
 *      (unconditional gate)
 * Plus a migration pin: biometric v1.4 is the current text, §1 carries
 * Lex's provider-routing sentence verbatim, and the rest of the text
 * is v1.3 unchanged.
 *
 * Rig (this run): PostgreSQL 18.4 at 127.0.0.1:55433; DB
 * `rekrut_2031` created empty and built only by migrate.js (exit 0).
 * Fixture ids derive from a per-run RUN_BASE so the suite is
 * re-runnable on the same DB (#2039/#2041 pattern).
 *
 * Example:
 *   CONSENT2031_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/rekrut_2031' \
 *     npx jest server/__tests__/routes/interviews-mock-consent-gate-realdb-2031.test.js --runInBand --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.CONSENT2031_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(180000);

const RUN_BASE = 2000000 + Math.floor(Math.random() * 90000) * 10;
const U_CAND = RUN_BASE;
const EMAIL = `cand${RUN_BASE}@test.local`;

const LEX_SENTENCE_EN =
	'When you answer by voice, your audio is sent to an external speech-to-text provider to be turned into a transcript. The provider returns the transcript only; your audio is not used to identify you, and no voice template is created or stored from it.';
const LEX_SENTENCE_HI =
	'जब आप आवाज़ से उत्तर देते हैं, तो आपका ऑडियो एक बाहरी स्पीच-टू-टेक्स्ट प्रदाता को भेजा जाता है ताकि उसे ट्रांसक्रिप्ट में बदला जा सके। प्रदाता केवल ट्रांसक्रिप्ट लौटाता है; आपके ऑडियो का उपयोग आपकी पहचान करने के लिए नहीं किया जाता, और उससे कोई वॉइस टेम्पलेट नहीं बनाया या संग्रहीत किया जाता।';

const SHORT_TEXT = 'I built data pipelines at my last role.';
const LONG_TEXT =
	'I led a data migration project where we moved reporting pipelines to a new warehouse, automated the quality checks, trained the team on the new tools, and cut the weekly reporting time from two days to about three hours overall.';
const FAKE_AUDIO_B64 = Buffer.from('fake-audio-bytes-2031').toString('base64');

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

describeIfDb('#2031 mock audio-route biometric gate — real DB (user journey)', () => {
	let request;
	let app;
	let generateToken;
	let token;
	let currentVersion;

	async function makeSession() {
		const { rows } = await seedPool.query(
			`INSERT INTO mock_interview_sessions (user_id, target_role, status, question_ids, conversation, current_question_index)
			 VALUES ($1, 'Data Analyst', 'in_progress', '{}', '[]', 0) RETURNING id`,
			[U_CAND],
		);
		return rows[0].id;
	}

	async function seedReceipt(sessionId, version, { withdrawn = false } = {}) {
		await seedPool.query(
			`INSERT INTO consent_receipts
			   (interview_session_id, candidate_id, consent_type, consent_text_version, consent_text_hash, granted_at, withdrawn_at)
			 VALUES ($1, $2, 'biometric', $3, $4, NOW(), $5)`,
			[
				sessionId,
				U_CAND,
				version,
				'a'.repeat(64),
				withdrawn ? new Date() : null,
			],
		);
	}

	async function conversationOf(sessionId) {
		const { rows } = await seedPool.query(
			'SELECT conversation FROM mock_interview_sessions WHERE id = $1',
			[sessionId],
		);
		return rows[0].conversation;
	}

	function respond(sessionId, body) {
		return request(app)
			.post(`/api/interviews/mock/${sessionId}/respond`)
			.set('Authorization', `Bearer ${token}`)
			.send(body);
	}

	beforeAll(async () => {
		Object.assign(process.env, { DATABASE_URL: DB_URL });
		await seedPool.query('DELETE FROM users WHERE id = $1', [U_CAND]);
		await seedPool.query(
			`INSERT INTO users (id, email, password_hash, name, role)
			 VALUES ($1, $2, 'x', 'Candidate 2031', 'candidate')`,
			[U_CAND, EMAIL],
		);
		const v = await seedPool.query(
			`SELECT version FROM consent_texts WHERE consent_type = 'biometric'
			  AND effective_from = (SELECT MAX(effective_from) FROM consent_texts WHERE consent_type = 'biometric')`,
		);
		currentVersion = v.rows[0].version;

		const express = require('express');
		request = require('supertest');
		({ generateToken } = require('../../../lib/auth'));
		token = generateToken({ id: U_CAND, email: EMAIL, role: 'candidate' });
		const interviewRoutes = require('../../../routes/interviews');
		app = express();
		app.use(express.json({ limit: '10mb' }));
		app.use('/api/interviews', interviewRoutes);
	}, 60000);

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('migration pin: biometric v1.4 is current, §1 carries Lex sentence verbatim, rest is v1.3 unchanged', async () => {
		expect(currentVersion).toBe('1.4');
		const { rows } = await seedPool.query(
			`SELECT version, text_en, text_hi FROM consent_texts
			 WHERE consent_type = 'biometric' AND version IN ('1.3', '1.4') ORDER BY version`,
		);
		const v13 = rows.find((r) => r.version === '1.3');
		const v14 = rows.find((r) => r.version === '1.4');
		expect(v14.text_en).toContain(LEX_SENTENCE_EN);
		// Removing the one added sentence restores v1.3 exactly (EN + HI).
		expect(v14.text_en.replace(` ${LEX_SENTENCE_EN}`, '')).toBe(v13.text_en);
		expect(v14.text_hi).toContain(LEX_SENTENCE_HI);
		expect(v14.text_hi.replace(` ${LEX_SENTENCE_HI}`, '')).toBe(v13.text_hi);
	});

	test('1. text-only response, no biometric consent -> succeeds', async () => {
		const sid = await makeSession();
		const res = await respond(sid, { response_text: SHORT_TEXT });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		const conv = await conversationOf(sid);
		expect(conv.some((t) => t.role === 'candidate' && t.text === SHORT_TEXT)).toBe(true);
		expect(conv.find((t) => t.role === 'candidate').metadata.has_audio).toBe(false);
	});

	test('2. text + non-empty audio_data, no consent -> 403 CONSENT_REQUIRED, handler never runs', async () => {
		const sid = await makeSession();
		const res = await respond(sid, { response_text: LONG_TEXT, audio_data: FAKE_AUDIO_B64 });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CONSENT_REQUIRED');
		// Handler never ran -> no turn persisted -> the background
		// transcription path (invoked only by the handler) never ran.
		expect(await conversationOf(sid)).toEqual([]);
	});

	test('3. text + non-empty frames, no consent -> 403 CONSENT_REQUIRED', async () => {
		const sid = await makeSession();
		const res = await respond(sid, {
			response_text: SHORT_TEXT,
			frames: ['data:image/jpeg;base64,AAAA'],
		});
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CONSENT_REQUIRED');
		expect(await conversationOf(sid)).toEqual([]);
	});

	test('3b. malformed non-empty payload fails closed: audio_data as a number, no consent -> 403', async () => {
		const sid = await makeSession();
		const res = await respond(sid, { response_text: SHORT_TEXT, audio_data: 12345 });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CONSENT_REQUIRED');
		expect(await conversationOf(sid)).toEqual([]);
	});

	test('4. text + audio_data, stale consent (v1.3 receipt under v1.4) -> CONSENT_VERSION_STALE', async () => {
		const sid = await makeSession();
		await seedReceipt(sid, '1.3');
		const res = await respond(sid, { response_text: LONG_TEXT, audio_data: FAKE_AUDIO_B64 });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CONSENT_VERSION_STALE');
		expect(await conversationOf(sid)).toEqual([]);
	});

	test('5. text + audio_data, valid consent -> gate passes, turn persisted with has_audio', async () => {
		const sid = await makeSession();
		await seedReceipt(sid, currentVersion);
		const res = await respond(sid, { response_text: LONG_TEXT, audio_data: FAKE_AUDIO_B64 });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		const conv = await conversationOf(sid);
		const cand = conv.find((t) => t.role === 'candidate');
		expect(cand).toBeTruthy();
		expect(cand.metadata.has_audio).toBe(true);
	});

	test('3c. malformed frames (string instead of array), no consent -> 403, fail closed', async () => {
		const sid = await makeSession();
		const res = await respond(sid, { response_text: SHORT_TEXT, frames: 'not-an-array' });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CONSENT_REQUIRED');
		expect(await conversationOf(sid)).toEqual([]);
	});

	test('3d. empty payload boundaries pass without consent: audio_data "" and frames [] -> 200', async () => {
		const sid = await makeSession();
		const res = await respond(sid, { response_text: SHORT_TEXT, audio_data: '', frames: [] });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	test('6. /voice-respond without consent -> 403 CONSENT_REQUIRED (unconditional)', async () => {
		const sid = await makeSession();
		const res = await request(app)
			.post(`/api/interviews/mock/${sid}/voice-respond`)
			.set('Authorization', `Bearer ${token}`)
			.field('response_text', 'This is my spoken answer to the question.')
			.attach('audio', Buffer.from('fake-webm-audio'), {
				filename: 'recording.webm',
				contentType: 'audio/webm',
			});
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CONSENT_REQUIRED');
		expect(await conversationOf(sid)).toEqual([]);
	});

	// Specialist-review BLOCK regression (2026-10-31): the shared
	// middleware resolves the session body-first, then query, then
	// params, while the handlers act on the URL session. A caller
	// holding valid consent for one of their OWN sessions must not be
	// able to name that session in the body/query and route audio
	// through a different, non-consented session. The lane pins the
	// gate to the URL param before delegating.
	test('7. /respond body sessionId naming a consented session does NOT bypass the URL session gate', async () => {
		const consentedSid = await makeSession();
		await seedReceipt(consentedSid, currentVersion);
		const sid = await makeSession();
		const res = await respond(sid, {
			response_text: LONG_TEXT,
			audio_data: FAKE_AUDIO_B64,
			sessionId: consentedSid,
		});
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CONSENT_REQUIRED');
		expect(await conversationOf(sid)).toEqual([]);
	});

	test('8. /voice-respond ?sessionId naming a consented session does NOT bypass the URL session gate', async () => {
		const consentedSid = await makeSession();
		await seedReceipt(consentedSid, currentVersion);
		const sid = await makeSession();
		const res = await request(app)
			.post(`/api/interviews/mock/${sid}/voice-respond?sessionId=${consentedSid}`)
			.set('Authorization', `Bearer ${token}`)
			.field('response_text', 'This is my spoken answer to the question.')
			.attach('audio', Buffer.from('fake-webm-audio'), {
				filename: 'recording.webm',
				contentType: 'audio/webm',
			});
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CONSENT_REQUIRED');
		expect(await conversationOf(sid)).toEqual([]);
	});
});
