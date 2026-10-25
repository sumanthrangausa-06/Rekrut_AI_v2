/**
 * #1843 — runnable journey check (not jest/playwright; needs real Postgres).
 *
 * Founder-hit defect: paid Stripe checkout completes, but CV Analyze never
 * unlocks. User journey under test, over real HTTP against the real routers
 * and a real (fresh-migrated) Postgres:
 *   candidate signs in → POST /billing/confirm-session (Stripe return)
 *   → tier reads back 'pro' via GET /billing/tier
 *   → POST /candidate/cv/analyze passes the Pro gate (400 NO_DOCUMENT for a
 *     user with no CV on file — the honest next state — NOT 403
 *     UPGRADE_REQUIRED)
 *   and the second confirm path: GET /auth/verify-payment (Polsia) must
 *   also leave the account tier 'pro'.
 *
 * The ONLY stub is the external Stripe transport (global fetch to
 * api.stripe.com): it returns Stripe's default, UNEXPANDED session shape —
 * `subscription` as an id string, status 'complete', payment_status 'paid'.
 * That is the response shape the confirm handler must survive; the bug was
 * storing session.status ('complete') as subscription_status, which
 * lib/subscription.getUserTier does not accept ('active'/'trialing' only).
 * Polsia is stubbed the same way, at its configured base URL (a local HTTP
 * server), returning { verified: true }.
 *
 * Run: node tests/billing-pro-confirm-1843.check.js
 * Expects Postgres at 127.0.0.1:55433 (superuser postgres, no password);
 * creates/drops its own scratch database `rekrut_1843_check` and runs the
 * real migrate.js against it.
 */
const assert = require('node:assert');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const ADMIN_URL = 'postgresql://postgres@127.0.0.1:55433/postgres';
const DB_NAME = 'rekrut_1843_check';
const DB_URL = `postgresql://postgres@127.0.0.1:55433/${DB_NAME}`;

async function main() {
	const admin = new Client({ connectionString: ADMIN_URL });
	await admin.connect();
	await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
	await admin.query(`CREATE DATABASE ${DB_NAME}`);
	await admin.end();

	// Fresh-install schema: the real migration chain, nothing hand-rolled.
	execFileSync('node', ['migrate.js'], {
		cwd: require('node:path').join(__dirname, '..'),
		env: { ...process.env, DATABASE_URL: DB_URL },
		stdio: 'pipe',
		timeout: 600000,
	});

	// Env must be set before lib/db / lib/auth build from it.
	process.env.DATABASE_URL = DB_URL;
	process.env.JWT_SECRET = 'check-1843-secret';
	process.env.STRIPE_SECRET_KEY = 'sk_test_1843_stubbed_transport';

	// Polsia stub: verify-payment reads POLSIA_API_URL at call time.
	const polsia = http.createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ verified: true, payment: { subscription_id: 'sub_polsia_1' } }));
	});
	await new Promise((r) => polsia.listen(0, '127.0.0.1', r));
	process.env.POLSIA_API_URL = `http://127.0.0.1:${polsia.address().port}`;
	process.env.POLSIA_API_KEY = 'check-key';

	// Stripe transport stub (external boundary only). Set BEFORE the billing
	// router is required; stripeGet calls the global fetch at request time.
	const realFetch = global.fetch;
	let userIdForSession = null;
	global.fetch = async (url, opts) => {
		const u = String(url);
		if (u.startsWith('https://api.stripe.com/')) {
			// Rex-amendment variant: an EXPANDED subscription whose real
			// status is not gate-accepted must be stored verbatim.
			if (u.includes('cs_test_1843_bad')) {
				const bad = {
					id: 'cs_test_1843_bad',
					status: 'complete',
					payment_status: 'paid',
					client_reference_id: String(userIdForSession),
					customer_email: 'founder-check@example.com',
					metadata: { plan_id: 'growth', billing_cycle: 'monthly' },
					subscription: { id: 'sub_bad_1', status: 'incomplete' },
				};
				return {
					ok: true,
					status: 200,
					json: async () => bad,
					text: async () => JSON.stringify(bad),
				};
			}
			// Stripe's default (unexpanded) checkout-session representation.
			const session = {
				id: 'cs_test_1843',
				status: 'complete',
				payment_status: 'paid',
				client_reference_id: String(userIdForSession),
				customer_email: 'founder-check@example.com',
				metadata: { plan_id: 'growth', billing_cycle: 'monthly' },
				subscription: 'sub_1843_unexpanded',
			};
			return {
				ok: true,
				status: 200,
				json: async () => session,
				text: async () => JSON.stringify(session),
			};
		}
		return realFetch(url, opts);
	};

	const express = require('express');
	const pool = require('../lib/db');
	const { generateToken, hashPassword } = require('../lib/auth');

	const ins = await pool.query(
		`INSERT INTO users (name, email, password_hash, role, is_paid, subscription_status)
		 VALUES ('Founder Check', 'founder-check@example.com', $1, 'candidate', false, NULL)
		 RETURNING id`,
		[await hashPassword('CheckPass123!')],
	);
	const userId = ins.rows[0].id;
	userIdForSession = userId;
	const token = generateToken({ id: userId, email: 'founder-check@example.com', role: 'candidate' });
	const authH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

	const app = express();
	app.use(express.json());
	app.use('/api/billing', require('../routes/billing'));
	app.use('/api/auth', require('../routes/auth'));
	app.use('/api/candidate', require('../routes/candidate'));
	const server = await new Promise((r) => {
		const s = app.listen(0, '127.0.0.1', () => r(s));
	});
	const base = `http://127.0.0.1:${server.address().port}`;
	const call = (method, path, body, headers = authH) =>
		realFetch(`${base}${path}`, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});

	try {
		console.log("[check] leg 1: confirm-session"); // ── Leg 1: Stripe return → confirm-session ──────────────────────────
		const confirmRes = await call('POST', '/api/billing/confirm-session', { session_id: 'cs_test_1843' });
		const confirm = await confirmRes.json();
		assert.strictEqual(confirmRes.status, 200, `confirm-session HTTP ${confirmRes.status}: ${JSON.stringify(confirm)}`);
		assert.strictEqual(confirm.verified, true, 'session must verify as paid');
		assert.strictEqual(confirm.synced, true, 'paid session must sync to the signed-in user');

		const row1 = (await pool.query('SELECT is_paid, subscription_status FROM users WHERE id=$1', [userId])).rows[0];
		assert.strictEqual(row1.is_paid, true, 'is_paid must be true after confirm');
		assert.ok(
			['active', 'trialing'].includes(row1.subscription_status),
			`subscription_status must be one the tier gate accepts, got '${row1.subscription_status}' (the #1843 bug stored 'complete')`,
		);

		const tierRes = await call('GET', '/api/billing/tier');
		const tier = await tierRes.json();
		assert.strictEqual(tier.tier, 'pro', `tier must read back 'pro' after paid confirm, got '${tier.tier}'`);

		console.log("[check] leg 2: cv gate"); // ── Leg 2: the Pro gate itself — Analyze must NOT 403 ───────────────
		const analyzeRes = await call('POST', '/api/candidate/cv/analyze', {});
		const analyze = await analyzeRes.json();
		assert.notStrictEqual(analyze.code, 'UPGRADE_REQUIRED', 'paid user must not hit the Pro gate');
		assert.strictEqual(analyzeRes.status, 400, `expected honest NO_DOCUMENT 400, got ${analyzeRes.status}`);
		assert.strictEqual(analyze.code, 'NO_DOCUMENT', `expected NO_DOCUMENT, got ${JSON.stringify(analyze)}`);

		console.log("[check] leg 3: verify-payment"); // ── Leg 3: second confirm path — verify-payment (payment-success.tsx) ─
		const ins2 = await pool.query(
			`INSERT INTO users (name, email, password_hash, role, is_paid, subscription_status)
			 VALUES ('Second Path', 'second-check@example.com', $1, 'candidate', false, NULL)
			 RETURNING id`,
			[await hashPassword('CheckPass123!')],
		);
		const user2 = ins2.rows[0].id;
		const token2 = generateToken({ id: user2, email: 'second-check@example.com', role: 'candidate' });
		const verifyRes = await realFetch(`${base}/api/auth/verify-payment?session_id=cs_test_1843`, {
			headers: { Authorization: `Bearer ${token2}` },
		});
		const verify = await verifyRes.json();
		assert.strictEqual(verify.verified, true, `verify-payment must verify: ${JSON.stringify(verify)}`);
		const row2 = (await pool.query('SELECT is_paid, subscription_status FROM users WHERE id=$1', [user2])).rows[0];
		assert.strictEqual(row2.is_paid, true, 'verify-payment must set is_paid');
		assert.ok(
			['active', 'trialing'].includes(row2.subscription_status),
			`verify-payment must leave a tier-accepted subscription_status, got '${row2.subscription_status}' (was NULL → tier 'free')`,
		);

		console.log("[check] leg 4: heal"); // ── Leg 4: already-stranded paid account heals at the gate ──────────
		// Simulates the founder's stored row as the old writer left it:
		// is_paid=true, a subscription on file, status 'complete'.
		const ins3 = await pool.query(
			`INSERT INTO users (name, email, password_hash, role, is_paid, stripe_subscription_id, subscription_status)
			 VALUES ('Stranded Paid', 'stranded-check@example.com', $1, 'candidate', true, 'sub_stale_1', 'complete')
			 RETURNING id`,
			[await hashPassword('CheckPass123!')],
		);
		const user3 = ins3.rows[0].id;
		const token3 = generateToken({ id: user3, email: 'stranded-check@example.com', role: 'candidate' });
		const healRes = await realFetch(`${base}/api/candidate/cv/analyze`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token3}`, 'Content-Type': 'application/json' },
			body: '{}',
		});
		const healBody = await healRes.json();
		assert.notStrictEqual(healBody.code, 'UPGRADE_REQUIRED', 'stranded paid account must pass the gate');
		const row3 = (await pool.query('SELECT subscription_status FROM users WHERE id=$1', [user3])).rows[0];
		assert.strictEqual(row3.subscription_status, 'active', `stranded row must heal to 'active', got '${row3.subscription_status}'`);

		console.log("[check] leg 5: guard"); // ── Leg 5: the heal guard — paid flag with NO subscription stays free ─
		const ins4 = await pool.query(
			`INSERT INTO users (name, email, password_hash, role, is_paid, stripe_subscription_id, subscription_status)
			 VALUES ('No Subscription', 'nosub-check@example.com', $1, 'candidate', true, NULL, 'complete')
			 RETURNING id`,
			[await hashPassword('CheckPass123!')],
		);
		const user4 = ins4.rows[0].id;
		const token4 = generateToken({ id: user4, email: 'nosub-check@example.com', role: 'candidate' });
		const guardRes = await realFetch(`${base}/api/candidate/cv/analyze`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token4}`, 'Content-Type': 'application/json' },
			body: '{}',
		});
		assert.strictEqual(guardRes.status, 403, `no-subscription account must stay gated, got ${guardRes.status}`);

		// ── Leg 6: lifecycle statuses are NOT healed (webhook is source) ────
		const ins5 = await pool.query(
			`INSERT INTO users (name, email, password_hash, role, is_paid, stripe_subscription_id, subscription_status)
			 VALUES ('Past Due', 'pastdue-check@example.com', $1, 'candidate', true, 'sub_pd_1', 'past_due')
			 RETURNING id`,
			[await hashPassword('CheckPass123!')],
		);
		const user5 = ins5.rows[0].id;
		const token5 = generateToken({ id: user5, email: 'pastdue-check@example.com', role: 'candidate' });
		const pdRes = await realFetch(`${base}/api/candidate/cv/analyze`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token5}`, 'Content-Type': 'application/json' },
			body: '{}',
		});
		assert.strictEqual(pdRes.status, 403, `past_due account must stay gated, got ${pdRes.status}`);
		const row5 = (await pool.query('SELECT subscription_status FROM users WHERE id=$1', [user5])).rows[0];
		assert.strictEqual(row5.subscription_status, 'past_due', 'past_due status must not be rewritten by the heal');

		// ── Leg 7: signed-out checkout creation is refused up front ────────
		// A checkout with no account attached could never sync (Leg 1's match
		// needs client_reference_id or the account email) — refuse it BEFORE
		// Stripe takes money, with the reason.
		console.log('[check] leg 7: checkout requires sign-in');
		const coRes = await realFetch(`${base}/api/billing/checkout-session`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ planId: 'growth', billingCycle: 'monthly' }),
		});
		const coBody = await coRes.json();
		assert.strictEqual(coRes.status, 401, `signed-out checkout must be 401, got ${coRes.status}: ${JSON.stringify(coBody)}`);
		assert.strictEqual(coBody.code, 'AUTH_REQUIRED', `expected AUTH_REQUIRED, got ${JSON.stringify(coBody)}`);

		// ── Leg 8: a real non-accepted Stripe status is stored verbatim ────
		// Rex amendment: 'active' is only the MISSING-status fallback. An
		// expanded subscription reporting 'incomplete' must not be promoted.
		console.log('[check] leg 8: present-but-bad status stays verbatim');
		const ins6 = await pool.query(
			`INSERT INTO users (name, email, password_hash, role, is_paid, subscription_status)
			 VALUES ('Bad Status', 'badstatus-check@example.com', $1, 'candidate', false, NULL)
			 RETURNING id`,
			[await hashPassword('CheckPass123!')],
		);
		const user6 = ins6.rows[0].id;
		userIdForSession = user6;
		const token6 = generateToken({ id: user6, email: 'badstatus-check@example.com', role: 'candidate' });
		const badRes = await realFetch(`${base}/api/billing/confirm-session`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token6}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ session_id: 'cs_test_1843_bad' }),
		});
		const badBody = await badRes.json();
		assert.strictEqual(badBody.synced, true, `bad-status session must still sync: ${JSON.stringify(badBody)}`);
		assert.strictEqual(badBody.subscriptionStatus, 'incomplete', `response must report the real status, got '${badBody.subscriptionStatus}'`);
		const row6 = (await pool.query('SELECT subscription_status FROM users WHERE id=$1', [user6])).rows[0];
		assert.strictEqual(row6.subscription_status, 'incomplete', `stored status must stay 'incomplete', got '${row6.subscription_status}'`);

		console.log('PASS #1843: paid confirm (both paths) reads back tier pro; CV Analyze gate passes.');
	} finally {
		server.close();
		polsia.close();
		await pool.end();
		const cleanup = new Client({ connectionString: ADMIN_URL });
		await cleanup.connect();
		await cleanup.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
		await cleanup.end();
	}
	// Undici keep-alive sockets from the journey calls would otherwise hold
	// the event loop open after the verdict is printed.
	process.exit(0);
}

main().catch((err) => {
	console.error('FAIL #1843:', err.message);
	process.exit(1);
});
