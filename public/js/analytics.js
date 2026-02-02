// Analytics tracking utility
const Analytics = {
  // Track a page view
  trackPageView(pageName) {
    this.trackEvent(`page_view_${pageName}`, {
      url: window.location.href,
      pathname: window.location.pathname
    });
  },

  // Track a user action
  trackEvent(eventType, metadata = {}) {
    fetch('/api/analytics/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event_type: eventType,
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString(),
          user_agent: navigator.userAgent,
          screen_width: window.innerWidth,
          screen_height: window.innerHeight
        }
      })
    }).catch(err => {
      // Silent fail - don't break user experience
      console.debug('Analytics tracking failed:', err);
    });
  },

  // Track button clicks
  trackClick(buttonName, metadata = {}) {
    this.trackEvent(`click_${buttonName}`, metadata);
  },

  // Track form submissions
  trackFormSubmit(formName, metadata = {}) {
    this.trackEvent(`form_submit_${formName}`, metadata);
  },

  // Track feature usage
  trackFeature(featureName, action, metadata = {}) {
    this.trackEvent(`${featureName}_${action}`, metadata);
  }
};

// Auto-track page views on load
window.addEventListener('DOMContentLoaded', () => {
  // Determine page name from pathname
  const pathname = window.location.pathname;
  let pageName = 'unknown';

  if (pathname === '/' || pathname === '/index.html') {
    pageName = 'landing';
  } else if (pathname.includes('/register')) {
    pageName = 'signup';
  } else if (pathname.includes('/login')) {
    pageName = 'login';
  } else if (pathname.includes('/dashboard')) {
    pageName = 'dashboard';
  } else if (pathname.includes('/recruiter-dashboard')) {
    pageName = 'recruiter_dashboard';
  } else if (pathname.includes('/candidate-dashboard')) {
    pageName = 'candidate_dashboard';
  } else if (pathname.includes('/interview-practice')) {
    pageName = 'interview_practice';
  } else if (pathname.includes('/job-create')) {
    pageName = 'job_create';
  }

  Analytics.trackPageView(pageName);
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Analytics;
}
