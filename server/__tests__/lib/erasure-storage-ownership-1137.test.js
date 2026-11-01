/**
 * #1137: storage-ledger ownership check in the Phase-2 drain.
 *
 * Before this story: deleteErasedStorageFiles deleted any ledgered
 * /api/files/ URL via deleteFile, which checks only the URL *shape*.
 * URL fields on several ledgered families are client-supplied
 * (onboarding_documents.document_url, offers.signature_url,
 * portfolio_projects.image_url, documents.url), so a candidate could
 * plant another tenant's object key on their own row and have that
 * object deleted at their erasure.
 *
 * Design (STOP 1 on #1137, discussed panel): the drain is the single
 * choke point. Before deleting a non-catalogue r2 entry, it asks
 * lib/storageOwnership whether any SURVIVING database row still
 * references the object (exact-equality on the raw + fully-decoded
 * spellings — never LIKE). A surviving reference means ownership is
 * contested/unverifiable → fail closed: skip, leave the ledger row
 * 'pending' (legal-hold precedent; never 'failed', no attempts
 * increment), count ownershipSkips / ownershipSkipsByFamily. A
 * reference-query error fails closed the same way, counted as
 * ownershipLookupFailed. Catalogue families whose keys are
 * server-generated from candidate-keyed rows (frame, observer_audio,
 * livekit_recording) are exempt by source.
 *
 * The mocked DB below emulates the surviving-reference predicate from
 * the params the drain passes (same style as
 * erasure-failed-retry-1171.test.js): on pristine dev the drain issues
 * no such query, deleteFile is called for the planted URL, and the
 * plant tests are RED. Mocked evidence only here; the real-DB proof
 * is erasure-storage-ownership-1137.integration.test.js (Quinn gate).
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
	connect: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn(async () => {}),
}));
jest.mock('../../../lib/file-storage', () => ({
	deleteFile: jest.fn(async () => ({ deleted: true })),
	deleteStorageObject: jest.fn(async () => ({ deleted: true })),
	getProviders: jest.fn(() => [{ name: 'r2', bucket: 'test-bucket' }]),
}));
jest.mock('../../../services/encryption', () => ({
	deleteEncryptedFile: jest.fn(),
	decrypt: jest.fn((buf) => Buffer.from(buf)),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const db = require('../../../lib/db');
const { deleteFile } = require('../../../lib/file-storage');
const erasureService = require('../../../lib/erasureService');
const storageOwnership = require('../../../lib/storageOwnership');

const B_URL = '/api/files/r2/resumes/1720000000000-abc123-victim-cv.pdf';
const A_URL = '/api/files/r2/resumes/1720000001000-def456-own-cv.pdf';

let S;
function entry(over = {}) {
	return {
		id: 1,
		user_id: 7,
		file_url: A_URL,
		storage_type: 'r2',
		source_family: null,
		status: 'pending',
		attempts: 0,
		...over,
	};
}

async function route(sql, params = []) {
	const text = String(sql);
	if (/FROM legal_holds/.test(text)) {
		if (S.holdError) throw new Error('hold lookup down');
		return { rows: S.held ? [{ id: 1, user_id: 7, company_id: null }] : [], rowCount: S.held ? 1 : 0 };
	}
	if (/still_referenced/.test(text)) {
		if (S.ownershipError) throw new Error('reference lookup down');
		// Emulate exact-equality surviving-reference matching: a form is
		// referenced iff the scenario lists one of the passed spellings.
		const hit = params.some((p) => typeof p === 'string' && S.referencedForms.has(p));
		return { rows: [{ still_referenced: hit }], rowCount: 1 };
	}
	if (/FROM pending_storage_deletions/.test(text)) {
		const max = params[1];
		const rows = S.entries.filter(
			(e) =>
				e.user_id === params[0] &&
				(e.status === 'pending' || (e.status === 'failed' && e.attempts < max)),
		);
		return { rows, rowCount: rows.length };
	}
	if (/UPDATE pending_storage_deletions/.test(text)) {
		const e = S.entries.find((x) => x.id === params[2]);
		if (e) {
			e.status = params[0];
			e.attempts += 1;
		}
		return { rows: [], rowCount: e ? 1 : 0 };
	}
	return { rows: [], rowCount: 1 };
}

beforeEach(() => {
	jest.clearAllMocks();
	S = {
		entries: [],
		held: false,
		holdError: false,
		ownershipError: false,
		referencedForms: new Set(),
	};
	deleteFile.mockImplementation(async () => ({ deleted: true }));
	db.query.mockImplementation(route);
	db.connect.mockImplementation(async () => ({ query: jest.fn(route), release: jest.fn() }));
});

describe('#1137 drain ownership check', () => {
	test("own object with no surviving reference is deleted as before", async () => {
		S.entries = [entry()];
		const res = await erasureService.deleteErasedStorageFiles(7);
		expect(deleteFile).toHaveBeenCalledWith(A_URL);
		expect(res.deleted).toBe(1);
		expect(res.ownershipSkips).toBe(0);
		expect(res.ownershipLookupFailed).toBe(0);
		expect(S.entries[0].status).toBe('deleted');
	});

	test("planted cross-tenant URL: another tenant's surviving row references the object → NOT deleted, stays pending, disclosed", async () => {
		// Candidate A (user 7) planted candidate B's CV URL on A's own
		// onboarding document row; B's cv_uploads row still references it.
		S.entries = [entry({ file_url: B_URL })];
		S.referencedForms = new Set([B_URL]);
		const res = await erasureService.deleteErasedStorageFiles(7);
		expect(deleteFile).not.toHaveBeenCalled();
		expect(res.deleted).toBe(0);
		expect(res.failed).toBe(0);
		expect(res.ownershipSkips).toBe(1);
		expect(res.ownershipSkipsByFamily).toEqual({ file: 1 });
		// Contested is NOT a dead letter: no status change, no attempts.
		expect(S.entries[0].status).toBe('pending');
		expect(S.entries[0].attempts).toBe(0);
	});

	test('encoding-variant plant is caught via the fully-decoded spelling', async () => {
		// Ledger stores the %2F-spelled form; the surviving reference is
		// the canonical decoded form (and vice versa — both spellings
		// are compared by construction of the params).
		S.entries = [entry({ file_url: '/api/files/r2%2Fresumes%2F1720000000000-abc123-victim-cv.pdf' })];
		S.referencedForms = new Set([B_URL]);
		const res = await erasureService.deleteErasedStorageFiles(7);
		expect(deleteFile).not.toHaveBeenCalled();
		expect(res.ownershipSkips).toBe(1);
		expect(S.entries[0].status).toBe('pending');
	});

	test('reference lookup failure fails closed: skip + ownershipLookupFailed, never delete', async () => {
		S.entries = [entry()];
		S.ownershipError = true;
		const res = await erasureService.deleteErasedStorageFiles(7);
		expect(deleteFile).not.toHaveBeenCalled();
		expect(res.deleted).toBe(0);
		expect(res.ownershipSkips).toBe(0);
		expect(res.ownershipLookupFailed).toBe(1);
		expect(S.entries[0].status).toBe('pending');
		expect(S.entries[0].attempts).toBe(0);
	});

	test('catalogue families are exempt by source (frame / observer_audio / livekit_recording)', async () => {
		S.entries = [
			entry({ id: 1, source_family: 'observer_audio', file_url: '/api/files/r2%2Fobserver-audio%2Fchunk.bin' }),
			entry({ id: 2, source_family: 'frame', file_url: '/api/files/r2%2Fframes%2Fvideo-frame-abc.bin' }),
		];
		S.referencedForms = new Set(['/api/files/r2/observer-audio/chunk.bin', '/api/files/r2/frames/video-frame-abc.bin']);
		const res = await erasureService.deleteErasedStorageFiles(7);
		expect(res.deleted).toBe(2);
		expect(res.ownershipSkips).toBe(0);
	});

	test('legal hold still precedes ownership: held entries count as heldSkips only', async () => {
		S.entries = [entry({ file_url: B_URL })];
		S.referencedForms = new Set([B_URL]);
		S.held = true;
		const res = await erasureService.deleteErasedStorageFiles(7);
		expect(deleteFile).not.toHaveBeenCalled();
		expect(res.heldSkips).toBe(1);
		expect(res.ownershipSkips).toBe(0);
	});

	test('empty drain return carries the ownership counters', async () => {
		const res = await erasureService.deleteErasedStorageFiles(7);
		expect(res).toEqual({
			deleted: 0,
			failed: 0,
			failures: [],
			heldSkips: 0,
			ownershipSkips: 0,
			ownershipLookupFailed: 0,
			ownershipSkipsByFamily: {},
		});
	});
});

describe('#1137 storageOwnership normalisation', () => {
	test('standard URL: raw + canonical spellings and both key forms', () => {
		const forms = storageOwnership.storageUrlForms(B_URL);
		expect(forms.raw).toBe(B_URL);
		expect(forms.canonicalUrl).toBe(B_URL);
		expect(forms.decodedKey).toBe('r2/resumes/1720000000000-abc123-victim-cv.pdf');
		expect(forms.bareObjectKey).toBe('resumes/1720000000000-abc123-victim-cv.pdf');
	});

	test('%2F-spelled URL normalises to the same canonical form', () => {
		const forms = storageOwnership.storageUrlForms(
			'/api/files/r2%2Fresumes%2F1720000000000-abc123-victim-cv.pdf',
		);
		expect(forms.canonicalUrl).toBe(B_URL);
		expect(forms.decodedKey).toBe('r2/resumes/1720000000000-abc123-victim-cv.pdf');
	});

	test('non-/api/files/ and malformed URLs yield null (not ledger-addressable here)', () => {
		expect(storageOwnership.storageUrlForms('https://example.com/x.pdf')).toBeNull();
		expect(storageOwnership.storageUrlForms('/api/files/%E0%A4%A')).toBeNull();
		expect(storageOwnership.storageUrlForms(null)).toBeNull();
	});
});
