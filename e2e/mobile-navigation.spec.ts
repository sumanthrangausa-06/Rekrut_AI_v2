import { test, expect } from '@playwright/test'

const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json'
const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json'

// Mobile viewport: 375px × 667px (iPhone SE / similar)
const MOBILE_VIEWPORT = { width: 375, height: 667 }

test.describe('Mobile Navigation — Landing Page', () => {
  test.use({ viewport: MOBILE_VIEWPORT })

  test('hamburger menu opens and shows navigation links', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Hamburger button should be visible on mobile
    const openMenuBtn = page.getByRole('button', { name: 'Open menu' })
    await expect(openMenuBtn).toBeVisible({ timeout: 10000 })

    // Desktop nav should be hidden
    const desktopNav = page.locator('nav.hidden.sm\\:flex').first()
    await expect(desktopNav).toBeHidden()

    // Open menu
    await openMenuBtn.click()

    // Mobile menu overlay should appear with links
    await expect(page.getByRole('link', { name: 'Pricing' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('link', { name: 'Blog' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'About' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Contact' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible()
  })

  test('mobile menu navigation to pricing works', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('link', { name: 'Pricing' }).click()

    await expect(page).toHaveURL(/.*\/pricing/)
    await expect(page.getByRole('heading', { name: /Pricing/i })).toBeVisible({ timeout: 10000 })
  })

  test('mobile menu close button works', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Open menu' }).click()
    await expect(page.getByRole('button', { name: 'Close menu' })).toBeVisible()

    await page.getByRole('button', { name: 'Close menu' }).click()

    // After closing, the mobile menu overlay should not contain Pricing link
    // (the desktop nav is hidden, so we just verify the close button is gone)
    await expect(page.getByRole('button', { name: 'Close menu' })).toBeHidden()
  })
})

test.describe('Mobile Navigation — Recruiter Dashboard', () => {
  test.use({
    storageState: RECRUITER_STORAGE,
    viewport: MOBILE_VIEWPORT,
  })

  test('sidebar toggle opens and shows navigation items', async ({ page }) => {
    await page.goto('/recruiter')
    await page.waitForLoadState('networkidle')

    // Sidebar toggle should be visible on mobile
    const sidebarToggle = page.getByRole('button', { name: 'Open navigation menu' })
    await expect(sidebarToggle).toBeVisible({ timeout: 10000 })

    // Open sidebar
    await sidebarToggle.click()

    // Verify sidebar navigation items
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Jobs' })).toBeVisible()
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Applications' })).toBeVisible()
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Analytics' })).toBeVisible()
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Settings' })).toBeVisible()
  })

  test('sidebar navigation to analytics works on mobile', async ({ page }) => {
    await page.goto('/recruiter')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Open navigation menu' }).click()
    await page.getByRole('navigation').getByRole('link', { name: 'Analytics' }).click()

    await expect(page).toHaveURL(/.*\/recruiter\/analytics/)
    await expect(page.getByRole('heading', { name: /Hiring Analytics/i })).toBeVisible({ timeout: 10000 })
  })

  test('sidebar closes when navigating to another page', async ({ page }) => {
    await page.goto('/recruiter')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Open navigation menu' }).click()
    await page.getByRole('navigation').getByRole('link', { name: 'Jobs' }).click()

    await expect(page).toHaveURL(/.*\/recruiter\/jobs/)

    // Sidebar should close after navigation (the close button is hidden)
    await expect(page.getByRole('button', { name: 'Close navigation menu' })).toBeHidden()
  })

  test('Escape key closes sidebar on mobile', async ({ page }) => {
    await page.goto('/recruiter')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Open navigation menu' }).click()
    await expect(page.getByRole('button', { name: 'Close navigation menu' })).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(page.getByRole('button', { name: 'Close navigation menu' })).toBeHidden()
  })
})

test.describe('Mobile Navigation — Candidate Dashboard', () => {
  test.use({
    storageState: CANDIDATE_STORAGE,
    viewport: MOBILE_VIEWPORT,
  })

  test('candidate sidebar shows correct nav items on mobile', async ({ page }) => {
    await page.goto('/candidate')
    await page.waitForLoadState('networkidle')

    const sidebarToggle = page.getByRole('button', { name: 'Open navigation menu' })
    await expect(sidebarToggle).toBeVisible({ timeout: 10000 })

    await sidebarToggle.click()

    // Verify candidate-specific navigation items
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Job Board' })).toBeVisible()
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Applications' })).toBeVisible()
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Profile' })).toBeVisible()
    await expect(page.getByRole('navigation').getByRole('link', { name: 'AI Coaching' })).toBeVisible()
    await expect(page.getByRole('navigation').getByRole('link', { name: 'OmniScore' })).toBeVisible()
  })

  test('candidate mobile navigation to job board works', async ({ page }) => {
    await page.goto('/candidate')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Open navigation menu' }).click()
    await page.getByRole('navigation').getByRole('link', { name: 'Job Board' }).click()

    await expect(page).toHaveURL(/.*\/candidate\/jobs/)
  })
})
