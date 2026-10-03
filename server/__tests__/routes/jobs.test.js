const request = require('supertest');
const app = require('../../../server');

describe('Job Search API', () => {
	describe('GET /api/jobs', () => {
		it('returns paginated job listings', async () => {
			const res = await request(app).get('/api/jobs').query({ page: 1, limit: 10 });

			expect(res.status).toBe(200);
			expect(res.body).toHaveProperty('jobs');
			expect(res.body).toHaveProperty('total');
			expect(res.body).toHaveProperty('page');
			expect(Array.isArray(res.body.jobs)).toBe(true);
		});

		it('filters by location', async () => {
			const res = await request(app)
				.get('/api/jobs')
				.query({ location: 'San Francisco', page: 1, limit: 10 });

			expect(res.status).toBe(200);
			expect(res.body.jobs).toBeDefined();
		});

		it('filters by salary range', async () => {
			const res = await request(app)
				.get('/api/jobs')
				.query({ min_salary: 50000, max_salary: 150000, page: 1, limit: 10 });

			expect(res.status).toBe(200);
			expect(res.body.jobs).toBeDefined();
		});

		it('filters by job type', async () => {
			const res = await request(app)
				.get('/api/jobs')
				.query({ job_type: 'full-time', page: 1, limit: 10 });

			expect(res.status).toBe(200);
			expect(res.body.jobs).toBeDefined();
		});

		it('returns 400 for invalid page parameter', async () => {
			const res = await request(app).get('/api/jobs').query({ page: 'invalid', limit: 10 });

			expect(res.status).toBe(400);
		});
	});

	describe('GET /api/jobs/:id', () => {
		it('returns job details for valid ID', async () => {
			const res = await request(app).get('/api/jobs/1');

			expect(res.status).toBe(200);
			expect(res.body).toHaveProperty('job');
			expect(res.body.job).toHaveProperty('id', 1);
			expect(res.body.job).toHaveProperty('title', 'Test Job');
		});

		it('returns 404 for non-existent job', async () => {
			const res = await request(app).get('/api/jobs/99999');

			expect(res.status).toBe(404);
		});
	});
});
