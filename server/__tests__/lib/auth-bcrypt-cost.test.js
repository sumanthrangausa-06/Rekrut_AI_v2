/**
 * #105 — bcrypt cost constant + rehash helpers (security review conditions
 * C-1, C-2(iii), C-2(vi), C-4(iii)).
 *
 * lib/auth.js owns the single BCRYPT_COST constant and the hashPassword /
 * getHashCost / needsRehash helpers every mint site must use.
 * RED on pre-fix code: none of these exports exist.
 */
const bcrypt = require('bcryptjs');
const { BCRYPT_COST, hashPassword, getHashCost, needsRehash } = require('../../../lib/auth');

describe('#105 bcrypt cost helpers', () => {
	jest.setTimeout(60000);

	it('exposes a single BCRYPT_COST constant of 12', () => {
		expect(BCRYPT_COST).toBe(12);
	});

	it('hashPassword mints a $2a$12$ hash that verifies', async () => {
		const hash = await hashPassword('HelperTest1!');
		expect(hash.startsWith('$2a$12$')).toBe(true);
		await expect(bcrypt.compare('HelperTest1!', hash)).resolves.toBe(true);
	});

	it('getHashCost parses the cost segment of a bcrypt hash', async () => {
		const hash13 = await bcrypt.hash('HelperTest1!', 13);
		expect(getHashCost(hash13)).toBe(13);
		const hash10 = await bcrypt.hash('HelperTest1!', 10);
		expect(getHashCost(hash10)).toBe(10);
	});

	it('getHashCost returns NaN for malformed hashes (no throw)', () => {
		expect(Number.isNaN(getHashCost('not-a-hash'))).toBe(true);
		expect(Number.isNaN(getHashCost('$2a$xx$................................'))).toBe(true);
		expect(Number.isNaN(getHashCost(''))).toBe(true);
		expect(Number.isNaN(getHashCost(null))).toBe(true);
		expect(Number.isNaN(getHashCost(undefined))).toBe(true);
	});

	it('needsRehash is true whenever the stored cost differs from BCRYPT_COST, in either direction', async () => {
		const hash13 = await bcrypt.hash('HelperTest1!', 13);
		expect(needsRehash(hash13)).toBe(true);
		const hash14 = await bcrypt.hash('HelperTest1!', 14);
		expect(needsRehash(hash14)).toBe(true); // deliberate convergence DOWN to the constant (C-2vi)
		const hash12 = await bcrypt.hash('HelperTest1!', 12);
		expect(needsRehash(hash12)).toBe(false);
	});

	it('needsRehash treats an unparseable (NaN) cost as a mismatch, but never fires without a hash', () => {
		expect(needsRehash('not-a-hash')).toBe(true); // C-2(iii): NaN ⇒ rehash
		expect(needsRehash(null)).toBe(false); // OAuth-only users carry no hash
		expect(needsRehash(undefined)).toBe(false);
		expect(needsRehash('')).toBe(false);
	});
});
