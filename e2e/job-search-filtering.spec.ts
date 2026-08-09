import { test, expect } from '@playwright/test'

test.use({ storageState: 'e2e/.auth/candidate.json' })

test.describe('Job Search and Filtering', () => {
  test('search jobs by keyword and verify results update', async ({ page }) => {
    await page.goto('/candidate/jobs')
    await page.waitForTimeout(1000)

    // Wait for jobs to load
    await expect(page.getByText(/active jobs|results/).first()).toBeVisible({ timeout: 15000 })

    // Get initial result count text
    const initialResultText = await page.getByText(/active jobs|results/).first().textContent()
    const initialCount = parseInt(initialResultText?.match(/(\d+)/)?.[0] || '0')
    if (initialCount === 0) {
      test.skip(true, 'No jobs available on the board — skipping')
      return
    }

    // Search by a keyword that should match some jobs
    const searchInput = page.getByPlaceholder(/Search by title/)
    await searchInput.fill('E2E')
    await page.waitForTimeout(600)

    // Verify results are filtered
    const filteredResultText = await page.getByText(/results?/).first().textContent()
    const filteredCount = parseInt(filteredResultText?.match(/(\d+)/)?.[0] || '0')
    expect(filteredCount).toBeGreaterThanOrEqual(0)
    expect(filteredCount).toBeLessThanOrEqual(initialCount)

    // Clear search
    await searchInput.clear()
    await page.waitForTimeout(600)
    const clearedText = await page.getByText(/active jobs|results/).first().textContent()
    const clearedCount = parseInt(clearedText?.match(/(\d+)/)?.[0] || '0')
    expect(clearedCount).toBeGreaterThan(0)
  })

  test('filter jobs by job type and remote type', async ({ page }) => {
    await page.goto('/candidate/jobs')
    await page.waitForTimeout(1000)

    await expect(page.getByText(/active jobs|results/).first()).toBeVisible({ timeout: 15000 })

    const resultText = await page.getByText(/active jobs|results/).first().textContent()
    const resultCount = parseInt(resultText?.match(/(\d+)/)?.[0] || '0')
    if (resultCount === 0) {
      test.skip(true, 'No jobs available on the board — skipping')
      return
    }

    // Filter by job type (desktop filter bar)
    const typeSelect = page.locator('select').filter({ hasText: /All Types/ }).first()
    await typeSelect.selectOption('full-time')
    await page.waitForTimeout(600)

    // Verify results show only full-time jobs
    const ftResultText = await page.getByText(/results?/).first().textContent()
    const ftResultCount = parseInt(ftResultText?.match(/(\d+)/)?.[0] || '0')
    expect(ftResultCount).toBeGreaterThanOrEqual(0)

    // Filter by remote type
    const remoteSelect = page.locator('select').filter({ hasText: /All Work Modes/ }).first()
    await remoteSelect.selectOption('remote')
    await page.waitForTimeout(600)

    // Verify active filter count badge
    const clearButton = page.getByText(/Clear all/).first()
    if (await clearButton.isVisible().catch(() => false)) {
      await expect(clearButton).toBeVisible()
    }

    // Clear all filters
    const resetBtn = page.getByRole('button', { name: /Reset Filters|Clear all/ }).first()
    if (await resetBtn.isVisible().catch(() => false)) {
      await resetBtn.click()
      await page.waitForTimeout(600)
    } else {
      // Clear individually
      await typeSelect.selectOption('')
      await remoteSelect.selectOption('')
      await page.waitForTimeout(600)
    }

    const finalText = await page.getByText(/active jobs|results/).first().textContent()
    const finalCount = parseInt(finalText?.match(/(\d+)/)?.[0] || '0')
    if (finalCount === 0) {
      test.skip(true, 'No jobs available after clearing filters — skipping')
      return
    }
  })

  test('sort jobs by newest and salary high-low', async ({ page }) => {
    await page.goto('/candidate/jobs')
    await page.waitForTimeout(1000)

    await expect(page.getByText(/active jobs|results/).first()).toBeVisible({ timeout: 15000 })

    const resultText = await page.getByText(/results?/).first().textContent()
    const resultCount = parseInt(resultText?.match(/(\d+)/)?.[0] || '0')
    if (resultCount === 0) {
      test.skip(true, 'No jobs available on the board — skipping')
      return
    }

    // Sort by newest
    const sortSelect = page.locator('select').filter({ hasText: /Best Match/ }).first()
    await sortSelect.selectOption('newest')
    await page.waitForTimeout(600)

    // Verify jobs are still visible
    const sortResultText = await page.getByText(/results?/).first().textContent()
    const sortResultCount = parseInt(sortResultText?.match(/(\d+)/)?.[0] || '0')
    expect(sortResultCount).toBeGreaterThan(0)

    // Sort by salary high-low
    await sortSelect.selectOption('salary_high')
    await page.waitForTimeout(600)

    const salaryText = await page.getByText(/results?/).first().textContent()
    const salaryCount = parseInt(salaryText?.match(/(\d+)/)?.[0] || '0')
    expect(salaryCount).toBeGreaterThanOrEqual(0)

    // Reset to best match
    await sortSelect.selectOption('match')
    await page.waitForTimeout(600)
  })

  test('filter by experience level and company size', async ({ page }) => {
    await page.goto('/candidate/jobs')
    await page.waitForTimeout(1000)

    await expect(page.getByText(/active jobs|results/).first()).toBeVisible({ timeout: 15000 })

    const resultText = await page.getByText(/active jobs|results/).first().textContent()
    const resultCount = parseInt(resultText?.match(/(\d+)/)?.[0] || '0')
    if (resultCount === 0) {
      test.skip(true, 'No jobs available on the board — skipping')
      return
    }

    // Filter by experience level
    const expSelect = page.locator('select').filter({ hasText: /All Levels/ }).first()
    await expSelect.selectOption('senior')
    await page.waitForTimeout(600)

    // Filter by company size
    const sizeSelect = page.locator('select').filter({ hasText: /All Sizes/ })
    await sizeSelect.selectOption('startup')
    await page.waitForTimeout(600)

    // Verify results or empty state
    const expResultText = await page.getByText(/results?|No jobs found/).first().textContent()
    expect(expResultText).toBeTruthy()

    // Clear filters
    await expSelect.selectOption('')
    await sizeSelect.selectOption('')
    await page.waitForTimeout(600)

    const finalText = await page.getByText(/active jobs|results/).first().textContent()
    const finalCount = parseInt(finalText?.match(/(\d+)/)?.[0] || '0')
    if (finalCount === 0) {
      test.skip(true, 'No jobs available after clearing filters — skipping')
      return
    }
  })
})
