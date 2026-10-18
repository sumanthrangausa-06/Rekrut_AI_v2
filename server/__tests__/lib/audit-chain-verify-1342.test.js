/**
 * #1342: real-DB round-trip for the compliance_audit_trail hash chain.
 *
 * Pre-fix defect: auditLogService.computeHash serialised the payload with
 * plain JSON.stringify (JS insertion order) on the writer side, but
 * verifyChain recomputes over row.payload parsed from the JSONB column,
 * whose key order Postgres normalises (key length, then bytewise,
 * recursively). Any payload whose insertion order differed from jsonb
 * order could never verify — including rows written natively by logEvent.
 * The mocked-DB suite (tests/compliance-audit.test.js) preserves JS key
 * order end-to-end, so it cannot see this; this suite uses a REAL
 * Postgres database so the jsonb round-trip actually happens.
 *
 * Gated behind AUDIT_CHAIN_INTEGRATION_DB_URL (legal-hold-db precedent)
 * so environments without a DB skip gracefully. The test database must
 * be disposable: migration 129 is applied to it and rows are written and
 * cleaned up by the suite. Migration 129 FKs to users/jobs/companies —
 * the suite creates minimal stand-ins for those three tables.
 *
 * Example: AUDIT_CHAIN_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55461/rekrut_1342_test' npx jest server/__tests__/lib/audit-chain-verify-1342.test.js
 */
jest.unmock('../../../lib/db');

const crypto = require('node:crypto');

const DB_URL = process.env.AUDIT_CHAIN_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(60000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describeIfDb('compliance audit chain verifyChain (real DB, #1342)', () => {
	let pool;
	let svc;

	beforeAll(async () => {
		process.env['DATABASE' + '_URL'] = DB_URL;
		jest.resetModules();
		const { Pool } = require('pg');
		pool = new Pool({ connectionString: DB_URL, ssl: false });
		const migration = require('../../../migrations/129_compliance_audit_trail.js');
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
			await migration.up(client);
		} finally {
			client.release();
		}
		svc = require('../../../services/auditLogService');
	});

	afterAll(async () => {
		await pool.query('DELETE FROM compliance_audit_trail');
		await pool.end();
		// Close the service-side pool so jest can exit.
		try {
			await require('../../../lib/db').end();
		} catch (_e) {}
	});

	async function write(payload) {
		// Space writes so created_at ordering (the chain's only ordering)
		// is unambiguous at millisecond precision.
		await sleep(5);
		return svc.logEvent({
			eventType: svc.EVENT_TYPES.AI_DECISION,
			entityType: svc.ENTITY_TYPES.CANDIDATE,
			entityId: 999,
			actorId: 10,
			actorRole: 'recruiter',
			companyId: 5,
			payload,
		});
	}

	test('round-trip: logEvent rows whose insertion order differs from jsonb order verify end-to-end', async () => {
		const rows = [];
		// Insertion order is the REVERSE of jsonb order for this payload.
		rows.push(await write({ recommendation: 'interview', fit_score: 85 }));
		// The #1337 chaincheck payload: nested objects reorder at both levels.
		rows.push(
			await write({
				screening_id: 42,
				inputs: { candidate_id: 999, job_id: 1 },
				outputs: { fit_score: 10, recommendation: 'hold' },
			}),
		);
		// Non-ASCII keys (UTF-8 byte ordering), integer-like keys, and an
		// array of objects (array order is data and must be preserved).
		rows.push(
			await write({ é: 1, aa: 2, 10: 'x', 2: 'y', nested: [{ zeta: 1, alpha: 2 }, { beta: 3 }] }),
		);
		// undefined-valued keys are dropped by JSON.stringify on both sides.
		rows.push(await write({ present: 1, absent: undefined }));
		// Emoji key: 4 UTF-8 bytes, ties with 'aaaa' on length and loses
		// bytewise (0x61 < 0xF0) — the ordering a UTF-16 comparator would
		// get wrong.
		rows.push(await write({ '😀': 1, aaaa: 2, aaa: 3 }));
		// Date value: stored by jsonb as its toJSON ISO string.
		rows.push(await write({ decided_at: new Date('2026-01-02T03:04:05.000Z'), zulu: 1 }));
		// toJSON returning an OBJECT: its result must be canonicalised
		// too, not stringified in insertion order (reviewer B1).
		rows.push(await write({ meta: { toJSON: () => ({ zulu: 1, alpha: 2 }) }, fit_score: 3 }));
		// Sparse array: holes are null in JSON and in jsonb (reviewer B2).
		// biome-ignore lint/suspicious/noSparseArray: the hole is the test vector
		rows.push(await write({ scores: [1, , 3] }));
		// toJSON returning ITSELF: JSON.stringify serialises the object;
		// the canonicaliser must too, not misread it as circular
		// (re-review B1-residual).
		const selfish = { zulu: 1, alpha: 2 };
		selfish.toJSON = function () {
			return this;
		};
		rows.push(await write({ selfish }));

		// Chain linkage by construction.
		expect(rows[0].previous_hash).toBe(svc.GENESIS_HASH);
		for (let i = 1; i < rows.length; i++) {
			expect(rows[i].previous_hash).toBe(rows[i - 1].current_hash);
		}

		const result = await svc.verifyChain();
		expect(result.errors).toEqual([]);
		expect(result.valid).toBe(true);
		expect(result.checked).toBe(rows.length);
	});

	test('legacy pre-fix row (insertion-order hash) is reported unverifiable, linkage intact', async () => {
		// Simulate a row exactly as the PRE-FIX writer wrote it: hash over
		// JSON.stringify in insertion order, which jsonb then reorders.
		const { rows: head } = await pool.query(
			'SELECT current_hash FROM compliance_audit_trail ORDER BY created_at DESC, id DESC LIMIT 1',
		);
		const previousHash = head[0].current_hash;
		const payload = { recommendation: 'legacy', fit_score: 1 };
		const createdAt = new Date().toISOString();
		const legacyHash = crypto
			.createHash('sha256')
			.update(`${previousHash}|ai_decision|999|10|${JSON.stringify(payload)}|${createdAt}`)
			.digest('hex');
		const { rows: inserted } = await pool.query(
			`INSERT INTO compliance_audit_trail
			   (event_type, entity_type, entity_id, actor_id, actor_role, job_id, company_id, payload, previous_hash, current_hash, created_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
			[
				'ai_decision',
				'candidate',
				999,
				10,
				'recruiter',
				null,
				5,
				JSON.stringify(payload),
				previousHash,
				legacyHash,
				createdAt,
			],
		);

		const result = await svc.verifyChain();
		expect(result.valid).toBe(false);
		const rowErrors = result.errors.filter((e) => e.id === inserted[0].id);
		expect(rowErrors).toHaveLength(1);
		expect(rowErrors[0].message).toContain('does not match recomputed');
		// Linkage over the legacy row still checks out — it is reported,
		// never skipped, and its links are not broken by the fix.
		expect(result.errors.some((e) => e.message.includes('Hash chain broken'))).toBe(false);
	});

	test('tamper: a direct payload UPDATE is still detected', async () => {
		const row = await write({ decision: 'reject', reason: 'skills' });
		await pool.query('UPDATE compliance_audit_trail SET payload = $1 WHERE id = $2', [
			JSON.stringify({ decision: 'hire', reason: 'skills' }),
			row.id,
		]);
		const result = await svc.verifyChain();
		expect(result.valid).toBe(false);
		expect(
			result.errors.some((e) => e.id === row.id && e.message.includes('does not match recomputed')),
		).toBe(true);
	});
});
