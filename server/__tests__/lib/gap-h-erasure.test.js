/**
 * #1127 GAP-H (K-1): Erasure — consent-fact IP/UA redaction inconsistent
 * across consent tables.
 *
 * STOP 1 (issue #1127, comment 6179568387) scoped the build — the filed
 * ACs were CORRECTED by the panel (verified at origin/dev @ 5e2595a3):
 *
 *   FIELD SETS ARE PER-TABLE (the filing's symmetry is factually wrong):
 *   consent_records has NO user_agent column (mig 013: ip_address +
 *   metadata JSONB only; mig 133 adds revoked_at / revoked_by /
 *   revocation_reason). consent_history (mig 133) has ip_address +
 *   user_agent. Two PII-bearing columns the filing did not name are IN
 *   the redact set (Lex rules, privacy concurs — neither is a named
 *   K-1 fact field, table Principle 3): consent_records.metadata
 *   (caller-supplied verbatim from req.body, no schema/allowlist) and
 *   consent_records.revocation_reason (client free text).
 *
 *   consent_records:  ip_address → NULL, metadata → '{}'::jsonb,
 *                     revocation_reason → NULL.
 *     KEEP byte-identical: id, user_id, consent_type, consented,
 *     consented_at, created_at, updated_at, revoked_at, revoked_by.
 *   consent_history:  ip_address → NULL, user_agent → NULL.
 *     KEEP byte-identical: id, consent_record_id, user_id,
 *     consent_type, previous_value, new_value, changed_at, changed_by.
 *
 *   REDACT, NEVER DELETE: the consent FACT survives per K-1 (Art. 7(1)
 *   demonstrability is per-subject — user_id / consent_record_id stay;
 *   kept rows remain LINKABLE personal data under K-1's clock, OPEN —
 *   counsel, never "anonymised"). Deleting consent_records rows would
 *   CASCADE consent_history (mig 133) — both tables' facts survive.
 *   NAMED RESIDUAL (kept, disclosed, never silent): the actor FKs
 *   revoked_by / changed_by are KEPT (the actor's accountability data,
 *   not the subject's device metadata; GAP-D actor_email precedent) —
 *   named in gapH.actorFkResidualColumns and counted in
 *   gapH.actorFkResidual.
 *   OUT OF SCOPE, untouched: consent_receipts (244 family,
 *   hash/linkage-only) and consent_texts (reference data).
 *
 *   HOLD GATE (post-#799 pattern, NOT the recording_consent site's
 *   entry-gate-only shape): per-row consult at each new site —
 *   findActiveHold({ userId }, queryable) per row (these tables carry
 *   no company_id; the subject shape is the only derivation that
 *   exists), three-way partition per table (redacted /
 *   held-preserved / lookup-failure-preserved), fail-closed on any
 *   throw. gapH carries per-table counts only (§4.1 — no values).
 *
 *   PR-GATE FIX ROUND (database-reviewer BLOCK, proven on real PG):
 *   both production callers run erasePersonalData inside BEGIN…COMMIT
 *   on one client, so a throwing consult ABORTS the transaction —
 *   the next statement throws 25P02, the caller rolls back, and the
 *   lookup-failure partition never completes. Each per-row consult is
 *   therefore wrapped in a SAVEPOINT on the same queryable: SAVEPOINT
 *   before the consult, RELEASE on success, ROLLBACK TO SAVEPOINT
 *   (then RELEASE) on throw → row counted lookup-failed, erasure
 *   continues and COMPLETES. No-surrounding-transaction callers:
 *   SAVEPOINT itself errors 25P01 in autocommit (PG 16, verified) —
 *   that code is the probe: the consult then runs bare, because in
 *   autocommit each statement is its own implicit transaction and a
 *   throw cannot poison later statements. Any other SAVEPOINT error
 *   (e.g. 25P02 — the caller's transaction was already aborted)
 *   propagates: the pre-existing fail-closed abort is preserved.
 *
 *   PLACEMENT: adjacent to the shipped S-078 recording_consent
 *   redaction, following its statement idiom.
 *
 * Modelled on gap-g-erasure.test.js (SQL-routing fake). Mocked suite:
 * real-DB verification comes at the PR gate (database reviewer).
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn(),
}));
jest.mock('../../../lib/file-storage', () => ({
	deleteFile: jest.fn().mockResolvedValue({ deleted: true }),
}));
jest.mock('../../../services/encryption', () => ({
	deleteEncryptedFile: jest.fn(),
}));
jest.mock('@aws-sdk/client-s3', () => ({
	S3Client: jest.fn(),
	PutObjectCommand: jest.fn(),
	GetObjectCommand: jest.fn(),
	DeleteObjectCommand: jest.fn(),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const erasureService = require('../../../lib/erasureService');
const { LegalHoldError } = require('../../../lib/legalHold');

// ─── Scenario-driven SQL router ─────────────────────────────────────────────
// GAP-H hold consults are the FIRST per-row consults in erasePersonalData
// (the block sits directly after the recording_consent redaction, before
// the #780 block): the entry gate is legal-hold call #1, and each GAP-H
// row consumes the next entry of scenario.gapHHoldActions in row order
// (consent_records rows first, then consent_history rows). Once the queue
// is empty, hold lookups read as no-hold (every later family in these
// scenarios returns no rows, so no later consult consumes the queue).
function makeClient(scenario = {}) {
	const s = {
		consentRecords: [],
		consentHistory: [],
		gapHHoldActions: [],
		gateHeld: false,
		anyHold: false,
		savepointErrorCode: null,
		...scenario,
	};
	const holdActions = [...s.gapHHoldActions];
	let holdCalls = 0;
	const client = { query: jest.fn() };
	client.query.mockImplementation(async (sql, params = []) => {
		// Savepoint-containment probe (PR-gate fix round): SAVEPOINT /
		// RELEASE / ROLLBACK TO succeed generically, unless the scenario
		// simulates the autocommit probe failure (25P01) or another
		// SAVEPOINT error — only the SAVEPOINT statement itself throws.
		if (/^SAVEPOINT/i.test(sql) && s.savepointErrorCode) {
			const err = new Error('SAVEPOINT can only be used in transaction blocks');
			err.code = s.savepointErrorCode;
			throw err;
		}
		if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/i.test(sql)) {
			return { rows: [], rowCount: 0 };
		}
		// anyHoldActive(): its own parameterless legal_holds probe.
		if (/SELECT id FROM legal_holds WHERE released_at IS NULL LIMIT 1/i.test(sql)) {
			return s.anyHold ? { rows: [{ id: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
		}
		// Legal holds: entry gate (#1) + per-row consults.
		if (/FROM legal_holds/i.test(sql)) {
			holdCalls++;
			if (holdCalls === 1) {
				return s.gateHeld
					? { rows: [{ id: 42, user_id: 7, company_id: null }], rowCount: 1 }
					: { rows: [], rowCount: 0 };
			}
			const action = holdActions.length > 0 ? holdActions.shift() : 'none';
			if (action === 'error') throw new Error('legal-hold lookup unavailable');
			if (action === 'held') {
				return { rows: [{ id: 99, user_id: 7, company_id: null }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		}
		// Writes first (an UPDATE's target must not be mistaken for a SELECT).
		const writeMatch = sql.match(/(?:DELETE FROM|UPDATE)\s+(\w+)/i);
		if (writeMatch) {
			const arr = params.find((p) => Array.isArray(p));
			return { rows: [], rowCount: arr ? arr.length : 1 };
		}
		// GAP-H selects.
		if (/FROM consent_records/i.test(sql)) {
			return { rows: s.consentRecords, rowCount: s.consentRecords.length };
		}
		if (/FROM consent_history/i.test(sql)) {
			return { rows: s.consentHistory, rowCount: s.consentHistory.length };
		}
		// Everything else in the shipped sequence: generic success, no rows.
		return { rows: [], rowCount: 1 };
	});
	return client;
}

function callsMatching(client, re) {
	return client.query.mock.calls.filter(([sql]) => re.test(sql));
}
function callIndex(client, re) {
	return client.query.mock.calls.findIndex(([sql]) => re.test(sql));
}
// Containment-sequence view of the GAP-H window (from the
// consent_records SELECT up to, excluding, the #780 job_applications
// SELECT): classifies each statement so tests can pin the exact
// SAVEPOINT / consult / RELEASE / ROLLBACK-TO order per row.
function gapHEvents(client) {
	const sqls = client.query.mock.calls.map(([sql]) => sql);
	const start = sqls.findIndex((s) => /SELECT id, revoked_by FROM consent_records/i.test(s));
	const end = sqls.findIndex((s, i) => i > start && /FROM job_applications/i.test(s));
	return sqls.slice(start, end === -1 ? undefined : end).map((s) => {
		if (/^ROLLBACK TO SAVEPOINT/i.test(s)) return 'ROLLBACK_TO';
		if (/^RELEASE SAVEPOINT/i.test(s)) return 'RELEASE';
		if (/^SAVEPOINT/i.test(s)) return 'SAVEPOINT';
		if (/FROM legal_holds/i.test(s)) return 'HOLD';
		if (/SELECT id, revoked_by FROM consent_records/i.test(s)) return 'SELECT_RECORDS';
		if (/SELECT id, changed_by FROM consent_history/i.test(s)) return 'SELECT_HISTORY';
		if (/UPDATE consent_records/i.test(s)) return 'UPDATE_RECORDS';
		if (/UPDATE consent_history/i.test(s)) return 'UPDATE_HISTORY';
		return `OTHER:${s.slice(0, 60)}`;
	});
}
const recordsUpdateRe = /UPDATE consent_records/i;
const historyUpdateRe = /UPDATE consent_history/i;

function fullScenario() {
	return {
		consentRecords: [
			{ id: 11, revoked_by: 42 },
			{ id: 12, revoked_by: null },
		],
		consentHistory: [
			{ id: 21, changed_by: 43 },
			{ id: 22, changed_by: null },
			{ id: 23, changed_by: 44 },
		],
	};
}

describe('#1127 GAP-H erasePersonalData — consent IP/UA redaction (K-1)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('redacts both tables with the ruled per-table field sets, counted in gapH, placed adjacent to the recording_consent redaction', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		const recUpdate = callsMatching(client, recordsUpdateRe);
		expect(recUpdate).toHaveLength(1);
		expect(recUpdate[0][0]).toMatch(/ip_address = NULL/);
		expect(recUpdate[0][0]).toMatch(/metadata = '\{\}'::jsonb/);
		expect(recUpdate[0][0]).toMatch(/revocation_reason = NULL/);
		expect(recUpdate[0][0]).toMatch(/WHERE user_id = \$1 AND id = ANY\(\$2\)/);
		expect(recUpdate[0][1]).toEqual([7, [11, 12]]);

		const histUpdate = callsMatching(client, historyUpdateRe);
		expect(histUpdate).toHaveLength(1);
		expect(histUpdate[0][0]).toMatch(/ip_address = NULL/);
		expect(histUpdate[0][0]).toMatch(/user_agent = NULL/);
		expect(histUpdate[0][0]).toMatch(/WHERE user_id = \$1 AND id = ANY\(\$2\)/);
		expect(histUpdate[0][1]).toEqual([7, [21, 22, 23]]);

		expect(result.gapH).toMatchObject({
			consentRecordsRedacted: 2,
			consentRecordsHeld: 0,
			consentRecordsLookupFailed: 0,
			consentHistoryRedacted: 3,
			consentHistoryHeld: 0,
			consentHistoryLookupFailed: 0,
			rowsHeld: 0,
			holdLookupFailed: 0,
			heldTables: [],
			lookupFailedTables: [],
		});
		// Placement pin (STOP 1): after the S-078 recording_consent
		// redaction, before the #780 job_applications block.
		expect(callIndex(client, recordsUpdateRe)).toBeGreaterThan(
			callIndex(client, /UPDATE recording_consent/i),
		);
		expect(callIndex(client, recordsUpdateRe)).toBeLessThan(
			callIndex(client, /FROM job_applications/i),
		);
	});

	test('per-table field sets are NOT symmetric: consent_records has no user_agent to redact; consent_history has no metadata/revocation_reason', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		// mig 013/133 verified at STOP 1: asserting a user_agent
		// assignment here would be asserting a column that does not exist.
		expect(callsMatching(client, recordsUpdateRe)[0][0]).not.toMatch(/user_agent/);
		const histSql = callsMatching(client, historyUpdateRe)[0][0];
		expect(histSql).not.toMatch(/metadata/);
		expect(histSql).not.toMatch(/revocation_reason/);
	});

	test('over-redaction traps: NO delete on either table, NO keep column in either UPDATE, NO NOW() churn', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		// Row counts unchanged: rows are redacted in place, never
		// deleted (a consent_records DELETE would CASCADE history).
		expect(callsMatching(client, /DELETE FROM consent_records/i)).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM consent_history/i)).toHaveLength(0);

		// Every KEEP column byte-identical ⇒ it appears in no UPDATE.
		const recSql = callsMatching(client, recordsUpdateRe)[0][0];
		for (const keep of [
			'consent_type',
			'consented',
			'consented_at',
			'created_at',
			'updated_at',
			'revoked_at',
			'revoked_by',
		]) {
			expect(recSql).not.toMatch(new RegExp(keep));
		}
		expect(recSql).not.toMatch(/NOW\(\)/);
		const histSql = callsMatching(client, historyUpdateRe)[0][0];
		for (const keep of [
			'consent_record_id',
			'consent_type',
			'previous_value',
			'new_value',
			'changed_at',
			'changed_by',
		]) {
			expect(histSql).not.toMatch(new RegExp(keep));
		}
		expect(histSql).not.toMatch(/NOW\(\)/);
	});

	test('named residual: actor FKs revoked_by / changed_by are KEPT — named in the result and counted, never redacted', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		expect(result.gapH.actorFkResidualColumns).toEqual([
			'consent_records.revoked_by',
			'consent_history.changed_by',
		]);
		// Rows carrying a non-NULL actor FK: records #11, history #21 + #23.
		expect(result.gapH.actorFkResidual).toBe(3);
		// The FK columns themselves are assigned nowhere.
		expect(callsMatching(client, recordsUpdateRe)[0][0]).not.toMatch(/revoked_by\s*=/);
		expect(callsMatching(client, historyUpdateRe)[0][0]).not.toMatch(/changed_by\s*=/);
	});

	test('per-row hold: a held consent_records row is NOT redacted, is counted and named; the unheld rows still redact', async () => {
		const client = makeClient({
			...fullScenario(),
			gapHHoldActions: ['held', 'none', 'none', 'none', 'none'],
		});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, recordsUpdateRe)[0][1]).toEqual([7, [12]]);
		expect(callsMatching(client, historyUpdateRe)[0][1]).toEqual([7, [21, 22, 23]]);
		expect(result.gapH).toMatchObject({
			consentRecordsRedacted: 1,
			consentRecordsHeld: 1,
			consentHistoryRedacted: 3,
			rowsHeld: 1,
			heldTables: ['consent_records'],
			holdLookupFailed: 0,
			lookupFailedTables: [],
		});
	});

	test('hold-lookup SABOTAGE: a throwing consult lands in the third bucket — row preserved, counted separately, NOT in heldTables', async () => {
		const client = makeClient({
			...fullScenario(),
			gapHHoldActions: ['none', 'none', 'none', 'error', 'none'],
		});
		const result = await erasureService.erasePersonalData(7, { client });

		// History row #22 (the 4th GAP-H consult) failed lookup ⇒ excluded.
		expect(callsMatching(client, historyUpdateRe)[0][1]).toEqual([7, [21, 23]]);
		expect(callsMatching(client, recordsUpdateRe)[0][1]).toEqual([7, [11, 12]]);
		expect(result.gapH).toMatchObject({
			consentHistoryRedacted: 2,
			consentHistoryHeld: 0,
			consentHistoryLookupFailed: 1,
			holdLookupFailed: 1,
			lookupFailedTables: ['consent_history'],
			rowsHeld: 0,
			heldTables: [],
		});
		// Containment (PR-gate fix round): EVERY GAP-H consult is wrapped
		// SAVEPOINT…RELEASE; the throwing consult (history row #22) is
		// contained by ROLLBACK_TO + RELEASE, and the erasure then
		// COMPLETES — history row #23 is still consulted and the UPDATE
		// still runs. Without the savepoint, the throw would abort the
		// caller's transaction (25P02) and none of this could follow.
		expect(gapHEvents(client)).toEqual([
			'SELECT_RECORDS',
			'SAVEPOINT', 'HOLD', 'RELEASE',
			'SAVEPOINT', 'HOLD', 'RELEASE',
			'UPDATE_RECORDS',
			'SELECT_HISTORY',
			'SAVEPOINT', 'HOLD', 'RELEASE',
			'SAVEPOINT', 'HOLD', 'ROLLBACK_TO', 'RELEASE',
			'SAVEPOINT', 'HOLD', 'RELEASE',
			'UPDATE_HISTORY',
		]);
	});

	test('per-row hold (cross-posture): a held consent_history row is NOT redacted, is counted in consentHistoryHeld and named; the unheld rows still redact', async () => {
		const client = makeClient({
			...fullScenario(),
			gapHHoldActions: ['none', 'none', 'held', 'none', 'none'],
		});
		const result = await erasureService.erasePersonalData(7, { client });

		// History row #21 (the 3rd GAP-H consult) is held ⇒ excluded.
		expect(callsMatching(client, historyUpdateRe)[0][1]).toEqual([7, [22, 23]]);
		expect(callsMatching(client, recordsUpdateRe)[0][1]).toEqual([7, [11, 12]]);
		expect(result.gapH).toMatchObject({
			consentRecordsRedacted: 2,
			consentRecordsHeld: 0,
			consentRecordsLookupFailed: 0,
			consentHistoryRedacted: 2,
			consentHistoryHeld: 1,
			consentHistoryLookupFailed: 0,
			rowsHeld: 1,
			heldTables: ['consent_history'],
			holdLookupFailed: 0,
			lookupFailedTables: [],
		});
	});

	test('hold-lookup SABOTAGE (cross-posture): a throwing consult on a consent_records row lands in consentRecordsLookupFailed — row preserved, counted separately, NOT in heldTables', async () => {
		const client = makeClient({
			...fullScenario(),
			gapHHoldActions: ['none', 'error', 'none', 'none', 'none'],
		});
		const result = await erasureService.erasePersonalData(7, { client });

		// Records row #12 (the 2nd GAP-H consult) failed lookup ⇒ excluded.
		expect(callsMatching(client, recordsUpdateRe)[0][1]).toEqual([7, [11]]);
		expect(callsMatching(client, historyUpdateRe)[0][1]).toEqual([7, [21, 22, 23]]);
		expect(result.gapH).toMatchObject({
			consentRecordsRedacted: 1,
			consentRecordsHeld: 0,
			consentRecordsLookupFailed: 1,
			consentHistoryRedacted: 3,
			consentHistoryHeld: 0,
			consentHistoryLookupFailed: 0,
			rowsHeld: 0,
			heldTables: [],
			holdLookupFailed: 1,
			lookupFailedTables: ['consent_records'],
		});
		// Containment, cross-posture (records table): the throwing
		// consult (records row #12) is ROLLBACK_TO-contained, and the
		// erasure COMPLETES — the records UPDATE and the whole history
		// family still execute afterwards.
		expect(gapHEvents(client)).toEqual([
			'SELECT_RECORDS',
			'SAVEPOINT', 'HOLD', 'RELEASE',
			'SAVEPOINT', 'HOLD', 'ROLLBACK_TO', 'RELEASE',
			'UPDATE_RECORDS',
			'SELECT_HISTORY',
			'SAVEPOINT', 'HOLD', 'RELEASE',
			'SAVEPOINT', 'HOLD', 'RELEASE',
			'SAVEPOINT', 'HOLD', 'RELEASE',
			'UPDATE_HISTORY',
		]);
	});

	test('containment success path: every GAP-H consult is wrapped SAVEPOINT…RELEASE and NO rollback-to is issued', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		expect(gapHEvents(client)).toEqual([
			'SELECT_RECORDS',
			'SAVEPOINT', 'HOLD', 'RELEASE',
			'SAVEPOINT', 'HOLD', 'RELEASE',
			'UPDATE_RECORDS',
			'SELECT_HISTORY',
			'SAVEPOINT', 'HOLD', 'RELEASE',
			'SAVEPOINT', 'HOLD', 'RELEASE',
			'SAVEPOINT', 'HOLD', 'RELEASE',
			'UPDATE_HISTORY',
		]);
		expect(callsMatching(client, /^ROLLBACK TO SAVEPOINT/i)).toHaveLength(0);
	});

	test('autocommit guard: SAVEPOINT probe fails 25P01 (no surrounding transaction) ⇒ consults run bare and the erasure still completes with the three-way partition', async () => {
		const client = makeClient({
			...fullScenario(),
			savepointErrorCode: '25P01',
			gapHHoldActions: ['none', 'error', 'none', 'none', 'none'],
		});
		const result = await erasureService.erasePersonalData(7, { client });

		// In bare mode the SAVEPOINT probe is attempted per row but no
		// RELEASE / ROLLBACK TO ever follows — and none is needed: in
		// autocommit a throwing consult cannot poison later statements
		// (each is its own implicit transaction).
		expect(callsMatching(client, /^SAVEPOINT/i)).toHaveLength(5);
		expect(callsMatching(client, /^RELEASE SAVEPOINT/i)).toHaveLength(0);
		expect(callsMatching(client, /^ROLLBACK TO SAVEPOINT/i)).toHaveLength(0);
		expect(gapHEvents(client)).toEqual([
			'SELECT_RECORDS',
			'SAVEPOINT', 'HOLD',
			'SAVEPOINT', 'HOLD',
			'UPDATE_RECORDS',
			'SELECT_HISTORY',
			'SAVEPOINT', 'HOLD',
			'SAVEPOINT', 'HOLD',
			'SAVEPOINT', 'HOLD',
			'UPDATE_HISTORY',
		]);
		// The throwing bare consult still lands in the third bucket and
		// the erasure completes with correct counters.
		expect(callsMatching(client, recordsUpdateRe)[0][1]).toEqual([7, [11]]);
		expect(result.gapH).toMatchObject({
			consentRecordsRedacted: 1,
			consentRecordsLookupFailed: 1,
			consentHistoryRedacted: 3,
			holdLookupFailed: 1,
			lookupFailedTables: ['consent_records'],
		});
	});

	test('savepoint probe failure with a NON-25P01 code is not swallowed: the erasure aborts fail-closed (e.g. caller transaction already aborted)', async () => {
		const client = makeClient({
			...fullScenario(),
			savepointErrorCode: '25P02',
		});
		const err = await erasureService.erasePersonalData(7, { client }).catch((e) => e);

		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe('25P02');
		expect(callsMatching(client, recordsUpdateRe)).toHaveLength(0);
		expect(callsMatching(client, historyUpdateRe)).toHaveLength(0);
	});

	test('all rows held/failed in a table ⇒ no UPDATE is issued against that table at all', async () => {
		const client = makeClient({
			consentRecords: [{ id: 11, revoked_by: null }],
			consentHistory: [{ id: 21, changed_by: null }],
			gapHHoldActions: ['held', 'error'],
		});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, recordsUpdateRe)).toHaveLength(0);
		expect(callsMatching(client, historyUpdateRe)).toHaveLength(0);
		expect(result.gapH).toMatchObject({
			consentRecordsRedacted: 0,
			consentRecordsHeld: 1,
			consentHistoryRedacted: 0,
			consentHistoryLookupFailed: 1,
			rowsHeld: 1,
			holdLookupFailed: 1,
			heldTables: ['consent_records'],
			lookupFailedTables: ['consent_history'],
		});
	});

	test('whole-erasure gate: a held USER aborts before the GAP-H block — no consent UPDATE runs (entry gate)', async () => {
		const client = makeClient({ ...fullScenario(), gateHeld: true });
		const err = await erasureService.erasePersonalData(7, { client }).catch((e) => e);

		expect(err).toBeInstanceOf(LegalHoldError);
		expect(callsMatching(client, recordsUpdateRe)).toHaveLength(0);
		expect(callsMatching(client, historyUpdateRe)).toHaveLength(0);
	});

	test('out of scope, untouched: no statement against consent_receipts or consent_texts', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /consent_receipts/i)).toHaveLength(0);
		expect(callsMatching(client, /consent_texts/i)).toHaveLength(0);
	});

	test('§4.1: the gapH result carries counts only — no PII value, no identifier-derived value anywhere', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		const serialised = JSON.stringify(result.gapH);
		expect(serialised).not.toContain('203.0.113.');
		expect(serialised).not.toContain('Mozilla');
		for (const [key, value] of Object.entries(result.gapH)) {
			expect(key).not.toMatch(/hash|hmac|marker/i);
			if (Array.isArray(value)) {
				for (const entry of value) expect(typeof entry).toBe('string');
			} else {
				expect(typeof value).toBe('number');
			}
		}
	});

	test('user with no consent rows: no GAP-H writes, all counts zero, residual columns still named', async () => {
		const client = makeClient({});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, recordsUpdateRe)).toHaveLength(0);
		expect(callsMatching(client, historyUpdateRe)).toHaveLength(0);
		expect(result.gapH).toMatchObject({
			consentRecordsRedacted: 0,
			consentRecordsHeld: 0,
			consentRecordsLookupFailed: 0,
			consentHistoryRedacted: 0,
			consentHistoryHeld: 0,
			consentHistoryLookupFailed: 0,
			rowsHeld: 0,
			holdLookupFailed: 0,
			heldTables: [],
			lookupFailedTables: [],
			actorFkResidual: 0,
			actorFkResidualColumns: ['consent_records.revoked_by', 'consent_history.changed_by'],
		});
	});
});
