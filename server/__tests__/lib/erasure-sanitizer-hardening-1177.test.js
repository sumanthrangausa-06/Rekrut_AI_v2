/**
 * #1177 sanitiser future-shape hardening (follow-up of #1128 security
 * review O-3). STOP 1 Lead, 2026-10-19 (issue comment 6281478088).
 *
 * Pins, for lib/erasureResultSanitizer.js:
 *  1. Canonicalised key matching (lowercase, strip _ - .):
 *     storagekeys / nonpatternstorageurls = LIST carriers;
 *     fileurl / objectkey = SINGLE carriers — any casing/separator.
 *  2. List carriers are type-agnostic (array|string|object|scalar|null).
 *  3. Single carriers dropped at any type/depth, contents never walked.
 *  4. Substring drop: canonical key containing storagekey/storageurl,
 *     not an exact list carrier and not a count-output name, is dropped.
 *     A spoofed sibling count loses to a present carrier in any key
 *     order; with no carrier present the count field is left as-is.
 *  5. Bounded value sweep: anchored storage patterns only.
 *  6. Carriers nested inside arrays are sanitised.
 *  7. Fail-closed copy: BigInt / circular input returns {}.
 *  8. Invariants: counts only (never hashes), input never mutated,
 *     null/non-object passthrough, today's shapes unchanged.
 */
const { sanitizeErasureResult } = require('../../../lib/erasureResultSanitizer');

const KEY = 'cv/secret.pdf';

describe('#1177 canonicalised list carriers', () => {
	test.each([
		'storageKeys',
		'StorageKeys',
		'storage_keys',
		'storage-keys',
		'STORAGEKEYS',
		'storage.keys',
		'Storage_Keys',
	])('%s (array) -> storageKeysCount, original key gone', (name) => {
		const out = sanitizeErasureResult({ [name]: [KEY, KEY], keep: 1 });
		expect(out.storageKeysCount).toBe(2);
		expect(out[name]).toBeUndefined();
		expect(Object.keys(out).sort()).toEqual(['keep', 'storageKeysCount']);
		expect(out.keep).toBe(1);
	});

	test.each([
		'nonPatternStorageUrls',
		'NonPatternStorageUrls',
		'non_pattern_storage_urls',
		'non-pattern-storage-urls',
		'NONPATTERNSTORAGEURLS',
	])('%s (array) -> nonPatternStorageUrlCount', (name) => {
		const out = sanitizeErasureResult({ gap: { [name]: [KEY] } });
		expect(out.gap.nonPatternStorageUrlCount).toBe(1);
		expect(out.gap[name]).toBeUndefined();
	});
});

describe('#1177 list carriers are type-agnostic', () => {
	test('StorageKeys as string -> 1', () => {
		const out = sanitizeErasureResult({ StorageKeys: KEY });
		expect(out.storageKeysCount).toBe(1);
		expect(out.StorageKeys).toBeUndefined();
	});

	test('storage-keys as plain object -> own enumerable key count', () => {
		const out = sanitizeErasureResult({ 'storage-keys': { a: KEY, b: KEY, c: KEY } });
		expect(out.storageKeysCount).toBe(3);
	});

	test('storageKeys as number -> 1', () => {
		expect(sanitizeErasureResult({ storageKeys: 7 }).storageKeysCount).toBe(1);
	});

	test('storageKeys as boolean -> 1', () => {
		expect(sanitizeErasureResult({ storageKeys: true }).storageKeysCount).toBe(1);
	});

	test('storageKeys as null -> 0, count still emitted', () => {
		const out = sanitizeErasureResult({ storageKeys: null });
		expect(out.storageKeysCount).toBe(0);
		expect('storageKeys' in out).toBe(false);
	});

	test('storageKeys as undefined -> 0, count still emitted', () => {
		const out = sanitizeErasureResult({ storageKeys: undefined });
		expect(out.storageKeysCount).toBe(0);
		expect('storageKeys' in out).toBe(false);
	});

	test('nonPatternStorageUrls as string -> 1; as object -> key count; as null -> 0', () => {
		expect(sanitizeErasureResult({ nonPatternStorageUrls: KEY }).nonPatternStorageUrlCount).toBe(1);
		expect(
			sanitizeErasureResult({ nonPatternStorageUrls: { a: 1, b: 2 } }).nonPatternStorageUrlCount,
		).toBe(2);
		expect(sanitizeErasureResult({ nonPatternStorageUrls: null }).nonPatternStorageUrlCount).toBe(0);
	});
});

describe('#1177 single carriers dropped at any type/depth, never walked', () => {
	test.each(['File_Url', 'FILE_URL', 'file-url', 'fileUrl', 'file_url'])(
		'%s (string) dropped',
		(name) => {
			const out = sanitizeErasureResult({ nested: { [name]: KEY, keep: 2 } });
			expect(out.nested[name]).toBeUndefined();
			expect(out.nested.keep).toBe(2);
			expect(JSON.stringify(out)).not.toContain(KEY);
		},
	);

	test.each(['ObjectKey', 'object_key', 'object-key', 'OBJECTKEY'])('%s dropped', (name) => {
		const out = sanitizeErasureResult({ deep: { deeper: { [name]: KEY, keep: 3 } } });
		expect(JSON.stringify(out)).not.toContain(KEY);
		expect(out.deep.deeper.keep).toBe(3);
	});

	test('single carrier with object value: contents never walked (no count leaks out)', () => {
		const out = sanitizeErasureResult({ fileUrl: { storageKeys: [KEY, KEY] } });
		expect(out).toEqual({});
	});

	test('single carrier with array value dropped whole', () => {
		const out = sanitizeErasureResult({ objectKey: [KEY], keep: 1 });
		expect(out).toEqual({ keep: 1 });
	});
});

describe('#1177 substring drop rule', () => {
	test.each(['storageKey', 'presignedStorageUrl', 'storageUrl', 'storageUrls', 'myStorageKeyField'])(
		'%s dropped outright, never counted',
		(name) => {
			const out = sanitizeErasureResult({ [name]: KEY, keep: 1 });
			expect(out[name]).toBeUndefined();
			expect(out.storageKeysCount).toBeUndefined();
			expect(out.keep).toBe(1);
			expect(JSON.stringify(out)).not.toContain(KEY);
		},
	);

	test('exact list carrier takes precedence over substring rule', () => {
		const out = sanitizeErasureResult({ storageKeys: [KEY] });
		expect(out.storageKeysCount).toBe(1);
	});
});

describe('#1177 count integrity', () => {
	test('spoofed count BEFORE carrier: real count wins', () => {
		const out = sanitizeErasureResult({ storageKeysCount: 9999, storageKeys: [KEY, KEY] });
		expect(out.storageKeysCount).toBe(2);
	});

	test('spoofed count AFTER carrier: real count wins', () => {
		const out = sanitizeErasureResult({ storageKeys: [KEY, KEY], storageKeysCount: 9999 });
		expect(out.storageKeysCount).toBe(2);
	});

	test('spoofed variant-cased count with carrier: canonical real count wins, variant gone', () => {
		const out = sanitizeErasureResult({ Storage_Keys_Count: 9999, storageKeys: [KEY] });
		expect(out.storageKeysCount).toBe(1);
		expect(out.Storage_Keys_Count).toBeUndefined();
	});

	test('spoofed nonPattern count, both orders: real count wins', () => {
		expect(
			sanitizeErasureResult({ nonPatternStorageUrlCount: 9999, nonPatternStorageUrls: [KEY] })
				.nonPatternStorageUrlCount,
		).toBe(1);
		expect(
			sanitizeErasureResult({ nonPatternStorageUrls: [KEY], nonPatternStorageUrlCount: 9999 })
				.nonPatternStorageUrlCount,
		).toBe(1);
	});

	test('count field with NO carrier present is left as-is (Lead-ruled residual)', () => {
		expect(sanitizeErasureResult({ storageKeysCount: 42 })).toEqual({ storageKeysCount: 42 });
		expect(sanitizeErasureResult({ nonPatternStorageUrlCount: 5 })).toEqual({
			nonPatternStorageUrlCount: 5,
		});
		expect(sanitizeErasureResult({ StorageKeysCount: 42 })).toEqual({ StorageKeysCount: 42 });
	});
});

describe('#1177 bounded value sweep — positives', () => {
	test.each([
		's3://bucket/cv/secret.pdf',
		'gs://bucket/cv/secret.pdf',
		'https://bucket.s3.amazonaws.com/cv/secret.pdf',
		'http://bucket.s3.eu-west-1.amazonaws.com/cv/secret.pdf',
		'https://acct.r2.cloudflarestorage.com/cv/secret.pdf',
		'https://storage.googleapis.com/bucket/cv/secret.pdf',
		'https://acct.blob.core.windows.net/container/secret.pdf',
		'/api/files/r2/cv/secret.pdf',
		'/uploads/secret.pdf',
	])('scalar field with value %s is deleted', (value) => {
		const out = sanitizeErasureResult({ note: value, keep: 1 });
		expect(out.note).toBeUndefined();
		expect(out.keep).toBe(1);
	});

	test('matching elements inside a non-carrier array are removed, others kept', () => {
		const out = sanitizeErasureResult({
			files: ['s3://bucket/a.pdf', 'plain-name', 'https://storage.googleapis.com/b/c.pdf'],
		});
		expect(out.files).toEqual(['plain-name']);
	});

	test('sweep reaches string fields of objects nested inside arrays', () => {
		const out = sanitizeErasureResult({ items: [{ ref: '/uploads/x.pdf', id: 9 }] });
		expect(out.items).toEqual([{ id: 9 }]);
	});
});

describe('#1177 bounded value sweep — must-survive negatives', () => {
	test('held-detail records survive untouched', () => {
		const held = [{ table: 'ai_screenings', id: 5, reason: 'held_company' }];
		expect(sanitizeErasureResult({ applicationKeyedHeldDetails: held })).toEqual({
			applicationKeyedHeldDetails: held,
		});
	});

	test('ISO dates, tombstone values and deleted-account emails survive', () => {
		const input = {
			consentDate: '2026-10-19T12:34:56.000Z',
			tombstone: { profileExisted: true, gdprConsent: false, consentDate: '2026-01-01' },
			email: 'deleted_7_abc@deleted.local',
		};
		expect(sanitizeErasureResult(input)).toEqual(input);
	});

	test('plain counts, booleans, strings and non-storage URLs survive', () => {
		const input = {
			count: 3,
			ok: true,
			name: 'candidate',
			site: 'https://example.com/file.pdf',
			profile: 'https://linkedin.com/in/someone',
			relative: 'cv/x.pdf',
			lookalike: 'https://amazonaws.com.evil.example/file.pdf',
			mentions: 'see s3://bucket later',
		};
		expect(sanitizeErasureResult(input)).toEqual(input);
	});
});

describe('#1177 carriers nested inside arrays', () => {
	test('list + single carriers inside array elements are sanitised', () => {
		const out = sanitizeErasureResult({
			items: [
				{ storageKeys: [KEY, KEY] },
				{ nested: { nonPatternStorageUrls: KEY } },
				{ File_Url: KEY, keep: 1 },
			],
		});
		expect(out.items[0]).toEqual({ storageKeysCount: 2 });
		expect(out.items[1]).toEqual({ nested: { nonPatternStorageUrlCount: 1 } });
		expect(out.items[2]).toEqual({ keep: 1 });
		expect(JSON.stringify(out)).not.toContain(KEY);
	});
});

describe('#1177 fail-closed copy', () => {
	test('BigInt value: returns {} and never throws', () => {
		let out;
		expect(() => {
			out = sanitizeErasureResult({ n: 10n, storageKeys: [KEY] });
		}).not.toThrow();
		expect(out).toEqual({});
	});

	test('circular structure: returns {} and never throws, never returns raw input', () => {
		const input = { a: 1 };
		input.self = input;
		let out;
		expect(() => {
			out = sanitizeErasureResult(input);
		}).not.toThrow();
		expect(out).toEqual({});
		expect(out).not.toBe(input);
	});
});

describe('#1177 invariants', () => {
	test('input is never mutated', () => {
		const input = {
			storageKeysCount: 9999,
			storageKeys: [KEY],
			note: 's3://bucket/x.pdf',
			files: ['s3://bucket/y.pdf', 'keep-me'],
			nested: { File_Url: KEY },
		};
		const snapshot = JSON.parse(JSON.stringify(input));
		sanitizeErasureResult(input);
		expect(input).toEqual(snapshot);
	});

	test('null / non-object passthrough unchanged', () => {
		expect(sanitizeErasureResult(null)).toBeNull();
		expect(sanitizeErasureResult(undefined)).toBeUndefined();
		expect(sanitizeErasureResult(42)).toBe(42);
		expect(sanitizeErasureResult('hello')).toBe('hello');
		expect(sanitizeErasureResult(true)).toBe(true);
	});

	test("today's shape is byte-identical in substance to the pre-#1177 behaviour", () => {
		const KEY1 = '/api/files/r2/cv/secret-1.pdf';
		const KEY2 = 'https://storage.example.com/bucket/secret-2.pdf';
		const out = sanitizeErasureResult({
			shredded: true,
			storageKeys: [KEY1, KEY2],
			storageFilesDeleted: 4,
			gapC: { scheduledInterviews: 2, nonPatternStorageUrls: [KEY2], storageLedgered: 1 },
			gapD: { offersRedacted: 1, nonPatternStorageUrls: [KEY1, KEY2] },
			gapB: { scoreSnapshots: 3 },
			applicationKeyedHeldDetails: [{ table: 'ai_screenings', id: 5, reason: 'held_company' }],
		});
		expect(out).toEqual({
			shredded: true,
			storageKeysCount: 2,
			storageFilesDeleted: 4,
			gapC: { scheduledInterviews: 2, nonPatternStorageUrlCount: 1, storageLedgered: 1 },
			gapD: { offersRedacted: 1, nonPatternStorageUrlCount: 2 },
			gapB: { scoreSnapshots: 3 },
			applicationKeyedHeldDetails: [{ table: 'ai_screenings', id: 5, reason: 'held_company' }],
		});
	});

	test('counts only — no hash/digest is ever substituted', () => {
		const out = sanitizeErasureResult({ storageKeys: [KEY], fileUrl: KEY });
		expect(JSON.stringify(out)).not.toMatch(/sha256|digest|hash/i);
	});
});
