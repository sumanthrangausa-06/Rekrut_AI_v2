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
        const res = await fetch('/api/admin/me', {
          credentials: 'include',
        })

        if (cancelled) return

        if (res.ok) {
          const data = await res.json()
          setStatus(data.authenticated ? 'authenticated' : 'unauthenticated')
        } else {
          setStatus('unauthenticated')
        }
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
