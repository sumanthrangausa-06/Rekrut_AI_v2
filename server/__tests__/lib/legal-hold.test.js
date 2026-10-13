/**
 * #799 (G-1): legal-hold mechanism — RED-first suite.
 *
 * Rex's verified design (issue #799, 2026-10-13T17:07Z): the hold seam
 * already exists as a stub — isLegalHoldActive({candidateId, sessionId})
 * in lib/observerCapture.js — and this build replaces the stub body with
 * the real implementation in lib/legalHold.js (legal_holds table,
 * migration 258). Every purge/deletion path consults it per row, before
 * delete; held rows are skipped + counted + audited; fail-closed on
 * hold-check error; DEK destruction is deletion and is gated at the
 * erasure entry (typed LegalHoldError, DSAR route maps it to 409).
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
	connect: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn().mockResolvedValue({ id: 1 }),
}));
jest.mock('../../../lib/file-storage', () => ({
	deleteFile: jest.fn().mockResolvedValue({ deleted: true }),
	deleteStorageObject: jest.fn().mockResolvedValue({ deleted: true }),
}));
jest.mock('../../../services/encryption', () => ({
	deleteEncryptedFile: jest.fn(),
}));
jest.mock('../../../services/auditLogService', () => ({
	logEvent: jest.fn().mockResolvedValue({ id: 'audit-1' }),
	EVENT_TYPES: { STATUS_CHANGE: 'status_change' },
	ENTITY_TYPES: { CANDIDATE: 'candidate', COMPANY: 'company', USER: 'user', RETENTION_PURGE: 'retention_purge' },
}));
jest.mock('../../services/livekit', () => ({
	decryptStoragePath: jest.fn(() => null),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const db = require('../../../lib/db');
const auditLogService = require('../../../services/auditLogService');
const { deleteFile, deleteStorageObject } = require('../../../lib/file-storage');

// ─── In-memory legal_holds state + SQL router ───────────────────────────────
// PR-gate fix round (privacy F-1): the fake must model production reality —
// CANDIDATES have users.company_id = NULL (only employer signup sets it,
// routes/auth.js). The old fake modelled candidate 7 as a company member
// (userCompany {7: 3}), which masked the company-hold blocker: a company
// hold appeared to protect candidates via users.company_id when in reality
// their company attribution arrives ONLY via interview_sessions. So:
//   - userCompany defaults EMPTY; employer-member tests set it explicitly.
//   - candidateSessionCompanies maps candidate_id → [company_id, …] from
//     that candidate's interview_sessions (the IN-subquery in isHeld and
//     the EXISTS branch of heldPredicate).
//   - session resolution is simulated by per-test mocks matching the
//     precise resolution query ('SELECT candidate_id, company_id FROM
//     interview_sessions WHERE id') — NOT a generic FROM interview_sessions
//     match, which would also intercept the legal_holds query (it now
//     contains an interview_sessions subquery).
let holds;
let userCompany;
let candidateSessionCompanies;
let holdCheckError;

function activeHoldMatches(uid, cids, anySessionBranch = true) {
	const cidList = (Array.isArray(cids) ? cids : [cids]).filter((c) => c != null);
	return holds.filter(
		(h) =>
			!h.released_at &&
			((uid != null && h.user_id === uid) ||
				(h.company_id != null && cidList.includes(h.company_id)) ||
				(uid != null && h.company_id != null && userCompany[uid] === h.company_id) ||
				(anySessionBranch &&
					uid != null &&
					h.company_id != null &&
					(candidateSessionCompanies[uid] || []).includes(h.company_id))),
	);
}

function routeLegalHolds(sql, params = []) {
	if (sql.includes('INSERT INTO legal_holds')) {
		const row = {
			id: holds.length + 1,
			user_id: params[0],
			company_id: params[1],
			reason: params[2],
			set_by: params[3],
			set_at: new Date(),
			released_by: null,
			released_at: null,
		};
		holds.push(row);
		return { rows: [row], rowCount: 1 };
	}
	if (sql.includes('UPDATE legal_holds')) {
		const row = holds.find((h) => h.id === params[1]);
		if (row && !row.released_at) {
			row.released_by = params[0];
			row.released_at = new Date();
			return { rows: [row], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	}
	if (sql.includes('FROM legal_holds')) {
		if (holdCheckError) throw holdCheckError;
		// any-active-hold query carries no subject params
		if (!params.length) return { rows: holds.filter((h) => !h.released_at), rowCount: holds.filter((h) => !h.released_at).length };
		// isHeld params: [uid, explicitCompanyId, sessionCompanyId]
		// D-1: the any-session attribution branch applies ONLY when the
		// query text actually carries it — findActiveHold omits it when
		// a sessionId was supplied. The fake keys off the SQL it is
		// handed instead of assuming the branch is always present; the
		// old assumption masked D-1 in exactly the negative seam cases
		// (delta review note (a): candidateSessionCompanies left unset).
		const anySessionBranch = sql.includes('IN (SELECT company_id FROM interview_sessions');
		const matched = activeHoldMatches(params[0], [params[1], params[2]], anySessionBranch);
		return { rows: matched, rowCount: matched.length };
	}
	return null;
}

beforeEach(() => {
	jest.clearAllMocks();
	holds = [];
	userCompany = {}; // candidates: users.company_id IS NULL (see header)
	candidateSessionCompanies = {};
	holdCheckError = null;
	auditLogService.logEvent.mockResolvedValue({ id: 'audit-1' });
});

// ─── lib/legalHold.js unit ──────────────────────────────────────────────────
describe('legalHold.isHeld', () => {
	const { isHeld, anyHoldActive } = require('../../../lib/legalHold');

	test('true for an active user hold', async () => {
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		db.query.mockImplementation(async (sql, p) => routeLegalHolds(sql, p));
		await expect(isHeld({ userId: 7 })).resolves.toBe(true);
	});

	test('true for an active company hold via explicit companyId', async () => {
		holds.push({ id: 1, user_id: null, company_id: 3, released_at: null });
		db.query.mockImplementation(async (sql, p) => routeLegalHolds(sql, p));
		await expect(isHeld({ companyId: 3 })).resolves.toBe(true);
	});

	test("true for a company hold matching the subject's company (users.company_id)", async () => {
		// EMPLOYER users carry users.company_id (set at employer signup) —
		// modelled explicitly here; candidates do not (see fake header).
		userCompany = { 7: 3, 8: 4 };
		holds.push({ id: 1, user_id: null, company_id: 3, released_at: null });
		db.query.mockImplementation(async (sql, p) => routeLegalHolds(sql, p));
		await expect(isHeld({ userId: 7 })).resolves.toBe(true); // user 7 ∈ company 3
		await expect(isHeld({ userId: 8 })).resolves.toBe(false); // user 8 ∈ company 4
	});

	test('false after release; false with no holds', async () => {
		db.query.mockImplementation(async (sql, p) => routeLegalHolds(sql, p));
		await expect(isHeld({ userId: 7 })).resolves.toBe(false);
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: new Date() });
		await expect(isHeld({ userId: 7 })).resolves.toBe(false);
	});

	test('sessionId resolves the session candidate + company', async () => {
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		db.query.mockImplementation(async (sql, p) => {
			if (sql.includes('SELECT candidate_id, company_id FROM interview_sessions WHERE id')) {
				return { rows: [{ candidate_id: 7, company_id: 3 }], rowCount: 1 };
			}
			return routeLegalHolds(sql, p);
		});
		await expect(isHeld({ sessionId: 42 })).resolves.toBe(true);
	});

	// ── PR-gate fix round: privacy F-1 (BLOCKER) + F-6 ─────────────────────
	test('F-1 REGRESSION: company hold protects a candidate via the SESSION when BOTH ids are passed (users.company_id NULL)', async () => {
		// The exact seam shape every session-attributed call site uses:
		// {userId: 7, sessionId: 42}. Candidate 7 has NO users.company_id;
		// session 42 sits in held company 99. Before the fix, isHeld only
		// resolved the session when NO userId was given → false.
		holds.push({ id: 1, user_id: null, company_id: 99, released_at: null });
		let sessionQueried = false;
		db.query.mockImplementation(async (sql, p) => {
			if (sql.includes('SELECT candidate_id, company_id FROM interview_sessions WHERE id')) {
				sessionQueried = true;
				expect(p).toEqual([42]);
				return { rows: [{ candidate_id: 7, company_id: 99 }], rowCount: 1 };
			}
			return routeLegalHolds(sql, p);
		});
		await expect(isHeld({ userId: 7, sessionId: 42 })).resolves.toBe(true);
		expect(sessionQueried).toBe(true);
	});

	test('F-1: candidate whose session is in a NON-held company is not held', async () => {
		holds.push({ id: 1, user_id: null, company_id: 99, released_at: null });
		db.query.mockImplementation(async (sql, p) => {
			if (sql.includes('SELECT candidate_id, company_id FROM interview_sessions WHERE id')) {
				return { rows: [{ candidate_id: 7, company_id: 55 }], rowCount: 1 };
			}
			return routeLegalHolds(sql, p);
		});
		await expect(isHeld({ userId: 7, sessionId: 43 })).resolves.toBe(false);
	});

	test('F-1: candidate is held via ANY of their sessions’ companies (no sessionId — the erasure attribution)', async () => {
		holds.push({ id: 1, user_id: null, company_id: 99, released_at: null });
		candidateSessionCompanies = { 7: [55, 99], 8: [55] };
		db.query.mockImplementation(async (sql, p) => routeLegalHolds(sql, p));
		await expect(isHeld({ userId: 7 })).resolves.toBe(true);
		await expect(isHeld({ userId: 8 })).resolves.toBe(false);
	});

	// ── D-1 precision fix (delta re-review residual, PR #915) ─────────────
	test('D-1: with a sessionId, the row is judged by THAT session’s company only — a hold on ANOTHER of the candidate’s companies does not retain it', async () => {
		// Candidate 7 has session 42 in HELD company 99 AND session 43 in
		// non-held company 55. candidateSessionCompanies is SET here —
		// the pre-D-1 negative seam tests left it unset, which is exactly
		// how the fake masked this over-retention (reviewer note (a)).
		const { findActiveHold } = require('../../../lib/legalHold');
		holds.push({ id: 1, user_id: null, company_id: 99, released_at: null });
		candidateSessionCompanies = { 7: [99, 55] };
		db.query.mockImplementation(async (sql, p) => {
			if (sql.includes('SELECT candidate_id, company_id FROM interview_sessions WHERE id')) {
				return p[0] === 42
					? { rows: [{ candidate_id: 7, company_id: 99 }], rowCount: 1 }
					: { rows: [{ candidate_id: 7, company_id: 55 }], rowCount: 1 };
			}
			return routeLegalHolds(sql, p);
		});
		// The non-held session's row PURGES (both-ids shape and session-only shape).
		await expect(isHeld({ userId: 7, sessionId: 43 })).resolves.toBe(false);
		await expect(isHeld({ sessionId: 43 })).resolves.toBe(false);
		await expect(findActiveHold({ userId: 7, sessionId: 43 })).resolves.toBeNull();
		// The held session's row still SPARES.
		await expect(isHeld({ userId: 7, sessionId: 42 })).resolves.toBe(true);
		await expect(isHeld({ sessionId: 42 })).resolves.toBe(true);
		// Session-less (candidate-erasure shape): UNCHANGED — any-session
		// attribution still blocks, all-or-nothing.
		await expect(isHeld({ userId: 7 })).resolves.toBe(true);
	});

	test('D-1: direct user hold and the subject’s own users.company_id hold still fire when a sessionId is present', async () => {
		candidateSessionCompanies = { 7: [99, 55] };
		db.query.mockImplementation(async (sql, p) => {
			if (sql.includes('SELECT candidate_id, company_id FROM interview_sessions WHERE id')) {
				return { rows: [{ candidate_id: 7, company_id: 55 }], rowCount: 1 };
			}
			return routeLegalHolds(sql, p);
		});
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		await expect(isHeld({ userId: 7, sessionId: 43 })).resolves.toBe(true); // direct user hold
		holds.length = 0;
		userCompany = { 7: 3 }; // employer member — the subject's OWN company
		holds.push({ id: 2, user_id: null, company_id: 3, released_at: null });
		await expect(isHeld({ userId: 7, sessionId: 43 })).resolves.toBe(true);
	});

	test('F-6: session-resolution MISS fails closed (held), with and without a userId', async () => {
		db.query.mockImplementation(async (sql, p) => {
			if (sql.includes('SELECT candidate_id, company_id FROM interview_sessions WHERE id')) {
				return { rows: [], rowCount: 0 }; // session row is gone
			}
			return routeLegalHolds(sql, p);
		});
		await expect(isHeld({ sessionId: 999 })).resolves.toBe(true);
		await expect(isHeld({ userId: 7, sessionId: 999 })).resolves.toBe(true);
	});

	test('FAIL-CLOSED: a hold-check error resolves true (treat as held)', async () => {
		holdCheckError = new Error('db down');
		db.query.mockImplementation(async (sql, p) => routeLegalHolds(sql, p));
		await expect(isHeld({ userId: 7 })).resolves.toBe(true);
		await expect(anyHoldActive()).resolves.toBe(true);
	});

	test('anyHoldActive reflects any unreleased hold', async () => {
		db.query.mockImplementation(async (sql, p) => routeLegalHolds(sql, p));
		await expect(anyHoldActive()).resolves.toBe(false);
		holds.push({ id: 1, user_id: null, company_id: 9, released_at: null });
		await expect(anyHoldActive()).resolves.toBe(true);
	});
});

describe('legalHold place/release + audit', () => {
	const { placeHold, releaseHold } = require('../../../lib/legalHold');

	test('placeHold inserts the hold and writes a compliance audit entry', async () => {
		db.query.mockImplementation(async (sql, p) => routeLegalHolds(sql, p));
		const row = await placeHold({ userId: 7, reason: 'litigation X', setBy: 'admin-1' });
		expect(row.user_id).toBe(7);
		expect(holds).toHaveLength(1);
		expect(auditLogService.logEvent).toHaveBeenCalledTimes(1);
		const arg = auditLogService.logEvent.mock.calls[0][0];
		expect(arg.payload.action).toBe('legal_hold_placed');
		expect(arg.payload.holdId).toBe(row.id);
	});

	test('placeHold rejects a subject-less or reason-less hold', async () => {
		db.query.mockImplementation(async (sql, p) => routeLegalHolds(sql, p));
		await expect(placeHold({ reason: 'x', setBy: 'a' })).rejects.toThrow(/subject/);
		await expect(placeHold({ userId: 7, setBy: 'a' })).rejects.toThrow(/reason/);
	});

	test('releaseHold stamps released_by/at, audits, and unblocks isHeld', async () => {
		const { isHeld } = require('../../../lib/legalHold');
		db.query.mockImplementation(async (sql, p) => routeLegalHolds(sql, p));
		const row = await placeHold({ userId: 7, reason: 'litigation X', setBy: 'admin-1' });
		await expect(isHeld({ userId: 7 })).resolves.toBe(true);
		const released = await releaseHold({ holdId: row.id, releasedBy: 'admin-2' });
		expect(released.released_by).toBe('admin-2');
		expect(released.released_at).toBeTruthy();
		await expect(isHeld({ userId: 7 })).resolves.toBe(false);
		const actions = auditLogService.logEvent.mock.calls.map((c) => c[0].payload.action);
		expect(actions).toEqual(['legal_hold_placed', 'legal_hold_released']);
	});
});

// ─── Lex F-1: DSAR / self-serve conflict record (compliance_audit_trail) ───
describe('legalHold.recordLegalHoldConflict', () => {
	const legalHold = require('../../../lib/legalHold');

	afterEach(() => {
		legalHold._setAuditWriter(null);
	});

	test('writes the conflict to the compliance audit trail with hold id, actor, and request/subject identifiers', async () => {
		const entries = [];
		legalHold._setAuditWriter(async (e) => {
			entries.push(e);
			return { id: 'audit-9' };
		});
		await legalHold.recordLegalHoldConflict({
			holdId: 5,
			actor: 'admin@example.com',
			actorRole: 'admin',
			requestId: 10,
			subjectUserId: 7,
			companyId: 3,
			source: 'dsar_fulfillment',
		});
		expect(entries).toHaveLength(1);
		expect(entries[0].payload).toMatchObject({
			action: 'legal_hold_conflict',
			holdId: 5,
			actor: 'admin@example.com',
			requestId: 10,
			subjectUserId: 7,
			source: 'dsar_fulfillment',
		});
		expect(entries[0].entityId).toBe(7);
	});

	test('THROWS when the audit write fails — callers must not claim the conflict was recorded', async () => {
		legalHold._setAuditWriter(async () => {
			throw new Error('audit trail down');
		});
		await expect(
			legalHold.recordLegalHoldConflict({
				holdId: 5,
				actor: 7,
				actorRole: 'user',
				subjectUserId: 7,
				source: 'self_serve_delete_account',
			}),
		).rejects.toThrow(/audit trail down/);
	});
});

// ─── observerCapture seam (stub replaced, signature preserved) ─────────────
describe('observerCapture.isLegalHoldActive (existing seam, real body)', () => {
	test('delegates to legalHold for {candidateId, sessionId}', async () => {
		const cap = require('../../../lib/observerCapture');
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		db.query.mockImplementation(async (sql, p) => {
			if (sql.includes('SELECT candidate_id, company_id FROM interview_sessions WHERE id')) {
				return { rows: [{ candidate_id: 7, company_id: 3 }] };
			}
			return routeLegalHolds(sql, p);
		});
		await expect(cap.isLegalHoldActive({ candidateId: 7, sessionId: 42 })).resolves.toBe(true);
		await expect(cap.isLegalHoldActive({ candidateId: 8, sessionId: 43 })).resolves.toBe(false);
	});

	test('F-1 REGRESSION (seam): company-only hold protects the candidate of a session in that company (candidate company NULL)', async () => {
		const cap = require('../../../lib/observerCapture');
		holds.push({ id: 1, user_id: null, company_id: 99, released_at: null });
		db.query.mockImplementation(async (sql, p) => {
			if (sql.includes('SELECT candidate_id, company_id FROM interview_sessions WHERE id')) {
				// session 42 → held company 99; session 43 → non-held 55
				return p[0] === 42
					? { rows: [{ candidate_id: 7, company_id: 99 }] }
					: { rows: [{ candidate_id: 7, company_id: 55 }] };
			}
			return routeLegalHolds(sql, p);
		});
		await expect(cap.isLegalHoldActive({ candidateId: 7, sessionId: 42 })).resolves.toBe(true);
		await expect(cap.isLegalHoldActive({ candidateId: 7, sessionId: 43 })).resolves.toBe(false);
	});

	test('D-1 (seam): cross-company candidate — the OTHER company’s hold does not retain this session’s row', async () => {
		const cap = require('../../../lib/observerCapture');
		holds.push({ id: 1, user_id: null, company_id: 99, released_at: null });
		// Candidate 7 genuinely has sessions in BOTH companies — set the
		// map the pre-D-1 seam test left unset (the masking gap).
		candidateSessionCompanies = { 7: [99, 55] };
		db.query.mockImplementation(async (sql, p) => {
			if (sql.includes('SELECT candidate_id, company_id FROM interview_sessions WHERE id')) {
				return p[0] === 42
					? { rows: [{ candidate_id: 7, company_id: 99 }] }
					: { rows: [{ candidate_id: 7, company_id: 55 }] };
			}
			return routeLegalHolds(sql, p);
		});
		await expect(cap.isLegalHoldActive({ candidateId: 7, sessionId: 42 })).resolves.toBe(true);
		await expect(cap.isLegalHoldActive({ candidateId: 7, sessionId: 43 })).resolves.toBe(false);
	});
});

// ─── erasure entry: hold blocks BEFORE the DEK is touched ──────────────────
describe('erasePersonalData under hold', () => {
	const { erasePersonalData } = require('../../../lib/erasureService');
	const { LegalHoldError } = require('../../../lib/legalHold');

	function makeClient() {
		return {
			query: jest.fn(async (sql, p) => {
				const held = routeLegalHolds(sql, p);
				if (held) return held;
				return { rows: [], rowCount: 0 };
			}),
		};
	}

	test('held candidate: typed LegalHoldError, DEK NOT destroyed, zero deletes', async () => {
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		const client = makeClient();
		const err = await erasePersonalData(7, { client }).catch((e) => e);
		expect(err).toBeInstanceOf(LegalHoldError);
		expect(err.code).toBe('LEGAL_HOLD');
		const sqls = client.query.mock.calls.map((c) => c[0]);
		expect(sqls.some((s) => s.includes('candidate_data_keys'))).toBe(false); // DEK untouched
		expect(sqls.some((s) => s.includes('DELETE FROM'))).toBe(false);
		expect(sqls).toHaveLength(1); // the hold check is the FIRST and only statement
	});

	test('company hold also blocks erasure of a company member', async () => {
		userCompany = { 7: 3 }; // employer member (users.company_id set)
		holds.push({ id: 1, user_id: null, company_id: 3, released_at: null });
		const client = makeClient();
		await expect(erasePersonalData(7, { client })).rejects.toMatchObject({ code: 'LEGAL_HOLD' });
	});

	test('F-1 REGRESSION (erasure): company hold blocks erasure of a CANDIDATE whose sessions sit in that company (users.company_id NULL), and the error carries the hold id', async () => {
		holds.push({ id: 9, user_id: null, company_id: 99, released_at: null });
		candidateSessionCompanies = { 7: [99] };
		const client = makeClient();
		const err = await erasePersonalData(7, { client }).catch((e) => e);
		expect(err).toBeInstanceOf(LegalHoldError);
		expect(err.code).toBe('LEGAL_HOLD');
		expect(err.details.holdId).toBe(9); // Lex F-1: the DSAR conflict record needs the hold id
		const sqls = client.query.mock.calls.map((c) => c[0]);
		expect(sqls.some((s) => s.includes('candidate_data_keys'))).toBe(false); // DEK untouched
		expect(sqls.some((s) => s.includes('DELETE FROM'))).toBe(false);
	});

	test('F-1 (erasure): candidate whose sessions are only in NON-held companies is NOT blocked', async () => {
		holds.push({ id: 9, user_id: null, company_id: 99, released_at: null });
		candidateSessionCompanies = { 7: [55] };
		const client = makeClient();
		const result = await erasePersonalData(7, { client });
		expect(result.shredded).toBe(false); // erasure ran (DEKNotFound on the empty fake)
	});

	test('released hold unblocks erasure (proceeds to DEK step)', async () => {
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: new Date() });
		const client = makeClient();
		const result = await erasePersonalData(7, { client });
		expect(result.shredded).toBe(false); // DEKNotFound path on empty fake — erasure ran
		const sqls = client.query.mock.calls.map((c) => c[0]);
		expect(sqls.some((s) => s.includes('DELETE FROM candidate_embeddings'))).toBe(true);
	});

	test('hold-check error fails closed: erasure aborts with LegalHoldError', async () => {
		holdCheckError = new Error('db down');
		const client = makeClient();
		await expect(erasePersonalData(7, { client })).rejects.toMatchObject({ code: 'LEGAL_HOLD' });
	});
});

// ─── pending_storage_deletions ledger drain (#11/#12) ───────────────────────
describe('ledger drain under hold', () => {
	const { deleteErasedStorageFiles, sweepPendingStorageDeletions } = require('../../../lib/erasureService');
	const entry = { id: 55, file_url: '/api/files/r2%2Fcv.pdf', storage_type: 'r2' };

	function routeDb(sql, p = []) {
		const held = routeLegalHolds(sql, p);
		if (held) return held;
		if (sql.includes('SELECT DISTINCT user_id FROM pending_storage_deletions')) {
			return { rows: [{ user_id: 7 }], rowCount: 1 };
		}
		if (sql.includes('FROM pending_storage_deletions')) return { rows: [entry], rowCount: 1 };
		return { rows: [], rowCount: 1 };
	}

	test('held entry: object NOT deleted, ledger row left pending, skip counted', async () => {
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		db.query.mockImplementation(async (sql, p) => routeDb(sql, p));
		const res = await deleteErasedStorageFiles(7, {});
		expect(res.deleted).toBe(0);
		expect(res.heldSkips).toBe(1);
		expect(deleteFile).not.toHaveBeenCalled();
		const updates = db.query.mock.calls.filter((c) => c[0].includes('UPDATE pending_storage_deletions'));
		expect(updates).toHaveLength(0);
	});

	test('released hold: drain proceeds normally on the next run', async () => {
		db.query.mockImplementation(async (sql, p) => routeDb(sql, p));
		const res = await deleteErasedStorageFiles(7, {});
		expect(res.deleted).toBe(1);
		expect(res.heldSkips).toBe(0);
		expect(deleteFile).toHaveBeenCalledTimes(1);
	});

	test('sweep level: held user is skipped, totals carry the skip', async () => {
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		db.query.mockImplementation(async (sql, p) => routeDb(sql, p));
		const res = await sweepPendingStorageDeletions({});
		expect(res.deleted).toBe(0);
		expect(res.heldSkips).toBe(1);
	});
});

// ─── euComplianceService purge paths ────────────────────────────────────────
describe('euComplianceService purges under hold', () => {
	const EuComplianceService = require('../../../services/euComplianceService');

	test('purgeRecordingObjects: hold check now covers NON-observer rows too (#1 widening)', async () => {
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		db.query.mockImplementation(async (sql, p) => {
			const held = routeLegalHolds(sql, p);
			if (held) return held;
			if (sql.includes('FROM recording_objects')) {
				return {
					rows: [{ object_key: 'r2/rec.mp4', object_type: 'recording', expires_at: new Date(), candidate_id: 7, interview_id: 42 }],
					rowCount: 1,
				};
			}
			return { rows: [], rowCount: 0 };
		});
		const res = await EuComplianceService.purgeRecordingObjects({ dryRun: false });
		expect(res.heldSkips).toBe(1);
		expect(res.purgedCount).toBe(0);
		expect(deleteStorageObject).not.toHaveBeenCalled();
	});

	test('purgeExpiredSpeechMeasurements: hold-check ERROR fails closed (skip + count, no delete)', async () => {
		holdCheckError = new Error('db down');
		db.query.mockImplementation(async (sql, p) => {
			if (sql.includes('FROM data_retention_policies')) return { rows: [{ retention_days: 30 }] };
			const held = routeLegalHolds(sql, p);
			if (held) return held;
			if (sql.includes('FROM observer_speech_measurements')) {
				return { rows: [{ id: 9, candidate_id: 7, interview_session_id: 42 }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		});
		const res = await EuComplianceService.purgeExpiredSpeechMeasurements({ dryRun: false });
		expect(res.deletedCount).toBe(0);
		expect(res.heldSkips).toBe(1);
		const deletes = db.query.mock.calls.filter((c) => c[0].includes('DELETE FROM observer_speech_measurements'));
		expect(deletes).toHaveLength(0);
	});

	test('purgeExpiredRecordings: held recording not soft-deleted, transcript NOT anonymised', async () => {
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		db.query.mockImplementation(async (sql, p) => {
			const held = routeLegalHolds(sql, p);
			if (held) return held;
			if (sql.includes('FROM interview_recordings')) {
				return { rows: [{ id: 5, storage_path: null, candidate_id: 7 }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		});
		const res = await EuComplianceService.purgeExpiredRecordings({ dryRun: false });
		expect(res.deletedCount).toBe(0);
		expect(res.heldSkips).toBe(1);
		const writes = db.query.mock.calls.filter(
			(c) => c[0].includes('UPDATE interview_recordings') || c[0].includes('UPDATE interview_transcripts'),
		);
		expect(writes).toHaveLength(0);
	});

	test('F-1 REGRESSION (#6 recordings): company hold via the recording’s SESSION protects a candidate with company NULL', async () => {
		holds.push({ id: 1, user_id: null, company_id: 99, released_at: null });
		db.query.mockImplementation(async (sql, p) => {
			if (sql.includes('SELECT candidate_id, company_id FROM interview_sessions WHERE id')) {
				return { rows: [{ candidate_id: 7, company_id: 99 }], rowCount: 1 };
			}
			const held = routeLegalHolds(sql, p);
			if (held) return held;
			if (sql.includes('FROM interview_recordings')) {
				return { rows: [{ id: 5, storage_path: null, candidate_id: 7, interview_session_id: 42 }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		});
		const res = await EuComplianceService.purgeExpiredRecordings({ dryRun: false });
		expect(res.deletedCount).toBe(0);
		expect(res.heldSkips).toBe(1);
		const writes = db.query.mock.calls.filter(
			(c) => c[0].includes('UPDATE interview_recordings') || c[0].includes('UPDATE interview_transcripts'),
		);
		expect(writes).toHaveLength(0);
		// The purge SELECT must carry the session link for attribution
		const select = db.query.mock.calls.find((c) => c[0].includes('FROM interview_recordings'));
		expect(select[0]).toMatch(/interview_session_id/);
	});

	test('purgeExpiredTemplates: ANY active hold skips the run (templates are unattributable by design)', async () => {
		holds.push({ id: 1, user_id: null, company_id: 9, released_at: null });
		db.query.mockImplementation(async (sql, p) => {
			const held = routeLegalHolds(sql, p);
			if (held) return held;
			if (sql.includes('FROM biometric_templates')) return { rows: [{ c: 4 }], rowCount: 1 };
			return { rows: [], rowCount: 0 };
		});
		const res = await EuComplianceService.purgeExpiredTemplates({ dryRun: false });
		expect(res.deletedCount).toBe(0);
		expect(res.skippedDueToHold).toBe(true);
		const deletes = db.query.mock.calls.filter((c) => c[0].includes('DELETE FROM biometric_templates'));
		expect(deletes).toHaveLength(0);
	});

	test('purgeExpiredObserverReports: held candidate report survives; released purges', async () => {
		const run = async () => {
			db.query.mockImplementation(async (sql, p) => {
				const held = routeLegalHolds(sql, p);
				if (held) return held;
				if (sql.includes('FROM ai_observer_reports')) {
					return { rows: [{ id: 11, candidate_id: 7 }], rowCount: 1 };
				}
				return { rows: [], rowCount: 1 };
			});
			return EuComplianceService.purgeExpiredObserverReports({ dryRun: false });
		};
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		const heldRes = await run();
		expect(heldRes.deletedCount).toBe(0);
		expect(heldRes.heldSkips).toBe(1);
		holds[0].released_at = new Date();
		jest.clearAllMocks();
		const freeRes = await run();
		expect(freeRes.deletedCount).toBe(1);
		expect(freeRes.heldSkips).toBe(0);
	});

	test('F-1 REGRESSION (#8 observer reports): company hold via the report’s SESSION protects a candidate with company NULL', async () => {
		holds.push({ id: 1, user_id: null, company_id: 99, released_at: null });
		db.query.mockImplementation(async (sql, p) => {
			if (sql.includes('SELECT candidate_id, company_id FROM interview_sessions WHERE id')) {
				return { rows: [{ candidate_id: 7, company_id: 99 }], rowCount: 1 };
			}
			const held = routeLegalHolds(sql, p);
			if (held) return held;
			if (sql.includes('FROM ai_observer_reports')) {
				return { rows: [{ id: 11, candidate_id: 7, interview_session_id: 42 }], rowCount: 1 };
			}
			return { rows: [], rowCount: 1 };
		});
		const res = await EuComplianceService.purgeExpiredObserverReports({ dryRun: false });
		expect(res.deletedCount).toBe(0);
		expect(res.heldSkips).toBe(1);
		const select = db.query.mock.calls.find((c) => c[0].includes('FROM ai_observer_reports'));
		expect(select[0]).toMatch(/interview_session_id/);
	});

	test('F-1 (bulk predicate): heldPredicate carries session-company attribution for candidates', async () => {
		const { heldPredicate } = require('../../../lib/legalHold');
		const predicate = heldPredicate('some_table.user_id');
		expect(predicate).toMatch(/interview_sessions/);
		expect(predicate).toMatch(/candidate_id\s*=\s*some_table\.user_id/);
	});

	test('D-1 (bulk predicate): the session-scoped predicate keys on the row’s OWN session company and drops the any-session branch; the default is unchanged', async () => {
		const { heldPredicate, notHeldPredicate } = require('../../../lib/legalHold');
		const scoped = heldPredicate('some_table.user_id', {
			sessionIdExpr: 'some_table.interview_session_id',
		});
		expect(scoped).toMatch(/interview_sessions/);
		expect(scoped).toMatch(/s_lh\.id\s*=\s*some_table\.interview_session_id/);
		expect(scoped).not.toMatch(/candidate_id\s*=\s*some_table\.user_id/);
		// User hold + subject's-own-company branches survive the scoping.
		expect(scoped).toMatch(/lh\.user_id\s*=\s*some_table\.user_id/);
		expect(scoped).toMatch(/u_lh\.company_id/);
		expect(notHeldPredicate('some_table.user_id', { sessionIdExpr: 'some_table.interview_session_id' })).toBe(
			`NOT ${scoped}`,
		);
		// Session-less default: byte-identical shape to before D-1.
		const plain = heldPredicate('some_table.user_id');
		expect(plain).toMatch(/candidate_id\s*=\s*some_table\.user_id/);
		expect(notHeldPredicate('some_table.user_id')).toBe(`NOT ${plain}`);
	});

	test('executePurge: attributable branches carry a NOT EXISTS hold predicate + held count in summary', async () => {
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		db.query.mockImplementation(async (sql) => {
			if (sql.includes('FROM data_retention_policies')) {
				return {
					rows: [{ data_type: 'audit_logs', retention_days: 30, auto_delete: true, company_id: null, policy_scope: 'global' }],
					rowCount: 1,
				};
			}
			if (sql.includes('FROM audit_logs') && sql.includes('COUNT') && !sql.includes('NOT EXISTS')) {
				return { rows: [{ c: 2 }], rowCount: 1 }; // held-eligible count
			}
			if (sql.includes('DELETE FROM audit_logs')) return { rows: [], rowCount: 3 };
			return { rows: [], rowCount: 0 };
		});
		const summary = await EuComplianceService.executePurge({ dryRun: false });
		expect(summary).toHaveLength(1);
		expect(summary[0].affected_count).toBe(3);
		expect(summary[0].held_skips).toBe(2);
		const del = db.query.mock.calls.find((c) => c[0].includes('DELETE FROM audit_logs'));
		expect(del[0]).toMatch(/NOT EXISTS[\s\S]*legal_holds/);
	});
});

// ─── observerCapture purge paths (#3, #4, #9) ───────────────────────────────
describe('observerCapture purges under hold', () => {
	const cap = require('../../../lib/observerCapture');

	test('purgeTestObserverAudio: held chunks/measurements/outcomes skipped + counted', async () => {
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		const queryable = {
			query: jest.fn(async (sql, p) => {
				const held = routeLegalHolds(sql, p);
				if (held) return held;
				if (sql.includes('FROM observer_audio_chunks')) {
					return { rows: [{ object_key: 'k1', interview_session_id: 42, candidate_id: 7 }], rowCount: 1 };
				}
				if (sql.includes('FROM observer_speech_measurements')) {
					return { rows: [{ id: 9, interview_session_id: 42, candidate_id: 7 }], rowCount: 1 };
				}
				if (sql.includes('FROM observer_capture_outcomes')) {
					return { rows: [{ interview_session_id: 42, candidate_id: 7 }], rowCount: 1 };
				}
				return { rows: [], rowCount: 0 };
			}),
		};
		// The seam reads through the global pool mock — wire it to the same router.
		db.query.mockImplementation(async (sql, p) => routeLegalHolds(sql, p));
		const res = await cap.purgeTestObserverAudio({ dryRun: false, queryable });
		expect(res.heldSkips).toBe(3);
		expect(res.objectsDeleted).toBe(0);
		expect(res.measurementRowsDeleted).toBe(0);
		expect(res.outcomeRowsDeleted).toBe(0);
	});

	test('sweepWithdrawnCaptureArtefacts: held session queues nothing', async () => {
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		db.query.mockImplementation(async (sql, p) => routeLegalHolds(sql, p));
		const pool = {
			query: jest.fn(async (sql) => {
				if (sql.includes('FROM consent_receipts')) {
					return { rows: [{ interview_session_id: 42, candidate_id: 7 }], rowCount: 1 };
				}
				return { rows: [], rowCount: 0 };
			}),
			connect: jest.fn(),
		};
		const res = await cap.sweepWithdrawnCaptureArtefacts({ pool });
		expect(res.heldSkips).toBe(1);
		expect(res.chunksQueued).toBe(0);
		expect(pool.connect).not.toHaveBeenCalled();
	});

	test('reconcileObserverAudioIntents: held pending intent is NOT retired (#9)', async () => {
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		db.query.mockImplementation(async (sql, p) => routeLegalHolds(sql, p));
		const client = {
			query: jest.fn(async (sql, p) => {
				const held = routeLegalHolds(sql, p);
				if (held) return held;
				if (sql.includes('FROM recording_objects')) {
					return { rows: [{ registration_state: 'pending', deleted_at: null }], rowCount: 1 };
				}
				return { rows: [], rowCount: 0 };
			}),
			release: jest.fn(),
		};
		const queryable = {
			query: jest.fn(async (sql) => {
				if (sql.includes('FROM recording_objects')) {
					return { rows: [{ object_key: 'bare-key', candidate_id: 7 }], rowCount: 1 };
				}
				return { rows: [], rowCount: 0 };
			}),
			connect: jest.fn(async () => client),
		};
		const res = await cap.reconcileObserverAudioIntents({ queryable });
		expect(res.rowsRetired).toBe(0);
		expect(res.heldSkips).toBe(1);
		const deletes = client.query.mock.calls.filter((c) => c[0].includes('DELETE FROM'));
		expect(deletes).toHaveLength(0);
	});
});
