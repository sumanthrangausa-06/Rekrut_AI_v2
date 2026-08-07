import { useCallback, useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import { Header } from './header'
import { Sidebar } from './sidebar'
import { AIChatFAB } from '@/components/domain/ai-chat-fab'

export function DashboardLayout() {
	const { isAuthenticated, loading, user } = useAuth()
	const [sidebarOpen, setSidebarOpen] = useState(false)
	const location = useLocation()
	const isCandidateRoute = location.pathname.startsWith('/candidate') || user?.role === 'candidate'

	const handleCloseSidebar = useCallback(() => setSidebarOpen(false), [])

	useEffect(() => {
		setSidebarOpen(false)
	}, [])

	useEffect(() => {
		if (!sidebarOpen) return

		const previousOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setSidebarOpen(false)
			}
		}

		window.addEventListener('keydown', handleKeyDown)

		return () => {
			document.body.style.overflow = previousOverflow
			window.removeEventListener('keydown', handleKeyDown)
		}
	}, [sidebarOpen])

	if (loading) {
		return (
			<div className='flex h-dvh-safe items-center justify-center'>
				<div className='flex flex-col items-center gap-3'>
					<div className='h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent' />
					<p className='text-sm text-muted-foreground'>Loading...</p>
				</div>
			</div>
		)
	}

	if (!isAuthenticated) {
		return <Navigate to='/login' replace />
	}

	return (
		<div className='flex h-dvh-safe overflow-hidden bg-background'>
			<a
				href='#main-content'
				className='sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg'
			>
				Skip to content
			</a>
			<Sidebar open={sidebarOpen} onClose={handleCloseSidebar} />
			<div className='flex flex-1 flex-col overflow-hidden'>
				<Header sidebarOpen={sidebarOpen} onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
				<main
					id='main-content'
					className='flex-1 overflow-y-auto bg-muted/30 p-3 pb-8 overscroll-contain sm:p-4 lg:p-6 lg:pb-6 touch-scroll'
				>
					<Outlet />
				</main>
				<footer className='border-t bg-card py-4 px-4 lg:px-6'>
					<div className='flex flex-col sm:flex-row justify-between items-center gap-2'>
						<p className='text-sm text-muted-foreground'>© 2026 Rekrut AI, Inc.</p>
						<div className='flex gap-4'>
							<a
								href='#'
								className='text-sm text-muted-foreground hover:text-foreground min-h-[44px] inline-flex items-center px-2'
							>
								Privacy
							</a>
							<a
								href='#'
								className='text-sm text-muted-foreground hover:text-foreground min-h-[44px] inline-flex items-center px-2'
							>
								Terms
							</a>
							<a
								href='#'
								className='text-sm text-muted-foreground hover:text-foreground min-h-[44px] inline-flex items-center px-2'
							>
								Help Center
							</a>
						</div>
					</div>
				</footer>
			</div>
			{isCandidateRoute && <AIChatFAB />}
		</div>
	)
}
