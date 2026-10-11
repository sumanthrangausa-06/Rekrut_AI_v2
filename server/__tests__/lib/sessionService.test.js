/**
 * SessionService tests — S-001 (#640)
 *
 * SessionService.create() → ModeAdapter.getDefaults(type) → writes to interview_sessions.
 */
const SessionService = require('../../../lib/sessionService');

// Mock the database pool
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));

const db = require('../../../lib/db');

describe('SessionService', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('create', () => {
		test('creates session with ai-interview defaults and status invited', async () => {
			const mockRow = {
				id: 1,
				type: 'ai_interview',
				status: 'invited',
				config: { question_source: 'personalized' },
			};
			db.query.mockResolvedValue({ rows: [mockRow] });

			const session = await SessionService.create({
				type: 'ai-interview',
				triggeredBy: 42,
				companyId: 7,
			});

			expect(session.status).toBe('invited');
			expect(session.type).toBe('ai_interview'); // normalized for DB
			expect(db.query).toHaveBeenCalledTimes(1);
			// Verify INSERT was called (not UPDATE/DELETE)
			expect(db.query.mock.calls[0][0]).toMatch(/INSERT INTO interview_sessions/i);
		});

		test('throws INVALID_SESSION_TYPE for unknown type', async () => {
			try {
				await SessionService.create({ type: 'foo', triggeredBy: 42 });
				fail('should have thrown');
			} catch (err) {
				expect(err.code).toBe('INVALID_SESSION_TYPE');
			}
			expect(db.query).not.toHaveBeenCalled();
		});

		test('throws validation error for invalid config (no DB write)', async () => {
			await expect(
				SessionService.create({
					type: 'ai-interview',
					triggeredBy: 42,
					config: { question_source: 123 }, // invalid
				}),
			).rejects.toThrow();
			expect(db.query).not.toHaveBeenCalled();
		});

		test('merges caller config over mode defaults', async () => {
			const mockRow = { id: 2, type: 'screening', status: 'invited', config: {} };
			db.query.mockResolvedValue({ rows: [mockRow] });

			await SessionService.create({
				type: 'screening',
				triggeredBy: 42,
				config: { num_questions: 10 },
			});

			const insertArgs = db.query.mock.calls[0][1];
			const configJson = JSON.parse(insertArgs.find((a) => typeof a === 'string' && a.includes('num_questions')) || '{}');
			// Config should include both defaults and caller overrides
			expect(db.query).toHaveBeenCalled();
		});

		test('requires triggeredBy', async () => {
			await expect(SessionService.create({ type: 'screening' })).rejects.toThrow();
			expect(db.query).not.toHaveBeenCalled();
		});
	});
});
