import { test, expect } from '@playwright/test'

test.describe('Public Pages', () => {
  test('login page loads without authentication', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveURL(/.*\/login/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await expect(page.getByText('Sign in to your account')).toBeVisible()
  })

  test('register page loads without authentication', async ({ page }) => {
    await page.goto('/register')
    await expect(page).toHaveURL(/.*\/register/)
    await expect(page.getByRole('heading', { name: /Create|Get started|Register|Sign up/i })).toBeVisible()
  })

  test('pricing page loads without authentication', async ({ page }) => {
    await page.goto('/pricing')
    await expect(page).toHaveURL(/.*\/pricing/)
    await expect(page.getByRole('heading', { name: /Choose a plan/i })).toBeVisible()
  })

  test('blog page loads without authentication', async ({ page }) => {
    await page.goto('/blog')
    await expect(page).toHaveURL(/.*\/blog/)
    await expect(page.getByRole('heading', { name: 'HireLoop Blog' })).toBeVisible()
  })

  test('home page loads without authentication', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/.*\/$/)
    await expect(page.getByRole('heading', { name: /Your AI-Powered Career Companion/i })).toBeVisible()
  })
})
