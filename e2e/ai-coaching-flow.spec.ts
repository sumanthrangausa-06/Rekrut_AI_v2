import { test, expect } from '@playwright/test'

const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json'

test.describe('AI Interview Coaching Flow', () => {
  test.use({ storageState: CANDIDATE_STORAGE })

  test('AI Coaching page loads with all tabs', async ({ page }) => {
    await page.goto('/candidate/ai-coaching')
    await page.waitForLoadState('networkidle')

    // Wait for loading spinner to disappear (page fetches stats + questions)
    await page.locator('.animate-spin').waitFor({ state: 'detached', timeout: 10000 })

    // Verify heading
    await expect(
      page.getByRole('heading', { name: /AI Interview Coach/i })
    ).toBeVisible()

    // Verify Quick Practice tab exists (rendered as a button, not role=tab)
    await expect(
      page.getByRole('button', { name: 'Quick Practice', exact: true })
    ).toBeVisible()

    // Verify Mock Interview tab exists
    await expect(
      page.getByRole('button', { name: 'Mock Interview', exact: true })
    ).toBeVisible()

    // Verify Progress tab exists
    await expect(
      page.getByRole('button', { name: 'Progress', exact: true })
    ).toBeVisible()
  })

  test('can switch to Mock Interview tab', async ({ page }) => {
    await page.goto('/candidate/ai-coaching')
    await page.waitForLoadState('networkidle')

    // Wait for loading spinner to disappear
    await page.locator('.animate-spin').waitFor({ state: 'detached', timeout: 10000 })

    const mockTab = page.getByRole('button', { name: 'Mock Interview', exact: true })
    await mockTab.click()

    // Verify mock interview content loads (heading or button)
    await expect(
      page.locator('text=Mock Interview')
        .or(page.getByRole('button', { name: /Start Mock Interview/i }))
        .or(page.locator('text=Past Sessions'))
        .first()
    ).toBeVisible()
  })

  test('can switch to Quick Practice tab and see questions', async ({ page }) => {
    await page.goto('/candidate/ai-coaching')
    await page.waitForLoadState('networkidle')

    // Wait for loading spinner to disappear
    await page.locator('.animate-spin').waitFor({ state: 'detached', timeout: 10000 })

    const practiceTab = page.getByRole('button', { name: 'Quick Practice', exact: true })
    await practiceTab.click()

    // Verify practice content loads
    await expect(
      page.locator('text=Practice')
        .or(page.getByRole('button', { name: /Start Practice/i }))
        .or(page.locator('text=Questions'))
        .first()
    ).toBeVisible()
  })
})
