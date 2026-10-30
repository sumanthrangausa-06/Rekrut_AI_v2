/**
 * #1989: real-DB concurrency gate for the erasure drain fold — the third
 * writer of the compliance_audit_trail hash chain.
 *
 * Defect (base): lib/erasureService.erasePersonalData's #1337 dead-letter
 * drain appends to compliance_audit_trail on the erasure transaction's own
 * client (c2Query) with NO advisory lock, while logEvent (#1988) and
 * writePanelAudit (#1961) take
 * pg_advisory_xact_lock(hashtext('compliance-audit-chain')). A burst append
 * landing between the drain's tip SELECT and its INSERT forks the chain.
 *
 * Fix: the drain takes the same xact lock on c2Query, once, inside the
 * per-marker try, immediately before its first tip SELECT — so a lock
 * failure still surfaces as the typed ComplianceAuditDrainError and the
 * caller's BEGIN…COMMIT rolls the whole erasure back (fail-closed).
 *
 * This suite uses a REAL, FULLY MIGRATED Postgres database (the erasure
 * sweeps touch the whole schema; mocks cannot see advisory locks, jsonb,
 * or transaction rollback). Gated behind ERASURE_DRAIN_LOCK_DB_URL so
 * environments without a DB skip gracefully. The database must be
 * disposable and already migrated (`node migrate.js` exit 0).
 *
 * The race is made deterministic with a TEST-ONLY trigger that sleeps
 * inside drain-row INSERTs, widening the tip-SELECT → INSERT window:
 * on base, burst writers append on the stale tip and fork the chain;
 * with the fix, they block on the chain lock until the erasure commits.
 * The trigger is dropped in afterAll and never exists outside this suite.
 *
 * Example: ERASURE_DRAIN_LOCK_DB_URL='postgresql://postgres@127.0.0.1:55435/rekrut_1989_fresh' npx jest server/__tests__/lib/erasure-drain-lock-1989.integration.test.js
 */
jest.unmock('../../../lib/db');

const DB_URL = process.env.ERASURE_DRAIN_LOCK_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(120000);

describeIfDb('erasure drain chain lock (real DB, #1989)', () => {
	let pool;
	let svc;
	let panel;
	let dbPool;
	let erasure;

	beforeAll(async () => {
		process.env['DATABASE' + '_URL'] = DB_URL;
		jest.resetModules();
		const { Pool } = require('pg');
		pool = new Pool({ connectionString: DB_URL, ssl: false });
		svc = require('../../../services/auditLogService');
		panel = require('../../../lib/panelLabelling');
		dbPool = require('../../../lib/db');
		erasure = require('../../../lib/erasureService');
	});

	afterAll(async () => {
		await pool.query('DROP TRIGGER IF EXISTS drain_sleep_1989 ON compliance_audit_trail');
		await pool.query('DROP FUNCTION IF EXISTS drain_sleep_1989_fn()');
		await pool.end();
		try {
			await require('../../../lib/db').end();
		} catch (_e) {}
	});

	async function seedCandidate({ eventType = 'ai_decision' } = {}) {
		const uniq = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
		const { rows: [company] } = await pool.query(
			`INSERT INTO companies (name) VALUES ('Drain Lock Co 1989') RETURNING id`,
		);
		const { rows: [recruiter] } = await pool.query(
			`INSERT INTO users (email, name, role) VALUES ($1, 'Rec', 'recruiter') RETURNING id`,
			['recruiter-1989-' + uniq + '@example.com'],
		);
		const { rows: [candidate] } = await pool.query(
			`INSERT INTO users (email, name, role) VALUES ($1, 'Cand', 'candidate') RETURNING id`,
			['candidate-1989-' + uniq + '@example.com'],
		);
		const { rows: [job] } = await pool.query(
			`INSERT INTO jobs (title, company_id, user_id) VALUES ('Drain Job', $1, $2) RETURNING id`,
			[company.id, recruiter.id],
		);
		const { rows: [screening] } = await pool.query(
			`INSERT INTO ai_screenings (job_id, candidate_id, fit_score, recommendation)
			 VALUES ($1, $2, 50, 'hold') RETURNING id`,
			[job.id, candidate.id],
		);
		const { rows: [marker] } = await pool.query(
			`INSERT INTO ai_screening_audit_logs (screening_id, action, actor_id, metadata)
			 VALUES ($1, 'compliance_audit_failed', NULL, $2) RETURNING id`,
			[screening.id, JSON.stringify({ event_type: eventType, entity_id: candidate.id })],
		);
		return { company, recruiter, candidate, job, screening, marker };
	}

	async function runErasure(userId) {
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			const result = await erasure.erasePersonalData(userId, {
				client,
				audit: { userId, userRole: 'candidate', ipAddress: '127.0.0.1', companyId: null },
			});
			await client.query('COMMIT');
			return result;
		} catch (err) {
			try { await client.query('ROLLBACK'); } catch (_e) {}
			throw err;
		} finally {
			client.release();
		}
	}

	async function installSleepTrigger(seconds) {
		await pool.query(`
			CREATE OR REPLACE FUNCTION drain_sleep_1989_fn() RETURNS trigger AS $fn$
			BEGIN PERFORM pg_sleep(${seconds}); RETURN NEW; END
			$fn$ LANGUAGE plpgsql`);
		await pool.query('DROP TRIGGER IF EXISTS drain_sleep_1989 ON compliance_audit_trail');
		await pool.query(`
			CREATE TRIGGER drain_sleep_1989 BEFORE INSERT ON compliance_audit_trail
			FOR EACH ROW WHEN (NEW.payload->>'replayed_from_dead_letter' = 'true')
			EXECUTE FUNCTION drain_sleep_1989_fn()`);
	}

	async function waitForDrainInsert() {
		for (let i = 0; i < 100; i++) {
			const { rows } = await pool.query(
				`SELECT 1 FROM pg_stat_activity
				  WHERE datname = current_database() AND state = 'active'
				    AND pid <> pg_backend_pid()
				    AND query ~* '^\\s*INSERT INTO compliance_audit_trail'`);
			if (rows.length > 0) return;
			await new Promise((r) => setTimeout(r, 100));
		}
		throw new Error('drain INSERT never became active');
	}

	test('drain append serialises against a concurrent logEvent/panel burst: one genesis, no fork, verifyChain valid', async () => {
		await pool.query('DELETE FROM compliance_audit_trail');
		const seed = await seedCandidate();
		await installSleepTrigger(1);

		const erasurePromise = runErasure(seed.candidate.id);
		await waitForDrainInsert();

		const LOG_N = 4;
		const PANEL_N = 3;
		const burst = [];
		for (let i = 0; i < LOG_N; i++) {
			burst.push(svc.logEvent({
				eventType: svc.EVENT_TYPES.AI_DECISION,
				entityType: svc.ENTITY_TYPES.CANDIDATE,
				entityId: 999,
				actorId: null,
				actorRole: 'recruiter',
				companyId: null,
				payload: { burst: 'drain-1989', writer: 'logEvent', i },
			}));
		}
		for (let i = 0; i < PANEL_N; i++) {
			burst.push(panel.writePanelAudit(dbPool, {
				eventId: 4242,
				actorId: null,
				actorRole: 'recruiter',
				outcome: 'recorded',
				decision: 'granted',
			}));
		}
		const burstSettled = await Promise.allSettled(burst);
		await erasurePromise;
		await pool.query('DROP TRIGGER IF EXISTS drain_sleep_1989 ON compliance_audit_trail');

		expect(burstSettled.filter((s) => s.status === 'rejected')
			.map((s) => String(s.reason?.message))).toEqual([]);

		const { rows } = await pool.query(
			`SELECT previous_hash, COUNT(*)::int AS n FROM compliance_audit_trail GROUP BY previous_hash`,
		);
		const total = rows.reduce((a, r) => a + r.n, 0);
		expect(total).toBe(1 + LOG_N + PANEL_N);
		expect(rows.find((r) => r.previous_hash === svc.GENESIS_HASH)?.n).toBe(1);
		expect(rows.filter((r) => r.n > 1)).toEqual([]);

		const { rows: drainRows } = await pool.query(
			`SELECT id FROM compliance_audit_trail WHERE payload->>'dead_letter_marker_id' = $1`,
			[String(seed.marker.id)],
		);
		expect(drainRows).toHaveLength(1);

		// Drain + deletion committed atomically: the screening row is gone.
		const { rows: screeningRows } = await pool.query(
			'SELECT id FROM ai_screenings WHERE id = $1', [seed.screening.id],
		);
		expect(screeningRows).toEqual([]);

		const result = await svc.verifyChain();
		expect(result.errors).toEqual([]);
		expect(result.valid).toBe(true);
		expect(result.checked).toBe(1 + LOG_N + PANEL_N);
	});

	test('chain-lock acquisition failure aborts the erasure fail-closed (review M2)', async () => {
		await pool.query('DELETE FROM compliance_audit_trail');
		const seed = await seedCandidate();

		// Hold the chain lock on a separate session so the drain's
		// acquisition on the erasure client times out (55P03) INSIDE the
		// per-marker try — the exact path M2 flagged as inspection-only.
		const holder = await pool.connect();
		await holder.query(`SELECT pg_advisory_lock(hashtext('compliance-audit-chain'))`);
		const client = await pool.connect();
		try {
			await client.query(`SET lock_timeout = '300ms'`);
			await client.query('BEGIN');
			await expect(
				erasure.erasePersonalData(seed.candidate.id, {
					client,
					audit: { userId: seed.candidate.id, userRole: 'candidate', ipAddress: '127.0.0.1', companyId: null },
				}),
			).rejects.toMatchObject({ code: 'COMPLIANCE_AUDIT_DRAIN_BLOCKED' });
			await client.query('ROLLBACK');
		} finally {
			client.release();
			await holder.query(`SELECT pg_advisory_unlock(hashtext('compliance-audit-chain'))`);
			holder.release();
		}

		const { rows: screeningRows } = await pool.query(
			'SELECT id FROM ai_screenings WHERE id = $1', [seed.screening.id],
		);
		expect(screeningRows).toHaveLength(1);
		const { rows: trailRows } = await pool.query('SELECT id FROM compliance_audit_trail');
		expect(trailRows).toEqual([]);
	});

	test('drain failure still aborts the whole erasure fail-closed (atomicity preserved)', async () => {
		await pool.query('DELETE FROM compliance_audit_trail');
		const seed = await seedCandidate({ eventType: 'bogus_type_1989' });

		await expect(runErasure(seed.candidate.id)).rejects.toMatchObject({
			code: 'COMPLIANCE_AUDIT_DRAIN_BLOCKED',
		});

		// Rollback: nothing deleted, nothing appended.
		const { rows: screeningRows } = await pool.query(
			'SELECT id FROM ai_screenings WHERE id = $1', [seed.screening.id],
		);
		expect(screeningRows).toHaveLength(1);
		const { rows: markerRows } = await pool.query(
			'SELECT id FROM ai_screening_audit_logs WHERE id = $1', [seed.marker.id],
		);
		expect(markerRows).toHaveLength(1);
		const { rows: trailRows } = await pool.query('SELECT id FROM compliance_audit_trail');
		expect(trailRows).toEqual([]);
	});
});
