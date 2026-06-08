import { test, expect } from '@playwright/test'

test.describe('Candidate Flow', () => {
  test('candidate dashboard redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/candidate')
    await expect(page).toHaveURL(/.*\/login/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('candidate profile redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/candidate/profile')
    await expect(page).toHaveURL(/.*\/login/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('candidate jobs redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/candidate/jobs')
    await expect(page).toHaveURL(/.*\/login/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('candidate interviews redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/candidate/interviews')
    await expect(page).toHaveURL(/.*\/login/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('candidate assessments redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/candidate/assessments')
    await expect(page).toHaveURL(/.*\/login/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('candidate OmniScore redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/candidate/omniscore')
    await expect(page).toHaveURL(/.*\/login/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })
})
