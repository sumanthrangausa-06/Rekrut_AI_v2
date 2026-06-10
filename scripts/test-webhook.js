if (process.env.NODE_ENV === 'production') {
  throw new Error('Test scripts cannot run in production');
}

const crypto = require('node:crypto');
const http = require('node:http');

const WEBHOOK_SECRET = 'whsec_test_1234567890abcdef';

function sendWebhook(_eventType, payload) {
	const body = JSON.stringify(payload);
	const timestamp = Math.floor(Date.now() / 1000);
	const signedPayload = `${timestamp}.${body}`;
	const signature = crypto
		.createHmac('sha256', WEBHOOK_SECRET)
		.update(signedPayload, 'utf8')
		.digest('hex');

	const stripeSignature = `t=${timestamp},v1=${signature}`;

	const options = {
		hostname: 'localhost',
		port: 3000,
		path: '/api/billing/webhook',
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'stripe-signature': stripeSignature,
		},
	};

	return new Promise((resolve, reject) => {
		const req = http.request(options, (res) => {
			let body = '';
			res.on('data', (chunk) => (body += chunk));
			res.on('end', () => {
				resolve({ status: res.statusCode, body: JSON.parse(body) });
			});
		});

		req.on('error', reject);
		req.write(body);
		req.end();
	});
}

async function runTests() {
	const tests = [
		{
			name: 'checkout.session.completed',
			payload: {
				id: 'evt_test_checkout',
				type: 'checkout.session.completed',
				data: {
					object: {
						id: 'cs_test_123',
						client_reference_id: '1',
						subscription: 'sub_test_123',
						customer: 'cus_test_123',
						amount_total: 1900,
						currency: 'usd',
						metadata: { plan_id: 'pro_monthly' },
					},
				},
			},
		},
		{
			name: 'invoice.payment_succeeded',
			payload: {
				id: 'evt_test_invoice_success',
				type: 'invoice.payment_succeeded',
				data: {
					object: {
						id: 'in_test_123',
						subscription: 'sub_test_123',
					},
				},
			},
		},
		{
			name: 'invoice.payment_failed',
			payload: {
				id: 'evt_test_invoice_failed',
				type: 'invoice.payment_failed',
				data: {
					object: {
						id: 'in_test_456',
						subscription: 'sub_test_123',
					},
				},
			},
		},
		{
			name: 'customer.subscription.deleted',
			payload: {
				id: 'evt_test_cancelled',
				type: 'customer.subscription.deleted',
				data: {
					object: {
						id: 'sub_test_123',
						customer: 'cus_test_123',
					},
				},
			},
		},
	];

	let passed = 0;
	let failed = 0;

	for (const test of tests) {
		try {
			const result = await sendWebhook(test.name, test.payload);
			if (result.status === 200 && result.body.received === true) {
				console.log(`✅ ${test.name}: PASSED`);
				passed++;
			} else {
				console.log(`❌ ${test.name}: FAILED (status ${result.status})`);
				console.log('   Body:', result.body);
				failed++;
			}
		} catch (err) {
			console.log(`❌ ${test.name}: ERROR - ${err.message}`);
			failed++;
		}
	}

	console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${tests.length} tests`);
	process.exit(failed > 0 ? 1 : 0);
}

runTests();
