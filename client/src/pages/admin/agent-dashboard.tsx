import {
	Activity,
	AlertCircle,
	Bot,
	Calendar,
	CheckCircle2,
	Circle,
	Clock,
	FileCode,
	GitBranch,
	Layout,
	Loader2,
	Pause,
	Play,
	RefreshCw,
	Server,
	Sparkles,
	Users,
	XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getToken } from '@/lib/api'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface AgentTask {
	id: string
	agentName: string
	agentRole: string
	task: string
	description: string
	status: 'todo' | 'in-progress' | 'review' | 'done' | 'blocked' | 'timeout'
	priority: 'low' | 'medium' | 'high' | 'critical'
	progress: number
	startedAt?: string
	completedAt?: string
	estimatedDuration: string
	actualDuration?: string
	files: string[]
	subagentId?: string
	sessionKey?: string
	error?: string
	notes: string[]
}

interface AgentData {
	tasks: AgentTask[]
	stats: {
		total: number
		todo: number
		inProgress: number
		review: number
		done: number
		blocked: number
		timeout: number
		critical: number
		high: number
		medium: number
		low: number
	}
	generated_at: string
	source: string
	version: string
}

interface TeamMember {
	id: string
	name: string
	role: string
	status: 'active' | 'idle' | 'blocked'
	current_task: string
	task_status: 'todo' | 'in-progress' | 'review' | 'done' | 'blocked'
	progress: number
	started_at: string
	last_update: string
	eta: string
	blockers: string[]
	notes: string[]
}

interface Deployment {
	url: string
	status: 'live' | 'failed' | 'deploying'
	branch: string
	last_deploy: string
	health_check: string
	notes?: string
}

interface Commit {
	sha: string
	message: string
	author: string
	branch: string
	time: string
}

interface TeamData {
	team_members: TeamMember[]
	deployments: Record<string, Deployment>
	recent_commits: Commit[]
	stats: {
		total_members: number
		active: number
		idle: number
		blocked: number
		tasks_in_progress: number
		tasks_done: number
		deployments_live: number
		deployments_failed: number
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const statusConfig = {
	todo: { label: 'To Do', color: 'bg-slate-100 text-slate-700 border-slate-200', icon: CircleIcon },
	'in-progress': {
		label: 'In Progress',
		color: 'bg-blue-100 text-blue-700 border-blue-200',
		icon: Loader2,
	},
	review: {
		label: 'Review',
		color: 'bg-amber-100 text-amber-700 border-amber-200',
		icon: GitBranch,
	},
	done: {
		label: 'Done',
		color: 'bg-green-100 text-green-700 border-green-200',
		icon: CheckCircle2,
	},
	blocked: { label: 'Blocked', color: 'bg-red-100 text-red-700 border-red-200', icon: AlertCircle },
	timeout: {
		label: 'Timeout',
		color: 'bg-orange-100 text-orange-700 border-orange-200',
		icon: Clock,
	},
}

const priorityConfig = {
	low: { color: 'bg-slate-100 text-slate-600', label: 'Low' },
	medium: { color: 'bg-blue-100 text-blue-600', label: 'Medium' },
	high: { color: 'bg-amber-100 text-amber-600', label: 'High' },
	critical: { color: 'bg-red-100 text-red-600', label: 'Critical' },
}

const memberStatusConfig = {
	active: {
		label: 'Active',
		color: 'bg-green-100 text-green-700 border-green-200',
		icon: CheckCircle2,
	},
	idle: { label: 'Idle', color: 'bg-slate-100 text-slate-700 border-slate-200', icon: Circle },
	blocked: { label: 'Blocked', color: 'bg-red-100 text-red-700 border-red-200', icon: XCircle },
}

const taskStatusConfig = {
	todo: { label: 'To Do', color: 'bg-slate-100 text-slate-600' },
	'in-progress': { label: 'In Progress', color: 'bg-blue-100 text-blue-600' },
	review: { label: 'Review', color: 'bg-amber-100 text-amber-600' },
	done: { label: 'Done', color: 'bg-green-100 text-green-600' },
	blocked: { label: 'Blocked', color: 'bg-red-100 text-red-600' },
}

const deployStatusConfig = {
	live: { label: 'Live', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
	failed: { label: 'Failed', color: 'bg-red-100 text-red-700', icon: XCircle },
	deploying: { label: 'Deploying', color: 'bg-blue-100 text-blue-700', icon: Loader2 },
}

const columns: Array<'todo' | 'in-progress' | 'review' | 'done' | 'blocked' | 'timeout'> = [
	'todo',
	'in-progress',
	'review',
	'done',
	'blocked',
	'timeout',
]

const AGENTS_API = '/api/admin/agents'
const TEAM_API = '/api/admin/team-status'
const POLL_INTERVAL = 10000

// ═══════════════════════════════════════════════════════════════════════════
// TASK COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function TaskCard({ task }: { task: AgentTask }) {
	const status = statusConfig[task.status]
	const priority = priorityConfig[task.priority]
	const StatusIcon = status.icon

	return (
		<Card className='border shadow-sm hover:shadow-md transition-shadow cursor-pointer group'>
			<CardContent className='p-3 space-y-3'>
				<div className='flex items-start justify-between gap-2'>
					<div className='flex items-center gap-2 min-w-0'>
						<div className='p-1.5 rounded-md bg-primary/10 shrink-0'>
							<Bot className='h-3.5 w-3.5 text-primary' />
						</div>
						<div className='min-w-0'>
							<p className='font-medium text-sm truncate'>{task.task}</p>
							<p className='text-xs text-muted-foreground truncate'>{task.agentRole}</p>
						</div>
					</div>
					<Badge variant='outline' className={`text-[10px] shrink-0 ${priority.color}`}>
						{priority.label}
					</Badge>
				</div>
				<p className='text-xs text-muted-foreground line-clamp-2'>{task.description}</p>
				<div className='space-y-1'>
					<div className='flex items-center justify-between text-xs'>
						<span className='text-muted-foreground'>Progress</span>
						<span className='font-medium'>{task.progress}%</span>
					</div>
					<div className='h-1.5 rounded-full bg-muted overflow-hidden'>
						<div
							className='h-full rounded-full bg-primary transition-all'
							style={{ width: `${task.progress}%` }}
						/>
					</div>
				</div>
				{task.error && (
					<div className='rounded-md bg-red-50 border border-red-100 p-2 text-xs text-red-700'>
						<div className='flex items-center gap-1 mb-1'>
							<AlertCircle className='h-3 w-3' />
							<span className='font-medium'>Blocked</span>
						</div>
						<p className='line-clamp-2'>{task.error}</p>
					</div>
				)}
				<div className='flex flex-wrap gap-1'>
					{task.files.slice(0, 3).map((file, i) => (
						<Badge key={i} variant='secondary' className='text-[10px] gap-1'>
							<FileCode className='h-2.5 w-2.5' />
							{file.split('/').pop()}
						</Badge>
					))}
					{task.files.length > 3 && (
						<Badge variant='secondary' className='text-[10px]'>
							+{task.files.length - 3}
						</Badge>
					)}
				</div>
				<div className='flex items-center justify-between text-xs text-muted-foreground'>
					<div className='flex items-center gap-2'>
						<Badge variant='outline' className={`text-[10px] gap-1 ${status.color}`}>
							<StatusIcon
								className={`h-3 w-3 ${task.status === 'in-progress' ? 'animate-spin' : ''}`}
							/>
							{status.label}
						</Badge>
						{task.startedAt && (
							<span className='flex items-center gap-1'>
								<Calendar className='h-3 w-3' />
								{task.startedAt.split(' ')[1]}
							</span>
						)}
					</div>
					<span className='flex items-center gap-1'>
						<Clock className='h-3 w-3' />
						{task.estimatedDuration}
					</span>
				</div>
			</CardContent>
		</Card>
	)
}

// ═══════════════════════════════════════════════════════════════════════════
// TEAM COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function TeamMemberCard({ member }: { member: TeamMember }) {
	const status = memberStatusConfig[member.status]
	const taskStatus = taskStatusConfig[member.task_status]
	const StatusIcon = status.icon

	return (
		<Card className='border shadow-sm hover:shadow-md transition-shadow'>
			<CardContent className='p-4 space-y-3'>
				<div className='flex items-start justify-between gap-2'>
					<div className='min-w-0'>
						<p className='font-semibold text-sm'>{member.name}</p>
						<p className='text-xs text-muted-foreground'>{member.role}</p>
					</div>
					<Badge variant='outline' className={`text-[10px] shrink-0 ${status.color}`}>
						<StatusIcon className='h-3 w-3 mr-1' />
						{status.label}
					</Badge>
				</div>
				<div className='space-y-1'>
					<p className='text-xs font-medium text-muted-foreground'>Current Task</p>
					<p className='text-sm'>{member.current_task}</p>
					<Badge variant='secondary' className={`text-[10px] ${taskStatus.color}`}>
						{taskStatus.label}
					</Badge>
				</div>
				<div className='space-y-1'>
					<div className='flex items-center justify-between text-xs'>
						<span className='text-muted-foreground'>Progress</span>
						<span className='font-medium'>{member.progress}%</span>
					</div>
					<div className='h-2 rounded-full bg-muted overflow-hidden'>
						<div
							className='h-full rounded-full bg-primary transition-all'
							style={{ width: `${member.progress}%` }}
						/>
					</div>
				</div>
				{member.blockers.length > 0 && (
					<div className='rounded-md bg-red-50 border border-red-100 p-2 space-y-1'>
						<div className='flex items-center gap-1 text-xs text-red-700 font-medium'>
							<AlertCircle className='h-3 w-3' />
							Blockers
						</div>
						{member.blockers.map((b, i) => (
							<p key={i} className='text-xs text-red-600'>
								• {b}
							</p>
						))}
					</div>
				)}
				{member.notes.length > 0 && (
					<div className='space-y-1'>
						<p className='text-xs font-medium text-muted-foreground'>Recent Updates</p>
						<ul className='space-y-0.5'>
							{member.notes.slice(0, 3).map((n, i) => (
								<li key={i} className='text-xs text-muted-foreground'>
									• {n}
								</li>
							))}
						</ul>
					</div>
				)}
				<div className='flex items-center justify-between text-xs text-muted-foreground pt-2 border-t'>
					<span className='flex items-center gap-1'>
						<Clock className='h-3 w-3' />
						ETA: {member.eta}
					</span>
					<span className='flex items-center gap-1'>
						<Activity className='h-3 w-3' />
						Updated: {new Date(member.last_update).toLocaleTimeString()}
					</span>
				</div>
			</CardContent>
		</Card>
	)
}

function DeploymentCard({ name, deployment }: { name: string; deployment: Deployment }) {
	const status = deployStatusConfig[deployment.status]
	const StatusIcon = status.icon

	return (
		<Card className='border shadow-sm'>
			<CardContent className='p-4 space-y-3'>
				<div className='flex items-center justify-between'>
					<div className='flex items-center gap-2'>
						<Server className='h-4 w-4 text-primary' />
						<span className='font-semibold text-sm capitalize'>{name}</span>
					</div>
					<Badge variant='outline' className={`text-[10px] ${status.color}`}>
						<StatusIcon
							className={`h-3 w-3 mr-1 ${deployment.status === 'deploying' ? 'animate-spin' : ''}`}
						/>
						{status.label}
					</Badge>
				</div>
				<div className='space-y-1'>
					<p className='text-xs text-muted-foreground'>URL</p>
					<a
						href={deployment.url}
						target='_blank'
						rel='noopener noreferrer'
						className='text-xs text-blue-600 hover:underline break-all'
					>
						{deployment.url}
					</a>
				</div>
				<div className='grid grid-cols-2 gap-2 text-xs'>
					<div>
						<p className='text-muted-foreground'>Branch</p>
						<p className='font-medium'>{deployment.branch}</p>
					</div>
					<div>
						<p className='text-muted-foreground'>Health</p>
						<p className='font-medium'>{deployment.health_check}</p>
					</div>
				</div>
				{deployment.notes && (
					<p className='text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-100'>
						{deployment.notes}
					</p>
				)}
			</CardContent>
		</Card>
	)
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════

export function AgentDashboardPage() {
	// ── Tasks state ──
	const [tasks, setTasks] = useState<AgentTask[]>([])
	const [stats, setStats] = useState<AgentData['stats'] | null>(null)
	const [generatedAt, setGeneratedAt] = useState<string>('')
	const [taskLoading, setTaskLoading] = useState(true)
	const [taskError, setTaskError] = useState<string | null>(null)
	const [filter, setFilter] = useState<'all' | 'critical' | 'high' | 'blocked'>('all')

	// ── Team state ──
	const [teamData, setTeamData] = useState<TeamData | null>(null)
	const [teamLoading, setTeamLoading] = useState(true)
	const [teamError, setTeamError] = useState<string | null>(null)

	// ── Shared state ──
	const [activeTab, setActiveTab] = useState<'tasks' | 'team'>('tasks')
	const [autoRefresh, setAutoRefresh] = useState(true)
	const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

	// ── Fetch tasks ──
	const fetchTasks = useCallback(async () => {
		try {
			const token = getToken()
			const res = await fetch(AGENTS_API, {
				headers: { Authorization: `Bearer ${token}` },
				credentials: 'include',
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const json = await res.json()
			if (json.success && json.data) {
				setTasks(json.data.tasks || [])
				setStats(json.data.stats || null)
				setGeneratedAt(json.data.generated_at || '')
				setTaskError(null)
			} else throw new Error('Invalid format')
		} catch (err) {
			setTaskError(err instanceof Error ? err.message : 'Failed to fetch tasks')
		} finally {
			setTaskLoading(false)
		}
	}, [])

	// ── Fetch team ──
	const fetchTeam = useCallback(async () => {
		try {
			const token = getToken()
			const res = await fetch(TEAM_API, {
				headers: { Authorization: `Bearer ${token}` },
				credentials: 'include',
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const json = await res.json()
			if (json.success && json.data) {
				setTeamData(json.data)
				setTeamError(null)
			} else throw new Error('Invalid format')
		} catch (err) {
			setTeamError(err instanceof Error ? err.message : 'Failed to fetch team status')
		} finally {
			setTeamLoading(false)
		}
	}, [])

	const fetchAll = useCallback(async () => {
		await Promise.all([fetchTasks(), fetchTeam()])
		setLastUpdated(new Date())
	}, [fetchTasks, fetchTeam])

	// ── Polling ──
	useEffect(() => {
		fetchAll()
	}, [fetchAll])
	useEffect(() => {
		if (!autoRefresh) return
		const interval = setInterval(fetchAll, POLL_INTERVAL)
		return () => clearInterval(interval)
	}, [fetchAll, autoRefresh])

	// ── Derived task stats ──
	const computedStats = stats || {
		total: tasks.length,
		todo: tasks.filter((t) => t.status === 'todo').length,
		inProgress: tasks.filter((t) => t.status === 'in-progress').length,
		done: tasks.filter((t) => t.status === 'done').length,
		blocked: tasks.filter((t) => t.status === 'blocked' || t.status === 'timeout').length,
		timeout: tasks.filter((t) => t.status === 'timeout').length,
		review: tasks.filter((t) => t.status === 'review').length,
		critical: tasks.filter((t) => t.priority === 'critical').length,
		high: tasks.filter((t) => t.priority === 'high').length,
		medium: tasks.filter((t) => t.priority === 'medium').length,
		low: tasks.filter((t) => t.priority === 'low').length,
	}

	const filteredTasks =
		filter === 'all'
			? tasks
			: filter === 'blocked'
				? tasks.filter((t) => t.status === 'blocked' || t.status === 'timeout')
				: tasks.filter((t) => t.priority === filter)

	const tasksByColumn = columns.reduce(
		(acc, col) => {
			acc[col] = filteredTasks.filter((t) => t.status === col)
			return acc
		},
		{} as Record<string, AgentTask[]>,
	)

	const teamStats = teamData?.stats || {
		total_members: 0,
		active: 0,
		idle: 0,
		blocked: 0,
		tasks_in_progress: 0,
		tasks_done: 0,
		deployments_live: 0,
		deployments_failed: 0,
	}

	const loading = activeTab === 'tasks' ? taskLoading : teamLoading
	const error = activeTab === 'tasks' ? taskError : teamError

	return (
		<div className='space-y-6'>
			{/* Header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='font-heading text-2xl font-bold'>Agent Command Center</h1>
					<p className='text-muted-foreground'>
						{activeTab === 'tasks'
							? 'Real-time agent orchestration'
							: 'Team progress and deployment health'}
						{generatedAt && activeTab === 'tasks' && (
							<span className='ml-2 text-xs'>
								(data: {new Date(generatedAt).toLocaleTimeString()})
							</span>
						)}
					</p>
				</div>
				<div className='flex gap-2'>
					<Button
						variant='outline'
						size='sm'
						className='gap-1.5'
						onClick={() => setAutoRefresh(!autoRefresh)}
					>
						{autoRefresh ? <Pause className='h-4 w-4' /> : <Play className='h-4 w-4' />}
						{autoRefresh ? 'Pause' : 'Resume'}
					</Button>
					<Button
						variant='outline'
						size='sm'
						className='gap-1.5'
						onClick={fetchAll}
						disabled={loading}
					>
						<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
					</Button>
				</div>
			</div>

			{/* Tabs */}
			<div className='flex gap-2 border-b pb-2'>
				<Button
					variant={activeTab === 'tasks' ? 'default' : 'ghost'}
					size='sm'
					className='gap-1.5'
					onClick={() => setActiveTab('tasks')}
				>
					<Layout className='h-4 w-4' /> Tasks
				</Button>
				<Button
					variant={activeTab === 'team' ? 'default' : 'ghost'}
					size='sm'
					className='gap-1.5'
					onClick={() => setActiveTab('team')}
				>
					<Users className='h-4 w-4' /> Team
				</Button>
				<span className='text-xs text-muted-foreground ml-auto flex items-center'>
					Last updated: {lastUpdated.toLocaleTimeString()}
					{autoRefresh && (
						<span className='ml-1 inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse' />
					)}
				</span>
			</div>

			{/* Error Banner */}
			{error && (
				<div className='rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700'>
					<div className='flex items-center gap-2'>
						<AlertCircle className='h-4 w-4' />
						<span className='font-medium'>Error:</span>
						{error}
					</div>
				</div>
			)}

			{/* ═══════════════════════════════════════════════ TASKS TAB */}
			{activeTab === 'tasks' && (
				<div className='space-y-6'>
					{/* Stats */}
					<div className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3'>
						<Card>
							<CardContent className='p-3'>
								<div className='flex items-center gap-2'>
									<Layout className='h-4 w-4 text-primary' />
									<span className='text-2xl font-bold'>{computedStats.total}</span>
								</div>
								<p className='text-xs text-muted-foreground'>Total Tasks</p>
							</CardContent>
						</Card>
						<Card>
							<CardContent className='p-3'>
								<div className='flex items-center gap-2'>
									<CircleIcon className='h-4 w-4 text-slate-500' />
									<span className='text-2xl font-bold'>{computedStats.todo}</span>
								</div>
								<p className='text-xs text-muted-foreground'>To Do</p>
							</CardContent>
						</Card>
						<Card>
							<CardContent className='p-3'>
								<div className='flex items-center gap-2'>
									<Loader2 className='h-4 w-4 text-blue-500 animate-spin' />
									<span className='text-2xl font-bold'>{computedStats.inProgress}</span>
								</div>
								<p className='text-xs text-muted-foreground'>In Progress</p>
							</CardContent>
						</Card>
						<Card>
							<CardContent className='p-3'>
								<div className='flex items-center gap-2'>
									<CheckCircle2 className='h-4 w-4 text-green-500' />
									<span className='text-2xl font-bold'>{computedStats.done}</span>
								</div>
								<p className='text-xs text-muted-foreground'>Done</p>
							</CardContent>
						</Card>
						<Card>
							<CardContent className='p-3'>
								<div className='flex items-center gap-2'>
									<AlertCircle className='h-4 w-4 text-red-500' />
									<span className='text-2xl font-bold'>{computedStats.blocked}</span>
								</div>
								<p className='text-xs text-muted-foreground'>Blocked</p>
							</CardContent>
						</Card>
						<Card>
							<CardContent className='p-3'>
								<div className='flex items-center gap-2'>
									<Sparkles className='h-4 w-4 text-amber-500' />
									<span className='text-2xl font-bold'>{computedStats.critical}</span>
								</div>
								<p className='text-xs text-muted-foreground'>Critical</p>
							</CardContent>
						</Card>
					</div>

					{/* Filters */}
					<div className='flex gap-2 flex-wrap'>
						{(['all', 'critical', 'high', 'blocked'] as const).map((f) => (
							<Button
								key={f}
								variant={filter === f ? 'default' : 'outline'}
								size='sm'
								className='text-xs'
								onClick={() => setFilter(f)}
							>
								{f === 'all' ? 'All Tasks' : f.charAt(0).toUpperCase() + f.slice(1)}
							</Button>
						))}
					</div>

					{/* Kanban Board */}
					<div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4'>
						{columns.map((col) => {
							const colTasks = tasksByColumn[col] || []
							const colStatus = statusConfig[col]
							const ColIcon = colStatus.icon
							return (
								<div key={col} className='space-y-3'>
									<div className='flex items-center justify-between'>
										<div className='flex items-center gap-2'>
											<ColIcon
												className={`h-4 w-4 ${col === 'in-progress' ? 'animate-spin' : ''}`}
											/>
											<h3 className='font-semibold text-sm'>{colStatus.label}</h3>
											<Badge variant='secondary' className='text-xs'>
												{colTasks.length}
											</Badge>
										</div>
									</div>
									<ScrollArea className='h-[calc(100vh-380px)]'>
										<div className='space-y-3 pr-3'>
											{colTasks.map((task) => (
												<TaskCard key={task.id} task={task} />
											))}
											{colTasks.length === 0 && (
												<div className='rounded-lg border border-dashed p-4 text-center'>
													<p className='text-xs text-muted-foreground'>No tasks</p>
												</div>
											)}
										</div>
									</ScrollArea>
								</div>
							)
						})}
					</div>
				</div>
			)}

			{/* ═══════════════════════════════════════════════ TEAM TAB */}
			{activeTab === 'team' && (
				<div className='space-y-6'>
					{/* Stats */}
					<div className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3'>
						<Card>
							<CardContent className='p-3'>
								<div className='flex items-center gap-2'>
									<Users className='h-4 w-4 text-primary' />
									<span className='text-2xl font-bold'>{teamStats.total_members}</span>
								</div>
								<p className='text-xs text-muted-foreground'>Team Members</p>
							</CardContent>
						</Card>
						<Card>
							<CardContent className='p-3'>
								<div className='flex items-center gap-2'>
									<CheckCircle2 className='h-4 w-4 text-green-500' />
									<span className='text-2xl font-bold'>{teamStats.active}</span>
								</div>
								<p className='text-xs text-muted-foreground'>Active</p>
							</CardContent>
						</Card>
						<Card>
							<CardContent className='p-3'>
								<div className='flex items-center gap-2'>
									<Loader2 className='h-4 w-4 text-blue-500 animate-spin' />
									<span className='text-2xl font-bold'>{teamStats.tasks_in_progress}</span>
								</div>
								<p className='text-xs text-muted-foreground'>Tasks In Progress</p>
							</CardContent>
						</Card>
						<Card>
							<CardContent className='p-3'>
								<div className='flex items-center gap-2'>
									<CheckCircle2 className='h-4 w-4 text-green-500' />
									<span className='text-2xl font-bold'>{teamStats.tasks_done}</span>
								</div>
								<p className='text-xs text-muted-foreground'>Tasks Done</p>
							</CardContent>
						</Card>
						<Card>
							<CardContent className='p-3'>
								<div className='flex items-center gap-2'>
									<AlertCircle className='h-4 w-4 text-red-500' />
									<span className='text-2xl font-bold'>{teamStats.blocked}</span>
								</div>
								<p className='text-xs text-muted-foreground'>Blocked</p>
							</CardContent>
						</Card>
						<Card>
							<CardContent className='p-3'>
								<div className='flex items-center gap-2'>
									<Server className='h-4 w-4 text-primary' />
									<span className='text-2xl font-bold'>{teamStats.deployments_live}</span>
								</div>
								<p className='text-xs text-muted-foreground'>Live Deployments</p>
							</CardContent>
						</Card>
					</div>

					{/* Deployments */}
					<div className='space-y-3'>
						<h2 className='font-semibold text-lg flex items-center gap-2'>
							<Server className='h-5 w-5' />
							Deployments
						</h2>
						<div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
							{teamData &&
								Object.entries(teamData.deployments).map(([name, d]) => (
									<DeploymentCard key={name} name={name} deployment={d} />
								))}
							{!teamData &&
								Array.from({ length: 3 }).map((_, i) => (
									<Card key={i} className='border shadow-sm animate-pulse'>
										<CardContent className='p-4 h-32' />
									</Card>
								))}
						</div>
					</div>

					{/* Team Members */}
					<div className='space-y-3'>
						<h2 className='font-semibold text-lg flex items-center gap-2'>
							<Users className='h-5 w-5' />
							Team Members
						</h2>
						<div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
							{teamData?.team_members.map((m) => (
								<TeamMemberCard key={m.id} member={m} />
							))}
							{!teamData &&
								Array.from({ length: 5 }).map((_, i) => (
									<Card key={i} className='border shadow-sm animate-pulse'>
										<CardContent className='p-4 h-64' />
									</Card>
								))}
						</div>
					</div>

					{/* Recent Commits */}
					<div className='space-y-3'>
						<h2 className='font-semibold text-lg flex items-center gap-2'>
							<GitBranch className='h-5 w-5' />
							Recent Commits
						</h2>
						<Card>
							<CardContent className='p-0'>
								<ScrollArea className='h-48'>
									<div className='divide-y'>
										{teamData?.recent_commits.map((c, i) => (
											<div key={i} className='p-3 flex items-start gap-3'>
												<div className='p-1.5 rounded-md bg-primary/10 shrink-0'>
													<GitBranch className='h-3.5 w-3.5 text-primary' />
												</div>
												<div className='min-w-0 flex-1'>
													<p className='text-sm font-medium truncate'>{c.message}</p>
													<div className='flex items-center gap-2 text-xs text-muted-foreground'>
														<span className='font-mono bg-muted px-1 rounded'>
															{c.sha.slice(0, 7)}
														</span>
														<span>{c.author}</span>
														<span>•</span>
														<span>{c.branch}</span>
														<span>•</span>
														<span>{new Date(c.time).toLocaleTimeString()}</span>
													</div>
												</div>
											</div>
										))}
										{!teamData?.recent_commits?.length && (
											<div className='p-4 text-center text-sm text-muted-foreground'>
												No recent commits
											</div>
										)}
									</div>
								</ScrollArea>
							</CardContent>
						</Card>
					</div>
				</div>
			)}
		</div>
	)
}

// Helper for Circle icon
function CircleIcon({ className }: { className?: string }) {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='2'
			strokeLinecap='round'
			strokeLinejoin='round'
			className={className}
		>
			<circle cx='12' cy='12' r='10' />
		</svg>
	)
}
