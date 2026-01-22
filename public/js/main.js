// HireLoop Main JavaScript

// Auth state
let currentUser = null;

// Check auth status on page load
async function checkAuth() {
  const token = localStorage.getItem('hireloop_token');
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
    navAuth.innerHTML = `
      <span class="user-greeting">Hey, ${currentUser.name || currentUser.email.split('@')[0]}</span>
      <a href="/dashboard.html" class="btn btn-primary">Dashboard</a>
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
  errorEl.style.display = 'none';
  
  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email.value,
        password: form.password.value,
        name: form.name.value,
        role: form.role?.value || 'candidate'
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      localStorage.setItem('hireloop_token', data.token);
      window.location.href = '/dashboard.html';
    } else {
      errorEl.textContent = data.error || 'Registration failed';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.textContent = 'Network error. Please try again.';
    errorEl.style.display = 'block';
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
  errorEl.style.display = 'none';
  
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
      localStorage.setItem('hireloop_token', data.token);
      window.location.href = '/dashboard.html';
    } else {
      errorEl.textContent = data.error || 'Login failed';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.textContent = 'Network error. Please try again.';
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
  }
}

// Logout
function handleLogout() {
  localStorage.removeItem('hireloop_token');
  window.location.href = '/';
}

// API helper
async function apiCall(endpoint, options = {}) {
  const token = localStorage.getItem('hireloop_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...options.headers
  };
  
  const response = await fetch(`/api${endpoint}`, {
    ...options,
    headers
  });
  
  if (response.status === 401) {
    localStorage.removeItem('hireloop_token');
    window.location.href = '/login.html';
    return null;
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
    
    if (totalEl) totalEl.textContent = stats.completed || 0;
    if (avgEl) avgEl.textContent = stats.avg_score ? parseFloat(stats.avg_score).toFixed(1) : '-';
    if (bestEl) bestEl.textContent = stats.best_score || '-';
    
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
    
    if (data.interviews.length === 0) {
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
  // Check if on dashboard
  if (window.location.pathname === '/dashboard.html') {
    loadDashboard();
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
});