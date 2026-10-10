/**
 * S-014 (#573): biometricAudit helper — unit tests with mocked pool.
 *
 * AC-1: logAccess writes [timestamp][user_id][role][action][data_type][candidate_id].
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));

const db = require('../../../lib/db');
const { logAccess, VALID_ACTIONS } = require('../../../lib/biometricAudit');

describe('biometricAudit.logAccess', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('inserts a row with all required fields', async () => {
		db.query.mockResolvedValueOnce({
			rows: [
				{
					id: 1,
					accessed_at: '2026-10-10T00:00:00Z',
					user_id: 42,
					user_role: 'recruiter',
					action: 'view',
					data_type: 'face_embedding',
					candidate_id: 7,
					ip_address: '1.2.3.4',
				},
			],
		});

		const row = await logAccess({
			userId: 42,
			userRole: 'recruiter',
			action: 'view',
			dataType: 'face_embedding',
			candidateId: 7,
			ipAddress: '1.2.3.4',
		});

		expect(db.query).toHaveBeenCalledTimes(1);
		const [sql, params] = db.query.mock.calls[0];
		expect(sql).toMatch(/INSERT INTO biometric_audit_log/);
		expect(params).toEqual([42, 'recruiter', 'view', 'face_embedding', 7, '1.2.3.4']);
		expect(row.id).toBe(1);
		expect(row.action).toBe('view');
	});

	test('accepts all valid actions: view, export, delete, purge', async () => {
		for (const action of VALID_ACTIONS) {
			db.query.mockResolvedValueOnce({ rows: [{ id: 1, action }] });
			const row = await logAccess({
				userId: 1,
				userRole: 'admin',
				action,
				dataType: 'voice_profile',
				candidateId: 2,
			});
			expect(row.action).toBe(action);
		}
	});

	test('rejects invalid action', async () => {
		await expect(
			logAccess({
				userId: 1,
				userRole: 'admin',
				action: 'hack',
				dataType: 'face_embedding',
				candidateId: 2,
			}),
		).rejects.toThrow(/Invalid action/);
		expect(db.query).not.toHaveBeenCalled();
	});

	test('requires userId, userRole, action, dataType, candidateId', async () => {
		await expect(logAccess({})).rejects.toThrow(/required/);
		await expect(
			logAccess({ userId: 1, userRole: 'admin', action: 'view', dataType: 'x' }),
		).rejects.toThrow(/required/);
		expect(db.query).not.toHaveBeenCalled();
	});

	test('ipAddress is optional', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ id: 2 }] });
		await logAccess({
			userId: 1,
			userRole: 'admin',
			action: 'export',
			dataType: 'transcript',
			candidateId: 3,
		});
		const [, params] = db.query.mock.calls[0];
		expect(params[5]).toBeNull();
	});
});
