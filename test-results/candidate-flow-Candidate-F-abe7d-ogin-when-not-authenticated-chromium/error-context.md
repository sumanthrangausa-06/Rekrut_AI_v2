# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: candidate-flow.spec.ts >> Candidate Flow >> candidate jobs redirects to login when not authenticated
- Location: e2e/candidate-flow.spec.ts:16:7

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /.*\/login/
Received string:  "http://localhost:3000/candidate/jobs"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    13 × unexpected value "http://localhost:3000/candidate/jobs"

```

```yaml
- text: "{\"error\":\"Application not ready\",\"message\":\"React build not found. Run: npm run build\"}"
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test.describe('Candidate Flow', () => {
  4  |   test('candidate dashboard redirects to login when not authenticated', async ({ page }) => {
  5  |     await page.goto('/candidate')
  6  |     await expect(page).toHaveURL(/.*\/login/)
  7  |     await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  8  |   })
  9  | 
  10 |   test('candidate profile redirects to login when not authenticated', async ({ page }) => {
  11 |     await page.goto('/candidate/profile')
  12 |     await expect(page).toHaveURL(/.*\/login/)
  13 |     await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  14 |   })
  15 | 
  16 |   test('candidate jobs redirects to login when not authenticated', async ({ page }) => {
  17 |     await page.goto('/candidate/jobs')
> 18 |     await expect(page).toHaveURL(/.*\/login/)
     |                        ^ Error: expect(page).toHaveURL(expected) failed
  19 |     await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  20 |   })
  21 | 
  22 |   test('candidate interviews redirects to login when not authenticated', async ({ page }) => {
  23 |     await page.goto('/candidate/interviews')
  24 |     await expect(page).toHaveURL(/.*\/login/)
  25 |     await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  26 |   })
  27 | 
  28 |   test('candidate assessments redirects to login when not authenticated', async ({ page }) => {
  29 |     await page.goto('/candidate/assessments')
  30 |     await expect(page).toHaveURL(/.*\/login/)
  31 |     await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  32 |   })
  33 | 
  34 |   test('candidate OmniScore redirects to login when not authenticated', async ({ page }) => {
  35 |     await page.goto('/candidate/omniscore')
  36 |     await expect(page).toHaveURL(/.*\/login/)
  37 |     await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  38 |   })
  39 | })
  40 | 
```