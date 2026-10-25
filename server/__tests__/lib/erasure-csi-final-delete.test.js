/**
 * #1293: explicit final candidate_search_index (CSI) delete in
 * erasePersonalData.
 *
 * The admin DSAR path calls erasePersonalData with NO prior tombstone.
 * Post-#1163 its CSI closure depended on the GAP-G users strip (end of
 * erasePersonalData) including name/avatar_url in its SET list, firing
 * trg_sync_csi_users whose guarded sync deletes the resurrected CSI row.
 * That coupling is fragile: reordering GAP-G, dropping those columns
 * from the strip SET, or adding a CSI-affecting write after GAP-G would
 * silently reopen the resurrection on the admin path only.
 *
 * #1293 option (a) pins closure with an explicit final
 *   DELETE FROM candidate_search_index WHERE user_id = $1
 * AFTER the GAP-G strip section — ordering-independent.
 *
 * This test asserts, from the recorded query sequence of a mock-pool
 * client (the neighbouring erasure suites' style), that a CSI DELETE
 * is issued positioned AFTER the GAP-G users-strip UPDATE. On pristine
 * dev the only CSI DELETE is the early S-075 one (before GAP-G), so
 * this test is RED there and GREEN after the fix.
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

const ORIGINAL_EMAIL = 'candidate@example.com';

function defaultUserRow(overrides = {}) {
	return {
		email: ORIGINAL_EMAIL,
		name: 'Real Name',
		role: 'candidate',
		company_id: 55,
		deleted_at: null,
		linkedin_data: { headline: 'Real headline' },
		title: 'Real headline',
		github_username: 'octo-user-1293',
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

// Minimal SQL-routing fake in the gap-g-erasure.test.js style: no legal
// holds, a non-tombstoned users row (so the GAP-G strip UPDATE runs),
// generic success for every other family in the sequence.
function makeClient() {
	const client = { query: jest.fn() };
	client.query.mockImplementation(async (sql, params = []) => {
		if (/FROM legal_holds/i.test(sql)) {
			return { rows: [], rowCount: 0 };
		}
		const writeMatch = sql.match(/(?:DELETE FROM|UPDATE)\s+(\w+)/i);
		if (writeMatch) {
			const arr = params.find((p) => Array.isArray(p));
			return { rows: [], rowCount: arr ? arr.length : 1 };
		}
		if (/SELECT email FROM users WHERE id = \$1/i.test(sql)) {
			return { rows: [{ email: ORIGINAL_EMAIL }], rowCount: 1 };
		}
		if (/FROM users/i.test(sql) && /linkedin_data/i.test(sql)) {
			return { rows: [defaultUserRow()], rowCount: 1 };
		}
		return { rows: [], rowCount: 1 };
	});
	return client;
}

const csiDeleteRe = /DELETE FROM candidate_search_index WHERE user_id = \$1/i;
const gapGStripRe = /UPDATE users SET\s+deleted_at = NOW\(\)/i;

describe('#1293 erasePersonalData — explicit final CSI delete', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('issues a CSI DELETE positioned AFTER the GAP-G users-strip UPDATE', async () => {
		const client = makeClient();
		await erasureService.erasePersonalData(7, { client });

		const calls = client.query.mock.calls.map(([sql]) => sql);
		const stripIdx = calls.findIndex((sql) => gapGStripRe.test(sql));
		// Precondition: the admin-DSAR-shaped run really did execute the
		// GAP-G strip (otherwise the ordering assertion is meaningless).
		expect(stripIdx).toBeGreaterThan(-1);

		const csiIdxs = calls
			.map((sql, i) => (csiDeleteRe.test(sql) ? i : -1))
			.filter((i) => i >= 0);
		expect(csiIdxs.length).toBeGreaterThan(0);

		// The pin: at least one CSI DELETE after the GAP-G strip.
		const finalCsiIdx = csiIdxs[csiIdxs.length - 1];
		expect(finalCsiIdx).toBeGreaterThan(stripIdx);

		// Keyed strictly on the subject id.
		expect(client.query.mock.calls[finalCsiIdx][1]).toEqual([7]);
	});
});
