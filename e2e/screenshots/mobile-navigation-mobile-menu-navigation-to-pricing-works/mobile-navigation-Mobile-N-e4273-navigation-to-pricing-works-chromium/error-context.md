# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mobile-navigation.spec.ts >> Mobile Navigation — Landing Page >> mobile menu navigation to pricing works
- Location: e2e/mobile-navigation.spec.ts:37:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: /Pricing/i })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('heading', { name: /Pricing/i })

```

```yaml
- banner:
  - link "Rekrut AI logo Rekrut AI":
    - /url: /
    - img "Rekrut AI logo"
    - text: Rekrut AI
  - link "Sign in":
    - /url: /login
    - button "Sign in"
  - link "Get started":
    - /url: /register
    - button "Get started"
- main:
  - img
  - text: Simple plans for teams that need to hire faster
  - heading "Choose a plan that fits your hiring volume." [level=1]
  - paragraph: Launch with a clean pricing page, then send buyers straight into Stripe Checkout with one click.
  - button "Monthly Pay month to month" [pressed]
  - button "Yearly Save with annual billing"
  - text: Lean and fast
  - heading "Starter" [level=3]:
    - img
    - text: Starter
  - paragraph: For small teams that want a polished hiring workflow.
  - text: $29 /month
  - list:
    - listitem:
      - img
      - text: 3 active job posts
    - listitem:
      - img
      - text: Candidate screening tools
    - listitem:
      - img
      - text: Basic analytics dashboard
    - listitem:
      - img
      - text: Email support
  - button "Start checkout":
    - text: Start checkout
    - img
  - text: Most popular Most popular
  - heading "Growth" [level=3]:
    - img
    - text: Growth
  - paragraph: For teams scaling hiring across multiple roles.
  - text: $79 /month
  - list:
    - listitem:
      - img
      - text: Unlimited active jobs
    - listitem:
      - img
      - text: Advanced analytics
    - listitem:
      - img
      - text: Interview and onboarding workflows
    - listitem:
      - img
      - text: Priority support
  - button "Start checkout":
    - text: Start checkout
    - img
  - text: Custom pricing
  - heading "Enterprise" [level=3]:
    - img
    - text: Enterprise
  - paragraph: Custom rollout for larger teams and more complex hiring ops.
  - text: Custom
  - list:
    - listitem:
      - img
      - text: Custom workflow design
    - listitem:
      - img
      - text: SSO and security review
    - listitem:
      - img
      - text: Dedicated onboarding
    - listitem:
      - img
      - text: Custom contract terms
  - button "Contact sales"
  - img
  - heading "Fast checkout" [level=2]
  - paragraph: Stripe handles payment collection and subscription creation.
  - img
  - heading "Easy sync" [level=2]
  - paragraph: Signed-in users get their Rekrut AI account updated after payment.
  - img
  - heading "Flexible billing" [level=2]
  - paragraph: Switch between monthly and yearly pricing without leaving the page.
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test'
  2   | 
  3   | const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json'
  4   | const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json'
  5   | 
  6   | // Mobile viewport: 375px × 667px (iPhone SE / similar)
  7   | const MOBILE_VIEWPORT = { width: 375, height: 667 }
  8   | 
  9   | test.describe('Mobile Navigation — Landing Page', () => {
  10  |   test.use({ viewport: MOBILE_VIEWPORT })
  11  | 
  12  |   test('hamburger menu opens and shows navigation links', async ({ page }) => {
  13  |     await page.goto('/')
  14  |     await page.waitForLoadState('networkidle')
  15  | 
  16  |     // Hamburger button should be visible on mobile
  17  |     const openMenuBtn = page.getByRole('button', { name: 'Open menu' })
  18  |     await expect(openMenuBtn).toBeVisible({ timeout: 10000 })
  19  | 
  20  |     // Desktop nav should be hidden
  21  |     const desktopNav = page.locator('nav.hidden.sm\\:flex').first()
  22  |     await expect(desktopNav).toBeHidden()
  23  | 
  24  |     // Open menu
  25  |     await openMenuBtn.click()
  26  | 
  27  |     // Mobile menu overlay should appear with links
  28  |     // Use first() to avoid strict-mode violations from multiple Pricing links on the page
  29  |     await expect(page.getByRole('link', { name: 'Pricing' }).first()).toBeVisible({ timeout: 10000 })
  30  |     await expect(page.getByRole('link', { name: 'Blog' }).first()).toBeVisible()
  31  |     await expect(page.getByRole('link', { name: 'About' }).first()).toBeVisible()
  32  |     await expect(page.getByRole('link', { name: 'Contact' }).first()).toBeVisible()
  33  |     await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible()
  34  |     await expect(page.getByRole('button', { name: 'Get started' }).first()).toBeVisible()
  35  |   })
  36  | 
  37  |   test('mobile menu navigation to pricing works', async ({ page }) => {
  38  |     await page.goto('/')
  39  |     await page.waitForLoadState('networkidle')
  40  | 
  41  |     await page.getByRole('button', { name: 'Open menu' }).click()
  42  |     await page.getByRole('link', { name: 'Pricing' }).first().click()
  43  | 
  44  |     await expect(page).toHaveURL(/.*\/pricing/)
> 45  |     await expect(page.getByRole('heading', { name: /Pricing/i })).toBeVisible({ timeout: 10000 })
      |                                                                   ^ Error: expect(locator).toBeVisible() failed
  46  |   })
  47  | 
  48  |   test('mobile menu close button works', async ({ page }) => {
  49  |     await page.goto('/')
  50  |     await page.waitForLoadState('networkidle')
  51  | 
  52  |     await page.getByRole('button', { name: 'Open menu' }).click()
  53  |     await expect(page.getByRole('button', { name: 'Close menu' })).toBeVisible()
  54  | 
  55  |     await page.getByRole('button', { name: 'Close menu' }).click()
  56  | 
  57  |     // After closing, the mobile menu overlay should not contain Pricing link
  58  |     // (the desktop nav is hidden, so we just verify the close button is gone)
  59  |     await expect(page.getByRole('button', { name: 'Close menu' })).toBeHidden()
  60  |   })
  61  | })
  62  | 
  63  | test.describe('Mobile Navigation — Recruiter Dashboard', () => {
  64  |   test.use({
  65  |     storageState: RECRUITER_STORAGE,
  66  |     viewport: MOBILE_VIEWPORT,
  67  |   })
  68  | 
  69  |   test('sidebar toggle opens and shows navigation items', async ({ page }) => {
  70  |     await page.goto('/recruiter')
  71  |     await page.waitForLoadState('networkidle')
  72  | 
  73  |     // Sidebar toggle should be visible on mobile
  74  |     const sidebarToggle = page.getByRole('button', { name: 'Open navigation menu' })
  75  |     await expect(sidebarToggle).toBeVisible({ timeout: 10000 })
  76  | 
  77  |     // Open sidebar
  78  |     await sidebarToggle.click()
  79  | 
  80  |     // Verify sidebar navigation items
  81  |     await expect(page.getByRole('navigation').getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 })
  82  |     await expect(page.getByRole('navigation').getByRole('link', { name: 'Jobs' })).toBeVisible()
  83  |     await expect(page.getByRole('navigation').getByRole('link', { name: 'Applications' })).toBeVisible()
  84  |     await expect(page.getByRole('navigation').getByRole('link', { name: 'Analytics' })).toBeVisible()
  85  |     await expect(page.getByRole('navigation').getByRole('link', { name: 'Settings' })).toBeVisible()
  86  |   })
  87  | 
  88  |   test('sidebar navigation to analytics works on mobile', async ({ page }) => {
  89  |     await page.goto('/recruiter')
  90  |     await page.waitForLoadState('networkidle')
  91  | 
  92  |     await page.getByRole('button', { name: 'Open navigation menu' }).click()
  93  |     await page.getByRole('navigation').getByRole('link', { name: 'Analytics' }).click()
  94  | 
  95  |     await expect(page).toHaveURL(/.*\/recruiter\/analytics/)
  96  |     await expect(page.getByRole('heading', { name: /Hiring Analytics/i })).toBeVisible({ timeout: 10000 })
  97  |   })
  98  | 
  99  |   test('sidebar closes when navigating to another page', async ({ page }) => {
  100 |     await page.goto('/recruiter')
  101 |     await page.waitForLoadState('networkidle')
  102 | 
  103 |     await page.getByRole('button', { name: 'Open navigation menu' }).click()
  104 |     await page.getByRole('navigation').getByRole('link', { name: 'Jobs' }).click()
  105 | 
  106 |     await expect(page).toHaveURL(/.*\/recruiter\/jobs/)
  107 | 
  108 |     // Sidebar should close after navigation (the close button is hidden)
  109 |     await expect(page.getByRole('button', { name: 'Close navigation menu' })).toBeHidden()
  110 |   })
  111 | 
  112 |   test('Escape key closes sidebar on mobile', async ({ page }) => {
  113 |     await page.goto('/recruiter')
  114 |     await page.waitForLoadState('networkidle')
  115 | 
  116 |     await page.getByRole('button', { name: 'Open navigation menu' }).click()
  117 |     await expect(page.getByRole('button', { name: 'Close navigation menu' })).toBeVisible()
  118 | 
  119 |     await page.keyboard.press('Escape')
  120 | 
  121 |     await expect(page.getByRole('button', { name: 'Close navigation menu' })).toBeHidden()
  122 |   })
  123 | })
  124 | 
  125 | test.describe('Mobile Navigation — Candidate Dashboard', () => {
  126 |   test.use({
  127 |     storageState: CANDIDATE_STORAGE,
  128 |     viewport: MOBILE_VIEWPORT,
  129 |   })
  130 | 
  131 |   test('candidate sidebar shows correct nav items on mobile', async ({ page }) => {
  132 |     await page.goto('/candidate')
  133 |     await page.waitForLoadState('networkidle')
  134 | 
  135 |     const sidebarToggle = page.getByRole('button', { name: 'Open navigation menu' })
  136 |     await expect(sidebarToggle).toBeVisible({ timeout: 10000 })
  137 | 
  138 |     await sidebarToggle.click()
  139 | 
  140 |     // Verify candidate-specific navigation items
  141 |     await expect(page.getByRole('navigation').getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 })
  142 |     await expect(page.getByRole('navigation').getByRole('link', { name: 'Job Board' })).toBeVisible()
  143 |     await expect(page.getByRole('navigation').getByRole('link', { name: 'Applications' })).toBeVisible()
  144 |     await expect(page.getByRole('navigation').getByRole('link', { name: 'Profile' })).toBeVisible()
  145 |     await expect(page.getByRole('navigation').getByRole('link', { name: 'AI Coaching' })).toBeVisible()
```