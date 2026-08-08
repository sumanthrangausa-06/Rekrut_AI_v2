import {
	Bookmark,
	BookmarkCheck,
	Building2,
	ChevronRight,
	Clock,
	DollarSign,
	MapPin,
	RotateCcw,
	Star,
	ThumbsUp,
	X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { ScoreRing } from './score-ring'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { trackEvent } from '@/lib/analytics'
import { cn } from '@/lib/utils'

export type JobCardProps = {
	id: string
	title: string
	company: string
	companyLogo?: string
	location: string
	locationType: 'remote' | 'hybrid' | 'onsite' | 'flexible'
	jobType: 'full-time' | 'part-time' | 'contract' | 'internship' | 'freelance'
	salaryMin?: number
	salaryMax?: number
	salaryCurrency?: string
	salaryPeriod?: 'year' | 'month' | 'hour'
	postedAt: string
	tags: string[]
	matchScore?: number | null
	isSaved?: boolean
	onSave?: (id: string) => void
	onApply?: (id: string) => void
	isLiked?: boolean
	isDisliked?: boolean
	onLike?: (id: string) => void
	onDislike?: (id: string) => void
	mode?: 'default' | 'trash' // trash mode shows restore instead of dismiss
	className?: string
}

function formatSalary(min?: number, max?: number, currency = 'USD', period = 'year'): string {
	if (!min && !max) return 'Competitive'
	const fmt = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency,
		maximumFractionDigits: 0,
	})
	const periodLabel = period === 'year' ? '/yr' : period === 'month' ? '/mo' : '/hr'
	if (min && max) return `${fmt.format(min)} – ${fmt.format(max)}${periodLabel}`
	if (min) return `${fmt.format(min)}+${periodLabel}`
	return `Up to ${fmt.format(max ?? 0)}${periodLabel}`
}

function locationLabel(type: string): string {
	switch (type) {
		case 'remote':
			return 'Remote'
		case 'hybrid':
			return 'Hybrid'
		case 'onsite':
			return 'On-site'
		case 'flexible':
			return 'Flexible'
		default:
			return type
	}
}

function locationBadgeVariant(type: string): 'default' | 'secondary' | 'outline' | 'destructive' {
	switch (type) {
		case 'remote':
			return 'default'
		case 'hybrid':
			return 'secondary'
		case 'onsite':
			return 'outline'
		default:
			return 'outline'
	}
}

export function JobCard({
	id,
	title,
	company,
	companyLogo,
	location,
	locationType,
	jobType,
	salaryMin,
	salaryMax,
	salaryCurrency,
	salaryPeriod,
	postedAt,
	tags,
	matchScore,
	isSaved = false,
	onSave,
	onApply,
	isLiked = false,
	isDisliked = false,
	onLike,
	onDislike,
	mode = 'default',
	className,
}: JobCardProps) {
	const handleSave = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		trackEvent('job_card_save_click', { job_id: id, saved: !isSaved })
		onSave?.(id)
	}

	const handleApply = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		trackEvent('job_card_apply_click', { job_id: id })
		onApply?.(id)
	}

	const handleLike = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		trackEvent('job_card_like_click', { job_id: id, liked: !isLiked })
		onLike?.(id)
	}

	const handleDislike = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		trackEvent('job_card_dismiss_click', { job_id: id, dismissed: mode !== 'trash' })
		onDislike?.(id)
	}

	const daysAgo = Math.max(0, Math.floor((Date.now() - new Date(postedAt).getTime()) / 86400000))
	const postedText = daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`

	return (
		<Card className={cn('group overflow-hidden transition-all hover:shadow-md', className)}>
			<CardHeader className='pb-2'>
				<div className='flex items-start justify-between gap-3'>
					<div className='flex items-center gap-3 min-w-0'>
						<Avatar className='h-10 w-10 border shrink-0'>
							<AvatarImage src={companyLogo} alt={company} />
							<AvatarFallback className='bg-primary/10 text-primary text-sm font-semibold'>
								{company.slice(0, 2).toUpperCase()}
							</AvatarFallback>
						</Avatar>
						<div className='min-w-0'>
							<h3 className='font-semibold text-base leading-tight truncate group-hover:text-primary transition-colors'>
								{title}
							</h3>
							<p className='text-sm text-muted-foreground flex items-center gap-1'>
								<Building2 className='h-3 w-3 shrink-0' />
								<span className='break-words'>{company}</span>
							</p>
						</div>
					</div>
					<div className='flex items-center gap-1 shrink-0'>
						<button
							type='button'
							onClick={handleLike}
							className={cn(
								'rounded-full transition-colors min-h-[44px] min-w-[44px] inline-flex items-center justify-center',
								isLiked
									? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400'
									: 'text-muted-foreground hover:bg-muted hover:text-emerald-600',
							)}
							aria-label={isLiked ? 'Unlike job' : 'Like job'}
						>
							<ThumbsUp className='h-4 w-4' />
						</button>
						<button
							type='button'
							onClick={handleDislike}
							className={cn(
								'rounded-full transition-colors min-h-[44px] min-w-[44px] inline-flex items-center justify-center',
								isDisliked
									? 'text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400'
									: mode === 'trash'
										? 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700'
										: 'text-muted-foreground hover:bg-muted hover:text-red-600',
							)}
							aria-label={mode === 'trash' ? 'Restore job' : 'Dismiss job'}
						>
							{mode === 'trash' ? <RotateCcw className='h-4 w-4' /> : <X className='h-4 w-4' />}
						</button>
						<button
							type='button'
							onClick={handleSave}
							className='rounded-full transition-colors min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-primary'
							aria-label={isSaved ? 'Remove bookmark' : 'Save job'}
						>
							{isSaved ? (
								<BookmarkCheck className='h-4 w-4 text-primary' />
							) : (
								<Bookmark className='h-4 w-4' />
							)}
						</button>
					</div>
				</div>
			</CardHeader>

			<CardContent className='pb-2 space-y-3'>
				{/* Match score */}
				{matchScore != null && (
					<div className='flex items-center gap-2'>
						<ScoreRing score={matchScore} size='sm' />
						<span
							className={cn(
								'text-xs font-semibold',
								matchScore >= 80
									? 'text-green-700 dark:text-green-400'
									: matchScore >= 60
										? 'text-amber-700 dark:text-amber-400'
										: 'text-red-700 dark:text-red-400',
							)}
						>
							{matchScore}% match
						</span>
						{matchScore >= 80 && (
							<Badge
								variant='outline'
								className='text-xs border-green-200 text-green-700 dark:border-green-800 dark:text-green-400'
							>
								<Star className='h-3 w-3 mr-0.5' />
								Top Applicant
							</Badge>
						)}
					</div>
				)}

				{/* Meta row */}
				<div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground'>
					<span className='flex items-center gap-1 min-w-0'>
						<MapPin className='h-3.5 w-3.5 shrink-0' />
						<span className='break-words'>{location}</span>
					</span>
					<Badge variant={locationBadgeVariant(locationType)} className='text-xs px-1.5 py-0'>
						{locationLabel(locationType)}
					</Badge>
					<span className='flex items-center gap-1 min-w-0'>
						<Clock className='h-3.5 w-3.5 shrink-0' />
						<span className='break-words'>{jobType}</span>
					</span>
					<span className='flex items-center gap-1 min-w-0'>
						<DollarSign className='h-3.5 w-3.5 shrink-0' />
						<span className='break-words'>{formatSalary(salaryMin, salaryMax, salaryCurrency, salaryPeriod)}</span>
					</span>
				</div>

				{/* Tags */}
				{tags.length > 0 && (
					<div className='flex flex-wrap gap-1.5'>
						{tags.slice(0, 5).map((tag) => (
							<Badge key={tag} variant='secondary' className='text-xs font-normal'>
								{tag}
							</Badge>
						))}
						{tags.length > 5 && (
							<Badge variant='secondary' className='text-xs font-normal'>
								+{tags.length - 5}
							</Badge>
						)}
					</div>
				)}

				<p className='text-xs text-muted-foreground'>Posted {postedText}</p>
			</CardContent>

			<CardFooter className='pt-0'>
				<div className='flex w-full gap-2'>
					<Button size='sm' className='flex-1 gap-1 min-h-[44px]' onClick={handleApply} asChild>
						<Link to={`/candidate/jobs/${id}`}>
							View details
							<ChevronRight className='h-3.5 w-3.5' />
						</Link>
					</Button>
					<Button size='sm' variant='outline' className='flex-1 min-h-[44px]' onClick={handleApply}>
						Quick apply
					</Button>
				</div>
			</CardFooter>
		</Card>
	)
}
