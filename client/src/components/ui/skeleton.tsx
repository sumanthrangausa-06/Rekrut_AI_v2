import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// ─── Loading Skeletons ──────────────────────────────────────

export function Skeleton({ className, count = 1 }: { className?: string; count?: number }) {
	return (
		<>
			{Array.from({ length: count }).map((_, i) => (
				<div key={i} className={cn('animate-pulse rounded-md bg-muted', className)} />
			))}
		</>
	)
}

export function SkeletonCard({ className }: { className?: string }) {
	return (
		<Card className={className}>
			<CardContent className='p-6 space-y-4'>
				<div className='flex items-center gap-4'>
					<Skeleton className='h-12 w-12 rounded-full' />
					<div className='space-y-2 flex-1'>
						<Skeleton className='h-4 w-3/4' />
						<Skeleton className='h-3 w-1/2' />
					</div>
				</div>
				<Skeleton className='h-20 w-full' />
				<div className='flex gap-2'>
					<Skeleton className='h-8 w-24' />
					<Skeleton className='h-8 w-24' />
				</div>
			</CardContent>
		</Card>
	)
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
	return (
		<div className='space-y-3'>
			{/* Header */}
			<div className='flex gap-4'>
				{Array.from({ length: cols }).map((_, i) => (
					<Skeleton key={i} className='h-8 flex-1' />
				))}
			</div>
			{/* Rows */}
			{Array.from({ length: rows }).map((_, i) => (
				<div key={i} className='flex gap-4'>
					{Array.from({ length: cols }).map((_, j) => (
						<Skeleton key={j} className='h-12 flex-1' />
					))}
				</div>
			))}
		</div>
	)
}

export function SkeletonKpiCards({ count = 4 }: { count?: number }) {
	return (
		<div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'>
			{Array.from({ length: count }).map((_, i) => (
				<Card key={i}>
					<CardContent className='p-4 space-y-3'>
						<Skeleton className='h-4 w-24' />
						<Skeleton className='h-8 w-20' />
						<Skeleton className='h-3 w-32' />
					</CardContent>
				</Card>
			))}
		</div>
	)
}

export function SkeletonPage() {
	return (
		<div className='space-y-6'>
			<SkeletonKpiCards count={4} />
			<div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
				<div className='lg:col-span-2 space-y-4'>
					<SkeletonCard />
					<SkeletonCard />
				</div>
				<div className='space-y-4'>
					<SkeletonCard />
					<SkeletonCard />
				</div>
			</div>
		</div>
	)
}

// ─── Recruiter Dashboard Skeleton ─────────────────────────

export function RecruiterDashboardSkeleton() {
	return (
		<div className='space-y-8'>
			{/* Welcome header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div className='space-y-2'>
					<Skeleton className='h-8 w-64' />
					<Skeleton className='h-4 w-80' />
				</div>
				<Skeleton className='h-10 w-32' />
			</div>

			{/* Upgrade banner */}
			<Card>
				<CardContent className='p-4 flex items-center gap-4'>
					<Skeleton className='h-10 w-10 rounded-lg shrink-0' />
					<div className='flex-1 min-w-0 space-y-2'>
						<Skeleton className='h-4 w-48' />
						<Skeleton className='h-3 w-full max-w-md' />
					</div>
					<Skeleton className='h-9 w-20 shrink-0' />
					<Skeleton className='h-9 w-9 shrink-0' />
				</CardContent>
			</Card>

			{/* Trust score banner */}
			<Card>
				<CardContent className='flex items-center gap-4 p-4'>
					<Skeleton className='h-8 w-8 shrink-0' />
					<div className='flex-1 space-y-2'>
						<Skeleton className='h-4 w-56' />
						<Skeleton className='h-3 w-72' />
					</div>
					<Skeleton className='h-9 w-28 shrink-0' />
				</CardContent>
			</Card>

			{/* Quick stats */}
			<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
				{Array.from({ length: 5 }).map((_, i) => (
					<Card key={i}>
						<CardContent className='p-4 space-y-3'>
							<div className='flex items-center justify-between'>
								<Skeleton className='h-10 w-10 rounded-lg' />
								<Skeleton className='h-5 w-16' />
							</div>
							<Skeleton className='h-7 w-16' />
							<Skeleton className='h-3 w-24' />
						</CardContent>
					</Card>
				))}
			</div>

			{/* Action items */}
			<Card>
				<CardHeader className='pb-3'>
					<Skeleton className='h-5 w-32' />
				</CardHeader>
				<CardContent className='pt-0'>
					<div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
						{Array.from({ length: 4 }).map((_, i) => (
							<div key={i} className='flex items-center gap-3 rounded-lg border p-3'>
								<Skeleton className='h-8 w-8 rounded-md shrink-0' />
								<div className='min-w-0 flex-1 space-y-2'>
									<Skeleton className='h-4 w-full' />
									<Skeleton className='h-3 w-3/4' />
								</div>
								<Skeleton className='h-5 w-8 shrink-0' />
							</div>
						))}
					</div>
				</CardContent>
			</Card>

			{/* Main grid: Pipeline + Activity */}
			<div className='grid gap-6 lg:grid-cols-3'>
				<div className='lg:col-span-2 space-y-4'>
					{/* Pipeline header */}
					<div className='flex items-center justify-between'>
						<div className='space-y-2'>
							<Skeleton className='h-6 w-40' />
							<Skeleton className='h-3 w-48' />
						</div>
						<Skeleton className='h-9 w-28' />
					</div>
					{/* Horizontal pipeline bar */}
					<div className='flex items-center gap-1 rounded-lg border bg-card p-4 overflow-x-auto'>
						{Array.from({ length: 6 }).map((_, i) => (
							<div key={i} className='flex items-center gap-1 shrink-0'>
								<Skeleton className='h-16 w-[72px] sm:w-[100px] rounded-lg' />
								{i < 5 && <Skeleton className='h-4 w-4' />}
							</div>
						))}
					</div>
					{/* Pipeline cards */}
					<div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
						{Array.from({ length: 3 }).map((_, i) => (
							<Card key={i}>
								<CardHeader className='pb-2'>
									<div className='flex items-center justify-between'>
										<Skeleton className='h-4 w-20' />
										<Skeleton className='h-5 w-8' />
									</div>
								</CardHeader>
								<CardContent className='pt-0 space-y-2'>
									{Array.from({ length: 3 }).map((_, j) => (
										<div key={j} className='flex items-center gap-2 rounded-md p-2'>
											<Skeleton className='h-7 w-7 rounded-full shrink-0' />
											<div className='min-w-0 flex-1 space-y-1'>
												<Skeleton className='h-3 w-full' />
												<Skeleton className='h-3 w-3/4' />
											</div>
											<Skeleton className='h-5 w-10 shrink-0' />
										</div>
									))}
								</CardContent>
							</Card>
						))}
					</div>
				</div>

				{/* Right sidebar: Activity + Performance */}
				<div className='space-y-6'>
					{/* Recent Activity */}
					<Card>
						<CardHeader className='pb-3'>
							<Skeleton className='h-5 w-32' />
						</CardHeader>
						<CardContent className='pt-0'>
							<div className='space-y-3'>
								{Array.from({ length: 5 }).map((_, i) => (
									<div key={i} className='flex items-start gap-3 rounded-md p-2'>
										<Skeleton className='h-8 w-8 rounded-md shrink-0' />
										<div className='min-w-0 flex-1 space-y-1'>
											<Skeleton className='h-3 w-3/4' />
											<Skeleton className='h-3 w-full' />
											<Skeleton className='h-3 w-16' />
										</div>
									</div>
								))}
							</div>
							<Skeleton className='h-9 w-full mt-3' />
						</CardContent>
					</Card>

					{/* Performance */}
					<Card>
						<CardHeader className='pb-3'>
							<Skeleton className='h-5 w-24' />
						</CardHeader>
						<CardContent className='pt-0 space-y-4'>
							{Array.from({ length: 4 }).map((_, i) => (
								<div key={i}>
									<div className='flex items-center justify-between mb-1'>
										<Skeleton className='h-3 w-24' />
										<Skeleton className='h-3 w-20' />
									</div>
									<Skeleton className='h-2 w-full' />
									<Skeleton className='h-3 w-32 mt-1' />
								</div>
							))}
							<Skeleton className='h-9 w-full' />
						</CardContent>
					</Card>
				</div>
			</div>

			{/* Quick Actions Bar */}
			<div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
				{Array.from({ length: 4 }).map((_, i) => (
					<Card key={i}>
						<CardContent className='flex items-center gap-3 p-4'>
							<Skeleton className='h-10 w-10 rounded-lg shrink-0' />
							<div className='min-w-0 flex-1 space-y-1'>
								<Skeleton className='h-4 w-full' />
								<Skeleton className='h-3 w-3/4' />
							</div>
							<Skeleton className='h-4 w-4 shrink-0' />
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	)
}

// ─── Page Loading Wrapper ───────────────────────────────────

export function PageLoading({ message = 'Loading...' }: { message?: string }) {
	return (
		<div className='flex flex-col items-center justify-center py-20 space-y-4'>
			<div className='h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent' />
			<p className='text-sm text-muted-foreground'>{message}</p>
		</div>
	)
}

// ─── Route Transition Loading ───────────────────────────────

export function RouteLoading({ children }: { children: React.ReactNode }) {
	const [isLoading, setIsLoading] = useState(false)
	const _location = useLocation()

	useEffect(() => {
		setIsLoading(true)
		const timer = setTimeout(() => setIsLoading(false), 300)
		return () => clearTimeout(timer)
	}, [])

	if (!isLoading) return <>{children}</>

	return (
		<div className='relative'>
			<div
				className='fixed top-0 left-0 right-0 h-0.5 z-50 overflow-hidden bg-muted'
				style={{
					animation: 'progress 2s ease-in-out infinite',
				}}
			>
				<div className='h-full bg-primary w-1/3' />
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
	message = 'Loading data...',
}: {
	children: React.ReactNode
	isLoading: boolean
	skeleton?: 'card' | 'table' | 'kpi' | 'page' | 'none'
	message?: string
}) {
	if (!isLoading) return <>{children}</>

	return (
		<div className='space-y-4'>
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
	factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
	return React.lazy(factory)
}

import React from 'react'

export { React }
