import {
	AlertTriangle,
	CheckCircle,
	Copy,
	Gift,
	Link,
	Loader2,
	Mail,
	Share2,
	Users,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiCall } from '@/lib/api'

// ─── Types ───────────────────────────────────────────────────────────────

interface Referral {
	id: string
	referral_code: string
	referred_email: string | null
	referred_name: string | null
	status: 'pending' | 'registered' | 'converted'
	reward_status: 'pending' | 'claimed' | 'paid'
	created_at: string
	converted_at: string | null
}

interface Reward {
	id: string
	reward_type: 'credits' | 'premium_days'
	amount: number
	status: 'pending' | 'claimed' | 'paid'
	created_at: string
	referral_code: string | null
}

interface ReferralsResponse {
	success: boolean
	referral_code: string | null
	referral_link: string | null
	stats: {
		invites_sent: number
		registered: number
		converted: number
		total_earned: number
		pending_count: number
	}
	referrals: Referral[]
	rewards: Reward[]
}

// ─── Component ───────────────────────────────────────────────────────────

export function ReferralsPage() {
	const [data, setData] = useState<ReferralsResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [generating, setGenerating] = useState(false)
	const [claiming, setClaiming] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const [toastMessage, setToastMessage] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

	const loadData = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const result = await apiCall<ReferralsResponse>('/referrals')
			setData(result)
		} catch (err: any) {
			setError(err.message || 'Failed to load referrals')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadData()
	}, [loadData])

	const handleGenerate = async () => {
		setGenerating(true)
		try {
			await apiCall('/referrals/generate', { method: 'POST' })
			await loadData()
			setToastMessage({ message: 'Your referral code is ready!', type: 'success' })
		} catch (err: any) {
			setToastMessage({ message: err.message || 'Failed to generate code', type: 'error' })
		} finally {
			setGenerating(false)
		}
	}

	const handleCopyLink = async () => {
		if (!data?.referral_link) return
		try {
			await navigator.clipboard.writeText(data.referral_link)
			setCopied(true)
			setToastMessage({ message: 'Link copied to clipboard!', type: 'success' })
			setTimeout(() => setCopied(false), 2000)
		} catch {
			// Fallback
			const input = document.createElement('input')
			input.value = data.referral_link
			document.body.appendChild(input)
			input.select()
			document.execCommand('copy')
			document.body.removeChild(input)
			setCopied(true)
			setToastMessage({ message: 'Link copied to clipboard!', type: 'success' })
			setTimeout(() => setCopied(false), 2000)
		}
	}

	const handleEmailShare = () => {
		if (!data?.referral_link) return
		const subject = 'Join me on Rekrut AI — AI-powered job matching'
		const body = `Hey!\n\nI thought you'd love Rekrut AI — it uses AI to match you with the best jobs and even helps with interview practice.\n\nSign up with my link: ${data.referral_link}\n\nCheers!`
		window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
	}

	const handleClaim = async () => {
		setClaiming(true)
		try {
			await apiCall('/referrals/claim', { method: 'POST' })
			await loadData()
			setToastMessage({ message: 'Rewards claimed successfully!', type: 'success' })
		} catch (err: any) {
			setToastMessage({ message: err.message || 'Failed to claim rewards', type: 'error' })
		} finally {
			setClaiming(false)
		}
	}

	if (loading && !data) {
		return (
			<div className='flex items-center justify-center py-20'>
				<Loader2 className='h-8 w-8 animate-spin text-primary' />
			</div>
		)
	}

	return (
		<div className='max-w-4xl mx-auto space-y-6'>
			{/* Header */}
			<div className='space-y-1'>
				<h1 className='text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2'>
					<Gift className='h-7 w-7 text-primary' />
					Refer & Earn
				</h1>
				<p className='text-muted-foreground'>
					Invite friends to Rekrut AI and earn premium days when they sign up.
				</p>
			</div>

			{/* Error */}
			{error && (
				<div className='rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3'>
					<AlertTriangle className='h-5 w-5 shrink-0 text-red-600 mt-0.5' />
					<div className='flex-1'>
						<p className='text-sm font-medium text-red-800'>Something went wrong</p>
						<p className='text-sm text-red-700'>{error}</p>
					</div>
					<Button variant='outline' size='sm' onClick={loadData}>
						Retry
					</Button>
				</div>
			)}

			{/* Referral Code Card */}
			<Card>
				<CardHeader>
					<CardTitle className='text-base flex items-center gap-2'>
						<Link className='h-4 w-4 text-primary' />
						Your Referral Link
					</CardTitle>
				</CardHeader>
				<CardContent className='space-y-4'>
					{data?.referral_code ? (
						<>
							<div className='flex flex-col sm:flex-row gap-3'>
								<div className='flex-1 flex items-center gap-2 rounded-lg border bg-muted px-3 py-2.5'>
									<Link className='h-4 w-4 text-muted-foreground shrink-0' />
									<span className='text-sm font-mono truncate'>
										{data.referral_link}
									</span>
								</div>
								<div className='flex gap-2'>
									<Button
										variant='outline'
										className='gap-2'
										onClick={handleCopyLink}
									>
										{copied ? (
											<CheckCircle className='h-4 w-4 text-green-600' />
										) : (
											<Copy className='h-4 w-4' />
										)}
										Copy
									</Button>
									<Button
										variant='outline'
										className='gap-2'
										onClick={handleEmailShare}
									>
										<Mail className='h-4 w-4' />
										Email
									</Button>
								</div>
							</div>
							<div className='flex items-center gap-2 text-sm text-muted-foreground'>
								<Share2 className='h-4 w-4' />
								<span>
									Share this link with friends. When they sign up, you'll both get
									rewards.
								</span>
							</div>
						</>
					) : (
						<div className='text-center py-6 space-y-3'>
							<p className='text-muted-foreground'>
								You don't have a referral code yet. Generate one to start earning.
							</p>
							<Button onClick={handleGenerate} disabled={generating} className='gap-2'>
								{generating ? (
									<Loader2 className='h-4 w-4 animate-spin' />
								) : (
									<Link className='h-4 w-4' />
								)}
								Generate Code
							</Button>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Stats Cards */}
			{data && (
				<div className='grid grid-cols-2 sm:grid-cols-4 gap-4'>
					<Card>
						<CardContent className='p-4'>
							<div className='text-2xl font-bold'>{data.stats.invites_sent}</div>
							<div className='text-xs text-muted-foreground flex items-center gap-1 mt-1'>
								<Mail className='h-3 w-3' /> Invites Sent
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardContent className='p-4'>
							<div className='text-2xl font-bold'>{data.stats.registered}</div>
							<div className='text-xs text-muted-foreground flex items-center gap-1 mt-1'>
								<Users className='h-3 w-3' /> Registered
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardContent className='p-4'>
							<div className='text-2xl font-bold'>{data.stats.converted}</div>
							<div className='text-xs text-muted-foreground flex items-center gap-1 mt-1'>
								<CheckCircle className='h-3 w-3' /> Converted
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardContent className='p-4'>
							<div className='text-2xl font-bold'>{data.stats.total_earned}</div>
							<div className='text-xs text-muted-foreground flex items-center gap-1 mt-1'>
								<Gift className='h-3 w-3' /> Premium Days Earned
							</div>
						</CardContent>
					</Card>
				</div>
			)}

			{/* Claim Rewards */}
			{data && data.stats.pending_count > 0 && (
				<Card className='border-primary/30 bg-primary/5'>
					<CardContent className='p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4'>
						<div className='flex-1'>
							<p className='font-medium flex items-center gap-2'>
								<Gift className='h-4 w-4 text-primary' />
								You have {data.stats.pending_count} pending reward
								{data.stats.pending_count !== 1 ? 's' : ''}!
							</p>
							<p className='text-sm text-muted-foreground'>
								Claim them now to add premium days to your account.
							</p>
						</div>
						<Button onClick={handleClaim} disabled={claiming} className='gap-2 shrink-0'>
							{claiming ? (
								<Loader2 className='h-4 w-4 animate-spin' />
							) : (
								<Gift className='h-4 w-4' />
							)}
							Claim Rewards
						</Button>
					</CardContent>
				</Card>
			)}

			{/* Referrals Table */}
			{data && data.referrals.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className='text-base'>Your Referrals</CardTitle>
					</CardHeader>
					<CardContent className='p-0'>
						<div className='overflow-x-auto'>
							<table className='w-full text-sm'>
								<thead>
									<tr className='border-b bg-muted/50'>
										<th className='text-left px-4 py-3 font-medium'>Referred</th>
										<th className='text-left px-4 py-3 font-medium'>Status</th>
										<th className='text-left px-4 py-3 font-medium'>Reward</th>
										<th className='text-left px-4 py-3 font-medium'>Date</th>
									</tr>
								</thead>
								<tbody>
									{data.referrals.map((ref) => (
										<tr key={ref.id} className='border-b last:border-0'>
											<td className='px-4 py-3'>
												{ref.referred_name || ref.referred_email || (
													<span className='text-muted-foreground italic'>Anonymous</span>
												)}
											</td>
											<td className='px-4 py-3'>
												<StatusBadge status={ref.status} />
											</td>
											<td className='px-4 py-3'>
												<RewardBadge status={ref.reward_status} />
											</td>
											<td className='px-4 py-3 text-muted-foreground'>
												{new Date(ref.created_at).toLocaleDateString()}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Rewards Table */}
			{data && data.rewards.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className='text-base'>Rewards History</CardTitle>
					</CardHeader>
					<CardContent className='p-0'>
						<div className='overflow-x-auto'>
							<table className='w-full text-sm'>
								<thead>
									<tr className='border-b bg-muted/50'>
										<th className='text-left px-4 py-3 font-medium'>Type</th>
										<th className='text-left px-4 py-3 font-medium'>Amount</th>
										<th className='text-left px-4 py-3 font-medium'>Status</th>
										<th className='text-left px-4 py-3 font-medium'>Date</th>
									</tr>
								</thead>
								<tbody>
									{data.rewards.map((reward) => (
										<tr key={reward.id} className='border-b last:border-0'>
											<td className='px-4 py-3'>
												{reward.reward_type === 'premium_days' ? 'Premium Days' : 'Credits'}
											</td>
											<td className='px-4 py-3 font-medium'>
												+{reward.amount}
											</td>
											<td className='px-4 py-3'>
												<RewardBadge status={reward.status} />
											</td>
											<td className='px-4 py-3 text-muted-foreground'>
												{new Date(reward.created_at).toLocaleDateString()}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Empty state */}
			{data && data.referrals.length === 0 && data.referral_code && (
				<div className='text-center py-12 space-y-3'>
					<Users className='h-12 w-12 mx-auto text-muted-foreground/30' />
					<h3 className='font-semibold text-lg'>No referrals yet</h3>
					<p className='text-muted-foreground max-w-sm mx-auto'>
						Share your link with friends and colleagues to start earning rewards.
					</p>
				</div>
			)}
		</div>
	)
}

// ─── Sub-components ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
	const styles: Record<string, string> = {
		pending: 'bg-amber-100 text-amber-700',
		registered: 'bg-blue-100 text-blue-700',
		converted: 'bg-green-100 text-green-700',
	}
	return (
		<span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || 'bg-muted text-muted-foreground'}`}>
			{status === 'pending' && <Mail className='h-3 w-3 mr-1' />}
			{status === 'registered' && <Users className='h-3 w-3 mr-1' />}
			{status === 'converted' && <CheckCircle className='h-3 w-3 mr-1' />}
			{status.charAt(0).toUpperCase() + status.slice(1)}
		</span>
	)
}

function RewardBadge({ status }: { status: string }) {
	const styles: Record<string, string> = {
		pending: 'bg-amber-100 text-amber-700',
		claimed: 'bg-green-100 text-green-700',
		paid: 'bg-blue-100 text-blue-700',
	}
	return (
		<span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || 'bg-muted text-muted-foreground'}`}>
			<Gift className='h-3 w-3 mr-1' />
			{status.charAt(0).toUpperCase() + status.slice(1)}
		</span>
	)
}
