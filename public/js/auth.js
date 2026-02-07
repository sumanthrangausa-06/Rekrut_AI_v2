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

async function checkAuthAndRedirect() {
  const token = getAuthToken();
  if (!token) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
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
    .then(user => {
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
    toggle.addEventListener('click', () => menu.classList.toggle('active'));
    document.addEventListener('click', (e) => {
      if (!toggle.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.remove('active');
      }
    });
  }

  // Setup logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_REFRESH_KEY);
      window.location.href = '/login.html';
    });
  }
}
