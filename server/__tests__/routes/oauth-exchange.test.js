/**
 * OAuth one-time exchange code — integration tests.
 *
 * Covers the fix for the OAuth login bounce (backend minted tokens into the
 * session cookie; the SPA only reads localStorage): the callback now mints a
 * single-use code, redirects to {dest}?oauth_code=<code>, and the frontend
 * trades it for tokens via POST /api/auth/oauth/exchange.
 *
 * Runs against pg-mem (in-memory Postgres) so the REAL SQL executes: the real
 * migration 230 creates oauth_exchange_codes, and the real
 * mintOAuthExchangeCode + exchange endpoint are exercised end to end.
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
const pool = require('../../../lib/db');
const authRouter = require('../../../routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

async function createUser(email) {
	const result = await pool.query(
		`INSERT INTO users (email, name, role) VALUES ($1, $2, 'candidate') RETURNING *`,
		[email, 'OAuth Test User'],
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
			company_id INTEGER,
			suspended_at TIMESTAMP WITH TIME ZONE,
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
	// Run the REAL migration under test
	const migration = require('../../../migrations/230_oauth_exchange_codes.js');
	await migration.up({ query: (sql, params) => pool.query(sql, params) });
});

beforeEach(async () => {
	await pool.query('DELETE FROM oauth_exchange_codes');
	await pool.query('DELETE FROM refresh_tokens');
});

describe('POST /api/auth/oauth/exchange', () => {
	it('exchanges a valid code for tokens and deletes the row (single-use)', async () => {
		const user = await createUser('oauth-exchange-1@test.dev');
		const code = await authRouter.mintOAuthExchangeCode(user, '/candidate');

		const res = await request(app).post('/api/auth/oauth/exchange').send({ code });

		expect(res.status).toBe(200);
		expect(typeof res.body.accessToken).toBe('string');
		expect(typeof res.body.refreshToken).toBe('string');
		expect(res.body.dest).toBe('/candidate');

		// Single-use: the row must be gone, so the tokens cannot be re-issued
		const remaining = await pool.query('SELECT * FROM oauth_exchange_codes');
		expect(remaining.rows.length).toBe(0);
	});

	it('issued access token authenticates /auth/me (the original bounce)', async () => {
		const user = await createUser('oauth-exchange-2@test.dev');
		const code = await authRouter.mintOAuthExchangeCode(user, '/candidate');

		const exchanged = await request(app).post('/api/auth/oauth/exchange').send({ code });
		expect(exchanged.status).toBe(200);

		const me = await request(app)
			.get('/api/auth/me')
			.set('Authorization', `Bearer ${exchanged.body.accessToken}`);
		expect(me.status).toBe(200);
		expect(me.body.user.email).toBe('oauth-exchange-2@test.dev');
	});

	it('rejects replay of an already-used code', async () => {
		const user = await createUser('oauth-exchange-3@test.dev');
		const code = await authRouter.mintOAuthExchangeCode(user, '/candidate');

		const first = await request(app).post('/api/auth/oauth/exchange').send({ code });
		expect(first.status).toBe(200);

		const second = await request(app).post('/api/auth/oauth/exchange').send({ code });
		expect(second.status).toBe(410);
		expect(second.body.error).toMatch(/invalid or expired/i);
	});

	it('rejects unknown and malformed codes without a validity oracle', async () => {
		const unknown = await request(app)
			.post('/api/auth/oauth/exchange')
			.send({ code: 'a'.repeat(64) });
		expect(unknown.status).toBe(410);

		const malformed = await request(app)
			.post('/api/auth/oauth/exchange')
			.send({ code: 'too-short' });
		expect(malformed.status).toBe(401);

		const missing = await request(app).post('/api/auth/oauth/exchange').send({});
		expect(missing.status).toBe(401);
	});

	it('rejects expired codes', async () => {
		const user = await createUser('oauth-exchange-4@test.dev');
		const code = await authRouter.mintOAuthExchangeCode(user, '/candidate');

		// Age the row past its 5-minute TTL
		const crypto = require('node:crypto');
		const codeHash = crypto.createHash('sha256').update(code).digest('hex');
		await pool.query(
			`UPDATE oauth_exchange_codes SET expires_at = NOW() - INTERVAL '1 hour' WHERE code_hash = $1`,
			[codeHash],
		);

		const res = await request(app).post('/api/auth/oauth/exchange').send({ code });
		expect(res.status).toBe(410);
	});

	it('concurrent double exchange yields exactly one success (race safety)', async () => {
		const user = await createUser('oauth-exchange-5@test.dev');
		const code = await authRouter.mintOAuthExchangeCode(user, '/candidate');

		const [a, b] = await Promise.all([
			request(app).post('/api/auth/oauth/exchange').send({ code }),
			request(app).post('/api/auth/oauth/exchange').send({ code }),
		]);
		const statuses = [a.status, b.status].sort();
		expect(statuses).toEqual([200, 410]);
	});

	it('preserves a dest that already has query params', async () => {
		const user = await createUser('oauth-exchange-6@test.dev');
		const dest = '/recruiter?pending_approval=true';
		const code = await authRouter.mintOAuthExchangeCode(user, dest);

		const res = await request(app).post('/api/auth/oauth/exchange').send({ code });
		expect(res.status).toBe(200);
		expect(res.body.dest).toBe(dest);
	});

	it('is exempt from CSRF on the full server (no _csrf cookie/header needed)', async () => {
		// The exchange runs before any session exists (post-OAuth landing), so
		// it must not depend on the _csrf cookie — especially on iOS WebKit,
		// where cookie blocking started this whole saga.
		const server = require('../../../server');
		const user = await createUser('oauth-exchange-7@test.dev');
		const code = await authRouter.mintOAuthExchangeCode(user, '/candidate');

		const res = await request(server).post('/api/auth/oauth/exchange').send({ code });
		expect(res.status).toBe(200);
		expect(typeof res.body.accessToken).toBe('string');
	});
});
