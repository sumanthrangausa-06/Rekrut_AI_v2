const path = require('path');

// ─── Mock PostgreSQL pool ────────────────────────────────────────────────────
// We create a mock pool that returns sensible responses for the SQL queries
// used by the auth and jobs routes. This avoids requiring a real database.

const mockUsers = new Map(); // email -> user object
let nextUserId = 1;

function createMockQuery() {
	return jest.fn(async (sql, params) => {
		const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

		// ── Auth routes: SELECT user by email ──
		if (normalized.includes('select * from users where email =')) {
			const email = params[0];
			const user = mockUsers.get(email);
			if (user) {
				return {
					rows: [{
						id: user.id,
						email: user.email,
						name: user.name,
						role: user.role,
						password_hash: user.password_hash,
						company_id: user.company_id || null,
					}],
					rowCount: 1,
				};
			}
			return { rows: [], rowCount: 0 };
		}

		// ── Auth routes: SELECT user by ID ──
		if (normalized.includes('select id, email, name, role, company_id from users where id =')) {
			const userId = params[0];
			for (const user of mockUsers.values()) {
				if (user.id === userId) {
					return {
						rows: [{
							id: user.id,
							email: user.email,
							name: user.name,
							role: user.role,
							company_id: user.company_id || null,
						}],
						rowCount: 1,
					};
				}
			}
			return { rows: [], rowCount: 0 };
		}

		// ── Auth routes: INSERT user ──
		if (normalized.includes('insert into users') && normalized.includes('returning')) {
			const email = params.find((p, i) => {
				// Heuristic: email is the param at index 0 or 1 in INSERT
				return typeof p === 'string' && p.includes('@');
			}) || params[0];
			const newUser = {
				id: nextUserId++,
				email,
				name: params[1] || 'Test User',
				role: params[2] || 'candidate',
				password_hash: params[3] || '$2a$10$fakehash',
				company_id: null,
			};
			mockUsers.set(newUser.email, newUser);
			return {
				rows: [newUser],
				rowCount: 1,
			};
		}

		// ── Auth routes: refresh token insert ──
		if (normalized.includes('insert into refresh_tokens')) {
			return { rows: [], rowCount: 1 };
		}

		// ── Auth routes: events table insert (signup logging) ──
		if (normalized.includes('insert into events')) {
			return { rows: [], rowCount: 1 };
		}

		// ── Auth routes: SELECT refresh token ──
		if (normalized.includes('select rt.*, u.email, u.role, u.name from refresh_tokens')) {
			return { rows: [], rowCount: 0 };
		}

		// ── Auth routes: UPDATE refresh tokens ──
		if (normalized.includes('update refresh_tokens')) {
			return { rows: [], rowCount: 1 };
		}

		// ── Jobs routes: SELECT jobs (list) ──
		if (normalized.includes('from jobs') && normalized.includes('select')) {
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
			return {
				rows: jobs,
				rowCount: jobs.length,
			};
		}

		// ── Jobs routes: SELECT job by ID ──
		if (normalized.includes('from jobs') && normalized.includes('where j.id =')) {
			const jobId = params[0];
			return {
				rows: [{
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
				}],
				rowCount: 1,
			};
		}

		// ── Jobs routes: INSERT job ──
		if (normalized.includes('insert into jobs') && normalized.includes('returning')) {
			return {
				rows: [{
					id: 99,
					title: params[0] || 'Test Job',
					company: params[1] || 'Test Company',
					location: params[2] || 'Remote',
					description: params[3] || 'Test description',
					salary_min: params[4] || 50000,
					salary_max: params[5] || 100000,
					job_type: params[6] || 'full-time',
				}],
				rowCount: 1,
			};
		}

		// ── Jobs routes: COUNT jobs ──
		if (normalized.includes('count(*)') && normalized.includes('from jobs')) {
			return { rows: [{ count: '1' }], rowCount: 1 };
		}

		// ── Fallback: empty result ──
		return { rows: [], rowCount: 0 };
	});
}

jest.mock(path.resolve(__dirname, '../lib/db'), () => {
	const mockQuery = createMockQuery();
	return {
		query: mockQuery,
		getQueryStats: () => ({ totalQueries: 0, slowQueries: 0, queriesPerMinute: 0 }),
		end: jest.fn().mockResolvedValue(undefined),
		on: jest.fn(),
	};
});

// ─── Mock other server-side modules ─────────────────────────────────────────

jest.mock(path.resolve(__dirname, '../lib/email-service'), () => {
	return {
		sendEmail: jest.fn().mockResolvedValue({ messageId: 'test-message-id' }),
		sendVerificationEmail: jest.fn().mockResolvedValue({ messageId: 'test-verification-id' }),
		sendTemplatedEmail: jest.fn().mockResolvedValue({ messageId: 'test-welcome-id' }),
	};
});

jest.mock(path.resolve(__dirname, '../lib/distributed-rate-limiter'), () => {
	return {
		rateLimits: new Map(),
		distributedRateLimiter: {
			check: jest.fn().mockResolvedValue({ allowed: true }),
			startCleanup: jest.fn(),
		},
	};
});

jest.mock(path.resolve(__dirname, '../lib/metrics-collector'), () => {
	return {
		setHttpServer: jest.fn(),
		metricsMiddleware: jest.fn((_req, _res, next) => next()),
		requestLogger: jest.fn((_req, _res, next) => next()),
	};
});

jest.mock(path.resolve(__dirname, '../lib/metrics-dashboard'), () => {
	return jest.fn((_req, _res, next) => next());
});

// ─── Environment ────────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SESSION_SECRET = 'test-session-secret-for-integration-tests';
process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
process.env.FRONTEND_URL = 'http://localhost:5173';

jest.setTimeout(15000);