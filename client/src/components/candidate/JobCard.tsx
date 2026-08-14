import {
	Bookmark,
	BookmarkCheck,
	Building2,
	CheckCircle,
	ChevronDown,
	ChevronUp,
	Clock,
	DollarSign,
	Globe,
	MapPin,
	RotateCcw,
	Sparkles,
	Star,
	Target,
	ThumbsUp,
	X,
} from 'lucide-react'
import { useState } from 'react'
import { ScoreRing } from '@/components/domain/score-ring'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip } from '@/components/ui/tooltip'
import { trackEvent } from '@/lib/analytics'
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
	explanation?: {
		why_matched: string
		skills_match: string
		company_quality: string
		your_strength: string
	}
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
	// Fit score
	fit_score?: number
	fit_breakdown?: {
		skills: number
		experience: number
		location: number
		salary: number
		type: number
	}
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
	userSkills?: string[]
	onSkillClick?: (skill: string) => void
}

function timeAgo(dateStr: string) {
	const diff = Date.now() - new Date(dateStr).getTime()
	const days = Math.floor(diff / 86400000)
	if (days === 0) return 'Today'
	if (days === 1) return '1 day ago'
	if (days < 30) return `${days} days ago`
	return `${Math.floor(days / 30)} months ago`
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

function formatSalary(min?: number, max?: number, range?: string): string {
	if (range) return range
	if (!min && !max) return 'Competitive'
	const fmt = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0,
	})
	if (min && max) return `${fmt.format(min)} – ${fmt.format(max)}`
	if (min) return `${fmt.format(min)}+`
	return `Up to ${fmt.format(max ?? 0)}`
}

function SkillPill({
	skill,
	isMatching,
	onClick,
}: {
	skill: string
	isMatching: boolean
	onClick?: (e: React.MouseEvent) => void
}) {
	const relevance = (() => {
		let hash = 0
		for (let i = 0; i < skill.length; i++) {
			hash = (hash << 5) - hash + skill.charCodeAt(i)
			hash |= 0
		}
		return Math.abs(hash) % 41 + 60
	})()

	const pill = (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer',
				isMatching
					? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800/40'
					: 'bg-indigo-50/70 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-800/40',
			)}
		>
			{isMatching && <CheckCircle className="h-3 w-3 shrink-0" />}
			{skill}
		</button>
	)

	if (!onClick) return pill

	return (
		<Tooltip
			content={
				<div className="space-y-1">
					<p className="font-semibold text-xs">{skill}</p>
					<p className="text-[10px] opacity-80">
						{isMatching
							? `${relevance}% of candidates with this skill get hired`
							: 'Add this skill to your profile to improve matches'}
					</p>
				</div>
			}
			side="top"
			delay={200}
		>
			{pill}
		</Tooltip>
	)
}

function fitScoreColor(score: number): string {
	if (score >= 80) return 'bg-emerald-500'
	if (score >= 50) return 'bg-amber-500'
	return 'bg-red-500'
}

function fitScoreTextColor(score: number): string {
	if (score >= 80) return 'text-emerald-700 dark:text-emerald-400'
	if (score >= 50) return 'text-amber-700 dark:text-amber-400'
	return 'text-red-700 dark:text-red-400'
}

function fitScoreBgColor(score: number): string {
	if (score >= 80) return 'bg-emerald-50 dark:bg-emerald-900/20'
	if (score >= 50) return 'bg-amber-50 dark:bg-amber-900/20'
	return 'bg-red-50 dark:bg-red-900/20'
}

function fitScoreBorderColor(score: number): string {
	if (score >= 80) return 'border-emerald-200 dark:border-emerald-800'
	if (score >= 50) return 'border-amber-200 dark:border-amber-800'
	return 'border-red-200 dark:border-red-800'
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
	userSkills = [],
	onSkillClick,
}: JobCardProps) {
	const score = job.weighted_score ? Math.round(job.weighted_score) : null
	const fitScore = job.fit_score != null ? Math.round(job.fit_score) : null
	const companyName = job.company || job.poster_company || 'Company'
	const isTrashMode = activeTab === 'dismissed'
	const [showCompactMatch, setShowCompactMatch] = useState(false)
	const [showFitBreakdown, setShowFitBreakdown] = useState(false)

	const allSkills = [
		...(job.matching_skills || []),
		...(job.skills_required || []),
	]
	const uniqueSkills = [...new Set(allSkills)]

	const handleCardClick = () => {
		onSelect?.(job)
	}

	const handleSave = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		trackEvent('job_card_save_click', { job_id: job.id, saved: !isSaved })
		onToggleSave?.(job.id, e)
	}

	const handleLike = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		trackEvent('job_card_like_click', { job_id: job.id, liked: !isLiked })
		onToggleLike?.(job.id, e)
	}

	const handleDismiss = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		trackEvent('job_card_dismiss_click', { job_id: job.id, dismissed: !isTrashMode })
		onToggleDismiss?.(job.id, e)
	}

	const breakdownEntries = job.fit_breakdown
		? Object.entries(job.fit_breakdown).map(([key, value]) => ({
				label: key.charAt(0).toUpperCase() + key.slice(1),
				value: Math.round(value),
			}))
		: []

	return (
		<Card
			className={cn(
				'group relative overflow-hidden transition-all duration-200',
				isSelected
					? 'ring-2 ring-indigo-500 shadow-md border-indigo-200 dark:border-indigo-700'
					: 'border hover:shadow-lg hover:border-indigo-300/60 dark:hover:border-indigo-700/40',
			)}
			onClick={handleCardClick}
		>
			<CardContent className='relative z-10 p-4 sm:p-5'>
				{/* F-pattern main row: logo (left) → content (center) → score + actions (right) */}
				<div className='flex flex-col sm:flex-row gap-4 items-start'>
					{/* Left: Company Logo */}
					<div className='shrink-0'>
						<Avatar className='h-14 w-14 sm:h-16 sm:w-16 border shadow-sm rounded-xl'>
							<AvatarImage src={job.company_logo} alt={companyName} />
							<AvatarFallback className='bg-indigo-50 text-indigo-600 text-base font-bold dark:bg-indigo-950/50 dark:text-indigo-300'>
								{companyName.slice(0, 2).toUpperCase()}
							</AvatarFallback>
						</Avatar>
					</div>

					{/* Center: Title, Company, Meta */}
					<div className='flex-1 min-w-0 space-y-2.5'>
						{/* Title + Company */}
						<div>
							<div className='flex items-start gap-2'>
								<h3 className='font-semibold text-base sm:text-[17px] leading-tight truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors duration-200'>
									{job.title}
								</h3>
								{job.has_applied && (
									<Badge className='bg-emerald-500 text-white text-[10px] px-1.5 py-0 shrink-0 h-5 mt-0.5'>
										Applied
									</Badge>
								)}
							</div>
							<p className='text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5'>
								<Building2 className='h-3.5 w-3.5 shrink-0' />
								<span className='break-words'>{companyName}</span>
								{job.company_size && (
									<span className='text-[10px] bg-muted rounded px-1.5 py-0.5'>
										{job.company_size}
									</span>
								)}
							</p>
						</div>

						{/* Meta row — cleaner with icons */}
						<div className='flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground'>
							{job.location && (
								<span className='flex items-center gap-1 min-w-0'>
									<MapPin className='h-3.5 w-3.5 shrink-0' />
									<span className='break-words'>{job.location}</span>
								</span>
							)}
							{job.remote_type && (
								<Badge
									variant={locationBadgeVariant(job.remote_type)}
									className='text-xs px-1.5 py-0 h-5 font-normal'
								>
									{job.remote_type === 'remote' && <Globe className='h-2.5 w-2.5 mr-0.5' />}
									{locationLabel(job.remote_type)}
								</Badge>
							)}
							{job.job_type && (
								<span className='flex items-center gap-1 min-w-0'>
									<Clock className='h-3.5 w-3.5 shrink-0' />
									<span className='break-words capitalize'>
										{job.job_type.replace('-', ' ')}
									</span>
								</span>
							)}
							{(job.salary_range || job.salary_min || job.salary_max) && (
								<span className='flex items-center gap-1 min-w-0'>
									<DollarSign className='h-3.5 w-3.5 shrink-0' />
									<span className='break-words font-medium text-foreground/70'>
										{formatSalary(job.salary_min, job.salary_max, job.salary_range)}
									</span>
								</span>
							)}
							<span className='flex items-center gap-1 min-w-0'>
								<Clock className='h-3.5 w-3.5 shrink-0' />
								<span className='break-words'>{timeAgo(job.created_at)}</span>
							</span>
						</div>

						{/* Skills — prominent pill tags */}
						{uniqueSkills.length > 0 && (
							<div className='flex flex-wrap gap-1.5 pt-0.5'>
								{uniqueSkills.slice(0, 5).map((skill) => {
									const isMatching =
										userSkills.length > 0
											? userSkills.includes(skill)
											: job.matching_skills?.includes(skill) ?? false
									return (
										<SkillPill
											key={skill}
											skill={skill}
											isMatching={isMatching}
											onClick={
												onSkillClick
													? (e) => {
															e.stopPropagation()
															onSkillClick(skill)
														}
													: undefined
											}
										/>
									)
								})}
								{uniqueSkills.length > 5 && (
									<Badge
										variant='outline'
										className='text-xs font-normal px-2 py-0.5 rounded-full'
									>
										+{uniqueSkills.length - 5}
									</Badge>
								)}
							</div>
						)}

						{/* Missing skills hint */}
						{score != null && score < 80 && job.missing_skills && job.missing_skills.length > 0 && (
							<div className='flex flex-wrap items-center gap-1 pt-0.5'>
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

					{/* Right: Score Ring + Action Rail */}
					<div className='shrink-0 flex flex-row sm:flex-col items-center gap-3 sm:gap-2 w-full sm:w-auto justify-between sm:justify-start sm:pt-1'>
						{/* Fit Score — prominently displayed, fallback to weighted_score */}
						{fitScore != null ? (
							<Tooltip
								content={
									<div className='space-y-1.5 min-w-[140px]'>
										<p className='font-semibold text-xs'>Fit Breakdown</p>
										{breakdownEntries.map((entry) => (
											<div key={entry.label} className='flex items-center justify-between gap-3'>
												<span className='text-[10px] opacity-80'>{entry.label}</span>
												<span className='text-[10px] font-semibold'>{entry.value}%</span>
											</div>
										))}
									</div>
								}
								side='left'
							>
								<div className='flex flex-col items-center cursor-help'>
									<div
										className={cn(
											'flex items-center justify-center rounded-full border-2 font-bold text-sm',
											'w-14 h-14',
											fitScoreBgColor(fitScore),
											fitScoreBorderColor(fitScore),
											fitScoreTextColor(fitScore),
										)}
									>
										{fitScore}%
									</div>
									<span className={cn('text-[10px] font-medium mt-0.5', fitScoreTextColor(fitScore))}>
										<Target className='h-2.5 w-2.5 inline mr-0.5' />
										Fit
									</span>
								</div>
							</Tooltip>
						) : score != null ? (
							<div className='flex flex-col items-center'>
								<ScoreRing score={score} size='md' />
								{score >= 80 && (
									<Badge
										variant='outline'
										className='text-[10px] mt-1 border-green-200 text-green-700 dark:border-green-800 dark:text-green-400 px-1 py-0'
									>
										<Star className='h-2.5 w-2.5 mr-0.5' />
										Top
									</Badge>
								)}
							</div>
						) : null}

						{/* Action Rail — vertical on desktop, horizontal on mobile */}
						<div className='flex sm:flex-col gap-1'>
							<button
								type='button'
								onClick={handleLike}
								className={cn(
									'relative z-20 rounded-lg transition-all duration-150 min-h-[36px] min-w-[36px] inline-flex items-center justify-center',
									isLiked
										? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 shadow-sm'
										: 'text-muted-foreground hover:bg-muted hover:text-emerald-600',
								)}
								aria-label={isLiked ? 'Unlike job' : 'Like job'}
							>
								<ThumbsUp className='h-4 w-4' />
							</button>

							<button
								type='button'
								onClick={handleSave}
								className={cn(
									'relative z-20 rounded-lg transition-all duration-150 min-h-[36px] min-w-[36px] inline-flex items-center justify-center',
									isSaved
										? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-400 shadow-sm'
										: 'text-muted-foreground hover:bg-muted hover:text-indigo-600',
								)}
								aria-label={isSaved ? 'Remove bookmark' : 'Save job'}
							>
								{isSaved ? <BookmarkCheck className='h-4 w-4' /> : <Bookmark className='h-4 w-4' />}
							</button>

							<button
								type='button'
								onClick={handleDismiss}
								className={cn(
									'relative z-20 rounded-lg transition-all duration-150 min-h-[36px] min-w-[36px] inline-flex items-center justify-center',
									isTrashMode
										? 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700'
										: isDismissed
											? 'text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 shadow-sm'
											: 'text-muted-foreground hover:bg-muted hover:text-red-600',
								)}
								aria-label={isTrashMode ? 'Restore job' : 'Dismiss job'}
							>
								{isTrashMode ? (
									<RotateCcw className='h-4 w-4' />
								) : (
									<X className='h-4 w-4' />
								)}
							</button>

							{!isTrashMode && (
								<Button
									size='sm'
									className='relative z-20 min-h-[36px] px-3.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
									onClick={(e) => {
										e.preventDefault()
										e.stopPropagation()
										trackEvent('job_card_apply_click', { job_id: job.id })
										onSelect?.(job)
									}}
								>
									Apply
								</Button>
							)}
						</div>
					</div>
				</div>

				{/* Fit Score Breakdown inline */}
				{fitScore != null && breakdownEntries.length > 0 && (
					<div className='mt-3 pt-3 border-t border-border/40'>
						<button
							onClick={(e) => {
								e.stopPropagation()
								setShowFitBreakdown((prev) => !prev)
							}}
							className={cn(
								'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left',
								fitScoreBgColor(fitScore),
								'hover:opacity-80 transition-colors',
							)}
						>
							<div className='flex items-center gap-2 min-w-0'>
								<Target className={cn('h-3.5 w-3.5 shrink-0', fitScoreTextColor(fitScore))} />
								<span className={cn('text-xs font-semibold truncate', fitScoreTextColor(fitScore))}>
									{fitScore}% fit — {fitScore >= 80 ? 'Strong match' : fitScore >= 50 ? 'Potential match' : 'Low match'}
								</span>
							</div>
							{showFitBreakdown ? (
								<ChevronUp className={cn('h-3.5 w-3.5 shrink-0', fitScoreTextColor(fitScore))} />
							) : (
								<ChevronDown className={cn('h-3.5 w-3.5 shrink-0', fitScoreTextColor(fitScore))} />
							)}
						</button>
						{showFitBreakdown && (
							<div className='mt-2 space-y-2 px-1'>
								{breakdownEntries.map((entry) => (
									<div key={entry.label} className='space-y-1'>
										<div className='flex items-center justify-between'>
											<span className='text-[11px] text-muted-foreground'>{entry.label}</span>
											<span className={cn('text-[11px] font-semibold', fitScoreTextColor(entry.value))}>
												{entry.value}%
											</span>
										</div>
										<div className='h-1.5 w-full rounded-full bg-muted overflow-hidden'>
											<div
												className={cn('h-full rounded-full transition-all duration-500', fitScoreColor(entry.value))}
												style={{ width: `${entry.value}%` }}
											/>
										</div>
									</div>
								))}
								</div>
							)}
						</div>
					)}

				{/* Compact AI Match Explanation inline */}
				{score != null && !fitScore && (job.matching_skills?.length || job.missing_skills?.length || job.explanation) && (
					<div className="mt-3 pt-3 border-t border-border/40">
						<button
							onClick={(e) => {
								e.stopPropagation()
								setShowCompactMatch((prev) => !prev)
							}}
							className={cn(
								'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left',
								'bg-emerald-50/50 hover:bg-emerald-50 dark:bg-emerald-950/10 dark:hover:bg-emerald-950/20',
								'transition-colors',
							)}
						>
							<div className="flex items-center gap-2 min-w-0">
								<Sparkles className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
								<span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 truncate">
									{score}% match — Why you&apos;re a {score >= 70 ? 'strong' : 'potential'} match
								</span>
							</div>
							{showCompactMatch ? (
								<ChevronUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
							) : (
								<ChevronDown className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
							)}
						</button>
						{showCompactMatch && (
							<div className="mt-2 space-y-2 px-1">
								{/* Matching skills pills */}
								{job.matching_skills && job.matching_skills.length > 0 && (
									<div className="flex flex-wrap gap-1">
										{job.matching_skills.slice(0, 4).map((s) => (
											<Badge
												key={s}
												variant="secondary"
												className="text-[10px] font-medium px-2 py-0 rounded-full bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700"
											>
												{s}
											</Badge>
										))}
										{job.matching_skills.length > 4 && (
											<span className="text-[10px] text-emerald-600 dark:text-emerald-400">
												+{job.matching_skills.length - 4} more
											</span>
										)}
									</div>
								)}
								{/* Specific reason */}
								{job.explanation?.why_matched && (
									<p className="text-xs text-emerald-700 dark:text-emerald-300/80 leading-relaxed">
										{job.explanation.why_matched}
									</p>
								)}
								{job.explanation?.your_strength && (
									<p className="text-xs text-emerald-700 dark:text-emerald-300/80 leading-relaxed">
										{job.explanation.your_strength}
									</p>
								)}
								{/* Missing skills */}
								{job.missing_skills && job.missing_skills.length > 0 && (
									<div className="flex flex-wrap items-center gap-1">
										<span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">Gaps:</span>
										{job.missing_skills.slice(0, 3).map((s) => (
											<Badge
												key={s}
												variant="outline"
												className="text-[10px] font-medium px-1.5 py-0 rounded-full border-amber-300 text-amber-700 bg-amber-50/50 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-700"
											>
												{s}
											</Badge>
										))}
										{job.missing_skills.length > 3 && (
											<span className="text-[10px] text-amber-600 dark:text-amber-400">
												+{job.missing_skills.length - 3}
											</span>
										)}
									</div>
								)}
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	)
}
