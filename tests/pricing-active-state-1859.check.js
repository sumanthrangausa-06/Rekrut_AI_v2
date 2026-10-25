/**
 * #1859 — runnable E2E check (not jest/playwright; needs real Postgres).
 *
 * User journey under test, over real HTTP against the real billing
 * router and a real (fresh-migrated) Postgres: a candidate who already
 * pays for Pro loads /pricing on a clean visit (no ?success params).
 * The two API reads the fixed UI keys off must tell the truth:
 *   - GET /billing/subscription-status (the call the pricing page now
 *     makes, same as the Settings billing panel) — for the seeded
 *     active-Pro candidate: isPaid true, plan 'pro', status 'active';
 *     for the free candidate: not paid / tier 'free'; for an active
 *     Growth recruiter: plan 'growth' (the recruiter mirror); for a
 *     paid-but-cancelled candidate: status 'cancelled', tier 'free'
 *     (the UI must NOT claim a current plan).
 *   - GET /billing/plans still serves the plan ids ('pro', 'starter',
 *     'growth') the page compares subscription-status.plan against.
 *   - GET /billing/tier (what the auth context loads into
 *     user.subscriptionTier — the sidebar CTA's data source) reports
 *     'pro' for the Pro candidate and 'free' for the free candidate.
 * The rendered branches themselves are covered by the vitest render
 * tests (PricingRoleAware1853.test.tsx, SidebarUpgradeCta1859.test.tsx).
 *
 * Run: node tests/pricing-active-state-1859.check.js
 * Expects Postgres at 127.0.0.1:55433 (superuser postgres, no password;
 * override the port with CHECK_PG_PORT);
 * creates/drops its own scratch database `nova1859_e2e` and runs the
 * real migrate.js against it.
 */
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const PG_PORT = process.env.CHECK_PG_PORT || '55433';
const ADMIN_URL = `postgresql://postgres@127.0.0.1:${PG_PORT}/postgres`;
const DB_NAME = 'nova1859_e2e';
const DB_URL = `postgresql://postgres@127.0.0.1:${PG_PORT}/${DB_NAME}`;

// The pricing page's current-plan predicate (#1859), applied to API data.
const isCurrentPlan = (status, planId) =>
	!!status?.isPaid &&
	(status.status === 'active' || status.status === 'trialing') &&
	status.plan === planId;

async function main() {
	const admin = new Client({ connectionString: ADMIN_URL });
	await admin.connect();
	await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
	await admin.query(`CREATE DATABASE ${DB_NAME}`);
	await admin.end();
	console.log(`[check] scratch database ${DB_NAME} created`);

	execFileSync('node', ['migrate.js'], {
		cwd: require('node:path').join(__dirname, '..'),
		env: { ...process.env, DATABASE_URL: DB_URL },
		stdio: 'pipe',
		timeout: 600000,
	});
	console.log('[check] migrate.js on fresh DB: exit 0');

	process.env.DATABASE_URL = DB_URL;
	process.env.JWT_SECRET = 'check-1859-secret-not-real';
	process.env.STRIPE_SECRET_KEY = 'sk_test_1859_unused_no_stripe_calls';

	const express = require('express');
	const pool = require('../lib/db');
	const { generateToken, hashPassword } = require('../lib/auth');
	const pw = await hashPassword('CheckPass123!');

	async function seed(email, role, fields) {
		const ins = await pool.query(
			`INSERT INTO users (name, email, password_hash, role, is_paid, stripe_subscription_id, subscription_plan, subscription_status)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
			[email.split('@')[0], email, pw, role, fields.is_paid, fields.sub || null, fields.plan || null, fields.status || null],
		);
		const id = ins.rows[0].id;
		return {
			id,
			headers: {
				Authorization: `Bearer ${generateToken({ id, email, role })}`,
				'Content-Type': 'application/json',
			},
		};
	}

	const freeCand = await seed('free-cand@example.com', 'candidate', { is_paid: false });
	const proCand = await seed('pro-cand@example.com', 'candidate', {
		is_paid: true, sub: 'sub_1859_e2e', plan: 'pro', status: 'active',
	});
	const growthRec = await seed('growth-rec@example.com', 'recruiter', {
		is_paid: true, sub: 'sub_1859_growth', plan: 'growth', status: 'active',
	});
	const cancelledCand = await seed('cancelled-cand@example.com', 'candidate', {
		is_paid: true, sub: 'sub_1859_cancelled', plan: 'pro', status: 'cancelled',
	});
	console.log('[check] seeded free/pro/growth/cancelled users');

	const app = express();
	app.use(express.json());
	app.use('/api/billing', require('../routes/billing'));
	const server = await new Promise((r) => {
		const s = app.listen(0, '127.0.0.1', () => r(s));
	});
	const base = `http://127.0.0.1:${server.address().port}`;
	const get = async (path, headers) => {
		const res = await fetch(`${base}${path}`, { headers });
		return { status: res.status, body: await res.json() };
	};

	// Leg 1: plans still serve the ids the UI compares against.
	const plans = await get('/api/billing/plans', freeCand.headers);
	assert.strictEqual(plans.status, 200, `plans status ${plans.status}`);
	const planIds = plans.body.plans.map((p) => p.id);
	for (const id of ['pro', 'starter', 'growth']) {
		assert.ok(planIds.includes(id), `plans must include '${id}', got ${planIds}`);
	}
	console.log(`[check] leg 1 PASS: /billing/plans ids = ${planIds.join(', ')}`);

	// Leg 2: active Pro candidate — subscription-status tells the truth.
	const proStatus = await get('/api/billing/subscription-status', proCand.headers);
	assert.strictEqual(proStatus.status, 200);
	assert.strictEqual(proStatus.body.isPaid, true, `pro isPaid: ${JSON.stringify(proStatus.body)}`);
	assert.strictEqual(proStatus.body.plan, 'pro');
	assert.strictEqual(proStatus.body.status, 'active');
	assert.strictEqual(proStatus.body.tier, 'pro');
	assert.strictEqual(proStatus.body.isPro, true);
	assert.strictEqual(isCurrentPlan(proStatus.body, 'pro'), true, 'pro card must be current for Pro candidate');
	console.log(`[check] leg 2 PASS: pro candidate subscription-status = ${JSON.stringify(proStatus.body)}`);

	// Leg 3: free candidate — no current plan, checkout stays.
	const freeStatus = await get('/api/billing/subscription-status', freeCand.headers);
	assert.strictEqual(freeStatus.status, 200);
	assert.strictEqual(freeStatus.body.isPaid, false);
	assert.strictEqual(freeStatus.body.tier, 'free');
	assert.strictEqual(isCurrentPlan(freeStatus.body, 'pro'), false, 'free candidate must NOT see a current Pro plan');
	console.log(`[check] leg 3 PASS: free candidate subscription-status = ${JSON.stringify(freeStatus.body)}`);

	// Leg 4: recruiter mirror — active Growth plan is current, Starter is not.
	const growthStatus = await get('/api/billing/subscription-status', growthRec.headers);
	assert.strictEqual(growthStatus.body.plan, 'growth');
	assert.strictEqual(growthStatus.body.status, 'active');
	assert.strictEqual(isCurrentPlan(growthStatus.body, 'growth'), true);
	assert.strictEqual(isCurrentPlan(growthStatus.body, 'starter'), false);
	console.log(`[check] leg 4 PASS: growth recruiter subscription-status = ${JSON.stringify(growthStatus.body)}`);

	// Leg 5: paid-but-cancelled — NOT a current plan (honest state).
	const cancelledStatus = await get('/api/billing/subscription-status', cancelledCand.headers);
	assert.strictEqual(cancelledStatus.body.status, 'cancelled');
	assert.strictEqual(cancelledStatus.body.tier, 'free');
	assert.strictEqual(isCurrentPlan(cancelledStatus.body, 'pro'), false);
	console.log(`[check] leg 5 PASS: cancelled candidate subscription-status = ${JSON.stringify(cancelledStatus.body)}`);

	// Leg 6: /billing/tier — the sidebar CTA's data source via auth context.
	const proTier = await get('/api/billing/tier', proCand.headers);
	const freeTier = await get('/api/billing/tier', freeCand.headers);
	assert.strictEqual(proTier.body.tier, 'pro', `pro tier: ${JSON.stringify(proTier.body)}`);
	assert.strictEqual(freeTier.body.tier, 'free', `free tier: ${JSON.stringify(freeTier.body)}`);
	console.log(`[check] leg 6 PASS: /billing/tier pro='${proTier.body.tier}' free='${freeTier.body.tier}' (sidebar keys off subscriptionTier)`);

	// Leg 7: unauthenticated subscription-status is refused, not faked.
	const anon = await get('/api/billing/subscription-status', {});
	assert.strictEqual(anon.status, 401, `anon subscription-status must be 401, got ${anon.status}`);
	console.log('[check] leg 7 PASS: unauthenticated subscription-status -> 401');

	server.close();
	await pool.end();
	const cleanup = new Client({ connectionString: ADMIN_URL });
	await cleanup.connect();
	await cleanup.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
	await cleanup.end();
	console.log(`[check] scratch database ${DB_NAME} dropped`);
	console.log('[check] ALL LEGS PASS — #1859 E2E gate');
}

main().catch((err) => {
	console.error('[check] FAIL:', err);
	process.exit(1);
});
