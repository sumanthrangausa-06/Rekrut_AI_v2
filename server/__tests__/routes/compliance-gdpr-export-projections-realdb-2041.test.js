/**
 * #2041 — HL-003 fresh-install journey for the eight non-user
 * sections of POST /gdpr/export (user-perspective: a candidate asks
 * for a copy of everything Rekrut holds about them).
 *
 * NO doubles on the path under test: a fresh throwaway Postgres
 * built ONLY by `node migrate.js`, the REAL compliance router (real
 * lib/db, real auth, real AuditLogger). One seeded row per section
 * with distinctive values; the subject's own export must carry each
 * section with EXACTLY today's live columns (field-for-field the
 * same copy as before the projection change), and — the defect this
 * lane closes — a column added to a table AFTER the code shipped
 * must NOT appear in the bundle.
 *
 * Rig (this run): PostgreSQL 18.6 at 127.0.0.1:55442; DB
 * `rekrut_2041` created empty and built only by migrate.js (exit 0).
 * Fixture ids/emails derive from a per-run RUN_BASE so the suite is
 * re-runnable on the same DB (#2039 pattern).
 *
 * Example:
 *   EXPORT2041_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55442/rekrut_2041' \
 *     npx jest server/__tests__/routes/compliance-gdpr-export-projections-realdb-2041.test.js --runInBand --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.EXPORT2041_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const RUN_BASE = 1000000 + Math.floor(Math.random() * 900000) * 10;
const U_SUBJ = RUN_BASE;
const EMAIL_SUBJ = `subj${RUN_BASE}@test.local`;

const EXPECTED = {
	omni_scores: [
		'id', 'user_id', 'total_score', 'interview_score', 'technical_score',
		'resume_score', 'behavior_score', 'score_tier', 'last_updated',
		'created_at', 'factor_scores', 'peer_percentile', 'last_checkin_at',
		'fraud_signals', 'version',
	],
	score_history: [
		'id', 'user_id', 'previous_score', 'new_score', 'change_amount',
		'change_reason', 'component_type', 'created_at', 'score_snapshot',
	],
	score_snapshots: [
		'id', 'user_id', 'total_score', 'factor_scores', 'peer_percentile',
		'snapshot_week', 'created_at',
	],
	interviews: [
		'id', 'user_id', 'job_id', 'interview_type', 'status', 'questions',
		'responses', 'ai_feedback', 'overall_score', 'duration_seconds',
		'video_urls', 'created_at', 'completed_at', 'updated_at',
	],
	assessment_results: ['id', 'user_id', 'skill_name', 'score', 'created_at'],
	candidate_profiles: [
		'id', 'user_id', 'headline', 'summary', 'skills', 'experience',
		'education', 'resume_url', 'linkedin_url', 'portfolio_url', 'location',
		'preferred_role', 'salary_expectation', 'remote_preference', 'bio',
		'phone', 'github_url', 'photo_url', 'salary_min', 'salary_max',
		'preferred_job_types', 'preferred_locations', 'years_experience',
		'created_at', 'updated_at', 'availability', 'work_authorization',
		'certifications', 'preferred_industries', 'visa_sponsorship_needed',
		'notice_period', 'willing_to_relocate', 'preferred_company_size',
		'cover_letter_template', 'timezone_preference', 'travel_willingness',
		'salary_currency', 'work_mode', 'work_hours', 'start_date_flexibility',
		'salary_expectation_min', 'salary_expectation_max',
	],
	consent_records: [
		'id', 'user_id', 'consent_type', 'consented', 'consented_at',
		'ip_address', 'metadata', 'created_at', 'updated_at', 'revoked_at',
		'revoked_by', 'revocation_reason',
	],
	audit_logs: [
		'id', 'action_type', 'user_id', 'target_type', 'target_id', 'metadata',
		'ip_address', 'user_agent', 'created_at', 'company_id', 'actor_id',
		'action', 'reason',
	],
};

const FUTURE_COL = 'future_secret_2041';
const FUTURE_SENTINEL = 'SENTINEL2041_FUTURE_COLUMN_VALUE';

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

describeIfDb('#2041 POST /gdpr/export non-user projections — real DB (user journey)', () => {
	let request;
	let app;
	let generateToken;

	async function cleanAndSeed() {
		const q = (sql, params) => seedPool.query(sql, params);
		for (const t of [
			'data_requests', 'audit_logs', 'consent_records', 'candidate_profiles',
			'assessment_results', 'interviews', 'score_snapshots', 'score_history',
			'omni_scores',
		]) {
			await q(`DELETE FROM ${t} WHERE user_id = $1`, [U_SUBJ]);
		}
		await q('DELETE FROM users WHERE id = $1', [U_SUBJ]);
		await q(
			`INSERT INTO users (id, email, password_hash, name, role)
			 VALUES ($1, $2, 'x', 'Subject 2041', 'candidate')`,
			[U_SUBJ, EMAIL_SUBJ],
		);
		await q(
			`INSERT INTO omni_scores (user_id, total_score, interview_score, score_tier)
			 VALUES ($1, 701, 88, 'gold')`,
			[U_SUBJ],
		);
		await q(
			`INSERT INTO score_history (user_id, previous_score, new_score, change_reason)
			 VALUES ($1, 640, 701, 'seed-2041')`,
			[U_SUBJ],
		);
		await q(
			`INSERT INTO score_snapshots (user_id, total_score, snapshot_week)
			 VALUES ($1, 701, '2026-10-26')`,
			[U_SUBJ],
		);
		await q(
			`INSERT INTO interviews (user_id, interview_type, status, overall_score)
			 VALUES ($1, 'mock', 'completed', 87)`,
			[U_SUBJ],
		);
		await q(
			`INSERT INTO assessment_results (user_id, skill_name, score)
			 VALUES ($1, 'SQL-2041', 92)`,
			[U_SUBJ],
		);
		await q(
			`INSERT INTO candidate_profiles (user_id, headline, phone)
			 VALUES ($1, 'Headline 2041', '+1-555-2041')`,
			[U_SUBJ],
		);
		await q(
			`INSERT INTO consent_records (user_id, consent_type, consented, ip_address)
			 VALUES ($1, 'privacy_policy', true, '203.0.113.41')`,
			[U_SUBJ],
		);
		await q(
			`INSERT INTO audit_logs (action_type, user_id, target_type, target_id, ip_address, metadata)
			 VALUES ('seed_2041', $1, 'user', $1, '203.0.113.41', '{"seed":"2041"}'::jsonb)`,
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
		// Safety: never leave the mutation column behind on the rig DB.
		await seedPool.query(`ALTER TABLE candidate_profiles DROP COLUMN IF EXISTS ${FUTURE_COL}`);
		await seedPool.query(`ALTER TABLE audit_logs DROP COLUMN IF EXISTS ${FUTURE_COL}`);
		await seedPool.end();
	});

	test('subject export: every section carries exactly today\u2019s columns, values intact', async () => {
		const res = await exportAsSubject();
		expect(res.status).toBe(200);
		const d = res.body.data;
		expect(Object.keys(d.omniscore.score).sort()).toEqual([...EXPECTED.omni_scores].sort());
		expect(d.omniscore.score.total_score).toBe(701);
		expect(Object.keys(d.omniscore.score_history[0]).sort()).toEqual(
			[...EXPECTED.score_history].sort(),
		);
		expect(Object.keys(d.omniscore.score_snapshots[0]).sort()).toEqual(
			[...EXPECTED.score_snapshots].sort(),
		);
		expect(Object.keys(d.interviews[0]).sort()).toEqual([...EXPECTED.interviews].sort());
		expect(d.interviews[0].overall_score).toBe(87);
		expect(Object.keys(d.assessments[0]).sort()).toEqual(
			[...EXPECTED.assessment_results].sort(),
		);
		expect(d.assessments[0].skill_name).toBe('SQL-2041');
		expect(Object.keys(d.profile).sort()).toEqual([...EXPECTED.candidate_profiles].sort());
		expect(d.profile.headline).toBe('Headline 2041');
		expect(Object.keys(d.consents[0]).sort()).toEqual([...EXPECTED.consent_records].sort());
		const seededAudit = d.audit_trail.find((r) => r.action_type === 'seed_2041');
		expect(seededAudit).toBeTruthy();
		expect(Object.keys(seededAudit).sort()).toEqual([...EXPECTED.audit_logs].sort());
		// State read back: the export wrote its data_requests record.
		const { rows } = await seedPool.query(
			"SELECT status FROM data_requests WHERE user_id = $1 AND request_type = 'export'",
			[U_SUBJ],
		);
		expect(rows.length).toBeGreaterThanOrEqual(1);
	});

	test('future column added after ship does NOT leak into the export', async () => {
		await seedPool.query(`ALTER TABLE candidate_profiles ADD COLUMN ${FUTURE_COL} TEXT`);
		await seedPool.query(`ALTER TABLE audit_logs ADD COLUMN ${FUTURE_COL} TEXT`);
		try {
			await seedPool.query(`UPDATE candidate_profiles SET ${FUTURE_COL} = $1 WHERE user_id = $2`, [
				FUTURE_SENTINEL,
				U_SUBJ,
			]);
			await seedPool.query(`UPDATE audit_logs SET ${FUTURE_COL} = $1 WHERE user_id = $2`, [
				FUTURE_SENTINEL,
				U_SUBJ,
			]);
			const res = await exportAsSubject();
			expect(res.status).toBe(200);
			expect(JSON.stringify(res.body)).not.toContain(FUTURE_SENTINEL);
			expect(JSON.stringify(res.body)).not.toContain(FUTURE_COL);
			expect(Object.keys(res.body.data.profile).sort()).toEqual(
				[...EXPECTED.candidate_profiles].sort(),
			);
		} finally {
			await seedPool.query(`ALTER TABLE candidate_profiles DROP COLUMN IF EXISTS ${FUTURE_COL}`);
			await seedPool.query(`ALTER TABLE audit_logs DROP COLUMN IF EXISTS ${FUTURE_COL}`);
		}
	});
});
