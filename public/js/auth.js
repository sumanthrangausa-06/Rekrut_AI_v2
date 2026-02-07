// Shared auth utilities for pages that don't include main.js
const AUTH_TOKEN_KEY = 'rekrutai_token';
const AUTH_REFRESH_KEY = 'rekrutai_refresh';

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function getAuthHeaders() {
  const token = getAuthToken();
  return token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : {};
}

// checkAuth that returns user data (matches main.js behavior)
let _authPromise = null;
async function checkAuth() {
  if (_authPromise) return _authPromise;

  _authPromise = (async () => {
    const token = getAuthToken();
    if (!token) {
      window.location.href = '/login.html';
      return null;
    }

    try {
      const response = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        return data.user || data;
      }

      // Token expired, try refresh
      if (response.status === 401) {
        const refreshToken = localStorage.getItem(AUTH_REFRESH_KEY);
        if (refreshToken) {
          try {
            const refreshRes = await fetch('/api/auth/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken })
            });

            if (refreshRes.ok) {
              const refreshData = await refreshRes.json();
              localStorage.setItem(AUTH_TOKEN_KEY, refreshData.accessToken || refreshData.token);
              if (refreshData.refreshToken) {
                localStorage.setItem(AUTH_REFRESH_KEY, refreshData.refreshToken);
              }
              // Retry with new token
              const retryRes = await fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${refreshData.accessToken || refreshData.token}` }
              });
              if (retryRes.ok) {
                const data = await retryRes.json();
                return data.user || data;
              }
            }
          } catch (refreshErr) {
            console.error('Token refresh failed:', refreshErr);
          }
        }

        // Refresh failed, redirect to login
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_REFRESH_KEY);
        window.location.href = '/login.html';
        return null;
      }

      return null;
    } catch (err) {
      console.error('Auth check failed:', err);
      return null;
    } finally {
      _authPromise = null;
    }
  })();

  return _authPromise;
}

// Alias for backward compat
async function checkAuthAndRedirect() {
  const user = await checkAuth();
  return !!user;
}

// Load user info for display (alias)
async function loadUserInfo() {
  return checkAuth();
}

// Refresh access token using refresh token
async function refreshAccessTokenAuth() {
  const refreshToken = localStorage.getItem(AUTH_REFRESH_KEY);
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
        localStorage.setItem(AUTH_TOKEN_KEY, data.accessToken);
        localStorage.setItem(AUTH_REFRESH_KEY, data.refreshToken);
        return data.accessToken;
      }
    }
  } catch (err) {
    console.error('Token refresh failed:', err);
  }
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_REFRESH_KEY);
  return null;
}

// API call helper with automatic token refresh
async function authApiCall(endpoint, options = {}) {
  let token = getAuthToken();
  const url = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...options.headers
  };
  let response = await fetch(url, { ...options, headers });
  // If 401, try to refresh the token and retry
  if (response.status === 401) {
    const newToken = await refreshAccessTokenAuth();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      response = await fetch(url, { ...options, headers });
    } else {
      window.location.href = '/login.html';
      return null;
    }
  }
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

function setupUserMenu() {
  const token = getAuthToken();
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  // Load user info
  fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } })
    .then(res => {
      if (!res.ok) {
        if (res.status === 401) window.location.href = '/login.html';
        throw new Error('Auth failed');
      }
      return res.json();
    })
    .then(data => {
      const user = data.user || data;
      const nameEl = document.getElementById('user-name');
      const avatarEl = document.getElementById('user-avatar');
      const dropdownName = document.getElementById('dropdown-user-name');
      const dropdownEmail = document.getElementById('dropdown-user-email');
      const companyName = document.getElementById('company-name');

      if (nameEl) nameEl.textContent = user.name || 'User';
      if (avatarEl) avatarEl.textContent = (user.name || 'U')[0].toUpperCase();
      if (dropdownName) dropdownName.textContent = user.name || 'User';
      if (dropdownEmail) dropdownEmail.textContent = user.email || '';
      if (companyName) companyName.textContent = user.company_name || 'Company';
    })
    .catch(err => console.error('Auth error:', err));

  // Setup dropdown toggle
  const toggle = document.getElementById('user-menu-toggle');
  const menu = document.getElementById('user-dropdown-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('active');
    });
    document.addEventListener('click', (e) => {
      if (!toggle.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.remove('active');
      }
    });
  }

  // Setup logout buttons
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
}

async function handleLogout() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
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
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_REFRESH_KEY);
  window.location.href = '/';
}
