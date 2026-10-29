/**
 * #1973 — sweepPanelSkeletonEvents unit contract (mocked pool).
 * The real-DB Quinn E2E lives in
 * erasure-skeleton-sweep-1973.integration.test.js; this file pins
 * the caller contract that needs no database:
 *  - a bare {query}-only queryable is REFUSED with a typed error
 *    before any data is touched (purge-pool precedent, #1395);
 *  - an empty candidate set returns the B-4 count shape, labelled
 *    "skeleton-class" (C-5), with zero deletions.
 */
const { sweepPanelSkeletonEvents } = require('../../../lib/erasureService');

describe('#1973 sweepPanelSkeletonEvents caller contract', () => {
	test('refuses a queryable without connect() (typed, before touching data)', async () => {
		const queryable = { query: jest.fn() };
		await expect(sweepPanelSkeletonEvents({ queryable })).rejects.toMatchObject({
			name: 'ErasureSkeletonSweepPoolRequiredError',
			code: 'ERASURE_SKELETON_SWEEP_POOL_REQUIRED',
		});
		expect(queryable.query).not.toHaveBeenCalled();
	});

	test('empty run: skeleton-class label + zeroed B-4 counts', async () => {
		const pool = {
			connect: jest.fn(),
			query: jest.fn(async () => ({ rows: [] })),
		};
		const res = await sweepPanelSkeletonEvents({ queryable: pool });
		expect(res).toEqual({
			label: 'skeleton-class',
			scanned: 0,
			deleted: 0,
			heldSkipped: 0,
			lookupFailedSkipped: 0,
			skipped: 0,
			// #1977: keyset-paged enumeration reports whether the
			// per-run page cap cut the enumeration short.
			enumerationTruncated: false,
		});
		expect(pool.connect).not.toHaveBeenCalled();
	});
});
