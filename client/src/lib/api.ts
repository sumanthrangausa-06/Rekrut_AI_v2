const TOKEN_KEY = 'rekrutai_token'
const REFRESH_KEY = 'rekrutai_refresh'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY)
}

export function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(TOKEN_KEY, accessToken)
  localStorage.setItem(REFRESH_KEY, refreshToken)
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
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

export async function apiCall<T = unknown>(
  url: string,
  options: ApiCallOptions = {}
): Promise<T> {
  const { body, isFormData, headers: customHeaders, skipAuthCheck, ...rest } = options
  const token = getToken()

  const headers: Record<string, string> = {
    ...(customHeaders as Record<string, string>),
  }

  if (token && !skipAuthCheck) {
    headers['Authorization'] = `Bearer ${token}`
  }

  if (!isFormData && body) {
    headers['Content-Type'] = 'application/json'
  }

  const fetchOptions: RequestInit = {
    ...rest,
    headers,
    body: isFormData ? (body as BodyInit) : body ? JSON.stringify(body) : undefined,
  }

  let res = await fetch(`/api${url}`, fetchOptions)

  // If 401, try to refresh token (unless this is an auth endpoint)
  if (res.status === 401 && !skipAuthCheck) {
    const newToken = await refreshAccessToken()
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`
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
