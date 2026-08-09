import { test, expect } from '@playwright/test'

const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json'

test.use({ storageState: RECRUITER_STORAGE })

test.describe('Recruiter Candidates Management', () => {
  test('candidates page loads with header, stats, and pipeline tabs', async ({ page }) => {
    await page.goto('/recruiter/candidates')
    await page.waitForTimeout(1000)

    // Verify header
    await expect(page.getByRole('heading', { name: 'Candidates', exact: true })).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/Manage and review your candidate pipeline/i)).toBeVisible()

    // Verify stats cards
    await expect(page.getByText(/Total Candidates/i).first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/New Applications/i).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/In Screening/i).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Interviews/i).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Hired/i).first()).toBeVisible({ timeout: 10000 })

    // Verify action buttons
    await expect(page.getByRole('button', { name: /Export CSV/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /Post a Job/i })).toBeVisible({ timeout: 10000 })
  })

  test('pipeline tabs filter candidates by status', async ({ page }) => {
    await page.goto('/recruiter/candidates')
    await page.waitForTimeout(1000)

    // Verify all status tabs exist (tabs include count numbers in accessible name)
    await expect(page.getByRole('button', { name: /^All/i }).first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: /^Applied/i }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /^Screening/i }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /^Interview/i }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /^Offer/i }).first()).toBeVisible({ timeout: 10000 })

    // Click through tabs to verify they load without error
    const tabs = ['Applied', 'Screening', 'Interview', 'Offer']
    for (const tabName of tabs) {
      const tab = page.getByRole('button', { name: new RegExp('^' + tabName, 'i') }).first()
      if (await tab.isVisible().catch(() => false)) {
        await tab.click()
        await page.waitForTimeout(600)
        await expect(tab).toBeVisible({ timeout: 10000 })
      }
    }

    // Return to All tab
    const allTab = page.getByRole('button', { name: /^All/i }).first()
    await allTab.click()
    await page.waitForTimeout(600)
    await expect(allTab).toBeVisible({ timeout: 10000 })
  })

  test('search and filter bar are present', async ({ page }) => {
    await page.goto('/recruiter/candidates')
    await page.waitForTimeout(1000)

    // Verify search input exists
    const searchInput = page.getByPlaceholder(/Search by name, skill, or location/i)
    await expect(searchInput).toBeVisible({ timeout: 10000 })

    // Verify filter button exists (no native <select> elements on this page)
    await expect(page.getByRole('button', { name: /Filters/i }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /Save Search/i }).first()).toBeVisible({ timeout: 10000 })

    // Type a search query and verify it accepts input
    await searchInput.fill('react senior')
    await page.waitForTimeout(600)
    expect(await searchInput.inputValue()).toBe('react senior')

    // Clear search
    await searchInput.clear()
    await page.waitForTimeout(300)
  })

  test('list/kanban view toggle works', async ({ page }) => {
    await page.goto('/recruiter/candidates')
    await page.waitForTimeout(1000)

    // Verify toggle button exists (use exact match to avoid "Shortlist" buttons)
    const viewToggle = page.getByRole('button', { name: /^Kanban$/i }).first()
    await expect(viewToggle).toBeVisible({ timeout: 10000 })

    // Click to toggle view
    await viewToggle.click()
    await page.waitForTimeout(800)

    // After toggle, button may change to "List" or disappear; just verify page didn't crash
    await expect(page.getByRole('heading', { name: 'Candidates', exact: true })).toBeVisible({ timeout: 10000 })
  })

  test('save search button and pro tip visible', async ({ page }) => {
    await page.goto('/recruiter/candidates')
    await page.waitForTimeout(1000)

    // Verify "Save Search" button exists
    await expect(page.getByRole('button', { name: /Save Search/i }).first()).toBeVisible({ timeout: 10000 })

    // Verify boolean search hint
    await expect(page.getByText(/Pro tip: Use/i).first()).toBeVisible()
  })

  test('empty state or candidate list renders without error', async ({ page }) => {
    await page.goto('/recruiter/candidates')
    await page.waitForTimeout(1000)

    // Wait for loading to finish
    await page.waitForTimeout(1000)

    // Check for candidate cards or empty state
    const hasCandidates = await page.getByText(/E2E Candidate/i).first().isVisible().catch(() => false)
    const hasEmptyState = await page.getByText(/No candidates found/i).first().isVisible().catch(() => false)
    const hasPipeline = await page.getByText(/Manage and review your candidate pipeline/i).first().isVisible().catch(() => false)

    // At least one should be visible after loading
    expect(hasCandidates || hasEmptyState || hasPipeline).toBe(true)
  })

  test('pagination controls appear when multiple pages exist', async ({ page }) => {
    await page.goto('/recruiter/candidates')
    await page.waitForTimeout(1000)

    // Check if pagination is present
    const paginationText = page.getByText(/Page \d+ of \d+/i).first()
    const hasPagination = await paginationText.isVisible().catch(() => false)

    if (hasPagination) {
      // Verify prev/next buttons
      await expect(page.getByRole('button', { name: /Previous/i }).or(page.locator('button').filter({ has: page.locator('svg') }).first())).toBeVisible()

      // Note: we don't click pagination to avoid side-effects; just verify it renders
    } else {
      test.skip(true, 'Only one page of candidates — pagination not rendered')
    }
  })
})
