/**
 * #1981 — Quinn E2E (HL-003) for the hold-aware skeleton audit expiry.
 *
 * Operator journey: the retention purge runs (dry-run preview, then
 * the gated live run) over audit_logs containing expired
 * skeleton_event_swept receipts. What the operator must see:
 *  - held receipts (user hold, company hold via the candidate's own
 *    company, company hold via an interview_session) SURVIVE and are
 *    counted as held_skips;
 *  - an unheld expired receipt is DELETED (whole row);
 *  - an unexpired receipt SURVIVES;
 *  - a receipt whose tombstone linkage is missing / malformed /
 *    out-of-range SURVIVES (fail-closed) and counts as held;
 *  - a receipt whose hold was RELEASED is deleted by the next purge
 *    run after release (release itself deletes nothing);
 *  - a generic audit_logs row — even one carrying tombstone-shaped
 *    metadata — is untouched by the skeleton segment;
 *  - the purge writes NO new audit_logs row (aggregate counts only),
 *    and the summary never names a tombstone subject id.
 *
 * Run (local PG rig):
 *   DATABASE_URL='postgresql://postgres@127.0.0.1:55433/skel1981_e2e' \
 *   SKELETON1981_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/skel1981_e2e' \
 *     npx jest server/__tests__/lib/skeleton-audit-expiry-1981.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.SKELETON1981_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(120000);

const U_HELD = 1981101;
const U_SESSION = 1981102;
const U_UNHELD = 1981103;
const U_OWNCO = 1981105;
const U_RELEASED = 1981106;
const CO_SESSION = 1981201;
const CO_OWN = 1981203;

const EXPIRED = new Date(Date.now() - 3000 * 86400000);
const RECENT = new Date(Date.now() - 10 * 86400000);
const JUST_INSIDE = new Date(Date.now() - 2554 * 86400000); // < 2555d: survives, not held, not deleted
const JUST_OUTSIDE = new Date(Date.now() - 2556 * 86400000); // > 2555d: deleted if unheld

let pool;
let EuComplianceService;

async function seedAudit(actionType, tombstone, createdAt, targetId = 555001) {
	const metadata =
		tombstone === undefined ? {} : { label: 'skeleton-class', tombstone_user_id: tombstone };
	const { rows } = await pool.query(
		`INSERT INTO audit_logs (action_type, user_id, target_type, target_id, metadata, created_at)
		 VALUES ($1, NULL, 'interview_event', $2, $3::jsonb, $4) RETURNING id`,
		[actionType, targetId, JSON.stringify(metadata), createdAt],
	);
	return rows[0].id;
}

describeIfDb('#1981 skeleton audit expiry — real PG', () => {
	const ids = {};
	beforeAll(async () => {
		// server/test/setup.js overrides DATABASE_URL with a dummy;
		// restore the rig URL before requiring the service so lib/db
		// builds its pool against the real test DB (#1973 pattern).
		process.env.DATABASE_URL = DB_URL;
		pool = new Pool({ connectionString: DB_URL });
		await pool.query(`DROP TABLE IF EXISTS audit_logs, legal_holds, interview_sessions,
			interview_events, job_applications, data_retention_policies, users, companies CASCADE`);
		await pool.query(`
			CREATE TABLE users (id INTEGER PRIMARY KEY, company_id INTEGER);
			CREATE TABLE companies (id INTEGER PRIMARY KEY);
			CREATE TABLE job_applications (id INTEGER PRIMARY KEY, company_id INTEGER);
			CREATE TABLE interview_events (id INTEGER PRIMARY KEY, job_application_id INTEGER, candidate_id INTEGER);
			CREATE TABLE interview_sessions (id SERIAL PRIMARY KEY, candidate_id INTEGER, company_id INTEGER);
			CREATE TABLE legal_holds (id SERIAL PRIMARY KEY, user_id INTEGER, company_id INTEGER,
				reason TEXT NOT NULL, set_by TEXT NOT NULL, set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				released_by TEXT, released_at TIMESTAMPTZ);
			CREATE TABLE audit_logs (id SERIAL PRIMARY KEY, action_type VARCHAR(100) NOT NULL,
				user_id INTEGER, target_type VARCHAR(100), target_id INTEGER,
				metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT NOW());
			CREATE TABLE data_retention_policies (id SERIAL PRIMARY KEY, data_type VARCHAR(100),
				retention_days INTEGER, auto_delete BOOLEAN, company_id INTEGER,
				policy_scope VARCHAR(50) DEFAULT 'global', scope_id INTEGER, description TEXT,
				created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
		`);
		// Seeded production shape: audit_logs policy dormant.
		await pool.query(
			`INSERT INTO data_retention_policies (data_type, retention_days, auto_delete)
			 VALUES ('audit_logs', 2555, false)`,
		);
		await pool.query(`INSERT INTO companies (id) VALUES ($1), ($2)`, [CO_SESSION, CO_OWN]);
		await pool.query(
			`INSERT INTO users (id, company_id) VALUES ($1,NULL),($2,NULL),($3,NULL),($4,$5),($6,NULL)`,
			[U_HELD, U_SESSION, U_UNHELD, U_OWNCO, CO_OWN, U_RELEASED],
		);
		await pool.query(`INSERT INTO interview_sessions (candidate_id, company_id) VALUES ($1,$2)`, [
			U_SESSION,
			CO_SESSION,
		]);
		await pool.query(
			`INSERT INTO legal_holds (user_id, company_id, reason, set_by, released_at) VALUES
			 ($1, NULL, 'litigation', 'admin', NULL),
			 (NULL, $2, 'litigation', 'admin', NULL),
			 (NULL, $3, 'litigation', 'admin', NULL),
			 ($4, NULL, 'litigation', 'admin', NOW())`,
			[U_HELD, CO_SESSION, CO_OWN, U_RELEASED],
		);
		ids.heldUser = await seedAudit('skeleton_event_swept', U_HELD, EXPIRED);
		ids.heldSession = await seedAudit('skeleton_event_swept', U_SESSION, EXPIRED);
		ids.heldOwnCo = await seedAudit('skeleton_event_swept', U_OWNCO, EXPIRED);
		ids.unheldExpired = await seedAudit('skeleton_event_swept', U_UNHELD, EXPIRED);
		ids.unexpired = await seedAudit('skeleton_event_swept', U_UNHELD, RECENT);
		ids.malformedMissing = await seedAudit('skeleton_event_swept', undefined, EXPIRED);
		ids.malformedText = await seedAudit('skeleton_event_swept', 'abc', EXPIRED);
		ids.malformedNegative = await seedAudit('skeleton_event_swept', '-5', EXPIRED);
		ids.oversize = await seedAudit('skeleton_event_swept', 9999999999, EXPIRED);
		ids.released = await seedAudit('skeleton_event_swept', U_RELEASED, EXPIRED);
		ids.generic = await seedAudit('some_other_action', U_UNHELD, EXPIRED);
		ids.justInside = await seedAudit('skeleton_event_swept', U_UNHELD, JUST_INSIDE);
		ids.justOutside = await seedAudit('skeleton_event_swept', U_UNHELD, JUST_OUTSIDE);

		EuComplianceService = require('../../../services/euComplianceService');
	});

	afterAll(async () => {
		if (pool) await pool.end();
	});

	test('dry-run reports held/unheld counts and deletes nothing', async () => {
		const summary = await EuComplianceService.executePurge({ dryRun: true });
		const skel = summary.find((s) => s.data_type === 'audit_logs_skeleton_event_swept');
		expect(skel).toBeDefined();
		expect(skel.retention_days).toBe(2555);
		expect(skel.held_skips).toBe(7);
		expect(skel.affected_count).toBe(3);
		expect(JSON.stringify(summary)).not.toContain(String(U_UNHELD));
		const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM audit_logs`);
		expect(rows[0].c).toBe(13);
	});

	test('live run deletes only unheld expired skeleton rows; state read back', async () => {
		const before = (await pool.query(`SELECT COUNT(*)::int AS c FROM audit_logs`)).rows[0].c;
		const summary = await EuComplianceService.executePurge({ dryRun: false });
		const skel = summary.find((s) => s.data_type === 'audit_logs_skeleton_event_swept');
		expect(skel.affected_count).toBe(3);
		expect(skel.held_skips).toBe(7);

		const { rows } = await pool.query(`SELECT id FROM audit_logs ORDER BY id`);
		const surviving = new Set(rows.map((r) => r.id));
		expect(surviving.has(ids.unheldExpired)).toBe(false);
		expect(surviving.has(ids.released)).toBe(false);
		expect(surviving.has(ids.justOutside)).toBe(false);
		for (const key of [
			'heldUser',
			'heldSession',
			'heldOwnCo',
			'unexpired',
			'malformedMissing',
			'malformedText',
			'malformedNegative',
			'oversize',
			'generic',
			'justInside',
		]) {
			expect(surviving.has(ids[key])).toBe(true);
		}
		// Aggregate only: total fell by exactly the deletions — the
		// purge wrote no new per-subject audit row.
		expect(rows.length).toBe(before - 3);
	});
});
