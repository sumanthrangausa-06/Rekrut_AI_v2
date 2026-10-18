/**
 * #799 (G-1): real-DB integration test (Rex's pinned scope: at least one
 * integration test against real PG with the real migration applied).
 *
 * Gated behind LEGAL_HOLD_INTEGRATION_DB_URL (retention-audit-integration
 * precedent) so environments without a DB skip gracefully.
 * Example: LEGAL_HOLD_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/rekrut_legal_hold_it'
 *
 * The test database must be disposable: migration 258 is applied to it
 * and legal_holds rows are written/cleaned up by the suite. legal_holds
 * carries no FKs by design (a hold is legal evidence and must not
 * cascade away), so migration 258 needs no other tables. isHeld's
 * company resolution does read users.company_id (and interview_sessions
 * for session subjects), so the suite creates minimal stand-ins for
 * those two lookup tables.
 */
jest.unmock('../../../lib/db');

const DB_URL = process.env.LEGAL_HOLD_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb('legal hold (real DB, migration 258)', () => {
	let pool;
	let legalHold;
	let migration;

	beforeAll(async () => {
		process.env['DATABASE' + '_URL'] = DB_URL;
		jest.resetModules();
		const { Pool } = require('pg');
		pool = new Pool({ connectionString: DB_URL, ssl: false });
		migration = require('../../../migrations/258_legal_holds.js');
		const auditMigration = require('../../../migrations/129_compliance_audit_trail.js');
		const client = await pool.connect();
		try {
			await client.query('DROP TABLE IF EXISTS legal_holds');
			await client.query('DROP TABLE IF EXISTS compliance_audit_trail CASCADE');
			// Minimal stand-ins for the two tables isHeld reads for
			// subject resolution (production has the real ones).
			await client.query('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, company_id INTEGER)');
			await client.query(
				'CREATE TABLE IF NOT EXISTS interview_sessions (id INTEGER PRIMARY KEY, candidate_id INTEGER, company_id INTEGER)',
			);
			// compliance_audit_trail (migration 129) has FKs to users /
			// jobs / companies — stub the latter two so the REAL
			// migration can run. #915 PR-gate fix round: the audit table
			// must exist here so the audit writes (place/release AND the
			// Lex F-1 conflict record) are actually exercised — in the
			// original run they silently failed-and-passed (privacy F-3).
			await client.query('CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY)');
			await client.query('CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY)');
			await migration.up(client);
			await migration.up(client); // idempotent re-run
			await auditMigration.up(client);
		} finally {
			client.release();
		}
		legalHold = require('../../../lib/legalHold');
	});

	afterAll(async () => {
		await pool.query('DELETE FROM legal_holds');
		await pool.query('DELETE FROM interview_sessions WHERE id IN (1, 2, 3)');
		await pool.query('DELETE FROM users WHERE id IN (515152, 515153)');
		await pool.query('DELETE FROM companies WHERE id IN (777, 888)');
		await pool.end();
	});

	test('place → isHeld true → purge predicate matches → release → isHeld false', async () => {
		// #918: the subject must exist before a hold can be placed on it.
		await pool.query('INSERT INTO users (id, company_id) VALUES (424242, NULL) ON CONFLICT (id) DO NOTHING');
		const hold = await legalHold.placeHold(
			{ userId: 424242, reason: 'integration litigation hold', setBy: 'it-admin' },
			pool,
		);
		expect(hold.id).toBeTruthy();
		await expect(legalHold.isHeld({ userId: 424242 }, pool)).resolves.toBe(true);
		await expect(legalHold.isHeld({ userId: 515151 }, pool)).resolves.toBe(false);
		await expect(legalHold.anyHoldActive(pool)).resolves.toBe(true);

		// Bulk-purge predicate (executePurge branches): a DELETE carrying
		// notHeldPredicate deletes the unheld row and spares the held one.
		await pool.query('CREATE TABLE IF NOT EXISTS _lh_docs (user_id INTEGER)');
		await pool.query('DELETE FROM _lh_docs');
		await pool.query('INSERT INTO _lh_docs (user_id) VALUES (424242), (515151)');
		await pool.query(`DELETE FROM _lh_docs WHERE ${legalHold.notHeldPredicate('_lh_docs.user_id')}`);
		const { rows: survivors } = await pool.query('SELECT user_id FROM _lh_docs');
		expect(survivors).toEqual([{ user_id: 424242 }]);
		await pool.query('DROP TABLE _lh_docs');

		const released = await legalHold.releaseHold({ holdId: hold.id, releasedBy: 'it-admin' }, pool);
		expect(released.released_at).toBeTruthy();
		await expect(legalHold.isHeld({ userId: 424242 }, pool)).resolves.toBe(false);
	});

	test('company hold matches by company_id', async () => {
		await pool.query('INSERT INTO companies (id) VALUES (777) ON CONFLICT (id) DO NOTHING');
		const hold = await legalHold.placeHold(
			{ companyId: 777, reason: 'integration company hold', setBy: 'it-admin' },
			pool,
		);
		await expect(legalHold.isHeld({ companyId: 777 }, pool)).resolves.toBe(true);
		await legalHold.releaseHold({ holdId: hold.id, releasedBy: 'it-admin' }, pool);
		await expect(legalHold.isHeld({ companyId: 777 }, pool)).resolves.toBe(false);
	});

	// ── #915 PR-gate fix round (privacy F-1/F-6, Lex F-1) ─────────────────────
	test('F-1 (real SQL): a company-only hold protects a CANDIDATE via interview_sessions — seam shape, erasure shape, and the bulk predicate', async () => {
		// Candidate 515152: users.company_id is NULL (the production
		// reality for candidates); their session 1 sits in company 888.
		await pool.query('INSERT INTO companies (id) VALUES (888) ON CONFLICT (id) DO NOTHING');
		await pool.query(
			'INSERT INTO users (id, company_id) VALUES (515152, NULL), (515153, NULL) ON CONFLICT (id) DO NOTHING',
		);
		await pool.query(
			'INSERT INTO interview_sessions (id, candidate_id, company_id) VALUES (1, 515152, 888), (2, 515153, 889) ON CONFLICT (id) DO NOTHING',
		);
		const hold = await legalHold.placeHold(
			{ companyId: 888, reason: 'integration F-1 company hold', setBy: 'it-admin' },
			pool,
		);

		// Seam shape: BOTH ids passed — session must still be merged.
		await expect(legalHold.isHeld({ userId: 515152, sessionId: 1 }, pool)).resolves.toBe(true);
		// Erasure shape: userId only, attribution via the candidate's sessions.
		await expect(legalHold.isHeld({ userId: 515152 }, pool)).resolves.toBe(true);
		const found = await legalHold.findActiveHold({ userId: 515152 }, pool);
		expect(found.id).toBe(hold.id);
		// Non-held company: candidate 515153's session is in company 889.
		await expect(legalHold.isHeld({ userId: 515153, sessionId: 2 }, pool)).resolves.toBe(false);
		await expect(legalHold.isHeld({ userId: 515153 }, pool)).resolves.toBe(false);

		// Bulk predicate: a DELETE carrying notHeldPredicate spares the
		// session-attributed candidate and deletes the unheld row.
		await pool.query('CREATE TABLE IF NOT EXISTS _lh_docs2 (user_id INTEGER)');
		await pool.query('DELETE FROM _lh_docs2');
		await pool.query('INSERT INTO _lh_docs2 (user_id) VALUES (515152), (515153)');
		await pool.query(`DELETE FROM _lh_docs2 WHERE ${legalHold.notHeldPredicate('_lh_docs2.user_id')}`);
		const { rows: survivors } = await pool.query('SELECT user_id FROM _lh_docs2 ORDER BY user_id');
		expect(survivors).toEqual([{ user_id: 515152 }]);
		await pool.query('DROP TABLE _lh_docs2');

		await legalHold.releaseHold({ holdId: hold.id, releasedBy: 'it-admin' }, pool);
		await expect(legalHold.isHeld({ userId: 515152, sessionId: 1 }, pool)).resolves.toBe(false);
	});

	// ── D-1 precision fix (delta re-review residual, PR #915) ───────────────
	test('D-1 (real SQL): cross-company candidate — non-held session rows purge, held session rows spare, erasure (no sessionId) stays blocked', async () => {
		// Candidate 515152 (users.company_id NULL) already has session 1
		// in company 888 (F-1 test above); session 3 puts the SAME
		// candidate in NON-held company 889.
		await pool.query(
			'INSERT INTO interview_sessions (id, candidate_id, company_id) VALUES (3, 515152, 889) ON CONFLICT (id) DO NOTHING',
		);
		const hold = await legalHold.placeHold(
			{ companyId: 888, reason: 'integration D-1 company hold', setBy: 'it-admin' },
			pool,
		);

		// Per-row shapes (recordings #6 / observer reports #8 consult
		// with candidate + session): judged by THAT session's company.
		await expect(legalHold.isHeld({ userId: 515152, sessionId: 3 }, pool)).resolves.toBe(false); // company-B row purges
		await expect(legalHold.isHeld({ sessionId: 3 }, pool)).resolves.toBe(false); // session-only shape
		await expect(legalHold.findActiveHold({ userId: 515152, sessionId: 3 }, pool)).resolves.toBeNull();
		await expect(legalHold.isHeld({ userId: 515152, sessionId: 1 }, pool)).resolves.toBe(true); // company-A row spares

		// Erasure shape (no sessionId): UNCHANGED — any-session
		// attribution still blocks the whole-person erasure.
		await expect(legalHold.isHeld({ userId: 515152 }, pool)).resolves.toBe(true);
		const found = await legalHold.findActiveHold({ userId: 515152 }, pool);
		expect(found.id).toBe(hold.id);

		// Bulk parity: the session-scoped predicate over per-session
		// rows (recording/report shape: candidate + interview_session_id)
		// deletes the non-held company's row and spares the held one.
		await pool.query(
			'CREATE TABLE IF NOT EXISTS _lh_rows (candidate_id INTEGER, interview_session_id INTEGER)',
		);
		await pool.query('DELETE FROM _lh_rows');
		await pool.query(
			'INSERT INTO _lh_rows (candidate_id, interview_session_id) VALUES (515152, 1), (515152, 3)',
		);
		await pool.query(
			`DELETE FROM _lh_rows WHERE ${legalHold.notHeldPredicate('_lh_rows.candidate_id', { sessionIdExpr: '_lh_rows.interview_session_id' })}`,
		);
		const { rows: survivors } = await pool.query(
			'SELECT interview_session_id FROM _lh_rows ORDER BY interview_session_id',
		);
		expect(survivors).toEqual([{ interview_session_id: 1 }]);
		await pool.query('DROP TABLE _lh_rows');

		await legalHold.releaseHold({ holdId: hold.id, releasedBy: 'it-admin' }, pool);
		await expect(legalHold.isHeld({ userId: 515152, sessionId: 1 }, pool)).resolves.toBe(false);
		await expect(legalHold.isHeld({ userId: 515152 }, pool)).resolves.toBe(false);
	});

	test('F-6 (real SQL): a session-resolution miss fails closed', async () => {
		await expect(legalHold.isHeld({ sessionId: 999999 }, pool)).resolves.toBe(true);
		await expect(legalHold.isHeld({ userId: 515153, sessionId: 999999 }, pool)).resolves.toBe(true);
		await expect(legalHold.findActiveHold({ sessionId: 999999 }, pool)).rejects.toThrow(/not found/);
	});

	// ── #918 (Lex F-5): placeHold verifies the subject exists (real DB) ─────
	test('#918 (real DB): non-existent user / company subjects fail loudly and write NO hold row', async () => {
		const countFor = async (col, id) => {
			const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM legal_holds WHERE ${col} = $1`, [id]);
			return rows[0].c;
		};
		await expect(
			legalHold.placeHold({ userId: 999001, reason: 'ghost user', setBy: 'it-admin' }, pool),
		).rejects.toThrow(/user 999001 does not exist/);
		expect(await countFor('user_id', 999001)).toBe(0);

		await expect(
			legalHold.placeHold({ companyId: 999002, reason: 'ghost company', setBy: 'it-admin' }, pool),
		).rejects.toThrow(/company 999002 does not exist/);
		expect(await countFor('company_id', 999002)).toBe(0);

		// Both supplied, one missing: still a hard error, still no row.
		// (User seeded here so this test is self-contained — reviewer note.)
		await pool.query(
			'INSERT INTO users (id, company_id) VALUES (515152, NULL) ON CONFLICT (id) DO NOTHING',
		);
		await expect(
			legalHold.placeHold({ userId: 515152, companyId: 999002, reason: 'half ghost', setBy: 'it-admin' }, pool),
		).rejects.toThrow(/company 999002 does not exist/);
		const { rows } = await pool.query(
			'SELECT COUNT(*)::int AS c FROM legal_holds WHERE user_id = 515152 AND company_id = 999002',
		);
		expect(rows[0].c).toBe(0);
	});

	// ── #1409 (real DB): int4 range bound in the normaliser ─────────────────
	// #1417: the symmetric lower bound is pinned here too — below-min fails
	// as the same typed 400, and INT4_MIN itself is valid shape (404).
	test('#1409/#1417 (real DB): ids outside int4 range fail as typed 400 before any query; int4 max/min are valid shape (404)', async () => {
		const countAll = async () => {
			const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM legal_holds');
			return rows[0].c;
		};
		const before = await countAll();
		for (const [field, arg] of [
			['userId', { userId: 2147483648 }],
			['companyId', { companyId: 2147483648 }],
			['userId', { userId: -2147483649 }],
			['companyId', { companyId: -2147483649 }],
		]) {
			const err = await legalHold
				.placeHold({ ...arg, reason: 'int4 overflow', setBy: 'it-admin' }, pool)
				.catch((e) => e);
			expect(err.code).toBe('INVALID_SUBJECT_ID');
			expect(err.status).toBe(400);
		}
		for (const [field, arg] of [
			['userId', { userId: 2147483647 }],
			['companyId', { companyId: 2147483647 }],
			['userId', { userId: -2147483648 }],
			['companyId', { companyId: -2147483648 }],
		]) {
			const err = await legalHold
				.placeHold({ ...arg, reason: 'int4 bound', setBy: 'it-admin' }, pool)
				.catch((e) => e);
			// Valid shape: reaches the #918 existence check, which 404s —
			// no 22P02, no 500-class escape, no hold row.
			expect(err.code).toBe('SUBJECT_NOT_FOUND');
			expect(err.status).toBe(404);
		}
		expect(await countAll()).toBe(before);
	});

	test('#918 (real DB): a valid user+company hold still places', async () => {
		await pool.query('INSERT INTO companies (id) VALUES (777) ON CONFLICT (id) DO NOTHING');
		await pool.query('INSERT INTO users (id, company_id) VALUES (424242, NULL) ON CONFLICT (id) DO NOTHING');
		const hold = await legalHold.placeHold(
			{ userId: 424242, companyId: 777, reason: 'integration #918 both-subject hold', setBy: 'it-admin' },
			pool,
		);
		expect(hold.user_id).toBe(424242);
		expect(hold.company_id).toBe(777);
		await legalHold.releaseHold({ holdId: hold.id, releasedBy: 'it-admin' }, pool);
	});

	test('Lex F-1 (real DB): the conflict record and the place audit actually land in compliance_audit_trail', async () => {
		// #918: the subject must exist before a hold can be placed on it.
		await pool.query('INSERT INTO users (id, company_id) VALUES (424243, NULL) ON CONFLICT (id) DO NOTHING');
		const hold = await legalHold.placeHold(
			{ userId: 424243, reason: 'integration conflict hold', setBy: 'it-admin' },
			pool,
		);
		// Place audit landed (privacy F-3: previously this write silently
		// failed because the table did not exist in the test DB).
		const placed = await pool.query(
			`SELECT payload FROM compliance_audit_trail WHERE payload->>'action' = 'legal_hold_placed' AND payload->>'holdId' = $1`,
			[String(hold.id)],
		);
		expect(placed.rows.length).toBeGreaterThan(0);

		await legalHold.recordLegalHoldConflict({
			holdId: hold.id,
			actor: 'it-admin',
			actorRole: 'admin',
			requestId: 1234,
			subjectUserId: 424243,
			source: 'dsar_fulfillment',
		});
		const conflict = await pool.query(
			`SELECT entity_id, actor_role, payload FROM compliance_audit_trail WHERE payload->>'action' = 'legal_hold_conflict'`,
		);
		expect(conflict.rows).toHaveLength(1);
		expect(conflict.rows[0].entity_id).toBe(424243);
		expect(conflict.rows[0].payload).toMatchObject({
			holdId: hold.id,
			actor: 'it-admin',
			requestId: 1234,
			subjectUserId: 424243,
			source: 'dsar_fulfillment',
		});
		await legalHold.releaseHold({ holdId: hold.id, releasedBy: 'it-admin' }, pool);
	});
});
