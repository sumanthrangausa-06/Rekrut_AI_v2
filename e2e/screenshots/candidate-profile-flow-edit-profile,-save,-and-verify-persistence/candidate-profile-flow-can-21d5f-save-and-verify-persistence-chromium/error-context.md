# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: candidate-profile-flow.spec.ts >> candidate profile flow >> edit profile, save, and verify persistence
- Location: e2e/candidate-profile-flow.spec.ts:6:7

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Settings' })

```

# Page snapshot

```yaml
- generic [ref=e2]: "{\"error\":\"Application not ready\",\"message\":\"React build not found. Run: npm run build\"}"
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test.use({ storageState: 'e2e/.auth/candidate.json' })
  4  | 
  5  | test.describe('candidate profile flow', () => {
  6  |   test('edit profile, save, and verify persistence', async ({ page }) => {
  7  |     await page.goto('/candidate/profile')
  8  |     await page.waitForURL('/candidate/profile')
  9  | 
  10 |     // Click the Settings tab to reveal the form
> 11 |     await page.getByRole('button', { name: 'Settings' }).click()
     |                                                          ^ Error: locator.click: Test timeout of 60000ms exceeded.
  12 | 
  13 |     // Wait for the form to be visible using the Personal Information heading
  14 |     await expect(page.getByRole('heading', { name: 'Personal Information' })).toBeVisible({ timeout: 10000 })
  15 | 
  16 |     // Fill in profile fields with unique values
  17 |     const headline = 'E2E QA Engineer ' + Date.now()
  18 |     await page.locator('input[placeholder="Senior Software Engineer"]').fill(headline)
  19 |     await page.locator('textarea[placeholder="Brief professional summary..."]').fill('Experienced in end-to-end testing and automation.')
  20 |     await page.locator('input[placeholder="San Francisco, CA"]').fill('San Francisco, CA')
  21 |     await page.locator('input[placeholder="+1 (555) 000-0000"]').fill('+1 (555) 123-4567')
  22 | 
  23 |     // Save profile
  24 |     await page.getByRole('button', { name: 'Save Changes' }).click()
  25 | 
  26 |     // Verify success toast appears
  27 |     await expect(page.getByText('Profile saved')).toBeVisible({ timeout: 10000 })
  28 | 
  29 |     // Reload and verify persistence
  30 |     await page.reload()
  31 |     await page.getByRole('button', { name: 'Settings' }).click()
  32 |     await expect(page.getByRole('heading', { name: 'Personal Information' })).toBeVisible({ timeout: 10000 })
  33 |     await expect(page.locator('input[placeholder="Senior Software Engineer"]')).toHaveValue(headline)
  34 |     await expect(page.locator('textarea[placeholder="Brief professional summary..."]')).toHaveValue('Experienced in end-to-end testing and automation.')
  35 |     await expect(page.locator('input[placeholder="San Francisco, CA"]')).toHaveValue('San Francisco, CA')
  36 |     await expect(page.locator('input[placeholder="+1 (555) 000-0000"]')).toHaveValue('+1 (555) 123-4567')
  37 |   })
  38 | })
  39 | 
```