---
name: stripe-payments
description: "Use Polsia's Stripe integration to create payment links and verify checkout payments without custom webhook setup."
---

# Stripe Payments

Accept payments using Polsia's Stripe integration. No SDK installation or webhook setup needed.

## Creating Payment Links

Use the Stripe MCP to create payment links:

```javascript
// Call MCP first, get URL, then use it
const result = await create_payment_link({ name: "Pro Plan", amount: 29 });
// Returns: { url: "https://buy.stripe.com/abc123" }
```

**CRITICAL - NO PLACEHOLDERS:**
- NEVER write `[STRIPE_URL]`, `TODO`, or placeholder text
- NEVER hardcode a fake URL
- Call Stripe MCP FIRST, get real URL, THEN write code

**Correct order:**
```
1. Call Stripe MCP → get "https://buy.stripe.com/abc123"
2. Write code: <a href="https://buy.stripe.com/abc123">Buy Now</a>
```

## Payment Verification

When customers return to your success page, verify the payment:

```javascript
app.get('/payment/success', async (req, res) => {
  const sessionId = req.query.checkout_session_id || req.query.session_id;
  if (!sessionId) {
    return res.redirect('/?error=missing_session');
  }

  // Verify payment with Polsia
  const response = await fetch(
    `${process.env.POLSIA_API_URL}/api/company-payments/verify?session_id=${sessionId}`,
    { headers: { 'Authorization': `Bearer ${process.env.POLSIA_API_KEY}` } }
  );
  const { verified, payment } = await response.json();

  if (verified) {
    // Mark user as paid in YOUR database
    await pool.query(
      'UPDATE users SET is_paid = true, plan = $1 WHERE email = $2',
      [payment.product_name, payment.customer_email]
    );
    res.render('payment-success', { email: payment.customer_email });
  } else {
    res.redirect('/?error=payment_not_verified');
  }
});
```

## Subscriptions (Recurring Payments)

For monthly recurring payments:

```javascript
// Create subscription link
const result = await create_subscription_link({ name: "Pro Plan", monthly_amount: 29 });
// Returns: { url: "https://buy.stripe.com/sub_xyz" }
```

Check subscription status on protected routes:

```javascript
async function requireSubscription(req, res, next) {
  const userEmail = req.session?.user?.email || req.user?.email;
  if (!userEmail) {
    return res.redirect('/login');
  }

  const response = await fetch(
    `${process.env.POLSIA_API_URL}/api/company-payments/subscription-status?email=${encodeURIComponent(userEmail)}`,
    { headers: { 'Authorization': `Bearer ${process.env.POLSIA_API_KEY}` } }
  );
  const { active, plan, current_period_end } = await response.json();

  if (!active) {
    return res.redirect('/pricing');
  }

  req.subscription = { plan, current_period_end };
  next();
}

// Use middleware on protected routes
app.get('/dashboard', requireSubscription, (req, res) => {
  res.render('dashboard', { subscription: req.subscription });
});
```

## Revenue Split

20% platform fee on withdrawals. Revenue is tracked in the Polsia dashboard.

## DO NOT

- Install Stripe SDK
- Implement Stripe webhooks
- Store card details
- Build custom payment flows

The platform handles all payment processing. Just use the MCP and verification endpoints.
