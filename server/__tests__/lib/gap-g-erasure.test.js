/**
 * #1126 GAP-G (E-16): Erasure completeness — account residuals &
 * tokens survive the users tombstone.
 *
 * STOP 1 (issue #1126, comment 6179033161) scoped the build:
 *
 *   DSAR PARITY — every GAP-G write lands inside erasePersonalData():
 *   the admin DSAR path previously applied NO tombstone at all (its
 *   only users write was avatar_url = NULL) while the tombstone lived
 *   only in routes/auth.js (self-serve). erasePersonalData called
 *   with NO auth.js pre-steps must therefore strip the users row AND
 *   delete oauth_connections + password_reset_tokens +
 *   refresh_tokens (Flow B today does none of this).
 *   DELETE FAMILIES (whole-row, counted in result.gapG):
 *   calendar_connections, oauth_exchange_codes (expired AND
 *   unexpired — expiry ≠ erasure), refresh_tokens (DELETE-at-erasure,
 *   named decision), oauth_connections, password_reset_tokens,
 *   user_settings, user_roles (subject's rows), usage_limits,
 *   assessment_referrals, api_keys (by created_by).
 *   assessment_referrals — DELETE under EACH linkage: email =
 *   captured ORIGINAL email OR claimed_by_user_id = subject OR
 *   created_by = subject; company for the hold partition derived via
 *   job_assessment_id → job_assessments → jobs.company_id. Rows of a
 *   different candidate+creator pair are untouched, and NO delete is
 *   issued against job_applications / job_assessment_attempts (their
 *   dispositions belong to their own families).
 *   SEVERANCE (redaction, counted separately, never as deletion):
 *   user_roles.assigned_by → NULL on OTHER users' rows where the
 *   subject was only the assigner — those rows are NOT deleted.
 *   USERS STRIP (in-service, AFTER all email-matched deletes, using
 *   the GAP-F captured original email — never re-derived after
 *   stripping): linkedin_data, title, github_username, company_name,
 *   suspended_at → NULL; parity fields (email → synthetic tombstone,
 *   name → "Deleted User", password_hash / google_id / linkedin_id /
 *   oauth_provider / avatar_url → NULL, deleted_at set). company_id:
 *   NULL for role='candidate'; KEPT for employer-side subjects and
 *   counted in gapG.companyIdResidual (named residual, Lex to
 *   confirm). Billing fields (K-6) are NOT touched. IDEMPOTENT: a
 *   second run on an already-stripped row rewrites nothing (an
 *   existing synthetic email is preserved, never re-minted),
 *   usersRedacted = 0, and the synthetic shape still matches the
 *   GAP-F tombstone-shape detection.
 *   HOLD DISCIPLINE — per-row consults fail-closed via a GAP-G-local
 *   three-way partition (unheld / genuinely held / lookup-failed —
 *   failures get their own counter, never a held masquerade). A held
 *   USER aborts at the entry gate: the users UPDATE does not run.
 *   §4.1 — the gapG result carries COUNTS ONLY: no identifier-derived
 *   value (no email, no username, no token/hash of one) anywhere.
 *
 * Modelled on gap-f-erasure.test.js (SQL-routing fake). Mocked suite:
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

const ORIGINAL_EMAIL = 'candidate@example.com';
const TOMBSTONE_EMAIL = 'deleted_7_abcd1234@deleted.local';
const GITHUB_USERNAME = 'octo-user-1126';

function defaultUserRow(overrides = {}) {
	return {
		email: ORIGINAL_EMAIL,
		name: 'Real Name',
		role: 'candidate',
		company_id: 55,
		deleted_at: null,
		linkedin_data: { headline: 'Real headline' },
		title: 'Real headline',
		github_username: GITHUB_USERNAME,
		company_name: 'Sole Trader Co',
		suspended_at: '2026-01-01T00:00:00.000Z',
		password_hash: 'stored-hash',
		google_id: 'google-1',
		linkedin_id: 'linkedin-1',
		oauth_provider: 'google',
		avatar_url: 'https://example.com/avatar.png',
		...overrides,
	};
}

function strippedUserRow(overrides = {}) {
	return defaultUserRow({
		email: TOMBSTONE_EMAIL,
		name: 'Deleted User',
		company_id: null,
		deleted_at: '2026-10-14T00:00:00.000Z',
		linkedin_data: null,
		title: null,
		github_username: null,
		company_name: null,
		suspended_at: null,
		password_hash: null,
		google_id: null,
		linkedin_id: null,
		oauth_provider: null,
		avatar_url: null,
		...overrides,
	});
}

// ─── Scenario-driven SQL router ─────────────────────────────────────────────
function makeClient(scenario = {}) {
	const s = {
		userEmail: ORIGINAL_EMAIL,
		userRow: defaultUserRow(),
		calendarConnections: [],
		oauthExchangeCodes: [],
		refreshTokens: [],
		oauthConnections: [],
		passwordResetTokens: [],
		userSettings: [],
		userRoles: [],
		assignedByRoles: [],
		usageLimits: [],
		assessmentReferrals: [],
		apiKeys: [],
		heldCompanies: new Set(),
		errorCompanies: new Set(),
		anyHold: false,
		gateHeld: false,
		deleteCounts: {},
		...scenario,
	};
	if (Object.prototype.hasOwnProperty.call(scenario, 'userRow')) {
		s.userRow = scenario.userRow;
	}
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
		// GAP-G users strip read (the only SELECT naming linkedin_data).
		if (/FROM users/i.test(sql) && /linkedin_data/i.test(sql)) {
			return s.userRow == null
				? { rows: [], rowCount: 0 }
				: { rows: [s.userRow], rowCount: 1 };
		}
		// GAP-G selects, driving FROM table.
		if (/FROM calendar_connections/i.test(sql)) return { rows: s.calendarConnections, rowCount: s.calendarConnections.length };
		if (/FROM oauth_exchange_codes/i.test(sql)) return { rows: s.oauthExchangeCodes, rowCount: s.oauthExchangeCodes.length };
		if (/FROM refresh_tokens/i.test(sql)) return { rows: s.refreshTokens, rowCount: s.refreshTokens.length };
		if (/FROM oauth_connections/i.test(sql)) return { rows: s.oauthConnections, rowCount: s.oauthConnections.length };
		if (/FROM password_reset_tokens/i.test(sql)) return { rows: s.passwordResetTokens, rowCount: s.passwordResetTokens.length };
		if (/FROM user_settings/i.test(sql)) return { rows: s.userSettings, rowCount: s.userSettings.length };
		if (/FROM user_roles/i.test(sql) && /assigned_by = \$1/i.test(sql)) {
			return { rows: s.assignedByRoles, rowCount: s.assignedByRoles.length };
		}
		if (/FROM user_roles/i.test(sql)) return { rows: s.userRoles, rowCount: s.userRoles.length };
		if (/FROM usage_limits/i.test(sql)) return { rows: s.usageLimits, rowCount: s.usageLimits.length };
		if (/FROM assessment_referrals/i.test(sql)) {
			// Emulate the real WHERE semantics: the email branch exists
			// only when a usable original email was captured.
			const rows = /ar\.email/i.test(sql)
				? s.assessmentReferrals.filter(
						(r) =>
							r.email === params[1] ||
							r.claimed_by_user_id === params[0] ||
							r.created_by === params[0],
					)
				: s.assessmentReferrals.filter(
						(r) => r.claimed_by_user_id === params[0] || r.created_by === params[0],
					);
			return { rows, rowCount: rows.length };
		}
		if (/FROM api_keys/i.test(sql)) return { rows: s.apiKeys, rowCount: s.apiKeys.length };
		// Everything else in the pre-#1126 sequence: generic success.
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
const stripUpdateRe = /UPDATE users SET\s+deleted_at = NOW\(\)/i;

function fullScenario() {
	return {
		calendarConnections: [{ id: 11 }, { id: 12 }],
		oauthExchangeCodes: [
			{ id: 21 }, // expired row — expiry ≠ erasure
			{ id: 22 }, // unexpired row
		],
		refreshTokens: [{ id: 31 }],
		oauthConnections: [{ id: 41 }, { id: 42 }],
		passwordResetTokens: [{ id: 51 }],
		userSettings: [{ user_id: 7 }],
		userRoles: [
			{ user_id: 7, role_id: 1, company_id: 3 },
			{ user_id: 7, role_id: 2, company_id: 3 },
		],
		assignedByRoles: [{ user_id: 8, role_id: 1, company_id: 3 }],
		usageLimits: [{ id: 61 }, { id: 62 }, { id: 63 }],
		assessmentReferrals: [
			{ id: 71, email: ORIGINAL_EMAIL, claimed_by_user_id: null, created_by: 99, company_id: 3 },
			{ id: 72, email: 'other@example.com', claimed_by_user_id: 7, created_by: 99, company_id: 3 },
			{ id: 73, email: 'other2@example.com', claimed_by_user_id: null, created_by: 7, company_id: 3 },
			// Different candidate+creator pair — must survive untouched.
			{ id: 74, email: 'other3@example.com', claimed_by_user_id: 8, created_by: 8, company_id: 3 },
		],
		apiKeys: [{ id: 81 }, { id: 82 }],
	};
}

describe('#1126 GAP-G erasePersonalData — account residuals & tokens (E-16)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('DSAR parity: no auth.js pre-steps — users row stripped and oauth/reset/refresh rows deleted by the service alone', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /DELETE FROM oauth_connections/i)).toHaveLength(1);
		expect(callsMatching(client, /DELETE FROM password_reset_tokens/i)).toHaveLength(1);
		expect(callsMatching(client, /DELETE FROM refresh_tokens/i)).toHaveLength(1);
		expect(result.gapG).toMatchObject({ oauthConnections: 2, passwordResetTokens: 1, refreshTokens: 1 });
		expect(callsMatching(client, stripUpdateRe)).toHaveLength(1);
		expect(result.gapG.usersRedacted).toBe(1);
	});

	test('hard-deletes every GAP-G family with per-table counts in gapG', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		for (const table of [
			'calendar_connections',
			'oauth_exchange_codes',
			'refresh_tokens',
			'oauth_connections',
			'password_reset_tokens',
			'user_settings',
			'usage_limits',
			'assessment_referrals',
			'api_keys',
		]) {
			expect(callsMatching(client, new RegExp(`DELETE FROM ${table}`, 'i')).length).toBeGreaterThan(0);
		}
		expect(callsMatching(client, /DELETE FROM user_roles/i)).toHaveLength(2);
		expect(result.gapG).toMatchObject({
			calendarConnections: 2,
			oauthExchangeCodes: 2,
			refreshTokens: 1,
			oauthConnections: 2,
			passwordResetTokens: 1,
			userSettings: 1,
			userRoles: 2,
			usageLimits: 3,
			assessmentReferrals: 3,
			apiKeys: 2,
			usersRedacted: 1,
			assignedBySevered: 1,
			companyIdResidual: 0,
			rowsHeld: 0,
			holdLookupFailed: 0,
			heldTables: [],
			lookupFailedTables: [],
		});
		// Keying spot-checks: standard families by their user key +
		// explicit id set; api_keys strictly by created_by.
		const calDelete = callsMatching(client, /DELETE FROM calendar_connections/i)[0];
		expect(calDelete[0]).toMatch(/user_id = \$1 AND id = ANY\(\$2\)/);
		expect(calDelete[1]).toEqual([7, [11, 12]]);
		const apiDelete = callsMatching(client, /DELETE FROM api_keys/i)[0];
		expect(apiDelete[0]).toMatch(/created_by = \$1 AND id = ANY\(\$2\)/);
		expect(apiDelete[1]).toEqual([7, [81, 82]]);
	});

	test('assessment_referrals: deleted under EACH linkage (email / claimed_by / created_by); a different pair survives; no job-family deletes', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		const selects = callsMatching(client, /FROM assessment_referrals/i).filter(
			([sql]) => !/DELETE FROM/i.test(sql),
		);
		expect(selects).toHaveLength(1);
		// Company derived via the job chain (hold attribution).
		expect(selects[0][0]).toMatch(/job_assessments/);
		expect(selects[0][0]).toMatch(/jobs/);
		// Email branch keyed on the CAPTURED original email.
		expect(selects[0][1]).toEqual([7, ORIGINAL_EMAIL]);
		const deletes = callsMatching(client, /DELETE FROM assessment_referrals/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][1]).toEqual([[71, 72, 73]]);
		expect(result.gapG.assessmentReferrals).toBe(3);
		// Claim-then-erase leaves the application families alone.
		expect(callsMatching(client, /DELETE FROM job_applications/i)).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM job_assessment_attempts/i)).toHaveLength(0);
	});

	test('user_roles severance: a second user\u2019s row where the subject is only assigned_by is NOT deleted — assigned_by is severed to NULL and counted as a redaction', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		// The only user_roles DELETEs target the subject's own rows
		// (user_id = 7); user 8's row appears in no DELETE.
		for (const [sql, params] of callsMatching(client, /DELETE FROM user_roles/i)) {
			expect(params).toContain(7);
			expect(params).not.toContain(8);
		}
		const sever = callsMatching(client, /UPDATE user_roles SET assigned_by = NULL/i);
		expect(sever).toHaveLength(1);
		expect(sever[0][0]).toMatch(/WHERE assigned_by = \$1 AND user_id = \$2 AND role_id = \$3 AND company_id = \$4/);
		expect(sever[0][1]).toEqual([7, 8, 1, 3]);
		expect(result.gapG.assignedBySevered).toBe(1);
		// Severance is a redaction count, never folded into deletions.
		expect(result.gapG.userRoles).toBe(2);
	});

	test('users strip: per-column disposition in the UPDATE, run AFTER the email-matched referral delete', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		const strip = callsMatching(client, stripUpdateRe)[0];
		const sql = strip[0];
		for (const assignment of [
			'linkedin_data = NULL',
			'title = NULL',
			'github_username = NULL',
			'company_name = NULL',
			'suspended_at = NULL',
			"email = CASE WHEN email ~ '^deleted_[0-9]+_[^@]+@deleted\\.local$' THEN email ELSE 'deleted_' || id || '_' || substr(md5(random()::text), 1, 8) || '@deleted.local' END",
			"name = 'Deleted User'",
			'password_hash = NULL',
			'google_id = NULL',
			'linkedin_id = NULL',
			'oauth_provider = NULL',
			'avatar_url = NULL',
			"company_id = CASE WHEN role = 'candidate' THEN NULL ELSE company_id END",
		]) {
			expect(sql).toContain(assignment);
		}
		// K-6 billing fields are NOT touched by the strip.
		expect(sql).not.toMatch(/stripe_subscription_id|subscription_plan|subscription_status|is_paid/);
		expect(strip[1]).toEqual([7]);
		// Ordering: the strip runs after the email-matched deletes
		// (the referral select/delete used the captured original).
		expect(callIndex(client, stripUpdateRe)).toBeGreaterThan(
			callIndex(client, /DELETE FROM assessment_referrals/i),
		);
	});

	test('users strip idempotency: second run on a stripped row rewrites nothing, counts 0, synthetic email unchanged', async () => {
		const client = makeClient({ userRow: strippedUserRow(), userEmail: TOMBSTONE_EMAIL });
		const result = await erasureService.erasePersonalData(7, { client, originalEmail: ORIGINAL_EMAIL });

		expect(callsMatching(client, stripUpdateRe)).toHaveLength(0);
		expect(result.gapG.usersRedacted).toBe(0);
		// The GAP-F tombstone-shape detection still matches the
		// preserved synthetic address (capture NOT failed when the
		// caller supplied the original email).
		expect(result.gapF.emailCaptureFailed).toBe(false);
	});

	test('self-serve parity: an auth.js-tombstoned row with GAP-G residuals still strips the residuals and PRESERVES the existing synthetic email', async () => {
		// Flow A already rewrote email/name and nulled the parity
		// fields, but linkedin_data/title/github/company/suspension
		// survive that tombstone — the in-service strip completes it.
		const client = makeClient({
			userRow: strippedUserRow({
				company_id: null,
				linkedin_data: { headline: 'Real headline' },
				title: 'Real headline',
				github_username: GITHUB_USERNAME,
				company_name: 'Sole Trader Co',
				suspended_at: '2026-01-01T00:00:00.000Z',
			}),
			userEmail: TOMBSTONE_EMAIL,
		});
		const result = await erasureService.erasePersonalData(7, { client, originalEmail: ORIGINAL_EMAIL });

		expect(callsMatching(client, stripUpdateRe)).toHaveLength(1);
		expect(result.gapG.usersRedacted).toBe(1);
		// The email CASE preserves the existing synthetic address —
		// no new synthetic value is minted over it.
		expect(callsMatching(client, stripUpdateRe)[0][0]).toMatch(/email = CASE WHEN email ~/);
	});

	test('company_id split: employer-side subject keeps company_id and it is counted as a residual', async () => {
		const client = makeClient({ userRow: defaultUserRow({ role: 'recruiter' }) });
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, stripUpdateRe)).toHaveLength(1);
		expect(result.gapG.usersRedacted).toBe(1);
		expect(result.gapG.companyIdResidual).toBe(1);
	});

	test('per-row hold: a held user_roles row survives, counted in rowsHeld and named in heldTables', async () => {
		const client = makeClient({
			userRoles: [
				{ user_id: 7, role_id: 1, company_id: 99 },
				{ user_id: 7, role_id: 2, company_id: 3 },
			],
			heldCompanies: new Set([99]),
		});
		const result = await erasureService.erasePersonalData(7, { client });

		const deletes = callsMatching(client, /DELETE FROM user_roles/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][1]).toEqual([7, 2, 3]);
		expect(result.gapG.userRoles).toBe(1);
		expect(result.gapG.rowsHeld).toBe(1);
		expect(result.gapG.heldTables).toEqual(['user_roles']);
		expect(result.gapG.holdLookupFailed).toBe(0);
	});

	test('per-row hold: a held assessment_referrals row (company derived via its job) survives and is disclosed', async () => {
		const client = makeClient({
			assessmentReferrals: [
				{ id: 71, email: ORIGINAL_EMAIL, claimed_by_user_id: null, created_by: 99, company_id: 99 },
				{ id: 72, email: 'other@example.com', claimed_by_user_id: 7, created_by: 99, company_id: 3 },
			],
			heldCompanies: new Set([99]),
		});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /DELETE FROM assessment_referrals/i)[0][1]).toEqual([[72]]);
		expect(result.gapG.assessmentReferrals).toBe(1);
		expect(result.gapG.rowsHeld).toBe(1);
		expect(result.gapG.heldTables).toEqual(['assessment_referrals']);
	});

	test('hold-lookup SABOTAGE: failure lands in the third bucket — preserved, counted separately, NOT in heldTables', async () => {
		const client = makeClient({
			assessmentReferrals: [
				{ id: 71, email: ORIGINAL_EMAIL, claimed_by_user_id: null, created_by: 99, company_id: 4 },
				{ id: 72, email: 'other@example.com', claimed_by_user_id: 7, created_by: 99, company_id: 3 },
			],
			errorCompanies: new Set([4]),
		});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /DELETE FROM assessment_referrals/i)[0][1]).toEqual([[72]]);
		expect(result.gapG.assessmentReferrals).toBe(1);
		expect(result.gapG.holdLookupFailed).toBe(1);
		expect(result.gapG.lookupFailedTables).toEqual(['assessment_referrals']);
		expect(result.gapG.rowsHeld).toBe(0);
		expect(result.gapG.heldTables).toEqual([]);
	});

	test('severance hold: a held assigned_by row is NOT severed and is disclosed as held', async () => {
		const client = makeClient({
			assignedByRoles: [{ user_id: 8, role_id: 1, company_id: 99 }],
			heldCompanies: new Set([99]),
		});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /UPDATE user_roles SET assigned_by = NULL/i)).toHaveLength(0);
		expect(result.gapG.assignedBySevered).toBe(0);
		expect(result.gapG.rowsHeld).toBe(1);
		expect(result.gapG.heldTables).toEqual(['user_roles']);
	});

	test('whole-erasure gate: a held USER aborts before the GAP-G block — the users UPDATE does not run (entry gate)', async () => {
		const client = makeClient({ ...fullScenario(), gateHeld: true });
		const err = await erasureService.erasePersonalData(7, { client }).catch((e) => e);
		expect(err).toBeInstanceOf(LegalHoldError);
		expect(callsMatching(client, /DELETE FROM/i)).toHaveLength(0);
		expect(callsMatching(client, stripUpdateRe)).toHaveLength(0);
	});

	test('§4.1: the gapG result carries counts only — no identifier-derived values anywhere', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		const serialised = JSON.stringify(result.gapG);
		expect(serialised).not.toContain(ORIGINAL_EMAIL);
		expect(serialised).not.toContain(GITHUB_USERNAME);
		expect(serialised).not.toContain('Real Name');
		expect(serialised).not.toContain('Sole Trader Co');
		for (const [key, value] of Object.entries(result.gapG)) {
			// No hash/marker field of any identifier (§4.1) — count
			// keys naming a family (e.g. refreshTokens) are counts,
			// not identifier-derived values.
			expect(key).not.toMatch(/hash|hmac|marker/i);
			if (Array.isArray(value)) {
				for (const entry of value) expect(typeof entry).toBe('string');
			} else {
				expect(typeof value).toBe('number');
			}
		}
	});

	test('user with no GAP-G rows and no users row: no GAP-G writes, all counts zero', async () => {
		const client = makeClient({ userRow: null });
		const result = await erasureService.erasePersonalData(7, { client });

		expect(result.gapG).toMatchObject({
			calendarConnections: 0,
			oauthExchangeCodes: 0,
			refreshTokens: 0,
			oauthConnections: 0,
			passwordResetTokens: 0,
			userSettings: 0,
			userRoles: 0,
			usageLimits: 0,
			assessmentReferrals: 0,
			apiKeys: 0,
			usersRedacted: 0,
			assignedBySevered: 0,
			companyIdResidual: 0,
			rowsHeld: 0,
			holdLookupFailed: 0,
			heldTables: [],
			lookupFailedTables: [],
		});
		for (const table of [
			'calendar_connections',
			'oauth_exchange_codes',
			'refresh_tokens',
			'oauth_connections',
			'password_reset_tokens',
			'user_settings',
			'user_roles',
			'usage_limits',
			'assessment_referrals',
			'api_keys',
		]) {
			expect(callsMatching(client, new RegExp(`DELETE FROM ${table}`, 'i'))).toHaveLength(0);
		}
		expect(callsMatching(client, stripUpdateRe)).toHaveLength(0);
	});
});
