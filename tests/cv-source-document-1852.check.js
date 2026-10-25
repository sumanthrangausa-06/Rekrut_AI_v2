/**
 * #1852 — runnable journey check (not jest/playwright; needs real Postgres).
 *
 * User journey under test, over real HTTP against the real routers and a
 * real (fresh-migrated) Postgres: the CV Review page must be able to show
 * WHICH CV was analyzed.
 *   candidate A registers + logs in
 *   → GET /candidate/cv/source-document with no CV on file → {document:null}
 *   → a parsed_resumes row exists for A → the endpoint returns exactly that
 *     row's original_filename + created_at + parsing_status, and NOTHING else
 *     (no file_url, no parsed_data anywhere in the body)
 *   → candidate B never sees A's document (isolation), then sees only their own
 *   → unauthenticated request → 401
 *   → GET /candidate/cv/analysis/:id carries document_filename +
 *     document_uploaded_at for THAT analysis's document; B gets 404 for A's.
 *
 * Nothing is mocked: the routers, auth middleware and DB are all real.
 *
 * Run: node tests/cv-source-document-1852.check.js
 * Expects Postgres at 127.0.0.1:55433 (superuser postgres, no password);
 * creates/drops its own scratch database `rekrut_1852_check` and runs the
 * real migrate.js against it.
 */
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const ADMIN_URL = 'postgresql://postgres@127.0.0.1:55433/postgres';
const DB_NAME = 'rekrut_1852_check';
const DB_URL = `postgresql://postgres@127.0.0.1:55433/${DB_NAME}`;
const evidence = [];
function log(line) {
	console.log(line);
	evidence.push(line);
}

async function main() {
	const admin = new Client({ connectionString: ADMIN_URL });
	await admin.connect();
	await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
	await admin.query(`CREATE DATABASE ${DB_NAME}`);
	await admin.end();

	execFileSync('node', ['migrate.js'], {
		cwd: require('node:path').join(__dirname, '..'),
		env: { ...process.env, DATABASE_URL: DB_URL },
		stdio: 'pipe',
		timeout: 600000,
	});
	log('[setup] fresh migrate.js chain completed on scratch DB rekrut_1852_check');

	process.env.DATABASE_URL = DB_URL;
	process.env.JWT_SECRET = 'check-1852-secret-not-for-production';
	process.env.NODE_ENV = 'test';

	const express = require('express');
	const session = require('express-session');
	const pool = require('../lib/db');
	const app = express();
	app.use(express.json());
	// Mirror server.js: login writes req.session.token, so the harness needs
	// the session middleware the real server mounts (in-memory store is fine
	// for a throwaway check rig; the session itself is not under test).
	app.use(session({ secret: 'check-1852-session-secret', resave: false, saveUninitialized: false }));
	app.use('/api/auth', require('../routes/auth'));
	app.use('/api/candidate', require('../routes/candidate'));
	const server = await new Promise((r) => {
		const s = app.listen(0, '127.0.0.1', () => r(s));
	});
	const base = `http://127.0.0.1:${server.address().port}`;
	const call = async (method, path, { token, body } = {}) => {
		const res = await fetch(`${base}${path}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		const text = await res.text();
		let json;
		try { json = JSON.parse(text); } catch { json = { raw: text }; }
		// Redact credential fields before anything reaches the evidence log:
		// register/login bodies carry live (throwaway, but real-shaped) JWTs.
		const redacted = JSON.stringify(json, (k, v) =>
			['token', 'accessToken', 'refreshToken'].includes(k) ? '[redacted]' : v,
		);
		log(`${method} ${path} -> ${res.status} ${redacted.slice(0, 400)}`);
		return { status: res.status, json };
	};

	try {
		// ── Register + login two candidates over real HTTP ──────────────
		const pw = 'CheckPass1852!';
		const regA = await call('POST', '/api/auth/register', { body: { email: 'cand-a-1852@example.com', password: pw, name: 'Candidate A', role: 'candidate' } });
		assert.ok([200, 201, 202].includes(regA.status), `register A: ${regA.status}`);
		const regB = await call('POST', '/api/auth/register', { body: { email: 'cand-b-1852@example.com', password: pw, name: 'Candidate B', role: 'candidate' } });
		assert.ok([200, 201, 202].includes(regB.status), `register B: ${regB.status}`);
		const loginA = await call('POST', '/api/auth/login', { body: { email: 'cand-a-1852@example.com', password: pw } });
		assert.strictEqual(loginA.status, 200, `login A: ${loginA.status}`);
		const tokenA = loginA.json.token || loginA.json.accessToken;
		assert.ok(tokenA, 'login A must return a token');
		const loginB = await call('POST', '/api/auth/login', { body: { email: 'cand-b-1852@example.com', password: pw } });
		assert.strictEqual(loginB.status, 200, `login B: ${loginB.status}`);
		const tokenB = loginB.json.token || loginB.json.accessToken;
		assert.ok(tokenB, 'login B must return a token');
		const idA = (await pool.query('SELECT id FROM users WHERE email=$1', ['cand-a-1852@example.com'])).rows[0].id;
		const idB = (await pool.query('SELECT id FROM users WHERE email=$1', ['cand-b-1852@example.com'])).rows[0].id;
		log(`[setup] candidate A id=${idA}, candidate B id=${idB}`);

		// ── Leg 1: honest empty state ────────────────────────────────────
		const empty = await call('GET', '/api/candidate/cv/source-document', { token: tokenB });
		assert.strictEqual(empty.status, 200);
		assert.strictEqual(empty.json.document, null, 'no CV on file must read document:null');

		// ── Seed A's parsed resume with a known filename + upload date ──
		const seedA = await pool.query(
			`INSERT INTO parsed_resumes (user_id, original_filename, file_url, parsed_data, parsing_status, created_at)
			 VALUES ($1, 'jane-doe-cv.pdf', 'https://storage.example/secret/jane-doe-cv.pdf', '{"secret":"parsed-content"}'::jsonb, 'completed', '2026-10-20T10:00:00.000Z')
			 RETURNING id`,
			[idA],
		);
		const docA = seedA.rows[0].id;
		log(`[setup] seeded parsed_resumes id=${docA} for A (jane-doe-cv.pdf, 2026-10-20)`);

		// ── Leg 2: A sees exactly their own filename + date, nothing more ─
		const mine = await call('GET', '/api/candidate/cv/source-document', { token: tokenA });
		assert.strictEqual(mine.status, 200);
		assert.strictEqual(mine.json.document.original_filename, 'jane-doe-cv.pdf');
		assert.ok(String(mine.json.document.created_at).startsWith('2026-10-20'), `upload date must round-trip, got ${mine.json.document.created_at}`);
		assert.strictEqual(mine.json.document.parsing_status, 'completed');
		const bodyStr = JSON.stringify(mine.json);
		assert.ok(!bodyStr.includes('file_url') && !bodyStr.includes('storage.example'), 'response must never carry file_url');
		assert.ok(!bodyStr.includes('parsed_data') && !bodyStr.includes('parsed-content'), 'response must never carry parsed content');
		assert.deepStrictEqual(Object.keys(mine.json.document).sort(), ['created_at', 'original_filename', 'parsing_status']);

		// ── Leg 3: cross-user isolation ──────────────────────────────────
		const bStillEmpty = await call('GET', '/api/candidate/cv/source-document', { token: tokenB });
		assert.strictEqual(bStillEmpty.json.document, null, "B must not see A's document");
		await pool.query(
			`INSERT INTO parsed_resumes (user_id, original_filename, file_url, parsing_status, created_at)
			 VALUES ($1, 'bob-smith-resume.docx', 'https://storage.example/secret/bob.docx', 'completed', '2026-10-21T09:30:00.000Z')`,
			[idB],
		);
		const bOwn = await call('GET', '/api/candidate/cv/source-document', { token: tokenB });
		assert.strictEqual(bOwn.json.document.original_filename, 'bob-smith-resume.docx', 'B sees only their own document');
		const aStill = await call('GET', '/api/candidate/cv/source-document', { token: tokenA });
		assert.strictEqual(aStill.json.document.original_filename, 'jane-doe-cv.pdf', "A's answer is unchanged by B's upload");

		// ── Leg 4: unauthenticated → 401 ─────────────────────────────────
		const anon = await call('GET', '/api/candidate/cv/source-document', {});
		assert.strictEqual(anon.status, 401, `unauthenticated must be 401, got ${anon.status}`);

		// ── Leg 5: analysis payload names THAT analysis's document ───────
		const ana = await pool.query(
			`INSERT INTO cv_analyses (user_id, document_id, status, overall_score, section_scores, recommendations)
			 VALUES ($1, $2, 'completed', 72, '[]'::jsonb, '[]'::jsonb) RETURNING id`,
			[idA, docA],
		);
		const anaId = ana.rows[0].id;
		const got = await call('GET', `/api/candidate/cv/analysis/${anaId}`, { token: tokenA });
		assert.strictEqual(got.status, 200);
		assert.strictEqual(got.json.analysis.document_filename, 'jane-doe-cv.pdf');
		assert.ok(String(got.json.analysis.document_uploaded_at).startsWith('2026-10-20'), `analysis upload date, got ${got.json.analysis.document_uploaded_at}`);
		const gotByB = await call('GET', `/api/candidate/cv/analysis/${anaId}`, { token: tokenB });
		assert.strictEqual(gotByB.status, 404, "B must not read A's analysis");

		log('PASS: all #1852 journey legs green');
	} finally {
		server.close();
		await pool.end().catch(() => {});
		require('node:fs').writeFileSync(
			require('node:path').join(__dirname, '..', 'docs/sdlc/rekrut-ai-v2/04-implementation/1852-cv-source-display/evidence/e2e-1852.log'),
			evidence.join('\n') + '\n',
		);
	}
}

main()
	.then(() => process.exit(0)) // imported routers hold timers; exit explicitly
	.catch((err) => {
		console.error('FAIL:', err);
		process.exit(1);
	});
