import {
	ArrowLeft,
	BarChart3,
	Calendar,
	CheckCircle2,
	Clock,
	Download,
	FileText,
	Inbox,
	Search,
	Shield,
	TrendingUp,
	User,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface BiasReport {
	id: number
	date: string
	score: number
	status: 'pass' | 'warning' | 'fail'
	factors: string[]
}

interface AuditLog {
	id: number
	timestamp: string
	user: string
	action: string
	target: string
	ip: string
	status: 'success' | 'failed' | 'warning'
}

interface GDPRRequest {
	id: number
	user: string
	type: 'export' | 'delete'
	status: 'pending' | 'processing' | 'completed' | 'rejected'
	date: string
}

export function ComplianceDashboardPage() {
	const [activeTab, setActiveTab] = useState('overview')
	const [searchQuery, setSearchQuery] = useState('')

	const [biasReports] = useState<BiasReport[]>([
		{
			id: 1,
			date: '2026-06-05',
			score: 95,
			status: 'pass',
			factors: ['Gender parity', 'Age distribution'],
		},
		{
			id: 2,
			date: '2026-06-01',
			score: 78,
			status: 'warning',
			factors: ['Geographic bias detected'],
		},
		{
			id: 3,
			date: '2026-05-28',
			score: 92,
			status: 'pass',
			factors: ['Ethnicity balance', 'Experience equity'],
		},
	])

	const [auditLogs] = useState<AuditLog[]>([
		{
			id: 1,
			timestamp: '2026-06-06T10:30:00Z',
			user: 'admin@rekrut.ai',
			action: 'USER_EXPORT',
			target: 'User #1234',
			ip: '192.168.1.1',
			status: 'success',
		},
		{
			id: 2,
			timestamp: '2026-06-06T09:15:00Z',
			user: 'admin@rekrut.ai',
			action: 'POLICY_UPDATE',
			target: 'Data Retention',
			ip: '192.168.1.1',
			status: 'success',
		},
		{
			id: 3,
			timestamp: '2026-06-05T16:45:00Z',
			user: 'system',
			action: 'AUTO_DELETE',
			target: 'Expired logs',
			ip: 'internal',
			status: 'success',
		},
	])

	const [gdprRequests] = useState<GDPRRequest[]>([
		{ id: 1, user: 'alex@example.com', type: 'export', status: 'completed', date: '2026-06-05' },
		{ id: 2, user: 'sarah@example.com', type: 'delete', status: 'processing', date: '2026-06-04' },
		{ id: 3, user: 'mike@example.com', type: 'export', status: 'pending', date: '2026-06-06' },
	])

	const getStatusColor = (status: string) => {
		switch (status) {
			case 'pass':
			case 'success':
			case 'completed':
				return 'bg-green-500/20 text-green-400'
			case 'warning':
			case 'pending':
			case 'processing':
				return 'bg-yellow-500/20 text-yellow-400'
			case 'fail':
			case 'failed':
			case 'rejected':
				return 'bg-red-500/20 text-red-400'
			default:
				return 'bg-gray-500/20 text-gray-400'
		}
	}

	const formatDate = (date: string) => {
		return new Date(date).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		})
	}

	return (
		<div className='min-h-screen bg-gray-50'>
			<div className='max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-8'>
				<div className='mb-6'>
					<Link
						to='/recruiter'
						className='text-gray-600 hover:text-gray-900 flex items-center gap-2 mb-4'
					>
						<ArrowLeft className='w-4 h-4' />
						Back to Dashboard
					</Link>
					<div className='flex items-center justify-between'>
						<div>
							<h1 className='text-2xl sm:text-2xl sm:text-2xl sm:text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3'>
								<Shield className='w-8 h-8 text-indigo-600' />
								Compliance Dashboard
							</h1>
							<p className='text-gray-600 mt-1'>
								Monitor bias detection, audit logs, and GDPR compliance
							</p>
						</div>
						<Badge className='bg-indigo-100 text-indigo-700'>
							<CheckCircle2 className='w-3 h-3 mr-1' />
							Compliant
						</Badge>
					</div>
				</div>

				<Tabs value={activeTab} onValueChange={setActiveTab}>
					<TabsList className='grid w-full grid-cols-4 mb-8'>
						<TabsTrigger value='overview'>Overview</TabsTrigger>
						<TabsTrigger value='bias'>Bias Detection</TabsTrigger>
						<TabsTrigger value='audit'>Audit Logs</TabsTrigger>
						<TabsTrigger value='gdpr'>GDPR</TabsTrigger>
					</TabsList>

					<TabsContent value='overview'>
						<div className='grid grid-cols-1 md:grid-cols-3 gap-6 mb-8'>
							<Card>
								<CardContent className='pt-6'>
									<div className='flex items-center gap-4'>
										<div className='w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center'>
											<BarChart3 className='w-6 h-6 text-green-600' />
										</div>
										<div>
											<p className='text-2xl sm:text-2xl sm:text-2xl sm:text-3xl font-bold text-gray-900'>
												88.5
											</p>
											<p className='text-sm text-gray-600'>Average Bias Score</p>
										</div>
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardContent className='pt-6'>
									<div className='flex items-center gap-4'>
										<div className='w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center'>
											<FileText className='w-6 h-6 text-blue-600' />
										</div>
										<div>
											<p className='text-2xl sm:text-2xl sm:text-2xl sm:text-3xl font-bold text-gray-900'>
												1,247
											</p>
											<p className='text-sm text-gray-600'>Audit Logs (30 days)</p>
										</div>
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardContent className='pt-6'>
									<div className='flex items-center gap-4'>
										<div className='w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center'>
											<User className='w-6 h-6 text-purple-600' />
										</div>
										<div>
											<p className='text-2xl sm:text-2xl sm:text-2xl sm:text-3xl font-bold text-gray-900'>
												23
											</p>
											<p className='text-sm text-gray-600'>GDPR Requests (30 days)</p>
										</div>
									</div>
								</CardContent>
							</Card>
						</div>

						<div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
							<Card>
								<CardHeader>
									<CardTitle className='flex items-center gap-2'>
										<TrendingUp className='w-5 h-5 text-green-600' />
										Recent Bias Reports
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className='space-y-3'>
										{biasReports.slice(0, 3).map((report) => (
											<div
												key={report.id}
												className='flex items-center justify-between p-3 bg-gray-50 rounded-lg'
											>
												<div>
													<p className='font-medium text-gray-900'>Report #{report.id}</p>
													<p className='text-sm text-gray-600'>{formatDate(report.date)}</p>
												</div>
												<div className='flex items-center gap-3'>
													<span className='text-lg font-bold text-gray-900'>{report.score}</span>
													<Badge className={getStatusColor(report.status)}>{report.status}</Badge>
												</div>
											</div>
										))}
									</div>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle className='flex items-center gap-2'>
										<Clock className='w-5 h-5 text-blue-600' />
										Recent Audit Activity
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className='space-y-3'>
										{auditLogs.slice(0, 3).map((log) => (
											<div
												key={log.id}
												className='flex items-center justify-between p-3 bg-gray-50 rounded-lg'
											>
												<div>
													<p className='font-medium text-gray-900'>{log.action}</p>
													<p className='text-sm text-gray-600'>
														{log.user} • {log.target}
													</p>
												</div>
												<Badge className={getStatusColor(log.status)}>{log.status}</Badge>
											</div>
										))}
									</div>
								</CardContent>
							</Card>
						</div>
					</TabsContent>

					<TabsContent value='bias'>
						<Card>
							<CardHeader>
								<CardTitle>Bias Detection Reports</CardTitle>
							</CardHeader>
							<CardContent>
								<div className='space-y-4'>
									{biasReports.length === 0 ? (
										<div className='flex flex-col items-center justify-center py-12 text-center'>
											<Inbox className='h-12 w-12 text-slate-300 mb-4' />
											<h3 className='text-lg font-medium text-slate-700'>No bias reports yet</h3>
											<p className='text-sm text-slate-500 mt-1'>
												Bias detection reports will appear here once generated.
											</p>
										</div>
									) : (
										biasReports.map((report) => (
											<div key={report.id} className='p-4 border rounded-lg'>
												<div className='flex items-center justify-between mb-3'>
													<div>
														<p className='font-medium text-gray-900'>Report #{report.id}</p>
														<p className='text-sm text-gray-600'>{formatDate(report.date)}</p>
													</div>
													<Badge className={getStatusColor(report.status)}>{report.status}</Badge>
												</div>
												<div className='flex items-center gap-2 mb-3'>
													<span className='text-2xl font-bold text-gray-900'>{report.score}</span>
													<span className='text-sm text-gray-600'>/ 100</span>
												</div>
												<div className='flex flex-wrap gap-2'>
													{report.factors.map((factor, idx) => (
														<Badge key={idx} variant='outline' className='text-xs'>
															{factor}
														</Badge>
													))}
												</div>
											</div>
										))
									)}
								</div>
							</CardContent>
						</Card>
					</TabsContent>

					<TabsContent value='audit'>
						<Card>
							<CardHeader>
								<div className='flex items-center justify-between'>
									<CardTitle>Audit Logs</CardTitle>
									<Button variant='outline' size='sm'>
										<Download className='w-4 h-4 mr-2' />
										Export
									</Button>
								</div>
							</CardHeader>
							<CardContent>
								<div className='relative mb-4'>
									<Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400' />
									<Input
										placeholder='Search audit logs...'
										value={searchQuery}
										onChange={(e) => setSearchQuery(e.target.value)}
										className='pl-10'
									/>
								</div>
								<div className='space-y-3'>
									{auditLogs.filter(
										(log) =>
											log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
											log.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
											log.target.toLowerCase().includes(searchQuery.toLowerCase()),
									).length === 0 ? (
										<div className='flex flex-col items-center justify-center py-12 text-center'>
											<Inbox className='h-12 w-12 text-slate-300 mb-4' />
											<h3 className='text-lg font-medium text-slate-700'>No audit logs found</h3>
											<p className='text-sm text-slate-500 mt-1'>
												Try adjusting your search or check back later.
											</p>
										</div>
									) : (
										auditLogs
											.filter(
												(log) =>
													log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
													log.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
													log.target.toLowerCase().includes(searchQuery.toLowerCase()),
											)
											.map((log) => (
												<div key={log.id} className='p-4 border rounded-lg'>
													<div className='flex items-center justify-between mb-2'>
														<p className='font-medium text-gray-900'>{log.action}</p>
														<Badge className={getStatusColor(log.status)}>{log.status}</Badge>
													</div>
													<div className='grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-gray-600'>
														<span className='flex items-center gap-1'>
															<User className='w-3 h-3' />
															{log.user}
														</span>
														<span className='flex items-center gap-1'>
															<FileText className='w-3 h-3' />
															{log.target}
														</span>
														<span className='flex items-center gap-1'>
															<Calendar className='w-3 h-3' />
															{formatDate(log.timestamp)}
														</span>
														<span className='font-mono'>{log.ip}</span>
													</div>
												</div>
											))
									)}
								</div>
							</CardContent>
						</Card>
					</TabsContent>

					<TabsContent value='gdpr'>
						<Card>
							<CardHeader>
								<CardTitle>GDPR Requests</CardTitle>
							</CardHeader>
							<CardContent>
								<div className='space-y-4'>
									{gdprRequests.length === 0 ? (
										<div className='flex flex-col items-center justify-center py-12 text-center'>
											<Inbox className='h-12 w-12 text-slate-300 mb-4' />
											<h3 className='text-lg font-medium text-slate-700'>No GDPR requests yet</h3>
											<p className='text-sm text-slate-500 mt-1'>
												GDPR requests will appear here when users submit them.
											</p>
										</div>
									) : (
										gdprRequests.map((request) => (
											<div key={request.id} className='p-4 border rounded-lg'>
												<div className='flex items-center justify-between mb-3'>
													<div className='flex items-center gap-3'>
														<div className='w-10 h-10 bg-indigo-500/20 rounded-full flex items-center justify-center'>
															<User className='w-5 h-5 text-indigo-600' />
														</div>
														<div>
															<p className='font-medium text-gray-900'>{request.user}</p>
															<p className='text-sm text-gray-600'>{formatDate(request.date)}</p>
														</div>
													</div>
													<Badge className={getStatusColor(request.status)}>{request.status}</Badge>
												</div>
												<div className='flex items-center justify-between'>
													<Badge variant='outline'>
														{request.type === 'export' ? 'Data Export' : 'Right to be Forgotten'}
													</Badge>
													<Button variant='outline' size='sm'>
														<FileText className='w-4 h-4 mr-2' />
														View Details
													</Button>
												</div>
											</div>
										))
									)}
								</div>
							</CardContent>
						</Card>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	)
}
