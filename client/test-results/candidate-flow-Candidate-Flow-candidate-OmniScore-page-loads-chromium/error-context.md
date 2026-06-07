# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: candidate-flow.spec.ts >> Candidate Flow >> candidate OmniScore page loads
- Location: e2e/candidate-flow.spec.ts:29:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=OmniScore, text=Score, text=Analysis').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('text=OmniScore, text=Score, text=Analysis').first()

```

```yaml
- link "Rekrut AI logo Rekrut AI":
  - /url: /
  - img "Rekrut AI logo"
  - text: Rekrut AI
- heading "Welcome back" [level=3]
- paragraph: Sign in to your account
- text: Email
- textbox "Email":
  - /placeholder: you@example.com
- text: Password
- textbox "Password":
  - /placeholder: Enter your password
- button "Sign in":
  - img
  - text: Sign in
- text: Or continue with
- button "Google":
  - img
  - text: Google
- button "LinkedIn":
  - img
  - text: LinkedIn
- link "Forgot your password?":
  - /url: /forgot-password
- paragraph:
  - text: Don't have an account?
  - link "Sign up":
    - /url: /register
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test.describe('Candidate Flow', () => {
  4  |   test('candidate dashboard loads', async ({ page }) => {
  5  |     await page.goto('/candidate/dashboard')
  6  |     await expect(page.locator('text=Dashboard, text=Overview, text=Jobs, text=Profile, text=Interviews').first()).toBeVisible()
  7  |   })
  8  | 
  9  |   test('candidate profile page loads', async ({ page }) => {
  10 |     await page.goto('/candidate/profile')
  11 |     await expect(page.locator('text=Profile, text=Skills, text=Experience, text=Education').first()).toBeVisible()
  12 |   })
  13 | 
  14 |   test('candidate jobs page loads', async ({ page }) => {
  15 |     await page.goto('/candidate/jobs')
  16 |     await expect(page.locator('text=Jobs, text=Search, text=Filter').first()).toBeVisible()
  17 |   })
  18 | 
  19 |   test('candidate interviews page loads', async ({ page }) => {
  20 |     await page.goto('/candidate/interviews')
  21 |     await expect(page.locator('text=Interviews, text=Schedule, text=Practice').first()).toBeVisible()
  22 |   })
  23 | 
  24 |   test('candidate assessments page loads', async ({ page }) => {
  25 |     await page.goto('/candidate/assessments')
  26 |     await expect(page.locator('text=Assessments, text=Skills, text=Progress').first()).toBeVisible()
  27 |   })
  28 | 
  29 |   test('candidate OmniScore page loads', async ({ page }) => {
  30 |     await page.goto('/candidate/omniscore')
> 31 |     await expect(page.locator('text=OmniScore, text=Score, text=Analysis').first()).toBeVisible()
     |                                                                                     ^ Error: expect(locator).toBeVisible() failed
  32 |   })
  33 | })
  34 | 
```