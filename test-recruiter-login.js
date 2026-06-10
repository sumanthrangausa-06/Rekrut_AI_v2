if (process.env.NODE_ENV === 'production') {
  throw new Error('Test scripts cannot run in production');
}

async function testRecruiterLogin() {
  try {
    const response = await fetch('https://rekrutai-dev.onrender.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test_recruiter@rekrutai.co', password: 'Test123!' })
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