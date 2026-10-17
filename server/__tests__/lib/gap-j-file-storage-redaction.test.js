/**
 * #1129 GAP-J: bounded log-redaction fix in lib/file-storage.js.
 *
 * The deleteFile / deleteStorageObject skip-path warnings used to
 * interpolate the full unrouted fileUrl / objectKey. Those values can be
 * a signed/external URL (signature query string included), a
 * CV-filename-bearing /api/files/... URL, or a raw storage key embedding
 * an original filename — i.e. candidate data written to stdout → platform
 * logs at the moment of erasure.
 *
 * Fix contract (STOP 1, #1129): each of the 4 verified sites logs a
 * reason code + provider name only — reason only where no provider was
 * parsed (unrecognized / malformed / no-prefix sites) — with NO portion
 * of the URL/key, no truncation, prefix, or hash of it. No return-value,
 * routing, or idempotency change.
 *
 * Sites covered: deleteFile warns at the unrecognized-format,
 * malformed-encoding, and no-provider-prefix branches, and the
 * deleteStorageObject warn at its unrecognized-key-format branch.
 */

// The real module only needs the S3 client constructor at require time;
// these branches never reach an S3 call, so a bare mock is enough.
jest.mock('@aws-sdk/client-s3', () => ({
	S3Client: jest.fn(() => ({ send: jest.fn() })),
	PutObjectCommand: jest.fn(),
	GetObjectCommand: jest.fn(),
	DeleteObjectCommand: jest.fn(),
}));

const fileStorage = require('../../../lib/file-storage');

describe('#1129 GAP-J — file-storage skip-path log redaction', () => {
	let warnSpy;

	beforeEach(() => {
		warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
	});

	const warnOutput = () =>
		warnSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');

	test('(a) signed-URL fixture: no URL, signature, filename, or query fragment is logged', async () => {
		const signedUrl =
			'https://storage.example.test/cv/Jane-Doe-CV.pdf' +
			'?X-Amz-Signature=deadbeefsignature123&X-Amz-Expires=3600';

		const result = await fileStorage.deleteFile(signedUrl);

		expect(result).toEqual({ deleted: false, reason: 'unrecognized_format' });
		expect(warnSpy).toHaveBeenCalled();
		const out = warnOutput();
		expect(out).toContain('[file-storage]');
		expect(out).not.toContain(signedUrl);
		expect(out).not.toContain('Jane-Doe-CV');
		expect(out).not.toContain('Jane-Doe');
		expect(out).not.toContain('deadbeefsignature123');
		expect(out).not.toContain('X-Amz-Signature');
		expect(out).not.toContain('X-Amz-Expires');
		expect(out).not.toContain('storage.example.test');
		expect(out).not.toContain('.pdf');
	});

	test('(b) CV-filename-bearing /api/files/... URL with no provider prefix: filename is not logged', async () => {
		const url = '/api/files/Jane-Doe-CV.pdf';

		const result = await fileStorage.deleteFile(url);

		expect(result).toEqual({ deleted: false, reason: 'unrecognized_format' });
		expect(warnSpy).toHaveBeenCalled();
		const out = warnOutput();
		expect(out).not.toContain(url);
		expect(out).not.toContain('Jane-Doe-CV');
		expect(out).not.toContain('Jane-Doe');
		expect(out).not.toContain('.pdf');
	});

	test('(c) malformed-encoding URL: no URL or encoding fragment is logged', async () => {
		const url = '/api/files/r2/cv/%E0%A4%A-Jane-Doe.pdf';

		const result = await fileStorage.deleteFile(url);

		expect(result).toEqual({ deleted: false, reason: 'unrecognized_format' });
		expect(warnSpy).toHaveBeenCalled();
		const out = warnOutput();
		expect(out).not.toContain(url);
		expect(out).not.toContain('%E0%A4%A');
		expect(out).not.toContain('Jane-Doe');
		expect(out).not.toContain('.pdf');
	});

	test('(d) deleteStorageObject with a frame key: no key or filename is logged', async () => {
		const frameKey = 'frame-Jane-Doe-interview-42.bin';

		const result = await fileStorage.deleteStorageObject(frameKey);

		expect(result).toEqual({ deleted: false, reason: 'unrecognized_format' });
		expect(warnSpy).toHaveBeenCalled();
		const out = warnOutput();
		expect(out).toContain('[file-storage]');
		expect(out).not.toContain(frameKey);
		expect(out).not.toContain('Jane-Doe');
		expect(out).not.toContain('interview-42');
		expect(out).not.toContain('.bin');
	});
});
