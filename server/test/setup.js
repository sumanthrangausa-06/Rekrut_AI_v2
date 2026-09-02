const _path = require('node:path');

// ─── Mock PostgreSQL pool ────────────────────────────────────────────────────
// Inline mock factory to avoid Jest out-of-scope variable restriction.
// All mock logic lives inside the factory so it can reference jest.fn().
// NOTE: jest.mock() is hoisted — use relative path string, not path.resolve().

jest.mock('../../lib/db', () => {
	const mockUsers = new Map();
	let nextUserId = 1;

	const mockQuery = jest.fn(async (sql, params) => {
		const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

		// Auth routes: SELECT user by email (both SELECT id and SELECT * patterns)
		if (
			normalized.includes('select id from users where email =') ||
			normalized.includes('select * from users where email =')
		) {
			const email = params[0];
			const user = mockUsers.get(email);
			if (user) {
				return {
					rows: [
						{
							id: user.id,
							email: user.email,
							name: user.name,
							role: user.role,
							password_hash: user.password_hash,
							company_id: user.company_id || null,
						},
					],
					rowCount: 1,
				};
			}
			return { rows: [], rowCount: 0 };
		}

		// Auth routes: SELECT user by ID (both SELECT * and SELECT id,email,name,role,company_id patterns)
		if (
			normalized.includes('select * from users where id =') ||
			normalized.includes('select id, email, name, role, company_id from users where id =')
		) {
			const userId = params[0];
			for (const user of mockUsers.values()) {
				if (user.id === userId) {
					return {
						rows: [
							{
								id: user.id,
								email: user.email,
								name: user.name,
								role: user.role,
								company_id: user.company_id || null,
							},
						],
						rowCount: 1,
					};
				}
			}
			return { rows: [], rowCount: 0 };
		}

		// Auth routes: INSERT user
		if (normalized.includes('insert into users') && normalized.includes('returning')) {
			const email = params.find((p) => typeof p === 'string' && p.includes('@')) || params[0];
			// Simulate unique constraint violation for duplicate emails
			if (mockUsers.has(email)) {
				const error = new Error('duplicate key value violates unique constraint "users_email_key"');
				error.code = '23505';
				throw error;
			}
			const newUser = {
				id: nextUserId++,
				email: params[0],
				password_hash: params[1] || '$2a$10$fakehash',
				name: params[2] || 'Test User',
				role: params[3] || 'candidate',
				company_id: null,
			};
			mockUsers.set(newUser.email, newUser);
			return { rows: [newUser], rowCount: 1 };
		}

		// Auth routes: refresh token insert
		if (normalized.includes('insert into refresh_tokens')) {
			return { rows: [], rowCount: 1 };
		}

		// Auth routes: events table insert
		if (normalized.includes('insert into events')) {
			return { rows: [], rowCount: 1 };
		}

		// Auth routes: SELECT refresh token
		if (normalized.includes('select rt.*, u.email, u.role, u.name from refresh_tokens')) {
			return { rows: [], rowCount: 0 };
		}

		// Auth routes: UPDATE refresh tokens
		if (normalized.includes('update refresh_tokens')) {
			return { rows: [], rowCount: 1 };
		}

		// Jobs routes: SELECT job by ID (must be before the list query to avoid collision)
		if (normalized.includes('from jobs') && normalized.includes('where j.id =')) {
			const jobId = params[0];
			// Return 404 for non-existent job ID
			if (jobId === 99999) {
				return { rows: [], rowCount: 0 };
			}
			return {
				rows: [
					{
						id: jobId,
						title: 'Test Job',
						company: 'Test Company',
						location: 'Remote',
						description: 'Test description',
						salary_min: 50000,
						salary_max: 100000,
						job_type: 'full-time',
						status: 'active',
						created_at: new Date().toISOString(),
					},
				],
				rowCount: 1,
			};
		}

		// Jobs routes: SELECT jobs (list) — must check it's NOT a COUNT query
		if (
			normalized.includes('from jobs') &&
			normalized.includes('select') &&
			!normalized.includes('count(*)')
		) {
			const jobs = [
				{
					id: 1,
					title: 'Software Engineer',
					company: 'Test Company',
					location: 'San Francisco',
					description: 'Test job description',
					salary_min: 50000,
					salary_max: 100000,
					job_type: 'full-time',
					status: 'active',
					created_at: new Date().toISOString(),
				},
			];
			return { rows: jobs, rowCount: jobs.length };
		}

		// Jobs routes: INSERT job
		if (normalized.includes('insert into jobs') && normalized.includes('returning')) {
			return {
				rows: [
					{
						id: 99,
						title: params[0] || 'Test Job',
						company: params[1] || 'Test Company',
						location: params[2] || 'Remote',
						description: params[3] || 'Test description',
						salary_min: params[4] || 50000,
						salary_max: params[5] || 100000,
						job_type: params[6] || 'full-time',
					},
				],
				rowCount: 1,
			};
		}

		// Jobs routes: COUNT jobs
		if (normalized.includes('count(*)') && normalized.includes('from jobs')) {
			return { rows: [{ count: '1' }], rowCount: 1 };
		}

		// Fallback: empty result
		return { rows: [], rowCount: 0 };
	});

	return {
		query: mockQuery,
		getQueryStats: () => ({ totalQueries: 0, slowQueries: 0, queriesPerMinute: 0 }),
		end: jest.fn().mockResolvedValue(undefined),
		on: jest.fn(),
	};
});

// ─── Mock other server-side modules ─────────────────────────────────────────

jest.mock('../../lib/email-service', () => {
	const actual = jest.requireActual('../../lib/email-service');
	return {
		...actual,
		sendTemplatedEmail: jest
			.fn()
			.mockResolvedValue({ success: true, messageId: 'test-welcome-id' }),
		sendCustomEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'test-custom-id' }),
		queueEmail: jest.fn().mockResolvedValue({ success: true, queueId: 1 }),
		sendEmailAsync: jest.fn().mockResolvedValue({ success: true }),
		verifyConnection: jest.fn().mockResolvedValue({ success: true }),
		initializeTransporter: jest.fn().mockReturnValue(true),
	};
});

jest.mock('../../lib/distributed-rate-limiter', () => {
	const rateLimitMiddleware = jest.fn((_req, _res, next) => next());
	class DistributedRateLimiter {
		async checkLimit() {
			return { allowed: true, count: 1, retryAfter: 0 };
		}
		startCleanup() {}
	}
	return {
		createRateLimit: jest.fn(() => rateLimitMiddleware),
		DistributedRateLimiter,
		rateLimits: {
			strict: rateLimitMiddleware,
			standard: rateLimitMiddleware,
			ai: rateLimitMiddleware,
			public: rateLimitMiddleware,
			admin: rateLimitMiddleware,
		},
		distributedRateLimiter: {
			checkLimit: jest.fn().mockResolvedValue({ allowed: true, count: 1, retryAfter: 0 }),
			startCleanup: jest.fn(),
		},
	};
});

jest.mock('../../lib/metrics-collector', () => {
	return {
		setHttpServer: jest.fn(),
		metricsMiddleware: jest.fn((_req, _res, next) => next()),
		requestLogger: jest.fn((_req, _res, next) => next()),
	};
});

// Mock isomorphic-dompurify to avoid ESM parsing issues in Jest
jest.mock('isomorphic-dompurify', () => {
	return jest.fn((html) => html);
});

// ─── Environment ────────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = require('node:crypto').randomBytes(64).toString('hex');
process.env.SESSION_SECRET = require('node:crypto').randomBytes(64).toString('hex');
process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
process.env.FRONTEND_URL = 'http://localhost:5173';

jest.setTimeout(15000);
