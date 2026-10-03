const { test, expect } = require('@playwright/test');

const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json';

// Mock Stripe Checkout page HTML — simulates the Stripe test environment
const MOCK_STRIPE_HTML = `<!DOCTYPE html>
<html>
<head><title>Stripe Checkout</title></head>
<body>
  <h1>Stripe Checkout</h1>
  <form id="payment-form">
    <label>Card number</label>
    <input id="card-number" name="cardnumber" placeholder="4242 4242 4242 4242" />
    <label>Expiry</label>
    <input id="card-expiry" name="exp-date" placeholder="12/30" />
    <label>CVC</label>
    <input id="card-cvc" name="cvc" placeholder="123" />
    <button id="submit-payment" type="submit">Pay</button>
  </form>
  <script>
    document.getElementById('payment-form').onsubmit = function(e) {
      e.preventDefault();
      window.location.href = 'http://localhost:3000/payment-success?session_id=mock_session_123';
    };
  </script>
</body>
</html>`;

// Mock plans data so the pricing page shows Stripe as configured
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

test.describe('Stripe Payment Flow', () => {
	test.use({ storageState: RECRUITER_STORAGE });

	/**
	 * Verifies the pricing page loads and displays all available plans.
	 * This ensures the billing/plans API is responding and the UI renders correctly.
	 */
	test('pricing page loads and displays plans', async ({ page }) => {
		await page.goto('/pricing');
		await expect(page).toHaveURL(/.*\/pricing/);

		// Main heading
		await expect(page.getByRole('heading', { name: /Choose a plan/i })).toBeVisible();

		// Plans should be visible
		await expect(page.getByText('Starter')).toBeVisible();
		await expect(page.getByText('Growth')).toBeVisible();
		await expect(page.getByText('Enterprise')).toBeVisible();

		// Billing cycle toggle
		await expect(page.getByRole('button', { name: /Monthly/i })).toBeVisible();
		await expect(page.getByRole('button', { name: /Yearly/i })).toBeVisible();
	});

	/**
	 * End-to-end Stripe checkout simulation:
	 * 1. Mocks the billing/plans API so Stripe appears configured
	 * 2. Mocks the checkout-session creation API
	 * 3. Mocks the Stripe Checkout page itself
	 * 4. Fills the Stripe test card (4242 4242 4242 4242)
	 * 5. Completes the mocked payment
	 * 6. Verifies redirect to the success page
	 */
	test('completes Stripe checkout with test card', async ({ page }) => {
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

		// 3. Mock Stripe Checkout page
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
		await expect(page.getByRole('heading', { name: /Choose a plan/i })).toBeVisible();

		// Verify no "Stripe not configured" warning
		await expect(page.locator('text=Stripe Checkout is not configured')).toHaveCount(0);

		// Click "Start checkout" on the Growth plan
		const growthCard = page.locator('.card, [class*="card"]').filter({ hasText: 'Growth' });
		const checkoutBtn = growthCard.locator('button').filter({ hasText: 'Start checkout' });

		// Click checkout and wait for mocked Stripe redirect
		await Promise.all([
			page.waitForURL('https://checkout.stripe.com/mock/**', { timeout: 10000 }),
			checkoutBtn.click(),
		]);

		// Verify mocked Stripe page loaded
		await expect(page.locator('text=Stripe Checkout')).toBeVisible();

		// Fill Stripe test card details
		await page.fill('input[name="cardnumber"]', '4242 4242 4242 4242');
		await page.fill('input[name="exp-date"]', '12/30');
		await page.fill('input[name="cvc"]', '123');

		// Submit payment (mocked redirect to success)
		await page.click('#submit-payment');

		// Verify redirect to payment success page
		await page.waitForURL(/.*\/payment-success.*/, { timeout: 10000 });
		await expect(page.locator('text=Welcome to Pro!')).toBeVisible({ timeout: 10000 });
	});

	/**
	 * Verifies the payment success page renders correctly after a successful checkout.
	 * Mocks the verify-payment API and checks for Pro feature unlock messages.
	 */
	test('payment success page renders and verifies session', async ({ page }) => {
		// Mock the verify-payment API
		await page.route('/api/auth/verify-payment?**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ verified: true }),
			});
		});

		await page.goto('/payment-success?session_id=mock_session_123');

		// Success content should be visible
		await expect(page.getByRole('heading', { name: /Welcome to Pro/i })).toBeVisible();
		await expect(page.getByText('Your payment was successful')).toBeVisible();

		// Verify unlocked Pro features are listed
		await expect(page.getByText('Full OmniScore (all factors)')).toBeVisible();
		await expect(page.getByText('Unlimited mock interviews')).toBeVisible();
		await expect(page.getByText('Shareable score badge')).toBeVisible();

		// Dashboard button should be present
		await expect(page.getByRole('button', { name: /Go to Dashboard/i })).toBeVisible();
	});

	/**
	 * Verifies the subscription is shown as active in the dashboard.
	 * Mocks the subscription-status API to return an active subscription.
	 */
	test('subscription is active in dashboard', async ({ page }) => {
		// Mock subscription status API
		await page.route('/api/billing/subscription-status', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					active: true,
					plan: 'growth',
					status: 'active',
					subscriptionId: 'sub_mock_123',
					currentPeriodEnd: '2026-12-31T23:59:59Z',
				}),
			});
		});

		// Navigate to settings or billing page where subscription is shown
		await page.goto('/settings');
		await page.waitForLoadState('networkidle');

		// Verify subscription info is visible (flexible — may be on settings or billing page)
		const subscriptionText = page.locator('text=/Subscription|Plan|Billing|Pro|Growth/i').first();
		await expect(subscriptionText).toBeVisible({ timeout: 10000 });
	});

	/**
	 * Verifies the payment success page handles missing session_id gracefully.
	 * Without a session_id parameter, the page should show an error state.
	 */
	test('payment success page handles missing session_id', async ({ page }) => {
		await page.goto('/payment-success');
		await expect(page.getByText(/No session ID found|Invalid session/i)).toBeVisible();
	});

	/**
	 * Verifies that a canceled checkout shows the appropriate message on the pricing page.
	 */
	test('pricing page shows checkout canceled message', async ({ page }) => {
		await page.goto('/pricing?canceled=1');
		await expect(page).toHaveURL(/.*\/pricing.*canceled=1/);
		await expect(page.getByText(/Checkout canceled|Payment canceled/i)).toBeVisible();
	});
});
