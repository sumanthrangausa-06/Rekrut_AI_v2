/**
 * #1988: real-DB concurrency gate for the compliance_audit_trail hash chain.
 *
 * Defect (base): services/auditLogService.logEvent appends with an unlocked
 * read-last-hash → compute → INSERT on the global pool. Concurrent appends
 * read the SAME predecessor and fork the chain (or collide on the UNIQUE
 * current_hash). lib/panelLabelling.writePanelAudit (#1961) already takes
 * pg_advisory_xact_lock(hashtext('compliance-audit-chain')), but logEvent
 * does not — so logEvent-vs-logEvent and logEvent-vs-panel appends race.
 *
 * This suite uses a REAL Postgres database (jsonb + advisory locks are the
 * behaviour under test; mocks cannot see either). Gated behind
 * AUDIT_CHAIN_LOCK_DB_URL so environments without a DB skip gracefully.
 * The test database must be disposable: migrations 129 + 254 + 300 are
 * applied to it and rows are written/deleted by the suite. Migration 129
 * FKs to users/jobs/companies — minimal stand-ins are created, following
 * the audit-chain-verify-1342.test.js precedent.
 *
 * Example: AUDIT_CHAIN_LOCK_DB_URL='postgresql://postgres@127.0.0.1:55435/rekrut_1988_test' npx jest server/__tests__/lib/audit-chain-lock-1988.integration.test.js
 */
jest.unmock('../../../lib/db');

const DB_URL = process.env.AUDIT_CHAIN_LOCK_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(60000);

describeIfDb('compliance audit chain lock (real DB, #1988)', () => {
	let pool;
	let svc;
	let panel;
	let dbPool;

	beforeAll(async () => {
		process.env['DATABASE' + '_URL'] = DB_URL;
		jest.resetModules();
		const { Pool } = require('pg');
		pool = new Pool({ connectionString: DB_URL, ssl: false });
		const client = await pool.connect();
		try {
			await client.query('DROP TABLE IF EXISTS compliance_audit_trail CASCADE');
			await client.query(
				'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, company_id INTEGER)',
			);
			await client.query('CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY)');
			await client.query('CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY)');
			await client.query('INSERT INTO users (id) VALUES (10) ON CONFLICT (id) DO NOTHING');
			await client.query('INSERT INTO companies (id) VALUES (5) ON CONFLICT (id) DO NOTHING');
			await require('../../../migrations/129_compliance_audit_trail.js').up(client);
			await require('../../../migrations/254_compliance_audit_retention_purge.js').up(client);
			await require('../../../migrations/300_audit_entity_interview_event.js').up(client);
		} finally {
			client.release();
		}
		svc = require('../../../services/auditLogService');
		panel = require('../../../lib/panelLabelling');
		dbPool = require('../../../lib/db');
	});

	beforeEach(async () => {
		await pool.query('DELETE FROM compliance_audit_trail');
	});

	afterAll(async () => {
		await pool.query('DELETE FROM compliance_audit_trail');
		await pool.end();
		try {
			await require('../../../lib/db').end();
		} catch (_e) {}
	});

	function logBurst(i) {
		return svc.logEvent({
			eventType: svc.EVENT_TYPES.AI_DECISION,
			entityType: svc.ENTITY_TYPES.CANDIDATE,
			entityId: 999,
			actorId: 10,
			actorRole: 'recruiter',
			companyId: 5,
			payload: { burst: 'mixed-1988', writer: 'logEvent', i },
		});
	}

	test('concurrent mixed-writer burst: one genesis, no fork, verifyChain valid', async () => {
		const LOG_N = 12;
		const PANEL_N = 8;
		const jobs = [];
		for (let i = 0; i < LOG_N; i++) jobs.push(logBurst(i));
		for (let i = 0; i < PANEL_N; i++) {
			jobs.push(
				panel.writePanelAudit(dbPool, {
					eventId: 4242,
					actorId: 10,
					actorRole: 'recruiter',
					outcome: 'recorded',
					decision: 'granted',
				}),
			);
		}
		const settled = await Promise.allSettled(jobs);
		const rejected = settled.filter((s) => s.status === 'rejected');
		expect(rejected.map((r) => String(r.reason?.message))).toEqual([]);
		expect(settled).toHaveLength(LOG_N + PANEL_N);

		const { rows } = await pool.query(
			`SELECT previous_hash, COUNT(*)::int AS n FROM compliance_audit_trail GROUP BY previous_hash`,
		);
		const total = rows.reduce((a, r) => a + r.n, 0);
		expect(total).toBe(LOG_N + PANEL_N);
		// Exactly one genesis row and no fork: every previous_hash is used once.
		expect(rows.find((r) => r.previous_hash === svc.GENESIS_HASH)?.n).toBe(1);
		expect(rows.filter((r) => r.n > 1)).toEqual([]);

		const result = await svc.verifyChain();
		expect(result.errors).toEqual([]);
		expect(result.valid).toBe(true);
		expect(result.checked).toBe(LOG_N + PANEL_N);
	});

	test('monotonic guard: logEvent never ties or precedes its predecessor timestamp', async () => {
		// Seed a chain head one hour in the future, correctly hashed.
		const headCreatedAt = new Date(Date.now() + 3600_000).toISOString();
		const headPayload = { seed: 'future-head-1988' };
		const headHash = svc.computeHash(
			svc.GENESIS_HASH,
			'ai_decision',
			999,
			10,
			headPayload,
			headCreatedAt,
		);
		await pool.query(
			`INSERT INTO compliance_audit_trail
			   (event_type, entity_type, entity_id, actor_id, actor_role, job_id, company_id, payload, previous_hash, current_hash, created_at)
			 VALUES ('ai_decision', 'candidate', 999, 10, 'recruiter', NULL, 5, $1, $2, $3, $4)`,
			[JSON.stringify(headPayload), svc.GENESIS_HASH, headHash, headCreatedAt],
		);

		const row = await logBurst(0);
		expect(row.previous_hash).toBe(headHash);
		// The new row's timestamp must be strictly after its predecessor's,
		// so a same-millisecond tie can never be created by this writer.
		expect(new Date(row.created_at).getTime()).toBeGreaterThan(new Date(headCreatedAt).getTime());

		const result = await svc.verifyChain();
		expect(result.valid).toBe(true);
		expect(result.checked).toBe(2);
	});

	test('verifyChain reports a forked chain as invalid (negative linkage case)', async () => {
		// Two children of genesis: individually well-hashed, but the chain
		// forks — linkage verification must report it, never pass it.
		const t0 = Date.now();
		const prev = svc.GENESIS_HASH;
		for (const [i, dt] of [
			[0, 0],
			[1, 1],
		]) {
			const payload = { fork: 'two-genesis-children-1988', i };
			const t = new Date(t0 + dt).toISOString();
			const hash = svc.computeHash(prev, 'ai_decision', 999, 10, payload, t);
			await pool.query(
				`INSERT INTO compliance_audit_trail
				   (event_type, entity_type, entity_id, actor_id, actor_role, job_id, company_id, payload, previous_hash, current_hash, created_at)
				 VALUES ('ai_decision', 'candidate', 999, 10, 'recruiter', NULL, 5, $1, $2, $3, $4)`,
				[JSON.stringify(payload), prev, hash, t],
			);
		}
		const result = await svc.verifyChain();
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.message.includes('Hash chain broken'))).toBe(true);
	});

	test('verifyChain follows hash linkage for same-millisecond rows (pin)', async () => {
		// Three correctly-linked rows sharing ONE created_at millisecond.
		// Timestamp order alone cannot order them (UUID ids carry no
		// insertion order); linkage is the only true order.
		const t = new Date().toISOString();
		let prev = svc.GENESIS_HASH;
		for (let i = 0; i < 3; i++) {
			const payload = { tie: 'same-ms-1988', i };
			const hash = svc.computeHash(prev, 'ai_decision', 999, 10, payload, t);
			await pool.query(
				`INSERT INTO compliance_audit_trail
				   (event_type, entity_type, entity_id, actor_id, actor_role, job_id, company_id, payload, previous_hash, current_hash, created_at)
				 VALUES ('ai_decision', 'candidate', 999, 10, 'recruiter', NULL, 5, $1, $2, $3, $4)`,
				[JSON.stringify(payload), prev, hash, t],
			);
			prev = hash;
		}
		const result = await svc.verifyChain();
		expect(result.errors).toEqual([]);
		expect(result.valid).toBe(true);
		expect(result.checked).toBe(3);
	});
});
