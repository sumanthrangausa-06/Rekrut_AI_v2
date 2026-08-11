import {
	Bookmark,
	BookmarkPlus,
	Building2,
	Clock,
	DollarSign,
	Globe,
	Heart,
	MapPin,
	TrendingUp,
	X,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// Inline the Job interface subset needed for the card to avoid import cycles
export interface JobCardData {
	id: number
	job_id?: number
	title: string
	company: string
	poster_company?: string
	description: string
	requirements: string
	location: string
	salary_range: string
	salary_min?: number
	salary_max?: number
	job_type: string
	status: string
	created_at: string
	// Match fields
	weighted_score?: number
	match_level?: string
	skill_match_pct?: number
	matching_skills?: string[]
	missing_skills?: string[]
	// Extended
	company_logo?: string
	company_size?: string
	remote_type?: 'remote' | 'hybrid' | 'onsite' | 'flexible'
	experience_level?: string
	skills_required?: string[]
	posted_by?: string
	applicants_count?: number
	has_applied?: boolean
	has_saved?: boolean
}

interface JobCardProps {
	job: JobCardData
	isSelected?: boolean
	isSaved?: boolean
	isLiked?: boolean
	isDismissed?: boolean
	activeTab?: string
	onSelect?: (job: JobCardData) => void
	onToggleSave?: (jobId: number, e: React.MouseEvent) => void
	onToggleLike?: (jobId: number, e: React.MouseEvent) => void
	onToggleDismiss?: (jobId: number, e: React.MouseEvent) => void
}

function timeAgo(dateStr: string) {
	const diff = Date.now() - new Date(dateStr).getTime()
	const days = Math.floor(diff / 86400000)
	if (days === 0) return 'Today'
	if (days === 1) return '1 day ago'
	if (days < 30) return `${days} days ago`
	return `${Math.floor(days / 30)} months ago`
}

function matchLevelLabel(level: string): string {
	if (level === 'excellent') return 'Excellent Match'
	if (level === 'good') return 'Good Match'
	if (level === 'fair') return 'Fair Match'
	return ''
}

export function JobCard({
	job,
	isSelected,
	isSaved,
	isLiked,
	isDismissed,
	activeTab = 'all',
	onSelect,
	onToggleSave,
	onToggleLike,
	onToggleDismiss,
}: JobCardProps) {
	const score = job.weighted_score ? Math.round(job.weighted_score) : null

	return (
		<Card
			className={cn(
				'transition-all cursor-pointer hover:shadow-md',
				isSelected
					? 'ring-2 ring-indigo-500 shadow-md border-indigo-200'
					: 'border',
			)}
			onClick={() => onSelect?.(job)}
		>
			<CardContent className='p-4 sm:p-5'>
				<div className='flex items-start gap-3 sm:gap-4'>
					{/* Company Logo */}
					<Avatar
						src={job.company_logo}
						fallback={(job.company || job.poster_company || 'C').charAt(0)}
						size='lg'
						className='h-12 w-12 sm:h-14 sm:w-14 shrink-0 rounded-full'
					/>

					<div className='flex-1 min-w-0'>
						{/* Title + Actions Row */}
						<div className='flex items-start justify-between gap-2'>
							<div className='min-w-0'>
								<h3 className='font-semibold text-sm sm:text-base truncate leading-tight'>
									{job.title}
								</h3>
								<p className='text-xs sm:text-sm text-muted-foreground flex items-center gap-1 mt-0.5'>
									<Building2 className='h-3 w-3 shrink-0' />
									<span className='break-words'>
										{job.company || job.poster_company || 'Company'}
									</span>
									{job.company_size && (
										<span className='text-[10px] bg-muted rounded px-1'>
											{job.company_size}
										</span>
									)}
								</p>
							</div>

							<div className='flex items-center gap-0.5 shrink-0 -mr-1 sm:-mr-2'>
								{job.has_applied && (
									<Badge className='bg-emerald-500 text-white text-[10px] px-1.5 py-0 mr-1'>
										Applied
									</Badge>
								)}

								{/* Save heart toggle */}
								<button
									onClick={(e) => onToggleSave?.(job.id, e)}
									className={cn(
										'rounded-full transition-colors h-9 w-9 sm:h-10 sm:w-10 inline-flex items-center justify-center',
										isSaved
											? 'text-red-500 bg-red-50 hover:bg-red-100'
											: 'text-muted-foreground hover:bg-muted hover:text-red-400',
									)}
									aria-label={isSaved ? 'Unsave job' : 'Save job'}
								>
									{isSaved ? (
										<Heart className='h-4 w-4 fill-red-500' />
									) : (
										<Heart className='h-4 w-4' />
									)}
								</button>

								{/* Like / ThumbsUp */}
								<button
									onClick={(e) => onToggleLike?.(job.id, e)}
									className={cn(
										'rounded-full transition-colors h-9 w-9 sm:h-10 sm:w-10 inline-flex items-center justify-center',
										isLiked
											? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
											: 'text-muted-foreground hover:bg-muted hover:text-emerald-600',
									)}
									aria-label={isLiked ? 'Unlike job' : 'Like job'}
								>
									<TrendingUp className='h-4 w-4' />
								</button>

								{/* Dismiss / Restore */}
								<button
									onClick={(e) => onToggleDismiss?.(job.id, e)}
									className={cn(
										'rounded-full transition-colors h-9 w-9 sm:h-10 sm:w-10 inline-flex items-center justify-center',
										isDismissed
											? 'text-red-600 bg-red-50 hover:bg-red-100'
											: activeTab === 'dismissed'
												? 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700'
												: 'text-muted-foreground hover:bg-muted hover:text-red-600',
									)}
									aria-label={isDismissed ? 'Restore job' : 'Dismiss job'}
								>
									{activeTab === 'dismissed' ? (
										<BookmarkPlus className='h-4 w-4' />
									) : (
										<X className='h-4 w-4' />
									)}
								</button>
							</div>
						</div>

						{/* Meta row: location, salary, type, remote, posted */}
						<div className='flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5 text-xs text-muted-foreground'>
							{job.location && (
								<span className='flex items-center gap-1 min-w-0'>
									<MapPin className='h-3 w-3 shrink-0' />
									<span className='break-words'>{job.location}</span>
								</span>
							)}
							{job.salary_range && (
								<span className='flex items-center gap-1 min-w-0'>
									<DollarSign className='h-3 w-3 shrink-0' />
									<span className='break-words font-medium text-foreground/80'>
										{job.salary_range}
									</span>
								</span>
							)}
							{job.job_type && (
								<Badge variant='secondary' className='text-[10px] h-5'>
									{job.job_type}
								</Badge>
							)}
							{job.remote_type && (
								<Badge variant='outline' className='text-[10px] h-5'>
									{job.remote_type === 'remote' && (
										<Globe className='h-2.5 w-2.5 mr-0.5' />
									)}
									{job.remote_type}
								</Badge>
							)}
							<span className='flex items-center gap-1 min-w-0'>
								<Clock className='h-3 w-3 shrink-0' />
								<span className='break-words'>{timeAgo(job.created_at)}</span>
							</span>
						</div>

						{/* Skills tags */}
						{(job.matching_skills?.length || job.skills_required?.length) ? (
							<div className='flex flex-wrap items-center gap-1.5 mt-2.5'>
								{job.matching_skills?.slice(0, 4).map((s) => (
									<Badge
										key={`match-${s}`}
										variant='outline'
										className='text-[10px] sm:text-xs bg-indigo-50 text-indigo-700 border-indigo-200 h-5'
									>
										{s}
									</Badge>
								))}
								{job.skills_required?.slice(0, 4).map((s) => (
									<Badge
										key={`req-${s}`}
										variant='outline'
										className='text-[10px] sm:text-xs h-5'
									>
										{s}
									</Badge>
								))}
								{(job.matching_skills?.length || 0) + (job.skills_required?.length || 0) > 4 && (
									<span className='text-[10px] text-muted-foreground'>
										+{(job.matching_skills?.length || 0) + (job.skills_required?.length || 0) - 4} more
									</span>
								)}
							</div>
						) : null}

						{/* Match score + missing skills */}
						{score != null && score < 80 && job.missing_skills && job.missing_skills.length > 0 && (
							<div className='flex flex-wrap items-center gap-1 mt-1.5'>
								<span className='text-[10px] text-amber-500 shrink-0'>To improve match:</span>
								{job.missing_skills.slice(0, 2).map((s) => (
									<span
										key={s}
										className='text-[10px] bg-amber-50 text-amber-700 rounded px-1.5 py-0.5 border border-amber-100'
									>
										{s}
									</span>
								))}
								{job.missing_skills.length > 2 && (
									<span className='text-[10px] text-amber-600'>
										+{job.missing_skills.length - 2}
									</span>
								)}
							</div>
						)}
					</div>
				</div>
			</CardContent>
		</Card>
	)
}
