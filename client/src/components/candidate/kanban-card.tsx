import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
	Bookmark,
	Briefcase,
	Building2,
	Calendar,
	ExternalLink,
	GripVertical,
	Mail,
	MapPin,
	Zap,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export interface ScreeningQuestion {
	question: string
	type: 'text' | 'yes_no' | 'select'
	required?: boolean
	options?: string[]
	category?: string
}

export interface KanbanApplication {
	id: number
	job_id: number
	status: string
	title: string
	company: string
	location?: string
	salary_range?: string
	job_type?: string
	posted_by_company?: string
	applied_at: string
	updated_at: string
	match_score?: number
	cover_letter?: string
	screening_answers?: string | Record<string, string>
	screening_questions?: string | ScreeningQuestion[]
	is_auto_applied?: boolean
}

export interface KanbanSavedJob {
	id: number
	job_id: number
	title: string
	company: string
	location?: string
	salary_range?: string
	job_type?: string
	posted_by_company?: string
	saved_at: string
	notes?: string
}

export type KanbanItem =
	| { type: 'application'; data: KanbanApplication }
	| { type: 'saved'; data: KanbanSavedJob }

interface KanbanCardProps {
	item: KanbanItem
	columnId: string
	onClick?: () => void
	isOverlay?: boolean
}

function timeAgo(dateStr: string) {
	const diff = Date.now() - new Date(dateStr).getTime()
	const days = Math.floor(diff / 86400000)
	if (days === 0) return 'Today'
	if (days === 1) return 'Yesterday'
	if (days < 7) return `${days}d ago`
	if (days < 30) return `${Math.floor(days / 7)}w ago`
	return `${Math.floor(days / 30)}mo ago`
}

function CompanyLogo({ company }: { company: string }) {
	const initials = company
		?.split(' ')
		.map((w) => w[0])
		.filter(Boolean)
		.slice(0, 2)
		.join('')
		.toUpperCase() || '?'

	return (
		<div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 font-semibold text-sm'>
			{initials}
		</div>
	)
}

function ApplicationTypeBadge({ item }: { item: KanbanItem }) {
	if (item.type === 'saved') {
		return (
			<Badge variant='outline' className='text-[10px] gap-1'>
				<Bookmark className='h-3 w-3' /> Saved
			</Badge>
		)
	}

	const app = item.data
	const hasCoverLetter = !!app.cover_letter && app.cover_letter.trim().length > 0
	let hasScreening = false
	try {
		const answers =
			typeof app.screening_answers === 'string'
				? JSON.parse(app.screening_answers)
				: app.screening_answers
		hasScreening = answers && Object.keys(answers).length > 0
	} catch {
		/* ignore */
	}

	const isManual = hasCoverLetter || hasScreening

	return (
		<Badge variant={isManual ? 'default' : 'secondary'} className='text-[10px] gap-1'>
			{isManual ? <Mail className='h-3 w-3' /> : <Briefcase className='h-3 w-3' />}
			{isManual ? 'Manual' : 'Auto'}
		</Badge>
	)
}

export function KanbanCard({ item, columnId, onClick, isOverlay }: KanbanCardProps) {
	const data = item.type === 'application' ? item.data : item.data
	const draggableId = `${item.type}-${data.id}`

	const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
		id: draggableId,
		data: { item, columnId },
		disabled: item.type === 'saved',
	})

	const style = {
		transform: CSS.Translate.toString(transform),
		opacity: isDragging ? 0.4 : 1,
		cursor: item.type === 'saved' ? 'default' : 'grab',
	}

	if (isOverlay) {
		style.opacity = 1
		style.cursor = 'grabbing'
	}

	const dateStr = item.type === 'application' ? item.data.applied_at : item.data.saved_at
	const dateLabel = item.type === 'application' ? 'Applied' : 'Saved'

	return (
		<div
			ref={setNodeRef}
			style={style}
			{...attributes}
			{...listeners}
			className={`rounded-xl border bg-white p-3 shadow-sm transition-all hover:shadow-md ${
				isOverlay ? 'shadow-lg ring-2 ring-indigo-500 rotate-2' : ''
			}`}
			onClick={onClick}
		>
			<div className='flex items-start gap-3'>
				<CompanyLogo company={data.company || data.posted_by_company || '?'} />
				<div className='min-w-0 flex-1'>
					<h4 className='font-semibold text-sm leading-tight truncate'>{data.title}</h4>
					<div className='flex items-center gap-1 text-xs text-muted-foreground mt-0.5'>
						<Building2 className='h-3 w-3 shrink-0' />
						<span className='truncate'>
							{data.company || data.posted_by_company || 'Company'}
						</span>
					</div>
				</div>
				{item.type !== 'saved' && (
					<div className='shrink-0 text-muted-foreground'>
						<GripVertical className='h-4 w-4' />
					</div>
				)}
			</div>

			<div className='mt-2 flex flex-wrap items-center gap-2'>
				<ApplicationTypeBadge item={item} />
				{item.type === 'application' && item.data.is_auto_applied && (
					<Badge
						variant='outline'
						className='text-[10px] gap-1 bg-violet-50 text-violet-700 border-violet-200'
					>
						<Zap className='h-3 w-3' /> Auto-applied
					</Badge>
				)}
				{data.location && (
					<span className='text-[10px] text-muted-foreground flex items-center gap-0.5'>
						<MapPin className='h-3 w-3' />
						{data.location}
					</span>
				)}
			</div>

			<div className='mt-2 flex items-center justify-between'>
				<span className='text-[10px] text-muted-foreground flex items-center gap-1'>
					<Calendar className='h-3 w-3' />
					{dateLabel} {timeAgo(dateStr)}
				</span>
				<Link
					to={`/candidate/jobs/${data.job_id}`}
					onClick={(e) => e.stopPropagation()}
				>
					<Button variant='ghost' size='sm' className='h-7 text-xs gap-1 px-2'>
						View <ExternalLink className='h-3 w-3' />
					</Button>
				</Link>
			</div>

			{item.type === 'application' && item.data.match_score && (
				<div className='mt-2 flex items-center gap-2'>
					<div className='flex-1 h-1.5 rounded-full bg-muted overflow-hidden'>
						<div
							className={`h-full rounded-full transition-all ${
								item.data.match_score >= 80
									? 'bg-emerald-500'
									: item.data.match_score >= 60
										? 'bg-amber-500'
										: 'bg-red-400'
							}`}
							style={{ width: `${item.data.match_score}%` }}
						/>
					</div>
					<span className='text-[10px] font-medium text-muted-foreground shrink-0'>
						{item.data.match_score}%
					</span>
				</div>
			)}
		</div>
	)
}
