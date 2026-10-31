/**
 * #2046 — HL-003 fresh-install journey for Lex's metadata / FK ruling
 * on POST /gdpr/export (user-perspective: a candidate asks for a copy
 * of everything Rekrut holds about them; another person's id, notes
 * and secrets must not ride inside that copy, and asking for the copy
 * must not change what Rekrut holds).
 *
 * NO doubles on the path under test: a fresh throwaway Postgres built
 * ONLY by `node migrate.js`, the REAL compliance router (real lib/db,
 * real auth, real AuditLogger). Sentinel values are seeded inside
 * consent_records.metadata / revocation_reason / revoked_by and
 * audit_logs.metadata / actor_id; the export must apply Lex's rule
 * (comment 6544214655 on #2046) to the COPY, and the stored rows are
 * read back afterwards to prove they are UNMUTATED.
 *
 * Rig (this run): PostgreSQL at 127.0.0.1:55433; DB `rekrut_2046`
 * created empty and built only by migrate.js (exit 0). Fixture ids
 * derive from a per-run RUN_BASE so the suite is re-runnable on the
 * same DB (#2039/#2041 pattern).
 *
 * Example:
 *   EXPORT2046_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/rekrut_2046' \
 *     npx jest server/__tests__/routes/compliance-gdpr-export-metadata-realdb-2046.test.js --runInBand --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.EXPORT2046_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const RUN_BASE = 2000000 + Math.floor(Math.random() * 900000) * 10;
const U_SUBJ = RUN_BASE;
const U_OTHER = RUN_BASE + 1;
const EMAIL_SUBJ = `subj${RUN_BASE}@test.local`;
const EMAIL_OTHER = `other${RUN_BASE}@test.local`;

const S = {
	consentMeta: 'SENTINEL2046R_CONSENT_META',
	revocation: 'SENTINEL2046R_REVOCATION_REASON',
	notes: 'SENTINEL2046R_RECRUITER_NOTES',
	override: 'SENTINEL2046R_OVERRIDE_REASON',
	storageKey: 'SENTINEL2046R_STORAGE_KEY',
	token: 'SENTINEL2046R_API_TOKEN',
	resumeRef: '/api/files/SENTINEL2046R_RESUME_REF',
};
const ALL_SENTINELS = Object.values(S);

const CONSENT_NOTE =
	'Consent record metadata is withheld in this copy because its contents are caller-supplied and unverified.';

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

describeIfDb('#2046 POST /gdpr/export metadata + FK ruling — real DB (user journey)', () => {
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
			 VALUES ($1, $2, 'x', 'Subject 2046', 'candidate'), ($3, $4, 'x', 'Other 2046', 'recruiter')`,
			[U_SUBJ, EMAIL_SUBJ, U_OTHER, EMAIL_OTHER],
		);
		// Consent revoked by the OTHER user, with caller-supplied
		// metadata and a revoker-authored reason.
		await q(
			`INSERT INTO consent_records (user_id, consent_type, consented, ip_address, metadata, revoked_at, revoked_by, revocation_reason)
			 VALUES ($1, 'privacy_policy', true, '203.0.113.46', $2::jsonb, NOW(), $3, $4)`,
			[U_SUBJ, JSON.stringify({ caller_supplied: S.consentMeta, anything: 'caller text' }), U_OTHER, S.revocation],
		);
		// Consent self-revoked: own id must survive ownIdOrNull.
		await q(
			`INSERT INTO consent_records (user_id, consent_type, consented, ip_address, metadata, revoked_at, revoked_by, revocation_reason)
			 VALUES ($1, 'marketing', false, '203.0.113.46', '{}'::jsonb, NOW(), $1, $2)`,
			[U_SUBJ, S.revocation],
		);
		// Audit row acted on by the OTHER user (recruiter-actor shape:
		// candidate_id + recruiter_notes inside metadata).
		await q(
			`INSERT INTO audit_logs (action_type, user_id, target_type, target_id, ip_address, metadata, actor_id)
			 VALUES ('human_override', $1, 'job_application', 9001, '203.0.113.46', $2::jsonb, $3)`,
			[
				U_SUBJ,
				JSON.stringify({
					candidate_id: U_OTHER,
					actor_id: U_OTHER,
					user_id: U_SUBJ,
					job_id: 4242,
					new_status: 'interview',
					recruiter_notes: S.notes,
					override_reason: S.override,
					storage_key: S.storageKey,
					api_token: S.token,
					resume_ref: S.resumeRef,
					export_size: 123,
				}),
				U_OTHER,
			],
		);
		// Audit row acted on by the SUBJECT themselves.
		await q(
			`INSERT INTO audit_logs (action_type, user_id, target_type, target_id, ip_address, metadata, actor_id)
			 VALUES ('gdpr_data_export', $1, 'user', $1, '203.0.113.46', '{"export_size":456}'::jsonb, $1)`,
			[U_SUBJ],
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

	test('subject export: Lex rule applied to the copy — no sentinel leaks, own data survives', async () => {
		const res = await exportAsSubject();
		expect(res.status).toBe(200);
		const serialised = JSON.stringify(res.body);
		for (const sentinel of ALL_SENTINELS) {
			expect(serialised).not.toContain(sentinel);
		}
		const d = res.body.data;

		const foreignConsent = d.consents.find((c) => c.consent_type === 'privacy_policy');
		expect(foreignConsent.metadata).toEqual({});
		expect(foreignConsent.revocation_reason).toBeNull();
		expect(foreignConsent.revoked_by).toBeNull();
		expect(foreignConsent.revoked_at).toBeTruthy();
		const selfConsent = d.consents.find((c) => c.consent_type === 'marketing');
		expect(selfConsent.revoked_by).toBe(U_SUBJ);
		expect(selfConsent.revocation_reason).toBeNull();

		const foreignAudit = d.audit_trail.find((r) => r.action_type === 'human_override');
		expect(foreignAudit.actor_id).toBeNull();
		expect(foreignAudit.metadata).not.toHaveProperty('candidate_id');
		expect(foreignAudit.metadata).not.toHaveProperty('actor_id');
		expect(foreignAudit.metadata).not.toHaveProperty('recruiter_notes');
		expect(foreignAudit.metadata).not.toHaveProperty('override_reason');
		expect(foreignAudit.metadata).not.toHaveProperty('storage_key');
		expect(foreignAudit.metadata).not.toHaveProperty('api_token');
		expect(foreignAudit.metadata).not.toHaveProperty('resume_ref');
		expect(foreignAudit.metadata.user_id).toBe(U_SUBJ);
		expect(foreignAudit.metadata.job_id).toBe(4242);
		expect(foreignAudit.metadata.new_status).toBe('interview');
		expect(foreignAudit.metadata.export_size).toBe(123);
		const selfAudit = d.audit_trail.find(
			(r) => r.action_type === 'gdpr_data_export' && r.actor_id === U_SUBJ,
		);
		expect(selfAudit).toBeTruthy();
		expect(selfAudit.metadata).toEqual({ export_size: 456 });

		expect(d.notes[0]).toBe(CONSENT_NOTE);
		const auditNote = d.notes.find((n) => n.startsWith('Audit log metadata'));
		expect(auditNote).toBeDefined();
		for (const name of [
			'actor_id', 'api_token', 'candidate_id', 'override_reason',
			'recruiter_notes', 'resume_ref', 'storage_key',
		]) {
			expect(auditNote).toContain(name);
		}
	});

	test('stored rows read back UNMUTATED after the export', async () => {
		await exportAsSubject();
		const consent = await seedPool.query(
			`SELECT metadata, revocation_reason, revoked_by FROM consent_records
			 WHERE user_id = $1 AND consent_type = 'privacy_policy'`,
			[U_SUBJ],
		);
		expect(consent.rows[0].metadata).toEqual({
			caller_supplied: S.consentMeta,
			anything: 'caller text',
		});
		expect(consent.rows[0].revocation_reason).toBe(S.revocation);
		expect(consent.rows[0].revoked_by).toBe(U_OTHER);

		const audit = await seedPool.query(
			`SELECT metadata, actor_id FROM audit_logs
			 WHERE user_id = $1 AND action_type = 'human_override'`,
			[U_SUBJ],
		);
		expect(audit.rows[0].actor_id).toBe(U_OTHER);
		expect(audit.rows[0].metadata.candidate_id).toBe(U_OTHER);
		expect(audit.rows[0].metadata.recruiter_notes).toBe(S.notes);
		expect(audit.rows[0].metadata.storage_key).toBe(S.storageKey);
	});
});
