/**
 * #1122 GAP-C (E-13): Erasure completeness — scheduling & human-interview
 * family (scheduled interviews, panels/scorecards, mock sessions, the
 * legacy `interviews` table, interview events).
 *
 * erasePersonalData() previously had ZERO DELETE/UPDATE references to
 * this family: account deletion tombstones the users row, so the
 * migrations' ON DELETE CASCADEs never fire and every row survived.
 * STOP 1 (issue #1122, comment 6168289675) + the Lex panel ruling
 * (comment 6168350849):
 *
 *   Q1 RULED — whole DELETE of recruiter-authored feedback / panel
 *   content (scheduled_interviews.feedback+notes die with the row,
 *   panel_notes, scorecards incl. overall_recommendation,
 *   scorecard_items incl. comment). No K-9 skeleton for this family.
 *   Q2 RULED (b) refined — interview_events partition: an unheld event
 *   is whole-DELETED when NO interview_recordings child survives, and
 *   REDACTED to the K-12 skeleton only when a recording child survives
 *   (the recording row + its K-1 consent fact must survive; mig 128
 *   CASCADE + mig 130 XOR forbid the whole DELETE there). The redact
 *   is FIVE assignments: notes / meeting_link / livekit_room_url /
 *   calendar_event_ids → NULL, panel_member_ids → '{}'. Return gains
 *   gapC.interviewEventsDeleted.
 *   Q3 CONFIRMED — interview_reminders + event-linked interview_rooms
 *   (interview_session_id IS NULL only) are in scope under Principle 1.
 *
 *   HARD DELETE: scheduled_interviews, interview_reminders (by unheld
 *   parent ids + recipient_id), interview_feedback, candidate_feedback,
 *   interview_panels + panel_notes + panel_members + scorecards +
 *   scorecard_items (children explicitly, before parents — never
 *   cascade-assumed), proposed_slots (by unheld event ids +
 *   proposed_by), interview_rooms (event-linked only),
 *   mock_interview_sessions, legacy interviews (+ interview_analysis
 *   explicitly by unheld parent ids first), human_interview_requests.
 *   Children inherit their parent's hold partition exactly.
 *   LEGAL HOLD: whole-erasure gate first (shipped), then a per-row
 *   findActiveHold({userId, companyId}) consult per family via the
 *   GAP-D machinery — the row's OWN company_id where one exists
 *   (scheduled_interviews / interview_feedback / candidate_feedback),
 *   otherwise DERIVED (interview_events via job_application_id →
 *   job_applications.company_id; legacy interviews via job_id →
 *   jobs.company_id; NULL derivation ⇒ {userId} only). Fail-closed on
 *   lookup error: row skipped, counted in gapC.rowsHeld, table named
 *   in gapC.heldTables (#1116 disclosure).
 *   STORAGE: only legacy interviews.video_urls — an entry matching the
 *   /api/files/ pattern is ledgered in-tx into
 *   pending_storage_deletions with source_family=
 *   'legacy_interview_video'; a non-pattern entry is named in
 *   gapC.nonPatternStorageUrls, never silently skipped.
 *   NOT-NULL discipline: the events redact NULLs only columns verified
 *   nullable in migration 126 (notes / meeting_link /
 *   livekit_room_url / calendar_event_ids — all DEFAULT NULL, no
 *   NOT NULL); panel_member_ids is assigned '{}', never NULL.
 *
 * Modelled on gap-d-erasure.test.js / gap-b-erasure.test.js
 * (SQL-routing fake). Mocked suite: real-DB verification comes at the
 * PR gate (database reviewer dry run, #1153 precedent).
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
		scheduled: [],
		reminders: [],
		interviewFeedback: [],
		candidateFeedback: [],
		panels: [],
		panelNotes: [],
		panelMembers: [],
		scorecards: [],
		scorecardItems: [],
		events: [],
		slots: [],
		rooms: [],
		mockSessions: [],
		legacyInterviews: [],
		analysis: [],
		humanRequests: [],
		heldCompanies: new Set(),
		errorCompanies: new Set(),
		gateHeld: false,
		deleteCounts: {},
		...scenario,
	};
	const client = { query: jest.fn() };
	client.query.mockImplementation(async (sql, params = []) => {
		// Legal holds: entry gate + per-row consults.
		// findActiveHold params: [uid, explicitCompanyId, sessionCompanyId].
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
		// GAP-C selects (match the driving FROM table; children with
		// compound names before their parents).
		if (/FROM scheduled_interviews/i.test(sql)) return { rows: s.scheduled, rowCount: s.scheduled.length };
		if (/FROM interview_reminders/i.test(sql)) return { rows: s.reminders, rowCount: s.reminders.length };
		if (/FROM interview_feedback/i.test(sql)) return { rows: s.interviewFeedback, rowCount: s.interviewFeedback.length };
		if (/FROM candidate_feedback/i.test(sql)) return { rows: s.candidateFeedback, rowCount: s.candidateFeedback.length };
		if (/FROM scorecard_items/i.test(sql)) return { rows: s.scorecardItems, rowCount: s.scorecardItems.length };
		if (/FROM scorecards/i.test(sql)) return { rows: s.scorecards, rowCount: s.scorecards.length };
		if (/FROM panel_notes/i.test(sql)) return { rows: s.panelNotes, rowCount: s.panelNotes.length };
		if (/FROM panel_members/i.test(sql)) return { rows: s.panelMembers, rowCount: s.panelMembers.length };
		if (/FROM interview_panels/i.test(sql)) return { rows: s.panels, rowCount: s.panels.length };
		if (/FROM interview_events/i.test(sql)) return { rows: s.events, rowCount: s.events.length };
		if (/FROM proposed_slots/i.test(sql)) return { rows: s.slots, rowCount: s.slots.length };
		if (/FROM interview_rooms/i.test(sql)) return { rows: s.rooms, rowCount: s.rooms.length };
		if (/FROM mock_interview_sessions/i.test(sql)) return { rows: s.mockSessions, rowCount: s.mockSessions.length };
		if (/FROM interview_analysis/i.test(sql)) return { rows: s.analysis, rowCount: s.analysis.length };
		if (/FROM human_interview_requests/i.test(sql)) return { rows: s.humanRequests, rowCount: s.humanRequests.length };
		if (/FROM interviews[\s(]/i.test(sql)) return { rows: s.legacyInterviews, rowCount: s.legacyInterviews.length };
		// Everything else in the pre-#1122 sequence: generic success.
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

const PATTERN_VIDEO_URL = '/api/files/r2/legacy/vid1.mp4';
const HELD_VIDEO_URL = '/api/files/r2/legacy/held.mp4';
const EXTERNAL_VIDEO_URL = 'https://external.example/vid2.mp4';

function fullScenario() {
	return {
		scheduled: [
			{ id: 101, company_id: 3 },
			{ id: 102, company_id: 99 },
		],
		// 202 follows its held parent; 203 is a recipient-keyed row on an
		// interview outside the candidate's scheduled set.
		reminders: [
			{ id: 201, interview_id: 101, recipient_id: 55 },
			{ id: 202, interview_id: 102, recipient_id: 55 },
			{ id: 203, interview_id: 999, recipient_id: 7 },
		],
		interviewFeedback: [
			{ id: 301, company_id: 3 },
			{ id: 302, company_id: 99 },
		],
		candidateFeedback: [{ id: 401, company_id: 3 }],
		panels: [
			{ id: 501, interview_session_id: 101 },
			{ id: 502, interview_session_id: 102 },
		],
		panelNotes: [
			{ id: 601, panel_id: 501 },
			{ id: 602, panel_id: 502 },
		],
		panelMembers: [
			{ id: 701, panel_id: 501 },
			{ id: 702, panel_id: 502 },
		],
		scorecards: [
			{ id: 801, panel_id: 501 },
			{ id: 802, panel_id: 502 },
		],
		scorecardItems: [
			{ id: 901, scorecard_id: 801 },
			{ id: 902, scorecard_id: 802 },
			{ id: 903, scorecard_id: 801 },
		],
		deleteCounts: { scorecard_items: 2, interview_analysis: 2 },
		// 1001 recording-linked → redact; 1002 childless → delete;
		// 1003 held company → untouched; 1004 NULL derived company,
		// childless → delete under the entry gate alone.
		events: [
			{ id: 1001, company_id: 3, has_recording: true },
			{ id: 1002, company_id: 3, has_recording: false },
			{ id: 1003, company_id: 99, has_recording: true },
			{ id: 1004, company_id: null, has_recording: false },
		],
		// 1103 follows its held event; 1104 is a proposed_by row on an
		// event outside the candidate's event set.
		slots: [
			{ id: 1101, interview_event_id: 1001, proposed_by: 55 },
			{ id: 1102, interview_event_id: 1002, proposed_by: 55 },
			{ id: 1103, interview_event_id: 1003, proposed_by: 55 },
			{ id: 1104, interview_event_id: 9999, proposed_by: 7 },
		],
		rooms: [
			{ id: 1201, interview_event_id: 1001 },
			{ id: 1202, interview_event_id: 1003 },
		],
		mockSessions: [{ id: 1301 }, { id: 1302 }],
		legacyInterviews: [
			{ id: 1401, company_id: 3, video_urls: [PATTERN_VIDEO_URL, EXTERNAL_VIDEO_URL] },
			{ id: 1402, company_id: 99, video_urls: [HELD_VIDEO_URL] },
		],
		analysis: [
			{ id: 1501, interview_id: 1401 },
			{ id: 1502, interview_id: 1402 },
			{ id: 1503, interview_id: 1401 },
		],
		humanRequests: [{ id: 1601 }],
		heldCompanies: new Set([99]),
	};
}

describe('#1122 GAP-C erasePersonalData — scheduling & human-interview family', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('hard-deletes every in-scope table with per-table counts in gapC; held survivals disclosed', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		for (const table of [
			'scheduled_interviews',
			'interview_reminders',
			'interview_feedback',
			'candidate_feedback',
			'interview_panels',
			'panel_notes',
			'panel_members',
			'scorecards',
			'scorecard_items',
			'proposed_slots',
			'interview_rooms',
			'mock_interview_sessions',
			'interviews',
			'interview_analysis',
			'human_interview_requests',
		]) {
			expect(callsMatching(client, new RegExp(`DELETE FROM ${table}`, 'i'))).toHaveLength(1);
		}
		expect(result.gapC).toMatchObject({
			scheduledInterviews: 1,
			interviewReminders: 2,
			interviewFeedback: 1,
			candidateFeedback: 1,
			interviewPanels: 1,
			panelNotes: 1,
			panelMembers: 1,
			scorecards: 1,
			scorecardItems: 2,
			interviewEventsRedacted: 1,
			interviewEventsDeleted: 2,
			proposedSlots: 3,
			interviewRooms: 1,
			mockInterviewSessions: 2,
			interviews: 1,
			interviewAnalysis: 2,
			humanInterviewRequests: 1,
			storageLedgered: 1,
			nonPatternStorageUrls: [EXTERNAL_VIDEO_URL],
		});
		// Held: scheduled 102, reminder 202, interview_feedback 302,
		// panel 502, panel_note 602, panel_member 702, scorecard 802,
		// scorecard_item 902, event 1003, slot 1103, room 1202,
		// legacy interview 1402, analysis 1502.
		expect(result.gapC.rowsHeld).toBe(13);
		expect(result.gapC.heldTables).toEqual(
			expect.arrayContaining([
				'scheduled_interviews',
				'interview_reminders',
				'interview_feedback',
				'interview_panels',
				'panel_notes',
				'panel_members',
				'scorecards',
				'scorecard_items',
				'interview_events',
				'proposed_slots',
				'interview_rooms',
				'interviews',
				'interview_analysis',
			]),
		);
		// Out of scope: the spine is never touched by this family, and
		// job-keyed panel criteria carry no candidate data.
		expect(callsMatching(client, /(DELETE FROM|UPDATE) panel_scorecard_criteria/i)).toHaveLength(0);
	});

	test('delete ORDER: children before parents across every cluster', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		const idx = (re) => callIndex(client, re);
		// Legacy cluster: analysis → interviews.
		expect(idx(/DELETE FROM interview_analysis/i)).toBeGreaterThan(-1);
		expect(idx(/DELETE FROM interview_analysis/i)).toBeLessThan(idx(/DELETE FROM interviews[\s(]/i));
		// Panel cluster: items → scorecards → notes/members → panels → scheduled.
		expect(idx(/DELETE FROM scorecard_items/i)).toBeLessThan(idx(/DELETE FROM scorecards/i));
		expect(idx(/DELETE FROM scorecards/i)).toBeLessThan(idx(/DELETE FROM interview_panels/i));
		expect(idx(/DELETE FROM panel_notes/i)).toBeLessThan(idx(/DELETE FROM interview_panels/i));
		expect(idx(/DELETE FROM panel_members/i)).toBeLessThan(idx(/DELETE FROM interview_panels/i));
		expect(idx(/DELETE FROM interview_panels/i)).toBeLessThan(idx(/DELETE FROM scheduled_interviews/i));
		// Scheduled children before the parent.
		expect(idx(/DELETE FROM interview_reminders/i)).toBeLessThan(idx(/DELETE FROM scheduled_interviews/i));
		expect(idx(/DELETE FROM interview_feedback/i)).toBeLessThan(idx(/DELETE FROM scheduled_interviews/i));
		// Event children before BOTH event dispositions.
		expect(idx(/DELETE FROM proposed_slots/i)).toBeLessThan(idx(/UPDATE interview_events/i));
		expect(idx(/DELETE FROM proposed_slots/i)).toBeLessThan(idx(/DELETE FROM interview_events/i));
		expect(idx(/DELETE FROM interview_rooms/i)).toBeLessThan(idx(/UPDATE interview_events/i));
		expect(idx(/DELETE FROM interview_rooms/i)).toBeLessThan(idx(/DELETE FROM interview_events/i));
		// Children are deleted explicitly by UNHELD parent ids only.
		expect(callsMatching(client, /DELETE FROM scorecard_items/i)[0][1]).toEqual([[801]]);
		expect(callsMatching(client, /DELETE FROM interview_analysis/i)[0][1]).toEqual([[1401]]);
		// Slots die by their own row ids: unheld-event slots (1101,
		// 1102) plus the proposed_by row (1104); the held event's slot
		// (1103) is not among them.
		expect(callsMatching(client, /DELETE FROM proposed_slots/i)[0][1]).toEqual([[1101, 1102, 1104]]);
		// Rooms: event-linked only — the SELECT carries the
		// session-linked exclusion (spine territory, mig 139), so a
		// session-linked room is never even a deletion candidate.
		const roomSelect = client.query.mock.calls.find(
			([sql]) => /SELECT/i.test(sql) && /FROM interview_rooms/i.test(sql),
		);
		expect(roomSelect).toBeTruthy();
		expect(roomSelect[0]).toMatch(/interview_session_id IS NULL/i);
	});

	test('Q2(b) partition: recording-linked events REDACTED with exactly the five ruled assignments; childless events DELETEd, never redacted', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		const updates = callsMatching(client, /UPDATE interview_events/i);
		expect(updates).toHaveLength(1);
		const [sql, params] = updates[0];
		expect(sql).toMatch(/candidate_id = \$1/);
		expect(sql).toMatch(/id = ANY\(\$2\)/);
		expect(params).toEqual([7, [1001]]);
		const setClause = sql.slice(sql.search(/SET/i) + 3, sql.search(/WHERE/i));
		const assignments = setClause.split(',').map((x) => x.replace(/\s+/g, ' ').trim()).sort();
		expect(assignments).toEqual(
			[
				'notes = NULL',
				'meeting_link = NULL',
				'livekit_room_url = NULL',
				'calendar_event_ids = NULL',
				"panel_member_ids = '{}'",
			].sort(),
		);
		const deletes = callsMatching(client, /DELETE FROM interview_events/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][1]).toEqual([7, [1002, 1004]]);
		expect(result.gapC.interviewEventsRedacted).toBe(1);
		expect(result.gapC.interviewEventsDeleted).toBe(2);
		// The held event 1003 appears in NEITHER disposition.
		expect(params[1]).not.toContain(1003);
		expect(deletes[0][1][1]).not.toContain(1003);
	});

	test('held-company scheduled interview preserved whole: its panel cluster + reminders survive with it', async () => {
		const scenario = {
			scheduled: [{ id: 102, company_id: 99 }],
			reminders: [{ id: 202, interview_id: 102, recipient_id: 55 }],
			panels: [{ id: 502, interview_session_id: 102 }],
			panelNotes: [{ id: 602, panel_id: 502 }],
			panelMembers: [{ id: 702, panel_id: 502 }],
			scorecards: [{ id: 802, panel_id: 502 }],
			scorecardItems: [{ id: 902, scorecard_id: 802 }],
			heldCompanies: new Set([99]),
		};
		const client = makeClient(scenario);
		const result = await erasureService.erasePersonalData(7, { client });

		// A per-row consult carried the row's own company_id.
		const holdCalls = callsMatching(client, /FROM legal_holds/i);
		expect(holdCalls.some(([, p]) => p[0] === 7 && p[1] === 99)).toBe(true);
		for (const table of [
			'scheduled_interviews',
			'interview_reminders',
			'interview_panels',
			'panel_notes',
			'panel_members',
			'scorecards',
			'scorecard_items',
		]) {
			expect(callsMatching(client, new RegExp(`DELETE FROM ${table}`, 'i'))).toHaveLength(0);
		}
		expect(result.gapC.rowsHeld).toBe(7);
		expect(result.gapC.heldTables).toEqual(
			expect.arrayContaining([
				'scheduled_interviews',
				'interview_reminders',
				'interview_panels',
				'panel_notes',
				'panel_members',
				'scorecards',
				'scorecard_items',
			]),
		);
	});

	test('derived-company holds: interview_events via job_application, legacy interviews via job; lookup failure fails closed per row', async () => {
		const scenario = {
			events: [
				{ id: 1001, company_id: 99, has_recording: true },
				{ id: 1002, company_id: 4, has_recording: false },
				{ id: 1003, company_id: 3, has_recording: false },
			],
			slots: [{ id: 1101, interview_event_id: 1001, proposed_by: 55 }],
			rooms: [{ id: 1201, interview_event_id: 1001 }],
			legacyInterviews: [
				{ id: 1401, company_id: 99, video_urls: [] },
				{ id: 1402, company_id: 3, video_urls: [] },
			],
			analysis: [{ id: 1501, interview_id: 1401 }],
			heldCompanies: new Set([99]),
			errorCompanies: new Set([4]),
		};
		const client = makeClient(scenario);
		const result = await erasureService.erasePersonalData(7, { client });

		// Held (99) and error-company (4, fail-closed) events untouched:
		// no redact, no delete for them, and the held event's slots/rooms
		// are preserved with it. Only the clean childless event is deleted.
		expect(callsMatching(client, /UPDATE interview_events/i)).toHaveLength(0);
		const eventDeletes = callsMatching(client, /DELETE FROM interview_events/i);
		expect(eventDeletes).toHaveLength(1);
		expect(eventDeletes[0][1]).toEqual([7, [1003]]);
		expect(callsMatching(client, /DELETE FROM proposed_slots/i)).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM interview_rooms/i)).toHaveLength(0);
		// Legacy: held-company interview + its analysis preserved.
		expect(callsMatching(client, /DELETE FROM interviews[\s(]/i)[0][1]).toEqual([7, [1402]]);
		expect(callsMatching(client, /DELETE FROM interview_analysis/i)).toHaveLength(0);
		expect(result.gapC.rowsHeld).toBeGreaterThanOrEqual(5);
		expect(result.gapC.heldTables).toEqual(
			expect.arrayContaining(['interview_events', 'proposed_slots', 'interview_rooms', 'interviews', 'interview_analysis']),
		);
	});

	test('storage: legacy video_urls /api/files/ entry ledgered as legacy_interview_video; non-pattern named; held row never ledgered', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		const ledger = callsMatching(client, /INSERT INTO pending_storage_deletions/i).filter(
			([sql]) => /legacy_interview_video/.test(sql) || true,
		);
		const gapCLedger = client.query.mock.calls.filter(
			([sql, p]) => /INSERT INTO pending_storage_deletions/i.test(sql) && p && p.includes(PATTERN_VIDEO_URL),
		);
		expect(gapCLedger).toHaveLength(1);
		expect(gapCLedger[0][0]).toMatch(/legacy_interview_video/);
		expect(ledger.length).toBeGreaterThanOrEqual(1);
		expect(result.gapC.storageLedgered).toBe(1);
		expect(result.gapC.nonPatternStorageUrls).toEqual([EXTERNAL_VIDEO_URL]);
		expect(result.storageKeys).toContain(PATTERN_VIDEO_URL);
		// The held interview's object survives with its row.
		expect(result.storageKeys).not.toContain(HELD_VIDEO_URL);
		expect(
			client.query.mock.calls.some(
				([sql, p]) => /INSERT INTO pending_storage_deletions/i.test(sql) && p && p.includes(HELD_VIDEO_URL),
			),
		).toBe(false);
	});

	test('human_interview_requests DELETE issues no statement against interview_sessions (spine untouched)', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		const calls = callsMatching(client, /DELETE FROM human_interview_requests/i);
		expect(calls).toHaveLength(1);
		expect(calls[0][0]).toMatch(/candidate_id = \$1/);
		expect(calls[0][0]).not.toMatch(/interview_sessions/i);
		expect(calls[0][1]).toEqual([7, [1601]]);
	});

	test('whole-erasure gate: an active hold aborts before any GAP-C statement (LegalHoldError, zero deletes)', async () => {
		const client = makeClient({ ...fullScenario(), gateHeld: true });
		const err = await erasureService.erasePersonalData(7, { client }).catch((e) => e);
		expect(err).toBeInstanceOf(LegalHoldError);
		expect(callsMatching(client, /DELETE FROM/i)).toHaveLength(0);
		expect(callsMatching(client, /UPDATE interview_events/i)).toHaveLength(0);
	});

	test('candidate with no GAP-C rows: no GAP-C writes, all counts zero', async () => {
		const client = makeClient({});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(result.gapC).toMatchObject({
			scheduledInterviews: 0,
			interviewReminders: 0,
			interviewFeedback: 0,
			candidateFeedback: 0,
			interviewPanels: 0,
			panelNotes: 0,
			panelMembers: 0,
			scorecards: 0,
			scorecardItems: 0,
			interviewEventsRedacted: 0,
			interviewEventsDeleted: 0,
			proposedSlots: 0,
			interviewRooms: 0,
			mockInterviewSessions: 0,
			interviews: 0,
			interviewAnalysis: 0,
			humanInterviewRequests: 0,
			rowsHeld: 0,
			heldTables: [],
			storageLedgered: 0,
			nonPatternStorageUrls: [],
		});
		for (const table of ['scheduled_interviews', 'interview_panels', 'mock_interview_sessions', 'human_interview_requests']) {
			expect(callsMatching(client, new RegExp(`DELETE FROM ${table}`, 'i'))).toHaveLength(0);
		}
		expect(callsMatching(client, /UPDATE interview_events/i)).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM interview_events/i)).toHaveLength(0);
	});
});
