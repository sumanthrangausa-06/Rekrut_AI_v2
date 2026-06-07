# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: payments.spec.ts >> Payment Flow >> payment success page loads
- Location: e2e/payments.spec.ts:9:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=Success, text=Payment, text=Thank').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('text=Success, text=Payment, text=Thank').first()

```

```yaml
- text: 🎉
- heading "Welcome to Pro!" [level=1]
- paragraph: Your payment was successful. You now have unlimited access to all Rekrut AI features.
- heading "What's unlocked:" [level=3]
- list:
  - listitem:
    - img
    - text: Full OmniScore (all factors)
  - listitem:
    - img
    - text: Unlimited mock interviews
  - listitem:
    - img
    - text: Role-specific score variants
  - listitem:
    - img
    - text: Shareable score badge
  - listitem:
    - img
    - text: Detailed improvement tips
- button "Go to Dashboard":
  - text: Go to Dashboard
  - img
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test.describe('Payment Flow', () => {
  4  |   test('pricing page loads', async ({ page }) => {
  5  |     await page.goto('/pricing')
  6  |     await expect(page.locator('text=Pricing, text=Plan, text=Starter, text=Growth, text=Enterprise').first()).toBeVisible()
  7  |   })
  8  | 
  9  |   test('payment success page loads', async ({ page }) => {
  10 |     await page.goto('/payment-success?session_id=test')
> 11 |     await expect(page.locator('text=Success, text=Payment, text=Thank').first()).toBeVisible()
     |                                                                                  ^ Error: expect(locator).toBeVisible() failed
  12 |   })
  13 | })
  14 | 
```