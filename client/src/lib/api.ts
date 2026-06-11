const TOKEN_KEY = 'rekrutai_token'
const REFRESH_KEY = 'rekrutai_refresh'

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
}

export function clearTokens() {
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
	const match = document.cookie.match(new RegExp('(^| )_csrf=([^;]+)'))
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
}

export function isRecruiterRole(role: UserRole): boolean {
	return ['employer', 'recruiter', 'hiring_manager', 'admin'].includes(role)
}

export function getDashboardPath(role: UserRole): string {
	return isRecruiterRole(role) ? '/recruiter' : '/candidate'
}
