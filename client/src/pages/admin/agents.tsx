import {
	Activity,
	AlertTriangle,
	BarChart3,
	Bot,
	CheckCircle,
	ChevronRight,
	Clock,
	Play,
	RefreshCw,
	Search,
	Square,
	Terminal,
	XCircle,
	Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ChartCard } from '@/components/domain/chart-card'
import { EmptyState } from '@/components/domain/empty-state'
import { Skeleton } from '@/components/domain/skeleton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { trackEvent } from '@/lib/analytics'
import { apiCall } from '@/lib/api'

export type Agent = {
	id: string
	name: string
	type: 'clawbot' | 'scheduled' | 'webhook' | 'manual' | 'integration'
	status: 'running' | 'idle' | 'failed' | 'completed' | 'paused'
	lastRunAt: string
	nextRunAt?: string
	totalRuns: number
	successRate: number
	avgDuration: number // seconds
	currentTask?: string
	errorCount: number
	warningCount: number
	category: string
	description: string
}

export type AgentRun = {
	id: string
	agentId: string
	agentName: string
	status: 'success' | 'failed' | 'running' | 'cancelled'
	startedAt: string
	endedAt?: string
	duration: number
	output: string
	error?: string
	trigger: 'cron' | 'manual' | 'webhook' | 'parent'
}

export type AgentStats = {
	totalAgents: number
	activeNow: number
	failedLast24h: number
	completedLast24h: number
	avgSuccessRate: number
	totalRunsToday: number
	avgDuration: number
	queueDepth: number
}

const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
	running: {
		color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
		icon: <Activity className='h-3.5 w-3.5 animate-pulse' />,
		label: 'Running',
	},
	idle: {
		color: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400',
		icon: <Clock className='h-3.5 w-3.5' />,
		label: 'Idle',
	},
	failed: {
		color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
		icon: <XCircle className='h-3.5 w-3.5' />,
		label: 'Failed',
	},
	completed: {
		color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
		icon: <CheckCircle className='h-3.5 w-3.5' />,
		label: 'Completed',
	},
	paused: {
		color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
		icon: <Square className='h-3.5 w-3.5' />,
		label: 'Paused',
	},
}

const typeConfig: Record<string, { color: string; label: string }> = {
	clawbot: {
		color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
		label: 'Clawbot',
	},
	scheduled: {
		color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
		label: 'Scheduled',
	},
	webhook: {
		color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
		label: 'Webhook',
	},
	manual: {
		color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
		label: 'Manual',
	},
	integration: {
		color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
		label: 'Integration',
	},
}

const runStatusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
	success: { color: 'text-green-600', icon: <CheckCircle className='h-4 w-4' /> },
	failed: { color: 'text-red-600', icon: <XCircle className='h-4 w-4' /> },
	running: { color: 'text-blue-600', icon: <Activity className='h-4 w-4 animate-pulse' /> },
	cancelled: { color: 'text-slate-600', icon: <Square className='h-4 w-4' /> },
}

export function AdminAgentsDashboardPage() {
	const [agents, setAgents] = useState<Agent[]>([])
	const [runs, setRuns] = useState<AgentRun[]>([])
	const [stats, setStats] = useState<AgentStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [selectedTab, setSelectedTab] = useState('agents')
	const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
	const [refreshing, setRefreshing] = useState(false)
	const [searchQuery, setSearchQuery] = useState('')
	const [statusFilter, setStatusFilter] = useState<string>('all')

	const loadData = useCallback(async () => {
		setLoading(true)
		try {
			const [agentsData, runsData, statsData] = await Promise.all([
				apiCall<{ agents: Agent[] }>('/admin/agents').catch(() => ({ agents: [] })),
				apiCall<{ runs: AgentRun[] }>('/admin/agents/runs?limit=50').catch(() => ({ runs: [] })),
				apiCall<{ stats: AgentStats }>('/admin/agents/stats').catch(() => ({ stats: null })),
			])
			setAgents(agentsData.agents || [])
			setRuns(runsData.runs || [])
			setStats(statsData.stats)
		} catch (err) {
			console.error('Failed to load agent data:', err)
			// Use mock data if API fails
			setAgents(generateMockAgents())
			setRuns(generateMockRuns())
			setStats(generateMockStats())
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadData()
	}, [loadData])

	const handleRefresh = async () => {
		setRefreshing(true)
		trackEvent('agents_refresh')
		await loadData()
		setRefreshing(false)
	}

	const handleRunAgent = async (agentId: string) => {
		try {
			await apiCall(`/admin/agents/${agentId}/run`, { method: 'POST' })
			trackEvent('agent_manual_run', { agent_id: agentId })
			await loadData()
		} catch (err) {
			console.error('Failed to run agent:', err)
		}
	}

	const handlePauseAgent = async (agentId: string) => {
		try {
			await apiCall(`/admin/agents/${agentId}/pause`, { method: 'POST' })
			trackEvent('agent_pause', { agent_id: agentId })
			await loadData()
		} catch (err) {
			console.error('Failed to pause agent:', err)
		}
	}

	const filteredAgents = agents.filter((a) => {
		const matchesSearch =
			a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
			a.category.toLowerCase().includes(searchQuery.toLowerCase())
		const matchesStatus = statusFilter === 'all' || a.status === statusFilter
		return matchesSearch && matchesStatus
	})

	const statusCounts = {
		all: agents.length,
		running: agents.filter((a) => a.status === 'running').length,
		idle: agents.filter((a) => a.status === 'idle').length,
		failed: agents.filter((a) => a.status === 'failed').length,
		paused: agents.filter((a) => a.status === 'paused').length,
	}

	if (selectedAgent) {
		return (
			<AgentDetail
				agent={selectedAgent}
				runs={runs.filter((r) => r.agentId === selectedAgent.id)}
				onBack={() => setSelectedAgent(null)}
			/>
		)
	}

	return (
		<div className='space-y-6'>
			{/* Header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='font-heading text-2xl font-bold'>Agent Monitor</h1>
					<p className='text-muted-foreground'>Real-time visibility into all 210 agents</p>
				</div>
				<div className='flex gap-2'>
					<Button
						variant='outline'
						size='sm'
						onClick={handleRefresh}
						disabled={refreshing}
						className='gap-1'
					>
						<RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
						Refresh
					</Button>
					<Button size='sm' className='gap-1'>
						<Zap className='h-4 w-4' />
						Run All
					</Button>
				</div>
			</div>

			{/* Stats */}
			{stats && (
				<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
					<ChartCard
						title='Total Agents'
						value={stats.totalAgents}
						icon={<Bot className='h-4 w-4' />}
					/>
					<ChartCard
						title='Active Now'
						value={stats.activeNow}
						trend='up'
						trendValue={`${Math.round((stats.activeNow / Math.max(stats.totalAgents, 1)) * 100)}%`}
						icon={<Activity className='h-4 w-4' />}
					/>
					<ChartCard
						title='Success Rate'
						value={`${Math.round(stats.avgSuccessRate)}%`}
						trend={stats.avgSuccessRate > 90 ? 'up' : 'down'}
						trendValue={stats.avgSuccessRate > 90 ? 'Healthy' : 'Needs attention'}
						icon={<CheckCircle className='h-4 w-4' />}
					/>
					<ChartCard
						title='Runs Today'
						value={stats.totalRunsToday}
						icon={<BarChart3 className='h-4 w-4' />}
					/>
				</div>
			)}

			{/* Health Overview */}
			<div className='grid gap-4 lg:grid-cols-3'>
				<Card>
					<CardContent className='p-4'>
						<div className='space-y-3'>
							<p className='text-sm font-medium'>Agent Health</p>
							<div className='space-y-2'>
								{[
									{
										label: 'Running',
										count: statusCounts.running,
										total: agents.length,
										color: 'bg-blue-500',
									},
									{
										label: 'Idle',
										count: statusCounts.idle,
										total: agents.length,
										color: 'bg-slate-400',
									},
									{
										label: 'Failed',
										count: statusCounts.failed,
										total: agents.length,
										color: 'bg-red-500',
									},
									{
										label: 'Paused',
										count: statusCounts.paused,
										total: agents.length,
										color: 'bg-amber-500',
									},
								].map((item) => (
									<div key={item.label} className='space-y-1'>
										<div className='flex items-center justify-between text-xs'>
											<span>{item.label}</span>
											<span className='font-medium'>
												{item.count} ({Math.round((item.count / Math.max(item.total, 1)) * 100)}%)
											</span>
										</div>
										<Progress
											value={(item.count / Math.max(item.total, 1)) * 100}
											className='h-1.5'
										/>
									</div>
								))}
							</div>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardContent className='p-4'>
						<div className='space-y-3'>
							<p className='text-sm font-medium'>Recent Failures (24h)</p>
							<div className='space-y-2'>
								{runs
									.filter((r) => r.status === 'failed')
									.slice(0, 5)
									.map((run) => (
										<div key={run.id} className='flex items-start gap-2 text-sm'>
											<XCircle className='h-4 w-4 text-red-500 mt-0.5 shrink-0' />
											<div className='min-w-0'>
												<p className='font-medium truncate'>{run.agentName}</p>
												<p className='text-xs text-muted-foreground'>
													{run.error?.slice(0, 60)}...
												</p>
											</div>
										</div>
									))}
								{runs.filter((r) => r.status === 'failed').length === 0 && (
									<p className='text-sm text-muted-foreground'>No failures in last 24h</p>
								)}
							</div>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardContent className='p-4'>
						<div className='space-y-3'>
							<p className='text-sm font-medium'>Queue Status</p>
							<div className='flex items-center justify-between'>
								<span className='text-sm text-muted-foreground'>Pending jobs</span>
								<span className='text-lg font-bold'>{stats?.queueDepth || 0}</span>
							</div>
							<Progress
								value={Math.min(((stats?.queueDepth || 0) / 50) * 100, 100)}
								className='h-2'
							/>
							<p className='text-xs text-muted-foreground'>Auto-scaling at 50+ queue depth</p>
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Tabs */}
			<Tabs value={selectedTab} onValueChange={setSelectedTab}>
				<TabsList className='flex-wrap h-auto'>
					<TabsTrigger value='agents' className='gap-1'>
						<Bot className='h-3.5 w-3.5' />
						Agents
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{statusCounts.all}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='running' className='gap-1'>
						<Activity className='h-3.5 w-3.5' />
						Running
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{statusCounts.running}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='failed' className='gap-1'>
						<AlertTriangle className='h-3.5 w-3.5' />
						Failed
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{statusCounts.failed}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='runs' className='gap-1'>
						<Terminal className='h-3.5 w-3.5' />
						Recent Runs
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{runs.length}
						</Badge>
					</TabsTrigger>
				</TabsList>

				<TabsContent value={selectedTab} className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='card' />
					) : selectedTab === 'runs' ? (
						<RunsTable runs={runs} />
					) : (
						<AgentsGrid
							agents={
								selectedTab === 'all' || selectedTab === 'agents'
									? filteredAgents
									: filteredAgents.filter((a) => a.status === selectedTab)
							}
							onSelect={setSelectedAgent}
							onRun={handleRunAgent}
							onPause={handlePauseAgent}
							searchQuery={searchQuery}
							onSearchChange={setSearchQuery}
							statusFilter={statusFilter}
							onStatusFilterChange={setStatusFilter}
						/>
					)}
				</TabsContent>
			</Tabs>
		</div>
	)
}

function AgentsGrid({
	agents,
	onSelect,
	onRun,
	onPause,
	searchQuery,
	onSearchChange,
	statusFilter,
	onStatusFilterChange,
}: {
	agents: Agent[]
	onSelect: (a: Agent) => void
	onRun: (id: string) => void
	onPause: (id: string) => void
	searchQuery: string
	onSearchChange: (q: string) => void
	statusFilter: string
	onStatusFilterChange: (s: string) => void
}) {
	if (agents.length === 0) {
		return (
			<EmptyState
				icon={Bot}
				title='No agents found'
				description='Try adjusting your search or filters'
				action={{
					label: 'Clear filters',
					onClick: () => {
						onSearchChange('')
						onStatusFilterChange('all')
					},
				}}
			/>
		)
	}

	return (
		<div className='space-y-4'>
			{/* Search & Filter */}
			<div className='flex flex-col gap-2 sm:flex-row'>
				<div className='relative flex-1'>
					<Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
					<input
						type='text'
						placeholder='Search agents...'
						value={searchQuery}
						onChange={(e) => onSearchChange(e.target.value)}
						className='w-full h-9 rounded-md border bg-background px-9 text-sm'
					/>
				</div>
				<select
					value={statusFilter}
					onChange={(e) => onStatusFilterChange(e.target.value)}
					className='h-9 rounded-md border bg-background px-3 text-sm'
				>
					<option value='all'>All Status</option>
					<option value='running'>Running</option>
					<option value='idle'>Idle</option>
					<option value='failed'>Failed</option>
					<option value='paused'>Paused</option>
				</select>
			</div>

			{/* Grid */}
			<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
				{agents.map((agent) => {
					const status = statusConfig[agent.status]
					const type = typeConfig[agent.type]

					return (
						<Card
							key={agent.id}
							className='cursor-pointer hover:shadow-md transition-all overflow-hidden'
							onClick={() => onSelect(agent)}
						>
							<CardContent className='p-4'>
								<div className='flex items-start gap-3'>
									<Avatar className='h-10 w-10 border'>
										<AvatarFallback className='bg-primary/10 text-primary'>
											<Bot className='h-5 w-5' />
										</AvatarFallback>
									</Avatar>
									<div className='flex-1 min-w-0'>
										<div className='flex items-center gap-2 flex-wrap'>
											<h3 className='font-semibold text-sm truncate'>{agent.name}</h3>
											<Badge className={`text-xs ${status.color}`}>
												{status.icon}
												<span className='ml-1'>{status.label}</span>
											</Badge>
										</div>
										<p className='text-xs text-muted-foreground mt-0.5'>{agent.category}</p>
										<div className='flex items-center gap-1 mt-1'>
											<Badge variant='outline' className={`text-xs ${type.color}`}>
												{type.label}
											</Badge>
										</div>
									</div>
								</div>

								<div className='mt-3 grid grid-cols-2 gap-2 text-xs'>
									<div className='p-2 rounded bg-muted/50'>
										<p className='text-muted-foreground'>Runs</p>
										<p className='font-semibold'>{agent.totalRuns.toLocaleString()}</p>
									</div>
									<div className='p-2 rounded bg-muted/50'>
										<p className='text-muted-foreground'>Success</p>
										<p className='font-semibold'>{Math.round(agent.successRate)}%</p>
									</div>
									<div className='p-2 rounded bg-muted/50'>
										<p className='text-muted-foreground'>Avg Duration</p>
										<p className='font-semibold'>{formatDuration(agent.avgDuration)}</p>
									</div>
									<div className='p-2 rounded bg-muted/50'>
										<p className='text-muted-foreground'>Errors</p>
										<p className={`font-semibold ${agent.errorCount > 0 ? 'text-red-600' : ''}`}>
											{agent.errorCount}
										</p>
									</div>
								</div>

								{agent.currentTask && (
									<div className='mt-2 p-2 rounded bg-blue-50 dark:bg-blue-900/20 text-xs'>
										<div className='flex items-center gap-1 text-blue-700 dark:text-blue-400'>
											<Activity className='h-3 w-3 animate-pulse' />
											<span className='font-medium'>{agent.currentTask}</span>
										</div>
									</div>
								)}

								<div className='mt-3 flex items-center justify-between'>
									<span className='text-xs text-muted-foreground'>
										Last: {new Date(agent.lastRunAt).toLocaleString()}
									</span>
									<div className='flex gap-1'>
										<Button
											variant='ghost'
											size='sm'
											className='h-7 w-7 p-0'
											onClick={(e) => {
												e.stopPropagation()
												onRun(agent.id)
											}}
										>
											<Play className='h-3.5 w-3.5' />
										</Button>
										<Button
											variant='ghost'
											size='sm'
											className='h-7 w-7 p-0'
											onClick={(e) => {
												e.stopPropagation()
												onPause(agent.id)
											}}
										>
											<Square className='h-3.5 w-3.5' />
										</Button>
									</div>
								</div>
							</CardContent>
						</Card>
					)
				})}
			</div>
		</div>
	)
}

function RunsTable({ runs }: { runs: AgentRun[] }) {
	if (runs.length === 0) {
		return (
			<EmptyState
				icon={Terminal}
				title='No recent runs'
				description='Agent runs will appear here'
			/>
		)
	}

	return (
		<div className='rounded-md border overflow-x-auto'>
			<table className='w-full text-sm min-w-[640px]'>
				<thead className='bg-muted/50'>
					<tr className='border-b'>
						<th className='h-12 px-4 text-left font-medium text-muted-foreground'>Agent</th>
						<th className='h-12 px-4 text-left font-medium text-muted-foreground'>Status</th>
						<th className='h-12 px-4 text-left font-medium text-muted-foreground'>Trigger</th>
						<th className='h-12 px-4 text-left font-medium text-muted-foreground'>Duration</th>
						<th className='h-12 px-4 text-left font-medium text-muted-foreground'>Started</th>
						<th className='h-12 px-4 text-left font-medium text-muted-foreground'>Output</th>
					</tr>
				</thead>
				<tbody>
					{runs.map((run) => {
						const status = runStatusConfig[run.status]
						return (
							<tr key={run.id} className='border-b hover:bg-muted/50'>
								<td className='p-4 font-medium'>{run.agentName}</td>
								<td className='p-4'>
									<span className={`flex items-center gap-1 ${status.color}`}>
										{status.icon}
										<span className='capitalize'>{run.status}</span>
									</span>
								</td>
								<td className='p-4'>
									<Badge variant='outline' className='text-xs capitalize'>
										{run.trigger}
									</Badge>
								</td>
								<td className='p-4'>{formatDuration(run.duration)}</td>
								<td className='p-4 text-muted-foreground'>
									{new Date(run.startedAt).toLocaleString()}
								</td>
								<td className='p-4'>
									<div className='max-w-[200px] truncate text-muted-foreground'>{run.output}</div>
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}

function AgentDetail({
	agent,
	runs,
	onBack,
}: {
	agent: Agent
	runs: AgentRun[]
	onBack: () => void
}) {
	const status = statusConfig[agent.status]
	const type = typeConfig[agent.type]

	return (
		<div className='space-y-6'>
			<Button variant='ghost' size='sm' onClick={onBack} className='gap-1'>
				<ChevronRight className='h-4 w-4 rotate-180' />
				Back to agents
			</Button>

			<div className='flex flex-col gap-4 sm:flex-row sm:items-start'>
				<Avatar className='h-16 w-16 border'>
					<AvatarFallback className='bg-primary/10 text-primary'>
						<Bot className='h-8 w-8' />
					</AvatarFallback>
				</Avatar>
				<div className='flex-1'>
					<div className='flex items-center gap-2 flex-wrap'>
						<h1 className='font-heading text-2xl font-bold'>{agent.name}</h1>
						<Badge className={`${status.color}`}>
							{status.icon}
							<span className='ml-1'>{status.label}</span>
						</Badge>
						<Badge className={`${type.color}`}>{type.label}</Badge>
					</div>
					<p className='text-muted-foreground'>{agent.description}</p>
				</div>
				<div className='flex gap-2 shrink-0'>
					<Button size='sm' variant='outline' className='gap-1'>
						<Play className='h-4 w-4' />
						Run Now
					</Button>
					<Button size='sm' variant='outline' className='gap-1'>
						<Square className='h-4 w-4' />
						Pause
					</Button>
				</div>
			</div>

			<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
				<ChartCard
					title='Total Runs'
					value={agent.totalRuns}
					icon={<BarChart3 className='h-4 w-4' />}
				/>
				<ChartCard
					title='Success Rate'
					value={`${Math.round(agent.successRate)}%`}
					icon={<CheckCircle className='h-4 w-4' />}
				/>
				<ChartCard
					title='Avg Duration'
					value={formatDuration(agent.avgDuration)}
					icon={<Clock className='h-4 w-4' />}
				/>
				<ChartCard
					title='Errors'
					value={agent.errorCount}
					trend={agent.errorCount > 0 ? 'down' : 'neutral'}
					icon={<AlertTriangle className='h-4 w-4' />}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Run History</CardTitle>
				</CardHeader>
				<CardContent>
					<RunsTable runs={runs} />
				</CardContent>
			</Card>
		</div>
	)
}

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
	return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

// Mock data generators
function generateMockAgents(): Agent[] {
	const categories = [
		'Recruitment',
		'Screening',
		'Analytics',
		'Compliance',
		'Messaging',
		'Integration',
	]
	const types: Agent['type'][] = ['clawbot', 'scheduled', 'webhook', 'manual', 'integration']
	const statuses: Agent['status'][] = ['running', 'idle', 'failed', 'paused']

	return Array.from({ length: 210 }, (_, i) => ({
		id: `agent-${i + 1}`,
		name: `Agent ${i + 1}: ${categories[i % categories.length]} ${i % 3 === 0 ? 'Pipeline' : i % 3 === 1 ? 'Scanner' : 'Processor'}`,
		type: types[i % types.length],
		status: statuses[i % statuses.length],
		lastRunAt: new Date(Date.now() - Math.random() * 86400000 * 7).toISOString(),
		nextRunAt:
			i % 2 === 0 ? new Date(Date.now() + Math.random() * 86400000).toISOString() : undefined,
		totalRuns: Math.floor(Math.random() * 1000),
		successRate: 70 + Math.random() * 30,
		avgDuration: Math.floor(Math.random() * 300),
		currentTask: i % 5 === 0 ? 'Processing candidate batch...' : undefined,
		errorCount: Math.floor(Math.random() * 10),
		warningCount: Math.floor(Math.random() * 20),
		category: categories[i % categories.length],
		description: `Automated ${categories[i % categories.length].toLowerCase()} agent handling ${i % 3 === 0 ? 'candidate pipeline' : i % 3 === 1 ? 'document screening' : 'data analysis'}`,
	}))
}

function generateMockRuns(): AgentRun[] {
	const triggers: AgentRun['trigger'][] = ['cron', 'manual', 'webhook', 'parent']
	const statuses: AgentRun['status'][] = ['success', 'failed', 'running', 'cancelled']

	return Array.from({ length: 50 }, (_, i) => ({
		id: `run-${i + 1}`,
		agentId: `agent-${(i % 210) + 1}`,
		agentName: `Agent ${(i % 210) + 1}`,
		status: statuses[i % statuses.length],
		startedAt: new Date(Date.now() - Math.random() * 86400000).toISOString(),
		endedAt: i % 2 === 0 ? new Date(Date.now() - Math.random() * 3600000).toISOString() : undefined,
		duration: Math.floor(Math.random() * 300),
		output: `Completed ${Math.floor(Math.random() * 100)} items. ${i % 3 === 0 ? 'Warning: slow response' : 'All systems normal'}`,
		error: i % 4 === 0 ? 'Timeout: API response exceeded 30s' : undefined,
		trigger: triggers[i % triggers.length],
	}))
}

function generateMockStats(): AgentStats {
	return {
		totalAgents: 210,
		activeNow: 47,
		failedLast24h: 3,
		completedLast24h: 1247,
		avgSuccessRate: 94.2,
		totalRunsToday: 1250,
		avgDuration: 45,
		queueDepth: 12,
	}
}
