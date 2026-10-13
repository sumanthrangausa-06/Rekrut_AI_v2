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
let holds;
let userCompany;
let holdCheckError;

function activeHoldMatches(uid, cid) {
	return holds.filter(
		(h) =>
			!h.released_at &&
			((uid != null && h.user_id === uid) ||
				(cid != null && h.company_id === cid) ||
				(uid != null && h.company_id != null && userCompany[uid] === h.company_id)),
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
		return { rows: activeHoldMatches(params[0], params[1]), rowCount: activeHoldMatches(params[0], params[1]).length };
	}
	return null;
}

beforeEach(() => {
	jest.clearAllMocks();
	holds = [];
	userCompany = { 7: 3, 8: 4 };
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
			if (sql.includes('FROM interview_sessions')) {
				return { rows: [{ candidate_id: 7, company_id: 3 }], rowCount: 1 };
			}
			return routeLegalHolds(sql, p);
		});
		await expect(isHeld({ sessionId: 42 })).resolves.toBe(true);
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

// ─── observerCapture seam (stub replaced, signature preserved) ─────────────
describe('observerCapture.isLegalHoldActive (existing seam, real body)', () => {
	test('delegates to legalHold for {candidateId, sessionId}', async () => {
		const cap = require('../../../lib/observerCapture');
		holds.push({ id: 1, user_id: 7, company_id: null, released_at: null });
		db.query.mockImplementation(async (sql, p) => {
			if (sql.includes('FROM interview_sessions')) return { rows: [{ candidate_id: 7, company_id: 3 }] };
			return routeLegalHolds(sql, p);
		});
		await expect(cap.isLegalHoldActive({ candidateId: 7, sessionId: 42 })).resolves.toBe(true);
		await expect(cap.isLegalHoldActive({ candidateId: 8, sessionId: 43 })).resolves.toBe(false);
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
		holds.push({ id: 1, user_id: null, company_id: 3, released_at: null });
		const client = makeClient();
		await expect(erasePersonalData(7, { client })).rejects.toMatchObject({ code: 'LEGAL_HOLD' });
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
