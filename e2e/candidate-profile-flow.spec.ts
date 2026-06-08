import { test, expect } from '@playwright/test'

test.use({ storageState: 'e2e/.auth/candidate.json' })

test.describe('candidate profile flow', () => {
  test('edit profile, save, and verify persistence', async ({ page }) => {
    await page.goto('/candidate/profile')
    await page.waitForURL('/candidate/profile')

    // Navigate to Settings tab to edit profile (if not already active)
    const settingsTab = page.getByRole('button', { name: 'Settings' })
    if (await settingsTab.isVisible().catch(() => false)) {
      await settingsTab.click()
    }

    // Fill in profile fields with unique values
    const headline = 'E2E QA Engineer ' + Date.now()
    await page.getByPlaceholder('Senior Software Engineer').fill(headline)
    await page.getByPlaceholder('Brief professional summary...').fill('Experienced in end-to-end testing and automation.')
    await page.getByPlaceholder('San Francisco, CA').fill('San Francisco, CA')
    await page.getByPlaceholder('+1 (555) 000-0000').fill('+1 (555) 123-4567')

    // Save profile
    await page.getByRole('button', { name: 'Save Changes' }).click()

    // Verify success toast appears
    await expect(page.getByText('Profile saved')).toBeVisible({ timeout: 10000 })

    // Reload and verify persistence
    await page.reload()
    const settingsTab2 = page.getByRole('button', { name: 'Settings' })
    if (await settingsTab2.isVisible().catch(() => false)) {
      await settingsTab2.click()
    }
    await expect(page.getByPlaceholder('Senior Software Engineer')).toHaveValue(headline)
    await expect(page.getByPlaceholder('Brief professional summary...')).toHaveValue('Experienced in end-to-end testing and automation.')
    await expect(page.getByPlaceholder('San Francisco, CA')).toHaveValue('San Francisco, CA')
    await expect(page.getByPlaceholder('+1 (555) 000-0000')).toHaveValue('+1 (555) 123-4567')
  })
})
