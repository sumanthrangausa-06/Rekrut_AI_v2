import { test, expect } from '@playwright/test'

const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json'

test.describe('AI Interview Coaching Flow', () => {
  test.use({ storageState: CANDIDATE_STORAGE })

  test('AI Coaching page loads with all tabs', async ({ page }) => {
    await page.goto('/candidate/ai-coaching')
    await page.waitForLoadState('networkidle')

    // Verify heading
    await expect(
      page.getByRole('heading', { name: /AI Interview Coach/i })
    ).toBeVisible()

    // Verify Quick Practice tab exists
    await expect(
      page.getByRole('tab', { name: /Quick Practice/i })
    ).toBeVisible()

    // Verify Mock Interview tab exists
    await expect(
      page.getByRole('tab', { name: /Mock Interview/i })
    ).toBeVisible()

    // Verify Progress tab exists
    await expect(
      page.getByRole('tab', { name: /Progress/i })
    ).toBeVisible()
  })

  test('can switch to Mock Interview tab', async ({ page }) => {
    await page.goto('/candidate/ai-coaching')
    await page.waitForLoadState('networkidle')

    const mockTab = page.getByRole('tab', { name: /Mock Interview/i })
    await mockTab.click()

    // After clicking, the tab should be active
    await expect(mockTab).toHaveAttribute('aria-selected', 'true')

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

    const practiceTab = page.getByRole('tab', { name: /Quick Practice/i })
    await practiceTab.click()

    await expect(practiceTab).toHaveAttribute('aria-selected', 'true')

    // Verify practice content loads
    await expect(
      page.locator('text=Practice')
        .or(page.getByRole('button', { name: /Start Practice/i }))
        .or(page.locator('text=Questions'))
        .first()
    ).toBeVisible()
  })
})
