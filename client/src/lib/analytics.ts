const SESSION_KEY = 'rekrutai_analytics_session_id'

type AnalyticsMetadata = Record<string, unknown>

function getSessionId() {
  if (typeof window === 'undefined') return 'server'

  const existing = window.localStorage.getItem(SESSION_KEY)
  if (existing) return existing

  const generated = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `session_${Date.now()}_${Math.random().toString(16).slice(2)}`

  window.localStorage.setItem(SESSION_KEY, generated)
  return generated
}

function buildMetadata(metadata: AnalyticsMetadata = {}) {
  if (typeof window === 'undefined') return metadata

  return {
    ...metadata,
    path: window.location.pathname,
    search: window.location.search,
    title: document.title,
    referrer: document.referrer || null,
  }
}

export function trackEvent(event_type: string, metadata: AnalyticsMetadata = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const payload = {
    event_type,
    metadata: buildMetadata(metadata),
  }

  void fetch('/api/analytics/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': getSessionId(),
    },
    body: JSON.stringify(payload),
    keepalive: true,
    credentials: 'include',
  }).catch(() => undefined)
}
