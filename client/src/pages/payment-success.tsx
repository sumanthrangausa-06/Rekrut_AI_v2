import {
	ArrowRight,
	CheckCircle,
	Lightbulb,
	Loader2,
	Mic,
	Share2,
	Sparkles,
	Target,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { apiCall } from '@/lib/api'

export function PaymentSuccessPage() {
	const [searchParams] = useSearchParams()
	const navigate = useNavigate()
	const [verifying, setVerifying] = useState(true)
	const [verifyError, setVerifyError] = useState<string | null>(null)
	const sessionId = searchParams.get('session_id') || searchParams.get('checkout_session_id')

	useEffect(() => {
		async function verifyPayment() {
			if (!sessionId) {
				setVerifyError('No session ID found in the URL.')
				setVerifying(false)
				return
			}
			try {
				const res = await apiCall<{ success?: boolean; verified?: boolean }>(
					`/auth/verify-payment?session_id=${sessionId}`,
				)
				if (!res.verified) {
					setVerifyError('Payment verification failed. If you were charged, contact support.')
				}
			} catch (err) {
				setVerifyError(err instanceof Error ? err.message : 'Payment verification failed.')
			} finally {
				setVerifying(false)
			}
		}
		verifyPayment()
	}, [sessionId])

	const features = [
		{ icon: Target, label: 'Full OmniScore (all factors)' },
		{ icon: Mic, label: 'Unlimited mock interviews' },
		{ icon: Sparkles, label: 'Role-specific score variants' },
		{ icon: Share2, label: 'Shareable score badge' },
		{ icon: Lightbulb, label: 'Detailed improvement tips' },
	]

	return (
		<div className='min-h-screen flex items-center justify-center p-6 bg-background'>
			<Card className='max-w-md w-full text-center border-primary/50 shadow-lg'>
				<CardContent className='p-8 space-y-6'>
					{verifying ? (
						<div className='py-12'>
							<Loader2 className='h-10 w-10 animate-spin text-primary mx-auto' />
							<p className='text-sm text-muted-foreground mt-4'>Verifying payment...</p>
						</div>
					) : verifyError ? (
						<div className='py-6 space-y-4'>
							<div className='text-6xl'>⚠️</div>
							<div className='space-y-2'>
								<h1 className='text-2xl font-bold'>Payment verification issue</h1>
								<p className='text-muted-foreground text-sm'>{verifyError}</p>
							</div>
							<div className='flex flex-col gap-2'>
								<Button size='lg' className='w-full' onClick={() => navigate('/pricing')}>
									Return to Pricing
								</Button>
								<Button
									variant='outline'
									size='lg'
									className='w-full'
									onClick={() => window.location.reload()}
								>
									Retry Verification
								</Button>
							</div>
						</div>
					) : (
						<>
							<div className='text-6xl'>🎉</div>
							<div className='space-y-2'>
								<h1 className='text-3xl font-bold'>Welcome to Pro!</h1>
								<p className='text-muted-foreground'>
									Your payment was successful. You now have unlimited access to all Rekrut AI
									features.
								</p>
							</div>

							<div className='bg-accent rounded-lg p-5 text-left'>
								<h3 className='font-semibold text-sm mb-3 text-muted-foreground'>
									What&apos;s unlocked:
								</h3>
								<ul className='space-y-2'>
									{features.map((feature) => (
										<li
											key={feature.label}
											className='flex items-center gap-2 text-sm text-primary'
										>
											<CheckCircle className='h-4 w-4 shrink-0' />
											{feature.label}
										</li>
									))}
								</ul>
							</div>

							<Button size='lg' className='w-full' onClick={() => navigate('/dashboard')}>
								Go to Dashboard
								<ArrowRight className='ml-2 h-4 w-4' />
							</Button>
						</>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
