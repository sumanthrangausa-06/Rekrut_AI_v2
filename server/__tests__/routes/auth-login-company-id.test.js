/**
 * @jest-environment node
 *
 * Issue #1258 — POST /auth/login response should include company_id
 * (defence-in-depth follow-up to #1223 / PR #1257).
 *
 * GET /auth/me derives company_id from users.company_id (authMiddleware
 * SELECT * FROM users), and POST /auth/register already returns
 * company_id: user.company_id. The login handler also SELECTs * FROM users
 * but dropped the field from its response user object, so client flows that
 * trusted the login payload verbatim misclassified company owners as
 * pending-approval (#1223).
 *
 * Regression: login payload company_id must match users.company_id for
 * employer/recruiter, and must be null (present-and-null, consistent with
 * /auth/me and register) for candidates — never a wrong company's id.
 *
 * Runs against pg-mem so the REAL login SQL executes, following the
 * oauth-exchange.test.js pattern.
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

const TEST_PASSWORD = 'LoginCompanyId1!';

async function createUser(email, role, companyId) {
	const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
	const result = await pool.query(
		`INSERT INTO users (email, name, role, password_hash, company_id)
		 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
		[email, 'Login CompanyId User', role, passwordHash, companyId],
	);
	return result.rows[0];
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

describe('POST /api/auth/login — company_id in response (Issue #1258)', () => {
	it('employer login payload company_id matches users.company_id', async () => {
		const user = await createUser('employer-1258@test.dev', 'employer', 42);

		const res = await request(app)
			.post('/api/auth/login')
			.send({ email: 'employer-1258@test.dev', password: TEST_PASSWORD });

		expect(res.status).toBe(200);
		expect(res.body.user).toHaveProperty('company_id');
		expect(res.body.user.company_id).toBe(42);
		expect(res.body.user.company_id).toBe(user.company_id);
	});

	it('recruiter login payload company_id matches users.company_id', async () => {
		const user = await createUser('recruiter-1258@test.dev', 'recruiter', 7);

		const res = await request(app)
			.post('/api/auth/login')
			.send({ email: 'recruiter-1258@test.dev', password: TEST_PASSWORD });

		expect(res.status).toBe(200);
		expect(res.body.user).toHaveProperty('company_id');
		expect(res.body.user.company_id).toBe(7);
		expect(res.body.user.company_id).toBe(user.company_id);
	});

	it('candidate login payload carries company_id null — no wrong company id', async () => {
		const user = await createUser('candidate-1258@test.dev', 'candidate', null);
		expect(user.company_id).toBeNull();

		const res = await request(app)
			.post('/api/auth/login')
			.send({ email: 'candidate-1258@test.dev', password: TEST_PASSWORD });

		expect(res.status).toBe(200);
		// Present-and-null, consistent with GET /auth/me and POST /auth/register
		// for a user whose users.company_id is null.
		expect(res.body.user).toHaveProperty('company_id');
		expect(res.body.user.company_id).toBeNull();
	});

	it('recruiter with no company yet login payload carries company_id null', async () => {
		await createUser('pending-1258@test.dev', 'recruiter', null);

		const res = await request(app)
			.post('/api/auth/login')
			.send({ email: 'pending-1258@test.dev', password: TEST_PASSWORD });

		expect(res.status).toBe(200);
		expect(res.body.user).toHaveProperty('company_id');
		expect(res.body.user.company_id).toBeNull();
	});
});
