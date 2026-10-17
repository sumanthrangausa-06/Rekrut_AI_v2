/**
 * S-068 (#721): Tests for the R2 plaintext frame cleanup script.
 *
 * The script identifies legacy (pre-S-059) plaintext JPEG face frames in the
 * R2/B2 `frames/` prefix and deletes them. S-059 encrypted frames use a
 * versioned envelope (0x01‖iv‖tag‖ct) stored as .bin / application/octet-stream.
 *
 * Discriminators (defense in depth):
 *  1. Key regex: legacy keys end in .jpg/.jpeg; S-059 keys end in .bin
 *  2. Content-Type: legacy is image/jpeg; S-059 is application/octet-stream
 *  3. Magic bytes: JPEG starts FF D8; S-059 envelope starts 0x01
 */

const {
	isPlaintextFrame,
	isEncryptedEnvelope,
	isJpegMagic,
	classifyFrame,
	PLAINTEXT_KEY_RE,
} = require('../../../scripts/r2-plaintext-cleanup');

describe('S-068 plaintext frame discriminators', () => {
	describe('PLAINTEXT_KEY_RE', () => {
		test('matches legacy .jpg keys', () => {
			expect(PLAINTEXT_KEY_RE.test('r2/frames/1728000000000-abc123-video-frame-1728000000000-0.jpg')).toBe(true);
		});

		test('matches legacy .jpeg keys (case-insensitive)', () => {
			expect(PLAINTEXT_KEY_RE.test('b2/frames/VIDEO-FRAME-123.JPEG')).toBe(true);
		});

		test('does NOT match S-059 .bin keys', () => {
			expect(PLAINTEXT_KEY_RE.test('r2/frames/video-frame-a1b2c3d4e5f60718.bin')).toBe(false);
		});

		test('does NOT match non-frame keys', () => {
			expect(PLAINTEXT_KEY_RE.test('r2/resumes/candidate-123.pdf')).toBe(false);
			expect(PLAINTEXT_KEY_RE.test('r2/frames/notes.txt')).toBe(false);
		});
	});

	describe('isEncryptedEnvelope', () => {
		test('returns true for S-059 envelope magic (0x01)', () => {
			const buf = Buffer.concat([Buffer.from([0x01]), Buffer.alloc(50)]);
			expect(isEncryptedEnvelope(buf)).toBe(true);
		});

		test('returns false for JPEG magic (FF D8)', () => {
			const buf = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50)]);
			expect(isEncryptedEnvelope(buf)).toBe(false);
		});

		test('returns false for empty/short buffers', () => {
			expect(isEncryptedEnvelope(Buffer.alloc(0))).toBe(false);
			expect(isEncryptedEnvelope(null)).toBe(false);
		});
	});

	describe('isJpegMagic', () => {
		test('returns true for JPEG SOI marker (FF D8)', () => {
			expect(isJpegMagic(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
		});

		test('returns false for S-059 envelope (0x01)', () => {
			expect(isJpegMagic(Buffer.from([0x01, 0x02, 0x03, 0x04]))).toBe(false);
		});

		test('returns false for empty/null/short buffers', () => {
			expect(isJpegMagic(Buffer.alloc(0))).toBe(false);
			expect(isJpegMagic(null)).toBe(false);
			expect(isJpegMagic(Buffer.from([0xff]))).toBe(false);
		});
	});

	describe('isPlaintextFrame', () => {
		test('legacy .jpg + image/jpeg → plaintext', () => {
			expect(isPlaintextFrame('r2/frames/video-frame-123-0.jpg', 'image/jpeg')).toBe(true);
		});

		test('S-059 .bin + octet-stream → NOT plaintext', () => {
			expect(
				isPlaintextFrame('r2/frames/video-frame-a1b2c3d4e5f60718.bin', 'application/octet-stream'),
			).toBe(false);
		});

		test('.jpg key but octet-stream content-type → NOT plaintext (content-type wins)', () => {
			// Defense in depth: both signals must agree for deletion.
			// A .jpg key with ciphertext content-type is suspicious but NOT
			// auto-deleted — flagged for manual review instead.
			expect(isPlaintextFrame('r2/frames/video-frame-123-0.jpg', 'application/octet-stream')).toBe(false);
		});

		test('.bin key but image/jpeg content-type → NOT plaintext (content-type wins)', () => {
			expect(
				isPlaintextFrame('r2/frames/video-frame-a1b2c3d4e5f60718.bin', 'image/jpeg'),
			).toBe(false);
		});

		test('missing content-type → NOT plaintext (fail-closed)', () => {
			expect(isPlaintextFrame('r2/frames/video-frame-123-0.jpg', null)).toBe(false);
			expect(isPlaintextFrame('r2/frames/video-frame-123-0.jpg', undefined)).toBe(false);
		});

		test('non-frame prefix → NOT plaintext', () => {
			expect(isPlaintextFrame('r2/resumes/photo.jpg', 'image/jpeg')).toBe(false);
		});
	});

	describe('classifyFrame', () => {
		test('legacy frame → { action: "delete", reason: "plaintext" }', () => {
			const jpegMagic = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
			const result = classifyFrame({
				key: 'r2/frames/video-frame-1728000000000-0.jpg',
				contentType: 'image/jpeg',
				firstBytes: jpegMagic,
			});
			expect(result.action).toBe('delete');
			expect(result.reason).toBe('plaintext');
		});

		test('S-059 encrypted frame → { action: "keep" }', () => {
			const envelopeMagic = Buffer.concat([Buffer.from([0x01]), Buffer.alloc(100)]);
			const result = classifyFrame({
				key: 'r2/frames/video-frame-a1b2c3d4e5f60718.bin',
				contentType: 'application/octet-stream',
				firstBytes: envelopeMagic,
			});
			expect(result.action).toBe('keep');
		});

		test('ambiguous (.jpg key, octet-stream type) → { action: "review" }', () => {
			const result = classifyFrame({
				key: 'r2/frames/video-frame-123-0.jpg',
				contentType: 'application/octet-stream',
				firstBytes: Buffer.concat([Buffer.from([0x01]), Buffer.alloc(100)]),
			});
			expect(result.action).toBe('review');
		});

		test('magic bytes contradict (claims jpeg but envelope magic) → { action: "review" }', () => {
			const result = classifyFrame({
				key: 'r2/frames/video-frame-123-0.jpg',
				contentType: 'image/jpeg',
				firstBytes: Buffer.concat([Buffer.from([0x01]), Buffer.alloc(100)]),
			});
			expect(result.action).toBe('review');
		});
	});
});
