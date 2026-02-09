/**
 * Rekrut AI v2 — Core Application Module
 * Auth state management, API client, toast notifications, utilities
 */
const Rekrut AI = (() => {
  const TOKEN_KEY = 'rekrutai_token';
  const REFRESH_KEY = 'rekrutai_refresh';
  const USER_KEY = 'rekrutai_user';

  // ─── Auth State ───
  const Auth = {
    getToken() { return localStorage.getItem(TOKEN_KEY); },
    getRefresh() { return localStorage.getItem(REFRESH_KEY); },
    getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } },

    setTokens(access, refresh) {
      localStorage.setItem(TOKEN_KEY, access);
      if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
    },

    setUser(user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },

    clear() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(USER_KEY);
    },

    isLoggedIn() { return !!this.getToken(); },
    isRecruiter() { const u = this.getUser(); return u && ['recruiter','employer','hiring_manager','admin'].includes(u.role); },
    isCandidate() { const u = this.getUser(); return u && u.role === 'candidate'; },

    async refreshToken() {
      const refresh = this.getRefresh();
      if (!refresh) return false;
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refresh })
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (data.success) {
          this.setTokens(data.accessToken, data.refreshToken);
          if (data.user) this.setUser(data.user);
          return true;
        }
        return false;
      } catch { return false; }
    },

    async check() {
      if (!this.getToken()) return false;
      try {
        const res = await API.get('/auth/me');
        if (res.user) { this.setUser(res.user); return true; }
        const refreshed = await this.refreshToken();
        if (refreshed) return true;
        this.clear();
        return false;
      } catch {
        const refreshed = await this.refreshToken();
        if (!refreshed) this.clear();
        return refreshed;
      }
    },

    async login(email, password) {
      const data = await API.post('/auth/login', { email, password });
      if (data.success) {
        this.setTokens(data.accessToken || data.token, data.refreshToken);
        this.setUser(data.user);
      }
      return data;
    },

    async register(fields) {
      const data = await API.post('/auth/register', fields);
      if (data.success) {
        this.setTokens(data.accessToken || data.token, data.refreshToken);
        this.setUser(data.user);
      }
      return data;
    },

    async logout() {
      try { await API.post('/auth/logout', {}); } catch {}
      this.clear();
      window.location.href = '/login.html';
    },

    /** Require auth — redirect to login if not authenticated */
    async require(allowedRoles) {
      const ok = await this.check();
      if (!ok) { window.location.href = '/login.html'; return false; }
      if (allowedRoles) {
        const user = this.getUser();
        if (!allowedRoles.includes(user?.role)) {
          window.location.href = user?.role === 'candidate' ? '/candidate-dashboard.html' : '/recruiter-dashboard.html';
          return false;
        }
      }
      return true;
    },

    /** Redirect if already logged in */
    redirectIfLoggedIn() {
      if (this.isLoggedIn()) {
        const user = this.getUser();
        window.location.href = this.isRecruiter() ? '/recruiter-dashboard.html' : '/candidate-dashboard.html';
        return true;
      }
      return false;
    }
  };

  // ─── API Client ───
  const API = {
    async request(method, path, body, opts = {}) {
      const url = path.startsWith('/api') ? path : `/api${path}`;
      const headers = {};
      const token = Auth.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;

      if (body && !(body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
      }

      const config = { method, headers };
      if (body) {
        config.body = body instanceof FormData ? body : JSON.stringify(body);
      }

      const res = await fetch(url, config);

      if (res.status === 401) {
        const refreshed = await Auth.refreshToken();
        if (refreshed) {
          headers['Authorization'] = `Bearer ${Auth.getToken()}`;
          const retry = await fetch(url, { ...config, headers });
          if (!retry.ok) throw new Error((await retry.json()).error || 'Request failed');
          return retry.json();
        }
        Auth.clear();
        window.location.href = '/login.html';
        throw new Error('Session expired');
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    },

    get(path) { return this.request('GET', path); },
    post(path, body) { return this.request('POST', path, body); },
    put(path, body) { return this.request('PUT', path, body); },
    patch(path, body) { return this.request('PATCH', path, body); },
    delete(path) { return this.request('DELETE', path); },
    upload(path, formData) { return this.request('POST', path, formData); }
  };

  // ─── Toast Notifications ───
  const Toast = {
    _container: null,
    _getContainer() {
      if (!this._container) {
        this._container = document.createElement('div');
        this._container.className = 'toast-container';
        document.body.appendChild(this._container);
      }
      return this._container;
    },

    show(message, type = 'info', duration = 4000) {
      const icons = { success: '&#10003;', error: '&#10007;', warning: '&#9888;', info: '&#8505;' };
      const el = document.createElement('div');
      el.className = `toast toast-${type}`;
      el.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
      this._getContainer().appendChild(el);
      setTimeout(() => {
        el.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => el.remove(), 300);
      }, duration);
    },

    success(msg) { this.show(msg, 'success'); },
    error(msg) { this.show(msg, 'error'); },
    warning(msg) { this.show(msg, 'warning'); },
    info(msg) { this.show(msg, 'info'); }
  };

  // ─── Utils ───
  const Utils = {
    $(selector) { return document.querySelector(selector); },
    $$(selector) { return document.querySelectorAll(selector); },

    formatDate(date) {
      if (!date) return '—';
      return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },

    formatRelative(date) {
      if (!date) return '—';
      const d = new Date(date);
      const now = new Date();
      const diff = Math.floor((now - d) / 1000);
      if (diff < 60) return 'just now';
      if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
      if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
      return this.formatDate(date);
    },

    truncate(str, len = 100) {
      if (!str || str.length <= len) return str || '';
      return str.substring(0, len) + '...';
    },

    debounce(fn, ms = 300) {
      let t;
      return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    },

    escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    },

    initials(name) {
      if (!name) return '?';
      return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    }
  };

  return { Auth, API, Toast, Utils };
})();

// Shorthand exports
const { Auth, API, Toast, Utils } = Rekrut AI;
const $ = Utils.$;
const $$ = Utils.$$;
