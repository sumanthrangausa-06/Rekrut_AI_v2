/**
 * #1125 GAP-F (E-15): Erasure completeness — communications &
 * notifications family.
 *
 * erasePersonalData() previously had ZERO references to these eight
 * tables: account deletion tombstones the users row, so the
 * migrations' ON DELETE CASCADEs never fire and every row survived.
 * STOP 1 (issue #1125, comment 6178078651) scoped the build:
 *
 *   ALL EIGHT TABLES — whole-row DELETE, counted in result.gapF:
 *   communications (by candidate_id, draft AND sent — Lex ruling,
 *   DELETE under E-6/E-13; K-7 NOT extended), sequence_enrollments
 *   (by candidate_id), email_queue (by recipient = the candidate's
 *   PRE-TOMBSTONE email), notification_queue + notification_logs
 *   (user_id OR email), user_notifications + notification_preferences
 *   (by user_id), notification_audio_cache (explicitly by the UNHELD
 *   parent notification_logs ids, BEFORE the logs delete — cascade
 *   never assumed; NULL-log-id rows are unattributable and are NOT
 *   deleted, NOT counted, NOT claimed — residual R-F1).
 *   LEGAL HOLD — per-row consults fail-closed via a GAP-F-local
 *   three-way partition (unheld / genuinely held / lookup-failed —
 *   failures get their own counter, never a held masquerade).
 *   H1 (email-only rows: email_queue rows and NULL-user_id
 *   notification_queue/notification_logs rows) — candidate-level
 *   consult PLUS preservation when anyHoldActive() is true
 *   (over-preservation is the safe direction, disclosed in rowsHeld).
 *   communications SELF-FK CLOSURE — a retained (held/lookup-failed)
 *   row's ancestors via parent_id survive with it, counted in
 *   rowsHeld and named in heldTables as held-blocked.
 *   TOMBSTONE ORDER — the email capture happens before the users
 *   tombstone rewrites the address (auth.js passes the pre-tombstone
 *   address it holds as `originalEmail`; the service-side fallback
 *   reads users.email at the top of the GAP-F block — the admin DSAR
 *   flow never tombstones). Email deletes issued with the tombstone
 *   address would match nothing and report a false zero.
 *
 * Modelled on gap-e-erasure.test.js (SQL-routing fake). Mocked suite:
 * real-DB verification comes at the PR gate (database reviewer dry
 * run, #1153 precedent).
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

const ORIGINAL_EMAIL = 'candidate@example.com';
const TOMBSTONE_EMAIL = 'deleted_7_abcd1234@deleted.local';

// ─── Scenario-driven SQL router ─────────────────────────────────────────────
function makeClient(scenario = {}) {
	const s = {
		userEmail: ORIGINAL_EMAIL,
		communications: [],
		sequenceEnrollments: [],
		emailQueue: [],
		notificationQueue: [],
		notificationLogs: [],
		audioCache: [],
		userNotifications: [],
		notificationPreferences: [],
		heldCompanies: new Set(),
		errorCompanies: new Set(),
		anyHold: false,
		gateHeld: false,
		deleteCounts: {},
		...scenario,
	};
	const client = { query: jest.fn() };
	client.query.mockImplementation(async (sql, params = []) => {
		// anyHoldActive(): its own parameterless legal_holds probe.
		if (/SELECT id FROM legal_holds WHERE released_at IS NULL LIMIT 1/i.test(sql)) {
			return s.anyHold ? { rows: [{ id: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
		}
		// Legal holds: entry gate + per-row consults (findActiveHold).
		if (/FROM legal_holds/i.test(sql)) {
			if (s.gateHeld) {
				return { rows: [{ id: 42, user_id: 7, company_id: null }], rowCount: 1 };
			}
			const companyId = params[1];
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
		// GAP-F email capture.
		if (/SELECT email FROM users WHERE id = \$1/i.test(sql)) {
			return s.userEmail == null
				? { rows: [], rowCount: 0 }
				: { rows: [{ email: s.userEmail }], rowCount: 1 };
		}
		// Audio cache: emulate the real ANY() semantics — a NULL
		// notification_log_id is never IN the parent id set.
		if (/FROM notification_audio_cache/i.test(sql)) {
			const ids = Array.isArray(params[0]) ? params[0] : [];
			const rows = s.audioCache.filter((r) => ids.includes(r.notification_log_id));
			return { rows, rowCount: rows.length };
		}
		// GAP-F selects, driving FROM table.
		if (/FROM communications/i.test(sql)) return { rows: s.communications, rowCount: s.communications.length };
		if (/FROM sequence_enrollments/i.test(sql)) return { rows: s.sequenceEnrollments, rowCount: s.sequenceEnrollments.length };
		if (/FROM email_queue/i.test(sql)) return { rows: s.emailQueue, rowCount: s.emailQueue.length };
		if (/FROM notification_queue/i.test(sql)) return { rows: s.notificationQueue, rowCount: s.notificationQueue.length };
		if (/FROM notification_logs/i.test(sql)) return { rows: s.notificationLogs, rowCount: s.notificationLogs.length };
		if (/FROM user_notifications/i.test(sql)) return { rows: s.userNotifications, rowCount: s.userNotifications.length };
		if (/FROM notification_preferences/i.test(sql)) return { rows: s.notificationPreferences, rowCount: s.notificationPreferences.length };
		// Everything else in the pre-#1125 sequence: generic success.
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

function fullScenario() {
	return {
		communications: [
			{ id: 11, parent_id: null, company_id: 3 },
			{ id: 12, parent_id: 11, company_id: 3 },
		],
		sequenceEnrollments: [{ id: 21, company_id: 3 }],
		emailQueue: [{ id: 31 }, { id: 32 }],
		notificationQueue: [
			{ id: 41, user_id: 7 },
			{ id: 42, user_id: null }, // email-only row (H1)
		],
		notificationLogs: [
			{ id: 51, user_id: 7 },
			{ id: 52, user_id: null }, // email-only row (H1)
		],
		audioCache: [
			{ id: 61, notification_log_id: 51 },
			{ id: 62, notification_log_id: 52 },
			{ id: 63, notification_log_id: null }, // R-F1: unattributable — untouched
		],
		userNotifications: [{ id: 71 }],
		notificationPreferences: [{ id: 81 }],
	};
}

describe('#1125 GAP-F erasePersonalData — communications & notifications family', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('hard-deletes all eight tables, keyed per STOP 1 §2, with per-table counts in gapF', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		for (const table of [
			'communications',
			'sequence_enrollments',
			'email_queue',
			'notification_queue',
			'notification_audio_cache',
			'notification_logs',
			'user_notifications',
			'notification_preferences',
		]) {
			expect(callsMatching(client, new RegExp(`DELETE FROM ${table}`, 'i'))).toHaveLength(1);
		}
		expect(result.gapF).toMatchObject({
			communications: 2,
			sequenceEnrollments: 1,
			emailQueue: 2,
			notificationQueue: 2,
			notificationLogs: 2,
			userNotifications: 1,
			notificationPreferences: 1,
			notificationAudioCache: 2,
			rowsHeld: 0,
			holdLookupFailed: 0,
			heldTables: [],
			lookupFailedTables: [],
		});
		// Keying: communications NEVER by recruiter_id; email_queue by
		// the pre-tombstone recipient address.
		const commDelete = callsMatching(client, /DELETE FROM communications/i)[0];
		expect(commDelete[0]).toMatch(/candidate_id = \$1 AND id = ANY\(\$2\)/);
		expect(commDelete[0]).not.toMatch(/recruiter_id/);
		expect(commDelete[1]).toEqual([7, [11, 12]]);
		const queueDelete = callsMatching(client, /DELETE FROM email_queue/i)[0];
		expect(queueDelete[0]).toMatch(/recipient = \$1 AND id = ANY\(\$2\)/);
		expect(queueDelete[1]).toEqual([ORIGINAL_EMAIL, [31, 32]]);
	});

	test('notification_queue / notification_logs: matched by user_id OR email (email fallback is mandatory)', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		for (const table of ['notification_queue', 'notification_logs']) {
			const selects = callsMatching(client, new RegExp(`FROM ${table}`, 'i')).filter(
				([sql]) => !/DELETE FROM/i.test(sql),
			);
			expect(selects).toHaveLength(1);
			expect(selects[0][0]).toMatch(/user_id = \$1 OR email = \$2/);
			expect(selects[0][1]).toEqual([7, ORIGINAL_EMAIL]);
			// Deletes are by the explicit id set from the scoped select.
			const deletes = callsMatching(client, new RegExp(`DELETE FROM ${table}`, 'i'));
			expect(deletes[0][0]).toMatch(/id = ANY\(\$1\)/);
		}
	});

	test('tombstone order: email deletes use the PRE-TOMBSTONE address (originalEmail wins over the tombstoned users row)', async () => {
		// The self-serve flow tombstones users.email BEFORE calling
		// erasePersonalData (routes/auth.js) — the service-side read
		// therefore returns the synthetic address, and only the
		// caller-supplied pre-tombstone capture may be used.
		const client = makeClient({ ...fullScenario(), userEmail: TOMBSTONE_EMAIL });
		await erasureService.erasePersonalData(7, { client, originalEmail: ORIGINAL_EMAIL });

		const emailSelects = callsMatching(client, /FROM email_queue/i).filter(
			([sql]) => !/DELETE FROM/i.test(sql),
		);
		expect(emailSelects[0][1]).toEqual([ORIGINAL_EMAIL]);
		for (const [sql, params] of client.query.mock.calls) {
			if (/email_queue|notification_queue|notification_logs/i.test(sql)) {
				expect(JSON.stringify(params)).not.toContain('deleted.local');
			}
		}
	});

	test('tombstone order (fallback): without originalEmail, the users.email read at the GAP-F block is the match basis', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		const capture = callsMatching(client, /SELECT email FROM users WHERE id = \$1/i);
		expect(capture).toHaveLength(1);
		expect(capture[0][1]).toEqual([7]);
		const emailSelects = callsMatching(client, /FROM email_queue/i).filter(
			([sql]) => !/DELETE FROM/i.test(sql),
		);
		expect(emailSelects[0][1]).toEqual([ORIGINAL_EMAIL]);
	});

	test('per-row hold: a held communications row survives, is counted in rowsHeld and named in heldTables', async () => {
		const scenario = fullScenario();
		scenario.communications = [
			{ id: 11, parent_id: null, company_id: 99 },
			{ id: 12, parent_id: null, company_id: 3 },
		];
		const client = makeClient({ ...scenario, heldCompanies: new Set([99]) });
		const result = await erasureService.erasePersonalData(7, { client });

		const deletes = callsMatching(client, /DELETE FROM communications/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][1]).toEqual([7, [12]]);
		expect(result.gapF.communications).toBe(1);
		expect(result.gapF.rowsHeld).toBe(1);
		expect(result.gapF.heldTables).toEqual(['communications']);
		expect(result.gapF.holdLookupFailed).toBe(0);
	});

	test('hold-lookup SABOTAGE: failure lands in the third bucket — preserved, counted separately, NOT in heldTables', async () => {
		const scenario = fullScenario();
		scenario.sequenceEnrollments = [
			{ id: 21, company_id: 4 },
			{ id: 22, company_id: 3 },
		];
		const client = makeClient({ ...scenario, errorCompanies: new Set([4]) });
		const result = await erasureService.erasePersonalData(7, { client });

		const deletes = callsMatching(client, /DELETE FROM sequence_enrollments/i);
		expect(deletes[0][1]).toEqual([7, [22]]);
		expect(result.gapF.sequenceEnrollments).toBe(1);
		expect(result.gapF.holdLookupFailed).toBe(1);
		expect(result.gapF.lookupFailedTables).toEqual(['sequence_enrollments']);
		expect(result.gapF.rowsHeld).toBe(0);
		expect(result.gapF.heldTables).toEqual([]);
	});

	test('communications ancestor closure: an unheld parent of a held child is FK-blocked — survives, counted held-blocked', async () => {
		const scenario = fullScenario();
		// Chain: 11 (unheld) → 12 (unheld) → 13 (HELD). The whole
		// ancestor chain of the retained row must survive.
		scenario.communications = [
			{ id: 11, parent_id: null, company_id: 3 },
			{ id: 12, parent_id: 11, company_id: 3 },
			{ id: 13, parent_id: 12, company_id: 99 },
			{ id: 14, parent_id: null, company_id: 3 },
		];
		const client = makeClient({ ...scenario, heldCompanies: new Set([99]) });
		const result = await erasureService.erasePersonalData(7, { client });

		const deletes = callsMatching(client, /DELETE FROM communications/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][1]).toEqual([7, [14]]);
		expect(result.gapF.communications).toBe(1);
		// 1 genuinely held + 2 held-blocked ancestors.
		expect(result.gapF.rowsHeld).toBe(3);
		expect(result.gapF.heldTables).toEqual(['communications']);
	});

	test('communications ancestor closure: ancestors of a lookup-failed child also survive (never force-deleted)', async () => {
		const scenario = fullScenario();
		scenario.communications = [
			{ id: 11, parent_id: null, company_id: 3 },
			{ id: 12, parent_id: 11, company_id: 4 },
		];
		const client = makeClient({ ...scenario, errorCompanies: new Set([4]) });
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /DELETE FROM communications/i)).toHaveLength(0);
		expect(result.gapF.communications).toBe(0);
		expect(result.gapF.holdLookupFailed).toBe(1);
		expect(result.gapF.lookupFailedTables).toEqual(['communications']);
		// The blocked ancestor is disclosed as a held survival.
		expect(result.gapF.rowsHeld).toBe(1);
		expect(result.gapF.heldTables).toEqual(['communications']);
	});

	test('H1: any active hold preserves email-only rows (email_queue + NULL-user_id queue/log rows) while user-keyed rows still delete', async () => {
		const client = makeClient({ ...fullScenario(), anyHold: true });
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /DELETE FROM email_queue/i)).toHaveLength(0);
		const nqDeletes = callsMatching(client, /DELETE FROM notification_queue/i);
		expect(nqDeletes[0][1]).toEqual([[41]]);
		const nlDeletes = callsMatching(client, /DELETE FROM notification_logs/i);
		expect(nlDeletes[0][1]).toEqual([[51]]);
		// User-keyed families are unaffected by the H1 rule.
		expect(result.gapF.userNotifications).toBe(1);
		expect(result.gapF.notificationPreferences).toBe(1);
		// Survivals disclosed: 2 email_queue + 1 queue + 1 log = 4.
		// (The held log's audio-cache row survives with its parent —
		// it is never selected: the cache select takes ONLY the
		// unheld parent log ids, STOP 1 §4.)
		expect(result.gapF.rowsHeld).toBe(4);
		expect(result.gapF.heldTables).toEqual(
			expect.arrayContaining(['email_queue', 'notification_queue', 'notification_logs']),
		);
		expect(result.gapF.holdLookupFailed).toBe(0);
	});

	test('audio cache: deleted by UNHELD parent log ids BEFORE the logs delete; held-log cache survives; NULL-log-id rows untouched and uncounted', async () => {
		const scenario = fullScenario();
		scenario.notificationLogs = [
			{ id: 51, user_id: 7 },
			{ id: 52, user_id: 7 },
		];
		scenario.audioCache = [
			{ id: 61, notification_log_id: 51 },
			{ id: 62, notification_log_id: 52 },
			{ id: 63, notification_log_id: null },
		];
		// Log 52 is preserved via H1 any-hold (it is email-only in the
		// base fixture shape) — here both logs are user-keyed, so use
		// a company-free trick: anyHold preserves only H1 rows; make
		// log 52 NULL-user_id so H1 keeps it and its cache row.
		scenario.notificationLogs[1] = { id: 52, user_id: null };
		const client = makeClient({ ...scenario, anyHold: true });
		const result = await erasureService.erasePersonalData(7, { client });

		const cacheSelects = callsMatching(client, /FROM notification_audio_cache/i).filter(
			([sql]) => !/DELETE FROM/i.test(sql),
		);
		expect(cacheSelects).toHaveLength(1);
		expect(cacheSelects[0][1]).toEqual([[51]]);
		const cacheDeletes = callsMatching(client, /DELETE FROM notification_audio_cache/i);
		expect(cacheDeletes).toHaveLength(1);
		expect(cacheDeletes[0][1]).toEqual([[61]]);
		expect(result.gapF.notificationAudioCache).toBe(1);
		// Cache delete precedes the logs delete (cascade never assumed).
		expect(callIndex(client, /DELETE FROM notification_audio_cache/i)).toBeLessThan(
			callIndex(client, /DELETE FROM notification_logs/i),
		);
		// NULL-log-id row 63 is in no delete set anywhere.
		for (const [sql, params] of callsMatching(client, /DELETE FROM/i)) {
			expect(JSON.stringify(params)).not.toContain('63');
		}
	});

	test('whole-erasure gate: an active hold aborts before any GAP-F statement (LegalHoldError, zero deletes)', async () => {
		const client = makeClient({ ...fullScenario(), gateHeld: true });
		const err = await erasureService.erasePersonalData(7, { client }).catch((e) => e);
		expect(err).toBeInstanceOf(LegalHoldError);
		expect(callsMatching(client, /DELETE FROM/i)).toHaveLength(0);
	});

	test('candidate with no GAP-F rows: no GAP-F writes, all counts zero', async () => {
		const client = makeClient({});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(result.gapF).toMatchObject({
			communications: 0,
			sequenceEnrollments: 0,
			emailQueue: 0,
			notificationQueue: 0,
			notificationLogs: 0,
			userNotifications: 0,
			notificationPreferences: 0,
			notificationAudioCache: 0,
			rowsHeld: 0,
			holdLookupFailed: 0,
			heldTables: [],
			lookupFailedTables: [],
		});
		for (const table of [
			'communications',
			'email_queue',
			'notification_queue',
			'notification_logs',
			'notification_audio_cache',
		]) {
			expect(callsMatching(client, new RegExp(`DELETE FROM ${table}`, 'i'))).toHaveLength(0);
		}
	});
});
