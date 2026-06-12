const request = require('supertest')
const app = require('../../../server')

describe('Authentication API', () => {
  describe('POST /api/auth/register', () => {
    it('creates a new user with valid data', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
          name: 'Test User',
          role: 'candidate'
        })

      expect(res.status).toBe(201)
      expect(res.body).toHaveProperty('token')
      expect(res.body.user).toHaveProperty('id')
      expect(res.body.user.email).toBe('test@example.com')
      expect(res.body.user).not.toHaveProperty('password')
    })

    it('rejects duplicate email', async () => {
      // First registration
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'Password123!',
          name: 'Test User',
          role: 'candidate'
        })

      // Duplicate registration
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'Password123!',
          name: 'Test User 2',
          role: 'candidate'
        })

      expect(res.status).toBe(400)
      expect(res.body).toHaveProperty('error')
    })

    it('validates required fields', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com'
          // missing password, name, role
        })

      expect(res.status).toBe(400)
      expect(res.body).toHaveProperty('error')
    })
  })

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // Create a test user
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'login-test@example.com',
          password: 'Password123!',
          name: 'Login Test',
          role: 'candidate'
        })
    })

    it('returns token with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'login-test@example.com',
          password: 'Password123!'
        })

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('token')
      expect(res.body).toHaveProperty('user')
    })

    it('returns 401 with invalid password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'login-test@example.com',
          password: 'wrongpassword'
        })

      expect(res.status).toBe(401)
    })

    it('returns 401 with non-existent email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'Password123!'
        })

      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/auth/me', () => {
    it('returns user data with valid token', async () => {
      // Register and login
      const registerRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'me-test@example.com',
          password: 'Password123!',
          name: 'Me Test',
          role: 'candidate'
        })

      const token = registerRes.body.token

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('id')
      expect(res.body.email).toBe('me-test@example.com')
    })

    it('returns 401 without token', async () => {
      const res = await request(app)
        .get('/api/auth/me')

      expect(res.status).toBe(401)
    })
  })
})
