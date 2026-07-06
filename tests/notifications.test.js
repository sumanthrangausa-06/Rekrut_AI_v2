/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');

// Import the email service — setup file mocks sendTemplatedEmail but keeps real helper functions
const emailService = require('../lib/email-service');

// For testing the real sendTemplatedEmail with per-user rate limiting, we need the actual module
// The DB and rate limiter are already mocked by the setup file
const realEmailService = jest.requireActual('../lib/email-service');

// Get the mock query function from the setup file's DB mock
const mockPool = require('../lib/db');
const mockQuery = mockPool.query;

// Get the mock rate limiter from the setup file
const { distributedRateLimiter } = require('../lib/distributed-rate-limiter');
const mockCheckLimit = distributedRateLimiter.checkLimit;

// ─── Tests ───────────────────────────────────────────────────────────────

describe('Email Notifications Foundation', () => {
  const templateDir = path.join(process.cwd(), 'templates', 'emails');

  beforeAll(() => {
    jest.spyOn(realEmailService, 'initializeTransporter').mockReturnValue(true);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    // Default mock: return empty rows for SELECTs, a generated id for INSERT RETURNING
    mockQuery.mockImplementation((query, params) => {
      const q = String(query);
      if (q.includes('RETURNING id')) {
        return Promise.resolve({ rows: [{ id: Math.floor(Math.random() * 1000000) }] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockCheckLimit.mockReset().mockResolvedValue({ allowed: true, count: 1, retryAfter: 0 });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Template File Existence ────────────────────────────────────────
  describe('Template files on disk', () => {
    it('has all required template files', () => {
      const required = [
        'candidate_application_submitted.html',
        'candidate_application_submitted.txt',
        'recruiter_new_application.html',
        'recruiter_new_application.txt',
        'interview_scheduled.html',
        'interview_scheduled.txt',
      ];
      for (const file of required) {
        expect(fs.existsSync(path.join(templateDir, file))).toBe(true);
      }
    });

    it('templates contain Rekrut AI indigo branding (#6366f1)', () => {
      const htmlFiles = [
        'candidate_application_submitted.html',
        'recruiter_new_application.html',
        'interview_scheduled.html',
      ];
      for (const file of htmlFiles) {
        const content = fs.readFileSync(path.join(templateDir, file), 'utf-8');
        expect(content).toContain('#6366f1');
      }
    });

    it('templates contain both HTML and plain text variants', () => {
      const templates = [
        'candidate_application_submitted',
        'recruiter_new_application',
        'interview_scheduled',
      ];
      for (const name of templates) {
        const htmlPath = path.join(templateDir, `${name}.html`);
        const txtPath = path.join(templateDir, `${name}.txt`);
        expect(fs.existsSync(htmlPath)).toBe(true);
        expect(fs.existsSync(txtPath)).toBe(true);
        expect(fs.readFileSync(htmlPath, 'utf-8').length).toBeGreaterThan(0);
        expect(fs.readFileSync(txtPath, 'utf-8').length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Template Rendering ─────────────────────────────────────────────
  describe('Template rendering', () => {
    it('renders simple variable substitution', () => {
      const result = emailService.renderTemplate('Hello {{name}}!', { name: 'Alice' });
      expect(result).toBe('Hello Alice!');
    });

    it('renders #if blocks conditionally', () => {
      const template = '{{#if premium}}Welcome back, {{name}}!{{/if}}';
      expect(emailService.renderTemplate(template, { premium: true, name: 'Alice' })).toBe('Welcome back, Alice!');
      expect(emailService.renderTemplate(template, { premium: false })).toBe('');
    });

    it('renders #each loops', () => {
      const template = '{{#each items}}- {{name}}\n{{/each}}';
      const result = emailService.renderTemplate(template, {
        items: [{ name: 'A' }, { name: 'B' }],
      });
      // trim() removes trailing newline
      expect(result).toBe('- A\n- B');
    });

    it('renders unknown variables as empty strings', () => {
      const result = emailService.renderTemplate('Hello {{missing}}!', {});
      expect(result).toBe('Hello !');
    });

    it('renders file-based HTML template with real data', () => {
      const html = fs.readFileSync(path.join(templateDir, 'candidate_application_submitted.html'), 'utf-8');
      const result = emailService.renderTemplate(html, {
        name: 'Alice',
        job_title: 'Senior Engineer',
        company_name: 'Acme Corp',
        location: 'Remote',
        applied_date: '2026-07-06',
        application_link: 'https://rekrutai.co/candidate/applications',
      });
      expect(result).toContain('Alice');
      expect(result).toContain('Senior Engineer');
      expect(result).toContain('Acme Corp');
      expect(result).toContain('#6366f1');
    });

    it('renders file-based text template with real data', () => {
      const txt = fs.readFileSync(path.join(templateDir, 'recruiter_new_application.txt'), 'utf-8');
      const result = emailService.renderTemplate(txt, {
        name: 'Bob',
        candidate_name: 'Alice',
        candidate_email: 'alice@example.com',
        job_title: 'Senior Engineer',
        omniscore: '850',
        verification_status: 'verified',
        applied_date: '2026-07-06',
        application_link: 'https://rekrutai.co/recruiter/applications',
      });
      expect(result).toContain('Hi Bob');
      expect(result).toContain('Alice');
      expect(result).toContain('Senior Engineer');
      expect(result).toContain('850');
    });
  });

  // ─── File-based Template Loading ────────────────────────────────────
  describe('File-based template loading', () => {
    it('loads candidate_application_submitted from file when DB has no template', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const template = await emailService.getTemplate('candidate_application_submitted');
      expect(template).toBeTruthy();
      expect(template.name).toBe('candidate_application_submitted');
      expect(template.html_template).toContain('Application Submitted');
      expect(template.body_template).toContain('Hi {{name}}');
      expect(template.subject_template).toBe('Application Submitted');
      expect(template.is_active).toBe(true);
    });

    it('loads recruiter_new_application from file', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const template = await emailService.getTemplate('recruiter_new_application');
      expect(template).toBeTruthy();
      expect(template.name).toBe('recruiter_new_application');
      expect(template.html_template).toContain('New Application Received');
    });

    it('loads interview_scheduled from file', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const template = await emailService.getTemplate('interview_scheduled');
      expect(template).toBeTruthy();
      expect(template.name).toBe('interview_scheduled');
      expect(template.html_template).toContain('Interview Scheduled');
      expect(template.body_template).toContain('Interview Details');
    });

    it('prefers DB template over file when both exist', async () => {
      const dbTemplate = {
        id: 1,
        name: 'interview_scheduled',
        subject_template: 'DB Subject',
        body_template: 'DB Body',
        html_template: '<html>DB</html>',
        is_active: true,
        type: 'transactional',
      };
      mockQuery.mockResolvedValue({ rows: [dbTemplate] });
      const template = await emailService.getTemplate('interview_scheduled');
      expect(template).toEqual(dbTemplate);
    });

    it('returns null for unknown templates', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const template = await emailService.getTemplate('nonexistent_template_xyz');
      expect(template).toBeNull();
    });
  });

  // ─── Rate Limiting ──────────────────────────────────────────────────
  describe('Per-user rate limiting', () => {
    it('allows email when user is under the limit', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      await realEmailService.sendTemplatedEmail({
        to: 'candidate@example.com',
        templateName: 'candidate_application_submitted',
        templateData: { name: 'Alice', job_title: 'Engineer', company_name: 'Acme', location: 'Remote', applied_date: '2026-07-06', application_link: 'https://rekrutai.co' },
        userId: 42,
      });
      expect(mockCheckLimit).toHaveBeenCalledWith('email:user:42', 3600000, 5);
    });

    it('blocks email when user exceeds 5 per hour', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      mockCheckLimit.mockResolvedValue({ allowed: false, count: 6, retryAfter: 1800 });
      const result = await realEmailService.sendTemplatedEmail({
        to: 'candidate@example.com',
        templateName: 'candidate_application_submitted',
        templateData: { name: 'Alice', job_title: 'Engineer', company_name: 'Acme', location: 'Remote', applied_date: '2026-07-06', application_link: 'https://rekrutai.co' },
        userId: 42,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('user_rate_limit_exceeded');
      expect(result.retryAfter).toBe(1800);
    });

    it('skips per-user check when userId is not provided', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      await realEmailService.sendTemplatedEmail({
        to: 'guest@example.com',
        templateName: 'candidate_application_submitted',
        templateData: { name: 'Guest', job_title: 'Engineer', company_name: 'Acme', location: 'Remote', applied_date: '2026-07-06', application_link: 'https://rekrutai.co' },
      });
      expect(mockCheckLimit).not.toHaveBeenCalled();
    });
  });

  // ─── Email Logging ──────────────────────────────────────────────────
  describe('Email logging', () => {
    it('logs skipped emails when rate limited', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      mockCheckLimit.mockResolvedValue({ allowed: false, count: 6, retryAfter: 1800 });
      await realEmailService.sendTemplatedEmail({
        to: 'test@example.com',
        templateName: 'candidate_application_submitted',
        templateData: { name: 'Test' },
        userId: 99,
      });
      // Should have logged the skipped email to notification_logs
      const logCalls = mockQuery.mock.calls.filter((call) =>
        String(call[0]).includes('INSERT INTO notification_logs')
      );
      expect(logCalls.length).toBeGreaterThanOrEqual(1);
      // The last log call should have status 'skipped'
      const lastLogCall = logCalls[logCalls.length - 1];
      const params = lastLogCall[1];
      expect(params[7]).toBe('skipped'); // status parameter
    });
  });

  // ─── Full Send Flow (mocked SMTP) ───────────────────────────────────
  describe('sendTemplatedEmail full flow', () => {
    it('returns template_not_found when template missing and file missing', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const result = await realEmailService.sendTemplatedEmail({
        to: 'test@example.com',
        templateName: 'nonexistent_template_xyz',
        templateData: {},
        userId: 1,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('template_not_found');
    });
  });

  // ─── Route Trigger Verification ─────────────────────────────────────
  describe('Route trigger verification', () => {
    it('candidate route uses candidate_application_submitted template', () => {
      const candidateRoute = fs.readFileSync(path.join(process.cwd(), 'routes', 'candidate.js'), 'utf-8');
      expect(candidateRoute).toContain("templateName: 'candidate_application_submitted'");
      expect(candidateRoute).toContain("templateName: 'recruiter_new_application'");
    });

    it('interviews route uses interview_scheduled template', () => {
      const interviewRoute = fs.readFileSync(path.join(process.cwd(), 'routes', 'interviews.js'), 'utf-8');
      expect(interviewRoute).toContain("templateName: 'interview_scheduled'");
    });
  });
});