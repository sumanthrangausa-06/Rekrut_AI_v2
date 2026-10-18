/**
 * #1121 GAP-B (E-2/E-14): Erasure completeness — score & assessment
 * leftovers.
 *
 * erasePersonalData() previously had ZERO references to this family:
 * account deletion tombstones the users row, so the migrations'
 * ON DELETE CASCADEs never fire and every row below survived erasure.
 * STOP 1 (issue #1121, comment 6168242589):
 *
 *   HARD DELETE (no skeleton, no redaction, no migration):
 *   score_snapshots, omniscore_results, score_appeals (by user_id);
 *   mutual_matches (by candidate_id, hold-partitioned on the row's own
 *   company_id); screening_logs (by candidate_id, company derived via
 *   job_id → jobs.company_id); skill_assessments (by user_id, BEFORE
 *   assessment_sessions); job_assessment_attempts (by candidate_id,
 *   company derived via assessment → job → company, fallback
 *   application → company) with assessment_conversations deleted
 *   EXPLICITLY + counted by unheld attempt ids BEFORE the parent;
 *   assessment_sessions (by user_id, company derived via job_id) with
 *   assessment_events deleted EXPLICITLY + counted by unheld session
 *   ids BEFORE the parent. Children follow their parent's hold
 *   partition exactly — cascades are never assumed.
 *   LEGAL HOLD: whole-erasure gate first (shipped), then a per-row
 *   findActiveHold({userId, companyId}) consult per family, fail-closed
 *   on lookup error (row skipped, counted in gapB.holdLookupFailed,
 *   table named in gapB.lookupFailedTables — #1154 truthfulness;
 *   gapB.rowsHeld/heldTables name GENUINE holds only, #1116 disclosure).
 *   GHOST TABLES: omniscore_results and mutual_matches have zero
 *   in-repo writers (STOP 1 §3) — the DELETEs are still issued.
 *
 * #1340: assessment_results (migration 270) joins this family — same
 * shape (user_id only, no company_id, no child FKs, no writers),
 * Lex classification ERASE under legal hold (STOP 1, issue #1340,
 * comment 6245744960): migration 013's 1825-day registry row is a
 * retention-purge rule for live accounts, not a keep-after-erasure
 * classification. Its per-row consult is findActiveHold({userId,
 * companyId: null}) — identical to skill_assessments.
 *
 * Modelled on gap-d-erasure.test.js (SQL-routing fake). Mocked suite:
 * real-DB verification is staging-QA-carried (STOP 1 §5).
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
function makeClient(scenario = {}) {
	const s = {
		scoreSnapshots: [],
		omniscoreResults: [],
		scoreAppeals: [],
		mutualMatches: [],
		screeningLogs: [],
		skillAssessments: [],
		assessmentResults: [],
		// #1340: user-scoped (null-company) hold behaviour for the
		// post-gate consults of company-less families. The whole-erasure
		// gate is the FIRST legal_holds query; these counters apply to
		// the next N null-company consults only, so later families in
		// the long erasure flow keep their default no-hold behaviour.
		// ROTATION HAZARD (privacy review, PR for #1340): the #1340
		// held/failed tests assume assessment_results' consults are the
		// FIRST post-gate null-company consults — true only while no
		// company-less family with rows in those focused scenarios runs
		// earlier in the flow. If the call is ever moved, or an earlier
		// company-less family gains rows there, make the consults
		// unambiguous (scenario-key the router) instead of counting.
		holdNullCompanyConsults: 0,
		errorNullCompanyConsults: 0,
		attempts: [],
		conversations: [],
		sessions: [],
		events: [],
		heldCompanies: new Set(),
		errorCompanies: new Set(),
		gateHeld: false,
		deleteCounts: {},
		...scenario,
	};
	const client = { query: jest.fn() };
	let legalHoldCalls = 0;
	let nullCompanyConsults = 0;
	client.query.mockImplementation(async (sql, params = []) => {
		// Legal holds: entry gate + per-row consults.
		// findActiveHold params: [uid, explicitCompanyId, sessionCompanyId].
		if (/FROM legal_holds/i.test(sql)) {
			legalHoldCalls++;
			if (s.gateHeld) {
				return { rows: [{ id: 42, user_id: 7, company_id: null }], rowCount: 1 };
			}
			const companyId = params[1];
			if (companyId == null && legalHoldCalls > 1) {
				nullCompanyConsults++;
				if (nullCompanyConsults <= (s.errorNullCompanyConsults || 0)) {
					throw new Error('legal-hold lookup unavailable');
				}
				if (nullCompanyConsults <= (s.holdNullCompanyConsults || 0)) {
					return { rows: [{ id: 98, user_id: 7, company_id: null }], rowCount: 1 };
				}
			}
			if (companyId != null) {
				if (s.errorCompanies.has(companyId)) {
					throw new Error('legal-hold lookup unavailable');
				}
				if (s.heldCompanies.has(companyId)) {
					return { rows: [{ id: 99, user_id: null, company_id: companyId }], rowCount: 1 };
				}
			}
			return { rows: [], rowCount: 0 };
		}
		// Writes first (a DELETE's FROM must not be mistaken for a SELECT).
		const writeMatch = sql.match(/(?:DELETE FROM|UPDATE)\s+(\w+)/i);
		if (writeMatch) {
			const table = writeMatch[1];
			if (s.deleteCounts[table] != null) return { rows: [], rowCount: s.deleteCounts[table] };
			const arr = params.find((p) => Array.isArray(p));
			return { rows: [], rowCount: arr ? arr.length : 1 };
		}
		// GAP-B selects (match the driving FROM table).
		if (/FROM score_snapshots/i.test(sql)) return { rows: s.scoreSnapshots, rowCount: s.scoreSnapshots.length };
		if (/FROM omniscore_results/i.test(sql)) return { rows: s.omniscoreResults, rowCount: s.omniscoreResults.length };
		if (/FROM score_appeals/i.test(sql)) return { rows: s.scoreAppeals, rowCount: s.scoreAppeals.length };
		if (/FROM mutual_matches/i.test(sql)) return { rows: s.mutualMatches, rowCount: s.mutualMatches.length };
		if (/FROM screening_logs/i.test(sql)) return { rows: s.screeningLogs, rowCount: s.screeningLogs.length };
		if (/FROM skill_assessments/i.test(sql)) return { rows: s.skillAssessments, rowCount: s.skillAssessments.length };
		if (/FROM assessment_results/i.test(sql)) return { rows: s.assessmentResults, rowCount: s.assessmentResults.length };
		if (/FROM assessment_conversations/i.test(sql)) return { rows: s.conversations, rowCount: s.conversations.length };
		if (/FROM job_assessment_attempts/i.test(sql)) return { rows: s.attempts, rowCount: s.attempts.length };
		if (/FROM assessment_events/i.test(sql)) return { rows: s.events, rowCount: s.events.length };
		if (/FROM assessment_sessions/i.test(sql)) return { rows: s.sessions, rowCount: s.sessions.length };
		// Everything else in the pre-#1121 sequence: generic success.
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

const GAP_B_TABLES = [
	'score_snapshots',
	'omniscore_results',
	'score_appeals',
	'mutual_matches',
	'screening_logs',
	'skill_assessments',
	'assessment_results',
	'job_assessment_attempts',
	'assessment_conversations',
	'assessment_sessions',
	'assessment_events',
];

function fullScenario() {
	return {
		scoreSnapshots: [{ id: 11 }, { id: 12 }],
		omniscoreResults: [{ id: 21 }],
		scoreAppeals: [{ id: 31 }],
		// Row 42 sits under a company-99 hold → preserved.
		mutualMatches: [
			{ id: 41, company_id: 3 },
			{ id: 42, company_id: 99 },
		],
		screeningLogs: [
			{ id: 51, company_id: 3 },
			{ id: 52, company_id: null },
		],
		skillAssessments: [{ id: 61 }, { id: 62 }],
		assessmentResults: [{ id: 201 }, { id: 202 }],
		// Attempt 72 sits under the company-99 hold → preserved, and its
		// conversation (82) follows the parent's partition.
		attempts: [
			{ id: 71, company_id: 3 },
			{ id: 72, company_id: 99 },
		],
		conversations: [
			{ id: 81, attempt_id: 71 },
			{ id: 82, attempt_id: 72 },
			{ id: 83, attempt_id: 71 },
		],
		deleteCounts: { assessment_conversations: 2 },
		sessions: [
			{ id: 91, company_id: 3 },
			{ id: 92, company_id: null },
		],
		events: [
			{ id: 101, session_id: 91 },
			{ id: 102, session_id: 92 },
		],
		heldCompanies: new Set([99]),
	};
}

describe('#1121 GAP-B erasePersonalData — score & assessment leftovers', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('hard-deletes every in-scope table with per-table counts in gapB (ghost tables included)', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		for (const table of GAP_B_TABLES) {
			expect(callsMatching(client, new RegExp(`DELETE FROM ${table}`, 'i'))).toHaveLength(1);
		}
		expect(result.gapB).toMatchObject({
			scoreSnapshots: 2,
			omniscoreResults: 1,
			scoreAppeals: 1,
			mutualMatches: 1,
			screeningLogs: 2,
			skillAssessments: 2,
			assessmentResults: 2,
			jobAssessmentAttempts: 1,
			assessmentConversations: 2,
			assessmentSessions: 2,
			assessmentEvents: 2,
		});
		// Held survivals disclosed: mutual_matches row 42, attempt 72,
		// and attempt 72's conversation 82.
		expect(result.gapB.rowsHeld).toBe(3);
		expect(result.gapB.heldTables).toEqual(
			expect.arrayContaining(['mutual_matches', 'job_assessment_attempts', 'assessment_conversations']),
		);
		// No UPDATE/redact against any in-scope table (DELETE only).
		for (const table of GAP_B_TABLES) {
			expect(callsMatching(client, new RegExp(`UPDATE ${table}`, 'i'))).toHaveLength(0);
		}
	});

	test('delete ORDER: children before parents; skill_assessments before assessment_sessions', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		const conv = callIndex(client, /DELETE FROM assessment_conversations/i);
		const attempts = callIndex(client, /DELETE FROM job_assessment_attempts/i);
		const events = callIndex(client, /DELETE FROM assessment_events/i);
		const sessions = callIndex(client, /DELETE FROM assessment_sessions/i);
		const skills = callIndex(client, /DELETE FROM skill_assessments/i);
		expect(conv).toBeGreaterThan(-1);
		expect(conv).toBeLessThan(attempts);
		expect(events).toBeGreaterThan(-1);
		expect(events).toBeLessThan(sessions);
		expect(skills).toBeGreaterThan(-1);
		expect(skills).toBeLessThan(sessions);
		// Children deleted explicitly by UNHELD parent ids only.
		const convCall = callsMatching(client, /DELETE FROM assessment_conversations/i)[0];
		expect(convCall[0]).toMatch(/attempt_id = ANY/i);
		expect(convCall[1]).toEqual([[71]]);
		const eventCall = callsMatching(client, /DELETE FROM assessment_events/i)[0];
		expect(eventCall[0]).toMatch(/session_id = ANY/i);
		expect(eventCall[1]).toEqual([[91, 92]]);
	});

	test('held-company rows preserved + counted + named (direct company on mutual_matches, derived on screening_logs / attempts / sessions)', async () => {
		const scenario = {
			mutualMatches: [{ id: 41, company_id: 99 }],
			screeningLogs: [
				{ id: 51, company_id: 99 },
				{ id: 52, company_id: 3 },
			],
			attempts: [{ id: 71, company_id: 99 }],
			conversations: [{ id: 81, attempt_id: 71 }],
			sessions: [
				{ id: 91, company_id: 99 },
				{ id: 92, company_id: 3 },
			],
			events: [
				{ id: 101, session_id: 91 },
				{ id: 102, session_id: 92 },
			],
			heldCompanies: new Set([99]),
		};
		const client = makeClient(scenario);
		const result = await erasureService.erasePersonalData(7, { client });

		// Per-row consults carried company 99.
		const holdCalls = callsMatching(client, /FROM legal_holds/i);
		expect(holdCalls.some(([, p]) => p[0] === 7 && p[1] === 99)).toBe(true);

		// Fully-held families issue no DELETE at all.
		expect(callsMatching(client, /DELETE FROM mutual_matches/i)).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM job_assessment_attempts/i)).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM assessment_conversations/i)).toHaveLength(0);
		// Partially-held families delete only the unheld ids.
		expect(callsMatching(client, /DELETE FROM screening_logs/i)[0][1]).toEqual([7, [52]]);
		expect(callsMatching(client, /DELETE FROM assessment_sessions/i)[0][1]).toEqual([7, [92]]);
		expect(callsMatching(client, /DELETE FROM assessment_events/i)[0][1]).toEqual([[92]]);

		expect(result.gapB).toMatchObject({
			mutualMatches: 0,
			screeningLogs: 1,
			jobAssessmentAttempts: 0,
			assessmentConversations: 0,
			assessmentSessions: 1,
			assessmentEvents: 1,
		});
		// Held: mutual 41, screening 51, attempt 71, conversation 81,
		// session 91, event 101.
		expect(result.gapB.rowsHeld).toBe(6);
		expect(result.gapB.heldTables).toEqual(
			expect.arrayContaining([
				'mutual_matches',
				'screening_logs',
				'job_assessment_attempts',
				'assessment_conversations',
				'assessment_sessions',
				'assessment_events',
			]),
		);
	});

	test('per-row hold-lookup failure fails closed: row skipped + counted as lookup-failed (#1154 — never as held), erasure does not throw', async () => {
		const scenario = {
			screeningLogs: [
				{ id: 51, company_id: 4 },
				{ id: 52, company_id: 3 },
			],
			errorCompanies: new Set([4]),
		};
		const client = makeClient(scenario);
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /DELETE FROM screening_logs/i)[0][1]).toEqual([7, [52]]);
		expect(result.gapB.screeningLogs).toBe(1);
		// #1154 truthfulness: preserved, but NOT a legal hold.
		expect(result.gapB.rowsHeld).toBe(0);
		expect(result.gapB.heldTables).toEqual([]);
		expect(result.gapB.holdLookupFailed).toBe(1);
		expect(result.gapB.lookupFailedTables).toEqual(['screening_logs']);
	});

	test('#1154 child split: conversations of a lookup-failed attempt count as lookup-failed, never as held', async () => {
		const scenario = {
			attempts: [
				{ id: 71, company_id: 4 },
				{ id: 73, company_id: 3 },
			],
			conversations: [
				{ id: 81, attempt_id: 71 },
				{ id: 83, attempt_id: 73 },
			],
			errorCompanies: new Set([4]),
		};
		const client = makeClient(scenario);
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /DELETE FROM assessment_conversations/i)[0][1]).toEqual([[73]]);
		expect(callsMatching(client, /DELETE FROM job_assessment_attempts/i)[0][1]).toEqual([7, [73]]);
		expect(result.gapB.jobAssessmentAttempts).toBe(1);
		expect(result.gapB.holdLookupFailed).toBe(2);
		expect(result.gapB.lookupFailedTables).toEqual([
			'job_assessment_attempts',
			'assessment_conversations',
		]);
		expect(result.gapB.rowsHeld).toBe(0);
		expect(result.gapB.heldTables).toEqual([]);
	});

	test('#1340 assessment_results: user-scoped (null-company) hold preserves rows + counts them held, never deleted', async () => {
		// assessment_results rows carry no company_id, so their per-row
		// consult is findActiveHold({userId, companyId: null}) — the
		// first two post-gate null-company consults in this focused
		// scenario are exactly this family's two rows.
		const client = makeClient({
			assessmentResults: [{ id: 201 }, { id: 202 }],
			holdNullCompanyConsults: 2,
		});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /DELETE FROM assessment_results/i)).toHaveLength(0);
		expect(result.gapB.assessmentResults).toBe(0);
		expect(result.gapB.rowsHeld).toBe(2);
		expect(result.gapB.heldTables).toEqual(['assessment_results']);
		expect(result.gapB.holdLookupFailed).toBe(0);
	});

	test('#1340 assessment_results: hold-lookup failure fails closed — rows skipped, counted lookup-failed (#1154, never held)', async () => {
		const client = makeClient({
			assessmentResults: [{ id: 201 }, { id: 202 }],
			errorNullCompanyConsults: 2,
		});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /DELETE FROM assessment_results/i)).toHaveLength(0);
		expect(result.gapB.assessmentResults).toBe(0);
		expect(result.gapB.rowsHeld).toBe(0);
		expect(result.gapB.heldTables).toEqual([]);
		expect(result.gapB.holdLookupFailed).toBe(2);
		expect(result.gapB.lookupFailedTables).toEqual(['assessment_results']);
	});

	test('whole-erasure gate: an active hold aborts before any GAP-B statement (LegalHoldError, zero deletes)', async () => {
		const client = makeClient({ ...fullScenario(), gateHeld: true });
		const err = await erasureService.erasePersonalData(7, { client }).catch((e) => e);
		expect(err).toBeInstanceOf(LegalHoldError);
		expect(callsMatching(client, /DELETE FROM/i)).toHaveLength(0);
	});

	test('candidate with no GAP-B rows: no GAP-B writes, all counts zero', async () => {
		const client = makeClient({});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(result.gapB).toMatchObject({
			scoreSnapshots: 0,
			omniscoreResults: 0,
			scoreAppeals: 0,
			mutualMatches: 0,
			screeningLogs: 0,
			skillAssessments: 0,
			assessmentResults: 0,
			jobAssessmentAttempts: 0,
			assessmentConversations: 0,
			assessmentSessions: 0,
			assessmentEvents: 0,
			rowsHeld: 0,
			heldTables: [],
		});
		for (const table of GAP_B_TABLES) {
			expect(callsMatching(client, new RegExp(`DELETE FROM ${table}`, 'i'))).toHaveLength(0);
		}
	});
});
