# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: recruiter-flow.spec.ts >> Recruiter Flow >> recruiter dashboard loads
- Location: e2e/recruiter-flow.spec.ts:4:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=Dashboard, text=Overview, text=Jobs, text=Candidates, text=Analytics').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('text=Dashboard, text=Overview, text=Jobs, text=Candidates, text=Analytics').first()

```

```yaml
- img
- text: "!"
- heading "404" [level=1]
- heading "Page Not Found" [level=2]
- paragraph: The page you're looking for doesn't exist or has been moved.
- link "Go Home":
  - /url: /
  - img
  - text: Go Home
- button "Go Back":
  - img
  - text: Go Back
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test.describe('Recruiter Flow', () => {
  4  |   test('recruiter dashboard loads', async ({ page }) => {
  5  |     await page.goto('/recruiter/dashboard')
> 6  |     await expect(page.locator('text=Dashboard, text=Overview, text=Jobs, text=Candidates, text=Analytics').first()).toBeVisible()
     |                                                                                                                     ^ Error: expect(locator).toBeVisible() failed
  7  |   })
  8  | 
  9  |   test('recruiter candidates page loads', async ({ page }) => {
  10 |     await page.goto('/recruiter/candidates')
  11 |     await expect(page.locator('text=Candidates, text=Search, text=Filter, text=Pipeline').first()).toBeVisible()
  12 |   })
  13 | 
  14 |   test('recruiter analytics page loads', async ({ page }) => {
  15 |     await page.goto('/recruiter/analytics')
  16 |     await expect(page.locator('text=Analytics, text=Funnel, text=Metrics, text=Velocity').first()).toBeVisible()
  17 |   })
  18 | 
  19 |   test('recruiter jobs page loads', async ({ page }) => {
  20 |     await page.goto('/recruiter/jobs')
  21 |     await expect(page.locator('text=Jobs, text=Active, text=Draft, text=Archived').first()).toBeVisible()
  22 |   })
  23 | 
  24 |   test('recruiter job create page loads', async ({ page }) => {
  25 |     await page.goto('/recruiter/jobs/new')
  26 |     await expect(page.locator('input[name="title"], input[placeholder*="Title"]').first()).toBeVisible()
  27 |   })
  28 | 
  29 |   test('recruiter screening page loads', async ({ page }) => {
  30 |     await page.goto('/recruiter/screening')
  31 |     await expect(page.locator('text=AI Screening, text=Review, text=Candidates').first()).toBeVisible()
  32 |   })
  33 | 
  34 |   test('recruiter company page loads', async ({ page }) => {
  35 |     await page.goto('/recruiter/company')
  36 |     await expect(page.locator('text=Company, text=Profile, text=Settings, text=Team').first()).toBeVisible()
  37 |   })
  38 | 
  39 |   test('recruiter trustscore page loads', async ({ page }) => {
  40 |     await page.goto('/recruiter/trustscore')
  41 |     await expect(page.locator('text=TrustScore, text=Verification, text=Compliance').first()).toBeVisible()
  42 |   })
  43 | })
  44 | 
```