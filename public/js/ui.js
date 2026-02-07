/**
 * HireLoop v2 — UI Components
 * Renders sidebar, topbar, handles mobile toggle
 */
const UI = (() => {

  // ─── SVG Icons ───
  const icons = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    jobs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
    candidates: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    interviews: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z"/></svg>',
    assessments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    onboarding: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
    payroll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    score: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    documents: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    matching: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    coach: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    resume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg>',
  };

  // ─── Navigation Configs ───
  const recruiterNav = [
    { section: 'Overview', items: [
      { label: 'Dashboard', icon: 'dashboard', href: '/recruiter-dashboard.html' },
      { label: 'Analytics', icon: 'analytics', href: '/recruiter-analytics.html' },
    ]},
    { section: 'Recruitment', items: [
      { label: 'Job Postings', icon: 'jobs', href: '/recruiter-jobs.html' },
      { label: 'Applications', icon: 'candidates', href: '/recruiter-applications.html' },
      { label: 'Interviews', icon: 'interviews', href: '/recruiter-interviews.html' },
      { label: 'Offer Management', icon: 'documents', href: '/offer-management.html' },
    ]},
    { section: 'Talent', items: [
      { label: 'Matching Engine', icon: 'matching', href: '/matching.html', badge: 'AI' },
      { label: 'Trust Score', icon: 'shield', href: '/recruiter-trustscore.html' },
    ]},
    { section: 'Post-Hire', items: [
      { label: 'Onboarding', icon: 'onboarding', href: '/recruiter-onboarding-docs.html' },
      { label: 'Payroll', icon: 'payroll', href: '/payroll-dashboard.html' },
      { label: 'Compliance', icon: 'shield', href: '/compliance-dashboard.html' },
    ]},
    { section: 'Account', items: [
      { label: 'Company Profile', icon: 'profile', href: '/company-profile.html' },
      { label: 'Settings', icon: 'settings', href: '/recruiter-profile.html' },
    ]},
  ];

  const candidateNav = [
    { section: 'Overview', items: [
      { label: 'Dashboard', icon: 'dashboard', href: '/candidate-dashboard.html' },
    ]},
    { section: 'Career', items: [
      { label: 'Job Board', icon: 'matching', href: '/job-board.html' },
      { label: 'My Applications', icon: 'documents', href: '/history.html' },
      { label: 'Saved Jobs', icon: 'score', href: '/job-board.html?saved=true' },
    ]},
    { section: 'Preparation', items: [
      { label: 'AI Interview Coach', icon: 'coach', href: '/interview-practice.html', badge: 'AI' },
      { label: 'Skill Assessments', icon: 'assessments', href: '/skill-assessments.html' },
      { label: 'OmniScore', icon: 'score', href: '/omniscore.html' },
    ]},
    { section: 'Profile', items: [
      { label: 'My Profile', icon: 'profile', href: '/candidate-profile.html' },
      { label: 'Documents', icon: 'documents', href: '/documents.html' },
      { label: 'Onboarding', icon: 'onboarding', href: '/onboarding.html' },
    ]},
  ];

  // ─── Render Sidebar ───
  function renderSidebar(role) {
    const nav = role === 'recruiter' ? recruiterNav : candidateNav;
    const currentPage = window.location.pathname;

    let navHtml = '';
    nav.forEach(section => {
      navHtml += `<div class="sidebar-section">
        <div class="sidebar-section-title">${section.section}</div>`;
      section.items.forEach(item => {
        const active = currentPage === item.href || (item.href !== '/' && currentPage.startsWith(item.href.replace('.html', '')));
        navHtml += `<a href="${item.href}" class="nav-link ${active ? 'active' : ''}">
          ${icons[item.icon] || ''}
          <span>${item.label}</span>
          ${item.badge ? `<span class="badge badge-primary">${item.badge}</span>` : ''}
        </a>`;
      });
      navHtml += '</div>';
    });

    return `
      <div class="sidebar" id="sidebar">
        <div class="sidebar-logo">
          <h1>Hire<span>Loop</span></h1>
        </div>
        <nav class="sidebar-nav">${navHtml}</nav>
        <div class="sidebar-footer">
          <button class="nav-link" onclick="Auth.logout()" style="width:100%;border:none;font-family:inherit;">
            ${icons.logout}
            <span>Sign Out</span>
          </button>
        </div>
      </div>
      <div class="sidebar-overlay" id="sidebarOverlay"></div>`;
  }

  // ─── Render Topbar ───
  function renderTopbar(title) {
    const user = Auth.getUser();
    const initials = Utils.initials(user?.name);
    const avatarHtml = user?.avatar_url
      ? `<img src="${user.avatar_url}" alt="">`
      : initials;

    return `
      <div class="topbar">
        <div class="topbar-left">
          <button class="mobile-toggle" onclick="UI.toggleSidebar()">
            ${icons.menu}
          </button>
          <h2 style="font-size:1.125rem;font-weight:600;color:#0f172a;">${title || 'Dashboard'}</h2>
        </div>
        <div class="topbar-right">
          <div class="dropdown">
            <button onclick="UI.toggleDropdown(this)" class="btn btn-ghost" style="display:flex;align-items:center;gap:0.5rem;padding:0.375rem 0.75rem;">
              <div class="avatar">${avatarHtml}</div>
              <span style="font-size:0.875rem;font-weight:500;">${Utils.escapeHtml(user?.name || 'User')}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="dropdown-menu">
              <a href="${Auth.isRecruiter() ? '/recruiter-profile.html' : '/candidate-profile.html'}" class="dropdown-item">
                ${icons.profile} Profile
              </a>
              <a href="${Auth.isRecruiter() ? '/recruiter-dashboard.html' : '/candidate-dashboard.html'}" class="dropdown-item">
                ${icons.dashboard} Dashboard
              </a>
              <div class="dropdown-divider"></div>
              <button onclick="Auth.logout()" class="dropdown-item" style="color:#ef4444;">
                ${icons.logout} Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ─── Initialize Dashboard Layout ───
  function initDashboard(options = {}) {
    const user = Auth.getUser();
    if (!user) return;

    const role = Auth.isRecruiter() ? 'recruiter' : 'candidate';
    const container = document.getElementById('app');
    if (!container) return;

    const sidebar = renderSidebar(role);
    const topbar = renderTopbar(options.title);
    const content = document.getElementById('page-content')?.innerHTML || '';

    container.innerHTML = `
      <div class="dashboard">
        ${sidebar}
        <div class="main-content">
          ${topbar}
          <div class="page-content" id="pageContent">
            ${options.title ? `<div class="page-header"><h1 class="page-title">${options.title}</h1>${options.subtitle ? `<p class="page-subtitle">${options.subtitle}</p>` : ''}</div>` : ''}
            <div id="content">${content}</div>
          </div>
        </div>
      </div>`;

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown')) {
        document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
      }
    });
  }

  // ─── UI Helpers ───
  function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar?.classList.toggle('open');
    overlay?.classList.toggle('show');
    overlay?.addEventListener('click', () => {
      sidebar?.classList.remove('open');
      overlay?.classList.remove('show');
    });
  }

  function toggleDropdown(btn) {
    const menu = btn.nextElementSibling;
    document.querySelectorAll('.dropdown-menu.show').forEach(m => { if (m !== menu) m.classList.remove('show'); });
    menu?.classList.toggle('show');
  }

  // ─── Loading State ───
  function showLoading(containerId = 'content') {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '<div style="display:flex;justify-content:center;padding:3rem;"><div class="spinner spinner-dark"></div></div>';
  }

  function showEmpty(containerId, title, description, actionHtml) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
        <h3>${title}</h3>
        <p>${description}</p>
        ${actionHtml || ''}
      </div>`;
  }

  return { initDashboard, toggleSidebar, toggleDropdown, showLoading, showEmpty, icons, renderSidebar, renderTopbar };
})();
