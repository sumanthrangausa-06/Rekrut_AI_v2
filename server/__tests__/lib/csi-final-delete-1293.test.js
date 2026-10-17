/**
 * #1293 (follow-up to #1163, privacy-engineer Note N2 on PR #1292):
 * Admin-DSAR CSI closure must not depend on GAP-G strip ordering.
 *
 * The admin DSAR path (routes/admin.js) calls erasePersonalData with NO
 * prior tombstone. Post-#1163 that path closed only because the GAP-G
 * users strip at the END of erasePersonalData includes name/avatar_url,
 * firing trg_sync_csi_users, whose p3e-guarded sync deletes the
 * resurrected candidate_search_index (CSI) row. Fragile coupling: any
 * future edit that reorders GAP-G earlier, drops those columns from the
 * strip SET, or adds a CSI-affecting write after GAP-G silently reopens
 * resurrection on the admin path only.
 *
 * Pin: erasePersonalData must issue an explicit FINAL
 * `DELETE FROM candidate_search_index WHERE user_id = $1` AFTER the
 * GAP-G section, so closure is ordering-independent.
 *
 * Modelled on gap-g-erasure.test.js (SQL-routing fake). The fake
 * simulates the UNGUARDED trigger behaviour (pre-#1163 / guard-lost
 * regression): every CSI-affecting write — a users UPDATE or a
 * candidate_skills DELETE — re-upserts the CSI row. Under that
 * simulation the ONLY way erasePersonalData can end with zero CSI rows
 * on the no-tombstone path is an explicit CSI DELETE after the last
 * CSI-affecting write (the GAP-G strip).
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

const fs = require('node:fs');
const path = require('node:path');
const erasureService = require('../../../lib/erasureService');

const ORIGINAL_EMAIL = 'candidate@example.com';

// Live, NON-tombstoned candidate — the admin-DSAR starting state.
function liveUserRow() {
	return {
		email: ORIGINAL_EMAIL,
		name: 'Real Name',
		role: 'candidate',
		company_id: null,
		deleted_at: null,
		linkedin_data: { headline: 'Real headline' },
		title: 'Real headline',
		github_username: 'octo-user',
		company_name: null,
		suspended_at: null,
		password_hash: 'stored-hash',
		google_id: 'google-1',
		linkedin_id: null,
		oauth_provider: 'google',
		avatar_url: 'https://example.com/avatar.png',
	};
}

function makeClient() {
	const state = { csiPresent: true }; // candidate starts indexed
	const client = { query: jest.fn(), __csiState: state };
	client.query.mockImplementation(async (sql, params = []) => {
		if (/FROM legal_holds/i.test(sql)) return { rows: [], rowCount: 0 };
		// CSI DELETE — the only statement that removes the row.
		if (/DELETE FROM candidate_search_index/i.test(sql)) {
			const was = state.csiPresent;
			state.csiPresent = false;
			return { rows: [], rowCount: was ? 1 : 0 };
		}
		// Unguarded-trigger simulation: CSI-affecting writes resurrect.
		if (/DELETE FROM candidate_skills/i.test(sql)) {
			state.csiPresent = true;
			return { rows: [], rowCount: 1 };
		}
		const writeMatch = sql.match(/(?:DELETE FROM|UPDATE)\s+(\w+)/i);
		if (writeMatch) {
			if (writeMatch[1] === 'users') state.csiPresent = true;
			const arr = params.find((p) => Array.isArray(p));
			return { rows: [], rowCount: arr ? arr.length : 1 };
		}
		if (/SELECT email FROM users WHERE id = \$1/i.test(sql)) {
			return { rows: [{ email: ORIGINAL_EMAIL }], rowCount: 1 };
		}
		// GAP-G users strip read (the only SELECT naming linkedin_data).
		if (/FROM users/i.test(sql) && /linkedin_data/i.test(sql)) {
			return { rows: [liveUserRow()], rowCount: 1 };
		}
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
function lastCallIndex(client, re) {
	const idxs = client.query.mock.calls
		.map(([sql], i) => (re.test(sql) ? i : -1))
		.filter((i) => i >= 0);
	return idxs.length ? idxs[idxs.length - 1] : -1;
}
const csiDeleteRe = /DELETE FROM candidate_search_index WHERE user_id = \$1/i;
const stripUpdateRe = /UPDATE users SET\s+deleted_at = NOW\(\)/i;

describe('#1293 erasePersonalData — explicit final CSI delete (admin-DSAR, no prior tombstone)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('ends with zero CSI rows even though CSI-affecting writes fire after the early CSI delete', async () => {
		const client = makeClient();
		await erasureService.erasePersonalData(7, { client });
		// Sanity: the hazard really fired — the GAP-G strip ran (admin path).
		expect(callsMatching(client, stripUpdateRe)).toHaveLength(1);
		expect(client.__csiState.csiPresent).toBe(false);
	});

	test('the last CSI DELETE is issued after the GAP-G users strip', async () => {
		const client = makeClient();
		await erasureService.erasePersonalData(7, { client });
		const stripIdx = callIndex(client, stripUpdateRe);
		const lastCsiDeleteIdx = lastCallIndex(client, csiDeleteRe);
		expect(stripIdx).toBeGreaterThanOrEqual(0);
		expect(lastCsiDeleteIdx).toBeGreaterThan(stripIdx);
	});

	test('source pin: a CSI DELETE occurs after the GAP-G strip in lib/erasureService.js', () => {
		const src = fs.readFileSync(
			path.join(__dirname, '..', '..', '..', 'lib', 'erasureService.js'),
			'utf8',
		);
		const stripIdx = src.search(stripUpdateRe);
		const lastCsiDeleteIdx = src.lastIndexOf(
			'DELETE FROM candidate_search_index WHERE user_id = $1',
		);
		expect(stripIdx).toBeGreaterThanOrEqual(0);
		expect(lastCsiDeleteIdx).toBeGreaterThan(stripIdx);
	});
});
