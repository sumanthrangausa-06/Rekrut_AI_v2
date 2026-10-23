/**
 * #1626 — services/memory-service.js stamped a fabricated confidence 0.8
 * whenever a caller recorded none (`confidence || 0.8`, both insert
 * paths), and destroyed a measured 0 the same way.
 *
 * Fix (pattern from #1619): only a finite measured number in [0, 1] is
 * recorded, verbatim (0 included); anything else is stored as NULL —
 * the honest "not recorded" state. getMemories also orders
 * `confidence DESC NULLS LAST` so unmeasured rows no longer sort ahead
 * of measured ones (Postgres DESC defaults to NULLS FIRST).
 *
 * Mock note: lib/db is the module boundary; the fake pool captures the
 * exact params the service sends and echoes the confidence param back
 * as the stored row, so the suite pins what would be persisted. The
 * Quinn HL-003 gate (real PG) provides the fresh-install proof.
 */
const mockQuery = jest.fn(async (_sql, params) => ({
	rows: [{ id: 1, user_id: params[0], confidence: params[5] }],
}));
jest.mock('../../../lib/db', () => ({
	query: (...args) => mockQuery(...args),
	connect: async () => ({ query: (...args) => mockQuery(...args), release: jest.fn() }),
}));

const { addMemory, getMemories } = require('../../../services/memory-service');

beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
beforeEach(() => jest.clearAllMocks());

const sentConfidence = () => mockQuery.mock.calls[0][1][5];

describe('#1626 addMemory confidence honesty', () => {
	test('no confidence recorded → NULL is sent, not a fabricated 0.8', async () => {
		await addMemory(9, { type: 'observation', key: 'k1', value: 'v', source: 'test' });
		expect(sentConfidence()).toBeNull();
	});

	test('a measured 0 is a real measurement → sent verbatim as 0', async () => {
		await addMemory(9, { type: 'observation', key: 'k2', value: 'v', source: 'test', confidence: 0 });
		expect(sentConfidence()).toBe(0);
	});

	test.each([0.5, 1])('a measured %s is sent verbatim', async (c) => {
		await addMemory(9, { type: 'observation', key: 'k3', value: 'v', source: 'test', confidence: c });
		expect(sentConfidence()).toBe(c);
	});

	test.each([
		['NaN', NaN],
		['out of range 2', 2],
		['negative -0.1', -0.1],
		['string "0.9"', '0.9'],
		['null', null],
	])('unrecorded/invalid confidence (%s) → NULL', async (_label, c) => {
		await addMemory(9, { type: 'observation', key: 'k4', value: 'v', source: 'test', confidence: c });
		expect(sentConfidence()).toBeNull();
	});

	test('the conflict-fallback insert path sanitizes the same way', async () => {
		mockQuery
			.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
			.mockImplementation(async (_sql, params) => ({
				rows: [{ id: 2, user_id: params[0], confidence: params[5] }],
			}));
		await addMemory(9, { type: 'observation', key: 'k5', value: 'v', source: 'test' });
		expect(mockQuery).toHaveBeenCalledTimes(2);
		expect(mockQuery.mock.calls[1][1][5]).toBeNull();
	});
});

describe('#1626 getMemories ordering', () => {
	test('orders by confidence DESC NULLS LAST (unmeasured rows last)', async () => {
		mockQuery.mockImplementation(async () => ({ rows: [] }));
		await getMemories(9, {});
		const sql = String(mockQuery.mock.calls[0][0]);
		expect(sql).toMatch(/ORDER BY confidence DESC NULLS LAST/i);
	});
});
