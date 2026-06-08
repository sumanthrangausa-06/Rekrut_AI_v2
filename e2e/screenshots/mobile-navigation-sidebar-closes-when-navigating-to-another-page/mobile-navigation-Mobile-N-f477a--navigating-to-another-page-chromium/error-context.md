# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mobile-navigation.spec.ts >> Mobile Navigation — Recruiter Dashboard >> sidebar closes when navigating to another page
- Location: e2e/mobile-navigation.spec.ts:99:7

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Open navigation menu' })

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - generic [ref=e5]:
    - link "Rekrut AI logo Rekrut AI" [ref=e6] [cursor=pointer]:
      - /url: /
      - img "Rekrut AI logo" [ref=e7]
      - generic [ref=e14]: Rekrut AI
    - button "Toggle theme" [ref=e16] [cursor=pointer]:
      - img [ref=e17]
  - generic [ref=e20]:
    - heading "Sign in" [level=2] [ref=e22]
    - generic [ref=e23]:
      - generic [ref=e24]:
        - text: Email
        - textbox "Email" [ref=e25]:
          - /placeholder: example.email@gmail.com
      - generic [ref=e26]:
        - text: Password
        - generic [ref=e27]:
          - textbox "Password" [ref=e28]:
            - /placeholder: Enter at least 8+ characters
          - button "Show password" [ref=e29] [cursor=pointer]:
            - img [ref=e30]
      - generic [ref=e33]:
        - generic [ref=e34]:
          - checkbox "Remember me" [ref=e37]
          - generic [ref=e39] [cursor=pointer]: Remember me
        - link "Forgot password?" [ref=e40] [cursor=pointer]:
          - /url: /forgot-password
      - button "Sign in" [ref=e41] [cursor=pointer]:
        - img
        - text: Sign in
      - paragraph [ref=e42]:
        - text: Don't have an account?
        - link "Sign up" [ref=e43] [cursor=pointer]:
          - /url: /register
```

# Test source

```ts
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
  45  |     await expect(page.getByRole('heading', { name: /Pricing/i })).toBeVisible({ timeout: 10000 })
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
> 103 |     await page.getByRole('button', { name: 'Open navigation menu' }).click()
      |                                                                      ^ Error: locator.click: Test timeout of 60000ms exceeded.
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
  146 |     await expect(page.getByRole('navigation').getByRole('link', { name: 'OmniScore' })).toBeVisible()
  147 |   })
  148 | 
  149 |   test('candidate mobile navigation to job board works', async ({ page }) => {
  150 |     await page.goto('/candidate')
  151 |     await page.waitForLoadState('networkidle')
  152 | 
  153 |     await page.getByRole('button', { name: 'Open navigation menu' }).click()
  154 |     await page.getByRole('navigation').getByRole('link', { name: 'Job Board' }).click()
  155 | 
  156 |     await expect(page).toHaveURL(/.*\/candidate\/jobs/)
  157 |   })
  158 | })
  159 | 
```