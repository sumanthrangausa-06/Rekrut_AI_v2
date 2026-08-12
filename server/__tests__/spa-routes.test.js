const request = require('supertest')
const app = require('../../server')
const fs = require('node:fs')
const path = require('node:path')

describe('SPA Fallback Routes (Issue #106)', () => {
	describe('Known SPA routes return 200', () => {
		const knownRoutes = [
			// Public
			{ path: '/', description: 'landing page' },
			{ path: '/login', description: 'login page' },
			{ path: '/register', description: 'register page' },
			{ path: '/forgot-password', description: 'forgot password' },
			{ path: '/reset-password', description: 'reset password' },
			{ path: '/test-camera', description: 'test camera' },
			{ path: '/pricing', description: 'pricing' },
			{ path: '/payment-success', description: 'payment success' },
			{ path: '/screening/abc123', description: 'screening with token' },
			{ path: '/blog', description: 'blog list' },
			{ path: '/blog/my-post', description: 'blog post' },
			{ path: '/about', description: 'about' },
			{ path: '/contact', description: 'contact' },
			{ path: '/privacy', description: 'privacy' },
			{ path: '/terms', description: 'terms' },
			{ path: '/company/acme', description: 'public company' },
			{ path: '/careers/acme', description: 'careers page' },
			{ path: '/recruiter-register', description: 'recruiter register' },
			{ path: '/employee-payroll', description: 'employee payroll' },
			{ path: '/dashboard', description: 'dashboard redirect' },

			// Candidate
			{ path: '/candidate', description: 'candidate dashboard' },
			{ path: '/candidate/jobs', description: 'candidate jobs' },
			{ path: '/candidate/jobs/42', description: 'candidate job detail' },
			{ path: '/candidate/applications', description: 'candidate applications' },
			{ path: '/candidate/profile', description: 'candidate profile' },
			{ path: '/candidate/assessments', description: 'candidate assessments' },
			{ path: '/candidate/assessments/42/take', description: 'assessment take' },
			{ path: '/candidate/assessments/42/results', description: 'assessment results' },
			{ path: '/candidate/assessment-results', description: 'assessment results list' },
			{ path: '/candidate/job-assessment/42', description: 'job assessment' },
			{ path: '/candidate/interviews', description: 'candidate interviews' },
			{ path: '/candidate/ai-coaching', description: 'AI coaching' },
			{ path: '/candidate/omniscore', description: 'omniscore' },
			{ path: '/candidate/documents', description: 'documents' },
			{ path: '/candidate/interview-practice', description: 'interview practice' },
			{ path: '/candidate/video-interview', description: 'video interview' },
			{ path: '/candidate/interview-analysis', description: 'interview analysis' },
			{ path: '/candidate/history', description: 'history' },
			{ path: '/candidate/feedback', description: 'feedback' },
			{ path: '/candidate/saved-jobs', description: 'saved jobs' },
			{ path: '/candidate/top-matches', description: 'top matches' },
			{ path: '/candidate/company-matches', description: 'company matches' },
			{ path: '/candidate/ai-search', description: 'AI search' },
			{ path: '/candidate/cv-review', description: 'CV review' },
			{ path: '/candidate/linkedin-optimizer', description: 'LinkedIn optimizer' },
			{ path: '/candidate/career-diagnosis', description: 'career diagnosis' },
			{ path: '/candidate/offers/manage', description: 'offer management' },
			{ path: '/candidate/company-profile', description: 'company profile' },
			{ path: '/candidate/interview', description: 'interview' },
			{ path: '/candidate/chat', description: 'chat' },
			{ path: '/candidate/offers', description: 'offers' },
			{ path: '/candidate/onboarding', description: 'onboarding' },
			{ path: '/candidate/payroll', description: 'payroll' },
			{ path: '/candidate/settings', description: 'candidate settings (redirect)' },

			// Recruiter pending
			{ path: '/recruiter/pending-approval', description: 'pending approval' },

			// Recruiter
			{ path: '/recruiter', description: 'recruiter dashboard' },
			{ path: '/recruiter/jobs', description: 'recruiter jobs' },
			{ path: '/recruiter/jobs/new', description: 'new job' },
			{ path: '/recruiter/jobs/42/applicants', description: 'job applicants' },
			{ path: '/recruiter/jobs/42/edit', description: 'job edit' },
			{ path: '/recruiter/jobs/42', description: 'job detail' },
			{ path: '/recruiter/jobs/42/assessment', description: 'job assessment' },
			{ path: '/recruiter/applications', description: 'recruiter applications' },
			{ path: '/recruiter/assessments', description: 'recruiter assessments' },
			{ path: '/recruiter/candidates', description: 'recruiter candidates' },
			{ path: '/recruiter/screening', description: 'recruiter screening' },
			{ path: '/recruiter/chat', description: 'recruiter chat' },
			{ path: '/recruiter/career-page', description: 'career page' },
			{ path: '/recruiter/interviews', description: 'recruiter interviews' },
			{ path: '/recruiter/offers', description: 'recruiter offers' },
			{ path: '/recruiter/onboarding', description: 'recruiter onboarding' },
			{ path: '/recruiter/analytics', description: 'analytics' },
			{ path: '/recruiter/communications', description: 'communications' },
			{ path: '/recruiter/trustscore', description: 'trustscore' },
			{ path: '/recruiter/onboarding-ai', description: 'onboarding AI' },
			{ path: '/recruiter/onboarding-docs', description: 'onboarding docs' },
			{ path: '/recruiter/company', description: 'company' },
			{ path: '/recruiter/team', description: 'team' },
			{ path: '/recruiter/team/join-requests', description: 'join requests' },
			{ path: '/recruiter/profile', description: 'recruiter profile' },
			{ path: '/recruiter/payroll', description: 'recruiter payroll' },
			{ path: '/recruiter/payroll-dashboard', description: 'payroll dashboard' },
			{ path: '/recruiter/payroll-run/42', description: 'payroll run' },
			{ path: '/recruiter/job-create', description: 'job create' },
			{ path: '/recruiter/omniscore', description: 'recruiter omniscore' },
			{ path: '/recruiter/post-hire-feedback', description: 'post-hire feedback' },
			{ path: '/recruiter/compliance', description: 'compliance' },

			// Settings
			{ path: '/settings', description: 'settings' },

			// Signature
			{ path: '/signature/doc-1/req-1', description: 'signature' },

			// Debug
			{ path: '/debug/mock-interview', description: 'debug mock interview' },

			// Admin
			{ path: '/admin/login', description: 'admin login' },
			{ path: '/admin-login', description: 'admin login (legacy)' },
			{ path: '/admin', description: 'admin' },
			{ path: '/admin/dashboard', description: 'admin dashboard' },
			{ path: '/admin/revenue', description: 'admin revenue' },
			{ path: '/admin/ai-health', description: 'admin AI health' },
			{ path: '/admin/agents', description: 'admin agents' },
			{ path: '/admin/compliance', description: 'admin compliance' },
			{ path: '/admin/eu-ai-act', description: 'admin EU AI act' },
			{ path: '/admin/agent-dashboard', description: 'admin agent dashboard' },
			{ path: '/admin/analytics', description: 'admin analytics' },
			{ path: '/admin/email-queue', description: 'admin email queue' },
		]

		it.each(knownRoutes)('returns 200 for $description ($path)', async ({ path }) => {
			const res = await request(app).get(path)
			expect(res.status).toBe(200)
			expect(res.text).toContain('<!DOCTYPE html>')
		})
	})

	describe('Unknown routes return 404', () => {
		const unknownRoutes = [
			{ path: '/this-does-not-exist', description: 'random path' },
			{ path: '/foo/bar/baz', description: 'deep random path' },
			{ path: '/candidate/nonexistent', description: 'unknown candidate subpath' },
			{ path: '/recruiter/nonexistent', description: 'unknown recruiter subpath' },
			{ path: '/admin/nonexistent', description: 'unknown admin subpath' },
			{ path: '/company', description: 'company without slug' },
			{ path: '/careers', description: 'careers without company' },
			{ path: '/screening', description: 'screening without token' },
			{ path: '/blog/', description: 'blog with trailing slash (no slug)' },
			{ path: '/signature', description: 'signature without params' },
			{ path: '/signature/only-one', description: 'signature with one param' },
		]

		it.each(unknownRoutes)('returns 404 for $description ($path)', async ({ path }) => {
			const res = await request(app).get(path)
			expect(res.status).toBe(404)
			expect(res.text).toContain('<!DOCTYPE html>')
		})
	})

	describe('API 404s return JSON 404', () => {
		it('returns JSON 404 for unknown API endpoints', async () => {
			const res = await request(app).get('/api/this-does-not-exist')
			expect(res.status).toBe(404)
			expect(res.body).toEqual({ error: 'API endpoint not found' })
		})

		it('returns JSON 404 for unknown API endpoints with nested paths', async () => {
			const res = await request(app).get('/api/foo/bar/baz')
			expect(res.status).toBe(404)
			expect(res.body).toEqual({ error: 'API endpoint not found' })
		})
	})

	describe('Static assets are served correctly', () => {
		it('serves an existing static asset from the build with 200', async () => {
			// Use a known asset from the build directory
			const assetDir = path.join(__dirname, '..', '..', 'client', 'dist', 'assets')
			const files = fs.readdirSync(assetDir)
			const jsFile = files.find((f) => f.endsWith('.js') && !f.endsWith('.br') && !f.endsWith('.gz'))
			expect(jsFile).toBeTruthy()

			const res = await request(app).get(`/assets/${jsFile}`)
			expect(res.status).toBe(200)
			expect(res.headers['content-type']).toMatch(/javascript/)
		})

		it('returns 404 SPA fallback for non-existent asset paths', async () => {
			const res = await request(app).get('/assets/this-does-not-exist-12345.js')
			expect(res.status).toBe(404)
			expect(res.text).toContain('<!DOCTYPE html>')
		})
	})
})
