import { ArrowRight, Gift, Loader2, Sparkles, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function ReferralLandingPage() {
	const [searchParams] = useSearchParams()
	const [refCode, setRefCode] = useState<string | null>(null)
	const [tracking, setTracking] = useState(false)

	useEffect(() => {
		const code = searchParams.get('ref')
		if (code) {
			const normalized = code.toUpperCase().trim()
			setRefCode(normalized)
			localStorage.setItem('referral_code', normalized)

			// Also track server-side
			setTracking(true)
			fetch('/api/referrals/track', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ref: normalized }),
			})
				.catch(() => {
					// Non-blocking: localStorage is the fallback
				})
				.finally(() => setTracking(false))
		}
	}, [searchParams])

	return (
		<div className='min-h-screen bg-background flex flex-col'>
			{/* Header */}
			<header className='border-b bg-card'>
				<div className='max-w-5xl mx-auto px-4 h-16 flex items-center justify-between'>
					<Link to='/' className='flex items-center gap-2 font-heading font-bold text-lg'>
						<div className='h-8 w-8 rounded-lg bg-primary flex items-center justify-center'>
							<Sparkles className='h-4 w-4 text-primary-foreground' />
						</div>
						Rekrut AI
					</Link>
					<div className='flex items-center gap-3'>
						<Link
							to='/login'
							className='text-sm font-medium text-muted-foreground hover:text-foreground transition-colors'
						>
							Sign in
						</Link>
						<Button asChild size='sm'>
							<Link to={`/register${refCode ? `?ref=${refCode}` : ''}`}>
								Sign up
							</Link>
						</Button>
					</div>
				</div>
			</header>

			{/* Hero */}
			<main className='flex-1 flex items-center justify-center px-4 py-12 sm:py-20'>
				<div className='max-w-2xl mx-auto text-center space-y-8'>
					{/* Tag */}
					<div className='inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary'>
						<Gift className='h-4 w-4' />
						{refCode ? 'You were invited!' : 'Join Rekrut AI'}
					</div>

					{/* Headline */}
					<h1 className='text-3xl sm:text-5xl font-bold tracking-tight leading-tight'>
						{refCode
							? 'Your friend thinks you\'d be great at Rekrut AI'
								: 'Find your next opportunity with AI'}
					</h1>

					{/* Subtitle */}
					<p className='text-lg text-muted-foreground max-w-lg mx-auto'>
						AI-powered job matching, mock interviews, resume optimization,
						and career coaching — all in one place.
					</p>

					{/* CTA */}
					<div className='flex flex-col sm:flex-row items-center justify-center gap-4 pt-4'>
						<Button asChild size='lg' className='gap-2 min-w-[200px]'>
							<Link to={`/register${refCode ? `?ref=${refCode}` : ''}`}>
								{refCode ? 'Accept Invitation' : 'Get Started Free'}
								<ArrowRight className='h-4 w-4' />
							</Link>
						</Button>
						{refCode && tracking && (
							<span className='text-xs text-muted-foreground flex items-center gap-1'>
								<Loader2 className='h-3 w-3 animate-spin' />
								Tracking referral...
							</span>
						)}
					</div>

					{/* Trust indicators */}
					<div className='pt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground'>
						<div className='flex items-center gap-2'>
							<Users className='h-4 w-4' />
							<span>10,000+ professionals</span>
						</div>
						<div className='flex items-center gap-2'>
							<Sparkles className='h-4 w-4' />
							<span>AI-powered matching</span>
						</div>
						<div className='flex items-center gap-2'>
							<Gift className='h-4 w-4' />
							<span>Free to join</span>
						</div>
					</div>
				</div>
			</main>

			{/* Footer */}
			<footer className='border-t py-6 text-center text-sm text-muted-foreground'>
				<p> Rekrut AI. All rights reserved.</p>
			</footer>
		</div>
	)
}

export default ReferralLandingPage
