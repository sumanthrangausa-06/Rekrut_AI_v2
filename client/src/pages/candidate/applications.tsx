import {
	DndContext,
	DragOverlay,
	MouseSensor,
	TouchSensor,
	closestCorners,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragStartEvent,
} from '@dnd-kit/core'
import {
	AlertTriangle,
	Bookmark,
	Briefcase,
	Building2,
	Calendar,
	CheckCircle,
	ClipboardList,
	Clock,
	DollarSign,
	ExternalLink,
	Eye,
	FileText,
	Filter,
	MapPin,
	MessageCircle,
	Trophy,
	XCircle,
	Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { apiCall } from '@/lib/api'
import {
	KanbanCard,
	KanbanColumn,
	KANBAN_COLUMNS,
	type KanbanItem,
	type KanbanApplication,
	type KanbanSavedJob,
	type ScreeningQuestion,
} from '@/components/candidate'

const statusConfig: Record<
	string,
	{
		label: string
		variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive'
		icon: typeof Clock
	}
> = {
	applied: { label: 'Applied', variant: 'secondary', icon: FileText },
	screening: { label: 'Screening', variant: 'default', icon: Eye },
	shortlisted: { label: 'Shortlisted', variant: 'default', icon: CheckCircle },
	reviewing: { label: 'Under Review', variant: 'warning', icon: Eye },
	interviewed: { label: 'Interviewed', variant: 'default', icon: Briefcase },
	offered: { label: 'Offer Received', variant: 'success', icon: DollarSign },
	hired: { label: 'Hired', variant: 'success', icon: CheckCircle },
	rejected: { label: 'Not Selected', variant: 'destructive', icon: XCircle },
	withdrawn: { label: 'Withdrawn', variant: 'secondary', icon: XCircle },
}

const COLUMN_STATUS_MAP: Record<string, string> = {
	applied: 'applied',
	in_discussion: 'screening',
	offer_received: 'offered',
}

const STATUS_TO_COLUMN: Record<string, string> = {
	applied: 'applied',
	screening: 'in_discussion',
	shortlisted: 'in_discussion',
	reviewing: 'in_discussion',
	interviewed: 'in_discussion',
	offered: 'offer_received',
	hired: 'offer_received',
}

export function CandidateApplicationsPage() {
	const [applications, setApplications] = useState<KanbanApplication[]>([])
	const [savedJobs, setSavedJobs] = useState<KanbanSavedJob[]>([])
	const [loading, setLoading] = useState(true)
	const [withdrawTarget, setWithdrawTarget] = useState<KanbanApplication | null>(null)
	const [withdrawing, setWithdrawing] = useState(false)
	const [selectedApp, setSelectedApp] = useState<KanbanApplication | null>(null)
	const [activeDragItem, setActiveDragItem] = useState<KanbanItem | null>(null)
	const [updatingStatus, setUpdatingStatus] = useState(false)

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 8 },
		}),
	)

	const loadData = useCallback(async () => {
		setLoading(true)
		try {
			const [appsData, savedData] = await Promise.all([
				apiCall<{ success: boolean; applications: KanbanApplication[] }>('/candidate/applications'),
				apiCall<{ success: boolean; jobs: KanbanSavedJob[] }>('/candidate/jobs/saved'),
			])
			setApplications(appsData.applications || [])
			setSavedJobs(savedData.jobs || [])
		} catch {
			// silent
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadData()
	}, [loadData])

	// Filter saved jobs to only those without applications
	const filteredSavedJobs = useMemo(() => {
		const appliedJobIds = new Set(applications.map((a) => a.job_id))
		return savedJobs.filter((sj) => !appliedJobIds.has(sj.job_id))
	}, [savedJobs, applications])

	// Group items into columns
	const columnItems = useMemo(() => {
		const result: Record<string, KanbanItem[]> = {
			saved: filteredSavedJobs.map((j) => ({ type: 'saved' as const, data: j })),
			applied: [],
			in_discussion: [],
			offer_received: [],
		}

		for (const app of applications) {
			const colId = STATUS_TO_COLUMN[app.status] || 'applied'
			if (result[colId]) {
				result[colId].push({ type: 'application' as const, data: app })
			}
		}

		return result
	}, [applications, filteredSavedJobs])

	function handleDragStart(event: DragStartEvent) {
		const { active } = event
		const data = active.data.current?.item as KanbanItem | undefined
		if (data) setActiveDragItem(data)
	}

	async function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event
		setActiveDragItem(null)

		if (!over) return

		const activeData = active.data.current?.item as KanbanItem | undefined
		const overColumnId = over.data.current?.columnId as string | undefined

		if (!activeData || activeData.type !== 'application') return
		if (!overColumnId) return

		const sourceColumnId = active.data.current?.columnId as string
		if (sourceColumnId === overColumnId) return

		const newStatus = COLUMN_STATUS_MAP[overColumnId]
		if (!newStatus) return

		const app = activeData.data

		// Optimistic update
		setApplications((prev) =>
			prev.map((a) => (a.id === app.id ? { ...a, status: newStatus } : a)),
		)

		setUpdatingStatus(true)
		try {
			await apiCall(`/candidate/applications/${app.id}/status`, {
				method: 'PUT',
				body: JSON.stringify({ status: newStatus }),
			})
		} catch (err: unknown) {
			// Revert on error
			setApplications((prev) =>
				prev.map((a) => (a.id === app.id ? { ...a, status: app.status } : a)),
			)
			alert(err instanceof Error ? err.message : 'Failed to update status')
		} finally {
			setUpdatingStatus(false)
		}
	}

	async function withdrawApplication() {
		if (!withdrawTarget) return
		setWithdrawing(true)
		try {
			await apiCall(`/candidate/applications/${withdrawTarget.id}/withdraw`, {
				method: 'PUT',
			})
			setApplications((prev) =>
				prev.map((a) => (a.id === withdrawTarget.id ? { ...a, status: 'withdrawn' } : a)),
			)
			setWithdrawTarget(null)
			setSelectedApp(null)
		} catch (err: unknown) {
			alert(err instanceof Error ? err.message : 'Failed to withdraw application')
		} finally {
			setWithdrawing(false)
		}
	}

	function timeAgo(dateStr: string) {
		const diff = Date.now() - new Date(dateStr).getTime()
		const days = Math.floor(diff / 86400000)
		if (days === 0) return 'Today'
		if (days === 1) return 'Yesterday'
		if (days < 7) return `${days} days ago`
		if (days < 30) return `${Math.floor(days / 7)} weeks ago`
		return `${Math.floor(days / 30)} months ago`
	}

	function parseScreeningData(app: KanbanApplication) {
		try {
			const answers =
				typeof app.screening_answers === 'string'
					? JSON.parse(app.screening_answers)
					: app.screening_answers
			const questions: ScreeningQuestion[] =
				typeof app.screening_questions === 'string'
					? JSON.parse(app.screening_questions)
					: app.screening_questions || []
			return { answers, questions }
		} catch {
			return { answers: null, questions: [] as ScreeningQuestion[] }
		}
	}

	function handleCardClick(item: KanbanItem) {
		if (item.type === 'application') {
			setSelectedApp(item.data)
		}
		// Saved jobs: navigate to job detail
		if (item.type === 'saved') {
			window.location.href = `/candidate/jobs/${item.data.job_id}`
		}
	}

	const activeCount = applications.filter(
		(a) => !['rejected', 'withdrawn', 'hired'].includes(a.status),
	).length
	const inProgressCount = applications.filter((a) =>
		['reviewing', 'interviewed'].includes(a.status),
	).length
	const offerCount = applications.filter((a) => ['offered', 'hired'].includes(a.status)).length

	return (
		<div className='space-y-6'>
			<div>
				<h1 className='font-heading text-2xl font-bold'>My Applications</h1>
				<p className='text-muted-foreground'>
					Track your job pipeline from saved jobs to offers
				</p>
			</div>

			{/* Stats */}
			<div className='grid gap-3 sm:grid-cols-4'>
				<Card>
					<CardContent className='p-4 text-center'>
						<p className='text-2xl font-bold'>{applications.length}</p>
						<p className='text-xs text-muted-foreground'>Total Applied</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4 text-center'>
						<p className='text-2xl font-bold text-indigo-600'>{activeCount}</p>
						<p className='text-xs text-muted-foreground'>Active</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4 text-center'>
						<p className='text-2xl font-bold text-amber-600'>{inProgressCount}</p>
						<p className='text-xs text-muted-foreground'>In Progress</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4 text-center'>
						<p className='text-2xl font-bold text-emerald-600'>{offerCount}</p>
						<p className='text-xs text-muted-foreground'>Offers / Hired</p>
					</CardContent>
				</Card>
			</div>

			{/* Kanban Board */}
			{loading ? (
				<div className='flex items-center justify-center py-16'>
					<div className='h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent' />
				</div>
			) : applications.length === 0 && savedJobs.length === 0 ? (
				<Card>
					<CardContent className='py-16 text-center'>
						<FileText className='mx-auto mb-3 h-10 w-10 opacity-30' />
						<p className='text-muted-foreground mb-4'>
							You haven&apos;t applied to any jobs yet
						</p>
						<Link to='/candidate/jobs'>
							<Button>Browse Jobs</Button>
						</Link>
					</CardContent>
				</Card>
			) : (
				<div className='relative'>
					{updatingStatus && (
						<div className='absolute top-0 right-0 z-10 flex items-center gap-2 rounded-lg bg-white border px-3 py-1.5 shadow-sm text-xs text-muted-foreground'>
							<div className='h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent' />
							Updating...
						</div>
					)}
					<DndContext
						sensors={sensors}
						collisionDetection={closestCorners}
						onDragStart={handleDragStart}
						onDragEnd={handleDragEnd}
					>
						<div className='flex gap-4 overflow-x-auto pb-4 -mx-2 px-2 snap-x snap-mandatory'>
							{KANBAN_COLUMNS.map((column) => (
								<div key={column.id} className='snap-start'>
									<KanbanColumn
										column={column}
										items={columnItems[column.id] || []}
										onCardClick={handleCardClick}
									/>
								</div>
							))}
						</div>
						<DragOverlay>
							{activeDragItem ? (
								<KanbanCard
									item={activeDragItem}
									columnId={
										activeDragItem.type === 'application'
											? STATUS_TO_COLUMN[activeDragItem.data.status] || 'applied'
											: 'saved'
									}
									isOverlay
								/>
							) : null}
						</DragOverlay>
					</DndContext>
				</div>
			)}

			{/* Application detail dialog */}
			{selectedApp && (
				<Dialog open={true} onClose={() => setSelectedApp(null)} className='max-w-lg'>
					<DialogHeader>
						<DialogTitle>{selectedApp.title}</DialogTitle>
						<DialogDescription>
							{selectedApp.company || selectedApp.posted_by_company || 'Company'}
							{selectedApp.location ? ` • ${selectedApp.location}` : ''}
						</DialogDescription>
					</DialogHeader>
					<div className='space-y-4'>
						{/* Status badge */}
						{(() => {
							const config = statusConfig[selectedApp.status] || {
								label: selectedApp.status,
								variant: 'secondary' as const,
								icon: Clock,
							}
							return (
								<Badge variant={config.variant} className='w-fit'>
									{config.label}
								</Badge>
							)
						})()}
						{selectedApp.is_auto_applied && (
							<Badge
								variant='outline'
								className='w-fit gap-1 bg-violet-50 text-violet-700 border-violet-200'
							>
								<Zap className='h-3 w-3' /> Auto-applied
							</Badge>
						)}

						{/* Details grid */}
						<div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
							<div className='rounded-lg bg-muted/50 p-3'>
								<p className='text-xs text-muted-foreground flex items-center gap-1'>
									<Calendar className='h-3 w-3' /> Applied
								</p>
								<p className='font-medium'>
									{new Date(selectedApp.applied_at).toLocaleDateString()}
								</p>
							</div>
							<div className='rounded-lg bg-muted/50 p-3'>
								<p className='text-xs text-muted-foreground flex items-center gap-1'>
									<Clock className='h-3 w-3' /> Last Update
								</p>
								<p className='font-medium'>{timeAgo(selectedApp.updated_at)}</p>
							</div>
							{selectedApp.salary_range && (
								<div className='rounded-lg bg-muted/50 p-3'>
									<p className='text-xs text-muted-foreground flex items-center gap-1'>
										<DollarSign className='h-3 w-3' /> Salary
									</p>
									<p className='font-medium'>{selectedApp.salary_range}</p>
								</div>
							)}
							{selectedApp.match_score && (
								<div className='rounded-lg bg-muted/50 p-3'>
									<p className='text-xs text-muted-foreground'>Match Score</p>
									<p className='font-medium text-primary'>{selectedApp.match_score}%</p>
								</div>
							)}
						</div>

						{/* Progress timeline */}
						<ApplicationTimeline
							status={selectedApp.status}
							appliedAt={selectedApp.applied_at}
							updatedAt={selectedApp.updated_at}
						/>

						{/* Cover letter */}
						{selectedApp.cover_letter && (
							<div>
								<h4 className='font-medium text-sm mb-1'>Your Cover Letter</h4>
								<div className='rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap max-h-40 overflow-y-auto'>
									{selectedApp.cover_letter}
								</div>
							</div>
						)}

						{/* Screening answers */}
						<ScreeningAnswersSection
							app={selectedApp}
							parseScreeningData={parseScreeningData}
						/>

						{/* Actions */}
						<div className='flex gap-2 pt-2'>
							<Link to={`/candidate/jobs/${selectedApp.job_id}`} className='flex-1'>
								<Button variant='outline' className='gap-2 w-full'>
									<ExternalLink className='h-4 w-4' /> View Job
								</Button>
							</Link>
							{!['rejected', 'withdrawn', 'hired'].includes(selectedApp.status) && (
								<Button
									variant='outline'
									onClick={() => {
										setSelectedApp(null)
										setWithdrawTarget(selectedApp)
									}}
									className='gap-2 text-destructive hover:text-destructive'
								>
									<XCircle className='h-4 w-4' /> Withdraw
								</Button>
							)}
						</div>
					</div>
				</Dialog>
			)}

			{/* Withdraw confirmation dialog */}
			{withdrawTarget && (
				<Dialog
					open={true}
					onClose={() => !withdrawing && setWithdrawTarget(null)}
					className='max-w-md'
				>
					<DialogHeader>
						<DialogTitle className='flex items-center gap-2'>
							<AlertTriangle className='h-5 w-5 text-amber-500' />
							Withdraw Application?
						</DialogTitle>
					</DialogHeader>
					<div className='space-y-4'>
						<p className='text-sm text-muted-foreground'>
							Are you sure you want to withdraw your application for{' '}
							<strong>{withdrawTarget.title}</strong> at{' '}
							<strong>
								{withdrawTarget.company || withdrawTarget.posted_by_company || 'this company'}
							</strong>
							?
						</p>
						<div className='rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800'>
							This action cannot be undone. You may need to reapply if you change your mind.
						</div>
						<div className='flex gap-2 pt-2'>
							<Button
								variant='outline'
								onClick={() => setWithdrawTarget(null)}
								disabled={withdrawing}
								className='flex-1'
							>
								Keep Application
							</Button>
							<Button
								variant='destructive'
								onClick={withdrawApplication}
								disabled={withdrawing}
								className='gap-2 flex-1'
							>
								{withdrawing ? (
									<div className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
								) : (
									<XCircle className='h-4 w-4' />
								)}
								Withdraw
							</Button>
						</div>
					</div>
				</Dialog>
			)}
		</div>
	)
}

function ScreeningAnswersSection({
	app,
	parseScreeningData,
}: {
	app: KanbanApplication
	parseScreeningData: (app: KanbanApplication) => {
		answers: Record<string, string> | null
		questions: ScreeningQuestion[]
	}
}) {
	const { answers, questions } = parseScreeningData(app)

	if (!answers || Object.keys(answers).length === 0) return null

	return (
		<div>
			<h4 className='font-medium text-sm mb-2 flex items-center gap-1.5'>
				<ClipboardList className='h-4 w-4 text-primary' />
				Your Screening Answers
			</h4>
			<div className='space-y-2'>
				{Object.entries(answers).map(([key, value], i) => {
					const q = questions[i]
					const questionText = q?.question || q || `Question ${i + 1}`
					return (
						<div key={key} className='rounded-lg bg-muted/50 p-3'>
							<p className='text-xs text-muted-foreground mb-1 font-medium'>
								{String(questionText)}
							</p>
							<p className='text-sm'>{String(value)}</p>
						</div>
					)
				})}
			</div>
		</div>
	)
}

function ApplicationTimeline({
	status,
	appliedAt,
	updatedAt,
}: {
	status: string
	appliedAt: string
	updatedAt: string
}) {
	const steps = [
		{ key: 'applied', label: 'Applied', icon: FileText },
		{ key: 'screening', label: 'Screening', icon: Eye },
		{ key: 'interviewed', label: 'Interview', icon: Briefcase },
		{ key: 'offered', label: 'Offer', icon: CheckCircle },
	]

	const stepIndex =
		{
			applied: 0,
			screening: 1,
			shortlisted: 1,
			reviewing: 1,
			interviewed: 2,
			offered: 3,
			hired: 4,
			rejected: -1,
			withdrawn: -1,
		}[status] ?? 0

	// Special terminal states
	if (status === 'rejected' || status === 'withdrawn') {
		const config = statusConfig[status]
		return (
			<div>
				<h4 className='font-medium text-sm mb-3'>Status Timeline</h4>
				<div className='space-y-3'>
					<div className='flex items-center gap-3'>
						<div className='flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary bg-primary/10'>
							<FileText className='h-4 w-4 text-primary' />
						</div>
						<div>
							<p className='text-sm font-medium'>Applied</p>
							<p className='text-xs text-muted-foreground'>
								{new Date(appliedAt).toLocaleDateString()}
							</p>
						</div>
					</div>
					<div className='ml-4 h-4 w-px bg-muted' />
					<div className='flex items-center gap-3'>
						<div
							className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
								status === 'rejected'
									? 'border-destructive bg-destructive/10'
									: 'border-muted bg-muted/50'
							}`}
						>
							<XCircle
								className={`h-4 w-4 ${status === 'rejected' ? 'text-destructive' : 'text-muted-foreground'}`}
							/>
						</div>
						<div>
							<p className='text-sm font-medium'>{config.label}</p>
							<p className='text-xs text-muted-foreground'>
								{new Date(updatedAt).toLocaleDateString()}
							</p>
						</div>
					</div>
				</div>
			</div>
		)
	}

	if (stepIndex < 0) return null

	return (
		<div>
			<h4 className='font-medium text-sm mb-3'>Progress</h4>
			<div className='flex items-center gap-1'>
				{steps.map((step, i) => {
					const isComplete = i <= stepIndex
					const isCurrent = i === stepIndex
					const Icon = step.icon
					return (
						<div key={step.key} className='flex items-center gap-1 flex-1'>
							<div
								className={`flex items-center gap-1.5 ${isComplete ? 'text-primary' : 'text-muted-foreground/50'}`}
							>
								<div
									className={`flex h-7 w-7 min-h-[44px] min-w-[44px] items-center justify-center rounded-full border-2 transition-all ${
										isCurrent
											? 'border-primary bg-primary text-white'
											: isComplete
												? 'border-primary bg-primary/10'
												: 'border-muted'
									}`}
								>
									<Icon className='h-3.5 w-3.5' />
								</div>
								<span className='text-[11px] font-medium hidden sm:inline'>{step.label}</span>
							</div>
							{i < steps.length - 1 && (
								<div className={`h-0.5 flex-1 mx-1 ${i < stepIndex ? 'bg-primary' : 'bg-muted'}`} />
							)}
						</div>
					)
				})}
			</div>
			{/* Date labels */}
			<div className='flex justify-between mt-2 px-1'>
				<span className='text-[10px] text-muted-foreground'>
					{new Date(appliedAt).toLocaleDateString()}
				</span>
				{stepIndex > 0 && (
					<span className='text-[10px] text-muted-foreground'>
						Updated {new Date(updatedAt).toLocaleDateString()}
					</span>
				)}
			</div>
		</div>
	)
}
