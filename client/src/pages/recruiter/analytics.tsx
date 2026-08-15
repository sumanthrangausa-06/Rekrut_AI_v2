import {
	Activity,
	ArrowDownRight,
	ArrowUpRight,
	Award,
	BarChart,
	BarChart3,
	Clock,
	Download,
	Eye,
	FileText,
	Minus,
	MousePointer,
	Printer,
	Star,
	Target,
	Timer,
	Users,
	XCircle,
	Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '@/components/domain/empty-state'
import { Skeleton } from '@/components/domain/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { trackEvent } from '@/lib/analytics'
import { apiCall } from '@/lib/api'

interface AnalyticsData {
	job_stats: {
		total_views: number
		active_jobs: number
		paused_jobs: number
		closed_jobs: number
	}
	application_stats: {
		total_applications: number
		new_applications: number
		reviewed: number
		interviewed: number
		offered: number
		hired: number
		rejected: number
	}
	avg_time_to_hire: number | null
	jobs: Array<{
		id: number
		title: string
		status: string
		application_count: number
		views: number
	}>
	score_distribution?: {
		'900': number
		'800': number
		'700': number
		'600': number
		below: number
	}
	source_breakdown?: Array<{
		name: string
		count: number
		percentage: number
	}>
	hiring_velocity?: Array<{
		month: string
		applications: number
		hired: number
		interviews: number
	}>
	time_to_hire_by_stage?: Array<{
		stage: string
		avg_days: number
		count: number
	}>
	diversity_metrics?: {
		gender_distribution: Array<{ label: string; percentage: number }>
		ethnicity_distribution: Array<{ label: string; percentage: number }>
	}
	cost_per_hire?: number
	quality_of_hire?: number
	offer_acceptance_rate?: number
	conversion_rate?: number
	rejection_reasons?: Array<{
		reason: string
		count: number
		percentage: number
		trend: number
	}>
	diversity_pipeline_dropoff?: {
		gender: Array<{
			group: string
			stages: Array<{ stage: string; count: number; dropoff: number }>
		}>
		ethnicity: Array<{
			group: string
			stages: Array<{ stage: string; count: number; dropoff: number }>
		}>
	}
	time_to_hire_breakdown?: {
		by_role: Array<{ dimension: string; avg_days: string; count: number }>
		by_source: Array<{ dimension: string; avg_days: string; count: number }>
		by_recruiter: Array<{ dimension: string; avg_days: string; count: number }>
	}

}
export function RecruiterAnalyticsPage() {
	const [data, setData] = useState<AnalyticsData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [timeRange, setTimeRange] = useState('30')
	const [_activeSection, _setActiveSection] = useState('overview')

	const loadAnalytics = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const [dashboardResponse, jobsResponse] = await Promise.all([
				apiCall<Omit<AnalyticsData, 'jobs'> & { success: boolean }>(`/recruiter/dashboard?days=${timeRange}`),
				apiCall<{ jobs: AnalyticsData['jobs'] }>(`/recruiter/jobs?limit=5`),
			])

			const { success: _success, ...dashboardData } = dashboardResponse

			setData({
				...dashboardData,
				jobs: jobsResponse.jobs || [],
			})
			trackEvent('analytics_view', { time_range: timeRange })
		} catch (err) {
			console.error('Failed to load analytics:', err)
			setError(err instanceof Error ? err.message : 'Failed to load analytics')
		} finally {
			setLoading(false)
		}
	}, [timeRange])

	useEffect(() => {
		loadAnalytics()
	}, [loadAnalytics])

	const stats = data
		? {
				jobViews: data.job_stats?.total_views || 0,
				applications: data.application_stats?.total_applications || 0,
				conversionRate: data.job_stats?.total_views
					? ((data.application_stats?.total_applications || 0) / data.job_stats.total_views) * 100
					: 0,
				timeToHire: data.avg_time_to_hire || 0,
				hired: data.application_stats?.hired || 0,
				interviewed: data.application_stats?.interviewed || 0,
				offered: data.application_stats?.offered || 0,
				rejected: data.application_stats?.rejected || 0,
				reviewed: data.application_stats?.reviewed || 0,
			}
		: {
				jobViews: 0,
				applications: 0,
				conversionRate: 0,
				timeToHire: 0,
				hired: 0,
				interviewed: 0,
				offered: 0,
				rejected: 0,
				reviewed: 0,
			}

	// Calculate funnel metrics
	const funnelData = [
		{
			label: 'Job Views',
			value: stats.jobViews,
			nextStage: stats.applications,
			color: 'from-slate-500 to-slate-600',
			bg: 'bg-slate-500',
		},
		{
			label: 'Applied',
			value: stats.applications,
			nextStage: stats.reviewed,
			color: 'from-blue-500 to-blue-600',
			bg: 'bg-blue-500',
		},
		{
			label: 'Screened',
			value: stats.reviewed,
			nextStage: stats.interviewed,
			color: 'from-amber-500 to-amber-600',
			bg: 'bg-amber-500',
		},
		{
			label: 'Interviewed',
			value: stats.interviewed,
			nextStage: stats.offered,
			color: 'from-purple-500 to-purple-600',
			bg: 'bg-purple-500',
		},
		{
			label: 'Offered',
			value: stats.offered,
			nextStage: stats.hired,
			color: 'from-green-500 to-green-600',
			bg: 'bg-green-500',
		},
		{
			label: 'Hired',
			value: stats.hired,
			nextStage: 0,
			color: 'from-emerald-500 to-emerald-600',
			bg: 'bg-emerald-500',
		},
	]

	const maxFunnelValue = Math.max(...funnelData.map((s) => s.value), 1)

	// Conversion rates between stages
	const stageConversions = funnelData.map((stage, i) => {
		if (i === 0 || stage.value === 0) return 0
		return ((stage.value / funnelData[i - 1].value) * 100).toFixed(1)
	})

	const sourceBreakdown = data?.source_breakdown || []

	const scoreDist = data?.score_distribution || {
		'900': 0,
		'800': 0,
		'700': 0,
		'600': 0,
		below: 0,
	}
	const totalScores = Object.values(scoreDist).reduce((a, b) => a + b, 0) || 1

	// Velocity data
	const velocityData = data?.hiring_velocity || []
	const maxVelocity = Math.max(...velocityData.map((d) => d.applications), 1)

	// Time to hire by stage
	const timeByStage = data?.time_to_hire_by_stage || []

	// Diversity metrics
	const diversityMetrics = data?.diversity_metrics || null

	// Rejection reasons
	const rejectionReasons = data?.rejection_reasons || []
	const maxRejectionCount = Math.max(...rejectionReasons.map((r) => r.count), 1)

	if (loading) {
		return (
			<div className='space-y-6'>
				<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
					<div className='space-y-2'>
						<div className='h-8 w-48 rounded bg-muted animate-pulse' />
						<div className='h-4 w-64 rounded bg-muted animate-pulse' />
					</div>
					<div className='flex gap-2'>
						<div className='h-10 w-32 rounded bg-muted animate-pulse' />
						<div className='h-10 w-24 rounded bg-muted animate-pulse' />
					</div>
				</div>
				<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
					<Skeleton variant='card' />
					<Skeleton variant='card' />
					<Skeleton variant='card' />
					<Skeleton variant='card' />
				</div>
				<div className='grid gap-4 lg:grid-cols-2'>
					<Skeleton variant='card' />
					<Skeleton variant='card' />
				</div>
			</div>
		)
	}

	const handleExport = () => {
		if (!data) return

		const headers = ['Metric', 'Value']
		const rows = [
			['Job Views', data.job_stats?.total_views?.toString() || '0'],
			['Active Jobs', data.job_stats?.active_jobs?.toString() || '0'],
			['Paused Jobs', data.job_stats?.paused_jobs?.toString() || '0'],
			['Closed Jobs', data.job_stats?.closed_jobs?.toString() || '0'],
			['Total Applications', data.application_stats?.total_applications?.toString() || '0'],
			['New Applications', data.application_stats?.new_applications?.toString() || '0'],
			['Reviewed', data.application_stats?.reviewed?.toString() || '0'],
			['Interviewed', data.application_stats?.interviewed?.toString() || '0'],
			['Offered', data.application_stats?.offered?.toString() || '0'],
			['Hired', data.application_stats?.hired?.toString() || '0'],
			['Rejected', data.application_stats?.rejected?.toString() || '0'],
			['Avg Time to Hire (days)', data.avg_time_to_hire?.toString() || '—'],
			['Conversion Rate', data.conversion_rate?.toString() || '—'],
			['Cost Per Hire', data.cost_per_hire?.toString() || '—'],
			['Quality of Hire', data.quality_of_hire?.toString() || '—'],
			['Offer Acceptance Rate', data.offer_acceptance_rate?.toString() || '—'],
		]

		const csv = [
			headers.join(','),
			...rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')),
		].join('\n')

		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
		const url = URL.createObjectURL(blob)
		const link = document.createElement('a')
		link.href = url
		link.download = `hiring-analytics-${new Date().toISOString().split('T')[0]}.csv`
		link.click()
		URL.revokeObjectURL(url)

		trackEvent('analytics_export', { timeRange })
	}
	const handlePrintPdf = () => {
		if (!data) return
		const printWindow = window.open('', '_blank')
		if (!printWindow) return

		const html = `
<!DOCTYPE html>
<html>
<head>
<title>Hiring Analytics Report</title>
<style>
body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; color: #1a1a1a; }
h1 { font-size: 24px; margin-bottom: 8px; }
.meta { color: #666; font-size: 14px; margin-bottom: 24px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e5e5e5; }
th { background: #f8f8f8; font-weight: 600; }
.metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
.metric-box { border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; text-align: center; }
.metric-value { font-size: 22px; font-weight: 700; }
.metric-label { font-size: 12px; color: #666; margin-top: 4px; }
.section { margin-bottom: 32px; }
.section h2 { font-size: 16px; margin-bottom: 12px; }
.bar { height: 8px; background: #eee; border-radius: 4px; overflow: hidden; margin-top: 4px; }
.bar-fill { height: 100%; background: #4f46e5; border-radius: 4px; }
@media print { body { padding: 0; } .no-print { display: none; } }
</style>
</head>
<body>
<h1>Hiring Analytics Report</h1>
<p class="meta">Generated on ${new Date().toLocaleString()} &middot; Time range: Last ${timeRange} days</p>

<div class="metric-grid">
<div class="metric-box"><div class="metric-value">${data.job_stats?.total_views?.toLocaleString() || 0}</div><div class="metric-label">Job Views</div></div>
<div class="metric-box"><div class="metric-value">${data.application_stats?.total_applications?.toLocaleString() || 0}</div><div class="metric-label">Applications</div></div>
<div class="metric-box"><div class="metric-value">${data.avg_time_to_hire || '—'}</div><div class="metric-label">Avg Days to Hire</div></div>
<div class="metric-box"><div class="metric-value">${data.application_stats?.hired?.toLocaleString() || 0}</div><div class="metric-label">Hired</div></div>
</div>

<div class="section">
<h2>Hiring Velocity</h2>
<table>
<thead><tr><th>Month</th><th>Applications</th><th>Interviews</th><th>Hired</th></tr></thead>
<tbody>
${(data.hiring_velocity || []).map(v => `<tr><td>${v.month}</td><td>${v.applications}</td><td>${v.interviews}</td><td>${v.hired}</td></tr>`).join('')}
</tbody>
</table>
</div>

<div class="section">
<h2>Source Breakdown</h2>
<table>
<thead><tr><th>Source</th><th>Count</th><th>Percentage</th></tr></thead>
<tbody>
${(data.source_breakdown || []).map(s => `<tr><td>${s.name}</td><td>${s.count}</td><td>${s.percentage}%</td></tr>`).join('')}
</tbody>
</table>
</div>

<div class="section">
<h2>Time to Hire by Stage</h2>
<table>
<thead><tr><th>Stage</th><th>Avg Days</th><th>Count</th></tr></thead>
<tbody>
${(data.time_to_hire_by_stage || []).map(s => `<tr><td>${s.stage}</td><td>${s.avg_days}</td><td>${s.count}</td></tr>`).join('')}
</tbody>
</table>
</div>

<div class="section">
<h2>OmniScore Distribution</h2>
<table>
<thead><tr><th>Range</th><th>Count</th></tr></thead>
<tbody>
<tr><td>900+ (Elite)</td><td>${data.score_distribution?.['900'] || 0}</td></tr>
<tr><td>800-899 (Excellent)</td><td>${data.score_distribution?.['800'] || 0}</td></tr>
<tr><td>700-799 (Good)</td><td>${data.score_distribution?.['700'] || 0}</td></tr>
<tr><td>600-699 (Average)</td><td>${data.score_distribution?.['600'] || 0}</td></tr>
<tr><td>&lt;600 (Below)</td><td>${data.score_distribution?.below || 0}</td></tr>
</tbody>
</table>
</div>

${data.time_to_hire_breakdown ? `
<div class="section">
<h2>Time-to-Hire Breakdown by Role</h2>
<table>
<thead><tr><th>Role</th><th>Avg Days</th><th>Hires</th></tr></thead>
<tbody>
${data.time_to_hire_breakdown.by_role.map(r => `<tr><td>${r.dimension}</td><td>${r.avg_days}</td><td>${r.count}</td></tr>`).join('')}
</tbody>
</table>
</div>
` : ''}

${data.diversity_pipeline_dropoff ? `
<div class="section">
<h2>Diversity Pipeline Drop-off (Gender)</h2>
<table>
<thead><tr><th>Gender</th><th>Applied</th><th>Screening</th><th>Interviewed</th><th>Offered</th><th>Hired</th></tr></thead>
<tbody>
${data.diversity_pipeline_dropoff.gender.map(g => {
  const counts = g.stages.reduce((acc, s) => { acc[s.stage] = s.count; return acc; }, {} as Record<string, number>);
  return `<tr><td>${g.group}</td><td>${counts.applied || 0}</td><td>${counts.screening || 0}</td><td>${counts.interviewed || 0}</td><td>${counts.offered || 0}</td><td>${counts.hired || 0}</td></tr>`;
}).join('')}
</tbody>
</table>
</div>
` : ''}

<div class="no-print" style="margin-top:40px;text-align:center;">
<button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer;">Print / Save as PDF</button>
</div>
</body>
</html>
`
		printWindow.document.write(html)
		printWindow.document.close()
		trackEvent('analytics_print_pdf', { timeRange })
	}


	return (
		<div className='space-y-6'>
			{/* Header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='font-heading text-2xl font-bold'>Hiring Analytics</h1>
					<p className='text-muted-foreground'>Track your recruitment performance and insights</p>
				</div>
				<div className='flex gap-2'>
					<select
						value={timeRange}
						onChange={(e) => setTimeRange(e.target.value)}
						className='h-11 min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
					>
						<option value='7'>Last 7 days</option>
						<option value='30'>Last 30 days</option>
						<option value='90'>Last 90 days</option>
						<option value='365'>Last year</option>
					</select>
					<Button variant='outline' size='sm' className='gap-1 min-h-[44px]' onClick={handleExport}>
						<Download className='h-4 w-4' />
						Export CSV
					</Button>
					<Button variant='outline' size='sm' className='gap-1 min-h-[44px]' onClick={handlePrintPdf}>
						<Printer className='h-4 w-4' />
						Print PDF
					</Button>
				</div>
			</div>

			{/* Error Banner */}
			{error && (
				<div className='rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3'>
					<XCircle className='h-5 w-5 text-red-600 shrink-0 mt-0.5' />
					<div className='flex-1'>
						<p className='text-sm font-medium text-red-800'>Failed to load analytics</p>
						<p className='text-sm text-red-600 mt-0.5'>{error}</p>
					</div>
					<Button
						variant='outline'
						size='sm'
						className='shrink-0'
						onClick={() => loadAnalytics()}
					>
						Retry
					</Button>
				</div>
			)}

			{/* Key Metrics Row */}
			<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
				<Card className='overflow-hidden'>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between mb-2'>
							<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100'>
								<Eye className='h-5 w-5 text-blue-600' />
							</div>
						</div>
						<p className='text-2xl font-bold'>{stats.jobViews.toLocaleString()}</p>
						<p className='text-xs text-muted-foreground'>Job Views</p>
					</CardContent>
				</Card>
				<Card className='overflow-hidden'>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between mb-2'>
							<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-green-100'>
								<FileText className='h-5 w-5 text-green-600' />
							</div>
						</div>
						<p className='text-2xl font-bold'>{stats.applications.toLocaleString()}</p>
						<p className='text-xs text-muted-foreground'>Applications</p>
					</CardContent>
				</Card>
				<Card className='overflow-hidden'>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between mb-2'>
							<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100'>
								<Target className='h-5 w-5 text-purple-600' />
							</div>
						</div>
						<p className='text-2xl font-bold'>{stats.conversionRate.toFixed(1)}%</p>
						<p className='text-xs text-muted-foreground'>Conversion Rate</p>
					</CardContent>
				</Card>
				<Card className='border-purple-200 bg-purple-50/50'>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between mb-2'>
							<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-purple-200'>
								<Clock className='h-5 w-5 text-purple-700' />
							</div>
						</div>
						<p className='text-2xl font-bold'>{stats.timeToHire || '—'}</p>
						<p className='text-xs text-muted-foreground'>Avg Days to Hire</p>
					</CardContent>
				</Card>
			</div>

			{/* Hiring Funnel */}
			<Card>
				<CardHeader className='pb-3'>
					<CardTitle className='text-lg flex items-center gap-2'>
						<Zap className='h-4 w-4 text-indigo-500' />
						Hiring Funnel
					</CardTitle>
				</CardHeader>
				<CardContent className='space-y-2'>
					{funnelData.map((step, index) => {
						const width = Math.max((step.value / maxFunnelValue) * 100, 5)
						const conversion = stageConversions[index]
						return (
							<div key={step.label} className='group'>
								<div className='flex items-center gap-3'>
									<span className='w-24 shrink-0 text-sm text-muted-foreground'>{step.label}</span>
									<div className='relative flex-1 h-8 rounded-md bg-muted overflow-hidden'>
										<div
											className={`h-full bg-gradient-to-r ${step.color} rounded-md transition-all duration-500 flex items-center px-3`}
											style={{ width: `${width}%` }}
										>
											<span className='text-sm font-semibold text-white'>
												{step.value.toLocaleString()}
											</span>
										</div>
									</div>
									{index > 0 && conversion !== '0.0' && (
										<span className='text-xs text-muted-foreground w-12 text-right'>
											{conversion}% ↓
										</span>
									)}
								</div>
							</div>
						)
					})}
				</CardContent>
			</Card>

			{/* Two-column grid: Velocity + Sources */}
			<div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
				{/* Hiring Velocity */}
				<Card>
					<CardHeader className='pb-3'>
						<CardTitle className='text-lg flex items-center gap-2'>
							<Activity className='h-4 w-4 text-indigo-500' />
							Hiring Velocity
						</CardTitle>
					</CardHeader>
					<CardContent className='space-y-3'>
						{velocityData.length > 0 ? (
							<>
								{velocityData.map((month) => (
									<div key={month.month} className='space-y-1'>
										<div className='flex items-center justify-between text-sm'>
											<span className='text-muted-foreground w-10'>{month.month}</span>
											<div className='flex-1 mx-3'>
												<div className='relative h-6 rounded-md bg-muted overflow-hidden'>
													<div
														className='absolute h-full bg-indigo-500 rounded-md transition-all duration-500 flex items-center px-2'
														style={{
															width: `${Math.max((month.applications / maxVelocity) * 100, 5)}%`,
														}}
													>
														<span className='text-[10px] font-semibold text-white'>
															{month.applications}
														</span>
													</div>
													<div
														className='absolute h-full bg-emerald-500 rounded-md transition-all duration-500 flex items-center justify-end px-2'
														style={{
															width: `${Math.max((month.hired / maxVelocity) * 100, 3)}%`,
															opacity: 0.8,
														}}
													>
														<span className='text-[10px] font-semibold text-white'>{month.hired}</span>
													</div>
												</div>
											</div>
											<span className='text-xs text-muted-foreground w-16 text-right'>
												{month.interviews} interviews
											</span>
										</div>
									</div>
								))}
									<div className='flex items-center gap-4 pt-2 text-xs text-muted-foreground'>
										<span className='flex items-center gap-1'>
											<div className='h-2 w-2 rounded bg-indigo-500' /> Applications
										</span>
										<span className='flex items-center gap-1'>
											<div className='h-2 w-2 rounded bg-emerald-500' /> Hired
										</span>
									</div>
								</>
							) : (
								<div className='text-center py-6 text-sm text-muted-foreground'>
									No velocity data available
								</div>
							)}
						</CardContent>
				</Card>

				{/* Application Sources */}
				<Card>
					<CardHeader className='pb-3'>
						<CardTitle className='text-lg flex items-center gap-2'>
							<MousePointer className='h-4 w-4 text-indigo-500' />
							Application Sources
						</CardTitle>
					</CardHeader>
					<CardContent className='space-y-4'>
						{sourceBreakdown.length > 0 ? (
							sourceBreakdown.map((source) => (
								<div key={source.name} className='space-y-1'>
									<div className='flex items-center justify-between text-sm'>
										<span className='text-muted-foreground'>{source.name}</span>
										<span className='text-sm font-medium'>
											{source.count} ({source.percentage}%)
										</span>
									</div>
									<div className='flex items-center gap-3'>
										<div className='flex-1 h-2 rounded-full bg-muted overflow-hidden'>
											<div
												className='h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500'
												style={{ width: `${source.percentage}%` }}
											/>
										</div>
									</div>
								</div>
							))
						) : (
							<div className='text-center py-6 text-sm text-muted-foreground'>
								No source data available
							</div>
							)}
					</CardContent>
				</Card>
			</div>

			{/* Two-column grid: Time by Stage + Top Jobs */}
			<div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
				{/* Time to Hire by Stage */}
				<Card>
					<CardHeader className='pb-3'>
						<CardTitle className='text-lg flex items-center gap-2'>
							<Timer className='h-4 w-4 text-indigo-500' />
							Time to Hire by Stage
						</CardTitle>
					</CardHeader>
					<CardContent className='space-y-3'>
						{timeByStage.length > 0 ? (
							timeByStage.map((stage) => (
								<div key={stage.stage}>
									<div className='flex items-center justify-between text-sm mb-1'>
										<span className='text-muted-foreground'>{stage.stage}</span>
										<span className='font-medium'>{stage.avg_days} days avg</span>
									</div>
									<div className='flex items-center gap-3'>
										<div className='flex-1 h-2 rounded-full bg-muted overflow-hidden'>
											<div
												className='h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-500'
												style={{ width: `${Math.min((stage.avg_days / 14) * 100, 100)}%` }}
											/>
										</div>
										<span className='text-xs text-muted-foreground w-10 text-right'>
											{stage.count}
										</span>
									</div>
								</div>
							))
						) : (
							<div className='text-center py-6 text-sm text-muted-foreground'>
								No time-to-hire data available
							</div>
							)}
					</CardContent>
				</Card>

				{/* Top Performing Jobs */}
				<Card>
					<CardHeader className='pb-3'>
						<CardTitle className='text-lg flex items-center gap-2'>
							<Award className='h-4 w-4 text-indigo-500' />
							Top Performing Jobs
						</CardTitle>
					</CardHeader>
					<CardContent>
						{!data?.jobs?.length ? (
							<EmptyState
								icon={BarChart}
								title='No job data yet'
								description='Post a job to see performance metrics and analytics.'
							/>
						) : (
							<div className='space-y-3'>
								{data.jobs.slice(0, 5).map((job) => (
									<div
										key={job.id}
										className='flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors'
									>
										<div className='min-w-0 flex-1'>
											<p className='truncate font-medium text-sm'>{job.title}</p>
											<Badge
												variant={
													job.status === 'active'
														? 'default'
														: job.status === 'paused'
															? 'secondary'
															: 'outline'
												}
												className='mt-1 text-[10px]'
											>
												{job.status}
											</Badge>
										</div>
										<div className='flex items-center gap-4 shrink-0'>
											<div className='text-center'>
												<p className='font-semibold text-sm'>{job.application_count || 0}</p>
												<p className='text-[10px] text-muted-foreground'>Apps</p>
											</div>
											<div className='text-center'>
												<p className='font-semibold text-sm'>{job.views || 0}</p>
												<p className='text-[10px] text-muted-foreground'>Views</p>
											</div>
										</div>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* OmniScore Distribution */}
			<Card>
				<CardHeader className='pb-3'>
					<CardTitle className='text-lg flex items-center gap-2'>
						<Star className='h-4 w-4 text-indigo-500' />
						Candidate Quality (OmniScore Distribution)
					</CardTitle>
				</CardHeader>
				<CardContent className='space-y-4'>
					{[
						{
							range: '900+',
							key: '900' as const,
							color: 'from-amber-400 to-amber-500',
							label: 'Elite',
						},
						{
							range: '800-899',
							key: '800' as const,
							color: 'from-indigo-500 to-indigo-600',
							label: 'Excellent',
						},
						{
							range: '700-799',
							key: '700' as const,
							color: 'from-emerald-500 to-emerald-600',
							label: 'Good',
						},
						{
							range: '600-699',
							key: '600' as const,
							color: 'from-blue-500 to-blue-600',
							label: 'Average',
						},
						{
							range: '<600',
							key: 'below' as const,
							color: 'from-slate-400 to-slate-500',
							label: 'Below',
						},
					].map(({ range, key, color, label }) => {
						const count = scoreDist[key] || 0
						const percentage = (count / totalScores) * 100
						return (
							<div key={key} className='flex items-center gap-3'>
								<span className='w-20 shrink-0 text-sm text-muted-foreground'>{range}</span>
								<div className='flex-1 h-6 rounded-md bg-muted overflow-hidden'>
									<div
										className={`h-full bg-gradient-to-r ${color} rounded-md transition-all duration-500 flex items-center justify-end px-2`}
										style={{ width: `${Math.max(percentage, 2)}%` }}
									>
										{percentage > 10 && (
											<span className='text-xs font-medium text-white'>
												{percentage.toFixed(0)}%
											</span>
										)}
									</div>
								</div>
								<span className='w-12 text-right text-sm font-semibold'>{count}</span>
								<Badge variant='outline' className='text-[10px] shrink-0'>
									{label}
								</Badge>
							</div>
						)
					})}
				</CardContent>
			</Card>

			{/* Two-column grid: Diversity + Rejection Reasons */}
			<div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
				{/* Diversity Metrics */}
				<Card>
					<CardHeader className='pb-3'>
						<CardTitle className='text-lg flex items-center gap-2'>
							<Users className='h-4 w-4 text-indigo-500' />
							Diversity Snapshot
						</CardTitle>
					</CardHeader>
					<CardContent className='space-y-5'>
						{diversityMetrics ? (
							<>
								{/* Gender */}
								<div className='space-y-2'>
									<p className='text-sm font-medium text-muted-foreground'>Gender</p>
									<div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
										{diversityMetrics.gender_distribution.map((item) => (
											<div key={item.label} className='rounded-lg border p-3'>
												<div className='flex items-center justify-between mb-1'>
													<span className='text-xs text-muted-foreground'>{item.label}</span>
													<span className='text-sm font-bold'>{item.percentage}%</span>
												</div>
												<div className='h-2 rounded-full bg-muted overflow-hidden'>
													<div
														className='h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500'
														style={{ width: `${item.percentage}%` }}
													/>
												</div>
											</div>
										))}
									</div>
								</div>
								{/* Ethnicity */}
								<div className='space-y-2'>
									<p className='text-sm font-medium text-muted-foreground'>Ethnicity</p>
									<div className='space-y-2'>
										{diversityMetrics.ethnicity_distribution.map((item) => (
											<div key={item.label} className='flex items-center gap-3'>
												<span className='w-24 shrink-0 text-xs text-muted-foreground'>
													{item.label}
												</span>
												<div className='flex-1 h-2 rounded-full bg-muted overflow-hidden'>
													<div
														className='h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-500'
														style={{ width: `${item.percentage}%` }}
													/>
												</div>
												<span className='text-xs font-semibold w-10 text-right'>
													{item.percentage}%
												</span>
											</div>
										))}
									</div>
								</div>
							</>
						) : (
							<div className='text-center py-6 text-sm text-muted-foreground'>
								No diversity data available
							</div>
							)}
					</CardContent>
				</Card>

				{/* Rejection Reason Analysis */}
				<Card>
					<CardHeader className='pb-3'>
						<CardTitle className='text-lg flex items-center gap-2'>
							<XCircle className='h-4 w-4 text-red-500' />
							Rejection Reasons
						</CardTitle>
					</CardHeader>
					<CardContent className='space-y-3'>
						{rejectionReasons.length > 0 ? (
							<>
								{rejectionReasons.map((item) => {
									const width = Math.max((item.count / maxRejectionCount) * 100, 5)
									return (
										<div key={item.reason}>
											<div className='flex items-center justify-between text-sm mb-1'>
												<span className='text-muted-foreground'>{item.reason}</span>
												<div className='flex items-center gap-2'>
													<span className='text-xs font-medium'>{item.count}</span>
													<span className='text-xs text-muted-foreground'>({item.percentage}%)</span>
													{item.trend !== undefined && (
														<Badge variant='outline' className='text-[10px] gap-0.5'>
															{item.trend > 0 ? (
																<ArrowUpRight className='h-3 w-3 text-red-500' />
															) : item.trend < 0 ? (
																<ArrowDownRight className='h-3 w-3 text-green-500' />
															) : (
																<Minus className='h-3 w-3 text-slate-400' />
															)}
															{Math.abs(item.trend)}%
														</Badge>
													)}
												</div>
											</div>
											<div className='flex items-center gap-3'>
												<div className='flex-1 h-2 rounded-full bg-muted overflow-hidden'>
													<div
														className='h-full bg-gradient-to-r from-red-400 to-red-500 rounded-full transition-all duration-500'
														style={{ width: `${width}%` }}
													/>
												</div>
											</div>
										</div>
									)
								})}
									<p className='text-xs text-muted-foreground pt-1'>
										Trend compares to previous period. ↓ = fewer rejections (good), ↑ = more rejections
										(investigate).
									</p>
								</>
							) : (
								<div className='text-center py-6 text-sm text-muted-foreground'>
									No rejection data available
								</div>
								)}
					</CardContent>
				</Card>
			</div>

			{/* Advanced Metrics (Pro tier) */}
			<Card className='border-indigo-200 bg-indigo-50/20'>
				<CardHeader className='pb-3'>
					<CardTitle className='text-lg flex items-center gap-2'>
						<BarChart3 className='h-4 w-4 text-indigo-500' />
						Advanced Metrics
						<Badge className='ml-2 text-[10px] bg-indigo-100 text-indigo-700'>Pro</Badge>
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className='grid gap-4 grid-cols-1 sm:grid-cols-3'>
						<div className='text-center p-4 rounded-lg bg-white/60 border border-indigo-100'>
							<p className='text-2xl font-bold'>
								{data?.cost_per_hire ? `$${data.cost_per_hire.toLocaleString()}` : '—'}
							</p>
							<p className='text-xs text-muted-foreground'>Cost per Hire</p>
						</div>
						<div className='text-center p-4 rounded-lg bg-white/60 border border-indigo-100'>
							<p className='text-2xl font-bold'>
								{data?.quality_of_hire ? `${data.quality_of_hire}/5` : '—'}
							</p>
							<p className='text-xs text-muted-foreground'>Quality of Hire</p>
						</div>
						<div className='text-center p-4 rounded-lg bg-white/60 border border-indigo-100'>
							<p className='text-2xl font-bold'>
								{data?.offer_acceptance_rate ? `${data.offer_acceptance_rate}%` : '—'}
							</p>
							<p className='text-xs text-muted-foreground'>Offer Acceptance</p>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Diversity Pipeline Drop-off */}
			{data?.diversity_pipeline_dropoff && (
				<Card>
					<CardHeader className='pb-3'>
						<CardTitle className='text-lg flex items-center gap-2'>
							<Users className='h-4 w-4 text-indigo-500' />
							Diversity Pipeline Drop-off
						</CardTitle>
					</CardHeader>
					<CardContent className='space-y-5'>
						{/* Gender */}
						<div className='space-y-2'>
							<p className='text-sm font-medium text-muted-foreground'>Gender</p>
							<div className='overflow-x-auto'>
								<table className='w-full text-sm'>
									<thead>
										<tr className='border-b'>
											<th className='text-left py-2 px-3 font-medium text-muted-foreground'>Gender</th>
											<th className='text-right py-2 px-3 font-medium text-muted-foreground'>Applied</th>
											<th className='text-right py-2 px-3 font-medium text-muted-foreground'>Screening</th>
											<th className='text-right py-2 px-3 font-medium text-muted-foreground'>Interviewed</th>
											<th className='text-right py-2 px-3 font-medium text-muted-foreground'>Offered</th>
											<th className='text-right py-2 px-3 font-medium text-muted-foreground'>Hired</th>
											<th className='text-right py-2 px-3 font-medium text-muted-foreground'>Drop-off</th>
										</tr>
									</thead>
									<tbody>
										{data.diversity_pipeline_dropoff.gender.map((g) => {
											const applied = g.stages.find((s) => s.stage === 'applied')?.count || 0
											const hired = g.stages.find((s) => s.stage === 'hired')?.count || 0
											const dropoff = applied > 0 ? Math.round(((applied - hired) / applied) * 100) : 0
											return (
												<tr key={g.group} className='border-b last:border-0'>
													<td className='py-2 px-3'>{g.group}</td>
													{g.stages.map((s) => (
														<td key={s.stage} className='text-right py-2 px-3'>{s.count}</td>
													))}
													<td className='text-right py-2 px-3 text-red-600 font-medium'>{dropoff}%</td>
												</tr>
											)
										})}
									</tbody>
								</table>
							</div>
						</div>
						{/* Ethnicity */}
						<div className='space-y-2'>
							<p className='text-sm font-medium text-muted-foreground'>Ethnicity</p>
							<div className='overflow-x-auto'>
								<table className='w-full text-sm'>
									<thead>
										<tr className='border-b'>
											<th className='text-left py-2 px-3 font-medium text-muted-foreground'>Ethnicity</th>
											<th className='text-right py-2 px-3 font-medium text-muted-foreground'>Applied</th>
											<th className='text-right py-2 px-3 font-medium text-muted-foreground'>Screening</th>
											<th className='text-right py-2 px-3 font-medium text-muted-foreground'>Interviewed</th>
											<th className='text-right py-2 px-3 font-medium text-muted-foreground'>Offered</th>
											<th className='text-right py-2 px-3 font-medium text-muted-foreground'>Hired</th>
											<th className='text-right py-2 px-3 font-medium text-muted-foreground'>Drop-off</th>
										</tr>
									</thead>
									<tbody>
										{data.diversity_pipeline_dropoff.ethnicity.map((g) => {
											const applied = g.stages.find((s) => s.stage === 'applied')?.count || 0
											const hired = g.stages.find((s) => s.stage === 'hired')?.count || 0
											const dropoff = applied > 0 ? Math.round(((applied - hired) / applied) * 100) : 0
											return (
												<tr key={g.group} className='border-b last:border-0'>
													<td className='py-2 px-3'>{g.group}</td>
													{g.stages.map((s) => (
														<td key={s.stage} className='text-right py-2 px-3'>{s.count}</td>
													))}
													<td className='text-right py-2 px-3 text-red-600 font-medium'>{dropoff}%</td>
												</tr>
											)
										})}
									</tbody>
								</table>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Time-to-Hire Breakdown */}
			{data?.time_to_hire_breakdown && (
				<div className='grid grid-cols-1 gap-6 lg:grid-cols-3'>
					<Card>
						<CardHeader className='pb-3'>
							<CardTitle className='text-lg flex items-center gap-2'>
								<Timer className='h-4 w-4 text-indigo-500' />
								By Role
							</CardTitle>
						</CardHeader>
						<CardContent>
							{data.time_to_hire_breakdown.by_role.length > 0 ? (
								<div className='space-y-3'>
									{data.time_to_hire_breakdown.by_role.map((r) => (
										<div key={r.dimension}>
											<div className='flex items-center justify-between text-sm mb-1'>
												<span className='text-muted-foreground truncate max-w-[60%]'>{r.dimension}</span>
												<span className='font-medium'>{r.avg_days} days</span>
											</div>
											<div className='flex items-center gap-3'>
												<div className='flex-1 h-2 rounded-full bg-muted overflow-hidden'>
													<div
														className='h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500'
														style={{ width: `${Math.min((parseFloat(r.avg_days) / 60) * 100, 100)}%` }}
													/>
												</div>
												<span className='text-xs text-muted-foreground w-10 text-right'>{r.count}</span>
											</div>
										</div>
									))}
								</div>
							) : (
								<div className='text-center py-6 text-sm text-muted-foreground'>No data available</div>
							)}
						</CardContent>
					</Card>
					<Card>
						<CardHeader className='pb-3'>
							<CardTitle className='text-lg flex items-center gap-2'>
								<MousePointer className='h-4 w-4 text-indigo-500' />
								By Source
							</CardTitle>
						</CardHeader>
						<CardContent>
							{data.time_to_hire_breakdown.by_source.length > 0 ? (
								<div className='space-y-3'>
									{data.time_to_hire_breakdown.by_source.map((r) => (
										<div key={r.dimension}>
											<div className='flex items-center justify-between text-sm mb-1'>
												<span className='text-muted-foreground'>{r.dimension}</span>
												<span className='font-medium'>{r.avg_days} days</span>
											</div>
											<div className='flex items-center gap-3'>
												<div className='flex-1 h-2 rounded-full bg-muted overflow-hidden'>
													<div
														className='h-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full transition-all duration-500'
														style={{ width: `${Math.min((parseFloat(r.avg_days) / 60) * 100, 100)}%` }}
													/>
												</div>
												<span className='text-xs text-muted-foreground w-10 text-right'>{r.count}</span>
											</div>
										</div>
									))}
								</div>
							) : (
								<div className='text-center py-6 text-sm text-muted-foreground'>No data available</div>
							)}
						</CardContent>
					</Card>
					<Card>
						<CardHeader className='pb-3'>
							<CardTitle className='text-lg flex items-center gap-2'>
								<Users className='h-4 w-4 text-indigo-500' />
								By Recruiter
							</CardTitle>
						</CardHeader>
						<CardContent>
							{data.time_to_hire_breakdown.by_recruiter.length > 0 ? (
								<div className='space-y-3'>
									{data.time_to_hire_breakdown.by_recruiter.map((r) => (
										<div key={r.dimension}>
											<div className='flex items-center justify-between text-sm mb-1'>
												<span className='text-muted-foreground'>{r.dimension}</span>
												<span className='font-medium'>{r.avg_days} days</span>
											</div>
											<div className='flex items-center gap-3'>
												<div className='flex-1 h-2 rounded-full bg-muted overflow-hidden'>
													<div
														className='h-full bg-gradient-to-r from-amber-500 to-amber-600 rounded-full transition-all duration-500'
														style={{ width: `${Math.min((parseFloat(r.avg_days) / 60) * 100, 100)}%` }}
													/>
												</div>
												<span className='text-xs text-muted-foreground w-10 text-right'>{r.count}</span>
											</div>
										</div>
									))}
								</div>
							) : (
								<div className='text-center py-6 text-sm text-muted-foreground'>No data available</div>
							)}
						</CardContent>
					</Card>
				</div>
			)}

		</div>
	)
}
