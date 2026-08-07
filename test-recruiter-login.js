if (process.env.NODE_ENV === 'production') {
  throw new Error('Test scripts cannot run in production');
}

async function testRecruiterLogin() {
  const password = process.env.TEST_LOGIN_PASSWORD;
  if (!password) {
    console.error('TEST_LOGIN_PASSWORD environment variable is required');
    process.exit(1);
  }

  try {
    const response = await fetch('https://rekrutai-dev.onrender.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test_recruiter@rekrutai.co', password })
    });
    const data = await response.json();
    console.log('Recruiter login status:', response.status);
    console.log('Token:', data.accessToken ? 'received' : 'missing');
    console.log('User role:', data.user?.role);
    return data.accessToken;
  } catch (err) {
    console.error('Login error:', err.message);
    return null;
  }
}

testRecruiterLogin();
