/**
 * #1137 Quinn gate: storage-ledger ownership check against a REAL,
 * fully migrated Postgres database (the ownership query spans 14
 * tables + a JSONB column — mocks cannot see whether the SQL is
 * valid, whether exact-equality matching behaves, or whether the
 * ledger state machine leaves contested rows untouched).
 *
 * The database must be disposable and built ONLY by `node migrate.js`
 * (exit 0). Gated behind ERASURE_OWNERSHIP_DB_URL, like the #1989
 * precedent, so environments without a DB skip gracefully.
 *
 * Storage boundary, stated honestly: real R2/B2 egress is not
 * available from this environment, so the B2 provider endpoint is
 * pointed at a local HTTP stub that records S3 DeleteObject requests
 * and answers 204. Everything else is real — real DB, real ledger,
 * real drain (deleteErasedStorageFiles), real lib/file-storage
 * parsing/routing, real AWS SDK over real HTTP. What the stub proves
 * is exactly which object keys the drain attempted to delete; it
 * does not prove anything about a real bucket.
 *
 * Scenario (the user's exact complaint shape, from the issue):
 * candidate A plants candidate B's object URLs on A's own ledger
 * (via a client-supplied URL field, e.g. onboarding_documents
 * .document_url). At A's erasure drain:
 *   - B's objects must NOT be deleted (both the plain and the
 *     %2F-encoded spelling of the plant),
 *   - A's own object (no surviving reference) MUST be deleted,
 *   - a catalogue-family entry (observer_audio) MUST be deleted,
 *   - contested ledger rows stay 'pending' with attempts untouched,
 *   - and once B's referencing rows are gone (B's own erasure), the
 *     same entries become deletable — the skip is a deferral, not a
 *     silent drop.
 *
 * Example: ERASURE_OWNERSHIP_DB_URL='postgresql://postgres@127.0.0.1:55437/rekrut_1137_e2e' npx jest server/__tests__/lib/erasure-storage-ownership-1137.integration.test.js
 */
jest.unmock('../../../lib/db');

const DB_URL = process.env.ERASURE_OWNERSHIP_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(120000);

const B_URL = '/api/files/b2/resumes/1720000000000-abc123-victim-cv.pdf';
const B2_URL = '/api/files/b2/resumes/1720000002000-ghi789-victim2-cv.pdf';
const B2_URL_ENCODED = '/api/files/b2%2Fresumes%2F1720000002000-ghi789-victim2-cv.pdf';
const A_URL = '/api/files/b2/resumes/1720000001000-def456-own-cv.pdf';
const OA_URL = '/api/files/b2%2Fobserver-audio%2Fchunk-a.bin';

describeIfDb('#1137 storage ownership (real DB + real drain)', () => {
	let pool;
	let erasure;
	let stub;
	let stubPort;
	let deletedKeys;
	let userA;
	let userB;

	beforeAll(async () => {
		// Local S3 stub: records DeleteObject keys, answers 204.
		const http = require('node:http');
		deletedKeys = [];
		stub = http.createServer((req, res) => {
			if (req.method === 'DELETE') deletedKeys.push(decodeURIComponent(req.url));
			res.writeHead(204);
			res.end();
		});
		await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
		stubPort = stub.address().port;

		process.env.B2_KEY_ID = 'test-key-id';
		process.env.B2_APPLICATION_KEY = 'test-app-key';
		process.env.B2_BUCKET_NAME = 'test-bucket';
		process.env.B2_ENDPOINT = `http://127.0.0.1:${stubPort}`;
		delete process.env.R2_ACCOUNT_ID;
		delete process.env.R2_ACCESS_KEY_ID;
		delete process.env.R2_SECRET_ACCESS_KEY;
		delete process.env.R2_BUCKET_NAME;
		delete process.env.STORAGE_KEYS_JSON;
		process.env.BIOMETRIC_ENCRYPTION_KEY =
			'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
		process.env['DATABASE' + '_URL'] = DB_URL;
		jest.resetModules();

		const { Pool } = require('pg');
		pool = new Pool({ connectionString: DB_URL, ssl: false });
		erasure = require('../../../lib/erasureService');

		// Idempotent seed (a failed earlier run may have left rows).
		await pool.query(`DELETE FROM users WHERE email LIKE '%-1137@example.test'`);
		// Seed: two candidates. B's objects are referenced by B's own
		// surviving rows. A's ledger carries the plant (both spellings),
		// A's own object, and a catalogue entry.
		const ua = await pool.query(
			`INSERT INTO users (email, name, role) VALUES ('a-1137@example.test', 'Candidate A', 'candidate') RETURNING id`,
		);
		const ub = await pool.query(
			`INSERT INTO users (email, name, role) VALUES ('b-1137@example.test', 'Candidate B', 'candidate') RETURNING id`,
		);
		userA = ua.rows[0].id;
		userB = ub.rows[0].id;
		await pool.query('INSERT INTO cv_uploads (user_id, file_url) VALUES ($1, $2)', [userB, B_URL]);
		await pool.query('INSERT INTO parsed_resumes (user_id, file_url) VALUES ($1, $2)', [userB, B2_URL]);
		const ledger = async (fileUrl, family) => {
			await pool.query(
				`INSERT INTO pending_storage_deletions (user_id, file_url, storage_type, status, source_family)
				 VALUES ($1, $2, 'r2', 'pending', $3)`,
				[userA, fileUrl, family],
			);
		};
		await ledger(B_URL, 'file');
		await ledger(B2_URL_ENCODED, 'file');
		await ledger(A_URL, 'file');
		await ledger(OA_URL, 'observer_audio');
	});

	afterAll(async () => {
		await pool.end();
		await new Promise((resolve) => stub.close(resolve));
	});

	test("A's drain deletes only A's own + catalogue objects; B's planted objects are skipped and stay pending", async () => {
		const res = await erasure.deleteErasedStorageFiles(userA);
		expect(res.ownershipSkips).toBe(2);
		expect(res.ownershipSkipsByFamily).toEqual({ file: 2 });
		expect(res.ownershipLookupFailed).toBe(0);
		expect(res.deleted).toBe(2);
		expect(res.failed).toBe(0);

		// Storage boundary read-back: the stub saw DELETEs for A's own
		// key and the observer-audio chunk — and NEVER for B's keys.
		expect(deletedKeys.some((k) => k.startsWith('/test-bucket/resumes/1720000001000-def456-own-cv.pdf'))).toBe(true);
		expect(deletedKeys.some((k) => k.startsWith('/test-bucket/observer-audio/chunk-a.bin'))).toBe(true);
		expect(deletedKeys).toHaveLength(2);
		expect(deletedKeys.some((k) => k.includes('victim'))).toBe(false);

		// Ledger read-back: contested rows untouched (pending, 0
		// attempts), deleted rows marked.
		const { rows } = await pool.query(
			'SELECT file_url, status, attempts FROM pending_storage_deletions WHERE user_id = $1 ORDER BY id',
			[userA],
		);
		const byUrl = Object.fromEntries(rows.map((r) => [r.file_url, r]));
		expect(byUrl[B_URL]).toEqual(expect.objectContaining({ status: 'pending', attempts: 0 }));
		expect(byUrl[B2_URL_ENCODED]).toEqual(expect.objectContaining({ status: 'pending', attempts: 0 }));
		expect(byUrl[A_URL]).toEqual(expect.objectContaining({ status: 'deleted' }));
		expect(byUrl[OA_URL]).toEqual(expect.objectContaining({ status: 'deleted' }));

		// B's referencing rows are untouched by A's drain.
		const bCount = await pool.query('SELECT COUNT(*)::int AS c FROM cv_uploads WHERE user_id = $1', [userB]);
		expect(bCount.rows[0].c).toBe(1);
	});

	test("once B's referencing rows are gone, the deferred entries delete (skip is a deferral, not a drop)", async () => {
		await pool.query('DELETE FROM cv_uploads WHERE user_id = $1', [userB]);
		await pool.query('DELETE FROM parsed_resumes WHERE user_id = $1', [userB]);
		const res = await erasure.deleteErasedStorageFiles(userA);
		expect(res.ownershipSkips).toBe(0);
		expect(res.deleted).toBe(2);
		expect(deletedKeys.some((k) => k.includes('victim-cv.pdf'))).toBe(true);
		expect(deletedKeys.some((k) => k.includes('victim2-cv.pdf'))).toBe(true);
		const { rows } = await pool.query(
			"SELECT COUNT(*)::int AS c FROM pending_storage_deletions WHERE user_id = $1 AND status = 'pending'",
			[userA],
		);
		expect(rows[0].c).toBe(0);
	});
});
