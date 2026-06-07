import { test, expect } from '@playwright/test'

test.describe('Recruiter Flow', () => {
  test('recruiter root redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/recruiter')
    await expect(page).toHaveURL(/.*\/login/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('recruiter jobs redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/recruiter/jobs')
    await expect(page).toHaveURL(/.*\/login/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('recruiter analytics redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/recruiter/analytics')
    await expect(page).toHaveURL(/.*\/login/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })
})
