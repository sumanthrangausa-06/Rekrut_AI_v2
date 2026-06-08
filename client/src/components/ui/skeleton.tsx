import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'

// ─── Loading Skeletons ──────────────────────────────────────

export function Skeleton({ className, count = 1 }: { className?: string; count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn('animate-pulse rounded-md bg-muted', className)}
        />
      ))}
    </>
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <Skeleton className="h-20 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </CardContent>
    </Card>
  )
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-8 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-12 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonKpiCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function SkeletonPage() {
  return (
    <div className="space-y-6">
      <SkeletonKpiCards count={4} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  )
}

// ─── Page Loading Wrapper ───────────────────────────────────

export function PageLoading({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

// ─── Route Transition Loading ───────────────────────────────

export function RouteLoading({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setIsLoading(true)
    const timer = setTimeout(() => setIsLoading(false), 300)
    return () => clearTimeout(timer)
  }, [location.pathname])

  if (!isLoading) return <>{children}</>

  return (
    <div className="relative">
      <div className="fixed top-0 left-0 right-0 h-0.5 z-50 overflow-hidden bg-muted"
        style={{
          animation: 'progress 2s ease-in-out infinite',
        }}
      >
        <div className="h-full bg-primary w-1/3" />
      </div>
      {children}
    </div>
  )
}

// ─── Data Fetching Loading ─────────────────────────────────

export function DataLoading({ 
  children, 
  isLoading, 
  skeleton = 'card',
  message = 'Loading data...' 
}: { 
  children: React.ReactNode
  isLoading: boolean
  skeleton?: 'card' | 'table' | 'kpi' | 'page' | 'none'
  message?: string
}) {
  if (!isLoading) return <>{children}</>

  return (
    <div className="space-y-4">
      <PageLoading message={message} />
      {skeleton === 'card' && <SkeletonCard />}
      {skeleton === 'table' && <SkeletonTable />}
      {skeleton === 'kpi' && <SkeletonKpiCards />}
      {skeleton === 'page' && <SkeletonPage />}
    </div>
  )
}

// ─── Lazy Load Wrapper ───────────────────────────────────

export function lazyLoad<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return React.lazy(factory)
}

import React from 'react'

export { React }
