/**
 * #2037 — HL-003 fresh-install journey for the nested LinkedIn
 * identifier strip in POST /gdpr/export.
 *
 * NO doubles on the path under test: a fresh throwaway Postgres built
 * ONLY by `node migrate.js`, the REAL compliance router (real lib/db,
 * real auth, real AuditLogger). The subject's `linkedin_data` column
 * is seeded with the production `_raw` shape (as written by
 * routes/candidate.js mergeLinkedInProfile), carrying distinctive
 * sentinels at `userinfo.sub` and `me.id` — the same member
 * identifier stored in `users.linkedin_id`. Neither sentinel may
 * appear anywhere in the serialised bundle (self export or admin
 * export), the rest of the imported payload must survive, and the
 * stored row must read back unmutated.
 *
 * Example:
 *   EXPORT2037_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55442/rekrut_2037' \
 *     npx jest server/__tests__/routes/compliance-dsar-export-linkedin-sub-realdb-2037.test.js --runInBand --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.EXPORT2037_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_SUBJ = 203701;
const U_ADMIN = 203702;

const SUB_SENTINEL = 'SENTINEL2037R_LINKEDIN_SUB_r1';
const ME_ID_SENTINEL = 'SENTINEL2037R_LINKEDIN_ME_ID_r2';

const LINKEDIN_DATA = {
	userinfo: {
		sub: SUB_SENTINEL,
		name: 'Subject 2037R',
		given_name: 'Subject',
		family_name: '2037R',
		email: 'subj2037r@test.local',
		picture: 'https://example.com/li2037r.png',
	},
	me: { id: ME_ID_SENTINEL, localizedFirstName: 'Subject', localizedLastName: '2037R' },
	positions: [{ title: 'Data Analyst', companyName: 'Subject Co' }],
	educations: [{ schoolName: 'Example University' }],
	skills: [{ name: 'SQL' }],
};

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

describeIfDb('#2037 POST /gdpr/export nested LinkedIn strip — real DB (user journey)', () => {
	let request;
	let app;
	let generateToken;

	async function cleanAndSeed() {
		const q = (sql, params) => seedPool.query(sql, params);
		await q('DELETE FROM data_requests WHERE user_id = ANY($1::int[])', [[U_SUBJ, U_ADMIN]]);
		await q('DELETE FROM audit_logs WHERE user_id = ANY($1::int[])', [[U_SUBJ, U_ADMIN]]);
		await q('DELETE FROM users WHERE id = ANY($1::int[])', [[U_SUBJ, U_ADMIN]]);
		await q(
			`INSERT INTO users (id, email, password_hash, name, role, linkedin_id, linkedin_data, title)
			 VALUES ($1, 'subj2037r@test.local', 'x', 'Subject 2037R', 'candidate', $3, $4::jsonb, 'Data Analyst'),
			        ($2, 'admin2037r@test.local', 'x', 'Admin 2037R', 'admin', NULL, NULL, NULL)`,
			[U_SUBJ, U_ADMIN, SUB_SENTINEL, JSON.stringify(LINKEDIN_DATA)],
		);
	}

	beforeAll(async () => {
		// server/test/setup.js replaces DATABASE_URL with a dummy;
		// restore the real one before lib/db (and the router) load.
		process.env.DATABASE_URL = DB_URL;
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

	function assertBundleStripped(body) {
		const serialised = JSON.stringify(body);
		expect(serialised).not.toContain(SUB_SENTINEL);
		expect(serialised).not.toContain(ME_ID_SENTINEL);
		const ld = body.data.user.linkedin_data;
		expect(ld.userinfo).not.toHaveProperty('sub');
		expect(ld.me).not.toHaveProperty('id');
		expect(ld.userinfo.name).toBe('Subject 2037R');
		expect(ld.positions).toEqual([{ title: 'Data Analyst', companyName: 'Subject Co' }]);
		expect(ld.skills).toEqual([{ name: 'SQL' }]);
	}

	test('subject self-export: 200, nested identifier stripped, payload intact', async () => {
		const token = generateToken({ id: U_SUBJ, email: 'subj2037r@test.local', role: 'candidate' });
		const res = await request(app)
			.post('/api/compliance/gdpr/export')
			.set('Authorization', `Bearer ${token}`)
			.send({ userId: U_SUBJ });
		expect(res.status).toBe(200);
		assertBundleStripped(res.body);
	});

	test('admin export of the subject: 200 with the same strip', async () => {
		const token = generateToken({ id: U_ADMIN, email: 'admin2037r@test.local', role: 'admin' });
		const res = await request(app)
			.post('/api/compliance/gdpr/export')
			.set('Authorization', `Bearer ${token}`)
			.send({ userId: U_SUBJ });
		expect(res.status).toBe(200);
		assertBundleStripped(res.body);
	});

	test('stored row reads back unmutated after both exports', async () => {
		const { rows } = await seedPool.query('SELECT linkedin_data FROM users WHERE id = $1', [U_SUBJ]);
		expect(rows[0].linkedin_data.userinfo.sub).toBe(SUB_SENTINEL);
		expect(rows[0].linkedin_data.me.id).toBe(ME_ID_SENTINEL);
	});
});
