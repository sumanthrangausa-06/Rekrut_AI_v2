const { test, expect } = require('@playwright/test');

const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json';
const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json';

/**
 * Navigation tests verify that all major routes load without 404 errors,
 * have no console errors, and enforce correct redirects for unauthenticated users.
 */

test.describe('Navigation — Public Routes', () => {
  /**
   * Verifies the homepage loads successfully and has no console errors.
   */
  test('homepage loads without 404 or console errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading').first()).toBeVisible();

    // Should not show 404
    await expect(page.locator('text=404').first()).toBeHidden();
    expect(consoleErrors).toHaveLength(0);
  });

  /**
   * Verifies the login page loads and renders the login form.
   */
  test('login page loads without errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/login');
    await expect(page).toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { name: /Welcome back|Sign in/i }).first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  /**
   * Verifies the register page loads and renders the registration form.
   */
  test('register page loads without errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/register');
    await expect(page).toHaveURL(/.*\/register/);
    await expect(page.getByRole('heading', { name: /Create an account|Sign up/i }).first()).toBeVisible();
    await expect(page.getByRole('combobox')).toBeVisible(); // Role selector

    expect(consoleErrors).toHaveLength(0);
  });

  /**
   * Verifies the jobs page (public job board) loads without errors.
   */
  test('jobs page loads without errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/jobs');
    await expect(page).toHaveURL(/.*\/jobs/);
    await expect(page.locator('text=/Jobs|Job Board|Find Jobs/i').first()).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });
});

test.describe('Navigation — Candidate Routes', () => {
  test.use({ storageState: CANDIDATE_STORAGE });

  /**
   * Verifies the candidate dashboard loads for an authenticated candidate.
   */
  test('candidate dashboard loads without 404', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/candidate');
    await expect(page).toHaveURL(/.*\/candidate/);
    await expect(page.locator('text=/Welcome back|Dashboard|Candidate|Jobs/i').first()).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  /**
   * Verifies candidate jobs page loads.
   */
  test('candidate jobs page loads without errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/candidate/jobs');
    await expect(page).toHaveURL(/.*\/candidate\/jobs/);
    await expect(page.locator('text=/Find Your Next Opportunity|Job Board|Jobs/i').first()).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  /**
   * Verifies candidate applications page loads.
   */
  test('candidate applications page loads without errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/candidate/applications');
    await expect(page).toHaveURL(/.*\/candidate\/applications/);
    await expect(page.locator('text=/Applications|My Applications|Total Applied/i').first()).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  /**
   * Verifies candidate profile page loads.
   */
  test('candidate profile page loads without errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/candidate/profile');
    await expect(page).toHaveURL(/.*\/candidate\/profile/);
    await expect(page.locator('text=/Profile|Personal Information|Profile Completeness/i').first()).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });
});

test.describe('Navigation — Recruiter Routes', () => {
  test.use({ storageState: RECRUITER_STORAGE });

  /**
   * Verifies the recruiter dashboard loads for an authenticated recruiter.
   */
  test('recruiter dashboard loads without 404', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/recruiter');
    await expect(page).toHaveURL(/.*\/recruiter/);
    await expect(page.locator('text=/Welcome back|Dashboard|Recruiter|Active Jobs/i').first()).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  /**
   * Verifies recruiter jobs page loads.
   */
  test('recruiter jobs page loads without errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/recruiter/jobs');
    await expect(page).toHaveURL(/.*\/recruiter\/jobs/);
    await expect(page.locator('text=/Jobs|My Jobs|Active Jobs/i').first()).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  /**
   * Verifies recruiter analytics page loads.
   */
  test('recruiter analytics page loads without errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/recruiter/analytics');
    await expect(page).toHaveURL(/.*\/recruiter\/analytics/);
    await expect(page.getByRole('heading', { name: /Hiring Analytics/i })).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  /**
   * Verifies recruiter applications page loads.
   */
  test('recruiter applications page loads without errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/recruiter/applications');
    await expect(page).toHaveURL(/.*\/recruiter\/applications/);
    await expect(page.locator('text=/Applications|Pipeline|Applicants/i').first()).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });
});

test.describe('Navigation — Admin Routes', () => {
  /**
   * Verifies the admin login page loads. Admin routes typically require
   * separate authentication; this test just checks the route resolves.
   */
  test('admin page loads or redirects appropriately', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/admin');
    // Admin may redirect to login if not authenticated — either is fine
    const url = page.url();
    expect(url).toMatch(/.*\/(admin|login)/);

    // Should not be a 404
    await expect(page.locator('text=404').first()).toBeHidden();

    expect(consoleErrors).toHaveLength(0);
  });
});

test.describe('Navigation — Redirects for Unauthenticated Users', () => {
  /**
   * Verifies that unauthenticated users are redirected to login
   * when trying to access protected candidate routes.
   */
  test('unauthenticated user is redirected from candidate dashboard to login', async ({ page }) => {
    await page.goto('/candidate');
    await expect(page).toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { name: /Welcome back|Sign in/i }).first()).toBeVisible();
  });

  /**
   * Verifies that unauthenticated users are redirected to login
   * when trying to access protected recruiter routes.
   */
  test('unauthenticated user is redirected from recruiter dashboard to login', async ({ page }) => {
    await page.goto('/recruiter');
    await expect(page).toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { name: /Welcome back|Sign in/i }).first()).toBeVisible();
  });

  /**
   * Verifies that unauthenticated users are redirected to login
   * when trying to access protected candidate jobs page.
   */
  test('unauthenticated user is redirected from candidate jobs to login', async ({ page }) => {
    await page.goto('/candidate/jobs');
    await expect(page).toHaveURL(/.*\/login/);
  });

  /**
   * Verifies that unauthenticated users are redirected to login
   * when trying to access protected recruiter jobs page.
   */
  test('unauthenticated user is redirected from recruiter jobs to login', async ({ page }) => {
    await page.goto('/recruiter/jobs');
    await expect(page).toHaveURL(/.*\/login/);
  });
});
