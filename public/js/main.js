// Rekrut AI Main JavaScript

// Auth state
let currentUser = null;
const TOKEN_KEY = 'rekrutai_token';
const REFRESH_KEY = 'rekrutai_refresh';

// Handle OAuth callback tokens from URL
function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const refresh = params.get('refresh');

  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    if (refresh) {
      localStorage.setItem(REFRESH_KEY, refresh);
    }
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// Refresh access token using refresh token
async function refreshAccessToken() {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;

  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        localStorage.setItem(TOKEN_KEY, data.accessToken);
        localStorage.setItem(REFRESH_KEY, data.refreshToken);
        return data.accessToken;
      }
    }
  } catch (err) {
    console.error('Token refresh failed:', err);
  }

  // Refresh failed - clear tokens
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  return null;
}

// Check auth status on page load
async function checkAuth() {
  // Handle OAuth callback first
  handleOAuthCallback();

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;

  try {
    const response = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.ok) {
      const data = await response.json();
      currentUser = data.user;
      updateNavForAuth();
      return data.user;
    }

    // Token expired - try refresh
    if (response.status === 401) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        return await checkAuth(); // Retry with new token
      }
    }
  } catch (err) {
    console.error('Auth check failed:', err);
  }
  return null;
}

// Update navigation based on auth state
function updateNavForAuth() {
  const navAuth = document.getElementById('nav-auth');
  if (!navAuth) return;

  if (currentUser) {
    const dashboardUrl = currentUser.role === 'recruiter'
      ? '/recruiter-dashboard.html'
      : '/candidate-dashboard.html';

    navAuth.innerHTML = `
      <span class="user-greeting">Hey, ${currentUser.name || currentUser.email.split('@')[0]}</span>
      <a href="${dashboardUrl}" class="btn btn-primary">Dashboard</a>
    `;
  }
}

// Registration
async function handleRegister(event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const errorEl = document.getElementById('register-error');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account...';
  if (errorEl) errorEl.style.display = 'none';

  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email.value,
        password: form.password.value,
        name: form.name?.value || '',
        role: form.role?.value || 'candidate',
        company_name: form.company_name?.value || ''
      })
    });

    const data = await response.json();

    if (data.success) {
      localStorage.setItem(TOKEN_KEY, data.accessToken || data.token);
      if (data.refreshToken) {
        localStorage.setItem(REFRESH_KEY, data.refreshToken);
      }
      // Redirect based on role
      const role = form.role?.value || 'candidate';
      window.location.href = role === 'recruiter'
        ? '/recruiter-dashboard.html'
        : '/candidate-dashboard.html';
    } else {
      if (errorEl) {
        errorEl.textContent = data.error || 'Registration failed';
        errorEl.style.display = 'block';
      }
    }
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = 'Network error. Please try again.';
      errorEl.style.display = 'block';
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account';
  }
}

// Login
async function handleLogin(event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const errorEl = document.getElementById('login-error');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in...';
  if (errorEl) errorEl.style.display = 'none';

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email.value,
        password: form.password.value
      })
    });

    const data = await response.json();

    if (data.success) {
      localStorage.setItem(TOKEN_KEY, data.accessToken || data.token);
      if (data.refreshToken) {
        localStorage.setItem(REFRESH_KEY, data.refreshToken);
      }
      // Redirect based on role
      window.location.href = data.user?.role === 'recruiter'
        ? '/recruiter-dashboard.html'
        : '/candidate-dashboard.html';
    } else {
      if (errorEl) {
        errorEl.textContent = data.error || 'Login failed';
        errorEl.style.display = 'block';
      }
    }
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = 'Network error. Please try again.';
      errorEl.style.display = 'block';
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
  }
}

// Logout
async function handleLogout() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (e) {
      // Ignore errors during logout
    }
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  window.location.href = '/';
}

// API helper with automatic token refresh
async function apiCall(endpoint, options = {}) {
  let token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...options.headers
  };

  let response = await fetch(`/api${endpoint}`, {
    ...options,
    headers
  });

  // If 401 and we have a refresh token, try to refresh
  if (response.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      // Retry with new token
      headers['Authorization'] = `Bearer ${newToken}`;
      response = await fetch(`/api${endpoint}`, {
        ...options,
        headers
      });
    } else {
      // Still unauthorized - redirect to login
      window.location.href = '/login.html';
      return null;
    }
  }

  return response.json();
}

// Dashboard functions
async function loadDashboard() {
  const user = await checkAuth();
  if (!user) {
    window.location.href = '/login.html';
    return;
  }

  // Update user info
  const userNameEl = document.getElementById('user-name');
  if (userNameEl) {
    userNameEl.textContent = user.name || user.email.split('@')[0];
  }

  // Load stats
  loadInterviewStats();
  loadRecentInterviews();
}

async function loadInterviewStats() {
  try {
    const data = await apiCall('/interviews/stats/summary');
    if (!data) return;

    const { stats, recent_scores } = data;

    // Update stat cards
    const totalEl = document.getElementById('total-interviews');
    const avgEl = document.getElementById('avg-score');
    const bestEl = document.getElementById('best-score');

    if (totalEl) totalEl.textContent = stats?.completed || 0;
    if (avgEl) avgEl.textContent = stats?.avg_score ? parseFloat(stats.avg_score).toFixed(1) : '-';
    if (bestEl) bestEl.textContent = stats?.best_score || '-';

  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function loadRecentInterviews() {
  try {
    const data = await apiCall('/interviews/history?limit=5');
    if (!data) return;

    const listEl = document.getElementById('recent-interviews');
    if (!listEl) return;

    if (!data.interviews || data.interviews.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p>No interviews yet. Start practicing!</p>
          <a href="/interview.html" class="btn btn-primary">Start Mock Interview</a>
        </div>
      `;
      return;
    }

    listEl.innerHTML = data.interviews.map(interview => `
      <div class="interview-item">
        <div class="interview-info">
          <span class="interview-type">${interview.interview_type}</span>
          <span class="interview-date">${new Date(interview.created_at).toLocaleDateString()}</span>
        </div>
        <div class="interview-score">
          ${interview.overall_score ? `<span class="score">${interview.overall_score}/10</span>` : '<span class="pending">In Progress</span>'}
        </div>
        <a href="/interview.html?id=${interview.id}" class="btn btn-ghost btn-sm">
          ${interview.status === 'completed' ? 'Review' : 'Continue'}
        </a>
      </div>
    `).join('');

  } catch (err) {
    console.error('Failed to load interviews:', err);
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Handle OAuth callback tokens first
  handleOAuthCallback();

  // Check if on dashboard
  if (window.location.pathname === '/dashboard.html' ||
      window.location.pathname === '/candidate-dashboard.html') {
    loadDashboard();
  } else if (window.location.pathname === '/recruiter-dashboard.html') {
    checkAuth().then(user => {
      if (!user) {
        window.location.href = '/login.html';
      }
    });
  } else {
    checkAuth();
  }

  // Attach form handlers
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', handleRegister);
  }

  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  // Attach logout handlers
  document.querySelectorAll('[data-logout]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      handleLogout();
    });
  });
});

// Expose functions globally for inline use
window.handleLogout = handleLogout;
window.apiCall = apiCall;
window.currentUser = () => currentUser;
