import {
	AlertTriangle,
	ArrowRight,
	Building2,
	CheckCircle,
	Loader2,
	MessageSquare,
	Search,
	Shield,
	Star,
	TrendingUp,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { apiCall } from '@/lib/api'

// ─── Types ──────────────────────────────────────────────────

interface LeaderboardCompany {
	company_id: number
	company_name: string
	slug: string
	logo_url: string | null
	industry: string
	is_verified: boolean
	total_score: number
	score_tier: string
	response_rate_score: number
	data_sufficiency_score: number
	active_jobs: number
	badges: Array<{ type: string; label: string }>
	insufficient_data: boolean
}

interface LeaderboardResponse {
	success: boolean
	companies: LeaderboardCompany[]
	pagination: {
		total: number
		limit: number
		offset: number
		has_more: boolean
	}
}

// ─── Helpers ────────────────────────────────────────────────

const tierColors: Record<string, string> = {
	exceptional: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
	excellent: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
	trusted: 'bg-green-500/10 text-green-600 border-green-500/30',
	good: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
	building: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
	new: 'bg-slate-500/10 text-slate-500 border-slate-500/30',
}

function rankStyle(rank: number): string {
	if (rank === 1) return 'bg-yellow-500 text-white'
	if (rank === 2) return 'bg-slate-400 text-white'
	if (rank === 3) return 'bg-amber-600 text-white'
	return 'bg-muted text-muted-foreground'
}

// ─── Component ──────────────────────────────────────────────

export function LeaderboardPage() {
	const [companies, setCompanies] = useState<LeaderboardCompany[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [search, setSearch] = useState('')
	const [offset, setOffset] = useState(0)
	const [hasMore, setHasMore] = useState(false)
	const [total, setTotal] = useState(0)
	const limit = 50

	const loadLeaderboard = useCallback(
		async (newOffset = 0, append = false) => {
			setLoading(true)
			setError(null)
			try {
				const data = await apiCall<LeaderboardResponse>(
					`/trustscore/leaderboard?limit=${limit}&offset=${newOffset}`,
				)
				if (append) {
					setCompanies((prev) => [...prev, ...(data.companies || [])])
				} else {
					setCompanies(data.companies || [])
				}
				setHasMore(data.pagination?.has_more ?? false)
				setTotal(data.pagination?.total ?? 0)
			} catch (err: any) {
				setError(err.message || 'Failed to load leaderboard')
			} finally {
				setLoading(false)
			}
		},
		[],
	)

	useEffect(() => {
		loadLeaderboard(0, false)
	}, [loadLeaderboard])

	const filtered = companies.filter((c) =>
		c.company_name.toLowerCase().includes(search.trim().toLowerCase()),
	)

	const handleLoadMore = () => {
		const newOffset = offset + limit
		setOffset(newOffset)
		loadLeaderboard(newOffset, true)
	}

	return (
		<div className='max-w-5xl mx-auto space-y-6'>
			{/* Header */}
			<div className='text-center space-y-3 py-6'>
				<h1 className='text-2xl sm:text-3xl font-bold tracking-tight flex items-center justify-center gap-2'>
					<Shield className='h-7 w-7 text-primary' />
					Company TrustScore Leaderboard
				</h1>
				<p className='text-muted-foreground max-w-xl mx-auto'>
					Compare companies by their TrustScore — a composite of candidate feedback, response
					rates, interview experience, and hiring transparency.
				</p>
			</div>

			{/* Search */}
			<div className='relative max-w-md mx-auto'>
				<Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
				<Input
					placeholder='Search companies...'
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className='pl-9'
				/>
			</div>

			{/* Stats */}
			<div className='flex items-center justify-center gap-4 text-sm text-muted-foreground'>
				<span>
					<TrendingUp className='h-3.5 w-3.5 inline mr-1' />
					{total} companies ranked
				</span>
				{search && (
					<span>
						{filtered.length} match{filtered.length !== 1 ? 'es' : ''}
					</span>
				)}
			</div>

			{/* Error */}
			{error && (
				<div className='rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3'>
					<AlertTriangle className='h-5 w-5 shrink-0 text-red-600 mt-0.5' />
					<div className='flex-1'>
						<p className='text-sm font-medium text-red-800'>Failed to load leaderboard</p>
						<p className='text-sm text-red-700'>{error}</p>
					</div>
					<Button variant='outline' size='sm' onClick={() => loadLeaderboard(0, false)}>
						Retry
					</Button>
				</div>
			)}

			{/* Loading */}
			{loading && companies.length === 0 && (
				<div className='flex items-center justify-center py-16'>
					<Loader2 className='h-8 w-8 animate-spin text-primary' />
				</div>
			)}

			{/* Empty */}
			{!loading && filtered.length === 0 && (
				<div className='text-center py-16'>
					<Building2 className='h-12 w-12 mx-auto text-muted-foreground/30 mb-4' />
					<h3 className='font-semibold text-lg'>No companies found</h3>
					<p className='text-muted-foreground'>
						{search
							? 'Try a different search term'
							: 'No companies have enough data to be ranked yet.'}
					</p>
				</div>
			)}

			{/* List */}
			<div className='space-y-3'>
				{filtered.map((company, index) => {
					const rank = search ? index + 1 : companies.indexOf(company) + 1
					const responsePct =
						company.response_rate_score != null
							? Math.round((company.response_rate_score / 75) * 100)
							: 0

					return (
						<Card
							key={company.company_id}
							className='hover:border-primary/30 transition-colors'
						>
							<CardContent className='p-4 sm:p-5'>
								<div className='flex items-start gap-4'>
									{/* Rank */}
									<div
										className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${rankStyle(
											rank,
										)}`}
									>
										{rank}
									</div>

									{/* Logo */}
									<div className='h-12 w-12 rounded-xl bg-muted border flex items-center justify-center shrink-0 overflow-hidden'>
										{company.logo_url ? (
											<img
												src={company.logo_url}
												alt={company.company_name}
												className='h-full w-full object-cover'
											/>
										) : (
											<Building2 className='h-5 w-5 text-muted-foreground/60' />
										)}
									</div>

									{/* Info */}
									<div className='flex-1 min-w-0'>
										<div className='flex flex-wrap items-center gap-2 mb-1'>
											<h3 className='font-semibold text-base truncate'>{company.company_name}</h3>
											{company.is_verified && (
												<Badge
													variant='outline'
													className='bg-blue-50 text-blue-700 border-blue-200 text-[10px] gap-0.5'
												>
													<CheckCircle className='h-3 w-3' /> Verified
												</Badge>
											)}
											<Badge
												variant='outline'
												className={
													tierColors[company.score_tier] || tierColors.new
												}
											>
												<Shield className='h-3 w-3 mr-0.5' />
												{company.total_score}
											</Badge>
											{company.insufficient_data && (
												<Badge
													variant='outline'
													className='bg-amber-50 text-amber-700 border-amber-200 text-[10px]'
												>
													<AlertTriangle className='h-3 w-3 mr-0.5' />
													Not enough data
												</Badge>
											)}
										</div>

										<div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground'>
											{company.industry && <span>{company.industry}</span>}
											{company.active_jobs > 0 && (
												<span>{company.active_jobs} open job{company.active_jobs !== 1 ? 's' : ''}</span>
											)}
										</div>

										{/* Badges */}
										{company.badges && company.badges.length > 0 && (
											<div className='flex flex-wrap gap-1 mt-2'>
												{company.badges.map((badge) => (
													<Badge
														key={badge.type}
														variant='secondary'
														className='text-[10px] h-5'
													>
														{badge.label}
													</Badge>
												))}
											</div>
										)}
									</div>

									{/* Response Rate */}
									<div className='hidden sm:flex flex-col items-end gap-1 shrink-0 min-w-[100px]'>
										<div className='flex items-center gap-1 text-sm'>
											<MessageSquare className='h-3.5 w-3.5 text-muted-foreground' />
											<span className='font-medium'>{responsePct}%</span>
											<span className='text-xs text-muted-foreground'>response</span>
										</div>
										<Link
											to={`/company/${company.slug}`}
											className='text-xs text-primary hover:underline flex items-center gap-0.5'
										>
											View <ArrowRight className='h-3 w-3' />
										</Link>
									</div>
								</div>

								{/* Mobile: response rate row */}
								<div className='flex sm:hidden items-center justify-between mt-3 pt-3 border-t'>
									<div className='flex items-center gap-1 text-sm'>
										<MessageSquare className='h-3.5 w-3.5 text-muted-foreground' />
										<span className='font-medium'>{responsePct}%</span>
										<span className='text-xs text-muted-foreground'>response rate</span>
									</div>
									<Link
										to={`/company/${company.slug}`}
										className='text-xs text-primary hover:underline flex items-center gap-0.5'
									>
										View <ArrowRight className='h-3 w-3' />
									</Link>
								</div>
							</CardContent>
						</Card>
					)
				})}
			</div>

			{/* Load More */}
			{hasMore && !search && (
				<div className='flex justify-center pt-4'>
					<Button
						variant='outline'
						onClick={handleLoadMore}
						disabled={loading}
						className='min-h-[44px]'
					>
						{loading ? (
							<Loader2 className='h-4 w-4 animate-spin mr-2' />
						) : (
							<Star className='h-4 w-4 mr-2' />
						)}
						Load More
					</Button>
				</div>
			)}
		</div>
	)
}
