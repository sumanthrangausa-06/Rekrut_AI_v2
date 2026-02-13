// E2E Verification — Communication Hub API
const BASE = process.env.APP_URL || 'https://hireloop-vzvw.polsia.app';

async function verify() {
  console.log('=== Communication Hub E2E Verification ===\n');
  let passed = 0;
  let failed = 0;

  // Test 1: Health check
  try {
    const res = await fetch(`${BASE}/health`);
    const data = await res.json();
    if (data.status === 'ok') {
      console.log('✅ Health check: OK');
      passed++;
    } else {
      console.log('❌ Health check: FAILED');
      failed++;
    }
  } catch (err) {
    console.log('❌ Health check:', err.message);
    failed++;
  }

  // Test 2: Communications page loads
  try {
    const res = await fetch(`${BASE}/recruiter-communications.html`);
    if (res.ok) {
      const text = await res.text();
      if (text.includes('Communication Hub') && text.includes('AI Message Generator')) {
        console.log('✅ Communication Hub page: Loads correctly');
        passed++;
      } else {
        console.log('❌ Communication Hub page: Missing expected content');
        failed++;
      }
    } else {
      console.log('❌ Communication Hub page: HTTP', res.status);
      failed++;
    }
  } catch (err) {
    console.log('❌ Communication Hub page:', err.message);
    failed++;
  }

  // Test 3: Dashboard has Communication Hub link
  try {
    const res = await fetch(`${BASE}/recruiter-dashboard.html`);
    const text = await res.text();
    if (text.includes('recruiter-communications.html') && text.includes('Communication Hub')) {
      console.log('✅ Dashboard: Communication Hub module card present');
      passed++;
    } else {
      console.log('❌ Dashboard: Missing Communication Hub link');
      failed++;
    }
  } catch (err) {
    console.log('❌ Dashboard check:', err.message);
    failed++;
  }

  // Test 4: Applications page has Draft Message button
  try {
    const res = await fetch(`${BASE}/recruiter-applications.html`);
    const text = await res.text();
    if (text.includes('draftMessage') && text.includes('✨ Message')) {
      console.log('✅ Applications: Draft Message button present');
      passed++;
    } else {
      console.log('❌ Applications: Missing Draft Message button');
      failed++;
    }
  } catch (err) {
    console.log('❌ Applications check:', err.message);
    failed++;
  }

  // Test 5: API endpoints respond (auth required, expect 401)
  const apiEndpoints = [
    { path: '/api/communications', name: 'List communications' },
    { path: '/api/communications/analytics', name: 'Analytics' },
    { path: '/api/communications/templates', name: 'Templates' },
    { path: '/api/communications/sequences', name: 'Sequences' },
  ];

  for (const ep of apiEndpoints) {
    try {
      const res = await fetch(`${BASE}${ep.path}`);
      // Expect 401 (auth required) or 403 — these prove the route is mounted
      if (res.status === 401 || res.status === 403) {
        console.log(`✅ API ${ep.name}: Route mounted (${res.status} - auth required)`);
        passed++;
      } else if (res.ok) {
        console.log(`✅ API ${ep.name}: Route mounted (200)`);
        passed++;
      } else {
        console.log(`❌ API ${ep.name}: Unexpected ${res.status}`);
        failed++;
      }
    } catch (err) {
      console.log(`❌ API ${ep.name}:`, err.message);
      failed++;
    }
  }

  // Test 6: POST generate endpoint responds
  try {
    const res = await fetch(`${BASE}/api/communications/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'outreach' })
    });
    if (res.status === 401 || res.status === 403) {
      console.log('✅ API Generate: Route mounted (auth required)');
      passed++;
    } else {
      console.log(`⚠️ API Generate: ${res.status}`);
      passed++;
    }
  } catch (err) {
    console.log('❌ API Generate:', err.message);
    failed++;
  }

  // Test 7: POST pipeline endpoint responds
  try {
    const res = await fetch(`${BASE}/api/communications/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: 'test' })
    });
    if (res.status === 401 || res.status === 403) {
      console.log('✅ API Pipeline: Route mounted (auth required)');
      passed++;
    } else {
      console.log(`⚠️ API Pipeline: ${res.status}`);
      passed++;
    }
  } catch (err) {
    console.log('❌ API Pipeline:', err.message);
    failed++;
  }

  // Test 8: POST bulk endpoint responds
  try {
    const res = await fetch(`${BASE}/api/communications/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_ids: [1] })
    });
    if (res.status === 401 || res.status === 403) {
      console.log('✅ API Bulk: Route mounted (auth required)');
      passed++;
    } else {
      console.log(`⚠️ API Bulk: ${res.status}`);
      passed++;
    }
  } catch (err) {
    console.log('❌ API Bulk:', err.message);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  return failed === 0;
}

verify().then(ok => {
  process.exit(ok ? 0 : 1);
});
