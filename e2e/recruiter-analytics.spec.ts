import { test, expect } from '@playwright/test'

const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json'

test.use({ storageState: RECRUITER_STORAGE })

test.describe('Recruiter Analytics Dashboard', () => {
  test('dashboard loads with heading and key metrics', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForLoadState('networkidle')

    // Verify heading
    await expect(page.getByRole('heading', { name: /Hiring Analytics/i })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Track your recruitment performance and insights')).toBeVisible()

    // Verify key metrics cards render
    await expect(page.locator('text=Job Views').first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Applications').first()).toBeVisible()
    await expect(page.locator('text=Conversion Rate').first()).toBeVisible()
    await expect(page.locator('text=Avg Days to Hire').first()).toBeVisible()
  })

  test('hiring funnel renders with stages', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: /Hiring Funnel/i })).toBeVisible({ timeout: 10000 })

    // Verify funnel stages are visible
    const funnelStages = ['Job Views', 'Applied', 'Screened', 'Interviewed', 'Offered', 'Hired']
    for (const stage of funnelStages) {
      await expect(page.locator('text=' + stage).first()).toBeVisible()
    }
  })

  test('hiring velocity chart renders with data', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: /Hiring Velocity/i })).toBeVisible({ timeout: 10000 })

    // Verify at least one month bar is visible (mock data includes Jan-Jun)
    await expect(page.locator('text=Jan').first()).toBeVisible()
    await expect(page.locator('text=Applications').first()).toBeVisible()
    await expect(page.locator('text=Hired').first()).toBeVisible()
  })

  test('application sources breakdown renders', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: /Application Sources/i })).toBeVisible({ timeout: 10000 })

    const sources = ['Direct', 'LinkedIn', 'Indeed', 'Referral']
    for (const source of sources) {
      await expect(page.locator('text=' + source).first()).toBeVisible()
    }
  })

  test('time to hire by stage renders', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: /Time to Hire by Stage/i })).toBeVisible({ timeout: 10000 })

    // Verify at least one stage row is visible
    await expect(page.locator('text=days avg').first()).toBeVisible()
  })

  test('OmniScore distribution renders', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: /Candidate Quality/i })).toBeVisible({ timeout: 10000 })

    const scoreRanges = ['900+', '800-899', '700-799', '600-699', '<600']
    for (const range of scoreRanges) {
      await expect(page.locator('text=' + range).first()).toBeVisible()
    }
  })

  test('time range filter changes data', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForLoadState('networkidle')

    const timeRangeSelect = page.locator('select').first()
    await expect(timeRangeSelect).toBeVisible()

    // Change to 7 days
    await timeRangeSelect.selectOption('7')
    await page.waitForLoadState('networkidle')

    // Verify dashboard still loads after filter change
    await expect(page.getByRole('heading', { name: /Hiring Analytics/i })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Job Views').first()).toBeVisible()

    // Change to 90 days
    await timeRangeSelect.selectOption('90')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('text=Applications').first()).toBeVisible()
  })

  test('advanced metrics section renders for Pro tier', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: /Advanced Metrics/i })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Pro').first()).toBeVisible()

    // Verify metric cards
    await expect(page.locator('text=Cost per Hire').first()).toBeVisible()
    await expect(page.locator('text=Quality of Hire').first()).toBeVisible()
    await expect(page.locator('text=Offer Acceptance').first()).toBeVisible()
  })

  test('export button is visible', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForLoadState('networkidle')

    const exportBtn = page.getByRole('button', { name: /Export/i })
    await expect(exportBtn).toBeVisible()
  })
})
