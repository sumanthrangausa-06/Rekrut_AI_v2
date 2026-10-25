/**
 * #1853 — runnable journey check (not jest/playwright; needs real Postgres).
 *
 * Founder ruling 2026-10-25 (Option b): Candidate Pro STAYS. User journey
 * under test, over real HTTP against the real routers and a real
 * (fresh-migrated) Postgres:
 *   free candidate -> CV Review gate refuses (403 UPGRADE_REQUIRED)
 *   -> GET /billing/plans offers a CANDIDATE plan (id 'pro', $19/mo,
 *      $190/yr, audience 'candidate') alongside the recruiter plans
 *      (audience 'recruiter')
 *   -> POST /billing/checkout-session for 'pro' reaches the Stripe door
 *      with the plan's own amount and plan_id metadata (same mechanism
 *      as starter/growth)
 *   -> POST /billing/confirm-session (Stripe return, plan 'pro') syncs
 *   -> GET /billing/tier reads back 'pro' with cv_review allowed
 *   -> POST /candidate/cv/analyze passes the Pro gate (400 NO_DOCUMENT —
 *      the honest next state — NOT 403 UPGRADE_REQUIRED)
 *   and a recruiter regression leg: team plans are still offered and a
 *   growth checkout still reaches the door at its own amount.
 *
 * The ONLY stub is the external Stripe transport (global fetch to
 * api.stripe.com), at its network boundary, in the same pattern as
 * tests/billing-pro-confirm-1843.check.js: checkout POSTs are captured
 * and answered with a session URL; the confirm GET returns Stripe's
 * default UNEXPANDED session shape with metadata plan_id 'pro'.
 * The live Stripe hosted checkout page itself cannot run locally and
 * is NOT claimed here.
 *
 * Run: node tests/billing-candidate-pro-1853.check.js
 * Expects Postgres at 127.0.0.1:55433 (superuser postgres, no password);
 * creates/drops its own scratch database `rekrut_1853_check` and runs
 * the real migrate.js against it.
 */
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const ADMIN_URL = 'postgresql://postgres@127.0.0.1:55433/postgres';
const DB_NAME = 'rekrut_1853_check';
const DB_URL = `postgresql://postgres@127.0.0.1:55433/${DB_NAME}`;

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

	process.env.DATABASE_URL = DB_URL;
	process.env.JWT_SECRET = 'check-secret-1853';
	process.env.STRIPE_SECRET_KEY = 'sk_test_1853_stubbed_transport';

	const realFetch = global.fetch;
	let userIdForSession = null;
	const checkoutBodies = [];
	global.fetch = async (url, opts) => {
		const u = String(url);
		if (u.startsWith('https://api.stripe.com/')) {
			if (opts?.method === 'POST' && u.includes('/checkout/sessions')) {
				const params = new URLSearchParams(opts.body);
				checkoutBodies.push(params);
				const session = { id: 'cs_test_1853', url: 'https://checkout.stripe.test/cs_test_1853' };
				return {
					ok: true,
					status: 200,
					json: async () => session,
					text: async () => JSON.stringify(session),
				};
			}
			const session = {
				id: 'cs_test_1853',
				status: 'complete',
				payment_status: 'paid',
				client_reference_id: String(userIdForSession),
				customer_email: 'candidate-check@example.com',
				metadata: { plan_id: 'pro', billing_cycle: 'monthly' },
				subscription: 'sub_1853_unexpanded',
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
		 VALUES ('Candidate Check', 'candidate-check@example.com', $1, 'candidate', false, NULL)
		 RETURNING id`,
		[await hashPassword('CheckPass123!')],
	);
	const userId = ins.rows[0].id;
	userIdForSession = userId;
	const token = generateToken({ id: userId, email: 'candidate-check@example.com', role: 'candidate' });
	const authH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

	const app = express();
	app.use(express.json());
	app.use('/api/billing', require('../routes/billing'));
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
		// ── Leg 1: the plans a candidate's Upgrade click can actually buy ──
		console.log('[check] leg 1: plans carry a candidate Pro plan');
		const plansRes = await call('GET', '/api/billing/plans', undefined, {
			'Content-Type': 'application/json',
		});
		const plansBody = await plansRes.json();
		assert.strictEqual(plansRes.status, 200, `plans HTTP ${plansRes.status}`);
		const byId = Object.fromEntries(plansBody.plans.map((p) => [p.id, p]));
		const pro = byId.pro;
		assert.ok(pro, `plans must include a candidate plan with id 'pro', got ${JSON.stringify(plansBody.plans.map((p) => p.id))}`);
		assert.strictEqual(pro.audience, 'candidate', `pro plan audience must be 'candidate', got '${pro.audience}'`);
		assert.strictEqual(pro.monthlyAmount, 1900, `pro monthly must be $19 (1900), got ${pro.monthlyAmount}`);
		assert.strictEqual(pro.yearlyAmount, 19000, `pro yearly must be $190 (19000), got ${pro.yearlyAmount}`);
		for (const feature of ['CV Review', 'LinkedIn Optimizer', 'Career Diagnosis', 'Recruiter Intros', 'Top Matches']) {
			assert.ok(pro.features.includes(feature), `pro features must include '${feature}' (FEATURE_MATRIX Pro column)`);
		}
		for (const id of ['starter', 'growth', 'enterprise']) {
			assert.ok(byId[id], `recruiter plan '${id}' must still be offered`);
			assert.strictEqual(byId[id].audience, 'recruiter', `'${id}' audience must be 'recruiter', got '${byId[id].audience}'`);
		}

		// ── Leg 2: free candidate hits the Pro gate first (the complaint) ──
		console.log('[check] leg 2: free candidate is gated before payment');
		const gateRes = await call('POST', '/api/candidate/cv/analyze', {});
		const gate = await gateRes.json();
		assert.strictEqual(gateRes.status, 403, `free candidate must be gated, got ${gateRes.status}`);
		assert.strictEqual(gate.code, 'UPGRADE_REQUIRED', `expected UPGRADE_REQUIRED, got ${JSON.stringify(gate)}`);

		// ── Leg 3: checkout door for 'pro' — same mechanism, plan's amount ─
		console.log('[check] leg 3: pro checkout reaches the Stripe door at $19');
		const coRes = await call('POST', '/api/billing/checkout-session', {
			planId: 'pro',
			billingCycle: 'monthly',
		});
		const co = await coRes.json();
		assert.strictEqual(coRes.status, 200, `checkout HTTP ${coRes.status}: ${JSON.stringify(co)}`);
		assert.ok(co.url, 'checkout must return a Stripe session URL');
		const sent = checkoutBodies[checkoutBodies.length - 1];
		assert.strictEqual(sent.get('metadata[plan_id]'), 'pro', 'checkout metadata must carry plan_id pro');
		assert.strictEqual(sent.get('line_items[0][price_data][unit_amount]'), '1900', 'monthly pro checkout must charge 1900');
		assert.strictEqual(sent.get('client_reference_id'), String(userId), 'checkout must be linked to the account (#1843 guard)');

		const coYearRes = await call('POST', '/api/billing/checkout-session', {
			planId: 'pro',
			billingCycle: 'yearly',
		});
		assert.strictEqual(coYearRes.status, 200, `yearly checkout HTTP ${coYearRes.status}`);
		const sentYear = checkoutBodies[checkoutBodies.length - 1];
		assert.strictEqual(sentYear.get('line_items[0][price_data][unit_amount]'), '19000', 'yearly pro checkout must charge 19000');

		// ── Leg 4: confirm with plan 'pro' syncs and the tier unlocks ──────
		console.log('[check] leg 4: confirm-session (plan pro) unlocks the tier');
		const confirmRes = await call('POST', '/api/billing/confirm-session', { session_id: 'cs_test_1853' });
		const confirm = await confirmRes.json();
		assert.strictEqual(confirmRes.status, 200, `confirm HTTP ${confirmRes.status}: ${JSON.stringify(confirm)}`);
		assert.strictEqual(confirm.verified, true, 'session must verify as paid');
		assert.strictEqual(confirm.synced, true, 'paid pro session must sync to the signed-in user');
		assert.strictEqual(confirm.planId, 'pro', `confirm must report plan 'pro', got '${confirm.planId}'`);
		const row = (
			await pool.query('SELECT is_paid, subscription_plan, subscription_status FROM users WHERE id=$1', [userId])
		).rows[0];
		assert.strictEqual(row.is_paid, true, 'is_paid must be true after confirm');
		assert.strictEqual(row.subscription_plan, 'pro', `stored plan must be 'pro', got '${row.subscription_plan}'`);
		assert.ok(
			['active', 'trialing'].includes(row.subscription_status),
			`subscription_status must be one the tier gate accepts, got '${row.subscription_status}'`,
		);

		const tierRes = await call('GET', '/api/billing/tier');
		const tier = await tierRes.json();
		assert.strictEqual(tier.tier, 'pro', `tier must read back 'pro' after pro confirm, got '${tier.tier}'`);
		assert.strictEqual(tier.plan, 'pro', `tier summary plan must be 'pro', got '${tier.plan}'`);
		const cv = tier.features.find((f) => f.feature === 'cv_review');
		assert.ok(cv?.allowed, 'cv_review must be allowed for the pro tier');

		// ── Leg 5: the gate the founder hit now passes ─────────────────────
		console.log('[check] leg 5: CV Analyze passes the gate after Pro');
		const analyzeRes = await call('POST', '/api/candidate/cv/analyze', {});
		const analyze = await analyzeRes.json();
		assert.notStrictEqual(analyze.code, 'UPGRADE_REQUIRED', 'paid pro candidate must not hit the Pro gate');
		assert.strictEqual(analyzeRes.status, 400, `expected honest NO_DOCUMENT 400, got ${analyzeRes.status}`);
		assert.strictEqual(analyze.code, 'NO_DOCUMENT', `expected NO_DOCUMENT, got ${JSON.stringify(analyze)}`);

		// ── Leg 6: recruiter regression — team plans + growth checkout ────
		console.log('[check] leg 6: recruiter plans and checkout unchanged');
		const insR = await pool.query(
			`INSERT INTO users (name, email, password_hash, role, is_paid, subscription_status)
			 VALUES ('Recruiter Check', 'recruiter-check@example.com', $1, 'recruiter', false, NULL)
			 RETURNING id`,
			[await hashPassword('CheckPass123!')],
		);
		const recToken = generateToken({
			id: insR.rows[0].id,
			email: 'recruiter-check@example.com',
			role: 'recruiter',
		});
		const growthRes = await realFetch(`${base}/api/billing/checkout-session`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${recToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ planId: 'growth', billingCycle: 'monthly' }),
		});
		assert.strictEqual(growthRes.status, 200, `growth checkout HTTP ${growthRes.status}`);
		const sentGrowth = checkoutBodies[checkoutBodies.length - 1];
		assert.strictEqual(sentGrowth.get('metadata[plan_id]'), 'growth', 'growth checkout must carry plan_id growth');
		assert.strictEqual(sentGrowth.get('line_items[0][price_data][unit_amount]'), '7900', 'growth checkout must still charge 7900');

		// Audience is enforced at the purchase door, not just in the page:
		// a recruiter account cannot buy the candidate plan.
		const recProRes = await realFetch(`${base}/api/billing/checkout-session`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${recToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ planId: 'pro', billingCycle: 'monthly' }),
		});
		const recPro = await recProRes.json();
		assert.strictEqual(recProRes.status, 403, `recruiter buying 'pro' must be 403, got ${recProRes.status}`);
		assert.strictEqual(recPro.code, 'PLAN_AUDIENCE_MISMATCH', `expected PLAN_AUDIENCE_MISMATCH, got ${JSON.stringify(recPro)}`);

		// ── Leg 7: negative legs for the new surface ─────────────────────
		console.log('[check] leg 7: negative legs (free / signed-out / spoof / cross-audience)');
		const freeRes = await call('POST', '/api/billing/checkout-session', { planId: 'free', billingCycle: 'monthly' });
		assert.strictEqual(freeRes.status, 400, `the client-rendered Free tier must not be purchasable, got ${freeRes.status}`);

		const anonRes = await realFetch(`${base}/api/billing/checkout-session`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ planId: 'pro', billingCycle: 'monthly' }),
		});
		const anon = await anonRes.json();
		assert.strictEqual(anonRes.status, 401, `signed-out pro checkout must be 401, got ${anonRes.status}`);
		assert.strictEqual(anon.code, 'AUTH_REQUIRED', `expected AUTH_REQUIRED, got ${JSON.stringify(anon)}`);

		const candGrowthRes = await call('POST', '/api/billing/checkout-session', { planId: 'growth', billingCycle: 'monthly' });
		assert.strictEqual(candGrowthRes.status, 403, `candidate buying 'growth' must be 403, got ${candGrowthRes.status}`);

		// A spoofed body cannot change the price or the audience: extra
		// amount/audience fields are ignored, the server plan decides.
		const spoofRes = await call('POST', '/api/billing/checkout-session', {
			planId: 'pro',
			billingCycle: 'monthly',
			amount: 1,
			audience: 'recruiter',
		});
		assert.strictEqual(spoofRes.status, 200, `spoof-body checkout HTTP ${spoofRes.status}`);
		const sentSpoof = checkoutBodies[checkoutBodies.length - 1];
		assert.strictEqual(sentSpoof.get('line_items[0][price_data][unit_amount]'), '1900', 'spoofed amount must not change the charge');
		assert.strictEqual(sentSpoof.get('metadata[plan_id]'), 'pro', 'spoofed audience must not change the plan');

		console.log('PASS #1853: candidate Pro plan offered, checkout at $19/$190, confirm unlocks tier pro + CV gate; recruiter plans unchanged.');
	} finally {
		server.close();
		await pool.end();
		const cleanup = new Client({ connectionString: ADMIN_URL });
		await cleanup.connect();
		await cleanup.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
		await cleanup.end();
	}
	process.exit(0);
}

main().catch((err) => {
	console.error('FAIL #1853:', err.message);
	process.exit(1);
});
