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
 *   FIX ROUND (Lex ruling, comment 6169043564 — Option A RULED,
 *   Option B REJECTED): the rooms DELETE is partitioned at DELETE
 *   time by NOT EXISTS on interview_recordings.room_id (mig 128 ON
 *   DELETE CASCADE; the production writer sets room_id on event
 *   recordings, so an unpartitioned DELETE cascade-destroyed the
 *   GAP-A-kept recording + its K-1 consent fact — database gate
 *   BLOCK, PR #1156 comment 6169006094). A referenced room survives
 *   WHOLE, unredacted, under amended K-12 and is counted in
 *   gapC.interviewRoomsKeptForRecordings, never as deleted; an
 *   unreferenced room is whole-DELETED as Q3 ruled; the recording
 *   row is never touched by GAP-C. HONEST LIMIT of this mocked
 *   harness: the fake cannot model the FK CASCADE or evaluate the
 *   NOT EXISTS against real recording rows — the tests below pin
 *   the SQL shape, the candidate ids passed, and the counting
 *   (via a simulated rowCount), and the cascade proof itself
 *   belongs to the database re-review's real-DB dry run.
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
 *   lookup error: row skipped, counted in gapC.holdLookupFailed, table
 *   named in gapC.lookupFailedTables (#1154 truthfulness;
 *   gapC.rowsHeld/heldTables name GENUINE holds only, #1116 disclosure).
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
 * #1972 (K-12 panel-consent clause, #1964): the events partition
 * gains a third EXISTS on event_labelling_consent in the same SELECT
 * snapshot. Panel-only events (panel rows, no recording) are
 * REDACTED via a SEPARATE UPDATE (identical five assignments) and
 * counted in gapC.interviewEventsKeptForPanelConsent — mig 299's
 * ON DELETE RESTRICT made the old whole-DELETE abort the candidate's
 * entire erasure. The three disposition sets are disjoint
 * (recording / panel-only / neither), so deleted + redacted +
 * kept-for-panel + held + lookup-failed reconciles to the seeded
 * total. HONEST LIMIT of this mocked harness: the fake cannot model
 * the RESTRICT FK — the real-DB proof (erasure completes, panel rows
 * byte-identical) is the Quinn E2E integration suite
 * (gap-c-1972-panel-erasure.integration.test.js).
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
		// 1001 recording-linked (+ panel rows, #1972 posture 1) →
		// redact, counted as redacted ONLY; 1002 childless → delete;
		// 1003 held company → untouched; 1004 NULL derived company,
		// childless → delete under the entry gate alone.
		events: [
			{ id: 1001, company_id: 3, has_recording: true, has_panel_consent: true },
			{ id: 1002, company_id: 3, has_recording: false, has_panel_consent: false },
			{ id: 1003, company_id: 99, has_recording: true, has_panel_consent: false },
			{ id: 1004, company_id: null, has_recording: false, has_panel_consent: false },
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
			interviewEventsKeptForPanelConsent: 0,
			proposedSlots: 3,
			interviewRooms: 1,
			interviewRoomsKeptForRecordings: 0,
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

	test('#1972 panel partition: panel-only events REDACTED via a separate UPDATE and counted kept-for-panel; RESTRICT DELETE never attempted on them', async () => {
		// 2001 panel rows, NO recording (the bug posture) → panel
		// redact; 2002 recording + panel → recording redact ONLY
		// (disjoint sets, counted once); 2003 neither → DELETE;
		// 2004 panel-only but held company → survives whole.
		const scenario = {
			events: [
				{ id: 2001, company_id: 3, has_recording: false, has_panel_consent: true },
				{ id: 2002, company_id: 3, has_recording: true, has_panel_consent: true },
				{ id: 2003, company_id: 3, has_recording: false, has_panel_consent: false },
				{ id: 2004, company_id: 99, has_recording: false, has_panel_consent: true },
			],
			heldCompanies: new Set([99]),
		};
		const client = makeClient(scenario);
		const result = await erasureService.erasePersonalData(7, { client });

		// The third EXISTS rides the ONE existing event SELECT, same
		// snapshot as has_recording (issue requirement 1).
		const eventSelect = client.query.mock.calls.find(
			([sql]) => /SELECT/i.test(sql) && /FROM interview_events/i.test(sql),
		);
		expect(eventSelect).toBeTruthy();
		expect(eventSelect[0]).toMatch(
			/EXISTS\s*\(\s*SELECT 1 FROM event_labelling_consent elc WHERE elc\.interview_event_id = ie\.id\s*\)\s*AS has_panel_consent/i,
		);
		expect(eventSelect[0]).toMatch(/AS has_recording/i);

		// Two UPDATEs: recording set [2002], panel-only set [2001] —
		// each with exactly the five K-12 assignments.
		const updates = callsMatching(client, /UPDATE interview_events/i);
		expect(updates).toHaveLength(2);
		const byIds = new Map(updates.map(([sql, params]) => [JSON.stringify(params[1]), { sql, params }]));
		for (const ids of ['[2002]', '[2001]']) {
			const u = byIds.get(ids);
			expect(u).toBeTruthy();
			expect(u.params[0]).toBe(7);
			const setClause = u.sql.slice(u.sql.search(/SET/i) + 3, u.sql.search(/WHERE/i));
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
		}
		// DELETE carries ONLY the neither-flag event; the held
		// panel-only event (2004) is in NO disposition.
		const deletes = callsMatching(client, /DELETE FROM interview_events/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][1]).toEqual([7, [2003]]);
		// Disjoint counts reconcile (lookupFailed = 0 in this seed):
		// deleted 1 + redacted 1 + kept-for-panel 1 + held 1 = 4 seeded.
		expect(result.gapC.interviewEventsDeleted).toBe(1);
		expect(result.gapC.interviewEventsRedacted).toBe(1);
		expect(result.gapC.interviewEventsKeptForPanelConsent).toBe(1);
		expect(result.gapC.rowsHeld).toBe(1);
		expect(result.gapC.holdLookupFailed).toBe(0);
		expect(
			result.gapC.interviewEventsDeleted +
				result.gapC.interviewEventsRedacted +
				result.gapC.interviewEventsKeptForPanelConsent +
				result.gapC.rowsHeld +
				result.gapC.holdLookupFailed,
		).toBe(4);
		// GAP-C never touches the panel rows themselves on a
		// candidate erasure (they are other users' records).
		expect(callsMatching(client, /DELETE FROM event_labelling_consent/i).filter(([, p]) => p && p.includes(2001))).toHaveLength(0);
	});

	test('#1972 panel partition: candidate with only a panel-only event — no DELETE issued, kept count 1, redacted/deleted stay 0', async () => {
		const scenario = {
			events: [{ id: 3001, company_id: 3, has_recording: false, has_panel_consent: true }],
		};
		const client = makeClient(scenario);
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /DELETE FROM interview_events/i)).toHaveLength(0);
		const updates = callsMatching(client, /UPDATE interview_events/i);
		expect(updates).toHaveLength(1);
		expect(updates[0][1]).toEqual([7, [3001]]);
		expect(result.gapC.interviewEventsKeptForPanelConsent).toBe(1);
		expect(result.gapC.interviewEventsRedacted).toBe(0);
		expect(result.gapC.interviewEventsDeleted).toBe(0);
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
		// #1154 truthfulness: the error-company (4) event is preserved but
		// is NOT a legal hold — it lands in the lookup-failed bucket only.
		// Exactly one row failed (event 1002; it has no slots/rooms), so
		// interview_events appears in BOTH lists: held via event 1001,
		// lookup-failed via event 1002.
		expect(result.gapC.holdLookupFailed).toBe(1);
		expect(result.gapC.lookupFailedTables).toEqual(['interview_events']);
	});

	test('#1154 child split: the whole scheduled cluster of a lookup-failed parent counts as lookup-failed, never as held', async () => {
		const scenario = {
			scheduled: [
				{ id: 101, company_id: 4 },
				{ id: 103, company_id: 3 },
			],
			panels: [
				{ id: 501, interview_session_id: 101 },
				{ id: 503, interview_session_id: 103 },
			],
			panelNotes: [
				{ id: 601, panel_id: 501 },
				{ id: 603, panel_id: 503 },
			],
			panelMembers: [
				{ id: 701, panel_id: 501 },
				{ id: 703, panel_id: 503 },
			],
			scorecards: [
				{ id: 801, panel_id: 501 },
				{ id: 803, panel_id: 503 },
			],
			scorecardItems: [
				{ id: 901, scorecard_id: 801 },
				{ id: 903, scorecard_id: 803 },
			],
			reminders: [
				{ id: 201, interview_id: 101, recipient_id: 55 },
				{ id: 204, interview_id: 103, recipient_id: 55 },
			],
			errorCompanies: new Set([4]),
		};
		const client = makeClient(scenario);
		const result = await erasureService.erasePersonalData(7, { client });

		// Only the clean branch is deleted, at every level.
		expect(callsMatching(client, /DELETE FROM scheduled_interviews/i)[0][1]).toEqual([7, [103]]);
		expect(callsMatching(client, /DELETE FROM interview_panels/i)[0][1]).toEqual([[503]]);
		expect(callsMatching(client, /DELETE FROM scorecards/i)[0][1]).toEqual([[803]]);
		expect(callsMatching(client, /DELETE FROM interview_reminders/i)[0][1]).toEqual([[204]]);
		expect(result.gapC.scheduledInterviews).toBe(1);
		expect(result.gapC.interviewPanels).toBe(1);
		expect(result.gapC.scorecards).toBe(1);
		// One failed row at each of the seven levels, all lookup-failed.
		expect(result.gapC.holdLookupFailed).toBe(7);
		expect(result.gapC.lookupFailedTables).toEqual(
			expect.arrayContaining([
				'scheduled_interviews',
				'interview_panels',
				'scorecards',
				'scorecard_items',
				'panel_notes',
				'panel_members',
				'interview_reminders',
			]),
		);
		expect(result.gapC.rowsHeld).toBe(0);
		expect(result.gapC.heldTables).toEqual([]);
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

	test('fix round (Option A): rooms DELETE carries the NOT EXISTS recording partition; a referenced room is counted kept, never deleted; the recording row is never touched', async () => {
		// Two unheld event-linked rooms are DELETE candidates: 1201
		// (its event is recording-linked) and 1202 (childless event).
		// The mocked fake cannot evaluate NOT EXISTS or model the
		// mig-128 CASCADE, so the DB's partition outcome is simulated
		// with deleteCounts: only 1 of the 2 candidate rows is
		// actually deleted. The service must count the survivor
		// separately — kept = candidates − deleted.
		const scenario = {
			events: [
				{ id: 1001, company_id: 3, has_recording: true },
				{ id: 1002, company_id: 3, has_recording: false },
			],
			rooms: [
				{ id: 1201, interview_event_id: 1001 },
				{ id: 1202, interview_event_id: 1002 },
			],
			deleteCounts: { interview_rooms: 1 },
		};
		const client = makeClient(scenario);
		const result = await erasureService.erasePersonalData(7, { client });

		const roomDeletes = callsMatching(client, /DELETE FROM interview_rooms/i);
		expect(roomDeletes).toHaveLength(1);
		const [sql, params] = roomDeletes[0];
		// The partition is IN the DELETE (evaluated at DELETE time,
		// in-transaction), not a JS pre-filter: both unheld candidates
		// are passed and the DB excludes referenced rooms.
		expect(sql).toMatch(
			/NOT EXISTS\s*\(\s*SELECT 1 FROM interview_recordings WHERE room_id = interview_rooms\.id\s*\)/i,
		);
		expect(params).toEqual([[1201, 1202]]);
		// The scope guard stands on the candidate SELECT.
		const roomSelect = client.query.mock.calls.find(
			([s]) => /SELECT/i.test(s) && /FROM interview_rooms/i.test(s),
		);
		expect(roomSelect[0]).toMatch(/interview_session_id IS NULL/i);
		// Counting: 1 deleted, 1 kept-for-recordings — never conflated.
		expect(result.gapC.interviewRooms).toBe(1);
		expect(result.gapC.interviewRoomsKeptForRecordings).toBe(1);
		// Option B is the forbidden shape: GAP-C issues no DELETE and
		// no UPDATE against interview_recordings in this scenario
		// (GAP-A's own keep-redact finds no recording rows here).
		expect(callsMatching(client, /DELETE FROM interview_recordings/i)).toHaveLength(0);
		expect(callsMatching(client, /UPDATE interview_recordings/i)).toHaveLength(0);
		// No redaction of the surviving room either: no UPDATE at all
		// is issued against interview_rooms.
		expect(callsMatching(client, /UPDATE interview_rooms/i)).toHaveLength(0);
		// Held counting is unchanged by the partition: nothing held here.
		expect(result.gapC.rowsHeld).toBe(0);
	});

	test('fix round (Option A): an unreferenced room is whole-DELETED and kept count stays zero', async () => {
		const scenario = {
			events: [{ id: 1002, company_id: 3, has_recording: false }],
			rooms: [{ id: 1202, interview_event_id: 1002 }],
		};
		const client = makeClient(scenario);
		const result = await erasureService.erasePersonalData(7, { client });

		const roomDeletes = callsMatching(client, /DELETE FROM interview_rooms/i);
		expect(roomDeletes).toHaveLength(1);
		expect(roomDeletes[0][1]).toEqual([[1202]]);
		expect(result.gapC.interviewRooms).toBe(1);
		expect(result.gapC.interviewRoomsKeptForRecordings).toBe(0);
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
			interviewEventsKeptForPanelConsent: 0,
			proposedSlots: 0,
			interviewRooms: 0,
			interviewRoomsKeptForRecordings: 0,
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
