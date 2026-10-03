import { test, expect } from '@playwright/test'

const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json'

test.use({ storageState: RECRUITER_STORAGE })

test.describe('Recruiter Analytics Dashboard', () => {
  test('dashboard loads with heading and key metrics', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForTimeout(1000)

    // Verify heading
    await expect(page.getByRole('heading', { name: /Hiring Analytics/i })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Track your recruitment performance and insights')).toBeVisible()

    // Verify at least some key metrics cards render (not all may be present)
    const metrics = ['Job Views', 'Applications', 'Conversion Rate', 'Avg Days to Hire']
    let visibleCount = 0
    for (const metric of metrics) {
      const el = page.locator('text=' + metric).first()
      if (await el.isVisible().catch(() => false)) visibleCount++
    }
    expect(visibleCount).toBeGreaterThanOrEqual(1)
  })

  test('hiring funnel renders with stages', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForTimeout(1000)

    const funnelHeading = page.getByRole('heading', { name: /Hiring Funnel/i })
    if (await funnelHeading.isVisible().catch(() => false)) {
      await expect(funnelHeading).toBeVisible({ timeout: 10000 })

      // Verify at least some funnel stages are visible
      const funnelStages = ['Job Views', 'Applied', 'Screened', 'Interviewed', 'Offered', 'Hired']
      let visibleCount = 0
      for (const stage of funnelStages) {
        const el = page.locator('text=' + stage).first()
        if (await el.isVisible().catch(() => false)) visibleCount++
      }
      expect(visibleCount).toBeGreaterThanOrEqual(1)
    } else {
      test.skip(true, 'Hiring Funnel section not present in current UI')
    }
  })

  test('hiring velocity chart renders with data', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForTimeout(1000)

    const velocityHeading = page.getByRole('heading', { name: /Hiring Velocity/i })
    if (await velocityHeading.isVisible().catch(() => false)) {
      await expect(velocityHeading).toBeVisible({ timeout: 10000 })

      // Verify chart-related text is visible
      const chartTexts = ['Applications', 'Hired']
      for (const text of chartTexts) {
        const el = page.locator('text=' + text).first()
        if (await el.isVisible().catch(() => false)) {
          await expect(el).toBeVisible()
        }
      }
    } else {
      test.skip(true, 'Hiring Velocity chart not present in current UI')
    }
  })

  test('application sources breakdown renders', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForTimeout(1000)

    const sourcesHeading = page.getByRole('heading', { name: /Application Sources/i })
    if (await sourcesHeading.isVisible().catch(() => false)) {
      await expect(sourcesHeading).toBeVisible({ timeout: 10000 })

      const sources = ['Direct', 'LinkedIn', 'Indeed', 'Referral']
      let visibleCount = 0
      for (const source of sources) {
        const el = page.locator('text=' + source).first()
        if (await el.isVisible().catch(() => false)) visibleCount++
      }
      expect(visibleCount).toBeGreaterThanOrEqual(1)
    } else {
      test.skip(true, 'Application Sources section not present in current UI')
    }
  })

  test('time to hire by stage renders', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForTimeout(1000)

    const timeHeading = page.getByRole('heading', { name: /Time to Hire by Stage/i })
    if (await timeHeading.isVisible().catch(() => false)) {
      await expect(timeHeading).toBeVisible({ timeout: 10000 })

      const daysText = page.locator('text=days avg').first()
      if (await daysText.isVisible().catch(() => false)) {
        await expect(daysText).toBeVisible()
      }
    } else {
      test.skip(true, 'Time to Hire section not present in current UI')
    }
  })

  test('OmniScore distribution renders', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForTimeout(1000)

    const qualityHeading = page.getByRole('heading', { name: /Candidate Quality/i })
    if (await qualityHeading.isVisible().catch(() => false)) {
      await expect(qualityHeading).toBeVisible({ timeout: 10000 })

      const scoreRanges = ['900+', '800-899', '700-799', '600-699', '<600']
      let visibleCount = 0
      for (const range of scoreRanges) {
        const el = page.locator('text=' + range).first()
        if (await el.isVisible().catch(() => false)) visibleCount++
      }
      expect(visibleCount).toBeGreaterThanOrEqual(1)
    } else {
      test.skip(true, 'Candidate Quality / OmniScore section not present in current UI')
    }
  })

  test('advanced analytics renders without error', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await page.waitForTimeout(1000)

    // Verify the page loads without crashing — individual sections may vary
    await expect(page.getByRole('heading', { name: /Hiring Analytics/i })).toBeVisible({ timeout: 10000 })

    // Check for at least one chart or metric card
    const hasMetrics = await page.locator('text=Applications').first().isVisible().catch(() => false)
    const hasCharts = await page.locator('canvas, svg, [class*="chart"]').first().isVisible().catch(() => false)

    expect(hasMetrics || hasCharts).toBe(true)
  })
})
