import { test, expect } from '@playwright/test'

test.describe('Stripe Payment Flow', () => {
  test('pricing page loads and displays plans', async ({ page }) => {
    await page.goto('/pricing')
    await expect(page).toHaveURL(/.*\/pricing/)

    // Main heading
    await expect(page.getByRole('heading', { name: /Choose a plan/i })).toBeVisible()

    // Plans should load
    await expect(page.getByText('Starter')).toBeVisible()
    await expect(page.getByText('Growth')).toBeVisible()
    await expect(page.getByText('Enterprise')).toBeVisible()

    // Billing cycle toggle
    await expect(page.getByRole('button', { name: /Monthly/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Yearly/i })).toBeVisible()
  })

  test('checkout button triggers billing API and redirects to Stripe', async ({ page }) => {
    // Intercept the checkout-session API to avoid needing real Stripe keys
    let checkoutCalled = false
    let checkoutPayload: any = null

    await page.route('**/api/billing/checkout-session', async (route) => {
      checkoutCalled = true
      checkoutPayload = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'mock_session_123', url: 'https://checkout.stripe.com/test/mock' }),
      })
    })

    await page.goto('/pricing')

    // Wait for plans to load
    await expect(page.getByText('Starter')).toBeVisible()

    // Click the checkout button on the Growth plan (the popular one)
    const growthCard = page.locator('.relative').filter({ hasText: 'Growth' }).first()
    const checkoutButton = growthCard.getByRole('button', { name: /Start checkout/i })

    // If Stripe is not configured, the button will be disabled — test the warning instead
    const isDisabled = await checkoutButton.isDisabled().catch(() => true)
    if (isDisabled) {
      // Verify the Stripe-not-configured warning is shown
      await expect(page.getByText(/Stripe Checkout is not configured/i)).toBeVisible()
      test.info().annotations.push({ type: 'skip-reason', description: 'Stripe not configured — checkout button disabled' })
      return
    }

    await checkoutButton.click()

    // Wait for the API call to be made
    await page.waitForTimeout(500)
    expect(checkoutCalled).toBe(true)
    expect(checkoutPayload).toMatchObject({
      planId: expect.any(String),
      billingCycle: expect.any(String),
    })
  })

  test('payment success page renders and verifies session', async ({ page }) => {
    // Intercept the verify-payment API call on the success page
    await page.route('**/api/auth/verify-payment?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ verified: true }),
      })
    })

    await page.goto('/payment-success?session_id=mock_session_123')

    // Should show success content after verification completes
    await expect(page.getByRole('heading', { name: /Welcome to Pro/i })).toBeVisible()
    await expect(page.getByText('Your payment was successful')).toBeVisible()

    // Verify unlocked features are listed
    await expect(page.getByText('Full OmniScore (all factors)')).toBeVisible()
    await expect(page.getByText('Unlimited mock interviews')).toBeVisible()
    await expect(page.getByText('Shareable score badge')).toBeVisible()

    // Dashboard button should be present
    await expect(page.getByRole('button', { name: /Go to Dashboard/i })).toBeVisible()
  })

  test('payment success page handles missing session_id gracefully', async ({ page }) => {
    await page.goto('/payment-success')

    // Without session_id the page shows an error state
    await expect(page.getByText(/No session ID found/i)).toBeVisible()
  })

  test('subscription status API requires authentication', async ({ page }) => {
    const response = await page.request.get('/api/billing/subscription-status')
    expect(response.status()).toBe(401)
  })

  test('cancel subscription API requires authentication', async ({ page }) => {
    const response = await page.request.post('/api/billing/cancel-subscription')
    expect([401, 403]).toContain(response.status())
  })

  test('pricing page shows checkout canceled message', async ({ page }) => {
    await page.goto('/pricing?canceled=1')
    await expect(page).toHaveURL(/.*\/pricing.*canceled=1/)

    // Should show the cancellation message
    await expect(page.getByText(/Checkout canceled/i)).toBeVisible()
  })

  test('pricing page shows checkout success confirmation state', async ({ page }) => {
    // Intercept the confirm-session API
    await page.route('**/api/billing/confirm-session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          verified: true,
          synced: true,
          planId: 'growth',
          billingCycle: 'monthly',
          subscriptionId: 'sub_mock_123',
          subscriptionStatus: 'active',
        }),
      })
    })

    await page.goto('/pricing?success=1&session_id=mock_session_123')
    await expect(page).toHaveURL(/.*\/pricing.*success=1/)

    // Should show confirmation state
    await expect(page.getByText(/Confirming your payment/i)).toBeVisible()

    // Wait for API response to be processed
    await page.waitForTimeout(800)
    await expect(page.getByText(/Payment confirmed/i)).toBeVisible()
  })
})
