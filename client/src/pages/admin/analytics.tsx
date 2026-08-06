import {
	BarChart3,
	Briefcase,
	Eye,
	FileText,
	Inbox,
	Loader2,
	MessageSquare,
	Mic,
	MousePointer,
	TrendingUp,
	Users,
	Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { apiCall } from '@/lib/api'

// ─── Types ──────────────────────────────────────────────────────────────

interface AnalyticsData {
	daily_visitors: Array<{ date: string; visitors: number }>
	signup_funnel: {
		landing_views: number
		signup_clicks: number
		signup_page_views: number
		total_signups: number
		conversion_rate: number
		click_through_rate: number
	}
	feature_engagement: Array<{ event_type: string; count: number; unique_users: number }>
	page_views: Array<{ event_type: string; count: number; unique_visitors: number }>
}

const FEATURE_NAMES: Record<string, { icon: React.ElementType; label: string }> = {
	mock_interview_start: { icon: Mic, label: 'Mock Interviews' },
	job_post_created: { icon: FileText, label: 'Job Posts Created' },
	application_submitted: { icon: MessageSquare, label: 'Applications Submitted' },
	assessment_started: { icon: Briefcase, label: 'Assessments Started' },
}

const PAGE_NAMES: Record<string, { icon: React.ElementType; label: string }> = {
	page_view_landing: { icon: Eye, label: 'Landing Page' },
	page_view_signup: { icon: FileText, label: 'Sign-up Page' },
	page_view_login: { icon: FileText, label: 'Login Page' },
	page_view_dashboard: { icon: BarChart3, label: 'Dashboard' },
	page_view_recruiter_dashboard: { icon: Briefcase, label: 'Recruiter Dashboard' },
	page_view_candidate_dashboard: { icon: Users, label: 'Candidate Dashboard' },
	page_view_interview_practice: { icon: Mic, label: 'Interview Practice' },
	page_view_job_create: { icon: FileText, label: 'Create Job' },
}

// ─── Component ────────────────────────────────────────────────────────────

export function AdminAnalyticsPage() {
	const [data, setData] = useState<AnalyticsData | null>(null)
	const [loading, setLoading] = useState(true)
	const [startDate, setStartDate] = useState('')
	const [endDate, setEndDate] = useState('')

	const loadAnalytics = useCallback(async () => {
		try {
			setLoading(true)
			const res = await apiCall<{ success: boolean; data: AnalyticsData }>(
				`/analytics/dashboard?start_date=${startDate}&end_date=${endDate}`,
			)
			if (res.success) {
				setData(res.data)
			}
		} catch (err) {
			console.error('Failed to load analytics:', err)
		} finally {
			setLoading(false)
		}
	}, [startDate, endDate])

	useEffect(() => {
		const end = new Date()
		const start = new Date()
		start.setDate(start.getDate() - 30)
		setEndDate(end.toISOString().split('T')[0])
		setStartDate(start.toISOString().split('T')[0])
	}, [])

	useEffect(() => {
		if (startDate && endDate) {
			loadAnalytics()
		}
	}, [startDate, endDate, loadAnalytics])

	const totalVisitors =
		data?.daily_visitors.reduce((sum, d) => sum + (parseInt(String(d.visitors), 10) || 0), 0) || 0
	const maxVisitors = Math.max(
		...(data?.daily_visitors.map((d) => parseInt(String(d.visitors), 10) || 0) || [0]),
	)
	const funnel = data?.signup_funnel

	return (
		<div className='min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-6 md:p-10'>
			<div className='max-w-7xl mx-auto space-y-8'>
				{/* Header */}
				<div className='space-y-2'>
					<h1 className='text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent'>
						Analytics Dashboard
					</h1>
					<p className='text-slate-400'>Track landing page performance and user engagement</p>
				</div>

				{/* Date Filter */}
				<div className='flex flex-wrap items-center gap-3'>
					<span className='text-sm text-slate-400'>Date Range:</span>
					<Input
						type='date'
						value={startDate}
						onChange={(e) => setStartDate(e.target.value)}
						className='w-auto bg-white/5 border-white/10 text-white'
					/>
					<span className='text-sm text-slate-400'>to</span>
					<Input
						type='date'
						value={endDate}
						onChange={(e) => setEndDate(e.target.value)}
						className='w-auto bg-white/5 border-white/10 text-white'
					/>
					<Button
						onClick={loadAnalytics}
						className='bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-400 hover:to-indigo-400'
					>
						Apply
					</Button>
				</div>

				{loading ? (
					<div className='flex justify-center py-20'>
						<Loader2 className='h-10 w-10 animate-spin text-slate-500' />
					</div>
				) : !data ? (
					<div className='text-center py-20 text-slate-400'>Failed to load analytics</div>
				) : (
					<>
						{/* Key Metrics */}
						<div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5'>
							{[
								{
									label: 'Daily Visitors',
									value: totalVisitors.toLocaleString(),
									sub: 'Last 30 days',
									icon: Eye,
								},
								{
									label: 'Total Sign-ups',
									value: (funnel?.total_signups || 0).toLocaleString(),
									sub: 'Candidates + Recruiters',
									icon: Users,
								},
								{
									label: 'Conversion Rate',
									value: `${funnel?.conversion_rate || 0}%`,
									sub: 'Landing → Sign-up',
									icon: TrendingUp,
								},
								{
									label: 'Click-Through Rate',
									value: `${funnel?.click_through_rate || 0}%`,
									sub: 'Landing → CTA Click',
									icon: MousePointer,
								},
							].map((metric) => (
								<Card
									key={metric.label}
									className='bg-white/5 border-white/10 hover:bg-white/8 transition-colors'
								>
									<CardContent className='p-6'>
										<div className='text-xs uppercase tracking-wider text-slate-400 mb-2'>
											{metric.label}
										</div>
										<div className='text-3xl font-bold'>{metric.value}</div>
										<div className='text-sm text-emerald-400 mt-1'>{metric.sub}</div>
									</CardContent>
								</Card>
							))}
						</div>

						{/* Sign-up Funnel */}
						<Card className='bg-white/5 border-white/10'>
							<CardContent className='p-6'>
								<h2 className='text-xl font-semibold flex items-center gap-2 mb-6'>
									<TrendingUp className='h-5 w-5 text-violet-400' />
									Sign-up Funnel
								</h2>
								<div className='space-y-4'>
									{[
										{
											label: 'Landing Page Views',
											value: funnel?.landing_views || 0,
											width: 100,
											opacity: 1,
										},
										{
											label: 'Sign-up Clicks',
											value: funnel?.signup_clicks || 0,
											width: 80,
											opacity: 0.9,
										},
										{
											label: 'Sign-up Page Views',
											value: funnel?.signup_page_views || 0,
											width: 60,
											opacity: 0.8,
										},
										{
											label: 'Sign-ups Completed',
											value: funnel?.total_signups || 0,
											width: 40,
											opacity: 0.7,
										},
									].map((step) => (
										<div key={step.label} className='flex items-center gap-4'>
											<div
												className='flex-1 h-12 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-500 flex items-center justify-between px-5 transition-all hover:opacity-90'
												style={{ width: `${step.width}%`, opacity: step.opacity }}
											>
												<span className='font-semibold text-sm'>{step.label}</span>
												<span className='font-bold'>{step.value}</span>
											</div>
										</div>
									))}
								</div>
							</CardContent>
						</Card>

						{/* Daily Visitors Chart */}
						<Card className='bg-white/5 border-white/10'>
							<CardContent className='p-6'>
								<h2 className='text-xl font-semibold flex items-center gap-2 mb-6'>
									<BarChart3 className='h-5 w-5 text-violet-400' />
									Daily Visitors (Last 30 Days)
								</h2>
								<div className='h-72 flex items-end gap-2 overflow-x-auto pb-6'>
									{data.daily_visitors.length === 0 ? (
										<div className='flex flex-col items-center justify-center w-full h-full text-center'>
											<Inbox className='h-12 w-12 text-slate-400 mb-4' />
											<h3 className='text-lg font-medium text-slate-300'>No visitor data yet</h3>
											<p className='text-sm text-slate-500 mt-1'>
												Visitor data will appear here as users visit the site.
											</p>
										</div>
									) : (
										data.daily_visitors.map((day) => {
											const visitors = parseInt(String(day.visitors), 10) || 0
											const height =
												maxVisitors > 0 ? Math.max((visitors / maxVisitors) * 100, 5) : 0
											return (
												<div
													key={day.date}
													className='flex-1 min-w-[40px] flex flex-col items-center'
												>
													<div className='text-xs font-semibold text-white mb-1'>{visitors}</div>
													<div
														className='w-full bg-gradient-to-t from-violet-500 to-indigo-500 rounded-t-md transition-opacity hover:opacity-80'
														style={{ height: `${height}%` }}
													/>
													<div className='text-[10px] text-slate-400 mt-1 whitespace-nowrap'>
														{new Date(day.date).toLocaleDateString('en-US', {
															month: 'short',
															day: 'numeric',
														})}
													</div>
												</div>
											)
										})
									)}
								</div>
							</CardContent>
						</Card>

						{/* Feature Engagement */}
						<Card className='bg-white/5 border-white/10'>
							<CardContent className='p-6'>
								<h2 className='text-xl font-semibold flex items-center gap-2 mb-4'>
									<Zap className='h-5 w-5 text-violet-400' />
									Feature Engagement
								</h2>
								<div className='overflow-x-auto'>
									<table className='w-full'>
										<thead>
											<tr className='border-b border-white/10'>
												<th className='text-left py-3 px-4 text-xs uppercase tracking-wider text-slate-400 font-semibold'>
													Feature
												</th>
												<th className='text-left py-3 px-4 text-xs uppercase tracking-wider text-slate-400 font-semibold'>
													Total Uses
												</th>
												<th className='text-left py-3 px-4 text-xs uppercase tracking-wider text-slate-400 font-semibold'>
													Unique Users
												</th>
											</tr>
										</thead>
										<tbody>
											{data.feature_engagement.length === 0 ? (
												<tr>
													<td colSpan={3} className='py-12'>
														<div className='flex flex-col items-center justify-center text-center'>
															<Inbox className='h-12 w-12 text-slate-400 mb-4' />
															<h3 className='text-lg font-medium text-slate-300'>
																No feature engagement yet
															</h3>
															<p className='text-sm text-slate-500 mt-1'>
																Feature usage data will appear as users interact with the platform.
															</p>
														</div>
													</td>
												</tr>
											) : (
												data.feature_engagement.map((feature) => {
													const meta = FEATURE_NAMES[feature.event_type] || {
														icon: FileText,
														label: feature.event_type,
													}
													return (
														<tr
															key={feature.event_type}
															className='border-b border-white/5 hover:bg-white/5'
														>
															<td className='py-4 px-4'>
																<div className='flex items-center gap-2'>
																	<meta.icon className='h-4 w-4 text-slate-400' />
																	<span className='text-sm'>{meta.label}</span>
																</div>
															</td>
															<td className='py-4 px-4 text-sm font-medium'>{feature.count}</td>
															<td className='py-4 px-4 text-sm text-slate-400'>
																{feature.unique_users || 0}
															</td>
														</tr>
													)
												})
											)}
										</tbody>
									</table>
								</div>
							</CardContent>
						</Card>

						{/* Page Views */}
						<Card className='bg-white/5 border-white/10'>
							<CardContent className='p-6'>
								<h2 className='text-xl font-semibold flex items-center gap-2 mb-4'>
									<Eye className='h-5 w-5 text-violet-400' />
									Page Views
								</h2>
								<div className='overflow-x-auto'>
									<table className='w-full'>
										<thead>
											<tr className='border-b border-white/10'>
												<th className='text-left py-3 px-4 text-xs uppercase tracking-wider text-slate-400 font-semibold'>
													Page
												</th>
												<th className='text-left py-3 px-4 text-xs uppercase tracking-wider text-slate-400 font-semibold'>
													Total Views
												</th>
												<th className='text-left py-3 px-4 text-xs uppercase tracking-wider text-slate-400 font-semibold'>
													Unique Visitors
												</th>
											</tr>
										</thead>
										<tbody>
											{data.page_views.length === 0 ? (
												<tr>
													<td colSpan={3} className='py-12'>
														<div className='flex flex-col items-center justify-center text-center'>
															<Inbox className='h-12 w-12 text-slate-400 mb-4' />
															<h3 className='text-lg font-medium text-slate-300'>
																No page views yet
															</h3>
															<p className='text-sm text-slate-500 mt-1'>
																Page view data will appear as users navigate the platform.
															</p>
														</div>
													</td>
												</tr>
											) : (
												data.page_views.map((page) => {
													const meta = PAGE_NAMES[page.event_type] || {
														icon: FileText,
														label: page.event_type,
													}
													return (
														<tr
															key={page.event_type}
															className='border-b border-white/5 hover:bg-white/5'
														>
															<td className='py-4 px-4'>
																<div className='flex items-center gap-2'>
																	<meta.icon className='h-4 w-4 text-slate-400' />
																	<span className='text-sm'>{meta.label}</span>
																</div>
															</td>
															<td className='py-4 px-4 text-sm font-medium'>{page.count}</td>
															<td className='py-4 px-4 text-sm text-slate-400'>
																{page.unique_visitors}
															</td>
														</tr>
													)
												})
											)}
										</tbody>
									</table>
								</div>
							</CardContent>
						</Card>
					</>
				)}
			</div>
		</div>
	)
}
