const TOKEN_KEY = 'rekrutai_token'
const REFRESH_KEY = 'rekrutai_refresh'
const CSRF_TOKEN_KEY = 'rekrutai_csrf'

// Legacy keys from older versions — check in priority order and migrate
const LEGACY_TOKEN_KEYS = ['token', 'hireloop_token']
const LEGACY_REFRESH_KEYS = ['refresh_token', 'hireloop_refresh']

export function getToken(): string | null {
	// Check canonical key first
	let token = localStorage.getItem(TOKEN_KEY)
	if (token) return token

	// Check legacy keys and migrate if found
	for (const key of LEGACY_TOKEN_KEYS) {
		token = localStorage.getItem(key)
		if (token) {
			// Migrate to canonical key
			localStorage.setItem(TOKEN_KEY, token)
			localStorage.removeItem(key)
			return token
		}
	}

	return null
}

export function getRefreshToken(): string | null {
	let refresh = localStorage.getItem(REFRESH_KEY)
	if (refresh) return refresh

	for (const key of LEGACY_REFRESH_KEYS) {
		refresh = localStorage.getItem(key)
		if (refresh) {
			localStorage.setItem(REFRESH_KEY, refresh)
			localStorage.removeItem(key)
			return refresh
		}
	}

	return null
}

export function setTokens(accessToken: string, refreshToken: string) {
	localStorage.setItem(TOKEN_KEY, accessToken)
	localStorage.setItem(REFRESH_KEY, refreshToken)
	// Also set legacy keys for backward compatibility with other code
	localStorage.setItem('token', accessToken)
	localStorage.setItem('refresh_token', refreshToken)
	startAuthRefresh()
}

export function clearTokens() {
	stopAuthRefresh()
	localStorage.removeItem(TOKEN_KEY)
	localStorage.removeItem(REFRESH_KEY)
	// Clear legacy keys too
	for (const key of LEGACY_TOKEN_KEYS) {
		localStorage.removeItem(key)
	}
	for (const key of LEGACY_REFRESH_KEYS) {
		localStorage.removeItem(key)
	}
}

// CSRF token management — read from cookie directly (most reliable)
function getCsrfTokenFromCookie(): string | null {
	const match = document.cookie.match(/(^| )_csrf=([^;]+)/)
	return match ? decodeURIComponent(match[2]) : null
}

async function getCsrfToken(): Promise<string | null> {
	// 1. Try cookie directly (avoids stale localStorage cache)
	const cookieToken = getCsrfTokenFromCookie()
	if (cookieToken) {
		localStorage.setItem(CSRF_TOKEN_KEY, cookieToken)
		return cookieToken
	}

	// 2. Fallback to localStorage cache
	const cached = localStorage.getItem(CSRF_TOKEN_KEY)
	if (cached) return cached

	// 3. Fetch from server (for environments where cookie isn't set yet)
	try {
		const res = await fetch('/csrf-token', { credentials: 'include' })
		if (res.ok) {
			const data = await res.json()
			if (data.csrfToken) {
				localStorage.setItem(CSRF_TOKEN_KEY, data.csrfToken)
				return data.csrfToken
			}
		}
	} catch {
		// CSRF endpoint not critical for all requests
	}
	return null
}
// Proactive token refresh — refresh at 80% of token lifetime before expiry
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null

// Parse JWT payload without external library (base64url decode)
function parseJwtPayload(token: string): Record<string, unknown> | null {
	try {
		const base64Url = token.split('.')[1]
		if (!base64Url) return null
		const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
		const jsonPayload = decodeURIComponent(
			atob(base64)
				.split('')
				.map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
				.join(''),
		)
		return JSON.parse(jsonPayload)
	} catch {
		return null
	}
}

function getTokenExpiry(token: string): number | null {
	const payload = parseJwtPayload(token)
	if (!payload || typeof payload.exp !== 'number') return null
	return payload.exp * 1000 // convert seconds to ms
}

const REFRESH_THRESHOLD = 0.8 // refresh at 80% of lifetime

export function startAuthRefresh() {
	clearProactiveRefresh()

	const token = getToken()
	if (!token) return

	const expiry = getTokenExpiry(token)
	if (!expiry) return

	const now = Date.now()
	const lifetime = expiry - now
	if (lifetime <= 0) {
		// Token already expired — let reactive interceptor handle it
		console.warn('[auth] Access token already expired, skipping proactive refresh')
		return
	}

	// Refresh at 80% of lifetime, but at least 30s before expiry
	const refreshIn = Math.min(Math.floor(lifetime * REFRESH_THRESHOLD), lifetime - 30_000)

	if (refreshIn <= 0) {
		// Very close to expiry — refresh immediately
		refreshAccessToken().then((newToken) => {
			if (newToken) startAuthRefresh()
		})
		return
	}

	console.log(`[auth] Proactive refresh scheduled in ${Math.round(refreshIn / 1000)}s`)

	proactiveRefreshTimer = setTimeout(() => {
		refreshAccessToken().then((newToken) => {
			if (newToken) {
				startAuthRefresh()
			} else {
				// Proactive refresh failed — token may still be valid for a short time.
				// The reactive 401 interceptor in apiCall will catch real requests.
				console.warn('[auth] Proactive refresh failed; waiting for reactive interceptor')
			}
		})
	}, refreshIn)
}

export function stopAuthRefresh() {
	clearProactiveRefresh()
}

function clearProactiveRefresh() {
	if (proactiveRefreshTimer) {
		clearTimeout(proactiveRefreshTimer)
		proactiveRefreshTimer = null
	}
}

let isRefreshing = false
let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
	if (isRefreshing && refreshPromise) return refreshPromise

	isRefreshing = true
	refreshPromise = (async () => {
		try {
			const refreshToken = getRefreshToken()
			if (!refreshToken) return null

			const res = await fetch('/api/auth/refresh', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-CSRF-Token': getCsrfTokenFromCookie() || localStorage.getItem(CSRF_TOKEN_KEY) || '',
				},
				body: JSON.stringify({ refreshToken }),
				credentials: 'include',
			})

			if (!res.ok) return null

			const data = await res.json()
			if (data.accessToken && data.refreshToken) {
				setTokens(data.accessToken, data.refreshToken)
				return data.accessToken
			}
			return null
		} catch {
			return null
		} finally {
			isRefreshing = false
			refreshPromise = null
		}
	})()

	return refreshPromise
}

interface ApiCallOptions extends Omit<RequestInit, 'body'> {
	body?: unknown
	isFormData?: boolean
	skipAuthCheck?: boolean // For login, register, forgot-password, reset-password
}

export async function apiCall<T = unknown>(url: string, options: ApiCallOptions = {}): Promise<T> {
	const { body, isFormData, headers: customHeaders, skipAuthCheck, method, ...rest } = options
	const token = getToken()

	const headers: Record<string, string> = {
		...(customHeaders as Record<string, string>),
	}

	if (token && !skipAuthCheck) {
		headers.Authorization = `Bearer ${token}`
	}

	if (!isFormData && body) {
		headers['Content-Type'] = 'application/json'
	}

	// Add CSRF token for state-changing requests
	const isStateChanging =
		method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH'
	if (isStateChanging) {
		const csrfToken = await getCsrfToken()
		if (csrfToken) {
			headers['X-CSRF-Token'] = csrfToken
		}
	}

	const fetchOptions: RequestInit = {
		...rest,
		method: method || 'GET',
		headers,
		body: isFormData ? (body as BodyInit) : body ? JSON.stringify(body) : undefined,
		credentials: 'include',
	}

	let res = await fetch(`/api${url}`, fetchOptions)

	// If 401, try to refresh token (unless this is an auth endpoint)
	if (res.status === 401 && !skipAuthCheck) {
		const newToken = await refreshAccessToken()
		if (newToken) {
			headers.Authorization = `Bearer ${newToken}`
			res = await fetch(`/api${url}`, { ...fetchOptions, headers })
		} else {
			clearTokens()
			window.location.href = '/login'
			throw new Error('Session expired')
		}
	}

	// If 401 on auth endpoint, just throw the error without redirect
	if (res.status === 401 && skipAuthCheck) {
		throw new Error('Invalid credentials')
	}

	if (!res.ok) {
		const errorData = await res.json().catch(() => ({ error: 'Request failed' }))
		throw new Error(errorData.error || `Request failed: ${res.status}`)
	}

	return res.json()
}

export type UserRole = 'candidate' | 'recruiter' | 'hiring_manager' | 'employer' | 'admin'

export interface User {
	id: number
	email: string
	name: string
	role: UserRole
	company_name?: string
	avatar_url?: string
	subscriptionTier?: 'free' | 'pro'
}

export function isRecruiterRole(role: UserRole): boolean {
	return ['employer', 'recruiter', 'hiring_manager', 'admin'].includes(role)
}

export function getDashboardPath(role: UserRole): string {
	return isRecruiterRole(role) ? '/recruiter' : '/candidate'
}

// ── Cross-tab token sync + proactive refresh on page load ──

if (typeof window !== 'undefined') {
	// Auto-start proactive refresh if a token already exists (e.g., page refresh)
	const existingToken = getToken()
	if (existingToken) {
		startAuthRefresh()
	}

	// Sync proactive refresh timer across tabs via localStorage events
	window.addEventListener('storage', (e) => {
		if (e.key === TOKEN_KEY) {
			if (e.newValue) {
				startAuthRefresh()
			} else {
				stopAuthRefresh()
			}
		}
	})
}

// ── Job Like / Dismiss (Swipe) API helpers ──

export async function likeJob(jobId: number): Promise<void> {
	await apiCall(`/candidate/jobs/${jobId}/like`, { method: 'POST' })
}

export async function unlikeJob(jobId: number): Promise<void> {
	await apiCall(`/candidate/jobs/${jobId}/like`, { method: 'DELETE' })
}

export async function getLikedJobs(): Promise<Array<Record<string, unknown>>> {
	const data = await apiCall<{ jobs: Array<Record<string, unknown>> }>('/candidate/jobs/liked')
	return data.jobs || []
}

export async function dismissJob(jobId: number): Promise<void> {
	await apiCall(`/candidate/jobs/${jobId}/dismiss`, { method: 'POST' })
}

export async function restoreJob(jobId: number): Promise<void> {
	await apiCall(`/candidate/jobs/${jobId}/dismiss`, { method: 'DELETE' })
}

export async function getDismissedJobs(): Promise<Array<Record<string, unknown>>> {
	const data = await apiCall<{ jobs: Array<Record<string, unknown>> }>('/candidate/jobs/dismissed')
	return data.jobs || []
}

// Type needed for liked/dismissed job responses
export interface JobActionResponse {
	success: boolean
	jobs: Array<Record<string, unknown>>
	liked_jobs?: Array<Record<string, unknown>>
	dismissed_jobs?: Array<Record<string, unknown>>
}
