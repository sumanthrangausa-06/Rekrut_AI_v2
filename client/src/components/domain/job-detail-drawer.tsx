import {
	Award,
	Bookmark,
	BookmarkPlus,
	Briefcase,
	Building2,
	CheckCircle2,
	Clock,
	DollarSign,
	ExternalLink,
	Globe,
	GraduationCap,
	MapPin,
	Send,
	X,
	Zap,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScoreRing } from '@/components/domain/score-ring'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface Job {
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
	status?: string
	created_at: string
	screening_questions?: string | any[]
	// Match fields
	weighted_score?: number
	match_level?: string
	skill_match_pct?: number
	matching_skills?: string[]
	missing_skills?: string[]
	success_prediction?: string
	similarity_score?: number
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
	// Allow extra fields from different sources
	[key: string]: any
}

function matchBg(score: number): string {
	if (score >= 80) return 'bg-green-100 text-green-700 border-green-200'
	if (score >= 60) return 'bg-amber-100 text-amber-700 border-amber-200'
	return 'bg-red-100 text-red-600 border-red-200'
}

function matchLevelLabel(level: string): string {
	if (level === 'excellent') return 'Excellent Match'
	if (level === 'good') return 'Good Match'
	if (level === 'fair') return 'Fair Match'
	return ''
}

function timeAgo(dateStr: string) {
	const diff = Date.now() - new Date(dateStr).getTime()
	const days = Math.floor(diff / 86400000)
	if (days === 0) return 'Today'
	if (days === 1) return '1 day ago'
	if (days < 30) return `${days} days ago`
	return `${Math.floor(days / 30)} months ago`
}

/* ────────────────────────────────────────────────────────────────
   JobDetailContent — reusable job detail display
   ──────────────────────────────────────────────────────────────── */

export interface JobDetailContentProps {
	job: Job
	isSaved?: boolean
	onToggleSave?: (e: React.MouseEvent) => void
	onClose?: () => void
	onApply?: () => void
	onViewFullPage?: () => void
	showCloseButton?: boolean
	hideHeader?: boolean
}

export function JobDetailContent({
	job,
	isSaved = false,
	onToggleSave,
	onClose,
	onApply,
	onViewFullPage,
	showCloseButton = true,
	hideHeader = false,
}: JobDetailContentProps) {
	const score = job.weighted_score ? Math.round(job.weighted_score) : null

	const screeningQuestions = (() => {
		if (!job.screening_questions) return []
		try {
			const raw =
				typeof job.screening_questions === 'string'
					? JSON.parse(job.screening_questions)
					: job.screening_questions
			return Array.isArray(raw) ? raw : []
		} catch {
			return []
		}
	})()

	return (
		<div className='p-4 sm:p-5 space-y-5'>
			{!hideHeader && (
				// Header with actions
				<div className='flex items-start justify-between gap-3'>
					<div className='flex items-start gap-3 min-w-0'>
						<Avatar
							src={job.company_logo}
							fallback={(job.company || job.poster_company || 'C').charAt(0)}
							size='lg'
							className='h-14 w-14 shrink-0'
						/>
						<div className='min-w-0'>
							<h2 className='font-bold text-base sm:text-lg leading-tight break-words'>{job.title}</h2>
							<p className='text-sm text-muted-foreground flex items-center gap-1 mt-0.5'>
								<Building2 className='h-3.5 w-3.5 shrink-0' />
								<span className='break-words'>
									{job.company || job.poster_company || 'Company'}
								</span>
							</p>
						</div>
					</div>
					<div className='flex items-center gap-1.5 shrink-0'>
						{onToggleSave && (
							<button
								onClick={onToggleSave}
								className='p-2 rounded-lg hover:bg-muted transition-colors min-h-[44px] min-w-[44px] inline-flex items-center justify-center'
								aria-label={isSaved ? 'Unsave' : 'Save'}
							>
								{isSaved ? (
									<Bookmark className='h-5 w-5 text-amber-500 fill-amber-500' />
								) : (
									<BookmarkPlus className='h-5 w-5 text-muted-foreground' />
								)}
							</button>
						)}
						{showCloseButton && onClose && (
							<button
								onClick={onClose}
								className='p-2 rounded-lg hover:bg-muted transition-colors min-h-[44px] min-w-[44px] inline-flex items-center justify-center'
								aria-label='Close drawer'
							>
								<X className='h-5 w-5' />
							</button>
						)}
					</div>
				</div>
			)}

			{/* Match Score Banner */}
			{score != null && (
				<div className={cn('rounded-lg border p-3', matchBg(score))}>
					<div className='flex items-center justify-between gap-2'>
						<div className='flex items-center gap-3 min-w-0'>
							<ScoreRing score={score} size='md' />
							<div className='min-w-0'>
								<p className='font-semibold text-sm break-words'>
									{matchLevelLabel(job.match_level || '')}
								</p>
								<p className='text-xs opacity-80 break-words'>
									{job.skill_match_pct != null && `${job.skill_match_pct}% skills match`}
									{job.matching_skills &&
										` · ${job.matching_skills.length}/${(job.matching_skills?.length || 0) + (job.missing_skills?.length || 0)} skills`}
								</p>
							</div>
						</div>
						{job.match_level === 'excellent' && <Zap className='h-5 w-5 text-green-600 shrink-0' />}
					</div>
					{job.missing_skills && job.missing_skills.length > 0 && score < 80 && (
						<div className='mt-2 pt-2 border-t border-current/10'>
							<p className='text-xs font-medium opacity-70'>
								To reach 90% match, add these skills:
							</p>
							<div className='flex flex-wrap gap-1 mt-1'>
								{job.missing_skills.map((s) => (
									<span key={s} className='text-[10px] bg-white/50 rounded px-1.5 py-0.5'>
										{s}
									</span>
								))}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Job Meta */}
			<div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
				<div className='flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50 min-w-0'>
					<MapPin className='h-4 w-4 text-muted-foreground shrink-0' />
					<span className='truncate'>{job.location || 'Location not specified'}</span>
				</div>
				<div className='flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50 min-w-0'>
					<DollarSign className='h-4 w-4 text-muted-foreground shrink-0' />
					<span className='truncate'>{job.salary_range || 'Salary not specified'}</span>
				</div>
				<div className='flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50 min-w-0'>
					<Briefcase className='h-4 w-4 text-muted-foreground shrink-0' />
					<span className='break-words'>{job.job_type || 'Not specified'}</span>
				</div>
				<div className='flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50 min-w-0'>
					<Clock className='h-4 w-4 text-muted-foreground shrink-0' />
					<span>Posted {timeAgo(job.created_at)}</span>
				</div>
			</div>

			{/* Skills Required */}
			{(job.skills_required || job.matching_skills) && (
				<div>
					<p className='text-sm font-semibold mb-2 flex items-center gap-1'>
						<GraduationCap className='h-4 w-4' /> Required Skills
					</p>
					<div className='flex flex-wrap gap-1.5'>
						{(job.skills_required || job.matching_skills || []).map((skill) => {
							const isMatch = job.matching_skills?.includes(skill)
							return (
								<Badge
									key={skill}
									variant={isMatch ? 'default' : 'outline'}
									className={cn(
										'text-xs h-6',
										isMatch
											? 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200'
											: '',
									)}
								>
									{isMatch && <CheckCircle2 className='h-3 w-3 mr-1' />}
									{skill}
								</Badge>
							)
						})}
					</div>
				</div>
			)}

			<Separator />

			{/* Description */}
			<div>
				<p className='text-sm font-semibold mb-2'>About the Role</p>
				<div className='prose prose-sm max-w-none text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed break-words overflow-x-hidden'>
					{job.description || 'No description provided.'}
				</div>
			</div>

			{/* Requirements */}
			{job.requirements && (
				<div>
					<p className='text-sm font-semibold mb-2'>Requirements</p>
					<div className='prose prose-sm max-w-none text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed break-words overflow-x-hidden'>
						{job.requirements}
					</div>
				</div>
			)}

			{/* Screening Questions */}
			{screeningQuestions.length > 0 && (
				<div>
					<p className='text-sm font-semibold mb-2 flex items-center gap-1'>
						<Award className='h-4 w-4' /> Screening Questions ({screeningQuestions.length})
					</p>
					<div className='space-y-2'>
						{screeningQuestions.map((q: any, _i: number) => (
							<div
								key={q.question?.slice(0, 30)}
								className='text-sm p-2 rounded-lg bg-muted/50'
							>
								<p className='font-medium text-xs break-words'>
									{q.question}
									{q.required && <span className='text-destructive'> *</span>}
								</p>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Apply Actions */}
			{(onApply || onViewFullPage) && (
				<div className='sticky bottom-0 bg-background pt-2 pb-4 border-t'>
					<div className='flex flex-col sm:flex-row gap-2'>
						{onApply && (
							<Button className='flex-1 gap-2 min-h-[44px]' onClick={onApply}>
								<Send className='h-4 w-4' /> Apply Now
							</Button>
						)}
						{onViewFullPage && (
							<Button variant='outline' className='gap-2 min-h-[44px]' onClick={onViewFullPage}>
								<ExternalLink className='h-4 w-4' /> View Full Page
							</Button>
						)}
					</div>
				</div>
			)}
		</div>
	)
}

/* ────────────────────────────────────────────────────────────────
   JobDetailDrawer — slide-out sheet wrapper
   ──────────────────────────────────────────────────────────────── */

export interface JobDetailDrawerProps {
	job: Job | null
	open: boolean
	onOpenChange: (open: boolean) => void
	isSaved?: boolean
	onToggleSave?: (e: React.MouseEvent) => void
	onApply?: () => void
	onViewFullPage?: () => void
}

export function JobDetailDrawer({
	job,
	open,
	onOpenChange,
	isSaved = false,
	onToggleSave,
	onApply,
	onViewFullPage,
}: JobDetailDrawerProps) {
	// Restore scroll position when closing
	const scrollPosRef = useRef(0)
	const bodyScrollPosRef = useRef(0)

	useEffect(() => {
		if (open) {
			// Capture current scroll position from the job list container
			const listEl = document.querySelector('[data-job-list]')
			if (listEl) {
				scrollPosRef.current = listEl.scrollTop
			}
			// Capture body scroll position
			bodyScrollPosRef.current = window.scrollY
		} else {
			// Restore scroll position after the drawer closes
			const timer = setTimeout(() => {
				const listEl = document.querySelector('[data-job-list]')
				if (listEl) {
					listEl.scrollTop = scrollPosRef.current
				}
				window.scrollTo(0, bodyScrollPosRef.current)
			}, 50)
			return () => clearTimeout(timer)
		}
	}, [open])

	if (!job) return null

	return (
		<Sheet
			open={open}
			onOpenChange={onOpenChange}
			side='right'
			className='w-full sm:!w-[600px]'
		>
			<SheetHeader>
				<SheetTitle className='flex items-center gap-2'>
					<Briefcase className='h-5 w-5' /> Job Details
				</SheetTitle>
				<SheetClose />
			</SheetHeader>
			<SheetContent className='p-0'>
				<JobDetailContent
					job={job}
					isSaved={isSaved}
					onToggleSave={onToggleSave}
					onClose={() => onOpenChange(false)}
					onApply={onApply}
					onViewFullPage={onViewFullPage}
					showCloseButton={false}
				/>
			</SheetContent>
		</Sheet>
	)
}
