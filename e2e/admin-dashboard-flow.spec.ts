import { test, expect } from '@playwright/test'

// Admin credentials from environment variables only
const ADMIN_USERNAME = 'admin'
const envPassword = process.env.ADMIN_PASSWORD || ''
const ADMIN_PASSWORD_PLACEHOLDERS = [
  'YOUR_STRONG_ADMIN_PASSWORD_HERE',
  'change-me-strong-password',
]
const ADMIN_PASSWORD = ADMIN_PASSWORD_PLACEHOLDERS.includes(envPassword)
  ? 'Changeme123!'
  : envPassword

test.describe('admin dashboard flow', () => {
  test.beforeAll(() => {
    if (!ADMIN_PASSWORD) {
      test.skip(true, 'Admin password not available — skipping admin tests')
    }
  })

  test('admin login, view dashboard, and verify compliance', async ({ page }) => {
    // Login as admin
    await page.goto('/admin/login')
    await expect(page.getByRole('heading', { name: /Admin Access/i })).toBeVisible()

    await page.fill('input#username', ADMIN_USERNAME)
    await page.fill('input#password', ADMIN_PASSWORD)
    await page.getByRole('button', { name: /Sign in|Login/i }).click()

    // Should redirect to admin area
    await expect(page).toHaveURL(/.*\/admin\/(ai-health|dashboard)/, { timeout: 10000 })
    await page.waitForTimeout(1000)
    await page.waitForTimeout(600)
    await expect(page.locator('text=Admin').or(page.locator('text=Dashboard')).first()).toBeVisible({ timeout: 10000 })

    // Navigate to dashboard
    await page.goto('/admin/dashboard')
    await expect(page.getByRole('heading', { name: /Admin Dashboard/i })).toBeVisible({ timeout: 10000 })
    await expect(
      page.locator('text=Total Users').or(page.locator('text=Monthly Revenue')).or(page.locator('text=System Health')).or(page.locator('text=Recent Signups')).first()
    ).toBeVisible({ timeout: 10000 })

    // Navigate to compliance page
    await page.goto('/admin/compliance')
    await expect(page.getByRole('heading', { name: /Compliance|EU AI Act/i })).toBeVisible({ timeout: 10000 })
  })
})
