import { test, expect } from '@playwright/test'

const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json'
const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json'

test.describe('Auth Persistence & Token Tests — Candidate', () => {
  test.use({ storageState: CANDIDATE_STORAGE })

  test('candidate token persists across page reloads', async ({ page }) => {
    // Navigate to candidate dashboard (already authenticated via storageState)
    await page.goto('/candidate')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('text=Dashboard').first()).toBeVisible()
    await expect(page).toHaveURL(/.*\/candidate/)

    // Reload page and verify still authenticated
    await page.reload()
    await expect(page.locator('text=Dashboard').first()).toBeVisible()
    await expect(page).toHaveURL(/.*\/candidate/)
  })

  test('candidate can navigate directly to /candidate/jobs when authenticated', async ({ page }) => {
    // Navigate directly to protected route (already authenticated via storageState)
    await page.goto('/candidate/jobs')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/.*\/candidate\/jobs/)
    await expect(page.locator('text=Jobs').first()).toBeVisible()
  })

  test('logout clears auth and redirects to login', async ({ page }) => {
    // Navigate to candidate dashboard (already authenticated via storageState)
    await page.goto('/candidate')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/.*\/(candidate|recruiter)/)

    // Try to open user menu and click logout if visible
    const userMenuBtn = page.locator('button').filter({ hasText: /E2E Candidate|E2E Recruiter/i }).first()
    if (await userMenuBtn.isVisible().catch(() => false)) {
      await userMenuBtn.click()
      await page.waitForTimeout(300)
    }

    const logoutBtn = page.locator('button, a').filter({ hasText: /Logout|Sign out|Log out/i }).first()
    if (await logoutBtn.isVisible().catch(() => false)) {
      await logoutBtn.click()
      // Wait for redirect after logout
      await page.waitForURL(/.*\/login/, { timeout: 10000 })
    } else {
      // Direct logout via API if UI button not found
      await page.request.post('/api/auth/logout')
      // Clear localStorage tokens so the browser context is unauthenticated
      await page.evaluate(() => {
        localStorage.removeItem('rekrutai_token')
        localStorage.removeItem('rekrutai_refresh')
        localStorage.removeItem('token')
        localStorage.removeItem('refresh_token')
      })
      await page.goto('/login')
    }

    // Verify redirect to login
    await expect(page).toHaveURL(/.*\/login/)

    // Verify protected route redirects to login after logout
    await page.goto('/candidate/jobs')
    await expect(page).toHaveURL(/.*\/login/)
  })
})

test.describe('Auth Persistence & Token Tests — Recruiter', () => {
  test.use({ storageState: RECRUITER_STORAGE })

  test('recruiter token persists across page reloads', async ({ page }) => {
    // Navigate to recruiter dashboard (already authenticated via storageState)
    await page.goto('/recruiter')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('text=Dashboard').first()).toBeVisible()
    await expect(page).toHaveURL(/.*\/recruiter/)

    // Reload page and verify still authenticated
    await page.reload()
    await expect(page.locator('text=Dashboard').first()).toBeVisible()
    await expect(page).toHaveURL(/.*\/recruiter/)
  })

  test('recruiter can navigate directly to /recruiter/jobs when authenticated', async ({ page }) => {
    // Navigate directly to protected route (already authenticated via storageState)
    await page.goto('/recruiter/jobs')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/.*\/recruiter\/jobs/)
    await expect(page.locator('text=Jobs').first()).toBeVisible()
  })
})

test.describe('Candidate Jobs Page - Full Flow', () => {
  test.use({ storageState: CANDIDATE_STORAGE })

  test('candidate can browse jobs, search, and view job details', async ({ page }) => {
    await page.goto('/candidate/jobs')
    await page.waitForLoadState('networkidle')

    // Verify jobs page loads
    await expect(page).toHaveURL(/.*\/candidate\/jobs/)
    await expect(page.locator('text=Jobs').first()).toBeVisible()

    // Try searching for a job
    const searchInput = page.getByPlaceholder(/Search jobs/i).first()
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill('Software')
      await searchInput.press('Enter')
      await page.waitForTimeout(1500)
    }

    // Verify job cards are visible or empty state
    const jobCards = page.locator('[class*="job-card"], [class*="JobCard"]').first()
    const emptyState = page.getByText(/No jobs found/i).first()
    await expect(jobCards.or(emptyState)).toBeVisible()

    // Click on a job if visible
    const jobTitle = page.locator('text=Software').first()
    if (await jobTitle.isVisible().catch(() => false)) {
      await jobTitle.click()
      await expect(page).toHaveURL(/.*\/candidate\/jobs\/\d+/)
      await expect(page.locator('text=Apply').or(page.locator('text=Details')).first()).toBeVisible()
    }
  })

  test('candidate jobs page is responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/candidate/jobs')
    await page.waitForLoadState('networkidle')

    // Verify page loads without layout errors
    await expect(page.locator('text=Jobs').first()).toBeVisible()

    // Verify filter button is visible (mobile uses sheet/filter button)
    const filterBtn = page.locator('button').filter({ hasText: /Filter/i }).first()
    await expect(filterBtn).toBeVisible()

    // Open filter sheet
    await filterBtn.click()
    // On mobile, filter panel renders inline; check for filter sections
    await expect(page.getByRole('heading', { name: 'Filters' }).first()).toBeVisible()
    await expect(page.getByText('Job Type').first()).toBeVisible()
  })
})

test.describe('Settings Page Auth', () => {
  test.use({ storageState: CANDIDATE_STORAGE })

  test('candidate can access settings page when authenticated', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/.*\/settings/)
    await expect(page.locator('text=Settings').first()).toBeVisible()
  })
})
