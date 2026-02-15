import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

interface AdminAuthGuardProps {
  children: ReactNode
}

export function AdminAuthGuard({ children }: AdminAuthGuardProps) {
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading')
  const location = useLocation()

  useEffect(() => {
    let cancelled = false

    async function checkAdmin() {
      try {
        // Step 1: Check if already admin-authenticated (session cookie)
        const meRes = await fetch('/api/admin/me', {
          credentials: 'include',
          headers: getAuthHeaders(),
        })

        if (cancelled) return

        if (meRes.ok) {
          const data = await meRes.json()
          if (data.authenticated) {
            setStatus('authenticated')
            return
          }
        }

        // Step 2: Try to bridge — if user is logged into main app with admin role
        const token = getStoredToken()
        if (token) {
          const bridgeRes = await fetch('/api/admin/bridge', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          })

          if (cancelled) return

          if (bridgeRes.ok) {
            const bridgeData = await bridgeRes.json()
            if (bridgeData.success) {
              setStatus('authenticated')
              return
            }
          }
        }

        // Step 3: Not authenticated — redirect to admin login
        if (!cancelled) setStatus('unauthenticated')
      } catch {
        if (!cancelled) setStatus('unauthenticated')
      }
    }

    checkAdmin()
    return () => { cancelled = true }
  }, [])

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-slate-400">Verifying admin access...</p>
        </div>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    const returnTo = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/admin/login?returnTo=${returnTo}`} replace />
  }

  return <>{children}</>
}

// Helper: get stored JWT token from localStorage
function getStoredToken(): string | null {
  try {
    return localStorage.getItem('rekrutai_token') || localStorage.getItem('hireloop_token') || null
  } catch {
    return null
  }
}

// Helper: build auth headers with stored token
function getAuthHeaders(): Record<string, string> {
  const token = getStoredToken()
  if (token) {
    return { Authorization: `Bearer ${token}` }
  }
  return {}
}
