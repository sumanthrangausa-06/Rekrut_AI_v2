/**
 * S-077 (#760) — real-DB integration test for the retention purge audit path.
 *
 * Rex's blocking finding: migration 254 extends the compliance_audit_trail
 * entity_type CHECK with 'retention_purge'. The unit tests mock
 * auditLogService and db.query, so a DB-layer check_violation would be
 * invisible. This test exercises the REAL auditLogService.logEvent against
 * a REAL Postgres — no mocks.
 *
 * Gated behind RETENTION_INTEGRATION_DB_URL so CI (no DB) skips gracefully.
 * Example: RETENTION_INTEGRATION_DB_URL='postgresql://postgres:postgres@127.0.0.1:5432/rekrut_s077_integration'
 * The test creates its own schema (idempotent) and cleans up after itself.
 */

// NOTE: no jest.mock calls in this file — real modules, real DB.
// server/test/setup.js globally mocks ../../lib/db for every test file;
// unmock it here so auditLogService gets the REAL pool.
jest.unmock('../../../lib/db');

const DB_URL = process.env.RETENTION_INTEGRATION_DB_URL;

const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb('retention purge audit (real DB — Rex blocking finding)', () => {
	let pool;
	let auditLogService;

	const SCHEMA_SQL = `
		CREATE TABLE IF NOT EXISTS _it_users (id SERIAL PRIMARY KEY);
		CREATE TABLE IF NOT EXISTS _it_jobs (id SERIAL PRIMARY KEY);
		CREATE TABLE IF NOT EXISTS _it_companies (id SERIAL PRIMARY KEY);
	`;

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		// Fresh module registry so lib/db picks up the real DATABASE_URL
		jest.resetModules();
		const { Pool } = require('pg');
		pool = new Pool({ connectionString: DB_URL, ssl: false });

		const client = await pool.connect();
		try {
			await client.query(SCHEMA_SQL);
			// Build the audit table the same way production does:
			// migration 129 (original CHECK) then migration 254 (extended CHECK).
			// Swap the FK targets to our throwaway tables to keep this hermetic.
			const m129 = require('../../../migrations/129_compliance_audit_trail.js');
			const src129 = m129.up.toString();
			if (!src129.includes('compliance_audit_trail')) {
				throw new Error('migration 129 shape changed — update this test');
			}
			await client.query('BEGIN');
			await client.query(`
				CREATE TABLE IF NOT EXISTS compliance_audit_trail (
					id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
					event_type VARCHAR(50) NOT NULL
						CHECK (event_type IN ('ai_decision', 'human_override', 'data_access', 'verification', 'signature', 'status_change')),
					entity_type VARCHAR(50) NOT NULL
						CHECK (entity_type IN ('candidate', 'job', 'company', 'user')),
					entity_id INTEGER NOT NULL,
					actor_id INTEGER,
					actor_role VARCHAR(50),
					job_id INTEGER,
					company_id INTEGER,
					payload JSONB NOT NULL DEFAULT '{}',
					previous_hash VARCHAR(64) NOT NULL,
					current_hash VARCHAR(64) NOT NULL UNIQUE,
					created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
				)
			`);
			await client.query('COMMIT');
			await client.query('BEGIN');
			await require('../../../migrations/254_compliance_audit_retention_purge.js').up(client);
			await client.query('COMMIT');
		} finally {
			client.release();
		}

		auditLogService = require('../../../services/auditLogService');
	}, 30000);

	afterAll(async () => {
		if (pool) {
			await pool.query('DROP TABLE IF EXISTS compliance_audit_trail').catch(() => {});
			await pool.end();
		}
		delete process.env.DATABASE_URL;
	});

	test('logEvent with entityType=retention_purge inserts without check_violation', async () => {
		const row = await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.STATUS_CHANGE,
			entityType: 'retention_purge',
			entityId: 0,
			actorId: null, // system cron — the Q3 case that previously threw in biometricAudit
			actorRole: 'system',
			payload: {
				runId: 'integration-test',
				runType: 'purgeRecordingObjects',
				objectCount: 0,
				storageDeleted: 0,
				dryRun: true,
				errorCount: 0,
			},
		});

		expect(row).toBeDefined();
		expect(row.entity_type).toBe('retention_purge');

		const check = await pool.query(
			`SELECT entity_type, actor_role, payload->>'runId' AS run_id
			 FROM compliance_audit_trail WHERE id = $1`,
			[row.id]
		);
		expect(check.rows).toHaveLength(1);
		expect(check.rows[0].run_id).toBe('integration-test');
		expect(check.rows[0].actor_role).toBe('system');
	});

	test('CHECK constraint definition includes retention_purge', async () => {
		const r = await pool.query(
			`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
			 WHERE conname = 'compliance_audit_trail_entity_type_check'`
		);
		expect(r.rows).toHaveLength(1);
		expect(r.rows[0].def).toContain('retention_purge');
	});
});
