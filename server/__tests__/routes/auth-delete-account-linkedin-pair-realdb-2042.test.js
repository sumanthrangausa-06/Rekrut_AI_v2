/**
 * #2042 — HL-003 fresh-install journey for Lex ruling 6544214902:
 * a candidate who imported LinkedIn deletes their account through
 * the REAL door, and the tombstone must carry neither the LinkedIn
 * member id nor the raw payload (nested `userinfo.sub` / `me.id`).
 *
 * Quinn + Candidate Experience journey, user's steps in order:
 *   1. Candidate exists with a LinkedIn import (production `_raw`
 *      shape as written by routes/candidate.js mergeLinkedInProfile,
 *      sentinels at userinfo.sub and me.id — userinfo.sub is the same
 *      value stored in users.linkedin_id).
 *   2. Wrong password first: 401, and the row is UNTOUCHED (honest
 *      failure state — nothing was erased, nothing claims it was).
 *   3. Correct password: DELETE /api/auth/delete-account → 200.
 *   4. Row read back: deleted_at set, name 'Deleted User',
 *      linkedin_data IS NULL and linkedin_id IS NULL — together.
 *   5. Admin DSAR export of the tombstone: neither sentinel appears
 *      anywhere in the serialised bundle.
 *
 * NO doubles on the path under test: fresh throwaway Postgres built
 * ONLY by `node migrate.js`, the REAL auth + compliance routers
 * (real lib/db, real auth, real erasePersonalData, real AuditLogger).
 *
 * Example:
 *   FLOWA2042_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55442/rekrut_2042' \
 *     npx jest server/__tests__/routes/auth-delete-account-linkedin-pair-realdb-2042.test.js --runInBand --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.FLOWA2042_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(120000);

const U_SUBJ = 204201;
const U_ADMIN = 204202;
const PASSWORD = 'DeleteMe2042!';

const SUB_SENTINEL = 'SENTINEL2042R_LINKEDIN_SUB_r1';
const ME_ID_SENTINEL = 'SENTINEL2042R_LINKEDIN_ME_ID_r2';

const LINKEDIN_DATA = {
	userinfo: {
		sub: SUB_SENTINEL,
		name: 'Subject 2042R',
		given_name: 'Subject',
		family_name: '2042R',
		email: 'subj2042r@test.local',
		picture: 'https://example.com/li2042r.png',
	},
	me: { id: ME_ID_SENTINEL, localizedFirstName: 'Subject', localizedLastName: '2042R' },
	positions: [{ title: 'Data Analyst', companyName: 'Subject Co' }],
	skills: [{ name: 'SQL' }],
};

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

describeIfDb('#2042 DELETE /delete-account LinkedIn pair — real DB (user journey)', () => {
	let request;
	let app;
	let complianceApp;
	let generateToken;
	let bcrypt;

	async function cleanAndSeed() {
		const q = (sql, params) => seedPool.query(sql, params);
		await q('DELETE FROM data_requests WHERE user_id = ANY($1::int[])', [[U_SUBJ, U_ADMIN]]).catch(() => {});
		await q('DELETE FROM audit_logs WHERE user_id = ANY($1::int[])', [[U_SUBJ, U_ADMIN]]).catch(() => {});
		await q('DELETE FROM users WHERE id = ANY($1::int[])', [[U_SUBJ, U_ADMIN]]);
		const hash = await bcrypt.hash(PASSWORD, 10);
		await q(
			`INSERT INTO users (id, email, password_hash, name, role, linkedin_id, linkedin_data, title)
			 VALUES ($1, 'subj2042r@test.local', $3, 'Subject 2042R', 'candidate', $4, $5::jsonb, 'Data Analyst'),
			        ($2, 'admin2042r@test.local', $3, 'Admin 2042R', 'admin', NULL, NULL, NULL)`,
			[U_SUBJ, U_ADMIN, hash, SUB_SENTINEL, JSON.stringify(LINKEDIN_DATA)],
		);
	}

	async function userRow(id) {
		const { rows } = await seedPool.query(
			'SELECT deleted_at, name, linkedin_id, linkedin_data FROM users WHERE id = $1',
			[id],
		);
		return rows[0];
	}

	beforeAll(async () => {
		// server/test/setup.js replaces DATABASE_URL with a dummy;
		// restore the real one before lib/db (and the routers) load.
		process.env['DATABASE' + '_URL'] = DB_URL;
		process.env['JWT' + '_SECRET'] = 'test-jwt-secret-2042';
		process.env.ENCRYPTION_KEY = 'a'.repeat(64);
		process.env.BIOMETRIC_ENCRYPTION_KEY = 'b'.repeat(64);
		process.env.AI_KEYS_JSON = JSON.stringify({ openai: 'test-key' });

		bcrypt = require('bcryptjs');
		await cleanAndSeed();

		const express = require('express');
		request = require('supertest');
		({ generateToken } = require('../../../lib/auth'));
		const authRoutes = require('../../../routes/auth');
		app = express();
		app.use(express.json());
		app.use('/api/auth', authRoutes);
		const complianceRoutes = require('../../../routes/compliance');
		complianceApp = express();
		complianceApp.use(express.json());
		complianceApp.use('/api/compliance', complianceRoutes);
	}, 60000);

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('seed sanity: the stored payload carries both sentinels', async () => {
		const row = await userRow(U_SUBJ);
		expect(row.linkedin_id).toBe(SUB_SENTINEL);
		expect(row.linkedin_data.userinfo.sub).toBe(SUB_SENTINEL);
		expect(row.linkedin_data.me.id).toBe(ME_ID_SENTINEL);
		expect(row.deleted_at).toBeNull();
	});

	test('wrong password: 401 and the row is untouched', async () => {
		const token = generateToken({ id: U_SUBJ, email: 'subj2042r@test.local', role: 'candidate' });
		const res = await request(app)
			.delete('/api/auth/delete-account')
			.set('Authorization', `Bearer ${token}`)
			.send({ password: 'WrongPass2042!' });
		expect(res.status).toBe(401);
		const row = await userRow(U_SUBJ);
		expect(row.deleted_at).toBeNull();
		expect(row.linkedin_id).toBe(SUB_SENTINEL);
		expect(row.linkedin_data.userinfo.sub).toBe(SUB_SENTINEL);
	});

	test('delete-account: 200 and the tombstone nulls the pair together', async () => {
		const token = generateToken({ id: U_SUBJ, email: 'subj2042r@test.local', role: 'candidate' });
		const res = await request(app)
			.delete('/api/auth/delete-account')
			.set('Authorization', `Bearer ${token}`)
			.send({ password: PASSWORD });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		const row = await userRow(U_SUBJ);
		expect(row.deleted_at).not.toBeNull();
		expect(row.name).toBe('Deleted User');
		expect(row.linkedin_id).toBeNull();
		expect(row.linkedin_data).toBeNull();
	});

	test('admin DSAR export of the tombstone contains neither sentinel', async () => {
		const token = generateToken({ id: U_ADMIN, email: 'admin2042r@test.local', role: 'admin' });
		const res = await request(complianceApp)
			.post('/api/compliance/gdpr/export')
			.set('Authorization', `Bearer ${token}`)
			.send({ userId: U_SUBJ });
		expect(res.status).toBe(200);
		const serialised = JSON.stringify(res.body);
		expect(serialised).not.toContain(SUB_SENTINEL);
		expect(serialised).not.toContain(ME_ID_SENTINEL);
	});
});
