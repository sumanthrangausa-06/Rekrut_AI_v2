async function testNewEndpoints() {
  try {
    // Candidate login
    const loginRes = await fetch('https://rekrutai-dev.onrender.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test_candidate@rekrutai.co', password: 'Test123!' })
    });
    const loginData = await loginRes.json();
    const token = loginData.accessToken;
    console.log('Candidate login:', loginRes.status);

    // Test /api/candidate/jobs/recommended
    const recRes = await fetch('https://rekrutai-dev.onrender.com/api/candidate/jobs/recommended', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('/api/candidate/jobs/recommended:', recRes.status);
    if (recRes.ok) {
      const recData = await recRes.json();
      console.log('Recommended jobs:', recData.recommended_jobs?.length || 0);
    }

    // Recruiter login
    const recLoginRes = await fetch('https://rekrutai-dev.onrender.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test_recruiter@rekrutai.co', password: 'Test123!' })
    });
    const recLoginData = await recLoginRes.json();
    const recToken = recLoginData.accessToken;
    console.log('Recruiter login:', recLoginRes.status);

    // Test /api/recruiter/analytics
    const analyticsRes = await fetch('https://rekrutai-dev.onrender.com/api/recruiter/analytics', {
      headers: { 'Authorization': `Bearer ${recToken}` }
    });
    console.log('/api/recruiter/analytics:', analyticsRes.status);
    if (analyticsRes.ok) {
      const analyticsData = await analyticsRes.json();
      console.log('Analytics keys:', Object.keys(analyticsData));
    }

  } catch (err) {
    console.error('Test error:', err.message);
  }
}

testNewEndpoints();