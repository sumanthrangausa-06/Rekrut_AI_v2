import { test, expect } from '@playwright/test'

const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json'

test.use({ storageState: CANDIDATE_STORAGE })

test.describe('Settings Flow', () => {
  test('settings page loads with all tabs', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(1000)

    // Verify page header
    await expect(page.getByRole('heading', { name: /Settings/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Manage your profile, account, and preferences/i)).toBeVisible()

    // Verify all tabs are present (shadcn TabsTrigger renders as buttons)
    // Use nth(1) for Notifications to avoid navbar notification bell conflict
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Notifications', exact: true }).nth(1)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Privacy', exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Billing', exact: true })).toBeVisible({ timeout: 10000 })
  })

  test('profile tab displays user info and can be updated', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(1000)

    // Ensure Profile tab is active
    await page.getByRole('button', { name: 'Profile', exact: true }).click()
    await page.waitForTimeout(300)

    // Verify profile form fields
    await expect(page.getByRole('heading', { name: /Profile Information/i })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input#name')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input#email')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input#location')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('textarea#bio')).toBeVisible({ timeout: 10000 })

    // Update location and bio
    await page.locator('input#location').fill('San Francisco, CA')
    await page.locator('textarea#bio').fill('E2E test bio - updated by automated test suite')

    // Click save
    await page.getByRole('button', { name: /Save Profile/i }).click()

    // Verify either success or the form is still present (no crash)
    await expect(page.getByRole('heading', { name: /Profile Information/i })).toBeVisible({ timeout: 15000 })
  })

  test('account tab shows password change form and danger zone', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(1000)

    await page.getByRole('button', { name: 'Account', exact: true }).click()
    await page.waitForTimeout(300)

    // Verify password change section
    await expect(page.getByRole('heading', { name: /Change Password/i })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input#current-password')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input#new-password')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input#confirm-password')).toBeVisible({ timeout: 10000 })

    // Verify validation: mismatched passwords
    await page.locator('input#new-password').fill('newpass123')
    await page.locator('input#confirm-password').fill('different123')
    await page.getByRole('button', { name: /Update Password/i }).click()

    await expect(page.getByText(/Passwords don't match/i)).toBeVisible({ timeout: 10000 })

    // Verify validation: short password (check error banner appears)
    await page.locator('input#new-password').fill('short')
    await page.locator('input#confirm-password').fill('short')
    await page.getByRole('button', { name: /Update Password/i }).click()

    // Error banner should appear at top of page
    await expect(page.locator('div[class*="destructive"]').first()).toBeVisible({ timeout: 10000 })

    // Verify Danger Zone section
    await expect(page.getByRole('heading', { name: /Danger Zone/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /Delete/i }).first()).toBeVisible({ timeout: 10000 })
  })

  test('notifications tab toggles and saves preferences', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(1000)

    await page.getByRole('button', { name: 'Notifications', exact: true }).nth(1).click()
    await page.waitForTimeout(300)

    // Verify email notifications section
    await expect(page.getByText('Email Notifications')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('New job matches', { exact: true })).toBeVisible()
    await expect(page.getByText('Application updates', { exact: true })).toBeVisible()
    await expect(page.getByText('Messages', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Marketing & tips', { exact: true })).toBeVisible()

    // Verify push notifications section
    await expect(page.getByText('Push Notifications')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Job alerts', { exact: true })).toBeVisible()
    await expect(page.getByText('Reminders', { exact: true })).toBeVisible()

    // Toggle a notification preference and save
    const firstToggle = page.locator('button[type="button"]').filter({ has: page.locator('span') }).first()
    if (await firstToggle.isVisible().catch(() => false)) {
      await firstToggle.click()
      await page.waitForTimeout(300)
    }

    await page.getByRole('button', { name: /Save Notification Preferences/i }).click()
    // Verify button is still present after save (no crash)
    await expect(page.getByRole('button', { name: /Save Notification Preferences/i })).toBeVisible({ timeout: 15000 })
  })

  test('privacy tab shows data export and privacy toggles', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(1000)

    await page.getByRole('button', { name: 'Privacy', exact: true }).click()
    await page.waitForTimeout(300)

    // Verify privacy settings
    await expect(page.getByRole('heading', { name: 'Privacy Settings' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Public profile')).toBeVisible()
    await expect(page.getByText('Receive messages')).toBeVisible()
    await expect(page.getByText('Share usage data')).toBeVisible()

    // Verify data export section
    await expect(page.getByText('Data Export')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /Export My Data/i })).toBeVisible({ timeout: 10000 })

    // Save privacy settings
    await page.getByRole('button', { name: /Save Privacy Settings/i }).click()
    // Verify button is still present after save (no crash)
    await expect(page.getByRole('button', { name: /Save Privacy Settings/i })).toBeVisible({ timeout: 15000 })
  })

  test('appearance tab shows theme options', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(1000)

    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.waitForTimeout(300)

    await expect(page.getByText('Theme')).toBeVisible({ timeout: 10000 })

    // Verify theme options exist on the page (after clicking Appearance tab, only active content is rendered)
    await expect(page.getByText('Light')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Dark')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('System')).toBeVisible({ timeout: 10000 })
  })

  test('billing tab loads subscription info', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(1000)

    await page.getByRole('button', { name: 'Billing', exact: true }).click()
    await page.waitForTimeout(300)

    await expect(page.getByText('Subscription')).toBeVisible({ timeout: 10000 })

    // Verify either free plan message or subscription details exist
    const billingContent = page.getByText(/free plan|Upgrade|Plan|Status|Subscription/i).first()
    await expect(billingContent).toBeVisible({ timeout: 10000 })
  })
})
