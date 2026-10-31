/**
 * #2049 Slice B — HL-003 fresh-install journey for Lex's
 * person-contact ruling on POST /gdpr/export (user-perspective: a
 * candidate asks for a copy of everything Rekrut holds about them;
 * a teammate's email address and name must not ride inside that
 * copy just because an audit writer stored them in metadata, the
 * candidate's own contact details must survive, and asking for the
 * copy must not change what Rekrut holds).
 *
 * NO doubles on the path under test: a fresh throwaway Postgres
 * built ONLY by `node migrate.js`, the REAL compliance router (real
 * lib/db, real auth, real AuditLogger). Sentinel values are seeded
 * inside audit_logs.metadata in the shapes the real writers produce
 * (routes/company.js target_email / target_name / new_owner_email /
 * new_owner_name via insertAuditLog; routes/auth.js own `email`;
 * routes/company.js join-request own email/domain); the export must
 * apply Lex's Slice B rule (comment 6544914912 on #2049) to the
 * COPY, and the stored rows are read back afterwards to prove they
 * are UNMUTATED.
 *
 * Rig (this run): PostgreSQL 18.6 + pgvector 0.8.7 at
 * 127.0.0.1:55439 (fresh cluster under /home/postgres built from
 * the pgfull PGDG tree — the documented 55433 rig was down after a
 * VM restart and /home/hatch is no longer traversable by the
 * postgres user); DB `rekrut_2049` created empty and built only by
 * migrate.js (exit 0). Fixture ids derive from a per-run RUN_BASE
 * so the suite is re-runnable on the same DB (#2039/#2041 pattern).
 *
 * Example:
 *   EXPORT2049_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55439/rekrut_2049' \
 *     npx jest server/__tests__/routes/compliance-gdpr-export-metadata-realdb-2049.test.js --runInBand --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.EXPORT2049_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const RUN_BASE = 3000000 + Math.floor(Math.random() * 900000) * 10;
const U_SUBJ = RUN_BASE;
const U_OTHER = RUN_BASE + 1;
const EMAIL_SUBJ = `subj${RUN_BASE}@test.local`;
const NAME_SUBJ = 'Subject 2049 Real';
const EMAIL_THIRD = `third${RUN_BASE}@test.local`;
const NAME_THIRD = 'Third Person 2049 Real';
const EMAIL_NEWOWNER = `newowner${RUN_BASE}@test.local`;
const NAME_NEWOWNER = 'New Owner 2049 Real';
const EMAIL_BARE = `bare${RUN_BASE}@test.local`;
const EMAIL_LIST = `list${RUN_BASE}@test.local`;

const THIRD_PARTY_VALUES = [EMAIL_THIRD, NAME_THIRD, EMAIL_NEWOWNER, NAME_NEWOWNER, EMAIL_BARE, EMAIL_LIST];

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

describeIfDb('#2049 Slice B POST /gdpr/export person-contact ruling — real DB (user journey)', () => {
	let request;
	let app;
	let generateToken;

	async function cleanAndSeed() {
		const q = (sql, params) => seedPool.query(sql, params);
		for (const t of ['data_requests', 'audit_logs', 'consent_records']) {
			await q(`DELETE FROM ${t} WHERE user_id = $1`, [U_SUBJ]);
		}
		await q('DELETE FROM users WHERE id = ANY($1::int[])', [[U_SUBJ, U_OTHER]]);
		await q(
			`INSERT INTO users (id, email, password_hash, name, role)
			 VALUES ($1, $2, 'x', $3, 'candidate'), ($4, $5, 'x', 'Other 2049 Real', 'recruiter')`,
			[U_SUBJ, EMAIL_SUBJ, NAME_SUBJ, U_OTHER, EMAIL_THIRD],
		);
		// Audit row in the company.js suspend shape: the TARGET is a
		// third party; the row is the subject's (user_id = subject)
		// per the latent class Lex ruled on.
		await q(
			`INSERT INTO audit_logs (action_type, user_id, target_type, target_id, ip_address, metadata, actor_id)
			 VALUES ('recruiter_suspended', $1, 'user', $2, '203.0.113.49', $3::jsonb, $1)`,
			[
				U_SUBJ,
				U_OTHER,
				JSON.stringify({
					target_email: EMAIL_THIRD,
					target_name: NAME_THIRD,
					new_owner_email: EMAIL_NEWOWNER,
					new_owner_name: NAME_NEWOWNER,
					unrelated_key: EMAIL_BARE,
					contact_list: [EMAIL_LIST, 'plain-entry', EMAIL_SUBJ],
					name: 'A Search Label 2049',
					domain: 'example.com',
					job_id: 4242,
					new_status: 'suspended',
				}),
			],
		);
		// Audit row in the auth.js own-login shape: the subject's OWN
		// email under bare `email`, plus own target_email/target_name.
		await q(
			`INSERT INTO audit_logs (action_type, user_id, target_type, target_id, ip_address, metadata, actor_id)
			 VALUES ('oauth_google_connected', $1, 'user', $1, '203.0.113.49', $2::jsonb, $1)`,
			[
				U_SUBJ,
				JSON.stringify({
					provider: 'google',
					email: EMAIL_SUBJ,
					target_email: EMAIL_SUBJ,
					target_name: NAME_SUBJ,
				}),
			],
		);
	}

	async function exportAsSubject() {
		const token = generateToken({ id: U_SUBJ, email: EMAIL_SUBJ, role: 'candidate' });
		return request(app)
			.post('/api/compliance/gdpr/export')
			.set('Authorization', `Bearer ${token}`)
			.send({ userId: U_SUBJ });
	}

	beforeAll(async () => {
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
		await seedPool.end();
	});

	test('subject export: Slice B rule applied to the copy — no third-party contact data leaks, own data + Slice A survive', async () => {
		const res = await exportAsSubject();
		expect(res.status).toBe(200);
		const serialised = JSON.stringify(res.body);
		for (const value of THIRD_PARTY_VALUES) {
			expect(serialised).not.toContain(value);
		}
		const d = res.body.data;

		const foreign = d.audit_trail.find((r) => r.action_type === 'recruiter_suspended');
		expect(foreign.metadata).not.toHaveProperty('target_email');
		expect(foreign.metadata).not.toHaveProperty('target_name');
		expect(foreign.metadata).not.toHaveProperty('new_owner_email');
		expect(foreign.metadata).not.toHaveProperty('new_owner_name');
		expect(foreign.metadata).not.toHaveProperty('unrelated_key');
		expect(foreign.metadata.contact_list).toEqual(['plain-entry', EMAIL_SUBJ]);
		// Explicitly unchanged + Slice A.
		expect(foreign.metadata.name).toBe('A Search Label 2049');
		expect(foreign.metadata.domain).toBe('example.com');
		expect(foreign.metadata.job_id).toBe(4242);
		expect(foreign.metadata.new_status).toBe('suspended');

		const self = d.audit_trail.find((r) => r.action_type === 'oauth_google_connected');
		expect(self.metadata).toEqual({
			provider: 'google',
			email: EMAIL_SUBJ,
			target_email: EMAIL_SUBJ,
			target_name: NAME_SUBJ,
		});

		const auditNote = d.notes.find((n) => n.startsWith('Audit log metadata'));
		expect(auditNote).toBeDefined();
		for (const name of [
			'target_email', 'target_name', 'new_owner_email', 'new_owner_name',
			'unrelated_key', 'contact_list',
		]) {
			expect(auditNote).toContain(name);
		}
	});

	test('stored rows read back UNMUTATED after the export', async () => {
		await exportAsSubject();
		const audit = await seedPool.query(
			`SELECT metadata FROM audit_logs
			 WHERE user_id = $1 AND action_type = 'recruiter_suspended'`,
			[U_SUBJ],
		);
		expect(audit.rows[0].metadata.target_email).toBe(EMAIL_THIRD);
		expect(audit.rows[0].metadata.target_name).toBe(NAME_THIRD);
		expect(audit.rows[0].metadata.new_owner_email).toBe(EMAIL_NEWOWNER);
		expect(audit.rows[0].metadata.new_owner_name).toBe(NAME_NEWOWNER);
		expect(audit.rows[0].metadata.unrelated_key).toBe(EMAIL_BARE);
		expect(audit.rows[0].metadata.contact_list).toEqual([EMAIL_LIST, 'plain-entry', EMAIL_SUBJ]);
	});
});
