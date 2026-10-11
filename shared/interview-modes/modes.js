/**
 * ModeAdapter — Shared mode configuration module (ADR-006, S-001 #640).
 *
 * Mode schemas + defaults + validation, importable by both client and server.
 * Pure functions + Zod. No side effects, no DB access. No Node.js-specific
 * imports (client-safe per ADR-006).
 *
 * The 4 interview modes:
 *   - screening:    Standardized template questions, auto-sent on apply
 *   - ai-interview: Personalized from JD + resume, with follow-ups
 *   - practice:     Mock interview for candidate practice (feedback enabled)
 *   - human:        Human-led with optional AI observer
 *
 * Type normalization: API accepts both `ai-interview` (hyphen, per AC-1)
 * and `ai_interview` (underscore, existing DB convention).
 *
 * Error contract:
 *   - getDefaults / buildConfig: THROW coded Errors (INVALID_SESSION_TYPE, VALIDATION_ERROR)
 *   - validateConfig: RETURN {success, data?, errors?, code?} tuple (never throws)
 */
const { z } = require('zod');

const SESSION_TYPES = ['screening', 'ai-interview', 'practice', 'human'];

// Map underscore variants to canonical hyphenated form
const TYPE_ALIASES = {
	ai_interview: 'ai-interview',
};

function normalizeType(type) {
	if (type == null || typeof type !== 'string') return null;
	const trimmed = type.trim();
	if (TYPE_ALIASES[trimmed]) return TYPE_ALIASES[trimmed];
	if (SESSION_TYPES.includes(trimmed)) return trimmed;
	return null;
}

/**
 * Map canonical (hyphenated) type to DB storage form (underscore).
 * Single place to extend when adding modes with divergent storage names.
 */
function toStorageType(canonicalType) {
	return canonicalType.replace(/-/g, '_');
}

/**
 * Map DB storage form back to canonical (hyphenated) type.
 */
function fromStorageType(dbType) {
	if (dbType == null || typeof dbType !== 'string') return null;
	return normalizeType(dbType);
}

// ─── Zod schemas per mode (strict — unknown keys rejected) ─────────────────
// Schemas are the SINGLE source of truth for defaults: ModeAdapter.getDefaults
// derives via schema.parse({}). Do not maintain a parallel defaults literal.

const modeSchemas = {
	screening: z
		.object({
			question_source: z.literal('template').default('template'),
			num_questions: z.number().int().min(1).max(50).default(10),
			time_limit_minutes: z.number().int().min(1).max(180).optional(),
			current_phase: z.string().default('intro'),
			job: z.record(z.unknown()).default({}),
			template: z.record(z.unknown()).default({}),
		})
		.strict(),
	'ai-interview': z
		.object({
			question_source: z.literal('personalized').default('personalized'),
			base_questions: z.array(z.string()).default([]),
			current_question_index: z.number().int().min(0).default(0),
			target_role: z.string().optional(),
			options: z.record(z.unknown()).default({}),
		})
		.strict(),
	practice: z
		.object({
			question_source: z.literal('template').default('template'),
			feedback_enabled: z.boolean().default(true),
			num_questions: z.number().int().min(1).max(50).default(5),
			current_phase: z.string().default('intro'),
		})
		.strict(),
	human: z
		.object({
			observer_enabled: z.boolean().default(false),
			scheduled_at: z.string().datetime().optional(),
		})
		.strict(),
};

// ─── ModeAdapter ───────────────────────────────────────────────────────────

const ModeAdapter = {
	/**
	 * Get Zod-validated config defaults for a session type.
	 * Derives defaults from the mode's Zod schema (single source of truth).
	 * @param {string} type - session type (hyphen or underscore form accepted)
	 * @returns {object} validated defaults for the mode
	 * @throws {Error} with code INVALID_SESSION_TYPE if unknown
	 */
	getDefaults(type) {
		const normalized = normalizeType(type);
		if (!normalized) {
			const err = new Error(
				`Invalid session type "${type}". Must be one of: ${SESSION_TYPES.join(', ')}`,
			);
			err.code = 'INVALID_SESSION_TYPE';
			throw err;
		}
		return modeSchemas[normalized].parse({});
	},

	/**
	 * Validate a caller-supplied config against the mode's Zod schema.
	 * @param {string} type - session type
	 * @param {object} config - caller config
	 * @returns {{success: boolean, data?: object, errors?: Array, code?: string}} (never throws)
	 */
	validateConfig(type, config) {
		const normalized = normalizeType(type);
		if (!normalized) {
			return { success: false, code: 'INVALID_SESSION_TYPE', errors: [] };
		}
		const result = modeSchemas[normalized].safeParse(config || {});
		if (!result.success) {
			return {
				success: false,
				code: 'VALIDATION_ERROR',
				errors: result.error.issues.map((issue) => ({
					field: issue.path.join('.') || '(root)',
					message: issue.message,
					code: issue.code,
				})),
			};
		}
		return { success: true, data: result.data };
	},

	/**
	 * Get defaults merged with caller config, fully validated.
	 * @param {string} type - session type
	 * @param {object} callerConfig - caller overrides (unknown keys rejected)
	 * @returns {object} validated merged config
	 * @throws {Error} with code INVALID_SESSION_TYPE or VALIDATION_ERROR (with .errors)
	 */
	buildConfig(type, callerConfig) {
		const normalized = normalizeType(type);
		if (!normalized) {
			const err = new Error(`Invalid session type "${type}"`);
			err.code = 'INVALID_SESSION_TYPE';
			throw err;
		}
		const defaults = modeSchemas[normalized].parse({});
		const merged = { ...defaults, ...(callerConfig || {}) };
		const validation = this.validateConfig(normalized, merged);
		if (!validation.success) {
			const err = new Error('Config validation failed');
			err.code = 'VALIDATION_ERROR';
			err.errors = validation.errors;
			throw err;
		}
		return validation.data;
	},
};

module.exports = { ModeAdapter, SESSION_TYPES, normalizeType, toStorageType, fromStorageType };
