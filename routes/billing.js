const express = require('express');
const fetch = require('node-fetch');
const pool = require('../lib/db');
const { optionalAuth } = require('../lib/auth');

const router = express.Router();

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'For small teams that want a polished hiring workflow.',
    monthlyAmount: 2900,
    yearlyAmount: 29000,
    popular: false,
    highlight: 'Lean and fast',
    features: [
      '3 active job posts',
      'Candidate screening tools',
      'Basic analytics dashboard',
      'Email support',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    description: 'For teams scaling hiring across multiple roles.',
    monthlyAmount: 7900,
    yearlyAmount: 79000,
    popular: true,
    highlight: 'Most popular',
    features: [
      'Unlimited active jobs',
      'Advanced analytics',
      'Interview and onboarding workflows',
      'Priority support',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Custom rollout for larger teams and more complex hiring ops.',
    custom: true,
    highlight: 'Custom pricing',
    features: [
      'Custom workflow design',
      'SSO and security review',
      'Dedicated onboarding',
      'Custom contract terms',
    ],
  },
];

function getStripeSecret() {
  return process.env.STRIPE_SECRET_KEY || '';
}

function getFrontendBaseUrl(req) {
  return process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
}

function publicPlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    monthlyAmount: plan.monthlyAmount || null,
    yearlyAmount: plan.yearlyAmount || null,
    popular: !!plan.popular,
    highlight: plan.highlight,
    features: plan.features,
    custom: !!plan.custom,
  };
}

async function stripePost(path, body) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getStripeSecret()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });

  const data = await response.json().catch(async () => ({ error: { message: await response.text() } }));

  if (!response.ok) {
    const message = data?.error?.message || 'Stripe request failed';
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function stripeGet(path) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${getStripeSecret()}`,
    },
  });

  const data = await response.json().catch(async () => ({ error: { message: await response.text() } }));

  if (!response.ok) {
    const message = data?.error?.message || 'Stripe request failed';
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

router.get('/plans', (req, res) => {
  res.json({
    stripeConfigured: !!getStripeSecret(),
    plans: PLANS.map(publicPlan),
  });
});

router.post('/checkout-session', optionalAuth, async (req, res) => {
  try {
    if (!getStripeSecret()) {
      return res.status(503).json({ error: 'Stripe is not configured yet.' });
    }

    const { planId, billingCycle = 'monthly' } = req.body || {};
    const plan = PLANS.find((item) => item.id === planId);

    if (!plan) {
      return res.status(400).json({ error: 'Unknown plan selected.' });
    }

    if (plan.custom) {
      return res.status(400).json({ error: 'Enterprise plans use custom pricing.' });
    }

    if (!['monthly', 'yearly'].includes(billingCycle)) {
      return res.status(400).json({ error: 'Invalid billing cycle.' });
    }

    const amount = billingCycle === 'yearly' ? plan.yearlyAmount : plan.monthlyAmount;
    const interval = billingCycle === 'yearly' ? 'year' : 'month';
    const baseUrl = getFrontendBaseUrl(req);

    const body = {
      mode: 'subscription',
      success_url: `${baseUrl}/pricing?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pricing?canceled=1`,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amount),
      'line_items[0][price_data][recurring][interval]': interval,
      'line_items[0][price_data][product_data][name]': `${plan.name} - Rekrut AI`,
      'line_items[0][price_data][product_data][description]': plan.description,
      'metadata[plan_id]': plan.id,
      'metadata[billing_cycle]': billingCycle,
      'metadata[plan_name]': plan.name,
      allow_promotion_codes: 'true',
      billing_address_collection: 'required',
    };

    if (req.user?.id) {
      body.client_reference_id = String(req.user.id);
      body.customer_email = req.user.email;
    }

    const session = await stripePost('/checkout/sessions', body);

    res.json({
      id: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('[billing] checkout-session error:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to create checkout session.' });
  }
});

router.post('/confirm-session', optionalAuth, async (req, res) => {
  try {
    if (!getStripeSecret()) {
      return res.status(503).json({ error: 'Stripe is not configured yet.' });
    }

    const { session_id } = req.body || {};
    if (!session_id) {
      return res.status(400).json({ error: 'session_id is required.' });
    }

    const session = await stripeGet(`/checkout/sessions/${session_id}?expand[]=subscription`);
    const subscription = typeof session.subscription === 'object' ? session.subscription : null;
    const subscriptionId = subscription?.id || (typeof session.subscription === 'string' ? session.subscription : null);
    const verified = session.status === 'complete' && session.payment_status === 'paid';
    let synced = false;
    let user = null;

    if (verified && req.user && (String(req.user.id) === String(session.client_reference_id || '') || (session.customer_email && req.user.email && session.customer_email.toLowerCase() === req.user.email.toLowerCase()))) {
      const updateResult = await pool.query(
        `UPDATE users
         SET is_paid = true,
             stripe_subscription_id = $1,
             subscription_plan = $2,
             subscription_status = $3
         WHERE id = $4
         RETURNING id, email, name, role, company_name, is_paid, stripe_subscription_id, subscription_plan, subscription_status`,
        [subscriptionId, session.metadata?.plan_id || null, subscription?.status || session.status, req.user.id]
      );

      user = updateResult.rows[0] || null;
      synced = !!user;
    }

    res.json({
      verified,
      synced,
      sessionId: session.id,
      planId: session.metadata?.plan_id || null,
      billingCycle: session.metadata?.billing_cycle || null,
      subscriptionId,
      subscriptionStatus: subscription?.status || session.status,
      user,
    });
  } catch (error) {
    console.error('[billing] confirm-session error:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to confirm session.' });
  }
});

module.exports = router;
