/**
 * #2035 [SECURITY] — HL-003 fresh-install journey for the `user`
 * section of POST /gdpr/export.
 *
 * NO doubles on the path under test: a fresh throwaway Postgres built
 * ONLY by `node migrate.js`, the REAL compliance router (real lib/db,
 * real auth, real AuditLogger). A subject row is seeded with
 * distinctive sentinel values in every excluded column
 * (password_hash, google_id, linkedin_id, oauth_provider,
 * stripe_subscription_id); none of those values — and none of those
 * key names — may appear anywhere in the serialised bundle, for the
 * subject's own export or an admin's export of the subject, while the
 * 17 allowlisted fields arrive with their seeded values.
 *
 * Rig (this run): PostgreSQL 18.6 at 127.0.0.1:55441; DB
 * `rekrut_2035` created empty and built only by migrate.js (exit 0);
 * its information_schema confirms the 22 live users columns the
 * STOP 1 classification enumerates.
 *
 * Example:
 *   EXPORT2035_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55441/rekrut_2035' \
 *     npx jest server/__tests__/routes/compliance-dsar-export-user-allowlist-realdb-2035.test.js --runInBand --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.EXPORT2035_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_SUBJ = 203501;
const U_ADMIN = 203502;
const U_FOREIGN = 203503;
const ABSENT_ID = 999999;

const SENTINELS = {
	password_hash: 'SENTINEL2035_PASSWORD_HASH_x1',
	google_id: 'SENTINEL2035_GOOGLE_ID_x2',
	linkedin_id: 'SENTINEL2035_LINKEDIN_ID_x3',
	oauth_provider: 'SENTINEL2035_OAUTH_PROVIDER_x4',
	stripe_subscription_id: 'SENTINEL2035_STRIPE_SUB_x5',
};

const EXPECTED_KEYS = [
	'avatar_url',
	'company_id',
	'company_name',
	'created_at',
	'deleted_at',
	'email',
	'github_username',
	'id',
	'is_paid',
	'linkedin_data',
	'name',
	'role',
	'subscription_plan',
	'subscription_status',
	'suspended_at',
	'title',
	'updated_at',
];

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

describeIfDb('#2035 POST /gdpr/export user allowlist — real DB (user journey)', () => {
	let request;
	let app;
	let generateToken;

	async function cleanAndSeed() {
		const q = (sql, params) => seedPool.query(sql, params);
		await q('DELETE FROM data_requests WHERE user_id = ANY($1::int[])', [
			[U_SUBJ, U_ADMIN, U_FOREIGN],
		]);
		await q('DELETE FROM audit_logs WHERE user_id = ANY($1::int[])', [
			[U_SUBJ, U_ADMIN, U_FOREIGN],
		]);
		await q('DELETE FROM users WHERE id = ANY($1::int[])', [[U_SUBJ, U_ADMIN, U_FOREIGN]]);
		await q(
			`INSERT INTO users (id, email, password_hash, name, role, company_name,
			   github_username, avatar_url, is_paid, stripe_subscription_id,
			   company_id, google_id, linkedin_id, oauth_provider,
			   linkedin_data, title, subscription_plan, subscription_status)
			 VALUES ($1, 'subj2035@test.local', $4, 'Subject 2035', 'candidate', 'Subject Co',
			   'subject-2035', 'https://example.com/a2035.png', true, $5,
			   NULL, $6, $7, $8,
			   '{"headline":"Data Analyst 2035"}'::jsonb, 'Data Analyst', 'pro', 'active'),
			  ($2, 'admin2035@test.local', $4, 'Admin 2035', 'admin', NULL,
			   NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
			  ($3, 'foreign2035@test.local', $4, 'Foreign 2035', 'candidate', NULL,
			   NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
			[
				U_SUBJ,
				U_ADMIN,
				U_FOREIGN,
				SENTINELS.password_hash,
				SENTINELS.stripe_subscription_id,
				SENTINELS.google_id,
				SENTINELS.linkedin_id,
				SENTINELS.oauth_provider,
			],
		);
	}

	beforeAll(async () => {
		// server/test/setup.js replaces DATABASE_URL with a dummy;
		// restore the real one before lib/db (and the router) load.
		Object.assign(process.env, { DATABASE_URL: DB_URL });
		await cleanAndSeed();
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

	function assertBundleSafe(body) {
		const serialised = JSON.stringify(body);
		for (const value of Object.values(SENTINELS)) {
			expect(serialised).not.toContain(value);
		}
		for (const key of Object.keys(SENTINELS)) {
			expect(serialised).not.toContain(`"${key}"`);
		}
		expect(Object.keys(body.data.user).sort()).toEqual(EXPECTED_KEYS);
		expect(body.data.user.email).toBe('subj2035@test.local');
		expect(body.data.user.name).toBe('Subject 2035');
		expect(body.data.user.github_username).toBe('subject-2035');
		expect(body.data.user.linkedin_data).toEqual({ headline: 'Data Analyst 2035' });
		expect(body.data.user.subscription_plan).toBe('pro');
		expect(body.data.user.is_paid).toBe(true);
	}

	test('subject self-export: 200, bundle carries no credential material, legit fields intact', async () => {
		const token = generateToken({ id: U_SUBJ, email: 'subj2035@test.local', role: 'candidate' });
		const res = await request(app)
			.post('/api/compliance/gdpr/export')
			.set('Authorization', `Bearer ${token}`)
			.send({ userId: U_SUBJ });
		expect(res.status).toBe(200);
		assertBundleSafe(res.body);
		// State read back: the export wrote its data_requests record.
		const { rows } = await seedPool.query(
			"SELECT request_type, status FROM data_requests WHERE user_id = $1 AND request_type = 'export'",
			[U_SUBJ],
		);
		expect(rows.length).toBeGreaterThanOrEqual(1);
	});

	test('admin export of the subject: 200 with the same safe projection', async () => {
		const token = generateToken({ id: U_ADMIN, email: 'admin2035@test.local', role: 'admin' });
		const res = await request(app)
			.post('/api/compliance/gdpr/export')
			.set('Authorization', `Bearer ${token}`)
			.send({ userId: U_SUBJ });
		expect(res.status).toBe(200);
		assertBundleSafe(res.body);
	});

	test('admin export of a non-existent user: 404', async () => {
		const token = generateToken({ id: U_ADMIN, email: 'admin2035@test.local', role: 'admin' });
		const res = await request(app)
			.post('/api/compliance/gdpr/export')
			.set('Authorization', `Bearer ${token}`)
			.send({ userId: ABSENT_ID });
		expect(res.status).toBe(404);
	});

	test('foreign non-admin export: 403', async () => {
		const token = generateToken({
			id: U_FOREIGN,
			email: 'foreign2035@test.local',
			role: 'candidate',
		});
		const res = await request(app)
			.post('/api/compliance/gdpr/export')
			.set('Authorization', `Bearer ${token}`)
			.send({ userId: U_SUBJ });
		expect(res.status).toBe(403);
	});
});
