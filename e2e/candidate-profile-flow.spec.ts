import { test, expect } from '@playwright/test'

test.use({ storageState: 'e2e/.auth/candidate.json' })

test.describe('candidate profile flow', () => {
  test('edit profile, save, and verify persistence', async ({ page }) => {
    await page.goto('/candidate/profile')
    await page.waitForURL('/candidate/profile')

    // Click the Settings tab to reveal the form
    await page.getByRole('button', { name: 'Settings' }).click()

    // Wait for the form to be visible using the Personal Information heading
    await expect(page.getByRole('heading', { name: 'Personal Information' })).toBeVisible({ timeout: 10000 })

    // Fill in profile fields with unique values
    const headline = 'E2E QA Engineer ' + Date.now()
    await page.locator('input[placeholder="Senior Software Engineer"]').fill(headline)
    await page.locator('textarea[placeholder="Brief professional summary..."]').fill('Experienced in end-to-end testing and automation.')
    await page.locator('input[placeholder="San Francisco, CA"]').fill('San Francisco, CA')
    await page.locator('input[placeholder="+1 (555) 000-0000"]').fill('+1 (555) 123-4567')

    // Save profile
    await page.getByRole('button', { name: 'Save Changes' }).click()

    // Verify success toast appears
    await expect(page.getByText('Profile saved')).toBeVisible({ timeout: 10000 })

    // Reload and verify persistence
    await page.reload()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Personal Information' })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input[placeholder="Senior Software Engineer"]')).toHaveValue(headline)
    await expect(page.locator('textarea[placeholder="Brief professional summary..."]')).toHaveValue('Experienced in end-to-end testing and automation.')
    await expect(page.locator('input[placeholder="San Francisco, CA"]')).toHaveValue('San Francisco, CA')
    await expect(page.locator('input[placeholder="+1 (555) 000-0000"]')).toHaveValue('+1 (555) 123-4567')
  })
})
