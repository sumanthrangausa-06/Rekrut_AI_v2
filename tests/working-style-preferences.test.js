/**
 * @jest-environment node
 *
 * Working Style Profile — Issue #81
 * Tests for GET /candidate/preferences and PUT /candidate/preferences
 * These tests are RED: the implementation does not exist yet.
 */

const express = require('express');
const request = require('supertest');

// ─── Mock DB ────────────────────────────────────────────────────────────────
const mockPreferencesStore = new Map(); // userId -> preferences object

jest.mock('../lib/db', () => {
	const mockQuery = jest.fn(async (sql, params) => {
		const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

		// SELECT preferences from candidate_profiles
		if (normalized.includes('select') && normalized.includes('from candidate_profiles') && normalized.includes('where user_id =')) {
			const userId = params[0];
			const prefs = mockPreferencesStore.get(userId);
			if (prefs) {
				return { rows: [prefs], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		}

		// UPDATE candidate_profiles with preferences
		if (normalized.includes('update candidate_profiles') && normalized.includes('set') && normalized.includes('where user_id =')) {
			const userId = params[params.length - 1]; // last param is user_id
			// Build updated preferences from params
			const updated = {
				user_id: userId,
				work_mode: params[0] || null,
				work_hours: params[1] || null,
				timezone_preference: params[2] || null,
				travel_willingness: params[3] || null,
				start_date_flexibility: params[4] || null,
				salary_expectation_min: params[5] || null,
				salary_expectation_max: params[6] || null,
				salary_currency: params[7] || 'USD',
				preferred_company_size: params[8] || null,
				updated_at: new Date().toISOString(),
			};
			mockPreferencesStore.set(userId, updated);
			return { rows: [updated], rowCount: 1 };
		}

		// INSERT candidate_profiles (when profile doesn't exist)
		if (normalized.includes('insert into candidate_profiles') && normalized.includes('returning')) {
			const userId = params[0];
			const newProfile = {
				id: 1,
				user_id: userId,
				work_mode: params.find((p, i) => normalized.includes('work_mode') && i > 0) || null,
				work_hours: null,
				timezone_preference: null,
				travel_willingness: null,
				start_date_flexibility: null,
				salary_expectation_min: null,
				salary_expectation_max: null,
				salary_currency: 'USD',
				preferred_company_size: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			};
			mockPreferencesStore.set(userId, newProfile);
			return { rows: [newProfile], rowCount: 1 };
		}

		// Fallback
		return { rows: [], rowCount: 0 };
	});

	return {
		query: mockQuery,
		getQueryStats: () => ({ totalQueries: 0, slowQueries: 0, queriesPerMinute: 0 }),
		end: jest.fn().mockResolvedValue(undefined),
		on: jest.fn(),
	};
});

// ─── Mock Auth Middleware ───────────────────────────────────────────────────
jest.mock('../lib/auth', () => ({
	authMiddleware: (req, res, next) => {
		req.user = { id: 42, email: 'candidate@example.com', role: 'candidate' };
		next();
	},
}));

// ─── Import route under test ────────────────────────────────────────────────
// NOTE: This route does NOT exist yet — these tests will fail (RED)
let candidatePreferencesRoute;

describe('Working Style Profile — Issue #81', () => {
	let app;
	let mockPool;

	beforeAll(() => {
		try {
			candidatePreferencesRoute = require('../routes/candidate-preferences');
		} catch (err) {
			candidatePreferencesRoute = null;
		}
	});

	beforeEach(() => {
		mockPreferencesStore.clear();
		app = express();
		app.use(express.json());
		if (candidatePreferencesRoute) {
			app.use('/candidate', candidatePreferencesRoute);
		}
		mockPool = require('../lib/db');
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it('route file exists', () => {
		expect(candidatePreferencesRoute).not.toBeNull();
		expect(typeof candidatePreferencesRoute).toBe('function');
	});

	// ─── GET /candidate/preferences ───────────────────────────────────────
	describe('GET /candidate/preferences', () => {
		it('returns working style preferences for authenticated candidate', async () => {
			// Seed preferences
			mockPreferencesStore.set(42, {
				user_id: 42,
				work_mode: 'remote',
				work_hours: 'full_time',
				timezone_preference: 'UTC-5',
				travel_willingness: 'none',
				start_date_flexibility: '2_weeks',
				salary_expectation_min: 80000,
				salary_expectation_max: 120000,
				salary_currency: 'USD',
				preferred_company_size: 'startup',
			});

			const response = await request(app).get('/candidate/preferences');

			expect(response.status).toBe(200);
			expect(response.body.success).toBe(true);
			expect(response.body.preferences).toMatchObject({
				work_mode: 'remote',
				work_hours: 'full_time',
				timezone_preference: 'UTC-5',
				travel_willingness: 'none',
				start_date_flexibility: '2_weeks',
				salary_expectation_min: 80000,
				salary_expectation_max: 120000,
				salary_currency: 'USD',
				preferred_company_size: 'startup',
			});
		});

		it('returns empty preferences when none exist', async () => {
			const response = await request(app).get('/candidate/preferences');

			expect(response.status).toBe(200);
			expect(response.body.success).toBe(true);
			expect(response.body.preferences).toEqual({});
		});

		it('returns 401 when not authenticated', async () => {
			// Temporarily remove auth mock
			const authModule = require('../lib/auth');
			const originalMiddleware = authModule.authMiddleware;
			authModule.authMiddleware = (req, res, next) => res.status(401).json({ error: 'Unauthorized' });

			const response = await request(app).get('/candidate/preferences');

			expect(response.status).toBe(401);
			authModule.authMiddleware = originalMiddleware;
		});
	});

	// ─── PUT /candidate/preferences ───────────────────────────────────────
	describe('PUT /candidate/preferences', () => {
		it('creates new preferences when profile does not exist', async () => {
			const payload = {
				work_mode: 'hybrid',
				work_hours: 'flexible',
				timezone_preference: 'CET',
				travel_willingness: 'occasional',
				start_date_flexibility: '1_month',
				salary_expectation_min: 60000,
				salary_expectation_max: 90000,
				salary_currency: 'EUR',
				preferred_company_size: 'medium',
			};

			const response = await request(app)
				.put('/candidate/preferences')
				.send(payload);

			expect(response.status).toBe(200);
			expect(response.body.success).toBe(true);
			expect(response.body.preferences).toMatchObject(payload);
		});

		it('updates existing preferences', async () => {
			// Seed existing preferences
			mockPreferencesStore.set(42, {
				user_id: 42,
				work_mode: 'onsite',
				work_hours: 'part_time',
				timezone_preference: 'PST',
				travel_willingness: 'frequent',
				start_date_flexibility: 'immediate',
				salary_expectation_min: 50000,
				salary_expectation_max: 70000,
				salary_currency: 'USD',
				preferred_company_size: 'enterprise',
			});

			const update = {
				work_mode: 'remote',
				work_hours: 'full_time',
				salary_expectation_min: 100000,
				salary_expectation_max: 150000,
			};

			const response = await request(app)
				.put('/candidate/preferences')
				.send(update);

			expect(response.status).toBe(200);
			expect(response.body.success).toBe(true);
			expect(response.body.preferences.work_mode).toBe('remote');
			expect(response.body.preferences.work_hours).toBe('full_time');
			expect(response.body.preferences.salary_expectation_min).toBe(100000);
		});

		it('rejects invalid work_mode values', async () => {
			const response = await request(app)
				.put('/candidate/preferences')
				.send({ work_mode: 'invalid_mode' });

			expect(response.status).toBe(400);
			expect(response.body.error).toContain('work_mode');
		});

		it('rejects invalid work_hours values', async () => {
			const response = await request(app)
				.put('/candidate/preferences')
				.send({ work_hours: 'invalid_hours' });

			expect(response.status).toBe(400);
			expect(response.body.error).toContain('work_hours');
		});

		it('rejects invalid travel_willingness values', async () => {
			const response = await request(app)
				.put('/candidate/preferences')
				.send({ travel_willingness: 'maybe' });

			expect(response.status).toBe(400);
			expect(response.body.error).toContain('travel_willingness');
		});

		it('rejects invalid start_date_flexibility values', async () => {
			const response = await request(app)
				.put('/candidate/preferences')
				.send({ start_date_flexibility: 'someday' });

			expect(response.status).toBe(400);
			expect(response.body.error).toContain('start_date_flexibility');
		});

		it('rejects invalid preferred_company_size values', async () => {
			const response = await request(app)
				.put('/candidate/preferences')
				.send({ preferred_company_size: 'huge' });

			expect(response.status).toBe(400);
			expect(response.body.error).toContain('preferred_company_size');
		});

		it('rejects salary_min greater than salary_max', async () => {
			const response = await request(app)
				.put('/candidate/preferences')
				.send({
					salary_expectation_min: 100000,
					salary_expectation_max: 50000,
				});

			expect(response.status).toBe(400);
			expect(response.body.error).toContain('salary');
		});

		it('rejects negative salary values', async () => {
			const response = await request(app)
				.put('/candidate/preferences')
				.send({ salary_expectation_min: -1000 });

			expect(response.status).toBe(400);
			expect(response.body.error).toContain('salary');
		});

		it('allows partial updates', async () => {
			mockPreferencesStore.set(42, {
				user_id: 42,
				work_mode: 'hybrid',
				work_hours: 'full_time',
				salary_currency: 'USD',
			});

			const response = await request(app)
				.put('/candidate/preferences')
				.send({ timezone_preference: 'IST' });

			expect(response.status).toBe(200);
			expect(response.body.preferences.timezone_preference).toBe('IST');
			expect(response.body.preferences.work_mode).toBe('hybrid'); // unchanged
		});
	});

	// ─── Validation ───────────────────────────────────────────────────────
	describe('Field validation', () => {
		it('accepts all valid work_mode values', async () => {
			const validModes = ['remote', 'hybrid', 'onsite', 'no_preference'];
			for (const mode of validModes) {
				mockPreferencesStore.clear();
				const response = await request(app)
					.put('/candidate/preferences')
					.send({ work_mode: mode });
				expect(response.status).toBe(200);
				expect(response.body.preferences.work_mode).toBe(mode);
			}
		});

		it('accepts all valid work_hours values', async () => {
			const validHours = ['full_time', 'part_time', 'flexible', 'contract'];
			for (const hours of validHours) {
				mockPreferencesStore.clear();
				const response = await request(app)
					.put('/candidate/preferences')
					.send({ work_hours: hours });
				expect(response.status).toBe(200);
				expect(response.body.preferences.work_hours).toBe(hours);
			}
		});

		it('accepts all valid travel_willingness values', async () => {
			const validTravel = ['none', 'occasional', 'frequent'];
			for (const travel of validTravel) {
				mockPreferencesStore.clear();
				const response = await request(app)
					.put('/candidate/preferences')
					.send({ travel_willingness: travel });
				expect(response.status).toBe(200);
				expect(response.body.preferences.travel_willingness).toBe(travel);
			}
		});

		it('accepts all valid start_date_flexibility values', async () => {
			const validDates = ['immediate', '2_weeks', '1_month', 'negotiable'];
			for (const flex of validDates) {
				mockPreferencesStore.clear();
				const response = await request(app)
					.put('/candidate/preferences')
					.send({ start_date_flexibility: flex });
				expect(response.status).toBe(200);
				expect(response.body.preferences.start_date_flexibility).toBe(flex);
			}
		});

		it('accepts all valid preferred_company_size values', async () => {
			const validSizes = ['startup', 'small', 'medium', 'enterprise', 'any'];
			for (const size of validSizes) {
				mockPreferencesStore.clear();
				const response = await request(app)
					.put('/candidate/preferences')
					.send({ preferred_company_size: size });
				expect(response.status).toBe(200);
				expect(response.body.preferences.preferred_company_size).toBe(size);
			}
		});
	});
});
