/**
 * #1180 item (2) — Sentry pre-enablement hardening (red-first pins).
 *
 * Contract: a future SENTRY_DSN must never be set unsafely.
 *  - server.js Sentry.init wires a beforeSend scrubber;
 *  - the scrubber lets NO authorization header, cookie, email, or
 *    transcript text survive in any event field;
 *  - client replay is masked (maskAllText/blockAllMedia true).
 * Item (1) already resolved (no DSN deployed); item (3) vendor terms
 * stays NOT VERIFIED and is out of scope here.
 *
 * These unit tests do NOT satisfy the E2E-on-dev gate (HL-003).
 */
const fs = require('node:fs');
const path = require('node:path');

const CANARY_EMAIL = 'canary.candidate@example.com';
const CANARY_AUTH = 'Bearer CANARY_TOKEN_1180';
const CANARY_COOKIE = 'session=CANARY_COOKIE_1180';
const CANARY_TRANSCRIPT =
	'CANARY_TRANSCRIPT_1180 candidate said: in my previous role I led the migration project and I would answer this behavioural question by describing the conflict I resolved with my manager in detail';
const CANARY_PASSWORD = 'CANARY_PASSWORD_1180';

function syntheticEvent() {
	return {
		event_id: 'abc123',
		message: `login failed for ${CANARY_EMAIL}`,
		request: {
			url: 'https://example.test/api/interviews',
			method: 'POST',
			headers: {
				Authorization: CANARY_AUTH,
				authorization: CANARY_AUTH,
				Cookie: CANARY_COOKIE,
				'X-Api-Key': 'CANARY_APIKEY_1180',
				'content-type': 'application/json',
				'user-agent': 'jest',
			},
			data: { transcript: CANARY_TRANSCRIPT, password: CANARY_PASSWORD },
			cookies: { session: 'CANARY_COOKIE_1180' },
			query_string: `email=${CANARY_EMAIL}`,
		},
		user: { id: '42', email: CANARY_EMAIL, ip_address: '203.0.113.9', username: CANARY_EMAIL },
		breadcrumbs: [
			{
				message: `said: ${CANARY_TRANSCRIPT}`,
				data: { note: CANARY_TRANSCRIPT, email: CANARY_EMAIL },
			},
			{ message: 'clicked submit', data: { count: 3 } },
		],
		extra: { transcriptText: CANARY_TRANSCRIPT, contact: CANARY_EMAIL, retries: 2 },
		contexts: { app: { app_name: 'rekrut' } },
		exception: {
			values: [{ type: 'Error', value: `boom near ${CANARY_EMAIL}`, stacktrace: { frames: [] } }],
		},
	};
}

describe('#1180 source pins', () => {
	test('server.js Sentry.init wires beforeSend scrubber, init stays DSN-conditional', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../../server.js'), 'utf8');
		expect(src).toMatch(/beforeSend/);
		expect(src).toMatch(/sentry-scrub/);
		expect(src).toMatch(/if \(process\.env\.SENTRY_DSN\)/);
	});
	test('client replayIntegration masks text and blocks media', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../../client/src/main.tsx'), 'utf8');
		expect(src).toMatch(/maskAllText:\s*true/);
		expect(src).toMatch(/blockAllMedia:\s*true/);
		expect(src).not.toMatch(/maskAllText:\s*false/);
		expect(src).not.toMatch(/blockAllMedia:\s*false/);
	});
	test('both inits wire beforeSend AND beforeSendTransaction scrubbers', () => {
		const server = fs.readFileSync(path.join(__dirname, '../../../server.js'), 'utf8');
		const client = fs.readFileSync(path.join(__dirname, '../../../client/src/main.tsx'), 'utf8');
		for (const src of [server, client]) {
			expect(src).toMatch(/beforeSend/);
			expect(src).toMatch(/beforeSendTransaction/);
		}
		expect(client).toMatch(/sentryScrub/);
		expect(server).toMatch(/beforeSendTransaction:\s*\(event\) => scrubSentryEvent\(event\)/);
	});
});

describe('#1180 scrubSentryEvent', () => {
	let scrubSentryEvent;
	beforeAll(() => {
		({ scrubSentryEvent } = require('../../../lib/sentry-scrub'));
	});
	test('is exported as a function', () => {
		expect(typeof scrubSentryEvent).toBe('function');
	});
	test('no canary secret/PII/transcript value survives anywhere in the event', () => {
		const out = scrubSentryEvent(syntheticEvent(), {});
		const blob = JSON.stringify(out);
		for (const canary of [
			CANARY_EMAIL,
			CANARY_AUTH,
			'CANARY_TOKEN_1180',
			CANARY_COOKIE,
			'CANARY_COOKIE_1180',
			CANARY_TRANSCRIPT,
			'CANARY_TRANSCRIPT_1180',
			CANARY_PASSWORD,
			'CANARY_APIKEY_1180',
			'203.0.113.9',
		]) {
			expect(blob).not.toContain(canary);
		}
	});
	test('non-sensitive structure survives (event still useful)', () => {
		const out = scrubSentryEvent(syntheticEvent(), {});
		expect(out.event_id).toBe('abc123');
		expect(out.request.method).toBe('POST');
		expect(out.request.headers['content-type']).toBe('application/json');
		expect(out.user.id).toBe('42');
		expect(out.breadcrumbs[1].data.count).toBe(3);
		expect(out.extra.retries).toBe(2);
	});
	test('does not mutate the input event', () => {
		const ev = syntheticEvent();
		scrubSentryEvent(ev, {});
		expect(ev.request.headers.Authorization).toBe(CANARY_AUTH);
		expect(ev.user.email).toBe(CANARY_EMAIL);
	});
	test('null / non-object events are dropped, never passed through (SDK contract)', () => {
		expect(scrubSentryEvent(null, {})).toBeNull();
		expect(scrubSentryEvent(undefined, {})).toBeNull();
		expect(scrubSentryEvent('not-an-event', {})).toBeNull();
	});
	test('circular event fails closed (dropped, never passed raw)', () => {
		const ev = syntheticEvent();
		ev.self = ev;
		expect(scrubSentryEvent(ev, {})).toBeNull();
	});
});

// ─── Round 2: privacy-engineer BLOCK/MAJOR probes, as regression pins ───────
// Every case below was reproduced leaking against the round-1 scrubber.
describe('#1180 scrubber — reviewer probe regressions', () => {
	let scrubSentryEvent;
	beforeAll(() => {
		({ scrubSentryEvent } = require('../../../lib/sentry-scrub'));
	});
	const blob = (ev) => JSON.stringify(scrubSentryEvent(ev, {}));
	const SHORT_FRAGMENT = 'I was fired for misconduct at my last job';

	test('long transcript in message / exception / contexts / tags / frame vars does not survive', () => {
		const ev = {
			message: CANARY_TRANSCRIPT,
			exception: {
				values: [
					{
						type: 'Error',
						value: `AI parse failed on: ${CANARY_TRANSCRIPT}`,
						stacktrace: {
							frames: [{ vars: { answer: CANARY_TRANSCRIPT, prompt: CANARY_TRANSCRIPT } }],
						},
					},
				],
			},
			contexts: { interview: { answer: CANARY_TRANSCRIPT } },
			tags: { note: CANARY_TRANSCRIPT },
			spans: [{ data: { completion: CANARY_TRANSCRIPT } }],
		};
		expect(blob(ev)).not.toContain('CANARY_TRANSCRIPT_1180');
	});
	test('short fragments and chunked fragments in breadcrumbs/extra do not survive', () => {
		const half = Math.floor(CANARY_TRANSCRIPT.length / 2);
		const ev = {
			breadcrumbs: [{ message: SHORT_FRAGMENT, data: { note: SHORT_FRAGMENT } }],
			extra: {
				note: SHORT_FRAGMENT,
				answer: SHORT_FRAGMENT,
				parts: [CANARY_TRANSCRIPT.slice(0, half), CANARY_TRANSCRIPT.slice(half)],
			},
		};
		const out = blob(ev);
		expect(out).not.toContain(SHORT_FRAGMENT);
		expect(out).not.toContain('CANARY_TRANSCRIPT_1180');
		expect(out).not.toContain('behavioural question by describing');
	});
	test('IPs survive nowhere: tags, contexts, X-Forwarded-For, request.env', () => {
		const ev = {
			tags: { ip_address: '198.51.100.7' },
			contexts: { user: { ip_address: '198.51.100.7' } },
			request: {
				headers: { 'X-Forwarded-For': '198.51.100.7' },
				env: { REMOTE_ADDR: '198.51.100.7' },
			},
		};
		expect(blob(ev)).not.toContain('198.51.100.7');
	});
	test('non-email username and name are dropped from user', () => {
		const out = scrubSentryEvent(
			{ user: { id: '9', username: 'jane_doe_candidate', name: 'Jane Candidate' } },
			{},
		);
		expect(out.user.id).toBe('9');
		expect(JSON.stringify(out)).not.toContain('jane_doe_candidate');
		expect(JSON.stringify(out)).not.toContain('Jane Candidate');
	});
	test('AWS-style presigned URLs and token URLs in strings do not survive', () => {
		const ev = {
			message:
				'GET https://bucket.example.com/cv.pdf?X-Amz-Signature=AMZVAL111&X-Amz-Expires=3600 and https://app.example.com/cb?access_token=ATVAL444 and /api/files/cv.pdf?token=RELVAL555',
			request: { url: 'https://bucket.example.com/cv.pdf?X-Amz-Credential=CREDVAL222' },
		};
		const out = blob(ev);
		for (const v of ['AMZVAL111', 'ATVAL444', 'RELVAL555', 'CREDVAL222'])
			expect(out).not.toContain(v);
	});
	test('Bearer tokens and JWTs inside strings do not survive', () => {
		const jwt =
			'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
		const ev = {
			exception: { values: [{ value: 'auth failed Bearer BEARVAL666' }] },
			breadcrumbs: [{ message: `token ${jwt}` }],
		};
		const out = blob(ev);
		expect(out).not.toContain('BEARVAL666');
		expect(out).not.toContain('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV');
	});
	test('credential/PII keys beyond the round-1 list are redacted (cv, resume, sessionId, privateKey, jwt, phone, ssn)', () => {
		const ev = {
			extra: {},
			contexts: {
				x: {
					cv: 'CVVAL777',
					resume: 'RESVAL888',
					sessionId: 'SESVAL999',
					privateKey: 'PKVAL000',
					jwt: 'JWTVAL111',
					phone: 'PHONEVAL222',
					ssn: 'SSNVAL333',
				},
			},
		};
		const out = blob(ev);
		for (const v of [
			'CVVAL777',
			'RESVAL888',
			'SESVAL999',
			'PKVAL000',
			'JWTVAL111',
			'PHONEVAL222',
			'SSNVAL333',
		])
			expect(out).not.toContain(v);
	});
	test('custom auth header and non-string header values are scrubbed', () => {
		const ev = {
			request: {
				headers: {
					'X-Custom-Auth': 'Bearer HDRVAL777',
					'X-Debug': ['canary.candidate@example.com'],
				},
			},
		};
		const out = blob(ev);
		expect(out).not.toContain('HDRVAL777');
		expect(out).not.toContain(CANARY_EMAIL);
	});
	test('email-shaped object KEYS do not survive', () => {
		const ev = { contexts: { x: { 'canary.candidate@example.com': 'x' } }, tags: {} };
		ev.tags[CANARY_EMAIL] = 'y';
		expect(blob(ev)).not.toContain(CANARY_EMAIL);
	});
	test('shared (non-circular) references do not drop the event', () => {
		const shared = { region: 'us-east' };
		const out = scrubSentryEvent({ contexts: { a: shared, b: shared }, event_id: 'x1' }, {});
		expect(out).not.toBeNull();
		expect(out.event_id).toBe('x1');
	});
});

// ─── Round 3: security-reviewer BLOCK/MAJOR probes, as regression pins ──────
// Structural fixes: frame vars dropped, header ALLOWLIST, request.env
// dropped, every URL/query param value redacted, __proto__-safe copy,
// credential-shape patterns (URI userinfo, sk- keys).
describe('#1180 scrubber — security probe regressions', () => {
	let scrubSentryEvent;
	beforeAll(() => {
		({ scrubSentryEvent } = require('../../../lib/sentry-scrub'));
	});
	const blob = (ev) => JSON.stringify(scrubSentryEvent(ev, {}));

	test('stacktrace frame vars and context_line never survive, under any local name', () => {
		const ev = {
			exception: {
				values: [
					{
						value: 'boom',
						stacktrace: {
							frames: [
								{
									filename: 'app.js',
									vars: {
										dbUrl: 'redis://:FRAMEPW111@cachehost:6379',
										config: 'FRAMESECRET222',
										req: 'FRAMEVAL333',
									},
									context_line: 'const key = "FRAMESECRET222";',
								},
							],
						},
					},
				],
			},
		};
		const out = blob(ev);
		for (const v of ['FRAMEPW111', 'FRAMESECRET222', 'FRAMEVAL333']) expect(out).not.toContain(v);
		expect(out).toContain('app.js');
	});
	test('headers are allowlisted: X-Auth / X-JWT / X-Password / Authentication redacted, safe headers survive', () => {
		const ev = {
			request: {
				headers: {
					'X-Auth': 'HDRSEC111',
					'X-JWT': 'HDRSEC222',
					'X-Password': 'HDRSEC333',
					Authentication: 'HDRSEC444',
					'content-type': 'application/json',
					'user-agent': 'jest-agent',
				},
			},
		};
		const out = scrubSentryEvent(ev, {});
		const s = JSON.stringify(out);
		for (const v of ['HDRSEC111', 'HDRSEC222', 'HDRSEC333', 'HDRSEC444'])
			expect(s).not.toContain(v);
		expect(out.request.headers['content-type']).toBe('application/json');
		expect(out.request.headers['user-agent']).toBe('jest-agent');
	});
	test('request.env is dropped outright (DATABASE_URL / SMTP_PASS class)', () => {
		const ev = {
			request: {
				env: {
					DATABASE_URL: 'postgres://u:ENVPW555@host/prod',
					SMTP_PASS: 'ENVSEC666',
					NODE_ENV: 'production',
				},
			},
		};
		const out = blob(ev);
		expect(out).not.toContain('ENVPW555');
		expect(out).not.toContain('ENVSEC666');
	});
	test('every query_string value is redacted, whatever the param name', () => {
		const ev = { request: { query_string: 'sig=QSIG777&key=QKEY888&otp=QOTP999&page=2' } };
		const out = blob(ev);
		for (const v of ['QSIG777', 'QKEY888', 'QOTP999']) expect(out).not.toContain(v);
	});
	test('every URL query param value in any string is redacted; path survives', () => {
		const ev = { message: 'see https://app.example.com/reset?whatever=UVAL111&other=UVAL222 end' };
		const out = blob(ev);
		expect(out).not.toContain('UVAL111');
		expect(out).not.toContain('UVAL222');
		expect(out).toContain('https://app.example.com/reset');
	});
	test('credential shapes in strings: URI userinfo and sk- keys do not survive', () => {
		const ev = {
			exception: {
				values: [
					{
						value:
							'connect postgres://user:URIPW333@db.internal:5432/prod failed with sk_live_SKEY444xyz',
					},
				],
			},
			fingerprint: ['redis://:URIPW555@cache:6379'],
		};
		const out = blob(ev);
		for (const v of ['URIPW333', 'SKEY444', 'URIPW555']) expect(out).not.toContain(v);
		expect(out).toContain('db.internal');
	});
	test('query_string in object / array form: every value redacted (privacy F-13)', () => {
		const obj = blob({
			request: { query_string: { sig: 'QSIG131', key: 'QKEY132', otp: 'QOTP133' } },
		});
		const arr = blob({
			request: {
				query_string: [
					['sig', 'QSIG134'],
					['page', '2'],
				],
			},
		});
		for (const v of ['QSIG131', 'QKEY132', 'QOTP133', 'QSIG134']) {
			expect(obj).not.toContain(v);
			expect(arr).not.toContain(v);
		}
	});
	test('frame pre_context / post_context never survive (privacy F-14)', () => {
		const ev = {
			exception: {
				values: [
					{
						stacktrace: {
							frames: [
								{
									pre_context: ['const a = "PRECTX141";'],
									post_context: ['const b = "POSTCTX142";'],
								},
							],
						},
					},
				],
			},
		};
		const out = blob(ev);
		expect(out).not.toContain('PRECTX141');
		expect(out).not.toContain('POSTCTX142');
	});
	test('IPv6 literals and SSN shapes and key=value credentials in strings do not survive (privacy F-15/F-16)', () => {
		const ev = {
			message: 'from 2001:db8::1 ssn 123-45-6789 password=PWVAL161 Cookie: session=COOKIEVAL162',
			contexts: { x: { note: 'call 123-45-6789' } },
		};
		const out = blob(ev);
		for (const v of ['2001:db8::1', '123-45-6789', 'PWVAL161', 'COOKIEVAL162'])
			expect(out).not.toContain(v);
	});
	test('URL fragments and token-in-path segments do not survive (security B4)', () => {
		const ev = {
			message:
				'cb https://app.example.com/cb#access_token=FRAG111 and https://app.example.com/reset#token=FRAGONLY222',
			request: {
				url: 'https://app.example.com/api/interviews/screening/session/SESS_TOKEN_44332211/start',
			},
			contexts: {
				x: {
					a: 'https://app.example.com/reset-password/RESETTOK111-abc-def',
					b: 'https://app.example.com/interview-sessions/by-token/INVTOK222xyz',
					c: 'https://app.example.com/cb?BAREPARAM333',
				},
			},
		};
		const out = blob(ev);
		for (const v of [
			'FRAG111',
			'FRAGONLY222',
			'SESS_TOKEN_44332211',
			'RESETTOK111',
			'INVTOK222xyz',
			'BAREPARAM333',
		])
			expect(out).not.toContain(v);
		expect(out).toContain('/api/interviews/screening/session/');
	});
	test('plain-named credential keys are redacted (security m1)', () => {
		const ev = {
			contexts: {
				x: {
					pwd: 'PWDM111',
					passphrase: 'PHRASEM222',
					auth: 'AUTHM333',
					accessKey: 'ACCM444',
					key: 'KEYM555',
					otp: 'OTPM666',
					pin: 'PINM777',
					verificationCode: 'VCODEM888',
					cardNumber: 'CARDM999',
					iban: 'IBANM000',
				},
			},
		};
		const out = blob(ev);
		for (const v of [
			'PWDM111',
			'PHRASEM222',
			'AUTHM333',
			'ACCM444',
			'KEYM555',
			'OTPM666',
			'PINM777',
			'VCODEM888',
			'CARDM999',
			'IBANM000',
		])
			expect(out).not.toContain(v);
	});
	test('vendor token shapes, 2-part JWT, phone/card/encoded-email in strings do not survive (security N2/N3/N4)', () => {
		const ev = {
			message:
				'ghp_GHPTOKEN1111111111111111 AKIAIOSFODNN7EXAMPLE xoxb-123456789012-SLACKTOK444 AIzaSyGOOGLEKEY5555555555555555555 npm_NPMTOKEN6666666666666666',
			contexts: {
				x: {
					sg: 'SG.SENDGRIDPART1111111.SENDGRIDPART2222222',
					jwt2: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ',
					phone: 'call +1 415-555-0132 now',
					card: 'card 4242 4242 4242 4242 end',
					enc: 'user%40example.com',
				},
			},
			spans: [{ data: { 'db.statement': "UPDATE t SET pw='SPANPW777' WHERE id=1" } }],
		};
		const out = blob(ev);
		for (const v of [
			'GHPTOKEN1111111111111111',
			'AKIAIOSFODNN7EXAMPLE',
			'SLACKTOK444',
			'AIzaSyGOOGLEKEY5555555555555555555',
			'NPMTOKEN6666666666666666',
			'SENDGRIDPART1111111',
			'eyJzdWIiOiIxMjMifQ',
			'415-555-0132',
			'4242 4242 4242 4242',
			'user%40example.com',
			'SPANPW777',
		])
			expect(out).not.toContain(v);
	});
	test('underscore-compound key=value credentials in strings do not survive (security final, M4 remainder)', () => {
		const ev = {
			contexts: { x: { a: 'api_token=KV333', b: 'client_secret=CS444', c: 'user_password=UP555' } },
			message: 'oauth failed access_token=AT666 refresh_token=RT777 app_session=AS888 my_sid=MS999 db_passwd=DP000',
			tags: { t: 'auth_token=AUT111' },
		};
		const out = blob(ev);
		for (const v of ['KV333', 'CS444', 'UP555', 'AT666', 'RT777', 'AS888', 'MS999', 'DP000', 'AUT111'])
			expect(out).not.toContain(v);
		expect(out).toContain('api_token=[REDACTED]');
	});
	test('__proto__ payload cannot set the scrubbed copy prototype or pollute Object.prototype', () => {
		const ev = JSON.parse('{"extra":{"__proto__":{"polluted1180":"yes"}},"event_id":"p1"}');
		const out = scrubSentryEvent(ev, {});
		expect(out).not.toBeNull();
		expect(out.event_id).toBe('p1');
		expect(Object.getPrototypeOf(out.extra)).toBe(Object.prototype);
		expect({}.polluted1180).toBeUndefined();
		expect(JSON.stringify(out)).not.toContain('polluted1180');
	});
});
