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
		const client = await pool.connect();
		try {
			await client.query('DROP TABLE IF EXISTS legal_holds');
			// Minimal stand-ins for the two tables isHeld reads for
			// subject resolution (production has the real ones).
			await client.query('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, company_id INTEGER)');
			await client.query(
				'CREATE TABLE IF NOT EXISTS interview_sessions (id INTEGER PRIMARY KEY, candidate_id INTEGER, company_id INTEGER)',
			);
			await migration.up(client);
			await migration.up(client); // idempotent re-run
		} finally {
			client.release();
		}
		legalHold = require('../../../lib/legalHold');
	});

	afterAll(async () => {
		await pool.query('DELETE FROM legal_holds');
		await pool.end();
	});

	test('place → isHeld true → purge predicate matches → release → isHeld false', async () => {
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
		const hold = await legalHold.placeHold(
			{ companyId: 777, reason: 'integration company hold', setBy: 'it-admin' },
			pool,
		);
		await expect(legalHold.isHeld({ companyId: 777 }, pool)).resolves.toBe(true);
		await legalHold.releaseHold({ holdId: hold.id, releasedBy: 'it-admin' }, pool);
		await expect(legalHold.isHeld({ companyId: 777 }, pool)).resolves.toBe(false);
	});
});
