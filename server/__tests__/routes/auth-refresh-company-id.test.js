/**
 * @jest-environment node
 *
 * Issue #1276 — POST /auth/refresh response should include company_id
 * (defence-in-depth follow-up to #1258 / PR #1275, whose independent
 * security reviewer flagged this residual).
 *
 * POST /auth/login (routes/auth.js, fixed in #1258), POST /auth/register
 * and GET /auth/me all derive company_id from users.company_id. The
 * refresh handler returns result.user from rotateRefreshToken
 * (lib/auth.js) verbatim, and that function neither selected
 * u.company_id in its refresh_tokens JOIN nor included it in its user
 * object — so a client flow trusting the refresh payload verbatim
 * could re-introduce the #1223 misrouting class after token rotation.
 *
 * Regression: refresh payload company_id must match users.company_id
 * for employer/recruiter, and must be null (present-and-null,
 * consistent with login / /auth/me / register) for candidates — never
 * a wrong company's id, and never a value taken from the request body.
 *
 * Runs against pg-mem so the REAL refresh SQL executes, following the
 * auth-login-company-id.test.js / oauth-exchange.test.js pattern.
 * Each case logs in first (real login SQL + real bcrypt) to mint a
 * real refresh token, then exercises POST /api/auth/refresh with it.
 */

jest.mock('../../../lib/db', () => {
	// NOTE: jest.mock factories cannot reference outer variables — require inline.
	const { newDb } = require('pg-mem');
	const db = newDb();
	const { Pool } = db.adapters.createPg();
	return new Pool();
});

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const pool = require('../../../lib/db');
const authRouter = require('../../../routes/auth');

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	req.session = {};
	next();
});
app.use('/api/auth', authRouter);

const TEST_PASSWORD = 'RefreshCompanyId1!';

async function createUser(email, role, companyId) {
	const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
	const result = await pool.query(
		`INSERT INTO users (email, name, role, password_hash, company_id)
		 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
		[email, 'Refresh CompanyId User', role, passwordHash, companyId],
	);
	return result.rows[0];
}

async function loginAndRefresh(email, extraBody = {}) {
	const loginRes = await request(app)
		.post('/api/auth/login')
		.send({ email, password: TEST_PASSWORD });
	expect(loginRes.status).toBe(200);
	expect(typeof loginRes.body.refreshToken).toBe('string');

	return request(app)
		.post('/api/auth/refresh')
		.send({ refreshToken: loginRes.body.refreshToken, ...extraBody });
}

beforeAll(async () => {
	await pool.query(`
		CREATE TABLE users (
			id SERIAL PRIMARY KEY,
			email VARCHAR(255) UNIQUE NOT NULL,
			name VARCHAR(255),
			role VARCHAR(50) DEFAULT 'candidate',
			password_hash VARCHAR(255),
			company_id INTEGER,
			is_paid BOOLEAN DEFAULT false,
			avatar_url VARCHAR(255),
			suspended_at TIMESTAMP WITH TIME ZONE,
			deleted_at TIMESTAMP WITH TIME ZONE,
			created_at TIMESTAMP DEFAULT NOW()
		)
	`);
	await pool.query(`
		CREATE TABLE refresh_tokens (
			id SERIAL PRIMARY KEY,
			user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
			token_hash VARCHAR(255) NOT NULL UNIQUE,
			family_id VARCHAR(100) NOT NULL,
			is_revoked BOOLEAN DEFAULT false,
			expires_at TIMESTAMP NOT NULL,
			created_at TIMESTAMP DEFAULT NOW(),
			last_used_at TIMESTAMP
		)
	`);
});

describe('POST /api/auth/refresh — company_id in response (Issue #1276)', () => {
	it('employer refresh payload company_id matches users.company_id', async () => {
		const user = await createUser('employer-1276@test.dev', 'employer', 42);

		const res = await loginAndRefresh('employer-1276@test.dev');

		expect(res.status).toBe(200);
		expect(res.body.user).toHaveProperty('company_id');
		expect(res.body.user.company_id).toBe(42);
		expect(res.body.user.company_id).toBe(user.company_id);
	});

	it('recruiter refresh payload company_id matches users.company_id', async () => {
		const user = await createUser('recruiter-1276@test.dev', 'recruiter', 7);

		const res = await loginAndRefresh('recruiter-1276@test.dev');

		expect(res.status).toBe(200);
		expect(res.body.user).toHaveProperty('company_id');
		expect(res.body.user.company_id).toBe(7);
		expect(res.body.user.company_id).toBe(user.company_id);
	});

	it('candidate refresh payload carries company_id null — no wrong company id', async () => {
		const user = await createUser('candidate-1276@test.dev', 'candidate', null);
		expect(user.company_id).toBeNull();

		const res = await loginAndRefresh('candidate-1276@test.dev');

		expect(res.status).toBe(200);
		// Present-and-null, consistent with login, GET /auth/me and
		// POST /auth/register for a user whose users.company_id is null.
		expect(res.body.user).toHaveProperty('company_id');
		expect(res.body.user.company_id).toBeNull();
	});

	it('recruiter with no company yet refresh payload carries company_id null', async () => {
		await createUser('pending-1276@test.dev', 'recruiter', null);

		const res = await loginAndRefresh('pending-1276@test.dev');

		expect(res.status).toBe(200);
		expect(res.body.user).toHaveProperty('company_id');
		expect(res.body.user.company_id).toBeNull();
	});

	it('refresh payload ignores a forged company_id in the request body', async () => {
		await createUser('forged-1276@test.dev', 'employer', 42);

		const res = await loginAndRefresh('forged-1276@test.dev', { company_id: 999 });

		expect(res.status).toBe(200);
		expect(res.body.user.company_id).toBe(42);
	});
});
