// Candidate Working Style Preferences — Issue #81
const express = require('express');
const { authMiddleware } = require('../lib/auth');
const pool = require('../lib/db');

const router = express.Router();

// ─── Validation Constants ───────────────────────────────────────────────────

const VALID_ENUMS = {
	work_mode: ['remote', 'hybrid', 'onsite', 'no_preference'],
	work_hours: ['full_time', 'part_time', 'flexible', 'contract'],
	travel_willingness: ['none', 'occasional', 'frequent'],
	start_date_flexibility: ['immediate', '2_weeks', '1_month', 'negotiable'],
	preferred_company_size: ['startup', 'small', 'medium', 'enterprise', 'any'],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function validatePreferences(body) {
	// Validate enum fields (only if present)
	for (const [field, validValues] of Object.entries(VALID_ENUMS)) {
		if (body[field] !== undefined && body[field] !== null) {
			if (!validValues.includes(body[field])) {
				return { valid: false, error: `Invalid ${field} value` };
			}
		}
	}

	// Validate salary fields
	const minSalary = body.salary_expectation_min;
	const maxSalary = body.salary_expectation_max;

	if (minSalary !== undefined && minSalary !== null) {
		const parsedMin = Number(minSalary);
		if (Number.isNaN(parsedMin) || parsedMin < 0) {
			return { valid: false, error: 'Invalid salary value' };
		}
	}

	if (maxSalary !== undefined && maxSalary !== null) {
		const parsedMax = Number(maxSalary);
		if (Number.isNaN(parsedMax) || parsedMax < 0) {
			return { valid: false, error: 'Invalid salary value' };
		}
	}

	// Validate salary range (only if both are present)
	if (
		minSalary !== undefined &&
		minSalary !== null &&
		maxSalary !== undefined &&
		maxSalary !== null
	) {
		const parsedMin = Number(minSalary);
		const parsedMax = Number(maxSalary);
		if (!Number.isNaN(parsedMin) && !Number.isNaN(parsedMax) && parsedMin > parsedMax) {
			return { valid: false, error: 'salary_expectation_min cannot exceed salary_expectation_max' };
		}
	}

	return { valid: true };
}

function sanitizePreferences(body) {
	const fields = [
		'work_mode',
		'work_hours',
		'timezone_preference',
		'travel_willingness',
		'start_date_flexibility',
		'salary_expectation_min',
		'salary_expectation_max',
		'salary_currency',
		'preferred_company_size',
	];

	const result = {};
	for (const field of fields) {
		if (body[field] !== undefined) {
			result[field] = body[field] === '' ? null : body[field];
		}
	}

	// Default salary_currency if not provided
	if (result.salary_currency === undefined && body.salary_currency === undefined) {
		// Don't set default here — let the DB default handle it, or preserve existing
	}

	return result;
}

// ─── GET /candidate/preferences ─────────────────────────────────────────────

router.get('/preferences', authMiddleware, async (req, res) => {
	try {
		const result = await pool.query(
			`
			SELECT
				work_mode,
				work_hours,
				timezone_preference,
				travel_willingness,
				start_date_flexibility,
				salary_expectation_min,
				salary_expectation_max,
				salary_currency,
				preferred_company_size
			FROM candidate_profiles
			WHERE user_id = $1
			`,
			[req.user.id],
		);

		if (result.rows.length === 0) {
			return res.json({ success: true, preferences: {} });
		}

		res.json({ success: true, preferences: result.rows[0] });
	} catch (err) {
		console.error('Get preferences error:', err);
		res.status(500).json({ error: 'Failed to get preferences' });
	}
});

// ─── PUT /candidate/preferences ─────────────────────────────────────────────

router.put('/preferences', authMiddleware, async (req, res) => {
	try {
		const updates = sanitizePreferences(req.body);

		// If body is empty (no recognized fields), still allow but nothing to update
		const validation = validatePreferences(req.body);
		if (!validation.valid) {
			return res.status(400).json({ error: validation.error });
		}

		// Check if profile exists
		const existing = await pool.query(
			`
			SELECT
				work_mode,
				work_hours,
				timezone_preference,
				travel_willingness,
				start_date_flexibility,
				salary_expectation_min,
				salary_expectation_max,
				salary_currency,
				preferred_company_size
			FROM candidate_profiles
			WHERE user_id = $1
			`,
			[req.user.id],
		);

		let resultPreferences;

		if (existing.rows.length > 0) {
			// Merge existing with updates
			const merged = { ...existing.rows[0], ...updates };

			// Ensure salary_currency has a value
			if (merged.salary_currency === undefined || merged.salary_currency === null) {
				merged.salary_currency = 'USD';
			}

			await pool.query(
				`
				UPDATE candidate_profiles SET
					work_mode = $1,
					work_hours = $2,
					timezone_preference = $3,
					travel_willingness = $4,
					start_date_flexibility = $5,
					salary_expectation_min = $6,
					salary_expectation_max = $7,
					salary_currency = $8,
					preferred_company_size = $9,
					updated_at = NOW()
				WHERE user_id = $10
				`,
				[
					merged.work_mode,
					merged.work_hours,
					merged.timezone_preference,
					merged.travel_willingness,
					merged.start_date_flexibility,
					merged.salary_expectation_min,
					merged.salary_expectation_max,
					merged.salary_currency,
					merged.preferred_company_size,
					req.user.id,
				],
			);

			resultPreferences = merged;
		} else {
			// Create new profile with preferences
			const newProfile = {
				work_mode: updates.work_mode ?? null,
				work_hours: updates.work_hours ?? null,
				timezone_preference: updates.timezone_preference ?? null,
				travel_willingness: updates.travel_willingness ?? null,
				start_date_flexibility: updates.start_date_flexibility ?? null,
				salary_expectation_min: updates.salary_expectation_min ?? null,
				salary_expectation_max: updates.salary_expectation_max ?? null,
				salary_currency: updates.salary_currency ?? 'USD',
				preferred_company_size: updates.preferred_company_size ?? null,
			};

			await pool.query(
				`
				INSERT INTO candidate_profiles (
					user_id,
					work_mode,
					work_hours,
					timezone_preference,
					travel_willingness,
					start_date_flexibility,
					salary_expectation_min,
					salary_expectation_max,
					salary_currency,
					preferred_company_size
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
				`,
				[
					req.user.id,
					newProfile.work_mode,
					newProfile.work_hours,
					newProfile.timezone_preference,
					newProfile.travel_willingness,
					newProfile.start_date_flexibility,
					newProfile.salary_expectation_min,
					newProfile.salary_expectation_max,
					newProfile.salary_currency,
					newProfile.preferred_company_size,
				],
			);

			resultPreferences = newProfile;
		}

		res.json({ success: true, preferences: resultPreferences });
	} catch (err) {
		console.error('Update preferences error:', err);
		res.status(500).json({ error: 'Failed to update preferences' });
	}
});

module.exports = router;
