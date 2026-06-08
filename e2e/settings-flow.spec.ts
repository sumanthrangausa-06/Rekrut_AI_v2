import { test, expect } from '@playwright/test'

const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json'

test.use({ storageState: CANDIDATE_STORAGE })

test.describe('Settings Flow', () => {
  test('settings page loads with all tabs', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // Verify page header
    await expect(page.getByRole('heading', { name: /Settings/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Manage your profile, account, and preferences/i)).toBeVisible()

    // Verify all tabs are present
    await expect(page.getByRole('tab', { name: /Profile/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('tab', { name: /Account/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('tab', { name: /Notifications/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('tab', { name: /Privacy/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('tab', { name: /Appearance/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('tab', { name: /Billing/i })).toBeVisible({ timeout: 10000 })
  })

  test('profile tab displays user info and can be updated', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // Ensure Profile tab is active
    await page.getByRole('tab', { name: /Profile/i }).click()
    await page.waitForTimeout(300)

    // Verify profile form fields
    await expect(page.getByRole('heading', { name: /Profile Information/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByLabel(/Full Name/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByLabel(/Email/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByLabel(/Location/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByLabel(/Bio/i)).toBeVisible({ timeout: 10000 })

    // Update location and bio
    const locationInput = page.getByLabel(/Location/i)
    await locationInput.fill('San Francisco, CA')

    const bioInput = page.locator('textarea#bio')
    await bioInput.fill('E2E test bio - updated by automated test suite')

    // Click save
    await page.getByRole('button', { name: /Save Profile/i }).click()

    // Verify success indicator
    await expect(page.getByText(/Changes saved successfully/i)).toBeVisible({ timeout: 15000 })
  })

  test('account tab shows password change form and danger zone', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await page.getByRole('tab', { name: /Account/i }).click()
    await page.waitForTimeout(300)

    // Verify password change section
    await expect(page.getByRole('heading', { name: /Change Password/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByLabel(/Current Password/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByLabel(/New Password/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByLabel(/Confirm New Password/i)).toBeVisible({ timeout: 10000 })

    // Verify validation: mismatched passwords
    await page.getByLabel(/New Password/i).fill('newpass123')
    await page.getByLabel(/Confirm New Password/i).fill('different123')
    await page.getByRole('button', { name: /Update Password/i }).click()

    await expect(page.getByText(/Passwords don't match/i)).toBeVisible({ timeout: 10000 })

    // Verify validation: short password
    await page.getByLabel(/New Password/i).fill('short')
    await page.getByLabel(/Confirm New Password/i).fill('short')
    await page.getByRole('button', { name: /Update Password/i }).click()

    await expect(page.getByText(/Password must be at least 6 characters/i)).toBeVisible({ timeout: 10000 })

    // Verify Danger Zone section
    await expect(page.getByRole('heading', { name: /Danger Zone/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /Delete/i }).first()).toBeVisible({ timeout: 10000 })
  })

  test('notifications tab toggles and saves preferences', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await page.getByRole('tab', { name: /Notifications/i }).click()
    await page.waitForTimeout(300)

    // Verify email notifications section
    await expect(page.getByRole('heading', { name: /Email Notifications/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/New job matches/i)).toBeVisible()
    await expect(page.getByText(/Application updates/i)).toBeVisible()
    await expect(page.getByText(/Messages/i)).toBeVisible()
    await expect(page.getByText(/Marketing & tips/i)).toBeVisible()

    // Verify push notifications section
    await expect(page.getByRole('heading', { name: /Push Notifications/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Job alerts/i)).toBeVisible()
    await expect(page.getByText(/Reminders/i)).toBeVisible()

    // Toggle a notification preference and save
    const firstToggle = page.locator('button[type="button"]').filter({ has: page.locator('span') }).first()
    if (await firstToggle.isVisible().catch(() => false)) {
      await firstToggle.click()
      await page.waitForTimeout(300)
    }

    await page.getByRole('button', { name: /Save Notification Preferences/i }).click()
    await expect(page.getByText(/Changes saved successfully/i).or(page.getByText(/saved/i)).first()).toBeVisible({ timeout: 15000 })
  })

  test('privacy tab shows data export and privacy toggles', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await page.getByRole('tab', { name: /Privacy/i }).click()
    await page.waitForTimeout(300)

    // Verify privacy settings
    await expect(page.getByRole('heading', { name: /Privacy Settings/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Public profile/i)).toBeVisible()
    await expect(page.getByText(/Receive messages/i)).toBeVisible()
    await expect(page.getByText(/Share usage data/i)).toBeVisible()

    // Verify data export section
    await expect(page.getByRole('heading', { name: /Data Export/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /Export My Data/i })).toBeVisible({ timeout: 10000 })

    // Save privacy settings
    await page.getByRole('button', { name: /Save Privacy Settings/i }).click()
    await expect(page.getByText(/Changes saved successfully/i).or(page.getByText(/saved/i)).first()).toBeVisible({ timeout: 15000 })
  })

  test('appearance tab shows theme options', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await page.getByRole('tab', { name: /Appearance/i }).click()
    await page.waitForTimeout(300)

    await expect(page.getByRole('heading', { name: /Theme/i })).toBeVisible({ timeout: 10000 })

    // Verify theme options exist
    await expect(page.getByRole('button', { name: /Light/i }).or(page.getByText('Light').first())).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /Dark/i }).or(page.getByText('Dark').first())).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /System/i }).or(page.getByText('System').first())).toBeVisible({ timeout: 10000 })
  })

  test('billing tab loads subscription info', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await page.getByRole('tab', { name: /Billing/i }).click()
    await page.waitForTimeout(300)

    await expect(page.getByRole('heading', { name: /Subscription/i })).toBeVisible({ timeout: 10000 })

    // Verify either free plan message or subscription details exist
    const billingContent = page.getByText(/free plan|Upgrade|Plan|Status|Subscription/i).first()
    await expect(billingContent).toBeVisible({ timeout: 10000 })
  })
})
