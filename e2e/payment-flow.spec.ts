import { test, expect } from '@playwright/test';
import { ensureAuth } from './helpers';

const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json';

const RECRUITER_CREDS = {
  email: 'e2e-recruiter@rekrutai.test',
  password: 'TestPass123!',
  role: 'recruiter' as const,
};

// Mock plan data so the pricing page shows Stripe as configured
const MOCK_PLANS = {
  stripeConfigured: true,
  plans: [
    {
      id: 'starter',
      name: 'Starter',
      description: 'For solo recruiters',
      monthlyAmount: 2900,
      yearlyAmount: 29000,
      popular: false,
      features: ['5 active jobs', 'Basic matching'],
      custom: false,
    },
    {
      id: 'growth',
      name: 'Growth',
      description: 'For growing teams',
      monthlyAmount: 7900,
      yearlyAmount: 79000,
      popular: true,
      features: ['Unlimited jobs', 'AI matching', 'OmniScore'],
      custom: false,
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      description: 'Custom solutions',
      monthlyAmount: null,
      yearlyAmount: null,
      popular: false,
      features: ['Dedicated support', 'SSO', 'Custom contracts'],
      custom: true,
    },
  ],
};

// HTML for a mocked Stripe Checkout page
const MOCK_STRIPE_HTML = `<!DOCTYPE html>
<html>
<head><title>Stripe Checkout</title></head>
<body>
  <h1>Stripe Checkout</h1>
  <label>Card number</label>
  <input name="cardnumber" placeholder="4242 4242 4242 4242" />
  <button id="submit-payment">Pay</button>
  <script>
    document.getElementById('submit-payment').onclick = function() {
      window.location.href = 'http://localhost:3000/payment-success?session_id=mock_session_123';
    };
  </script>
</body>
</html>`;

test.describe('Payment Flow', () => {
  test.use({ storageState: RECRUITER_STORAGE });

  test('recruiter completes upgrade payment end-to-end', async ({ page, request }) => {
    // Ensure auth is fresh (re-auth via API if storageState token expired)
    await ensureAuth(page, request, RECRUITER_STORAGE, RECRUITER_CREDS);

    // 1. Mock pricing plans so Stripe appears configured
    await page.route('/api/billing/plans', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PLANS),
      });
    });

    // 2. Mock checkout session creation
    await page.route('/api/billing/checkout-session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'mock_session_123',
          url: 'https://checkout.stripe.com/mock/cs_test_123',
        }),
      });
    });

    // 3. Mock Stripe Checkout page itself
    await page.route('https://checkout.stripe.com/mock/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: MOCK_STRIPE_HTML,
      });
    });

    // 4. Mock payment verification on success page
    await page.route('/api/auth/verify-payment?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, verified: true }),
      });
    });

    // Navigate to pricing
    await page.goto('/pricing');

    // Verify pricing page loads
    await expect(
      page.locator('h1').filter({ hasText: /Choose a plan/i })
    ).toBeVisible();

    // Verify Stripe is shown as configured (no warning banner)
    await expect(
      page.locator('text=Stripe Checkout is not configured')
    ).toHaveCount(0);

    // Click "Start checkout" on the Growth plan (the popular one)
    const growthCard = page.locator('.card, [class*="card"]').filter({
      hasText: 'Growth',
    });
    const checkoutBtn = growthCard
      .locator('button')
      .filter({ hasText: 'Start checkout' });

    // Click checkout and wait for the mocked redirect to Stripe
    await Promise.all([
      page.waitForURL('https://checkout.stripe.com/mock/**', { timeout: 10000 }),
      checkoutBtn.click(),
    ]);
    await expect(page.locator('text=Stripe Checkout')).toBeVisible();

    // Enter Stripe test card
    await page.fill('input[name="cardnumber"]', '4242 4242 4242 4242');

    // Complete payment (mocked redirect)
    await page.click('#submit-payment');

    // Should land on payment success page
    await page.waitForURL(/.*\/payment-success.*/, { timeout: 10000 });
    await expect(page.locator('text=Welcome to Pro!')).toBeVisible({
      timeout: 10000,
    });

    // Verify Pro features are listed
    await expect(page.locator('text=Full OmniScore')).toBeVisible();
    await expect(page.locator('text=Unlimited mock interviews')).toBeVisible();
  });
});
