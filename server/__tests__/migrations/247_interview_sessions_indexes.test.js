/**
 * Migration 247 tests — S-001 (#640)
 *
 * Verifies the migration creates indexes and CHECK constraint correctly.
 * Tests migration content (SQL structure), not live DB execution.
 */
const migration = require('../../../migrations/247_interview_sessions_indexes');

describe('Migration 247: interview_sessions indexes', () => {
	test('exports up and down functions', () => {
		expect(typeof migration.up).toBe('function');
		expect(typeof migration.down).toBe('function');
		expect(migration.name).toBe('247_interview_sessions_indexes');
	});

	test('up creates application_id index', async () => {
		const queries = [];
		const mockClient = { query: jest.fn((sql) => { queries.push(sql); return Promise.resolve(); }) };
		await migration.up(mockClient);
		expect(queries.some((q) => q.includes('idx_interview_sessions_application'))).toBe(true);
		expect(queries.some((q) => q.includes('CREATE INDEX IF NOT EXISTS'))).toBe(true);
	});

	test('up creates company_id index', async () => {
		const queries = [];
		const mockClient = { query: jest.fn((sql) => { queries.push(sql); return Promise.resolve(); }) };
		await migration.up(mockClient);
		expect(queries.some((q) => q.includes('idx_interview_sessions_company'))).toBe(true);
	});

	test('up adds type CHECK constraint (idempotent)', async () => {
		const queries = [];
		const mockClient = { query: jest.fn((sql) => { queries.push(sql); return Promise.resolve(); }) };
		await migration.up(mockClient);
		const checkQuery = queries.find((q) => q.includes('chk_interview_sessions_type'));
		expect(checkQuery).toBeDefined();
		expect(checkQuery).toMatch(/ai_interview/); // underscore DB form
		expect(checkQuery).toMatch(/IF NOT EXISTS/); // idempotent
	});

	test('down removes constraint and indexes', async () => {
		const queries = [];
		const mockClient = { query: jest.fn((sql) => { queries.push(sql); return Promise.resolve(); }) };
		await migration.down(mockClient);
		expect(queries.some((q) => q.includes('DROP CONSTRAINT IF EXISTS chk_interview_sessions_type'))).toBe(true);
		expect(queries.some((q) => q.includes('DROP INDEX IF EXISTS idx_interview_sessions_company'))).toBe(true);
		expect(queries.some((q) => q.includes('DROP INDEX IF EXISTS idx_interview_sessions_application'))).toBe(true);
	});
});
