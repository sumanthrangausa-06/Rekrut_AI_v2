const express = require('express');
const fetch = require('node-fetch');
const crypto = require('node:crypto');
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

	const data = await response
		.json()
		.catch(async () => ({ error: { message: await response.text() } }));

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

	const data = await response
		.json()
		.catch(async () => ({ error: { message: await response.text() } }));

	if (!response.ok) {
		const message = data?.error?.message || 'Stripe request failed';
		const error = new Error(message);
		error.status = response.status;
		error.details = data;
		throw error;
	}

	return data;
}

router.get('/plans', (_req, res) => {
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
		res.status(error.status || 500).json({ error: 'Payment processing failed. Please try again.' });
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
		const subscriptionId =
			subscription?.id || (typeof session.subscription === 'string' ? session.subscription : null);
		const verified = session.status === 'complete' && session.payment_status === 'paid';
		let synced = false;
		let user = null;

		if (
			verified &&
			req.user &&
			(String(req.user.id) === String(session.client_reference_id || '') ||
				(session.customer_email &&
					req.user.email &&
					session.customer_email.toLowerCase() === req.user.email.toLowerCase()))
		) {
			const updateResult = await pool.query(
				`UPDATE users
         SET is_paid = true,
             stripe_subscription_id = $1,
             subscription_plan = $2,
             subscription_status = $3
         WHERE id = $4
         RETURNING id, email, name, role, company_name, is_paid, stripe_subscription_id, subscription_plan, subscription_status`,
				[
					subscriptionId,
					session.metadata?.plan_id || null,
					subscription?.status || session.status,
					req.user.id,
				],
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
		res.status(error.status || 500).json({ error: 'Payment processing failed. Please try again.' });
	}
});

function getStripeWebhookSecret() {
	return process.env.STRIPE_WEBHOOK_SECRET || '';
}

function verifyStripeSignature(payload, signatureHeader, secret) {
	if (!secret || !signatureHeader) return false;

	const elements = signatureHeader.split(',');
	const signatures = [];
	let timestamp = null;

	for (const element of elements) {
		const [key, value] = element.split('=');
		if (key === 't') timestamp = value;
		if (key === 'v1') signatures.push(value);
	}

	if (!timestamp || signatures.length === 0) return false;

	const signedPayload = `${timestamp}.${payload}`;
	const expectedSignature = crypto
		.createHmac('sha256', secret)
		.update(signedPayload, 'utf8')
		.digest('hex');

	for (const sig of signatures) {
		if (sig.length === expectedSignature.length) {
			try {
				const sigBuffer = Buffer.from(sig, 'hex');
				const expectedBuffer = Buffer.from(expectedSignature, 'hex');
				if (crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
					return true;
				}
			} catch (_e) {
				// Continue to next signature
			}
		}
	}
	return false;
}

router.post('/webhook', async (req, res) => {
	try {
		const secret = getStripeWebhookSecret();
		if (!secret) {
			return res.status(503).json({ error: 'Stripe webhook secret is not configured.' });
		}

		const payload = req.body instanceof Buffer ? req.body.toString('utf8') : req.body;
		const sig = req.headers['stripe-signature'] || '';

		if (!verifyStripeSignature(payload, sig, secret)) {
			return res.status(400).json({ error: 'Invalid signature.' });
		}

		const event = JSON.parse(payload);
		const eventType = event.type;

		console.log('[billing] webhook received:', eventType, event.id);

		try {
			switch (eventType) {
				case 'checkout.session.completed': {
					const session = event.data?.object;
					if (session?.client_reference_id) {
						const subscriptionId =
							typeof session.subscription === 'string'
								? session.subscription
								: session.subscription?.id || null;
						await pool.query(
							`UPDATE users
               SET is_paid = true,
                   stripe_subscription_id = $1,
                   subscription_plan = $2,
                   subscription_status = $3
               WHERE id = $4`,
							[
								subscriptionId,
								session.metadata?.plan_id || null,
								'active',
								session.client_reference_id,
							],
						);
					}
					break;
				}
				case 'invoice.payment_succeeded': {
					const invoice = event.data?.object;
					if (invoice?.subscription) {
						await pool.query(
							`UPDATE users SET subscription_status = $1 WHERE stripe_subscription_id = $2`,
							[
								'active',
								typeof invoice.subscription === 'string'
									? invoice.subscription
									: invoice.subscription?.id,
							],
						);
					}
					break;
				}
				case 'invoice.payment_failed': {
					const invoice = event.data?.object;
					if (invoice?.subscription) {
						await pool.query(
							`UPDATE users SET subscription_status = $1 WHERE stripe_subscription_id = $2`,
							[
								'past_due',
								typeof invoice.subscription === 'string'
									? invoice.subscription
									: invoice.subscription?.id,
							],
						);
					}
					break;
				}
				case 'customer.subscription.deleted': {
					const subscription = event.data?.object;
					if (subscription?.id) {
						await pool.query(
							`UPDATE users
               SET is_paid = false,
                   subscription_status = $1,
                   stripe_subscription_id = NULL
               WHERE stripe_subscription_id = $2`,
							['cancelled', subscription.id],
						);
					}
					break;
				}
			}
		} catch (dbError) {
			console.error('[billing] webhook DB error:', dbError.message);
			// Return 200 to prevent Stripe retries, but log the error
		}

		res.json({ received: true });
	} catch (error) {
		console.error('[billing] webhook error:', error.message);
		res.status(500).json({ error: 'Webhook processing failed.' });
	}
});

router.get('/subscription-status', optionalAuth, async (req, res) => {
	try {
		if (!req.user) {
			return res.status(401).json({ error: 'Authentication required.' });
		}

		const result = await pool.query(
			`SELECT id, email, is_paid, stripe_subscription_id, subscription_plan, subscription_status
       FROM users WHERE id = $1`,
			[req.user.id],
		);

		const user = result.rows[0];
		if (!user) {
			return res.status(404).json({ error: 'User not found.' });
		}

		let stripeData = null;
		if (req.query.refresh === '1' && user.stripe_subscription_id && getStripeSecret()) {
			try {
				stripeData = await stripeGet(`/subscriptions/${user.stripe_subscription_id}`);
			} catch (e) {
				console.error('[billing] refresh subscription from Stripe failed:', e.message);
			}
		}

		res.json({
			isPaid: user.is_paid,
			subscriptionId: user.stripe_subscription_id,
			plan: user.subscription_plan,
			status: user.subscription_status || 'inactive',
			stripeLive: stripeData,
		});
	} catch (error) {
		console.error('[billing] subscription-status error:', error.message);
		res.status(500).json({ error: 'Failed to fetch subscription status.' });
	}
});

router.post('/cancel-subscription', optionalAuth, async (req, res) => {
	try {
		if (!req.user) {
			return res.status(401).json({ error: 'Authentication required.' });
		}

		if (!getStripeSecret()) {
			return res.status(503).json({ error: 'Stripe is not configured yet.' });
		}

		const userResult = await pool.query(`SELECT stripe_subscription_id FROM users WHERE id = $1`, [
			req.user.id,
		]);

		const subscriptionId = userResult.rows[0]?.stripe_subscription_id;
		if (!subscriptionId) {
			return res.status(400).json({ error: 'No active subscription found.' });
		}

		const deleted = await stripePost(`/subscriptions/${subscriptionId}`, {
			cancel_at_period_end: 'true',
		});

		await pool.query(`UPDATE users SET subscription_status = $1 WHERE id = $2`, [
			'cancelled',
			req.user.id,
		]);

		res.json({
			cancelled: true,
			subscriptionId: deleted.id,
			status: deleted.status,
			cancelAtPeriodEnd: deleted.cancel_at_period_end,
		});
	} catch (error) {
		console.error('[billing] cancel-subscription error:', error.message);
		res
			.status(error.status || 500)
			.json({ error: 'Failed to cancel subscription. Please try again.' });
	}
});

module.exports = router;
