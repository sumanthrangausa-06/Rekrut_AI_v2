# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-persistence.spec.ts >> Auth Persistence & Token Tests — Candidate >> candidate can navigate directly to /candidate/jobs when authenticated
- Location: e2e/auth-persistence.spec.ts:22:7

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /.*\/candidate\/jobs/
Received string:  "http://localhost:3000/login"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    12 × unexpected value "http://localhost:3000/login"

```

```yaml
- link "Rekrut AI logo Rekrut AI":
  - /url: /
  - img "Rekrut AI logo"
  - text: Rekrut AI
- paragraph:
  - text: Don't have an account?
  - link "Sign up":
    - /url: /register
- button "Toggle theme":
  - img
- heading "Sign in" [level=2]
- text: Email
- textbox "Email":
  - /placeholder: example.email@gmail.com
- text: Password
- textbox "Password":
  - /placeholder: Enter at least 8+ characters
- button "Show password":
  - img
- checkbox "Remember me"
- text: Remember me
- link "Forgot password?":
  - /url: /forgot-password
- button "Sign in":
  - img
  - text: Sign in
- img
- heading "Welcome back!" [level=3]
- paragraph: Sign in to access your dashboard, track applications, and continue your interview practice.
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test'
  2   | 
  3   | const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json'
  4   | const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json'
  5   | 
  6   | test.describe('Auth Persistence & Token Tests — Candidate', () => {
  7   |   test.use({ storageState: CANDIDATE_STORAGE })
  8   | 
  9   |   test('candidate token persists across page reloads', async ({ page }) => {
  10  |     // Navigate to candidate dashboard (already authenticated via storageState)
  11  |     await page.goto('/candidate')
  12  |     await page.waitForLoadState('networkidle')
  13  |     await expect(page.locator('text=Dashboard').first()).toBeVisible()
  14  |     await expect(page).toHaveURL(/.*\/candidate/)
  15  | 
  16  |     // Reload page and verify still authenticated
  17  |     await page.reload()
  18  |     await expect(page.locator('text=Dashboard').first()).toBeVisible()
  19  |     await expect(page).toHaveURL(/.*\/candidate/)
  20  |   })
  21  | 
  22  |   test('candidate can navigate directly to /candidate/jobs when authenticated', async ({ page }) => {
  23  |     // Navigate directly to protected route (already authenticated via storageState)
  24  |     await page.goto('/candidate/jobs')
  25  |     await page.waitForLoadState('networkidle')
> 26  |     await expect(page).toHaveURL(/.*\/candidate\/jobs/)
      |                        ^ Error: expect(page).toHaveURL(expected) failed
  27  |     await expect(page.locator('text=Jobs').first()).toBeVisible()
  28  |   })
  29  | 
  30  |   test('logout clears auth and redirects to login', async ({ page }) => {
  31  |     // Navigate to candidate dashboard (already authenticated via storageState)
  32  |     await page.goto('/candidate')
  33  |     await page.waitForLoadState('networkidle')
  34  |     await expect(page).toHaveURL(/.*\/(candidate|recruiter)/)
  35  | 
  36  |     // Try to open user menu and click logout if visible
  37  |     const userMenuBtn = page.locator('button').filter({ hasText: /E2E Candidate|E2E Recruiter/i }).first()
  38  |     if (await userMenuBtn.isVisible().catch(() => false)) {
  39  |       await userMenuBtn.click()
  40  |       await page.waitForTimeout(300)
  41  |     }
  42  | 
  43  |     const logoutBtn = page.locator('button, a').filter({ hasText: /Logout|Sign out|Log out/i }).first()
  44  |     if (await logoutBtn.isVisible().catch(() => false)) {
  45  |       await logoutBtn.click()
  46  |       // Wait for redirect after logout
  47  |       await page.waitForURL(/.*\/login/, { timeout: 10000 })
  48  |     } else {
  49  |       // Direct logout via API if UI button not found
  50  |       await page.request.post('/api/auth/logout')
  51  |       // Clear localStorage tokens so the browser context is unauthenticated
  52  |       await page.evaluate(() => {
  53  |         localStorage.removeItem('rekrutai_token')
  54  |         localStorage.removeItem('rekrutai_refresh')
  55  |         localStorage.removeItem('token')
  56  |         localStorage.removeItem('refresh_token')
  57  |       })
  58  |       await page.goto('/login')
  59  |     }
  60  | 
  61  |     // Verify redirect to login
  62  |     await expect(page).toHaveURL(/.*\/login/)
  63  | 
  64  |     // Verify protected route redirects to login after logout
  65  |     await page.goto('/candidate/jobs')
  66  |     await expect(page).toHaveURL(/.*\/login/)
  67  |   })
  68  | })
  69  | 
  70  | test.describe('Auth Persistence & Token Tests — Recruiter', () => {
  71  |   test.use({ storageState: RECRUITER_STORAGE })
  72  | 
  73  |   test('recruiter token persists across page reloads', async ({ page }) => {
  74  |     // Navigate to recruiter dashboard (already authenticated via storageState)
  75  |     await page.goto('/recruiter')
  76  |     await page.waitForLoadState('networkidle')
  77  |     await expect(page.locator('text=Dashboard').first()).toBeVisible()
  78  |     await expect(page).toHaveURL(/.*\/recruiter/)
  79  | 
  80  |     // Reload page and verify still authenticated
  81  |     await page.reload()
  82  |     await expect(page.locator('text=Dashboard').first()).toBeVisible()
  83  |     await expect(page).toHaveURL(/.*\/recruiter/)
  84  |   })
  85  | 
  86  |   test('recruiter can navigate directly to /recruiter/jobs when authenticated', async ({ page }) => {
  87  |     // Navigate directly to protected route (already authenticated via storageState)
  88  |     await page.goto('/recruiter/jobs')
  89  |     await page.waitForLoadState('networkidle')
  90  |     await expect(page).toHaveURL(/.*\/recruiter\/jobs/)
  91  |     await expect(page.locator('text=Jobs').first()).toBeVisible()
  92  |   })
  93  | })
  94  | 
  95  | test.describe('Candidate Jobs Page - Full Flow', () => {
  96  |   test.use({ storageState: CANDIDATE_STORAGE })
  97  | 
  98  |   test('candidate can browse jobs, search, and view job details', async ({ page }) => {
  99  |     await page.goto('/candidate/jobs')
  100 |     await page.waitForLoadState('networkidle')
  101 | 
  102 |     // Verify jobs page loads
  103 |     await expect(page).toHaveURL(/.*\/candidate\/jobs/)
  104 |     await expect(page.locator('text=Jobs').first()).toBeVisible()
  105 | 
  106 |     // Try searching for a job
  107 |     const searchInput = page.getByPlaceholder(/Search jobs/i).first()
  108 |     if (await searchInput.isVisible().catch(() => false)) {
  109 |       await searchInput.fill('Software')
  110 |       await searchInput.press('Enter')
  111 |       await page.waitForTimeout(1500)
  112 |     }
  113 | 
  114 |     // Verify job cards are visible or empty state
  115 |     const jobCards = page.locator('[class*="job-card"], [class*="JobCard"]').first()
  116 |     const emptyState = page.getByText(/No jobs found/i).first()
  117 |     await expect(jobCards.or(emptyState)).toBeVisible()
  118 | 
  119 |     // Click on a job if visible
  120 |     const jobTitle = page.locator('text=Software').first()
  121 |     if (await jobTitle.isVisible().catch(() => false)) {
  122 |       await jobTitle.click()
  123 |       await expect(page).toHaveURL(/.*\/candidate\/jobs\/\d+/)
  124 |       await expect(page.locator('text=Apply').or(page.locator('text=Details')).first()).toBeVisible()
  125 |     }
  126 |   })
```