const request = require('supertest');
const app = require('../../../server');

const TEST_PASSWORD = process.env.TEST_PASSWORD || 'Password123!';

describe('Authentication API', () => {
	describe('POST /api/auth/register', () => {
		it('creates a new user with valid data', async () => {
			const res = await request(app).post('/api/auth/register').send({
				email: 'test@example.com',
				password: TEST_PASSWORD,
				name: 'Test User',
				role: 'candidate',
			});

			expect(res.status).toBe(201);
			expect(res.body).toHaveProperty('token');
			expect(res.body.user).toHaveProperty('id');
			expect(res.body.user.email).toBe('test@example.com');
			expect(res.body.user).not.toHaveProperty('password');
		});

		it('rejects duplicate email with secure response', async () => {
			// First registration
			await request(app).post('/api/auth/register').send({
				email: 'duplicate@example.com',
				password: TEST_PASSWORD,
				name: 'Test User',
				role: 'candidate',
			});

			// Duplicate registration returns 200 to prevent email enumeration
			const res = await request(app).post('/api/auth/register').send({
				email: 'duplicate@example.com',
				password: TEST_PASSWORD,
				name: 'Test User 2',
				role: 'candidate',
			});

			expect(res.status).toBe(200);
			expect(res.body).toHaveProperty('success', true);
			expect(res.body.message).toMatch(/confirmation/i);
		});

		it('validates required fields', async () => {
			const res = await request(app).post('/api/auth/register').send({
				email: 'test@example.com',
				// missing password, name, role
			});

			expect(res.status).toBe(400);
			expect(res.body).toHaveProperty('error');
		});
	});

	describe('POST /api/auth/login', () => {
		beforeEach(async () => {
			// Create a test user
			await request(app).post('/api/auth/register').send({
				email: 'login-test@example.com',
				password: TEST_PASSWORD,
				name: 'Login Test',
				role: 'candidate',
			});
		});

		it('returns token with valid credentials', async () => {
			const res = await request(app).post('/api/auth/login').send({
				email: 'login-test@example.com',
				password: TEST_PASSWORD,
			});

			expect(res.status).toBe(200);
			expect(res.body).toHaveProperty('token');
			expect(res.body).toHaveProperty('user');
		});

		it('returns 401 with invalid password', async () => {
			const res = await request(app).post('/api/auth/login').send({
				email: 'login-test@example.com',
				password: 'wrongpassword',
			});

			expect(res.status).toBe(401);
		});

		it('returns 401 with non-existent email', async () => {
			const res = await request(app).post('/api/auth/login').send({
				email: 'nonexistent@example.com',
				password: TEST_PASSWORD,
			});

			expect(res.status).toBe(401);
		});
	});

	describe('GET /api/auth/me', () => {
		it('returns user data with valid token', async () => {
			// Register and login
			const registerRes = await request(app).post('/api/auth/register').send({
				email: 'me-test@example.com',
				password: TEST_PASSWORD,
				name: 'Me Test',
				role: 'candidate',
			});

			const token = registerRes.body.token;

			const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

			expect(res.status).toBe(200);
			expect(res.body).toHaveProperty('user');
			expect(res.body.user).toHaveProperty('id');
			expect(res.body.user.email).toBe('me-test@example.com');
		});

		it('returns 401 without token', async () => {
			const res = await request(app).get('/api/auth/me');

			expect(res.status).toBe(401);
		});
	});

	describe('POST /api/auth/password', () => {
		const oldPw = 'OldPass123!';
		const newPw = 'NewPass123!';

		async function registerAndLogin(email, password) {
			await request(app).post('/api/auth/register').send({
				email,
password,
				name: 'PW Test',
				role: 'candidate',
			});
			const loginRes = await request(app).post('/api/auth/login').send({ email, password });
			expect(loginRes.status).toBe(200);
			return loginRes.body.token;
		}

		it('changes password, keeps the session alive, kills the old password', async () => {
			const email = 'pwchange1@example.com';
			const token = await registerAndLogin(email, oldPw);

			const res = await request(app)
				.post('/api/auth/password')
				.set('Authorization', `Bearer ${token}`)
				.send({ currentPassword: oldPw, newPassword: newPw });

			expect(res.status).toBe(200);
			expect(res.body).toHaveProperty('accessToken');
			expect(res.body).toHaveProperty('refreshToken');

			// New password works
			const loginNew = await request(app).post('/api/auth/login').send({ email, password: newPw });
			expect(loginNew.status).toBe(200);

			// Old password no longer works
			const loginOld = await request(app).post('/api/auth/login').send({ email, password: oldPw });
			expect(loginOld.status).toBe(401);
		});

		it('rejects wrong current password', async () => {
			const email = 'pwchange2@example.com';
			const token = await registerAndLogin(email, oldPw);

			const res = await request(app)
				.post('/api/auth/password')
				.set('Authorization', `Bearer ${token}`)
				.send({ currentPassword: 'WrongPass123!', newPassword: newPw });

			expect(res.status).toBe(401);
		});

		it('rejects weak new password', async () => {
			const email = 'pwchange3@example.com';
			const token = await registerAndLogin(email, oldPw);

			const res = await request(app)
				.post('/api/auth/password')
				.set('Authorization', `Bearer ${token}`)
				.send({ currentPassword: oldPw, newPassword: 'short' });

			expect(res.status).toBe(400);
		});

		it('rejects requests without authentication', async () => {
			// No Bearer token and no CSRF token: the CSRF gate rejects first (403).
			// A bad Bearer token reaches authMiddleware and gets 401.
			const noToken = await request(app)
				.post('/api/auth/password')
				.send({ currentPassword: oldPw, newPassword: newPw });
			expect(noToken.status).toBe(403);

			const badToken = await request(app)
				.post('/api/auth/password')
				.set('Authorization', 'Bearer invalid')
				.send({ currentPassword: oldPw, newPassword: newPw });
			expect(badToken.status).toBe(401);
		});
	});

	describe('DELETE /api/auth/delete-account', () => {
		const pw = 'DeleteMe123!';

		async function registerAndLogin(email) {
			await request(app).post('/api/auth/register').send({
				email,
				password: pw,
				name: 'Delete Test',
				role: 'candidate',
			});
			const loginRes = await request(app).post('/api/auth/login').send({ email, password: pw });
			expect(loginRes.status).toBe(200);
			return loginRes.body.token;
		}

		it('deletes the account and blocks login and token use afterwards', async () => {
			const email = 'deleteme1@example.com';
			const token = await registerAndLogin(email);

			const res = await request(app)
				.delete('/api/auth/delete-account')
				.set('Authorization', `Bearer ${token}`)
				.send({ password: pw });

			expect(res.status).toBe(200);
			expect(res.body).toHaveProperty('success', true);

			// Login with the old credentials fails
			const loginRes = await request(app).post('/api/auth/login').send({ email, password: pw });
			expect(loginRes.status).toBe(401);

			// The old access token is rejected (soft-deleted account)
			const meRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
			expect(meRes.status).toBe(401);
		});

		it('requires password confirmation when a password is set', async () => {
			const email = 'deleteme2@example.com';
			const token = await registerAndLogin(email);

			const res = await request(app)
				.delete('/api/auth/delete-account')
				.set('Authorization', `Bearer ${token}`)
				.send({});

			expect(res.status).toBe(400);
		});

		it('rejects wrong password', async () => {
			const email = 'deleteme3@example.com';
			const token = await registerAndLogin(email);

			const res = await request(app)
				.delete('/api/auth/delete-account')
				.set('Authorization', `Bearer ${token}`)
				.send({ password: 'WrongPass123!' });

			expect(res.status).toBe(401);

			// Account still usable
			const loginRes = await request(app).post('/api/auth/login').send({ email, password: pw });
			expect(loginRes.status).toBe(200);
		});

		it('rejects requests without authentication', async () => {
			// No Bearer token and no CSRF token: the CSRF gate rejects first (403).
			// A bad Bearer token reaches authMiddleware and gets 401.
			const noToken = await request(app).delete('/api/auth/delete-account').send({ password: pw });
			expect(noToken.status).toBe(403);

			const badToken = await request(app)
				.delete('/api/auth/delete-account')
				.set('Authorization', 'Bearer invalid')
				.send({ password: pw });
			expect(badToken.status).toBe(401);
		});
	});
});
