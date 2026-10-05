/**
 * Tests for lib/notify.js — in-app pipeline notifications.
 */
jest.mock('../lib/db', () => ({
	query: jest.fn(),
}));

const db = require('../lib/db');
const { notifyUser } = require('../lib/notify');

describe('notifyUser', () => {
	beforeEach(() => {
		db.query.mockReset();
	});

	test('inserts a notification row and returns the id', async () => {
		db.query.mockResolvedValue({ rows: [{ id: 42 }] });
		const id = await notifyUser(7, 'screening_invited', 'Title', 'Message', { a: 1 });
		expect(id).toBe(42);
		expect(db.query).toHaveBeenCalledTimes(1);
		const [sql, params] = db.query.mock.calls[0];
		expect(sql).toMatch(/INSERT INTO user_notifications/);
		expect(params[0]).toBe(7);
		expect(params[1]).toBe('screening_invited');
		expect(params[2]).toBe('Title');
		expect(params[3]).toBe('Message');
		expect(JSON.parse(params[4])).toEqual({ a: 1 });
	});

	test('returns null for missing userId without touching the db', async () => {
		await expect(notifyUser(null, 'x', 't', 'm')).resolves.toBeNull();
		await expect(notifyUser(undefined, 'x', 't', 'm')).resolves.toBeNull();
		await expect(notifyUser(0, 'x', 't', 'm')).resolves.toBeNull();
		expect(db.query).not.toHaveBeenCalled();
	});

	test('returns null (not throw) when the db fails', async () => {
		db.query.mockRejectedValue(new Error('db down'));
		await expect(notifyUser(7, 'x', 't', 'm')).resolves.toBeNull();
	});
});
