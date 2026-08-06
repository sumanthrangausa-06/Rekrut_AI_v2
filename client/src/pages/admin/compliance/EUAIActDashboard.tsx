import {
	Activity,
	AlertTriangle,
	Ban,
	BarChart3,
	BookOpen,
	BrainCircuit,
	CheckCircle,
	ChevronDown,
	ChevronUp,
	Clock,
	Cookie,
	Database,
	Download,
	Eye,
	FileCheck,
	FileEdit,
	FileSearch,
	FileSpreadsheet,
	FileText,
	Fingerprint,
	GitPullRequest,
	Globe,
	HardDrive,
	ListChecks,
	Lock,
	MousePointerClick,
	ScrollText,
	Settings,
	Share2,
	Shield,
	ShieldAlert,
	ShieldCheck,
	ToggleLeft,
	ToggleRight,
	Trash2,
	TrendingDown,
	TrendingUp,
	Unlock,
	Users,
	UserX,
	XCircle,
} from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { ChartCard } from '@/components/domain/chart-card'
import { EmptyState } from '@/components/domain/empty-state'
import { Skeleton } from '@/components/domain/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { trackEvent } from '@/lib/analytics'
import { apiCall } from '@/lib/api'

export type ComplianceDecision = {
	id: string
	timestamp: string
	decisionType: 'screening' | 'matching' | 'interview' | 'assessment' | 'offer' | 'scoring'
	candidateId: string
	candidateName: string
	jobId?: string
	jobTitle?: string
	aiModel: string
	confidence: number
	decision: string
	explanation: string
	humanReviewed: boolean
	humanReviewer?: string
	humanOverride?: boolean
	biasFlags: string[]
	dataRetention: string
	auditHash: string
}

export type BiasReport = {
	id: string
	period: string
	totalDecisions: number
	biasFlagsFound: number
	falsePositiveRate: number
	falseNegativeRate: number
	demographicBreakdown: Array<{
		demographic: string
		total: number
		positiveRate: number
		biasFlag: boolean
	}>
	topConcerns: string[]
	improvements: string[]
}

export type RiskClassification = {
	category: string
	level: 'high' | 'limited' | 'minimal'
	description: string
	measures: string[]
	lastReviewed: string
	nextReview: string
}

export type ExplainabilityLog = {
	id: string
	timestamp: string
	actionType: string
	adminUser: { id: number; name: string }
	candidate: { id: number; name: string }
	targetType: string
	explanationType: string
	summary: string
	modelVersion: string
	confidence: number
	viewedFromIp: string
}

export type HumanOverride = {
	id: string
	timestamp: string
	overriddenBy: { id: number; name: string }
	candidate: { id: number; name: string }
	originalDecision: string
	overrideDecision: string
	overrideReason: string
	jobTitle: string
	aiModel: string
	aiConfidence: number
	overrideFromIp: string
}

export type RiskChecklistItem = {
	id: string
	category: string
	item: string
	required: boolean
	status: 'complete' | 'incomplete' | 'pending' | 'in_progress'
	evidence: string
	eu_ai_act_ref: string
	lastVerified: string
}

export type RiskChecklistSummary = {
	total: number
	completed: number
	pending: number
	incomplete: number
	inProgress: number
	complianceScore: number
	overallStatus: string
	nextReview: string
}

export type DataProcessingActivity = {
	id: string
	category: string
	purpose: string
	legalBasis: string
	dataTypes: string[]
	retentionPeriod: string
	thirdParties: string[]
	crossBorder: boolean
	status: 'active' | 'paused' | 'under_review'
	lastUpdated: string
	description: string
}

export type DataSubjectRequest = {
	id: string
	timestamp: string
	candidateId: string
	candidateName: string
	requestType: 'access' | 'rectification' | 'erasure' | 'portability' | 'explanation' | 'appeal'
	status: 'pending' | 'in_progress' | 'completed' | 'rejected'
	description: string
	handledBy?: string
	completedAt?: string
	responseDeadline: string
}

export type ConsentRecord = {
	id: string
	timestamp: string
	candidateId: string
	candidateName: string
	consentType: 'necessary' | 'analytics' | 'marketing' | 'functional'
	status: 'granted' | 'denied' | 'withdrawn'
	ipAddress: string
	userAgent: string
	geographicRegion: string
}

export type ConsentSummary = {
	totalConsents: number
	grantedRate: number
	withdrawnRate: number
	byType: Record<string, number>
	byRegion: Record<string, number>
}

export type OverrideSummary = {
	totalOverrides: number
	uniqueRecruiters: number
	uniqueCandidates: number
	avgAiConfidence: number
}

const decisionTypeConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> =
	{
		screening: {
			icon: <Shield className='h-4 w-4' />,
			color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
			label: 'Screening',
		},
		matching: {
			icon: <Users className='h-4 w-4' />,
			color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
			label: 'Matching',
		},
		interview: {
			icon: <BrainCircuit className='h-4 w-4' />,
			color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
			label: 'Interview',
		},
		assessment: {
			icon: <FileText className='h-4 w-4' />,
			color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
			label: 'Assessment',
		},
		offer: {
			icon: <CheckCircle className='h-4 w-4' />,
			color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
			label: 'Offer',
		},
		scoring: {
			icon: <TrendingUp className='h-4 w-4' />,
			color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
			label: 'Scoring',
		},
	}

const riskConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
	high: {
		color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
		icon: <ShieldAlert className='h-4 w-4' />,
		label: 'High Risk',
	},
	limited: {
		color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
		icon: <Shield className='h-4 w-4' />,
		label: 'Limited Risk',
	},
	minimal: {
		color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
		icon: <ShieldCheck className='h-4 w-4' />,
		label: 'Minimal Risk',
	},
}

export function EUAIActDashboard() {
	const [decisions, setDecisions] = useState<ComplianceDecision[]>([])
	const [biasReport, setBiasReport] = useState<BiasReport | null>(null)
	const [riskClasses, setRiskClasses] = useState<RiskClassification[]>([])
	const [explanations, setExplanations] = useState<ExplainabilityLog[]>([])
	const [overrides, setOverrides] = useState<HumanOverride[]>([])
	const [overrideSummary, setOverrideSummary] = useState<OverrideSummary | null>(null)
	const [riskChecklist, setRiskChecklist] = useState<RiskChecklistItem[]>([])
	const [riskChecklistSummary, setRiskChecklistSummary] = useState<RiskChecklistSummary | null>(
		null,
	)
	const [dataProcessing, setDataProcessing] = useState<DataProcessingActivity[]>([])
	const [dataRequests, setDataRequests] = useState<DataSubjectRequest[]>([])
	const [consentRecords, setConsentRecords] = useState<ConsentRecord[]>([])
	const [consentSummary, setConsentSummary] = useState<ConsentSummary | null>(null)
	const [loading, setLoading] = useState(true)
	const [selectedTab, setSelectedTab] = useState('audit')
	const [expandedDecision, setExpandedDecision] = useState<string | null>(null)
	const [exporting, setExporting] = useState(false)

	useEffect(() => {
		async function loadCompliance() {
			setLoading(true)
			try {
				const [
					decisionsData,
					biasData,
					riskData,
					explanationsData,
					overridesData,
					checklistData,
					processingData,
					requestsData,
					consentData,
				] = await Promise.all([
					apiCall<{ decisions: ComplianceDecision[] }>('/admin/compliance/decisions'),
					apiCall<{ report: BiasReport }>('/admin/compliance/bias-report').catch(() => ({
						report: null,
					})),
					apiCall<{ classifications: RiskClassification[] }>(
						'/admin/compliance/risk-classifications',
					).catch(() => ({ classifications: [] })),
					apiCall<{ explanations: ExplainabilityLog[] }>('/admin/compliance/explanations').catch(
						() => ({ explanations: [] }),
					),
					apiCall<{ overrides: HumanOverride[]; summary: OverrideSummary }>(
						'/admin/compliance/overrides',
					).catch(() => ({ overrides: [], summary: null })),
					apiCall<{ checklist: RiskChecklistItem[]; summary: RiskChecklistSummary }>(
						'/admin/compliance/risk-checklist',
					).catch(() => ({ checklist: [], summary: null })),
					apiCall<{ activities: DataProcessingActivity[] }>(
						'/admin/compliance/data-processing',
					).catch(() => ({
						activities: [],
					})),
					apiCall<{ requests: DataSubjectRequest[] }>('/admin/compliance/data-requests').catch(
						() => ({
							requests: [],
						}),
					),
					apiCall<{ records: ConsentRecord[]; summary: ConsentSummary }>(
						'/admin/compliance/consent',
					).catch(() => ({
						records: [],
						summary: null,
					})),
				])
				setDecisions(decisionsData.decisions || [])
				setBiasReport(biasData.report)
				setRiskClasses(riskData.classifications || [])
				setExplanations(explanationsData.explanations || [])
				setOverrides(overridesData.overrides || [])
				setOverrideSummary(overridesData.summary || null)
				setRiskChecklist(checklistData.checklist || [])
				setRiskChecklistSummary(checklistData.summary || null)
				setDataProcessing(processingData.activities || [])
				setDataRequests(requestsData.requests || [])
				setConsentRecords(consentData.records || [])
				setConsentSummary(consentData.summary || null)
			} catch (err) {
				console.error('Failed to load compliance data:', err)
			} finally {
				setLoading(false)
			}
		}
		loadCompliance()
	}, [])

	const handleExport = async () => {
		setExporting(true)
		trackEvent('compliance_export', { count: decisions.length })
		try {
			const response = await apiCall<{ csv: string }>('/admin/compliance/export', {
				method: 'POST',
			})
			if (response?.csv) {
				const blob = new Blob([response.csv], { type: 'text/csv' })
				const url = window.URL.createObjectURL(blob)
				const a = document.createElement('a')
				a.href = url
				a.download = `eu-ai-act-compliance-${new Date().toISOString().split('T')[0]}.csv`
				document.body.appendChild(a)
				a.click()
				window.URL.revokeObjectURL(url)
				document.body.removeChild(a)
			}
		} catch (err) {
			console.error('Export failed:', err)
		} finally {
			setExporting(false)
		}
	}

	const handleHumanReview = async (decisionId: string) => {
		try {
			await apiCall(`/admin/compliance/decisions/${decisionId}/review`, { method: 'POST' })
			setDecisions((prev) =>
				prev.map((d) => (d.id === decisionId ? { ...d, humanReviewed: true } : d)),
			)
			trackEvent('compliance_human_review', { decision_id: decisionId })
		} catch (err) {
			console.error('Review failed:', err)
		}
	}

	const stats = {
		total: decisions.length,
		reviewed: decisions.filter((d) => d.humanReviewed).length,
		biasFlags: decisions.filter((d) => d.biasFlags.length > 0).length,
		overrides: decisions.filter((d) => d.humanOverride).length,
	}

	return (
		<div className='space-y-6'>
			{/* Header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='font-heading text-2xl font-bold'>EU AI Act Compliance Dashboard</h1>
					<p className='text-muted-foreground'>
						Complete audit trail, risk classification, and transparency reports for AI decisions in
						accordance with Regulation (EU) 2024/1689
					</p>
				</div>
				<div className='flex gap-2'>
					<Button
						variant='outline'
						size='sm'
						onClick={handleExport}
						className='gap-1'
						disabled={exporting}
					>
						<Download className='h-4 w-4' />
						{exporting ? 'Exporting...' : 'Export Report'}
					</Button>
				</div>
			</div>

			{/* Stats */}
			<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
				<ChartCard
					title='Total AI Decisions'
					value={stats.total}
					icon={<FileText className='h-4 w-4' />}
				/>
				<ChartCard
					title='Human Reviewed'
					value={stats.reviewed}
					trend='up'
					trendValue={`${Math.round((stats.reviewed / Math.max(stats.total, 1)) * 100)}%`}
					icon={<Eye className='h-4 w-4' />}
				/>
				<ChartCard
					title='Bias Flags'
					value={stats.biasFlags}
					trend={stats.biasFlags > 0 ? 'down' : 'neutral'}
					trendValue={stats.biasFlags > 0 ? 'Needs attention' : 'Clean'}
					icon={<AlertTriangle className='h-4 w-4' />}
				/>
				<ChartCard
					title='Human Overrides'
					value={stats.overrides}
					icon={<Ban className='h-4 w-4' />}
				/>
			</div>

			{/* Risk Classification Banner */}
			<div className='grid gap-4 lg:grid-cols-3'>
				{riskClasses.map((risk) => {
					const config = riskConfig[risk.level]
					return (
						<Card key={risk.category}>
							<CardContent className='p-4'>
								<div className='flex items-start justify-between'>
									<div>
										<p className='text-sm font-medium text-muted-foreground'>{risk.category}</p>
										<Badge className={`mt-1 ${config.color}`}>
											{config.icon}
											<span className='ml-1'>{config.label}</span>
										</Badge>
									</div>
									<div className='text-right text-xs text-muted-foreground'>
										<p>Last: {new Date(risk.lastReviewed).toLocaleDateString()}</p>
										<p>Next: {new Date(risk.nextReview).toLocaleDateString()}</p>
									</div>
								</div>
								<p className='text-sm mt-2'>{risk.description}</p>
								<div className='mt-2 flex flex-wrap gap-1'>
									{risk.measures.map((m) => (
										<Badge key={m} variant='outline' className='text-xs'>
											{m}
										</Badge>
									))}
								</div>
							</CardContent>
						</Card>
					)
				})}
			</div>

			{/* Tabs */}
			<Tabs value={selectedTab} onValueChange={setSelectedTab}>
				<TabsList className='flex-wrap h-auto'>
					<TabsTrigger value='audit' className='gap-1'>
						<FileText className='h-3.5 w-3.5' />
						Audit Trail
					</TabsTrigger>
					<TabsTrigger value='bias' className='gap-1'>
						<AlertTriangle className='h-3.5 w-3.5' />
						Bias Detection
					</TabsTrigger>
					<TabsTrigger value='explanations' className='gap-1'>
						<BrainCircuit className='h-3.5 w-3.5' />
						Explainability
					</TabsTrigger>
					<TabsTrigger value='overrides' className='gap-1'>
						<GitPullRequest className='h-3.5 w-3.5' />
						Human Overrides
					</TabsTrigger>
					<TabsTrigger value='risk-checklist' className='gap-1'>
						<ListChecks className='h-3.5 w-3.5' />
						Risk Checklist
					</TabsTrigger>
					<TabsTrigger value='transparency' className='gap-1'>
						<Eye className='h-3.5 w-3.5' />
						Transparency Report
					</TabsTrigger>
					<TabsTrigger value='data-processing' className='gap-1'>
						<Database className='h-3.5 w-3.5' />
						Data Processing
					</TabsTrigger>
					<TabsTrigger value='user-rights' className='gap-1'>
						<ShieldCheck className='h-3.5 w-3.5' />
						User Rights
					</TabsTrigger>
					<TabsTrigger value='consent' className='gap-1'>
						<Cookie className='h-3.5 w-3.5' />
						Consent Management
					</TabsTrigger>
				</TabsList>

				<TabsContent value='audit' className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='table' />
					) : decisions.length === 0 ? (
						<EmptyState
							icon={FileText}
							title='No audit records yet'
							description='AI decision audit trail will appear here once decisions are made and logged by the system'
						/>
					) : (
						<Card>
							<CardContent className='p-0'>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Type</TableHead>
											<TableHead>Candidate</TableHead>
											<TableHead>Decision</TableHead>
											<TableHead>Confidence</TableHead>
											<TableHead>Model</TableHead>
											<TableHead>Reviewed</TableHead>
											<TableHead>Flags</TableHead>
											<TableHead className='w-12'></TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{decisions.map((d) => {
											const type = decisionTypeConfig[d.decisionType]
											const isExpanded = expandedDecision === d.id
											return (
												<Fragment key={d.id}>
													<TableRow
														className='cursor-pointer hover:bg-muted/50'
														onClick={() => setExpandedDecision(isExpanded ? null : d.id)}
													>
														<TableCell>
															<Badge className={`${type.color} gap-1`}>
																{type.icon}
																{type.label}
															</Badge>
														</TableCell>
														<TableCell>
															<div>
																<p className='font-medium text-sm'>{d.candidateName}</p>
																{d.jobTitle && (
																	<p className='text-xs text-muted-foreground'>{d.jobTitle}</p>
																)}
															</div>
														</TableCell>
														<TableCell className='font-medium'>{d.decision}</TableCell>
														<TableCell>{Math.round(d.confidence * 100)}%</TableCell>
														<TableCell className='text-xs text-muted-foreground'>
															{d.aiModel}
														</TableCell>
														<TableCell>
															{d.humanReviewed ? (
																<Badge
																	variant='outline'
																	className='text-xs text-green-600 border-green-200'
																>
																	<CheckCircle className='h-3 w-3 mr-1' />
																	Yes
																</Badge>
															) : (
																<Badge
																	variant='outline'
																	className='text-xs text-amber-600 border-amber-200'
																>
																	<Clock className='h-3 w-3 mr-1' />
																	Pending
																</Badge>
															)}
														</TableCell>
														<TableCell>
															{d.biasFlags.length > 0 ? (
																<Badge variant='destructive' className='text-xs'>
																	{d.biasFlags.length} flag{d.biasFlags.length > 1 ? 's' : ''}
																</Badge>
															) : (
																<span className='text-xs text-muted-foreground'>—</span>
															)}
														</TableCell>
														<TableCell>
															{isExpanded ? (
																<ChevronUp className='h-4 w-4' />
															) : (
																<ChevronDown className='h-4 w-4' />
															)}
														</TableCell>
													</TableRow>
													{isExpanded && (
														<TableRow className='bg-muted/30'>
															<TableCell colSpan={8} className='p-4'>
																<div className='space-y-3'>
																	<div>
																		<p className='text-sm font-medium mb-1'>AI Explanation</p>
																		<p className='text-sm text-muted-foreground'>{d.explanation}</p>
																	</div>
																	<div className='flex flex-wrap gap-2'>
																		<div className='text-xs text-muted-foreground'>
																			<span className='font-medium'>Retention:</span>{' '}
																			{d.dataRetention}
																		</div>
																		<div className='text-xs text-muted-foreground'>
																			<span className='font-medium'>Audit Hash:</span>{' '}
																			{d.auditHash.slice(0, 16)}...
																		</div>
																		{d.humanReviewer && (
																			<div className='text-xs text-muted-foreground'>
																				<span className='font-medium'>Reviewer:</span>{' '}
																				{d.humanReviewer}
																			</div>
																		)}
																	</div>
																	{!d.humanReviewed && (
																		<Button
																			size='sm'
																			onClick={() => handleHumanReview(d.id)}
																			className='gap-1'
																		>
																			<Eye className='h-3.5 w-3.5' />
																			Mark as Reviewed
																		</Button>
																	)}
																</div>
															</TableCell>
														</TableRow>
													)}
												</Fragment>
											)
										})}
									</TableBody>
								</Table>
							</CardContent>
						</Card>
					)}
				</TabsContent>

				<TabsContent value='bias' className='mt-4'>
					{loading ? (
						<Skeleton count={2} variant='card' />
					) : !biasReport ? (
						<EmptyState
							icon={AlertTriangle}
							title='No bias report available'
							description='Run bias detection analysis to generate a report'
						/>
					) : (
						<div className='space-y-4'>
							<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
								<ChartCard
									title='Total Decisions'
									value={biasReport.totalDecisions}
									icon={<FileText className='h-4 w-4' />}
								/>
								<ChartCard
									title='Bias Flags'
									value={biasReport.biasFlagsFound}
									trend={biasReport.biasFlagsFound > 0 ? 'down' : 'up'}
									trendValue={biasReport.biasFlagsFound > 0 ? 'Needs review' : 'Clean'}
									icon={<AlertTriangle className='h-4 w-4' />}
								/>
								<ChartCard
									title='False Positive Rate'
									value={`${(biasReport.falsePositiveRate * 100).toFixed(1)}%`}
									icon={<TrendingUp className='h-4 w-4' />}
								/>
								<ChartCard
									title='False Negative Rate'
									value={`${(biasReport.falseNegativeRate * 100).toFixed(1)}%`}
									icon={<TrendingDown className='h-4 w-4' />}
								/>
							</div>

							<Card>
								<CardHeader>
									<CardTitle>Demographic Breakdown</CardTitle>
								</CardHeader>
								<CardContent>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Demographic</TableHead>
												<TableHead>Total</TableHead>
												<TableHead>Positive Rate</TableHead>
												<TableHead>Bias Flag</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{biasReport.demographicBreakdown.map((d) => (
												<TableRow key={d.demographic}>
													<TableCell className='font-medium'>{d.demographic}</TableCell>
													<TableCell>{d.total}</TableCell>
													<TableCell>{(d.positiveRate * 100).toFixed(1)}%</TableCell>
													<TableCell>
														{d.biasFlag ? (
															<Badge variant='destructive' className='text-xs'>
																Flagged
															</Badge>
														) : (
															<Badge
																variant='outline'
																className='text-xs text-green-600 border-green-200'
															>
																<CheckCircle className='h-3 w-3 mr-1' />
																Clean
															</Badge>
														)}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</CardContent>
							</Card>

							<div className='grid gap-4 lg:grid-cols-2'>
								<Card>
									<CardHeader>
										<CardTitle className='flex items-center gap-2 text-red-600'>
											<AlertTriangle className='h-4 w-4' />
											Top Concerns
										</CardTitle>
									</CardHeader>
									<CardContent>
										<ul className='space-y-2'>
											{biasReport.topConcerns.map((concern, _i) => (
												<li key={concern} className='flex items-start gap-2 text-sm'>
													<AlertTriangle className='h-4 w-4 text-amber-500 mt-0.5 shrink-0' />
													{concern}
												</li>
											))}
										</ul>
									</CardContent>
								</Card>
								<Card>
									<CardHeader>
										<CardTitle className='flex items-center gap-2 text-green-600'>
											<CheckCircle className='h-4 w-4' />
											Improvements
										</CardTitle>
									</CardHeader>
									<CardContent>
										<ul className='space-y-2'>
											{biasReport.improvements.map((item, _i) => (
												<li key={item} className='flex items-start gap-2 text-sm'>
													<CheckCircle className='h-4 w-4 text-green-500 mt-0.5 shrink-0' />
													{item}
												</li>
											))}
										</ul>
									</CardContent>
								</Card>
							</div>
						</div>
					)}
				</TabsContent>

				<TabsContent value='explanations' className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='table' />
					) : explanations.length === 0 ? (
						<EmptyState
							icon={BrainCircuit}
							title='No explainability logs yet'
							description='AI explanation records will appear here once explanations are viewed or generated by the system'
						/>
					) : (
						<div className='space-y-4'>
							<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
								<ChartCard
									title='Total Explanations'
									value={explanations.length}
									icon={<BrainCircuit className='h-4 w-4' />}
								/>
								<ChartCard
									title='Avg Confidence'
									value={`${((explanations.reduce((sum, e) => sum + e.confidence, 0) / Math.max(explanations.length, 1)) * 100).toFixed(1)}%`}
									icon={<Activity className='h-4 w-4' />}
								/>
								<ChartCard
									title='Unique Models'
									value={new Set(explanations.map((e) => e.modelVersion)).size}
									icon={<FileText className='h-4 w-4' />}
								/>
								<ChartCard
									title='Last 24h'
									value={
										explanations.filter(
											(e) => new Date(e.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000),
										).length
									}
									icon={<Clock className='h-4 w-4' />}
								/>
							</div>
							<Card>
								<CardHeader>
									<CardTitle>Explainability Log</CardTitle>
								</CardHeader>
								<CardContent className='p-0'>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Timestamp</TableHead>
												<TableHead>Type</TableHead>
												<TableHead>Candidate</TableHead>
												<TableHead>Model</TableHead>
												<TableHead>Confidence</TableHead>
												<TableHead>Accessed By</TableHead>
												<TableHead>IP Address</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{explanations.map((e) => (
												<TableRow key={e.id}>
													<TableCell className='text-xs text-muted-foreground whitespace-nowrap'>
														{new Date(e.timestamp).toLocaleString()}
													</TableCell>
													<TableCell>
														<Badge variant='outline' className='text-xs'>
															{e.explanationType}
														</Badge>
													</TableCell>
													<TableCell>
														<div>
															<p className='font-medium text-sm'>{e.candidate.name}</p>
															<p className='text-xs text-muted-foreground'>ID: {e.candidate.id}</p>
														</div>
													</TableCell>
													<TableCell className='text-xs'>{e.modelVersion}</TableCell>
													<TableCell>{Math.round(e.confidence * 100)}%</TableCell>
													<TableCell>
														<p className='text-sm'>{e.adminUser.name}</p>
														<p className='text-xs text-muted-foreground'>ID: {e.adminUser.id}</p>
													</TableCell>
													<TableCell className='text-xs text-muted-foreground'>
														{e.viewedFromIp || '—'}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</CardContent>
							</Card>
						</div>
					)}
				</TabsContent>

				<TabsContent value='overrides' className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='table' />
					) : overrides.length === 0 ? (
						<EmptyState
							icon={GitPullRequest}
							title='No human overrides yet'
							description='Records of recruiters overriding AI decisions will appear here once overrides are logged by the system'
						/>
					) : (
						<div className='space-y-4'>
							{overrideSummary && (
								<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
									<ChartCard
										title='Total Overrides'
										value={overrideSummary.totalOverrides}
										icon={<GitPullRequest className='h-4 w-4' />}
									/>
									<ChartCard
										title='Avg AI Confidence'
										value={`${(overrideSummary.avgAiConfidence * 100).toFixed(1)}%`}
										icon={<Activity className='h-4 w-4' />}
									/>
									<ChartCard
										title='Unique Recruiters'
										value={overrideSummary.uniqueRecruiters}
										icon={<Users className='h-4 w-4' />}
									/>
									<ChartCard
										title='Unique Candidates'
										value={overrideSummary.uniqueCandidates}
										icon={<Users className='h-4 w-4' />}
									/>
								</div>
							)}
							<Card>
								<CardHeader>
									<CardTitle>Human Override Log</CardTitle>
								</CardHeader>
								<CardContent className='p-0'>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Timestamp</TableHead>
												<TableHead>Candidate</TableHead>
												<TableHead>Job</TableHead>
												<TableHead>Original Decision</TableHead>
												<TableHead>Override Decision</TableHead>
												<TableHead>AI Confidence</TableHead>
												<TableHead>Override By</TableHead>
												<TableHead>Reason</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{overrides.map((o) => (
												<TableRow key={o.id}>
													<TableCell className='text-xs text-muted-foreground whitespace-nowrap'>
														{new Date(o.timestamp).toLocaleString()}
													</TableCell>
													<TableCell>
														<div>
															<p className='font-medium text-sm'>{o.candidate.name}</p>
															<p className='text-xs text-muted-foreground'>ID: {o.candidate.id}</p>
														</div>
													</TableCell>
													<TableCell className='text-sm'>{o.jobTitle}</TableCell>
													<TableCell>
														<Badge variant='outline' className='text-xs'>
															{o.originalDecision}
														</Badge>
													</TableCell>
													<TableCell>
														<Badge className='text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'>
															{o.overrideDecision}
														</Badge>
													</TableCell>
													<TableCell>{Math.round(o.aiConfidence * 100)}%</TableCell>
													<TableCell>
														<p className='text-sm'>{o.overriddenBy.name}</p>
														<p className='text-xs text-muted-foreground'>ID: {o.overriddenBy.id}</p>
													</TableCell>
													<TableCell className='text-sm max-w-xs truncate' title={o.overrideReason}>
														{o.overrideReason}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</CardContent>
							</Card>
						</div>
					)}
				</TabsContent>

				<TabsContent value='risk-checklist' className='mt-4'>
					{loading ? (
						<Skeleton count={4} variant='card' />
					) : riskChecklist.length === 0 ? (
						<EmptyState
							icon={ListChecks}
							title='Risk checklist not available'
							description='Checklist data will appear once compliance monitoring is configured'
						/>
					) : (
						<div className='space-y-4'>
							{riskChecklistSummary && (
								<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
									<ChartCard
										title='Compliance Score'
										value={`${riskChecklistSummary.complianceScore}%`}
										trend={riskChecklistSummary.complianceScore >= 80 ? 'up' : 'down'}
										trendValue={
											riskChecklistSummary.complianceScore >= 80 ? 'On track' : 'Needs work'
										}
										icon={<ShieldCheck className='h-4 w-4' />}
									/>
									<ChartCard
										title='Complete'
										value={riskChecklistSummary.completed}
										icon={<CheckCircle className='h-4 w-4' />}
									/>
									<ChartCard
										title='Pending'
										value={riskChecklistSummary.pending}
										icon={<Clock className='h-4 w-4' />}
									/>
									<ChartCard
										title='Incomplete'
										value={riskChecklistSummary.incomplete}
										trend='down'
										trendValue={riskChecklistSummary.incomplete > 0 ? 'Action needed' : 'Clean'}
										icon={<XCircle className='h-4 w-4' />}
									/>
								</div>
							)}

							<Card>
								<CardHeader>
									<CardTitle className='flex items-center gap-2'>
										<ListChecks className='h-5 w-5' />
										EU AI Act Risk Assessment Checklist
									</CardTitle>
								</CardHeader>
								<CardContent className='p-0'>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Status</TableHead>
												<TableHead>Category</TableHead>
												<TableHead>Requirement</TableHead>
												<TableHead>Evidence</TableHead>
												<TableHead>EU AI Act Ref</TableHead>
												<TableHead>Last Verified</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{riskChecklist.map((item) => {
												const statusConfig = {
													complete: {
														color:
															'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
														icon: <CheckCircle className='h-4 w-4' />,
														label: 'Complete',
													},
													pending: {
														color:
															'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
														icon: <Clock className='h-4 w-4' />,
														label: 'Pending',
													},
													incomplete: {
														color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
														icon: <XCircle className='h-4 w-4' />,
														label: 'Incomplete',
													},
													in_progress: {
														color:
															'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
														icon: <Activity className='h-4 w-4' />,
														label: 'In Progress',
													},
												}
												const config = statusConfig[item.status] || statusConfig.incomplete
												return (
													<TableRow key={item.id}>
														<TableCell>
															<Badge className={`${config.color} gap-1`}>
																{config.icon}
																{config.label}
															</Badge>
														</TableCell>
														<TableCell className='font-medium'>{item.category}</TableCell>
														<TableCell>
															<div>
																<p className='text-sm font-medium'>{item.item}</p>
																{item.required && <p className='text-xs text-red-500'>Required</p>}
															</div>
														</TableCell>
														<TableCell className='text-sm text-muted-foreground max-w-sm'>
															{item.evidence}
														</TableCell>
														<TableCell className='text-xs font-mono'>
															{item.eu_ai_act_ref}
														</TableCell>
														<TableCell className='text-xs text-muted-foreground'>
															{new Date(item.lastVerified).toLocaleDateString()}
														</TableCell>
													</TableRow>
												)
											})}
										</TableBody>
									</Table>
								</CardContent>
							</Card>
						</div>
					)}
				</TabsContent>

				<TabsContent value='transparency' className='mt-4'>
					<div className='space-y-4'>
						<Card>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									<ScrollText className='h-5 w-5' />
									EU AI Act Transparency Report
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-4'>
								<div className='space-y-2'>
									<h3 className='font-semibold flex items-center gap-2'>
										<BookOpen className='h-4 w-4' />
										1. AI System Description
									</h3>
									<p className='text-sm text-muted-foreground'>
										Rekrut AI uses multiple AI models for candidate screening, job matching,
										interview assessment, and scoring. All decisions are logged with explainability
										and audit trails in accordance with Article 13 of the EU AI Act.
									</p>
								</div>
								<div className='space-y-2'>
									<h3 className='font-semibold flex items-center gap-2'>
										<FileCheck className='h-4 w-4' />
										2. Decision Making Process
									</h3>
									<p className='text-sm text-muted-foreground'>
										AI models analyze candidate profiles, job requirements, interview responses, and
										documents. Human reviewers can override AI decisions. All overrides are logged
										as per Article 14 of the EU AI Act.
									</p>
								</div>
								<div className='space-y-2'>
									<h3 className='font-semibold flex items-center gap-2'>
										<FileSpreadsheet className='h-4 w-4' />
										3. Data Usage
									</h3>
									<p className='text-sm text-muted-foreground'>
										Candidate data is used solely for hiring purposes. Data retention follows GDPR
										and EU AI Act requirements. Candidates can request deletion at any time
										(Articles 14(4) and GDPR Art. 15-22).
									</p>
								</div>
								<div className='space-y-2'>
									<h3 className='font-semibold flex items-center gap-2'>
										<Users className='h-4 w-4' />
										4. Human Oversight
									</h3>
									<p className='text-sm text-muted-foreground'>
										All high-risk AI decisions require human review. Recruiters can override AI
										recommendations. Bias detection runs continuously on all decisions as per
										Article 14 of the EU AI Act.
									</p>
								</div>
								<div className='space-y-2'>
									<h3 className='font-semibold flex items-center gap-2'>
										<Shield className='h-4 w-4' />
										5. Rights of Individuals
									</h3>
									<p className='text-sm text-muted-foreground'>
										Candidates have the right to: request explanation of AI decisions (Article 13),
										challenge decisions (Article 14), request human review (Article 14), and access
										their data (GDPR Art. 15).
									</p>
								</div>
								<div className='space-y-2'>
									<h3 className='font-semibold flex items-center gap-2'>
										<BarChart3 className='h-4 w-4' />
										6. Risk Classification
									</h3>
									<p className='text-sm text-muted-foreground'>
										This AI system is classified as high-risk under Article 6(2) of the EU AI Act,
										as it is used for recruitment and selection purposes. All high-risk requirements
										are monitored and enforced.
									</p>
								</div>
								<Button
									variant='outline'
									className='gap-1'
									onClick={handleExport}
									disabled={exporting}
								>
									<Download className='h-4 w-4' />
									{exporting ? 'Exporting...' : 'Download Full Transparency Report'}
								</Button>
							</CardContent>
						</Card>
					</div>
				</TabsContent>

				<TabsContent value='data-processing' className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='card' />
					) : dataProcessing.length === 0 ? (
						<EmptyState
							icon={Database}
							title='No data processing records'
							description='Data processing transparency records will appear here once configured'
						/>
					) : (
						<div className='space-y-4'>
							<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
								<ChartCard
									title='Processing Activities'
									value={dataProcessing.length}
									icon={<Database className='h-4 w-4' />}
								/>
								<ChartCard
									title='Active'
									value={dataProcessing.filter((d) => d.status === 'active').length}
									icon={<CheckCircle className='h-4 w-4' />}
								/>
								<ChartCard
									title='Under Review'
									value={dataProcessing.filter((d) => d.status === 'under_review').length}
									icon={<Clock className='h-4 w-4' />}
								/>
								<ChartCard
									title='Cross-Border'
									value={dataProcessing.filter((d) => d.crossBorder).length}
									icon={<Globe className='h-4 w-4' />}
								/>
							</div>
							{dataProcessing.map((activity) => (
								<Card key={activity.id}>
									<CardHeader>
										<div className='flex items-center justify-between'>
											<CardTitle className='flex items-center gap-2 text-base'>
												<Database className='h-4 w-4' />
												{activity.category}
											</CardTitle>
											<Badge
												variant={
													activity.status === 'active'
														? 'default'
														: activity.status === 'under_review'
															? 'secondary'
															: 'outline'
												}
											>
												{activity.status === 'active'
													? 'Active'
													: activity.status === 'under_review'
														? 'Under Review'
														: 'Paused'}
											</Badge>
										</div>
									</CardHeader>
									<CardContent className='space-y-3'>
										<div className='grid gap-4 md:grid-cols-2'>
											<div>
												<p className='text-sm font-medium'>Purpose</p>
												<p className='text-sm text-muted-foreground'>{activity.purpose}</p>
											</div>
											<div>
												<p className='text-sm font-medium'>Legal Basis</p>
												<p className='text-sm text-muted-foreground'>{activity.legalBasis}</p>
											</div>
										</div>
										<div>
											<p className='text-sm font-medium'>Data Types</p>
											<div className='mt-1 flex flex-wrap gap-1'>
												{activity.dataTypes.map((type) => (
													<Badge key={type} variant='outline' className='text-xs'>
														{type}
													</Badge>
												))}
											</div>
										</div>
										<div className='grid gap-4 md:grid-cols-2'>
											<div>
												<p className='text-sm font-medium'>Retention Period</p>
												<p className='text-sm text-muted-foreground flex items-center gap-1'>
													<HardDrive className='h-3.5 w-3.5' />
													{activity.retentionPeriod}
												</p>
											</div>
											<div>
												<p className='text-sm font-medium'>Third Parties</p>
												<p className='text-sm text-muted-foreground flex items-center gap-1'>
													<Share2 className='h-3.5 w-3.5' />
													{activity.thirdParties.length > 0
														? activity.thirdParties.join(', ')
														: 'None'}
												</p>
											</div>
										</div>
										{activity.crossBorder && (
											<Badge variant='outline' className='text-amber-600 border-amber-200'>
												<Globe className='h-3 w-3 mr-1' />
												Cross-Border Transfer
											</Badge>
										)}
										<p className='text-sm text-muted-foreground'>{activity.description}</p>
										<p className='text-xs text-muted-foreground'>
											Last updated: {new Date(activity.lastUpdated).toLocaleDateString()}
										</p>
									</CardContent>
								</Card>
							))}
						</div>
					)}
				</TabsContent>

				<TabsContent value='user-rights' className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='table' />
					) : dataRequests.length === 0 ? (
						<EmptyState
							icon={ShieldCheck}
							title='No data subject requests'
							description='Data subject requests and appeals will appear here once submitted by candidates'
						/>
					) : (
						<div className='space-y-4'>
							<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
								<ChartCard
									title='Total Requests'
									value={dataRequests.length}
									icon={<FileSearch className='h-4 w-4' />}
								/>
								<ChartCard
									title='Pending'
									value={dataRequests.filter((r) => r.status === 'pending').length}
									icon={<Clock className='h-4 w-4' />}
								/>
								<ChartCard
									title='Completed'
									value={dataRequests.filter((r) => r.status === 'completed').length}
									icon={<CheckCircle className='h-4 w-4' />}
								/>
								<ChartCard
									title='Overdue'
									value={
										dataRequests.filter(
											(r) => new Date(r.responseDeadline) < new Date() && r.status !== 'completed',
										).length
									}
									icon={<AlertTriangle className='h-4 w-4' />}
									trend='down'
									trendValue='Urgent'
								/>
							</div>
							<Card>
								<CardHeader>
									<CardTitle className='flex items-center gap-2'>
										<ShieldCheck className='h-5 w-5' />
										Data Subject Requests
									</CardTitle>
								</CardHeader>
								<CardContent className='p-0'>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Date</TableHead>
												<TableHead>Candidate</TableHead>
												<TableHead>Type</TableHead>
												<TableHead>Status</TableHead>
												<TableHead>Description</TableHead>
												<TableHead>Handled By</TableHead>
												<TableHead>Deadline</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{dataRequests.map((req) => {
												const typeConfig = {
													access: { icon: <FileSearch className='h-4 w-4' />, label: 'Access' },
													rectification: {
														icon: <FileEdit className='h-4 w-4' />,
														label: 'Rectification',
													},
													erasure: { icon: <Trash2 className='h-4 w-4' />, label: 'Erasure' },
													portability: {
														icon: <Share2 className='h-4 w-4' />,
														label: 'Portability',
													},
													explanation: {
														icon: <BrainCircuit className='h-4 w-4' />,
														label: 'Explanation',
													},
													appeal: { icon: <UserX className='h-4 w-4' />, label: 'Appeal' },
												}
												const tc = typeConfig[req.requestType]
												const isOverdue =
													new Date(req.responseDeadline) < new Date() && req.status !== 'completed'
												return (
													<TableRow key={req.id}>
														<TableCell className='text-xs text-muted-foreground whitespace-nowrap'>
															{new Date(req.timestamp).toLocaleDateString()}
														</TableCell>
														<TableCell className='font-medium'>{req.candidateName}</TableCell>
														<TableCell>
															<div className='flex items-center gap-1'>
																{tc.icon}
																<span className='text-sm'>{tc.label}</span>
															</div>
														</TableCell>
														<TableCell>
															{req.status === 'completed' ? (
																<Badge
																	variant='outline'
																	className='text-xs text-green-600 border-green-200'
																>
																	<CheckCircle className='h-3 w-3 mr-1' />
																	Completed
																</Badge>
															) : req.status === 'in_progress' ? (
																<Badge
																	variant='outline'
																	className='text-xs text-blue-600 border-blue-200'
																>
																	<Activity className='h-3 w-3 mr-1' />
																	In Progress
																</Badge>
															) : req.status === 'rejected' ? (
																<Badge
																	variant='outline'
																	className='text-xs text-red-600 border-red-200'
																>
																	<XCircle className='h-3 w-3 mr-1' />
																	Rejected
																</Badge>
															) : (
																<Badge
																	variant='outline'
																	className='text-xs text-amber-600 border-amber-200'
																>
																	<Clock className='h-3 w-3 mr-1' />
																	Pending
																</Badge>
															)}
														</TableCell>
														<TableCell
															className='text-sm max-w-xs truncate'
															title={req.description}
														>
															{req.description}
														</TableCell>
														<TableCell className='text-sm'>{req.handledBy || '—'}</TableCell>
														<TableCell
															className={`text-xs whitespace-nowrap ${isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}
														>
															{isOverdue && <AlertTriangle className='h-3 w-3 inline mr-1' />}
															{new Date(req.responseDeadline).toLocaleDateString()}
														</TableCell>
													</TableRow>
												)
											})}
										</TableBody>
									</Table>
								</CardContent>
							</Card>
						</div>
					)}
				</TabsContent>

				<TabsContent value='consent' className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='card' />
					) : !consentSummary && consentRecords.length === 0 ? (
						<EmptyState
							icon={Cookie}
							title='No consent records'
							description='Cookie and tracking consent records will appear here once candidates interact with the consent banner'
						/>
					) : (
						<div className='space-y-4'>
							{consentSummary && (
								<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
									<ChartCard
										title='Total Consents'
										value={consentSummary.totalConsents}
										icon={<Cookie className='h-4 w-4' />}
									/>
									<ChartCard
										title='Granted Rate'
										value={`${(consentSummary.grantedRate * 100).toFixed(1)}%`}
										trend={consentSummary.grantedRate >= 0.8 ? 'up' : 'neutral'}
										trendValue={consentSummary.grantedRate >= 0.8 ? 'Healthy' : 'Review'}
										icon={<CheckCircle className='h-4 w-4' />}
									/>
									<ChartCard
										title='Withdrawn Rate'
										value={`${(consentSummary.withdrawnRate * 100).toFixed(1)}%`}
										icon={<Ban className='h-4 w-4' />}
									/>
									<ChartCard
										title='Unique Regions'
										value={Object.keys(consentSummary.byRegion).length}
										icon={<Globe className='h-4 w-4' />}
									/>
								</div>
							)}
							<div className='grid gap-4 lg:grid-cols-2'>
								<Card>
									<CardHeader>
										<CardTitle className='flex items-center gap-2'>
											<MousePointerClick className='h-5 w-5' />
											Consent by Type
										</CardTitle>
									</CardHeader>
									<CardContent>
										{consentSummary ? (
											<div className='space-y-3'>
												{Object.entries(consentSummary.byType).map(([type, count]) => (
													<div key={type} className='flex items-center justify-between'>
														<div className='flex items-center gap-2'>
															{type === 'necessary' ? (
																<Lock className='h-4 w-4 text-muted-foreground' />
															) : type === 'analytics' ? (
																<BarChart3 className='h-4 w-4 text-muted-foreground' />
															) : type === 'marketing' ? (
																<Users className='h-4 w-4 text-muted-foreground' />
															) : (
																<Settings className='h-4 w-4 text-muted-foreground' />
															)}
															<span className='text-sm capitalize'>{type}</span>
														</div>
														<div className='flex items-center gap-2'>
															<div className='h-2 w-24 rounded-full bg-muted overflow-hidden'>
																<div
																	className='h-full bg-primary rounded-full'
																	style={{
																		width: `${(count / Math.max(consentSummary.totalConsents, 1)) * 100}%`,
																	}}
																/>
															</div>
															<span className='text-xs text-muted-foreground'>{count}</span>
														</div>
													</div>
												))}
											</div>
										) : (
											<p className='text-sm text-muted-foreground'>No summary data</p>
										)}
									</CardContent>
								</Card>
								<Card>
									<CardHeader>
										<CardTitle className='flex items-center gap-2'>
											<Fingerprint className='h-5 w-5' />
											Consent Audit Log
										</CardTitle>
									</CardHeader>
									<CardContent className='p-0'>
										{consentRecords.length === 0 ? (
											<p className='p-4 text-sm text-muted-foreground'>No consent records yet</p>
										) : (
											<Table>
												<TableHeader>
													<TableRow>
														<TableHead>Date</TableHead>
														<TableHead>Candidate</TableHead>
														<TableHead>Type</TableHead>
														<TableHead>Status</TableHead>
														<TableHead>Region</TableHead>
														<TableHead>IP</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{consentRecords.map((record) => (
														<TableRow key={record.id}>
															<TableCell className='text-xs text-muted-foreground whitespace-nowrap'>
																{new Date(record.timestamp).toLocaleString()}
															</TableCell>
															<TableCell className='font-medium text-sm'>
																{record.candidateName}
															</TableCell>
															<TableCell>
																<Badge variant='outline' className='text-xs capitalize'>
																	{record.consentType}
																</Badge>
															</TableCell>
															<TableCell>
																{record.status === 'granted' ? (
																	<Badge className='text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'>
																		<ToggleRight className='h-3 w-3 mr-1' />
																		Granted
																	</Badge>
																) : record.status === 'denied' ? (
																	<Badge className='text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'>
																		<ToggleLeft className='h-3 w-3 mr-1' />
																		Denied
																	</Badge>
																) : (
																	<Badge className='text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'>
																		<Unlock className='h-3 w-3 mr-1' />
																		Withdrawn
																	</Badge>
																)}
															</TableCell>
															<TableCell className='text-xs'>{record.geographicRegion}</TableCell>
															<TableCell className='text-xs text-muted-foreground'>
																{record.ipAddress}
															</TableCell>
														</TableRow>
													))}
												</TableBody>
											</Table>
										)}
									</CardContent>
								</Card>
							</div>
						</div>
					)}
				</TabsContent>
			</Tabs>
		</div>
	)
}
