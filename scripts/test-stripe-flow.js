const crypto = require('crypto');
const http = require('http');

const WEBHOOK_SECRET = 'whsec_test_1234567890abcdef';
const BASE_URL = 'http://localhost:3000';
const TEST_USER = {
  email: 'test-stripe@rekrutai.co',
  password: 'Test1234!'
};

function request(path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sendWebhook(payload) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = timestamp + '.' + body;
  const signature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(signedPayload, 'utf8')
    .digest('hex');

  return request('/api/billing/webhook', 'POST', {
    'stripe-signature': `t=${timestamp},v1=${signature}`
  }, payload);
}

async function runFullFlow() {
  console.log('🧪 Stripe Full Flow Test\n');

  // 1. Login
  console.log('1️⃣  Login...');
  const login = await request('/api/auth/login', 'POST', {}, TEST_USER);
  if (login.status !== 200 || !login.body.token) {
    console.log('❌ Login failed:', login.body);
    return process.exit(1);
  }
  const token = login.body.token;
  const userId = login.body.user.id;
  console.log('✅ Logged in as user', userId);

  // 2. Get subscription status (should be free)
  console.log('\n2️⃣  Get subscription status (before)...');
  const before = await request('/api/billing/subscription-status', 'GET', { 'Authorization': `Bearer ${token}` });
  console.log('   Status:', before.body.status, '| Plan:', before.body.plan, '| isPaid:', before.body.isPaid);

  // 3. Create checkout session
  console.log('\n3️⃣  Create checkout session...');
  const checkout = await request('/api/billing/checkout-session', 'POST', { 'Authorization': `Bearer ${token}` }, {
    planId: 'starter',
    billingCycle: 'monthly'
  });
  if (checkout.status !== 200 || !checkout.body.url) {
    console.log('❌ Checkout failed:', checkout.body);
    return process.exit(1);
  }
  const sessionId = checkout.body.id;
  console.log('✅ Checkout session created:', sessionId);

  // 4. Simulate webhook
  console.log('\n4️⃣  Simulate checkout.session.completed webhook...');
  const webhook = await sendWebhook({
    id: 'evt_test_flow',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        client_reference_id: String(userId),
        subscription: 'sub_test_flow',
        customer: 'cus_test_flow',
        amount_total: 2900,
        currency: 'usd',
        metadata: { plan_id: 'starter' }
      }
    }
  });
  console.log('   Webhook response:', webhook.status, webhook.body);

  // 5. Check subscription status (should be updated)
  console.log('\n5️⃣  Get subscription status (after webhook)...');
  const after = await request('/api/billing/subscription-status', 'GET', { 'Authorization': `Bearer ${token}` });
  console.log('   Status:', after.body.status, '| Plan:', after.body.plan, '| isPaid:', after.body.isPaid, '| SubID:', after.body.subscriptionId);

  if (after.body.isPaid === true && after.body.plan === 'starter' && after.body.subscriptionId === 'sub_test_flow') {
    console.log('\n✅ FULL FLOW PASSED: User subscription updated correctly via webhook');
  } else {
    console.log('\n⚠️  Subscription status did not update as expected. Check DB or webhook processing.');
  }

  // 6. Test cancel subscription (should fail since no real Stripe subscription)
  console.log('\n6️⃣  Test cancel subscription (expecting error)...');
  const cancel = await request('/api/billing/cancel-subscription', 'POST', { 'Authorization': `Bearer ${token}` }, {});
  console.log('   Cancel response:', cancel.status, cancel.body);

  // 7. Simulate subscription deletion webhook
  console.log('\n7️⃣  Simulate customer.subscription.deleted webhook...');
  const deleteWebhook = await sendWebhook({
    id: 'evt_test_delete',
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: 'sub_test_flow',
        customer: 'cus_test_flow'
      }
    }
  });
  console.log('   Delete webhook response:', deleteWebhook.status, deleteWebhook.body);

  // 8. Check subscription status again
  console.log('\n8️⃣  Get subscription status (after delete)...');
  const final = await request('/api/billing/subscription-status', 'GET', { 'Authorization': `Bearer ${token}` });
  console.log('   Status:', final.body.status, '| Plan:', final.body.plan, '| isPaid:', final.body.isPaid, '| SubID:', final.body.subscriptionId);

  if (final.body.isPaid === false && final.body.subscriptionId === null) {
    console.log('\n✅ CANCEL FLOW PASSED: Subscription correctly removed');
  } else {
    console.log('\n⚠️  Cancel flow did not update as expected.');
  }

  console.log('\n📊 Test Complete');
  process.exit(0);
}

runFullFlow().catch(err => {
  console.error('❌ Test error:', err.message);
  process.exit(1);
});
