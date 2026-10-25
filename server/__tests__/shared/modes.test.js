/**
 * ModeAdapter tests — S-001 (#640)
 *
 * ADR-006: Shared mode configuration module in shared/interview-modes/.
 * Pure functions + Zod. Importable by both client and server.
 */
const { ModeAdapter, SESSION_TYPES, normalizeType } = require('../../../shared/interview-modes/modes');

describe('ModeAdapter', () => {
	describe('SESSION_TYPES', () => {
		test('exports exactly 4 session types', () => {
			expect(SESSION_TYPES).toEqual(['screening', 'ai-interview', 'practice', 'human']);
		});
	});

	describe('normalizeType', () => {
		test('accepts hyphenated ai-interview', () => {
			expect(normalizeType('ai-interview')).toBe('ai-interview');
		});

		test('normalizes underscore ai_interview to hyphenated form', () => {
			expect(normalizeType('ai_interview')).toBe('ai-interview');
		});

		test('passes through other valid types unchanged', () => {
			expect(normalizeType('screening')).toBe('screening');
			expect(normalizeType('practice')).toBe('practice');
			expect(normalizeType('human')).toBe('human');
		});

		test('returns null for unknown type', () => {
			expect(normalizeType('foo')).toBeNull();
			expect(normalizeType('')).toBeNull();
			expect(normalizeType(null)).toBeNull();
		});
	});

	describe('getDefaults', () => {
		test('ai-interview returns personalized question source', () => {
			const defaults = ModeAdapter.getDefaults('ai-interview');
			expect(defaults.question_source).toBe('personalized');
			expect(defaults.current_question_index).toBe(0);
			expect(Array.isArray(defaults.base_questions)).toBe(true);
		});

		test('screening returns template question source', () => {
			const defaults = ModeAdapter.getDefaults('screening');
			expect(defaults.question_source).toBe('template');
		});

		test('practice returns template question source with feedback enabled', () => {
			const defaults = ModeAdapter.getDefaults('practice');
			expect(defaults.question_source).toBe('template');
			expect(defaults.feedback_enabled).toBe(true);
		});

		test('human returns observer config', () => {
			const defaults = ModeAdapter.getDefaults('human');
			expect(defaults.observer_enabled).toBe(true); // S-046 AC-1: default ON in setup
		});

		test('human defaults biometric_collection to null (S-046 #694)', () => {
			const defaults = ModeAdapter.getDefaults('human');
			// Null = "consent never presented" → gate blocks with
			// BIOMETRIC_CONSENT_UNKNOWN (distinct from explicit decline).
			expect(defaults.biometric_collection).toBe(null);
			// Strict schema still rejects unknown keys
			const result = ModeAdapter.validateConfig('human', { biometric_collection: true });
			expect(result.success).toBe(true);
			expect(result.data.biometric_collection).toBe(true);
		});

		test('human accepts explicit biometric decline (S-012 #651)', () => {
			const result = ModeAdapter.validateConfig('human', { biometric_collection: false });
			expect(result.success).toBe(true);
			expect(result.data.biometric_collection).toBe(false);
		});

		test('throws INVALID_SESSION_TYPE for unknown type', () => {
			try {
				ModeAdapter.getDefaults('foo');
				fail('should have thrown');
			} catch (err) {
				expect(err.code).toBe('INVALID_SESSION_TYPE');
			}
		});

		test('accepts underscore variant and normalizes', () => {
			const defaults = ModeAdapter.getDefaults('ai_interview');
			expect(defaults.question_source).toBe('personalized');
		});
	});

	describe('validateConfig', () => {
		test('accepts valid config for ai-interview', () => {
			const result = ModeAdapter.validateConfig('ai-interview', {
				question_source: 'personalized',
				base_questions: [],
			});
			expect(result.success).toBe(true);
		});

		test('rejects invalid config with field-level errors', () => {
			const result = ModeAdapter.validateConfig('ai-interview', {
				question_source: 123, // wrong type
			});
			expect(result.success).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.errors[0]).toHaveProperty('field');
			expect(result.errors[0]).toHaveProperty('message');
		});

		test('rejects unknown type', () => {
			const result = ModeAdapter.validateConfig('foo', {});
			expect(result.success).toBe(false);
			expect(result.code).toBe('INVALID_SESSION_TYPE');
		});

		test('rejects unknown keys (strict schema)', () => {
			const result = ModeAdapter.validateConfig('screening', {
				num_questons: 5, // typo — should be rejected, not silently stored
			});
			expect(result.success).toBe(false);
			expect(result.errors.some((e) => e.code === 'unrecognized_keys')).toBe(true);
		});
	});
});
