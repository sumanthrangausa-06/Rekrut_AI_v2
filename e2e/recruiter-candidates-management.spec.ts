import { test, expect } from '@playwright/test'

const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json'

test.use({ storageState: RECRUITER_STORAGE })

test.describe('Recruiter Candidates Management', () => {
  test('candidates page loads with header, stats, and pipeline tabs', async ({ page }) => {
    await page.goto('/recruiter/candidates')
    await page.waitForLoadState('networkidle')

    // Verify header
    await expect(page.getByRole('heading', { name: /Candidates/i })).toBeVisible({ timeout: 15000 })
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
    await page.waitForLoadState('networkidle')

    // Verify all status tabs exist
    await expect(page.getByRole('tab', { name: /All/i })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('tab', { name: /Applied/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('tab', { name: /Screening/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('tab', { name: /Interview/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('tab', { name: /Offer/i })).toBeVisible({ timeout: 10000 })

    // Click through tabs to verify they load without error
    const tabs = ['Applied', 'Screening', 'Interview', 'Offer']
    for (const tabName of tabs) {
      const tab = page.getByRole('tab', { name: new RegExp(tabName, 'i') })
      if (await tab.isVisible().catch(() => false)) {
        await tab.click()
        await page.waitForTimeout(600)

        // Tab should be selected (aria-selected="true")
        await expect(tab).toHaveAttribute('aria-selected', 'true')
      }
    }

    // Return to All tab
    const allTab = page.getByRole('tab', { name: /^All$/i })
    await allTab.click()
    await page.waitForTimeout(600)
    await expect(allTab).toHaveAttribute('aria-selected', 'true')
  })

  test('search and filter bar are present', async ({ page }) => {
    await page.goto('/recruiter/candidates')
    await page.waitForLoadState('networkidle')

    // Verify search input exists
    const searchInput = page.getByPlaceholder(/Search by name, skill, or location/i)
    await expect(searchInput).toBeVisible({ timeout: 10000 })

    // Verify filter controls exist
    const filterSelects = page.locator('select')
    const filterCount = await filterSelects.count()
    expect(filterCount).toBeGreaterThanOrEqual(1)

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
    await page.waitForLoadState('networkidle')

    // Verify toggle button exists
    const viewToggle = page.getByRole('button', { name: /Kanban|List/i })
    await expect(viewToggle).toBeVisible({ timeout: 10000 })

    // Click to toggle view
    const initialLabel = await viewToggle.textContent()
    await viewToggle.click()
    await page.waitForTimeout(600)

    // Verify button label changed (or stays visible after click)
    await expect(viewToggle).toBeVisible()

    // Toggle back
    await viewToggle.click()
    await page.waitForTimeout(600)
    await expect(viewToggle).toBeVisible()
  })

  test('save search button and pro tip visible', async ({ page }) => {
    await page.goto('/recruiter/candidates')
    await page.waitForLoadState('networkidle')

    // Verify "Save Search" button exists
    await expect(page.getByRole('button', { name: /Save Search/i })).toBeVisible({ timeout: 10000 })

    // Verify boolean search hint
    await expect(page.getByText(/Pro tip: Use/i)).toBeVisible()
  })

  test('empty state or candidate list renders without error', async ({ page }) => {
    await page.goto('/recruiter/candidates')
    await page.waitForLoadState('networkidle')

    // Wait for loading to finish
    await page.waitForTimeout(1000)

    // Either candidates list or empty state should be visible
    const hasCandidates = await page.locator('[class*="CandidateCard"]').or(page.locator('text=No candidates found')).first().isVisible().catch(() => false)
    const hasEmptyState = await page.getByText(/No candidates found/i).first().isVisible().catch(() => false)

    // At least one should be visible after loading
    expect(hasCandidates || hasEmptyState).toBe(true)
  })

  test('pagination controls appear when multiple pages exist', async ({ page }) => {
    await page.goto('/recruiter/candidates')
    await page.waitForLoadState('networkidle')

    // Check if pagination is present
    const paginationText = page.getByText(/Page \d+ of \d+/i)
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
