# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: payments.spec.ts >> Payment Flow >> pricing page loads
- Location: e2e/payments.spec.ts:4:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=Pricing, text=Plan, text=Starter, text=Growth, text=Enterprise').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('text=Pricing, text=Plan, text=Starter, text=Growth, text=Enterprise').first()

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
  - status: Request failed
  - alert:
    - text: Stripe Checkout is not configured yet. Add
    - code: STRIPE_SECRET_KEY
    - text: in Settings > Advanced to enable checkout.
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
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test.describe('Payment Flow', () => {
  4  |   test('pricing page loads', async ({ page }) => {
  5  |     await page.goto('/pricing')
> 6  |     await expect(page.locator('text=Pricing, text=Plan, text=Starter, text=Growth, text=Enterprise').first()).toBeVisible()
     |                                                                                                               ^ Error: expect(locator).toBeVisible() failed
  7  |   })
  8  | 
  9  |   test('payment success page loads', async ({ page }) => {
  10 |     await page.goto('/payment-success?session_id=test')
  11 |     await expect(page.locator('text=Success, text=Payment, text=Thank').first()).toBeVisible()
  12 |   })
  13 | })
  14 | 
```