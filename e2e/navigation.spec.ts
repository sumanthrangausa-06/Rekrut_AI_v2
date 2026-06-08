import { test, expect } from '@playwright/test'

test.describe('Navigation', () => {
  test('can navigate from home to login via nav link', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop nav links are hidden in mobile hamburger menu')
    await page.goto('/')
    const loginLink = page.locator('a[href="/login"]').first()
    await expect(loginLink).toBeVisible()
    await loginLink.click()
    await expect(page).toHaveURL(/.*\/login/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('can navigate from home to register via nav link', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop nav links are hidden in mobile hamburger menu')
    await page.goto('/')
    const registerLink = page.locator('a[href="/register"]').first()
    await expect(registerLink).toBeVisible()
    await registerLink.click()
    await expect(page).toHaveURL(/.*\/register/)
  })

  test('can navigate from home to pricing page', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop nav links are hidden in mobile hamburger menu')
    await page.goto('/')
    const pricingLink = page.locator('a[href="/pricing"]').first()
    await expect(pricingLink).toBeVisible()
    await pricingLink.click()
    await expect(page).toHaveURL(/.*\/pricing/)
  })

  test('can navigate from login to register via link', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop nav links are hidden in mobile hamburger menu')
    await page.goto('/login')
    const registerLink = page.locator('a[href="/register"]').first()
    await expect(registerLink).toBeVisible()
    await registerLink.click()
    await expect(page).toHaveURL(/.*\/register/)
  })

  test('can navigate from register to login via link', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop nav links are hidden in mobile hamburger menu')
    await page.goto('/register')
    const loginLink = page.locator('a[href="/login"]').first()
    await expect(loginLink).toBeVisible()
    await loginLink.click()
    await expect(page).toHaveURL(/.*\/login/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('logo on home page links to home', async ({ page }) => {
    await page.goto('/')
    const logo = page.locator('a:has-text("Rekrut AI")').first()
    await expect(logo).toBeVisible()
  })
})
