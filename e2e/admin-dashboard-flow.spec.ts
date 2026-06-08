import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'

function getAdminPassword(): string {
  try {
    const content = readFileSync('.admin-credentials', 'utf-8')
    const match = content.match(/Password: (.+)/)
    return match ? match[1] : 'admin'
  } catch {
    return process.env.ADMIN_PASSWORD || 'admin'
  }
}

test.describe('admin dashboard flow', () => {
  test('login, view stats, and verify compliance', async ({ page }) => {
    const password = getAdminPassword()

    // Login as admin
    await page.goto('/admin/login')
    await page.fill('#username', 'admin')
    await page.fill('#password', password)
    await page.getByRole('button', { name: 'Sign In' }).click()

    // Wait for redirect to admin area
    await page.waitForURL(/.*\/admin\/.*/)

    // Navigate to dashboard
    await page.goto('/admin/dashboard')
    await page.waitForURL('/admin/dashboard')

    // Verify key stats cards are visible
    await expect(page.getByText('Total Users')).toBeVisible()
    await expect(page.getByText('Active Users')).toBeVisible()
    await expect(page.getByText('Jobs')).toBeVisible()
    await expect(page.getByText('Applications')).toBeVisible()

    // Navigate to compliance page
    await page.goto('/admin/compliance')
    await page.waitForURL('/admin/compliance')

    // Verify compliance page loads with tabs
    await expect(page.getByText('EU AI Act Compliance')).toBeVisible()
    await expect(page.getByRole('tab', { name: /Audit Trail/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Bias Detection/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Transparency/i })).toBeVisible()
  })
})
