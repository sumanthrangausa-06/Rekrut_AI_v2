/**
 * #1124 GAP-E (E-11): Erasure completeness — profile-adjacent & career
 * leftovers, incl. special-category `candidate_demographics`.
 *
 * erasePersonalData() previously had ZERO references to these 19
 * tables: account deletion tombstones the users row, so the
 * migrations' ON DELETE CASCADEs never fire and every row survived.
 * STOP 1 (issue #1124, comment 6171997501) + comments verification
 * (6172041587) + Rex's rulings (6172052312) scoped the build:
 *
 *   DEMOGRAPHICS FIRST, standalone: whole-row DELETE + rowCount only.
 *   Its values (gender / ethnicity / age_group / disability_status)
 *   are NEVER selected, never a join key.
 *   THIRD-PARTY SET — whole-row DELETE, no keeps: recruiter_feedback
 *   (by candidate_id), shared_notes (by candidate_id),
 *   skill_endorsements (STRICTLY by candidate_id — never recruiter_id),
 *   candidate_invites (whole row incl. recruiter message).
 *   CANDIDATE'S OWN SET — whole-row by user_id; mig-131 children are
 *   deleted explicitly by their own user_id (ON DELETE SET NULL is
 *   never relied on); company_research_briefs.company_id is the
 *   RESEARCHED company — never hold attribution.
 *   application_optimizations — whole-row DELETE (originals AND the
 *   AI-rewritten outputs die with the row; no skeleton, no UPDATE).
 *   COMMENTS — ONE recursive scan (application branch ONLY, via the
 *   candidate's application ids, + reply children via parent_id
 *   transitively), partitioned per row by its precomputed company
 *   (application ⇒ job_applications.company_id), then
 *   comment_mentions DELETE by id set BEFORE comments DELETE by id
 *   set. A mention naming the candidate on ANOTHER comment is
 *   deleted row-only (host untouched) and inherits its parent
 *   comment's partition exactly.
 *   NAMED RESIDUAL (#1124 steering; Scout build-entry re-verification
 *   superseding 6172041587): comments with entity_type='candidate'
 *   are NOT deleted in this build — what entity_id denotes for that
 *   branch is UNVERIFIABLE from the repo (migration 128: no FK, no
 *   DDL comment; sole writer routes/collaboration.js is a
 *   branch-blind pass-through of req.body; the frontend never
 *   instantiates entityType="candidate"; no tests/seeds create one),
 *   and the users.id / candidate_profiles.id SERIAL spaces overlap,
 *   so a guessed join could erase another candidate's comments. The
 *   subset is blocked pending a live-DB join check or a recorded
 *   ruling adopting users.id as a decided interpretation. The
 *   residual is pinned by a dedicated test below — it must NOT be
 *   forced green by re-adding a candidate branch.
 *   LEGAL HOLD — shipped entry gate unchanged; per-row consults
 *   fail-closed via a GAP-E-LOCAL three-way partition (gapEPartition,
 *   beside the block; gapDPartition is NOT modified): unheld (delete)
 *   / genuinely held (rowsHeld + heldTables) / lookup-failed
 *   (holdLookupFailed + lookupFailedTables, SEPARATE — error-skips
 *   never masquerade as holds, #1116/#1154 honesty rule).
 *   BUILD CHECK (STOP 1 §7): portfolio_projects.image_url is a
 *   free-form client-supplied URL (routes/candidate.js stores
 *   req.body.image_url verbatim; no upload writer, no client usage)
 *   — not storage-generated as a class; any /api/files/-shaped value
 *   on an unheld row is nevertheless ledgered in-tx per S-076.
 *
 * Modelled on gap-d-erasure.test.js / gap-c-erasure.test.js
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
		demographics: [],
		feedback: [],
		sharedNotes: [],
		endorsements: [],
		invites: [],
		recommendations: [],
		skillGaps: [],
		learningPaths: [],
		briefs: [],
		salarySessions: [],
		toolProgress: [],
		coachSessions: [],
		optimizations: [],
		commentsScan: [],
		mentionsByComment: [],
		foreignMentions: [],
		portfolio: [],
		jobActions: [],
		savedJobs: [],
		jobAlerts: [],
		offers: [],
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
		// GAP-E comments scan (recursive CTE) before any table match —
		// the scan SQL names job_applications / comments as subqueries.
		if (/WITH RECURSIVE/i.test(sql) && /FROM comments/i.test(sql)) {
			return { rows: s.commentsScan, rowCount: s.commentsScan.length };
		}
		// Mentions naming the candidate (foreign-mention select joins
		// comments) before the by-comment mention select.
		if (/FROM comment_mentions/i.test(sql) && /mentioned_user_id/i.test(sql)) {
			return { rows: s.foreignMentions, rowCount: s.foreignMentions.length };
		}
		if (/FROM comment_mentions/i.test(sql)) {
			return { rows: s.mentionsByComment, rowCount: s.mentionsByComment.length };
		}
		// GAP-D offers (divergence-pin test only).
		if (/FROM offers/i.test(sql)) return { rows: s.offers, rowCount: s.offers.length };
		// GAP-E selects, driving FROM table.
		if (/FROM candidate_demographics/i.test(sql)) return { rows: s.demographics, rowCount: s.demographics.length };
		if (/FROM recruiter_feedback/i.test(sql)) return { rows: s.feedback, rowCount: s.feedback.length };
		if (/FROM shared_notes/i.test(sql)) return { rows: s.sharedNotes, rowCount: s.sharedNotes.length };
		if (/FROM skill_endorsements/i.test(sql)) return { rows: s.endorsements, rowCount: s.endorsements.length };
		if (/FROM candidate_invites/i.test(sql)) return { rows: s.invites, rowCount: s.invites.length };
		if (/FROM career_recommendations/i.test(sql)) return { rows: s.recommendations, rowCount: s.recommendations.length };
		if (/FROM skill_gap_analyses/i.test(sql)) return { rows: s.skillGaps, rowCount: s.skillGaps.length };
		if (/FROM learning_paths/i.test(sql)) return { rows: s.learningPaths, rowCount: s.learningPaths.length };
		if (/FROM company_research_briefs/i.test(sql)) return { rows: s.briefs, rowCount: s.briefs.length };
		if (/FROM salary_practice_sessions/i.test(sql)) return { rows: s.salarySessions, rowCount: s.salarySessions.length };
		if (/FROM profile_tool_progress/i.test(sql)) return { rows: s.toolProgress, rowCount: s.toolProgress.length };
		if (/FROM career_coach_sessions/i.test(sql)) return { rows: s.coachSessions, rowCount: s.coachSessions.length };
		if (/FROM application_optimizations/i.test(sql)) return { rows: s.optimizations, rowCount: s.optimizations.length };
		if (/FROM portfolio_projects/i.test(sql)) return { rows: s.portfolio, rowCount: s.portfolio.length };
		if (/FROM candidate_job_actions/i.test(sql)) return { rows: s.jobActions, rowCount: s.jobActions.length };
		if (/FROM saved_jobs/i.test(sql)) return { rows: s.savedJobs, rowCount: s.savedJobs.length };
		if (/FROM job_alerts/i.test(sql)) return { rows: s.jobAlerts, rowCount: s.jobAlerts.length };
		// Everything else in the pre-#1124 sequence: generic success.
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

const EXTERNAL_IMAGE_URL = 'https://example.com/portfolio/pic.png';
const PATTERN_IMAGE_URL = '/api/files/r2/portfolio/pic.png';

function fullScenario() {
	return {
		demographics: [{ id: 1 }],
		feedback: [
			{ id: 11, company_id: 3 },
			{ id: 12, company_id: null }, // NULL job ⇒ {userId}-only consult
		],
		sharedNotes: [{ id: 21 }, { id: 22 }],
		endorsements: [{ id: 31 }, { id: 32 }],
		invites: [
			{ id: 41, company_id: 3 },
			{ id: 42, company_id: 5 },
		],
		recommendations: [{ id: 51 }],
		skillGaps: [{ id: 52 }],
		learningPaths: [{ id: 53 }],
		briefs: [{ id: 54 }], // company_id is the RESEARCHED company — never selected for hold
		salarySessions: [{ id: 55 }],
		toolProgress: [{ id: 56 }],
		coachSessions: [{ id: 57 }],
		optimizations: [{ id: 61 }, { id: 62 }],
		// Application branch ONLY (steering residual: candidate-entity
		// comments — e.g. a thread rooted at id 71 — are never scanned).
		commentsScan: [
			{ id: 72, entity_type: 'application', entity_id: 900, parent_id: null, company_id: 3 },
			{ id: 73, entity_type: 'application', entity_id: 900, parent_id: 72, company_id: 3, deleted: true },
		],
		mentionsByComment: [
			{ id: 81, comment_id: 72 },
			{ id: 82, comment_id: 73 },
		],
		foreignMentions: [
			{ id: 84, comment_id: 999, company_id: null }, // host comment is NOT the candidate's
			{ id: 85, comment_id: 71, company_id: null }, // host is a candidate-entity comment (residual host) — mention row only
		],
		portfolio: [{ id: 91, image_url: EXTERNAL_IMAGE_URL }],
		jobActions: [{ id: 92 }],
		savedJobs: [{ id: 93 }],
		jobAlerts: [{ id: 94 }],
	};
}

describe('#1124 GAP-E erasePersonalData — profile-adjacent & career family', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('hard-deletes all 19 tables, keyed per STOP 1, with per-table counts in gapE', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		for (const table of [
			'candidate_demographics',
			'recruiter_feedback',
			'shared_notes',
			'skill_endorsements',
			'candidate_invites',
			'career_recommendations',
			'skill_gap_analyses',
			'learning_paths',
			'company_research_briefs',
			'salary_practice_sessions',
			'profile_tool_progress',
			'career_coach_sessions',
			'application_optimizations',
			'comment_mentions',
			'comments',
			'portfolio_projects',
			'candidate_job_actions',
			'saved_jobs',
			'job_alerts',
		]) {
			expect(callsMatching(client, new RegExp(`DELETE FROM ${table}`, 'i'))).toHaveLength(1);
		}
		expect(result.gapE).toMatchObject({
			candidateDemographics: 1,
			recruiterFeedback: 2,
			sharedNotes: 2,
			skillEndorsements: 2,
			candidateInvites: 2,
			careerRecommendations: 1,
			skillGapAnalyses: 1,
			learningPaths: 1,
			companyResearchBriefs: 1,
			salaryPracticeSessions: 1,
			profileToolProgress: 1,
			careerCoachSessions: 1,
			applicationOptimizations: 2,
			comments: 2,
			commentMentions: 4,
			portfolioProjects: 1,
			candidateJobActions: 1,
			savedJobs: 1,
			jobAlerts: 1,
			rowsHeld: 0,
			holdLookupFailed: 0,
			heldTables: [],
			lookupFailedTables: [],
		});
	});

	test('family ORDER: demographics → third-party → mig-131/136 cluster → optimizations → mentions → comments → simple deletes', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		const idx = (table) => callIndex(client, new RegExp(`DELETE FROM ${table}`, 'i'));
		expect(idx('candidate_demographics')).toBeGreaterThan(-1);
		expect(idx('candidate_demographics')).toBeLessThan(idx('recruiter_feedback'));
		expect(idx('recruiter_feedback')).toBeLessThan(idx('shared_notes'));
		expect(idx('shared_notes')).toBeLessThan(idx('skill_endorsements'));
		expect(idx('skill_endorsements')).toBeLessThan(idx('candidate_invites'));
		expect(idx('candidate_invites')).toBeLessThan(idx('career_coach_sessions'));
		// mig-131 children die by their own user_id BEFORE the parent
		// sessions row (SET NULL is never the mechanism).
		expect(idx('career_recommendations')).toBeLessThan(idx('career_coach_sessions'));
		expect(idx('salary_practice_sessions')).toBeLessThan(idx('career_coach_sessions'));
		expect(idx('career_coach_sessions')).toBeLessThan(idx('application_optimizations'));
		expect(idx('application_optimizations')).toBeLessThan(idx('comment_mentions'));
		expect(idx('comment_mentions')).toBeLessThan(idx('comments'));
		expect(idx('comments')).toBeLessThan(idx('portfolio_projects'));
		expect(idx('portfolio_projects')).toBeLessThan(idx('saved_jobs'));
	});

	test('demographics FIRST and independent: values never selected, never a join key, count = DELETE rowCount only', async () => {
		const client = makeClient({ demographics: [{ id: 1 }] });
		const result = await erasureService.erasePersonalData(7, { client });

		// The special-category values are never read anywhere in the run.
		for (const [sql] of client.query.mock.calls) {
			expect(sql).not.toMatch(/gender|ethnicity|age_group|disability_status/i);
		}
		// Its DELETE is the first GAP-E-family statement of the run.
		const demoIdx = callIndex(client, /DELETE FROM candidate_demographics/i);
		expect(demoIdx).toBeGreaterThan(-1);
		for (const table of ['recruiter_feedback', 'shared_notes', 'comments', 'saved_jobs']) {
			const other = callIndex(client, new RegExp(`(SELECT|DELETE FROM) ${table}`, 'i'));
			if (other > -1) expect(demoIdx).toBeLessThan(other);
		}
		const demoDelete = callsMatching(client, /DELETE FROM candidate_demographics/i)[0];
		expect(demoDelete[0]).toMatch(/WHERE user_id = \$1 AND id = ANY\(\$2\)/);
		expect(demoDelete[1]).toEqual([7, [1]]);
		expect(result.gapE.candidateDemographics).toBe(1);
		// Independent of every other family: all other counts stay zero.
		expect(result.gapE.recruiterFeedback).toBe(0);
		expect(result.gapE.comments).toBe(0);
	});

	test('skill_endorsements: keyed STRICTLY on candidate_id — never recruiter_id (endorsements BY this user about others survive)', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		const selects = callsMatching(client, /FROM skill_endorsements/i).filter(
			([sql]) => !/DELETE FROM/i.test(sql),
		);
		expect(selects).toHaveLength(1);
		expect(selects[0][0]).toMatch(/candidate_id = \$1/);
		expect(selects[0][0]).not.toMatch(/recruiter_id/);
		const deletes = callsMatching(client, /DELETE FROM skill_endorsements/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][0]).toMatch(/candidate_id = \$1 AND id = ANY\(\$2\)/);
		expect(deletes[0][0]).not.toMatch(/recruiter_id/);
		expect(deletes[0][1]).toEqual([7, [31, 32]]);
	});

	test('no-over-delete controls: every GAP-E DELETE is scoped to user/candidate 7 and the scenario id sets only', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		const gapETables =
			/candidate_demographics|recruiter_feedback|shared_notes|skill_endorsements|candidate_invites|career_|skill_gap|learning_paths|company_research|salary_practice|profile_tool|application_optimizations|comment_mentions|comments|portfolio_projects|candidate_job_actions|saved_jobs|job_alerts/i;
		for (const [sql, params] of callsMatching(client, /DELETE FROM/i)) {
			if (!gapETables.test(sql)) continue;
			// The other candidate (id 8) never appears in any parameter.
			expect(JSON.stringify(params)).not.toContain('"8"');
			expect(params).not.toContain(8);
		}
		// Another recruiter's feedback on OTHER candidates is never
		// selected: the feedback select is candidate-keyed, params [7].
		const fbSelect = callsMatching(client, /FROM recruiter_feedback/i).filter(
			([sql]) => !/DELETE FROM/i.test(sql),
		)[0];
		expect(fbSelect[0]).toMatch(/candidate_id = \$1/);
		expect(fbSelect[1]).toEqual([7]);
	});

	test('application_optimizations: whole-row DELETE — originals AND AI-rewritten outputs die with the row (never an UPDATE)', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /UPDATE application_optimizations/i)).toHaveLength(0);
		const deletes = callsMatching(client, /DELETE FROM application_optimizations/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][1]).toEqual([7, [61, 62]]);
		expect(result.gapE.applicationOptimizations).toBe(2);
	});

	test('comments: ONE recursive scan covers the application branch + reply children (incl. deleted=true); mentions deleted by id set BEFORE comments', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		const scans = client.query.mock.calls.filter(
			([sql]) => /WITH RECURSIVE/i.test(sql) && /FROM comments/i.test(sql),
		);
		expect(scans).toHaveLength(1);
		const scanSql = scans[0][0];
		expect(scanSql).toMatch(/entity_type = 'application'/);
		expect(scanSql).toMatch(/JOIN job_applications ja ON ja\.id = c\.entity_id AND ja\.candidate_id = \$1/);
		expect(scanSql).toMatch(/parent_id/);
		// Soft-deleted rows are NOT filtered out of the scan.
		expect(scanSql).not.toMatch(/deleted = false/i);

		const mentionDeletes = callsMatching(client, /DELETE FROM comment_mentions/i);
		expect(mentionDeletes).toHaveLength(1);
		expect([...mentionDeletes[0][1][0]].sort((a, b) => a - b)).toEqual([81, 82, 84, 85]);
		const commentDeletes = callsMatching(client, /DELETE FROM comments/i);
		expect(commentDeletes).toHaveLength(1);
		expect(commentDeletes[0][1]).toEqual([[72, 73]]);
		expect(callIndex(client, /DELETE FROM comment_mentions/i)).toBeLessThan(
			callIndex(client, /DELETE FROM comments/i),
		);
		// Host comment 999 (another candidate's thread) is untouched:
		// the mention naming this candidate on it died row-only.
		expect(commentDeletes[0][1][0]).not.toContain(999);
		expect(result.gapE.comments).toBe(2);
		expect(result.gapE.commentMentions).toBe(4);
	});

	test('NAMED RESIDUAL: candidate-entity comments are NOT deleted — the entity_id join is UNVERIFIABLE (no guessed users.id key)', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		const scans = client.query.mock.calls.filter(
			([sql]) => /WITH RECURSIVE/i.test(sql) && /FROM comments/i.test(sql),
		);
		expect(scans).toHaveLength(1);
		// The scan carries NO candidate-entity root branch at all.
		expect(scans[0][0]).not.toMatch(/entity_type = 'candidate'/);
		// Candidate-entity comment 71 (the residual host in the
		// fixtures) is never in a comments DELETE id set — while the
		// mention naming the candidate ON it (85) still dies row-only
		// via the mentioned_user_id path (a real FK column, not a guess).
		const commentDeletes = callsMatching(client, /DELETE FROM comments/i);
		for (const [, params] of commentDeletes) {
			expect(params[0]).not.toContain(71);
		}
		const mentionDeletes = callsMatching(client, /DELETE FROM comment_mentions/i);
		expect(mentionDeletes[0][1][0]).toContain(85);
	});

	test('comments hold partition: held application comments + their mentions survive together; foreign mention on a held host survives', async () => {
		const scenario = fullScenario();
		scenario.commentsScan = scenario.commentsScan.map((r) =>
			r.id === 72 || r.id === 73 ? { ...r, company_id: 99 } : r,
		);
		scenario.foreignMentions = [
			{ id: 84, comment_id: 999, company_id: 99 },
			{ id: 85, comment_id: 71, company_id: null },
		];
		const client = makeClient({ ...scenario, heldCompanies: new Set([99]) });
		const result = await erasureService.erasePersonalData(7, { client });

		// Both scanned comments are held: no comments DELETE is issued.
		const commentDeletes = callsMatching(client, /DELETE FROM comments/i);
		expect(commentDeletes).toHaveLength(0);
		const mentionDeletes = callsMatching(client, /DELETE FROM comment_mentions/i);
		expect([...mentionDeletes[0][1][0]].sort((a, b) => a - b)).toEqual([85]);
		// Held survivals: 2 comments + their 2 mentions + the foreign
		// mention on the held host = 5, named for both tables.
		expect(result.gapE.rowsHeld).toBe(5);
		expect(result.gapE.heldTables).toEqual(expect.arrayContaining(['comments', 'comment_mentions']));
		expect(result.gapE.holdLookupFailed).toBe(0);
	});

	test('candidate_invites: a genuine company hold preserves the row (its own company_id) and names the table', async () => {
		const scenario = fullScenario();
		scenario.invites = [
			{ id: 41, company_id: 99 },
			{ id: 42, company_id: 3 },
		];
		const client = makeClient({ ...scenario, heldCompanies: new Set([99]) });
		const result = await erasureService.erasePersonalData(7, { client });

		const deletes = callsMatching(client, /DELETE FROM candidate_invites/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][1]).toEqual([7, [42]]);
		expect(result.gapE.candidateInvites).toBe(1);
		expect(result.gapE.rowsHeld).toBe(1);
		expect(result.gapE.heldTables).toEqual(['candidate_invites']);
		expect(result.gapE.holdLookupFailed).toBe(0);
	});

	test('hold-lookup SABOTAGE: failure lands in the third bucket — preserved, counted separately, NOT in heldTables, erasure does not throw', async () => {
		const scenario = fullScenario();
		scenario.invites = [
			{ id: 41, company_id: 4 },
			{ id: 42, company_id: 3 },
		];
		const client = makeClient({ ...scenario, errorCompanies: new Set([4]) });
		const result = await erasureService.erasePersonalData(7, { client });

		const deletes = callsMatching(client, /DELETE FROM candidate_invites/i);
		expect(deletes[0][1]).toEqual([7, [42]]);
		expect(result.gapE.candidateInvites).toBe(1);
		expect(result.gapE.holdLookupFailed).toBe(1);
		expect(result.gapE.lookupFailedTables).toEqual(['candidate_invites']);
		expect(result.gapE.rowsHeld).toBe(0);
		expect(result.gapE.heldTables).toEqual([]);
	});

	test('DIVERGENCE PIN (§8): lookup failure is bucketed DIFFERENTLY by the shipped GAP-D partition and by gapEPartition', async () => {
		// Shipped GAP-D machinery (lib/erasureService.js gapDRowHeld):
		// a per-row lookup error is caught and read as HELD — the row is
		// skipped and counted in gapD.rowsHeld / gapD.heldTables, and
		// gapD has NO lookup-failure bucket. (Rex's comment described
		// this as "propagates"; the shipped code + the GAP-D suite pin
		// the catch-to-held behaviour — this pin records the ACTUAL
		// shipped contract so a future "unification" fails loudly.)
		const scenario = fullScenario();
		scenario.offers = [{ id: 95, company_id: 4, signature_url: null }];
		scenario.invites = [
			{ id: 41, company_id: 4 },
			{ id: 42, company_id: 3 },
		];
		const client = makeClient({ ...scenario, errorCompanies: new Set([4]) });
		const result = await erasureService.erasePersonalData(7, { client });

		// GAP-D side: sabotaged offer lands in the HELD bucket.
		expect(result.gapD.rowsHeld).toBeGreaterThanOrEqual(1);
		expect(result.gapD.heldTables).toContain('offers');
		expect(result.gapD.holdLookupFailed).toBeUndefined();
		const offerUpdates = callsMatching(client, /UPDATE offers/i);
		for (const [, p] of offerUpdates) expect(p).not.toContainEqual([7, [95]]);
		// GAP-E side: the SAME sabotage lands in the THIRD bucket.
		expect(result.gapE.holdLookupFailed).toBe(1);
		expect(result.gapE.lookupFailedTables).toEqual(['candidate_invites']);
		expect(result.gapE.rowsHeld).toBe(0);
		expect(result.gapE.heldTables).toEqual([]);
	});

	test('whole-erasure gate: an active hold aborts before any GAP-E statement (LegalHoldError, zero deletes)', async () => {
		const client = makeClient({ ...fullScenario(), gateHeld: true });
		const err = await erasureService.erasePersonalData(7, { client }).catch((e) => e);
		expect(err).toBeInstanceOf(LegalHoldError);
		expect(callsMatching(client, /DELETE FROM/i)).toHaveLength(0);
	});

	test('portfolio image_url build check: a /api/files/-shaped value on an unheld row is ledgered in-tx (S-076); an external URL is not', async () => {
		const scenario = fullScenario();
		scenario.portfolio = [
			{ id: 91, image_url: PATTERN_IMAGE_URL },
			{ id: 95, image_url: EXTERNAL_IMAGE_URL },
		];
		const client = makeClient(scenario);
		const result = await erasureService.erasePersonalData(7, { client });

		const ledger = callsMatching(client, /INSERT INTO pending_storage_deletions/i);
		const ledgeredUrls = ledger.map(([, p]) => p[1]);
		expect(ledgeredUrls).toContain(PATTERN_IMAGE_URL);
		expect(ledgeredUrls).not.toContain(EXTERNAL_IMAGE_URL);
		expect(result.gapE.storageLedgered).toBe(1);
		expect(result.gapE.portfolioProjects).toBe(2);
		expect(result.storageKeys).toContain(PATTERN_IMAGE_URL);
	});

	test('candidate with no GAP-E rows: no GAP-E writes, all counts zero', async () => {
		const client = makeClient({});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(result.gapE).toMatchObject({
			candidateDemographics: 0,
			recruiterFeedback: 0,
			comments: 0,
			commentMentions: 0,
			rowsHeld: 0,
			holdLookupFailed: 0,
			heldTables: [],
			lookupFailedTables: [],
			storageLedgered: 0,
		});
		for (const table of ['candidate_demographics', 'comments', 'comment_mentions', 'saved_jobs']) {
			expect(callsMatching(client, new RegExp(`DELETE FROM ${table}`, 'i'))).toHaveLength(0);
		}
	});
});
