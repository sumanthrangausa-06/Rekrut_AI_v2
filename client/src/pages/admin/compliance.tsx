import {
	Activity,
	AlertTriangle,
	ArrowDownToLine,
	Ban,
	BarChart3,
	BrainCircuit,
	Calendar,
	CheckCircle,
	ChevronDown,
	ChevronUp,
	Clock,
	Database,
	Download,
	Eye,
	FileCheck,
	FileSpreadsheet,
	FileText,
	Gauge,
	Gavel,
	GitPullRequest,
	Hand,
	History,
	Info,
	ListChecks,
	PieChart,
	Settings2,
	Shield,
	ShieldAlert,
	ShieldCheck,
	Trash2,
	TrendingDown,
	TrendingUp,
	UserCheck,
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
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
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

export type BiasHistoryReport = {
	id: number
	auditDate: string
	auditType: string
	overallFairnessScore: number
	issuesFound: number
	demographicCount: number
	appealCount: number
	createdAt: string
}

export type ModelPerformance = {
	period: number
	volumeOverTime: Array<{ date: string; count: number }>
	modelPerformance: Array<{
		model: string
		decisions: number
		avgConfidence: number
		overrideRate: number
	}>
	scoreDistribution: Array<{ bucket: number; count: number }>
	reviewRate: number
	totalDecisions: number
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

export type ConsentRecord = {
	id: number
	userId: number
	userEmail: string
	userName: string
	consentType: string
	consented: boolean
	consentedAt: string
	ipAddress: string
	metadata: Record<string, any>
	createdAt: string
	updatedAt: string
}

export type DataRequest = {
	id: number
	userId: number
	userEmail: string
	userName: string
	requestType: string
	status: string
	requestedAt: string
	processedAt: string
	processedBy: number
	processorEmail: string
	exportUrl: string
	notes: string
	metadata: Record<string, any>
}

export type ScoreAppeal = {
	id: number
	userId: number
	userEmail: string
	userName: string
	scoreType: string
	originalScore: number
	appealReason: string
	status: string
	reviewedBy: number
	reviewerEmail: string
	reviewedAt: string
	resolution: string
	newScore: number
	createdAt: string
	updatedAt: string
}

export type RetentionPolicy = {
	id: number
	dataType: string
	retentionDays: number
	autoDelete: boolean
	description: string
	createdAt: string
	updatedAt: string
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

export function AdminCompliancePage() {
	const [decisions, setDecisions] = useState<ComplianceDecision[]>([])
	const [biasReport, setBiasReport] = useState<BiasReport | null>(null)
	const [riskClasses, setRiskClasses] = useState<RiskClassification[]>([])
	const [explanations, setExplanations] = useState<ExplainabilityLog[]>([])
	const [overrides, setOverrides] = useState<HumanOverride[]>([])
	const [riskChecklist, setRiskChecklist] = useState<RiskChecklistItem[]>([])
	const [riskChecklistSummary, setRiskChecklistSummary] = useState<RiskChecklistSummary | null>(
		null,
	)
	const [biasHistory, setBiasHistory] = useState<BiasHistoryReport[]>([])
	const [modelPerformance, setModelPerformance] = useState<ModelPerformance | null>(null)
	const [consents, setConsents] = useState<ConsentRecord[]>([])
	const [dataRequests, setDataRequests] = useState<DataRequest[]>([])
	const [appeals, setAppeals] = useState<ScoreAppeal[]>([])
	const [retentionPolicies, setRetentionPolicies] = useState<RetentionPolicy[]>([])
	const [loading, setLoading] = useState(true)
	const [exportLoading, setExportLoading] = useState(false)
	const [selectedTab, setSelectedTab] = useState('audit')
	const [expandedDecision, setExpandedDecision] = useState<string | null>(null)
	const [appealFilter, setAppealFilter] = useState('all')
	const [dataRequestFilter, setDataRequestFilter] = useState('all')
	const [dataRequestTypeFilter, setDataRequestTypeFilter] = useState('all')
	const [consentFilter, setConsentFilter] = useState('all')
	const [editingPolicy, setEditingPolicy] = useState<number | null>(null)
	const [policyForm, setPolicyForm] = useState<{ retentionDays: number; autoDelete: boolean }>({
		retentionDays: 0,
		autoDelete: false,
	})

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
					biasHistoryData,
					performanceData,
					consentsData,
					dataRequestsData,
					appealsData,
					retentionPoliciesData,
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
					apiCall<{ overrides: HumanOverride[]; summary: RiskChecklistSummary }>(
						'/admin/compliance/overrides',
					).catch(() => ({ overrides: [], summary: null })),
					apiCall<{ checklist: RiskChecklistItem[]; summary: RiskChecklistSummary }>(
						'/admin/compliance/risk-checklist',
					).catch(() => ({ checklist: [], summary: null })),
					apiCall<{ reports: BiasHistoryReport[] }>('/admin/compliance/bias-reports').catch(() => ({
						reports: [],
					})),
					apiCall<{ modelPerformance: ModelPerformance }>('/admin/compliance/performance').catch(
						() => ({ modelPerformance: null }),
					),
					apiCall<{ consents: ConsentRecord[] }>('/admin/compliance/consents').catch(() => ({
						consents: [],
					})),
					apiCall<{ dataRequests: DataRequest[] }>('/admin/compliance/data-requests').catch(() => ({
						dataRequests: [],
					})),
					apiCall<{ appeals: ScoreAppeal[] }>('/admin/compliance/appeals').catch(() => ({
						appeals: [],
					})),
					apiCall<{ policies: RetentionPolicy[] }>('/admin/compliance/retention-policies').catch(
						() => ({ policies: [] }),
					),
				])
				setDecisions(decisionsData.decisions || [])
				setBiasReport(biasData.report)
				setRiskClasses(riskData.classifications || [])
				setExplanations(explanationsData.explanations || [])
				setOverrides(overridesData.overrides || [])
				setRiskChecklist(checklistData.checklist || [])
				setRiskChecklistSummary(checklistData.summary || null)
				setBiasHistory(biasHistoryData.reports || [])
				setModelPerformance(performanceData.modelPerformance || null)
				setConsents(consentsData.consents || [])
				setDataRequests(dataRequestsData.dataRequests || [])
				setAppeals(appealsData.appeals || [])
				setRetentionPolicies(retentionPoliciesData.policies || [])
			} catch (err) {
				console.error('Failed to load compliance data:', err)
			} finally {
				setLoading(false)
			}
		}
		loadCompliance()
	}, [])

	const handleExportCSV = async () => {
		setExportLoading(true)
		trackEvent('compliance_export_csv', { count: decisions.length })
		try {
			const response = await apiCall<Blob>('/admin/compliance/export', {
				method: 'POST',
				body: JSON.stringify({ format: 'csv' }),
				headers: { 'Content-Type': 'application/json' },
			})
			const blob =
				response instanceof Blob ? response : new Blob([response as any], { type: 'text/csv' })
			const url = window.URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = `compliance-export-${new Date().toISOString().split('T')[0]}.csv`
			document.body.appendChild(a)
			a.click()
			document.body.removeChild(a)
			window.URL.revokeObjectURL(url)
		} catch (err) {
			console.error('Export failed:', err)
		} finally {
			setExportLoading(false)
		}
	}

	const handleExportJSON = async () => {
		setExportLoading(true)
		trackEvent('compliance_export_json', { count: decisions.length })
		try {
			const data = await apiCall<{ decisions: any[] }>('/admin/compliance/export', {
				method: 'POST',
				body: JSON.stringify({ format: 'json' }),
				headers: { 'Content-Type': 'application/json' },
			})
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
			const url = window.URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = `compliance-export-${new Date().toISOString().split('T')[0]}.json`
			document.body.appendChild(a)
			a.click()
			document.body.removeChild(a)
			window.URL.revokeObjectURL(url)
		} catch (err) {
			console.error('Export failed:', err)
		} finally {
			setExportLoading(false)
		}
	}

	const handleExport = () => {
		handleExportCSV()
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
		consents: consents.length,
		consented: consents.filter((c) => c.consented).length,
		pendingDataRequests: dataRequests.filter((r) => r.status === 'pending').length,
		pendingAppeals: appeals.filter((a) => a.status === 'pending').length,
	}

	return (
		<div className='space-y-6'>
			{/* Header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='font-heading text-2xl font-bold'>EU AI Act Compliance</h1>
					<p className='text-muted-foreground'>
						Audit trail, risk classification, and transparency reports for AI decisions
					</p>
				</div>
				<div className='flex gap-2'>
					<Button
						variant='outline'
						size='sm'
						onClick={handleExportCSV}
						disabled={exportLoading || decisions.length === 0}
						className='gap-1'
					>
						<FileSpreadsheet className='h-4 w-4' />
						{exportLoading ? 'Exporting...' : 'Export CSV'}
					</Button>
					<Button
						variant='outline'
						size='sm'
						onClick={handleExportJSON}
						disabled={exportLoading || decisions.length === 0}
						className='gap-1'
					>
						<ArrowDownToLine className='h-4 w-4' />
						JSON
					</Button>
				</div>
			</div>

			{/* Compliance Score Banner */}
			{riskChecklistSummary && (
				<Card className='border-l-4 border-l-primary'>
					<CardContent className='p-4'>
						<div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
							<div className='flex items-center gap-4'>
								<div className='shrink-0'>
									<div className='relative h-16 w-16'>
										<Gauge className='h-16 w-16 text-muted-foreground' />
										<div className='absolute inset-0 flex items-center justify-center'>
											<span className='text-sm font-bold'>
												{riskChecklistSummary.complianceScore}%
											</span>
										</div>
									</div>
								</div>
								<div>
									<h2 className='font-heading text-lg font-semibold'>EU AI Act Compliance Score</h2>
									<p className='text-sm text-muted-foreground'>
										{riskChecklistSummary.overallStatus === 'compliant'
											? 'System is fully compliant with EU AI Act requirements'
											: riskChecklistSummary.overallStatus === 'needs_attention'
												? 'Attention needed: some requirements are pending'
												: 'Partially compliant: complete remaining requirements'}
									</p>
									<div className='mt-2 flex items-center gap-3 text-xs text-muted-foreground'>
										<span className='flex items-center gap-1'>
											<CheckCircle className='h-3 w-3 text-green-500' />
											{riskChecklistSummary.completed} complete
										</span>
										<span className='flex items-center gap-1'>
											<Clock className='h-3 w-3 text-amber-500' />
											{riskChecklistSummary.pending} pending
										</span>
										<span className='flex items-center gap-1'>
											<XCircle className='h-3 w-3 text-red-500' />
											{riskChecklistSummary.incomplete} incomplete
										</span>
										<span className='flex items-center gap-1'>
											<Activity className='h-3 w-3 text-blue-500' />
											{riskChecklistSummary.inProgress} in progress
										</span>
									</div>
								</div>
							</div>
							<div className='flex flex-col gap-1 min-w-[200px]'>
								<div className='flex justify-between text-xs text-muted-foreground'>
									<span>Progress</span>
									<span>{riskChecklistSummary.complianceScore}%</span>
								</div>
								<Progress value={riskChecklistSummary.complianceScore} max={100} />
								<p className='text-xs text-muted-foreground'>
									Next review: {new Date(riskChecklistSummary.nextReview).toLocaleDateString()}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Stats */}
			<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
				<ChartCard
					title='Total Decisions'
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
				<ChartCard
					title='Consent Records'
					value={stats.consents}
					icon={<Hand className='h-4 w-4' />}
				/>
				<ChartCard
					title='Active Consents'
					value={stats.consented}
					trend='up'
					trendValue={`${Math.round((stats.consented / Math.max(stats.consents, 1)) * 100)}%`}
					icon={<UserCheck className='h-4 w-4' />}
				/>
				<ChartCard
					title='Pending Data Requests'
					value={stats.pendingDataRequests}
					trend={stats.pendingDataRequests > 0 ? 'down' : 'neutral'}
					trendValue={stats.pendingDataRequests > 0 ? 'Action needed' : 'Clean'}
					icon={<Database className='h-4 w-4' />}
				/>
				<ChartCard
					title='Pending Appeals'
					value={stats.pendingAppeals}
					trend={stats.pendingAppeals > 0 ? 'down' : 'neutral'}
					trendValue={stats.pendingAppeals > 0 ? 'Action needed' : 'Clean'}
					icon={<Gavel className='h-4 w-4' />}
				/>
			</div>

			{/* Risk Classification Banner */}
			<div className='grid gap-4 lg:grid-cols-3'>
				{riskClasses.map((risk) => {
					const config = riskConfig[risk.level]
					const isMitigated = risk.measures.length > 0 && new Date(risk.nextReview) > new Date()
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
								<div className='mt-3 flex items-center gap-2'>
									<Badge
										variant='outline'
										className={`text-xs gap-1 ${
											isMitigated
												? 'text-green-600 border-green-200'
												: 'text-amber-600 border-amber-200'
										}`}
									>
										{isMitigated ? (
											<>
												<CheckCircle className='h-3 w-3' />
												Mitigated
											</>
										) : (
											<>
												<Clock className='h-3 w-3' />
												Mitigation Pending
											</>
										)}
									</Badge>
									<span className='text-xs text-muted-foreground'>
										{risk.measures.length} measure{risk.measures.length !== 1 ? 's' : ''} in place
									</span>
								</div>
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

			{/* Transparency Notice — EU AI Act Article 52 */}
			<Card className='border-l-4 border-l-blue-500'>
				<CardHeader className='pb-3'>
					<CardTitle className='flex items-center gap-2 text-base'>
						<Info className='h-5 w-5 text-blue-500' />
						Transparency Notice — EU AI Act Article 52
					</CardTitle>
				</CardHeader>
				<CardContent className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4 pt-0'>
					<div className='space-y-2'>
						<div className='flex items-center gap-2'>
							<BrainCircuit className='h-4 w-4 text-purple-500' />
							<h4 className='font-semibold text-sm'>AI Systems Used</h4>
						</div>
						<ul className='text-xs text-muted-foreground space-y-1'>
							<li>
								• <strong>Matching:</strong> Candidate-job fit scoring
							</li>
							<li>
								• <strong>Screening:</strong> Qualification filtering
							</li>
							<li>
								• <strong>Scoring:</strong> OmniScore & TrustScore
							</li>
							<li>
								• <strong>Interview:</strong> AI-assisted assessments
							</li>
						</ul>
					</div>
					<div className='space-y-2'>
						<div className='flex items-center gap-2'>
							<Eye className='h-4 w-4 text-green-500' />
							<h4 className='font-semibold text-sm'>Human-in-the-Loop</h4>
						</div>
						<p className='text-xs text-muted-foreground'>
							All AI recommendations are reviewed by human recruiters before final decisions.
							{modelPerformance
								? ` Current review rate: ${(modelPerformance.reviewRate * 100).toFixed(0)}%.`
								: ''}
						</p>
					</div>
					<div className='space-y-2'>
						<div className='flex items-center gap-2'>
							<Users className='h-4 w-4 text-amber-500' />
							<h4 className='font-semibold text-sm'>Contesting Decisions</h4>
						</div>
						<p className='text-xs text-muted-foreground'>
							Candidates may request an explanation, appeal a score, or demand human review. Use the
							appeals panel in candidate settings or contact support.
						</p>
					</div>
					<div className='space-y-2'>
						<div className='flex items-center gap-2'>
							<Clock className='h-4 w-4 text-red-500' />
							<h4 className='font-semibold text-sm'>Data Retention</h4>
						</div>
						<p className='text-xs text-muted-foreground'>
							Decision logs retained for 3 years per EU AI Act. Candidate profile data deleted on
							request (GDPR Art. 17). Audit hashes are immutable and tamper-proof.
						</p>
					</div>
				</CardContent>
			</Card>

			{/* Tabs */}
			<Tabs value={selectedTab} onValueChange={setSelectedTab}>
				<TabsList className='flex-wrap h-auto'>
					<TabsTrigger value='overview' className='gap-1'>
						<ShieldCheck className='h-3.5 w-3.5' />
						Compliance Score
					</TabsTrigger>
					<TabsTrigger value='audit' className='gap-1'>
						<FileText className='h-3.5 w-3.5' />
						Audit Trail
					</TabsTrigger>
					<TabsTrigger value='bias' className='gap-1'>
						<AlertTriangle className='h-3.5 w-3.5' />
						Bias Detection
					</TabsTrigger>
					<TabsTrigger value='bias-history' className='gap-1'>
						<History className='h-3.5 w-3.5' />
						Bias History
					</TabsTrigger>
					<TabsTrigger value='explanations' className='gap-1'>
						<BrainCircuit className='h-3.5 w-3.5' />
						Explainability
					</TabsTrigger>
					<TabsTrigger value='overrides' className='gap-1'>
						<GitPullRequest className='h-3.5 w-3.5' />
						Overrides
					</TabsTrigger>
					<TabsTrigger value='risk-checklist' className='gap-1'>
						<ListChecks className='h-3.5 w-3.5' />
						Risk Checklist
					</TabsTrigger>
					<TabsTrigger value='performance' className='gap-1'>
						<BarChart3 className='h-3.5 w-3.5' />
						Model Performance
					</TabsTrigger>
					<TabsTrigger value='transparency' className='gap-1'>
						<Eye className='h-3.5 w-3.5' />
						Transparency
					</TabsTrigger>
					<TabsTrigger value='consent' className='gap-1'>
						<Hand className='h-3.5 w-3.5' />
						Consent
					</TabsTrigger>
					<TabsTrigger value='data-requests' className='gap-1'>
						<Database className='h-3.5 w-3.5' />
						Data Requests
					</TabsTrigger>
					<TabsTrigger value='appeals' className='gap-1'>
						<Gavel className='h-3.5 w-3.5' />
						Appeals
					</TabsTrigger>
					<TabsTrigger value='retention' className='gap-1'>
						<Settings2 className='h-3.5 w-3.5' />
						Retention
					</TabsTrigger>
					<TabsTrigger value='risk-classification' className='gap-1'>
						<ShieldAlert className='h-3.5 w-3.5' />
						Risk Classification
					</TabsTrigger>
					<TabsTrigger value='human-oversight' className='gap-1'>
						<UserCheck className='h-3.5 w-3.5' />
						Human Oversight
					</TabsTrigger>
					<TabsTrigger value='transparency-obligations' className='gap-1'>
						<Eye className='h-3.5 w-3.5' />
						Transparency
					</TabsTrigger>
					<TabsTrigger value='data-governance' className='gap-1'>
						<Database className='h-3.5 w-3.5' />
						Data Governance
					</TabsTrigger>
					<TabsTrigger value='conformity' className='gap-1'>
						<FileCheck className='h-3.5 w-3.5' />
						Conformity
					</TabsTrigger>
				</TabsList>

				<TabsContent value='overview' className='mt-4'>
					{loading ? (
						<Skeleton count={4} variant='card' />
					) : !riskChecklistSummary ? (
						<EmptyState
							icon={ShieldCheck}
							title='Compliance score not available'
							description='Complete the risk checklist to generate a compliance score'
						/>
					) : (
						<div className='space-y-4'>
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
									title='Requirements Complete'
									value={`${riskChecklistSummary.completed} / ${riskChecklistSummary.total}`}
									trend='up'
									trendValue={`${Math.round((riskChecklistSummary.completed / Math.max(riskChecklistSummary.total, 1)) * 100)}%`}
									icon={<CheckCircle className='h-4 w-4' />}
								/>
								<ChartCard
									title='Pending Actions'
									value={riskChecklistSummary.pending + riskChecklistSummary.incomplete}
									trend={
										riskChecklistSummary.pending + riskChecklistSummary.incomplete > 0
											? 'down'
											: 'neutral'
									}
									trendValue={
										riskChecklistSummary.pending + riskChecklistSummary.incomplete > 0
											? 'Action needed'
											: 'Clean'
									}
									icon={<Clock className='h-4 w-4' />}
								/>
								<ChartCard
									title='In Progress'
									value={riskChecklistSummary.inProgress}
									icon={<Activity className='h-4 w-4' />}
								/>
							</div>

							<Card>
								<CardHeader>
									<CardTitle className='flex items-center gap-2'>
										<PieChart className='h-5 w-5' />
										Score Breakdown
									</CardTitle>
								</CardHeader>
								<CardContent className='space-y-6'>
									<div className='space-y-2'>
										<div className='flex justify-between text-sm'>
											<span className='font-medium'>Complete</span>
											<span className='text-green-600 font-medium'>
												{riskChecklistSummary.completed}
											</span>
										</div>
										<Progress
											value={riskChecklistSummary.completed}
											max={riskChecklistSummary.total}
										/>
									</div>
									<div className='space-y-2'>
										<div className='flex justify-between text-sm'>
											<span className='font-medium'>In Progress</span>
											<span className='text-blue-600 font-medium'>
												{riskChecklistSummary.inProgress}
											</span>
										</div>
										<Progress
											value={riskChecklistSummary.inProgress}
											max={riskChecklistSummary.total}
										/>
									</div>
									<div className='space-y-2'>
										<div className='flex justify-between text-sm'>
											<span className='font-medium'>Pending</span>
											<span className='text-amber-600 font-medium'>
												{riskChecklistSummary.pending}
											</span>
										</div>
										<Progress
											value={riskChecklistSummary.pending}
											max={riskChecklistSummary.total}
										/>
									</div>
									<div className='space-y-2'>
										<div className='flex justify-between text-sm'>
											<span className='font-medium'>Incomplete</span>
											<span className='text-red-600 font-medium'>
												{riskChecklistSummary.incomplete}
											</span>
										</div>
										<Progress
											value={riskChecklistSummary.incomplete}
											max={riskChecklistSummary.total}
										/>
									</div>

									<Separator />

									<div className='grid gap-4 sm:grid-cols-2'>
										<div className='space-y-2'>
											<h4 className='font-semibold text-sm'>Overall Status</h4>
											<Badge
												className={
													riskChecklistSummary.overallStatus === 'compliant'
														? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
														: riskChecklistSummary.overallStatus === 'needs_attention'
															? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
															: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
												}
											>
												{riskChecklistSummary.overallStatus === 'compliant'
													? 'Compliant'
													: riskChecklistSummary.overallStatus === 'needs_attention'
														? 'Needs Attention'
														: 'Partially Compliant'}
											</Badge>
										</div>
										<div className='space-y-2'>
											<h4 className='font-semibold text-sm'>Next Review</h4>
											<p className='text-sm text-muted-foreground'>
												{new Date(riskChecklistSummary.nextReview).toLocaleDateString(undefined, {
													year: 'numeric',
													month: 'long',
													day: 'numeric',
												})}
											</p>
										</div>
									</div>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle className='flex items-center gap-2'>
										<AlertTriangle className='h-5 w-5' />
										Priority Actions
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className='space-y-2'>
										{riskChecklist
											.filter((item) => item.status === 'incomplete' || item.status === 'pending')
											.slice(0, 5)
											.map((item) => (
												<div key={item.id} className='flex items-start gap-3 p-3 rounded-lg border'>
													<div className='shrink-0 mt-0.5'>
														{item.status === 'incomplete' ? (
															<XCircle className='h-4 w-4 text-red-500' />
														) : (
															<Clock className='h-4 w-4 text-amber-500' />
														)}
													</div>
													<div className='flex-1'>
														<p className='text-sm font-medium'>{item.item}</p>
														<p className='text-xs text-muted-foreground'>
															{item.category} — {item.eu_ai_act_ref}
														</p>
													</div>
													<Badge variant='outline' className='text-xs shrink-0'>
														{item.status === 'incomplete' ? 'Incomplete' : 'Pending'}
													</Badge>
												</div>
											))}
										{riskChecklist.filter(
											(item) => item.status === 'incomplete' || item.status === 'pending',
										).length === 0 && (
											<div className='flex items-center gap-2 text-sm text-green-600'>
												<CheckCircle className='h-4 w-4' />
												All requirements are complete. No priority actions needed.
											</div>
										)}
									</div>
								</CardContent>
							</Card>
						</div>
					)}
				</TabsContent>

				<TabsContent value='audit' className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='table' />
					) : decisions.length === 0 ? (
						<EmptyState
							icon={FileText}
							title='No audit records yet'
							description='AI decision audit trail will appear here once decisions are made'
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
											{biasReport.topConcerns.map((concern, i) => (
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
											{biasReport.improvements.map((item, i) => (
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

				<TabsContent value='bias-history' className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='table' />
					) : biasHistory.length === 0 ? (
						<EmptyState
							icon={History}
							title='No bias history available'
							description='Historical bias audit reports will appear once audits are conducted'
						/>
					) : (
						<div className='space-y-4'>
							<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
								<ChartCard
									title='Total Audits'
									value={biasHistory.length}
									icon={<History className='h-4 w-4' />}
								/>
								<ChartCard
									title='Avg Fairness Score'
									value={`${(biasHistory.reduce((s, r) => s + r.overallFairnessScore, 0) / Math.max(biasHistory.length, 1)).toFixed(1)}%`}
									icon={<TrendingUp className='h-4 w-4' />}
								/>
								<ChartCard
									title='Total Issues'
									value={biasHistory.reduce((s, r) => s + r.issuesFound, 0)}
									trend={biasHistory.reduce((s, r) => s + r.issuesFound, 0) > 0 ? 'down' : 'up'}
									trendValue={
										biasHistory.reduce((s, r) => s + r.issuesFound, 0) > 0
											? 'Needs attention'
											: 'Clean'
									}
									icon={<AlertTriangle className='h-4 w-4' />}
								/>
								<ChartCard
									title='Total Appeals'
									value={biasHistory.reduce((s, r) => s + r.appealCount, 0)}
									icon={<Users className='h-4 w-4' />}
								/>
							</div>
							<Card>
								<CardHeader>
									<CardTitle className='flex items-center gap-2'>
										<History className='h-5 w-5' />
										Historical Bias Audit Reports
									</CardTitle>
								</CardHeader>
								<CardContent>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Date</TableHead>
												<TableHead>Type</TableHead>
												<TableHead>Fairness Score</TableHead>
												<TableHead>Issues</TableHead>
												<TableHead>Demographics</TableHead>
												<TableHead>Appeals</TableHead>
												<TableHead>Created</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{biasHistory.map((report) => (
												<TableRow key={report.id}>
													<TableCell className='text-xs whitespace-nowrap'>
														{new Date(report.auditDate).toLocaleDateString()}
													</TableCell>
													<TableCell>
														<Badge variant='outline' className='text-xs capitalize'>
															{report.auditType}
														</Badge>
													</TableCell>
													<TableCell>
														<div className='flex items-center gap-2'>
															<Progress
																value={report.overallFairnessScore}
																max={100}
																className='h-2 w-24'
															/>
															<span className='text-xs font-medium'>
																{report.overallFairnessScore.toFixed(1)}%
															</span>
														</div>
													</TableCell>
													<TableCell>
														{report.issuesFound > 0 ? (
															<Badge variant='destructive' className='text-xs'>
																{report.issuesFound}
															</Badge>
														) : (
															<span className='text-xs text-muted-foreground'>—</span>
														)}
													</TableCell>
													<TableCell className='text-xs'>{report.demographicCount}</TableCell>
													<TableCell className='text-xs'>{report.appealCount}</TableCell>
													<TableCell className='text-xs text-muted-foreground whitespace-nowrap'>
														{new Date(report.createdAt).toLocaleDateString()}
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

				<TabsContent value='explanations' className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='table' />
					) : explanations.length === 0 ? (
						<EmptyState
							icon={BrainCircuit}
							title='No explainability logs yet'
							description='AI explanation records will appear here once explanations are viewed or generated'
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
												<TableHead>Action</TableHead>
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
														<Badge variant='secondary' className='text-xs'>
															{e.actionType}
														</Badge>
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
							description='Records of recruiters overriding AI decisions will appear here'
						/>
					) : (
						<div className='space-y-4'>
							<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
								<ChartCard
									title='Total Overrides'
									value={overrides.length}
									icon={<GitPullRequest className='h-4 w-4' />}
								/>
								<ChartCard
									title='Avg AI Confidence'
									value={`${((overrides.reduce((sum, o) => sum + o.aiConfidence, 0) / Math.max(overrides.length, 1)) * 100).toFixed(1)}%`}
									icon={<Activity className='h-4 w-4' />}
								/>
								<ChartCard
									title='Unique Recruiters'
									value={new Set(overrides.map((o) => o.overriddenBy.id)).size}
									icon={<Users className='h-4 w-4' />}
								/>
								<ChartCard
									title='Last 24h'
									value={
										overrides.filter(
											(o) => new Date(o.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000),
										).length
									}
									icon={<Clock className='h-4 w-4' />}
								/>
							</div>
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
														<p className='font-medium text-sm'>{o.candidate.name}</p>
														<p className='text-xs text-muted-foreground'>ID: {o.candidate.id}</p>
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

				<TabsContent value='performance' className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='card' />
					) : !modelPerformance ? (
						<EmptyState
							icon={BarChart3}
							title='Model performance data not available'
							description='Performance metrics will appear once AI decisions are logged'
						/>
					) : (
						<div className='space-y-4'>
							<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
								<ChartCard
									title='Total Decisions (30d)'
									value={modelPerformance.totalDecisions}
									icon={<FileText className='h-4 w-4' />}
								/>
								<ChartCard
									title='Human Review Rate'
									value={`${(modelPerformance.reviewRate * 100).toFixed(1)}%`}
									trend={modelPerformance.reviewRate >= 0.9 ? 'up' : 'down'}
									trendValue={modelPerformance.reviewRate >= 0.9 ? 'On target' : 'Needs review'}
									icon={<Eye className='h-4 w-4' />}
								/>
								<ChartCard
									title='Active Models'
									value={modelPerformance.modelPerformance.length}
									icon={<BrainCircuit className='h-4 w-4' />}
								/>
								<ChartCard
									title='Avg Confidence'
									value={
										modelPerformance.modelPerformance.length > 0
											? `${(
													(modelPerformance.modelPerformance.reduce(
														(s, m) => s + m.avgConfidence,
														0,
													) /
														modelPerformance.modelPerformance.length) *
														100
												).toFixed(1)}%`
											: 'N/A'
									}
									icon={<TrendingUp className='h-4 w-4' />}
								/>
							</div>

							<Card>
								<CardHeader>
									<CardTitle className='flex items-center gap-2'>
										<BarChart3 className='h-5 w-5' />
										Volume Over Time
									</CardTitle>
								</CardHeader>
								<CardContent>
									{modelPerformance.volumeOverTime.length === 0 ? (
										<p className='text-sm text-muted-foreground'>
											No volume data available for the selected period.
										</p>
									) : (
										<div className='space-y-3'>
											{modelPerformance.volumeOverTime.map((day) => (
												<div key={day.date} className='space-y-1'>
													<div className='flex justify-between text-sm'>
														<span className='text-muted-foreground'>
															{new Date(day.date).toLocaleDateString()}
														</span>
														<span className='font-medium'>{day.count}</span>
													</div>
													<Progress
														value={day.count}
														max={Math.max(...modelPerformance.volumeOverTime.map((d) => d.count))}
														className='h-2'
													/>
												</div>
											))}
										</div>
									)}
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle className='flex items-center gap-2'>
										<BrainCircuit className='h-5 w-5' />
										Model Performance by System
									</CardTitle>
								</CardHeader>
								<CardContent>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Model</TableHead>
												<TableHead>Decisions</TableHead>
												<TableHead>Avg Confidence</TableHead>
												<TableHead>Override Rate</TableHead>
												<TableHead>Health</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{modelPerformance.modelPerformance.map((model) => (
												<TableRow key={model.model}>
													<TableCell className='font-medium text-sm'>{model.model}</TableCell>
													<TableCell>{model.decisions}</TableCell>
													<TableCell>{(model.avgConfidence * 100).toFixed(1)}%</TableCell>
													<TableCell>{(model.overrideRate * 100).toFixed(1)}%</TableCell>
													<TableCell>
														{model.overrideRate > 0.1 ? (
															<Badge variant='destructive' className='text-xs'>
																High Override
															</Badge>
														) : model.avgConfidence < 0.7 ? (
															<Badge
																variant='outline'
																className='text-xs text-amber-600 border-amber-200'
															>
																Low Confidence
															</Badge>
														) : (
															<Badge
																variant='outline'
																className='text-xs text-green-600 border-green-200'
															>
																<CheckCircle className='h-3 w-3 mr-1' />
																Healthy
															</Badge>
														)}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle className='flex items-center gap-2'>
										<BarChart3 className='h-5 w-5' />
										Score Distribution
									</CardTitle>
								</CardHeader>
								<CardContent>
									{modelPerformance.scoreDistribution.length === 0 ? (
										<p className='text-sm text-muted-foreground'>
											No score data available for the selected period.
										</p>
									) : (
										<div className='space-y-3'>
											{modelPerformance.scoreDistribution.map((bucket) => (
												<div key={bucket.bucket} className='space-y-1'>
													<div className='flex justify-between text-sm'>
														<span className='text-muted-foreground'>
															{bucket.bucket}-{bucket.bucket + 9}
														</span>
														<span className='font-medium'>{bucket.count}</span>
													</div>
													<Progress
														value={bucket.count}
														max={Math.max(
															...modelPerformance.scoreDistribution.map((b) => b.count),
														)}
														className='h-2'
													/>
												</div>
											))}
										</div>
									)}
								</CardContent>
							</Card>
						</div>
					)}
				</TabsContent>

				<TabsContent value='transparency' className='mt-4'>
					<Card>
						<CardHeader>
							<CardTitle>EU AI Act Transparency Report</CardTitle>
						</CardHeader>
						<CardContent className='space-y-4'>
							<div className='space-y-2'>
								<h3 className='font-semibold'>1. AI System Description</h3>
								<p className='text-sm text-muted-foreground'>
									Rekrut AI uses multiple AI models for candidate screening, job matching, interview
									assessment, and scoring. All decisions are logged with explainability and audit
									trails in accordance with Article 13 of the EU AI Act.
								</p>
							</div>
							<div className='space-y-2'>
								<h3 className='font-semibold'>2. Decision Making Process</h3>
								<p className='text-sm text-muted-foreground'>
									AI models analyze candidate profiles, job requirements, interview responses, and
									documents. Human reviewers can override AI decisions. All overrides are logged as
									per Article 14 of the EU AI Act.
								</p>
							</div>
							<div className='space-y-2'>
								<h3 className='font-semibold'>3. Data Usage & Consent</h3>
								<p className='text-sm text-muted-foreground'>
									Candidate data is used solely for hiring purposes with explicit consent. Data
									retention follows GDPR and EU AI Act requirements. Candidates can request deletion
									at any time (Articles 14(4) and GDPR Art. 17).
								</p>
							</div>
							<div className='space-y-2'>
								<h3 className='font-semibold'>4. Human Oversight</h3>
								<p className='text-sm text-muted-foreground'>
									All high-risk AI decisions require human review. Recruiters can override AI
									recommendations. Bias detection runs continuously on all decisions as per Article
									14 of the EU AI Act.
								</p>
							</div>
							<div className='space-y-2'>
								<h3 className='font-semibold'>5. Rights of Individuals</h3>
								<p className='text-sm text-muted-foreground'>
									Candidates have the right to: request explanation of AI decisions (Article 13),
									challenge decisions (Article 14), request human review (Article 14), appeal
									scores, and access their data (GDPR Art. 15).
								</p>
							</div>
							<div className='space-y-2'>
								<h3 className='font-semibold'>6. Data Retention Policies</h3>
								<p className='text-sm text-muted-foreground'>
									Audit logs are retained for 7 years for compliance purposes. Interview recordings
									are deleted after 2 years. Assessment results are kept for 5 years. Inactive
									candidate data is removed after 3 years. All policies are configurable and
									auditable.
								</p>
							</div>
							<Button variant='outline' className='gap-1' onClick={handleExport}>
								<Download className='h-4 w-4' />
								Download Full Transparency Report
							</Button>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value='consent' className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='table' />
					) : consents.length === 0 ? (
						<EmptyState
							icon={Hand}
							title='No consent records found'
							description='Consent records will appear here once candidates provide consent through the system'
						/>
					) : (
						<div className='space-y-4'>
							<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
								<div className='flex items-center gap-2'>
									<Badge variant='outline' className='text-xs'>
										Total: {consents.length}
									</Badge>
									<Badge className='bg-green-100 text-green-700 text-xs'>
										Consented: {consents.filter((c) => c.consented).length}
									</Badge>
									<Badge className='bg-red-100 text-red-700 text-xs'>
										Declined: {consents.filter((c) => !c.consented).length}
									</Badge>
								</div>
								<div className='flex gap-2'>
									<select
										className='text-sm border rounded-md px-2 py-1 bg-background'
										value={consentFilter}
										onChange={(e) => setConsentFilter(e.target.value)}
									>
										<option value='all'>All Types</option>
										<option value='ai_processing'>AI Processing</option>
										<option value='data_sharing'>Data Sharing</option>
										<option value='marketing'>Marketing</option>
										<option value='screening'>Screening</option>
									</select>
								</div>
							</div>
							<Card>
								<CardContent className='p-0'>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>User</TableHead>
												<TableHead>Consent Type</TableHead>
												<TableHead>Status</TableHead>
												<TableHead>Consented At</TableHead>
												<TableHead>IP Address</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{consents
												.filter((c) => consentFilter === 'all' || c.consentType === consentFilter)
												.map((c) => (
													<TableRow key={c.id}>
														<TableCell>
															<div>
																<p className='font-medium text-sm'>{c.userName || c.userEmail}</p>
																<p className='text-xs text-muted-foreground'>ID: {c.userId}</p>
															</div>
														</TableCell>
														<TableCell>
															<Badge variant='outline' className='text-xs capitalize'>
																{c.consentType.replace('_', ' ')}
															</Badge>
														</TableCell>
														<TableCell>
															{c.consented ? (
																<Badge className='bg-green-100 text-green-700 text-xs'>
																	<UserCheck className='h-3 w-3 mr-1' />
																	Consented
																</Badge>
															) : (
																<Badge className='bg-red-100 text-red-700 text-xs'>
																	<UserX className='h-3 w-3 mr-1' />
																	Declined
																</Badge>
															)}
														</TableCell>
														<TableCell className='text-xs text-muted-foreground'>
															{c.consentedAt ? new Date(c.consentedAt).toLocaleString() : 'N/A'}
														</TableCell>
														<TableCell className='text-xs text-muted-foreground'>
															{c.ipAddress || '—'}
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

				<TabsContent value='data-requests' className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='table' />
					) : dataRequests.length === 0 ? (
						<EmptyState
							icon={Database}
							title='No data requests found'
							description='GDPR data export and deletion requests will appear here'
						/>
					) : (
						<div className='space-y-4'>
							<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
								<div className='flex items-center gap-2'>
									<Badge variant='outline' className='text-xs'>
										Total: {dataRequests.length}
									</Badge>
									<Badge className='bg-yellow-100 text-yellow-700 text-xs'>
										Pending: {dataRequests.filter((r) => r.status === 'pending').length}
									</Badge>
									<Badge className='bg-green-100 text-green-700 text-xs'>
										Completed: {dataRequests.filter((r) => r.status === 'completed').length}
									</Badge>
								</div>
								<div className='flex gap-2'>
									<select
										className='text-sm border rounded-md px-2 py-1 bg-background'
										value={dataRequestFilter}
										onChange={(e) => setDataRequestFilter(e.target.value)}
									>
										<option value='all'>All Statuses</option>
										<option value='pending'>Pending</option>
										<option value='processing'>Processing</option>
										<option value='completed'>Completed</option>
										<option value='rejected'>Rejected</option>
									</select>
									<select
										className='text-sm border rounded-md px-2 py-1 bg-background'
										value={dataRequestTypeFilter}
										onChange={(e) => setDataRequestTypeFilter(e.target.value)}
									>
										<option value='all'>All Types</option>
										<option value='export'>Export</option>
										<option value='delete'>Deletion</option>
									</select>
								</div>
							</div>
							<Card>
								<CardContent className='p-0'>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>User</TableHead>
												<TableHead>Type</TableHead>
												<TableHead>Status</TableHead>
												<TableHead>Requested</TableHead>
												<TableHead>Processed</TableHead>
												<TableHead>Processor</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{dataRequests
												.filter(
													(r) => dataRequestFilter === 'all' || r.status === dataRequestFilter,
												)
												.filter(
													(r) =>
														dataRequestTypeFilter === 'all' ||
														r.requestType === dataRequestTypeFilter,
												)
												.map((r) => (
													<TableRow key={r.id}>
														<TableCell>
															<div>
																<p className='font-medium text-sm'>{r.userName || r.userEmail}</p>
																<p className='text-xs text-muted-foreground'>ID: {r.userId}</p>
															</div>
														</TableCell>
														<TableCell>
															<Badge variant='outline' className='text-xs capitalize'>
																{r.requestType === 'export'
																	? 'Data Export'
																	: 'Right to be Forgotten'}
															</Badge>
														</TableCell>
														<TableCell>
															<Badge
																className={
																	r.status === 'completed'
																		? 'bg-green-100 text-green-700 text-xs'
																		: r.status === 'pending'
																			? 'bg-yellow-100 text-yellow-700 text-xs'
																			: r.status === 'processing'
																				? 'bg-blue-100 text-blue-700 text-xs'
																				: 'bg-red-100 text-red-700 text-xs'
																}
															>
																{r.status}
															</Badge>
														</TableCell>
														<TableCell className='text-xs text-muted-foreground'>
															{r.requestedAt ? new Date(r.requestedAt).toLocaleString() : 'N/A'}
														</TableCell>
														<TableCell className='text-xs text-muted-foreground'>
															{r.processedAt ? new Date(r.processedAt).toLocaleString() : '—'}
														</TableCell>
														<TableCell className='text-xs text-muted-foreground'>
															{r.processorEmail || '—'}
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

				<TabsContent value='appeals' className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='table' />
					) : appeals.length === 0 ? (
						<EmptyState
							icon={Gavel}
							title='No score appeals found'
							description='Score appeals will appear here once candidates submit them'
						/>
					) : (
						<div className='space-y-4'>
							<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
								<div className='flex items-center gap-2'>
									<Badge variant='outline' className='text-xs'>
										Total: {appeals.length}
									</Badge>
									<Badge className='bg-yellow-100 text-yellow-700 text-xs'>
										Pending: {appeals.filter((a) => a.status === 'pending').length}
									</Badge>
									<Badge className='bg-green-100 text-green-700 text-xs'>
										Resolved:{' '}
										{
											appeals.filter((a) => a.status === 'approved' || a.status === 'rejected')
												.length
										}
									</Badge>
								</div>
								<div className='flex gap-2'>
									<select
										className='text-sm border rounded-md px-2 py-1 bg-background'
										value={appealFilter}
										onChange={(e) => setAppealFilter(e.target.value)}
									>
										<option value='all'>All Statuses</option>
										<option value='pending'>Pending</option>
										<option value='approved'>Approved</option>
										<option value='rejected'>Rejected</option>
									</select>
								</div>
							</div>
							<Card>
								<CardContent className='p-0'>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>User</TableHead>
												<TableHead>Score Type</TableHead>
												<TableHead>Original Score</TableHead>
												<TableHead>Reason</TableHead>
												<TableHead>Status</TableHead>
												<TableHead>Reviewer</TableHead>
												<TableHead>New Score</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{appeals
												.filter((a) => appealFilter === 'all' || a.status === appealFilter)
												.map((a) => (
													<TableRow key={a.id}>
														<TableCell>
															<div>
																<p className='font-medium text-sm'>{a.userName || a.userEmail}</p>
																<p className='text-xs text-muted-foreground'>ID: {a.userId}</p>
															</div>
														</TableCell>
														<TableCell>
															<Badge variant='outline' className='text-xs capitalize'>
																{a.scoreType}
															</Badge>
														</TableCell>
														<TableCell className='font-medium'>{a.originalScore}</TableCell>
														<TableCell className='text-xs text-muted-foreground max-w-xs truncate'>
															{a.appealReason}
														</TableCell>
														<TableCell>
															<Badge
																className={
																	a.status === 'approved'
																		? 'bg-green-100 text-green-700 text-xs'
																		: a.status === 'rejected'
																			? 'bg-red-100 text-red-700 text-xs'
																			: 'bg-yellow-100 text-yellow-700 text-xs'
																}
															>
																{a.status}
															</Badge>
														</TableCell>
														<TableCell className='text-xs text-muted-foreground'>
															{a.reviewerEmail || '—'}
														</TableCell>
														<TableCell className='font-medium'>
															{a.newScore !== null ? a.newScore : '—'}
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

				<TabsContent value='retention' className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='card' />
					) : retentionPolicies.length === 0 ? (
						<EmptyState
							icon={Settings2}
							title='No retention policies configured'
							description='Retention policies will appear here once configured'
						/>
					) : (
						<div className='space-y-4'>
							<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
								<ChartCard
									title='Total Policies'
									value={retentionPolicies.length}
									icon={<Settings2 className='h-4 w-4' />}
								/>
								<ChartCard
									title='Auto-Delete Enabled'
									value={retentionPolicies.filter((p) => p.autoDelete).length}
									icon={<Trash2 className='h-4 w-4' />}
								/>
								<ChartCard
									title='Avg Retention'
									value={`${Math.round(retentionPolicies.reduce((s, p) => s + p.retentionDays, 0) / Math.max(retentionPolicies.length, 1))} days`}
									icon={<Clock className='h-4 w-4' />}
								/>
								<ChartCard
									title='Longest Retention'
									value={`${Math.max(...retentionPolicies.map((p) => p.retentionDays))} days`}
									icon={<Calendar className='h-4 w-4' />}
								/>
							</div>
							<Card>
								<CardHeader>
									<CardTitle>Data Retention Policies</CardTitle>
								</CardHeader>
								<CardContent>
									<div className='space-y-4'>
										{retentionPolicies.map((policy) => (
											<div
												key={policy.id}
												className='flex items-center justify-between p-4 border rounded-lg'
											>
												<div className='space-y-1'>
													<div className='flex items-center gap-2'>
														<p className='font-medium text-sm capitalize'>
															{policy.dataType.replace('_', ' ')}
														</p>
														{policy.autoDelete ? (
															<Badge className='bg-green-100 text-green-700 text-xs'>
																<CheckCircle className='h-3 w-3 mr-1' />
																Auto-Delete
															</Badge>
														) : (
															<Badge variant='outline' className='text-xs'>
																Manual
															</Badge>
														)}
													</div>
													<p className='text-xs text-muted-foreground'>{policy.description}</p>
												</div>
												<div className='flex items-center gap-4'>
													{editingPolicy === policy.id ? (
														<div className='flex items-center gap-2'>
															<input
																type='number'
																className='w-24 text-sm border rounded-md px-2 py-1'
																value={policyForm.retentionDays}
																onChange={(e) =>
																	setPolicyForm({
																		...policyForm,
																		retentionDays: parseInt(e.target.value, 10) || 0,
																	})
																}
																min={1}
															/>
															<span className='text-xs text-muted-foreground'>days</span>
															<label className='flex items-center gap-1 text-xs'>
																<input
																	type='checkbox'
																	checked={policyForm.autoDelete}
																	onChange={(e) =>
																		setPolicyForm({ ...policyForm, autoDelete: e.target.checked })
																	}
																/>
																Auto
															</label>
															<Button
																size='sm'
																onClick={async () => {
																	try {
																		await apiCall(
																			`/admin/compliance/retention-policies/${policy.id}`,
																			{
																				method: 'PUT',
																				body: JSON.stringify({
																					retentionDays: policyForm.retentionDays,
																					autoDelete: policyForm.autoDelete,
																				}),
																			},
																		)
																		setRetentionPolicies((prev) =>
																			prev.map((p) =>
																				p.id === policy.id
																					? {
																							...p,
																							retentionDays: policyForm.retentionDays,
																							autoDelete: policyForm.autoDelete,
																						}
																					: p,
																			),
																		)
																		setEditingPolicy(null)
																	} catch (err) {
																		console.error('Failed to update policy:', err)
																	}
																}}
															>
																Save
															</Button>
															<Button
																size='sm'
																variant='ghost'
																onClick={() => setEditingPolicy(null)}
															>
																Cancel
															</Button>
														</div>
													) : (
														<>
															<div className='text-right'>
																<p className='font-medium text-sm'>{policy.retentionDays} days</p>
																<p className='text-xs text-muted-foreground'>
																	~{Math.round((policy.retentionDays / 365) * 10) / 10} years
																</p>
															</div>
															<Button
																size='sm'
																variant='outline'
																onClick={() => {
																	setEditingPolicy(policy.id)
																	setPolicyForm({
																		retentionDays: policy.retentionDays,
																		autoDelete: policy.autoDelete,
																	})
																}}
															>
																Edit
															</Button>
														</>
													)}
												</div>
											</div>
										))}
									</div>
								</CardContent>
							</Card>
						</div>
					)}
				</TabsContent>

				{/* EU AI Act Article 6 — Risk Classification */}
				<TabsContent value='risk-classification' className='mt-4'>
					<div className='space-y-4'>
						<Card>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									<ShieldAlert className='h-5 w-5 text-red-500' />
									EU AI Act Article 6 — Risk Classification
								</CardTitle>
							</CardHeader>
							<CardContent className='p-0'>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Feature</TableHead>
											<TableHead>Risk Level</TableHead>
											<TableHead>Article 6 Classification</TableHead>
											<TableHead>Justification</TableHead>
											<TableHead>Mitigation Measures</TableHead>
											<TableHead>Status</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										<TableRow>
											<TableCell className='font-medium'>AI Screening</TableCell>
											<TableCell>
												<Badge className='bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'>
													<ShieldAlert className='h-3 w-3 mr-1' />
													High Risk
												</Badge>
											</TableCell>
											<TableCell className='text-xs'>
												Art. 6(2)(a) — Employment & recruitment
											</TableCell>
											<TableCell className='text-sm text-muted-foreground'>
												AI system evaluates candidates for employment decisions affecting access to
												employment
											</TableCell>
											<TableCell className='text-sm text-muted-foreground'>
												Human-in-the-loop review, bias monitoring, explainability, audit trails
											</TableCell>
											<TableCell>
												<Badge
													variant='outline'
													className='text-xs text-green-600 border-green-200'
												>
													<CheckCircle className='h-3 w-3 mr-1' />
													Compliant
												</Badge>
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell className='font-medium'>Automated Matching</TableCell>
											<TableCell>
												<Badge className='bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'>
													<ShieldAlert className='h-3 w-3 mr-1' />
													High Risk
												</Badge>
											</TableCell>
											<TableCell className='text-xs'>
												Art. 6(2)(a) — Employment & recruitment
											</TableCell>
											<TableCell className='text-sm text-muted-foreground'>
												AI system ranks and matches candidates to jobs, affecting recruitment
												outcomes
											</TableCell>
											<TableCell className='text-sm text-muted-foreground'>
												Human approval required, override capability, transparency reports
											</TableCell>
											<TableCell>
												<Badge
													variant='outline'
													className='text-xs text-green-600 border-green-200'
												>
													<CheckCircle className='h-3 w-3 mr-1' />
													Compliant
												</Badge>
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell className='font-medium'>Video Interview Analysis</TableCell>
											<TableCell>
												<Badge className='bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'>
													<ShieldAlert className='h-3 w-3 mr-1' />
													High Risk
												</Badge>
											</TableCell>
											<TableCell className='text-xs'>
												Art. 6(2)(a) — Employment & recruitment
											</TableCell>
											<TableCell className='text-sm text-muted-foreground'>
												AI analyzes video interview responses and facial expressions for candidate
												assessment
											</TableCell>
											<TableCell className='text-sm text-muted-foreground'>
												Explicit consent, human review, data minimization, retention limits
											</TableCell>
											<TableCell>
												<Badge
													variant='outline'
													className='text-xs text-green-600 border-green-200'
												>
													<CheckCircle className='h-3 w-3 mr-1' />
													Compliant
												</Badge>
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell className='font-medium'>OmniScore & TrustScore</TableCell>
											<TableCell>
												<Badge className='bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'>
													<ShieldAlert className='h-3 w-3 mr-1' />
													High Risk
												</Badge>
											</TableCell>
											<TableCell className='text-xs'>
												Art. 6(2)(a) — Employment & recruitment
											</TableCell>
											<TableCell className='text-sm text-muted-foreground'>
												Composite scoring systems used to evaluate candidate suitability
											</TableCell>
											<TableCell className='text-sm text-muted-foreground'>
												Score appeals, explainability logs, human override, bias audits
											</TableCell>
											<TableCell>
												<Badge
													variant='outline'
													className='text-xs text-green-600 border-green-200'
												>
													<CheckCircle className='h-3 w-3 mr-1' />
													Compliant
												</Badge>
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell className='font-medium'>Candidate Chatbot</TableCell>
											<TableCell>
												<Badge className='bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'>
													<Shield className='h-3 w-3 mr-1' />
													Limited Risk
												</Badge>
											</TableCell>
											<TableCell className='text-xs'>Art. 6(3) — Chatbot interaction</TableCell>
											<TableCell className='text-sm text-muted-foreground'>
												AI chatbot interacts with candidates; users should be informed they are
												interacting with AI
											</TableCell>
											<TableCell className='text-sm text-muted-foreground'>
												Clear disclosure, opt-out to human support
											</TableCell>
											<TableCell>
												<Badge
													variant='outline'
													className='text-xs text-green-600 border-green-200'
												>
													<CheckCircle className='h-3 w-3 mr-1' />
													Compliant
												</Badge>
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell className='font-medium'>Job Description Generator</TableCell>
											<TableCell>
												<Badge className='bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'>
													<ShieldCheck className='h-3 w-3 mr-1' />
													Minimal Risk
												</Badge>
											</TableCell>
											<TableCell className='text-xs'>Art. 6(1) — Not listed</TableCell>
											<TableCell className='text-sm text-muted-foreground'>
												Generative AI for drafting job descriptions; no direct decision-making
												impact on individuals
											</TableCell>
											<TableCell className='text-sm text-muted-foreground'>
												Human review before publication, content policies
											</TableCell>
											<TableCell>
												<Badge
													variant='outline'
													className='text-xs text-green-600 border-green-200'
												>
													<CheckCircle className='h-3 w-3 mr-1' />
													Compliant
												</Badge>
											</TableCell>
										</TableRow>
									</TableBody>
								</Table>
							</CardContent>
						</Card>

						<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
							<Card>
								<CardContent className='p-4'>
									<div className='flex items-center gap-2'>
										<ShieldAlert className='h-5 w-5 text-red-500' />
										<h3 className='font-semibold'>High-Risk Systems</h3>
									</div>
									<p className='text-sm text-muted-foreground mt-2'>
										4 systems classified as high-risk under Article 6(2)(a) — employment &
										recruitment. These require full conformity assessment, human oversight,
										transparency obligations, and ongoing bias monitoring.
									</p>
									<div className='mt-3 flex gap-2'>
										<Badge className='bg-red-100 text-red-700 text-xs'>4 Systems</Badge>
										<Badge variant='outline' className='text-xs'>
											Full Assessment Required
										</Badge>
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardContent className='p-4'>
									<div className='flex items-center gap-2'>
										<Shield className='h-5 w-5 text-amber-500' />
										<h3 className='font-semibold'>Limited-Risk Systems</h3>
									</div>
									<p className='text-sm text-muted-foreground mt-2'>
										1 system classified as limited-risk. Requires transparency obligations under
										Article 52 so users are aware they are interacting with AI.
									</p>
									<div className='mt-3 flex gap-2'>
										<Badge className='bg-amber-100 text-amber-700 text-xs'>1 System</Badge>
										<Badge variant='outline' className='text-xs'>
											Transparency Required
										</Badge>
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardContent className='p-4'>
									<div className='flex items-center gap-2'>
										<ShieldCheck className='h-5 w-5 text-green-500' />
										<h3 className='font-semibold'>Minimal-Risk Systems</h3>
									</div>
									<p className='text-sm text-muted-foreground mt-2'>
										1 system classified as minimal-risk. No additional EU AI Act obligations beyond
										general AI literacy and voluntary codes of conduct.
									</p>
									<div className='mt-3 flex gap-2'>
										<Badge className='bg-green-100 text-green-700 text-xs'>1 System</Badge>
										<Badge variant='outline' className='text-xs'>
											Best Practices
										</Badge>
									</div>
								</CardContent>
							</Card>
						</div>
					</div>
				</TabsContent>

				{/* EU AI Act Article 14 — Human Oversight */}
				<TabsContent value='human-oversight' className='mt-4'>
					<div className='space-y-4'>
						<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
							<ChartCard
								title='Human Review Rate'
								value={
									modelPerformance ? `${(modelPerformance.reviewRate * 100).toFixed(1)}%` : 'N/A'
								}
								trend={modelPerformance && modelPerformance.reviewRate >= 0.9 ? 'up' : 'down'}
								trendValue={
									modelPerformance && modelPerformance.reviewRate >= 0.9
										? 'On target'
										: 'Needs review'
								}
								icon={<Eye className='h-4 w-4' />}
							/>
							<ChartCard
								title='Total Overrides'
								value={overrides.length}
								trend={overrides.length > 0 ? 'up' : 'neutral'}
								trendValue={overrides.length > 0 ? 'Active oversight' : 'No overrides'}
								icon={<GitPullRequest className='h-4 w-4' />}
							/>
							<ChartCard
								title='Pending Review'
								value={decisions.filter((d) => !d.humanReviewed).length}
								trend={decisions.filter((d) => !d.humanReviewed).length > 0 ? 'down' : 'neutral'}
								trendValue={
									decisions.filter((d) => !d.humanReviewed).length > 0
										? 'Action needed'
										: 'All reviewed'
								}
								icon={<Clock className='h-4 w-4' />}
							/>
							<ChartCard
								title='Unique Reviewers'
								value={
									new Set(decisions.filter((d) => d.humanReviewer).map((d) => d.humanReviewer)).size
								}
								icon={<Users className='h-4 w-4' />}
							/>
						</div>

						<Card>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									<UserCheck className='h-5 w-5' />
									Article 14 — Human Oversight Measures
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-4'>
								<div className='grid gap-4 sm:grid-cols-2'>
									<div className='space-y-2'>
										<h4 className='font-semibold text-sm'>1. Human-in-the-Loop Review</h4>
										<p className='text-sm text-muted-foreground'>
											All AI screening, matching, and scoring decisions are presented to a human
											recruiter before any action is taken. The recruiter can approve, reject, or
											modify the AI recommendation.
										</p>
									</div>
									<div className='space-y-2'>
										<h4 className='font-semibold text-sm'>2. Override Capability</h4>
										<p className='text-sm text-muted-foreground'>
											Recruiters can override any AI decision with a documented reason. All
											overrides are logged with the original decision, override reason, and reviewer
											identity for audit purposes.
										</p>
									</div>
									<div className='space-y-2'>
										<h4 className='font-semibold text-sm'>3. Bias Detection Alerts</h4>
										<p className='text-sm text-muted-foreground'>
											Automated bias detection flags decisions that may disproportionately affect
											protected demographics. Flagged decisions are blocked until a senior reviewer
											investigates.
										</p>
									</div>
									<div className='space-y-2'>
										<h4 className='font-semibold text-sm'>4. Explanation Access</h4>
										<p className='text-sm text-muted-foreground'>
											Every AI decision includes an explanation of the factors that influenced the
											outcome. Recruiters can view this explanation before making a final
											determination.
										</p>
									</div>
								</div>
								<Separator />
								<div className='space-y-2'>
									<h4 className='font-semibold text-sm'>Oversight Procedures</h4>
									<ul className='text-sm text-muted-foreground space-y-1'>
										<li>• All high-risk AI decisions require a minimum of one human reviewer</li>
										<li>
											• Bias-flagged decisions require a senior reviewer with anti-discrimination
											training
										</li>
										<li>• Reviewers must complete annual EU AI Act and AI ethics training</li>
										<li>• Override decisions are reviewed quarterly for patterns and compliance</li>
										<li>• Human review metrics are reported to the Compliance Officer monthly</li>
									</ul>
								</div>
							</CardContent>
						</Card>

						{overrides.length > 0 && (
							<Card>
								<CardHeader>
									<CardTitle className='flex items-center gap-2'>
										<GitPullRequest className='h-5 w-5' />
										Recent Human Overrides
									</CardTitle>
								</CardHeader>
								<CardContent className='p-0'>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Timestamp</TableHead>
												<TableHead>Candidate</TableHead>
												<TableHead>Original</TableHead>
												<TableHead>Override</TableHead>
												<TableHead>Reviewer</TableHead>
												<TableHead>Reason</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{overrides.slice(0, 5).map((o) => (
												<TableRow key={o.id}>
													<TableCell className='text-xs text-muted-foreground whitespace-nowrap'>
														{new Date(o.timestamp).toLocaleString()}
													</TableCell>
													<TableCell className='font-medium text-sm'>{o.candidate.name}</TableCell>
													<TableCell>
														<Badge variant='outline' className='text-xs'>
															{o.originalDecision}
														</Badge>
													</TableCell>
													<TableCell>
														<Badge className='bg-blue-100 text-blue-700 text-xs'>
															{o.overrideDecision}
														</Badge>
													</TableCell>
													<TableCell className='text-sm'>{o.overriddenBy.name}</TableCell>
													<TableCell className='text-sm text-muted-foreground max-w-xs truncate'>
														{o.overrideReason}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</CardContent>
							</Card>
						)}
					</div>
				</TabsContent>

				{/* EU AI Act Article 52 — Transparency Obligations */}
				<TabsContent value='transparency-obligations' className='mt-4'>
					<div className='space-y-4'>
						<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
							<ChartCard
								title='Consent Coverage'
								value={
									stats.consents > 0
										? `${Math.round((stats.consented / Math.max(stats.consents, 1)) * 100)}%`
										: '0%'
								}
								trend={
									stats.consents > 0 && stats.consented / Math.max(stats.consents, 1) >= 0.95
										? 'up'
										: 'down'
								}
								trendValue={
									stats.consents > 0 && stats.consented / Math.max(stats.consents, 1) >= 0.95
										? 'On target'
										: 'Needs outreach'
								}
								icon={<Hand className='h-4 w-4' />}
							/>
							<ChartCard
								title='AI Disclosure Sent'
								value={stats.consents}
								icon={<Eye className='h-4 w-4' />}
							/>
							<ChartCard
								title='Explanation Requests'
								value={explanations.length}
								icon={<BrainCircuit className='h-4 w-4' />}
							/>
							<ChartCard
								title='Pending Appeals'
								value={stats.pendingAppeals}
								trend={stats.pendingAppeals > 0 ? 'down' : 'neutral'}
								trendValue={stats.pendingAppeals > 0 ? 'Action needed' : 'Clean'}
								icon={<Gavel className='h-4 w-4' />}
							/>
						</div>

						<Card>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									<Eye className='h-5 w-5 text-blue-500' />
									Article 52 — Transparency Obligations
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-4'>
								<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
									<div className='space-y-2'>
										<div className='flex items-center gap-2'>
											<Info className='h-4 w-4 text-blue-500' />
											<h4 className='font-semibold text-sm'>1. AI Disclosure to Candidates</h4>
										</div>
										<p className='text-sm text-muted-foreground'>
											Candidates are informed before any AI-driven screening, matching, or
											assessment that an AI system will be used. Disclosure includes the purpose,
											nature of data processed, and right to contest.
										</p>
									</div>
									<div className='space-y-2'>
										<div className='flex items-center gap-2'>
											<Hand className='h-4 w-4 text-green-500' />
											<h4 className='font-semibold text-sm'>2. Explicit Consent</h4>
										</div>
										<p className='text-sm text-muted-foreground'>
											Candidates must provide explicit, informed consent before video interview
											analysis or biometric data processing. Consent is recorded with timestamp, IP
											address, and can be withdrawn at any time.
										</p>
									</div>
									<div className='space-y-2'>
										<div className='flex items-center gap-2'>
											<BrainCircuit className='h-4 w-4 text-purple-500' />
											<h4 className='font-semibold text-sm'>3. Right to Explanation</h4>
										</div>
										<p className='text-sm text-muted-foreground'>
											Candidates can request an explanation of any AI decision that affects their
											application. Explanations include the main factors, confidence level, and
											model version used.
										</p>
									</div>
									<div className='space-y-2'>
										<div className='flex items-center gap-2'>
											<Users className='h-4 w-4 text-amber-500' />
											<h4 className='font-semibold text-sm'>4. Right to Human Review</h4>
										</div>
										<p className='text-sm text-muted-foreground'>
											Candidates can request that a human reviewer re-evaluate any AI-assisted
											decision. Human review requests are processed within 30 days and override the
											AI outcome.
										</p>
									</div>
									<div className='space-y-2'>
										<div className='flex items-center gap-2'>
											<Gavel className='h-4 w-4 text-red-500' />
											<h4 className='font-semibold text-sm'>5. Appeal & Contest</h4>
										</div>
										<p className='text-sm text-muted-foreground'>
											Candidates can appeal scores, challenge decisions, and request correction of
											inaccurate data. Appeals are reviewed by a human panel with no AI involvement
											in the resolution.
										</p>
									</div>
									<div className='space-y-2'>
										<div className='flex items-center gap-2'>
											<FileText className='h-4 w-4 text-indigo-500' />
											<h4 className='font-semibold text-sm'>6. Public Transparency Report</h4>
										</div>
										<p className='text-sm text-muted-foreground'>
											A public transparency report is published annually describing the AI systems
											used, performance metrics, bias audit results, and any known limitations.
										</p>
									</div>
								</div>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									<FileText className='h-5 w-5' />
									Candidate Communication Log
								</CardTitle>
							</CardHeader>
							<CardContent className='p-0'>
								{consents.length === 0 ? (
									<div className='p-4 text-sm text-muted-foreground'>No consent records found.</div>
								) : (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Candidate</TableHead>
												<TableHead>Consent Type</TableHead>
												<TableHead>Status</TableHead>
												<TableHead>Date</TableHead>
												<TableHead>IP Address</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{consents.slice(0, 10).map((c) => (
												<TableRow key={c.id}>
													<TableCell className='font-medium text-sm'>
														{c.userName || c.userEmail}
													</TableCell>
													<TableCell>
														<Badge variant='outline' className='text-xs capitalize'>
															{c.consentType.replace('_', ' ')}
														</Badge>
													</TableCell>
													<TableCell>
														{c.consented ? (
															<Badge className='bg-green-100 text-green-700 text-xs'>
																<CheckCircle className='h-3 w-3 mr-1' />
																Consented
															</Badge>
														) : (
															<Badge className='bg-red-100 text-red-700 text-xs'>
																<XCircle className='h-3 w-3 mr-1' />
																Declined
															</Badge>
														)}
													</TableCell>
													<TableCell className='text-xs text-muted-foreground'>
														{c.consentedAt ? new Date(c.consentedAt).toLocaleString() : 'N/A'}
													</TableCell>
													<TableCell className='text-xs text-muted-foreground'>
														{c.ipAddress || '—'}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								)}
							</CardContent>
						</Card>
					</div>
				</TabsContent>

				{/* EU AI Act Article 10 — Data Governance */}
				<TabsContent value='data-governance' className='mt-4'>
					<div className='space-y-4'>
						<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
							<ChartCard
								title='Bias Audits (12mo)'
								value={biasHistory.length}
								icon={<AlertTriangle className='h-4 w-4' />}
							/>
							<ChartCard
								title='Avg Fairness Score'
								value={
									biasHistory.length > 0
										? `${(biasHistory.reduce((s, r) => s + r.overallFairnessScore, 0) / Math.max(biasHistory.length, 1)).toFixed(1)}%`
										: 'N/A'
								}
								trend={
									biasHistory.length > 0 &&
									biasHistory.reduce((s, r) => s + r.overallFairnessScore, 0) /
										Math.max(biasHistory.length, 1) >=
										90
										? 'up'
										: 'down'
								}
								trendValue={
									biasHistory.length > 0 &&
									biasHistory.reduce((s, r) => s + r.overallFairnessScore, 0) /
										Math.max(biasHistory.length, 1) >=
										90
										? 'On target'
										: 'Needs improvement'
								}
								icon={<TrendingUp className='h-4 w-4' />}
							/>
							<ChartCard
								title='Training Data Sets'
								value={modelPerformance ? modelPerformance.modelPerformance.length : 0}
								icon={<Database className='h-4 w-4' />}
							/>
							<ChartCard
								title='Data Quality Score'
								value={
									biasReport
										? `${Math.max(0, 100 - biasReport.falsePositiveRate * 100 - biasReport.falseNegativeRate * 100).toFixed(1)}%`
										: 'N/A'
								}
								icon={<CheckCircle className='h-4 w-4' />}
							/>
						</div>

						<Card>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									<Database className='h-5 w-5 text-indigo-500' />
									Article 10 — Data and Data Governance
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-4'>
								<div className='grid gap-4 sm:grid-cols-2'>
									<div className='space-y-2'>
										<h4 className='font-semibold text-sm'>1. Training Data Quality</h4>
										<p className='text-sm text-muted-foreground'>
											Training data is sourced from verified, anonymized historical hiring records
											with documented provenance. All datasets are reviewed for completeness,
											relevance, and accuracy before model training.
										</p>
									</div>
									<div className='space-y-2'>
										<h4 className='font-semibold text-sm'>2. Bias Testing & Monitoring</h4>
										<p className='text-sm text-muted-foreground'>
											Models are tested for bias across gender, ethnicity, age, and disability
											dimensions before deployment. Continuous monitoring runs on all live decisions
											with automated flagging of disparate outcomes.
										</p>
									</div>
									<div className='space-y-2'>
										<h4 className='font-semibold text-sm'>3. Data Minimization</h4>
										<p className='text-sm text-muted-foreground'>
											Only data strictly necessary for the specific recruitment purpose is collected
											and processed. Sensitive attributes (ethnicity, religion, health) are not used
											as model inputs unless required by law and with explicit consent.
										</p>
									</div>
									<div className='space-y-2'>
										<h4 className='font-semibold text-sm'>4. Data Lineage & Versioning</h4>
										<p className='text-sm text-muted-foreground'>
											All training datasets, model versions, and feature pipelines are versioned and
											logged. Audit trails link every decision to the specific model version,
											training data snapshot, and feature set used.
										</p>
									</div>
								</div>
								<Separator />
								<div className='space-y-2'>
									<h4 className='font-semibold text-sm'>Data Governance Checklist</h4>
									<ul className='text-sm text-muted-foreground space-y-1'>
										<li>
											• Training data reviewed and approved by Data Protection Officer before each
											model release
										</li>
										<li>• Bias audit conducted quarterly by independent compliance team</li>
										<li>
											• Data retention policies enforced automatically with deletion confirmation
											logs
										</li>
										<li>
											• All data transfers to third-party processors covered by GDPR Article 28 DPA
										</li>
										<li>• Annual third-party penetration test and SOC 2 Type II audit</li>
									</ul>
								</div>
							</CardContent>
						</Card>

						{biasReport && (
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
											{biasReport.topConcerns.map((concern, i) => (
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
											{biasReport.improvements.map((item, i) => (
												<li key={item} className='flex items-start gap-2 text-sm'>
													<CheckCircle className='h-4 w-4 text-green-500 mt-0.5 shrink-0' />
													{item}
												</li>
											))}
										</ul>
									</CardContent>
								</Card>
							</div>
						)}
					</div>
				</TabsContent>

				{/* Conformity Assessment */}
				<TabsContent value='conformity' className='mt-4'>
					<div className='space-y-4'>
						<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
							<ChartCard
								title='Checklist Complete'
								value={
									riskChecklistSummary
										? `${riskChecklistSummary.completed} / ${riskChecklistSummary.total}`
										: 'N/A'
								}
								trend={
									riskChecklistSummary && riskChecklistSummary.complianceScore >= 80 ? 'up' : 'down'
								}
								trendValue={
									riskChecklistSummary && riskChecklistSummary.complianceScore >= 80
										? 'On track'
										: 'Needs work'
								}
								icon={<ListChecks className='h-4 w-4' />}
							/>
							<ChartCard
								title='Compliance Score'
								value={riskChecklistSummary ? `${riskChecklistSummary.complianceScore}%` : 'N/A'}
								icon={<ShieldCheck className='h-4 w-4' />}
							/>
							<ChartCard
								title='Pending Actions'
								value={
									riskChecklistSummary
										? riskChecklistSummary.pending + riskChecklistSummary.incomplete
										: 0
								}
								trend={
									riskChecklistSummary &&
									riskChecklistSummary.pending + riskChecklistSummary.incomplete > 0
										? 'down'
										: 'neutral'
								}
								trendValue={
									riskChecklistSummary &&
									riskChecklistSummary.pending + riskChecklistSummary.incomplete > 0
										? 'Action needed'
										: 'Clean'
								}
								icon={<Clock className='h-4 w-4' />}
							/>
							<ChartCard
								title='Next Audit'
								value={
									riskChecklistSummary
										? new Date(riskChecklistSummary.nextReview).toLocaleDateString()
										: 'N/A'
								}
								icon={<Calendar className='h-4 w-4' />}
							/>
						</div>

						<Card>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									<FileCheck className='h-5 w-5 text-green-500' />
									Internal Conformity Assessment Process
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-4'>
								<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
									<div className='space-y-2'>
										<div className='flex items-center gap-2'>
											<div className='h-6 w-6 rounded-full bg-green-100 flex items-center justify-center text-green-700 text-xs font-bold'>
												1
											</div>
											<h4 className='font-semibold text-sm'>Risk Classification</h4>
										</div>
										<p className='text-sm text-muted-foreground'>
											All AI systems are classified by risk level under Article 6. High-risk systems
											undergo full conformity assessment. Classification is reviewed annually or
											after material changes.
										</p>
										<Badge variant='outline' className='text-xs text-green-600 border-green-200'>
											<CheckCircle className='h-3 w-3 mr-1' />
											Complete
										</Badge>
									</div>
									<div className='space-y-2'>
										<div className='flex items-center gap-2'>
											<div className='h-6 w-6 rounded-full bg-green-100 flex items-center justify-center text-green-700 text-xs font-bold'>
												2
											</div>
											<h4 className='font-semibold text-sm'>Documentation</h4>
										</div>
										<p className='text-sm text-muted-foreground'>
											Technical documentation is maintained for all high-risk systems including
											system architecture, data requirements, performance metrics, and known
											limitations.
										</p>
										<Badge variant='outline' className='text-xs text-green-600 border-green-200'>
											<CheckCircle className='h-3 w-3 mr-1' />
											Complete
										</Badge>
									</div>
									<div className='space-y-2'>
										<div className='flex items-center gap-2'>
											<div className='h-6 w-6 rounded-full bg-green-100 flex items-center justify-center text-green-700 text-xs font-bold'>
												3
											</div>
											<h4 className='font-semibold text-sm'>Quality Management</h4>
										</div>
										<p className='text-sm text-muted-foreground'>
											A documented quality management system covers design, development, testing,
											deployment, and monitoring. Change management procedures ensure traceability.
										</p>
										<Badge variant='outline' className='text-xs text-green-600 border-green-200'>
											<CheckCircle className='h-3 w-3 mr-1' />
											Complete
										</Badge>
									</div>
									<div className='space-y-2'>
										<div className='flex items-center gap-2'>
											<div className='h-6 w-6 rounded-full bg-green-100 flex items-center justify-center text-green-700 text-xs font-bold'>
												4
											</div>
											<h4 className='font-semibold text-sm'>Post-Market Monitoring</h4>
										</div>
										<p className='text-sm text-muted-foreground'>
											Continuous monitoring collects incident reports, performance degradation, bias
											flags, and user feedback. Serious incidents are reported to the national
											regulator within 72 hours.
										</p>
										<Badge variant='outline' className='text-xs text-green-600 border-green-200'>
											<CheckCircle className='h-3 w-3 mr-1' />
											Complete
										</Badge>
									</div>
									<div className='space-y-2'>
										<div className='flex items-center gap-2'>
											<div className='h-6 w-6 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-xs font-bold'>
												5
											</div>
											<h4 className='font-semibold text-sm'>Notified Body Review</h4>
										</div>
										<p className='text-sm text-muted-foreground'>
											Engagement with a notified body for third-party conformity assessment is in
											progress. Expected completion: Q3 2026.
										</p>
										<Badge variant='outline' className='text-xs text-amber-600 border-amber-200'>
											<Clock className='h-3 w-3 mr-1' />
											In Progress
										</Badge>
									</div>
									<div className='space-y-2'>
										<div className='flex items-center gap-2'>
											<div className='h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xs font-bold'>
												6
											</div>
											<h4 className='font-semibold text-sm'>CE Marking & Registration</h4>
										</div>
										<p className='text-sm text-muted-foreground'>
											Upon successful conformity assessment, CE marking will be applied and the
											system will be registered in the EU database for high-risk AI systems.
										</p>
										<Badge variant='outline' className='text-xs text-blue-600 border-blue-200'>
											<Activity className='h-3 w-3 mr-1' />
											Pending
										</Badge>
									</div>
								</div>
								<Separator />
								<div className='space-y-2'>
									<h4 className='font-semibold text-sm'>Assessment Documentation</h4>
									<div className='space-y-2'>
										<div className='flex items-center justify-between p-3 border rounded-lg'>
											<div className='flex items-center gap-2'>
												<FileText className='h-4 w-4 text-muted-foreground' />
												<span className='text-sm font-medium'>Technical Documentation</span>
											</div>
											<Badge className='bg-green-100 text-green-700 text-xs'>Complete</Badge>
										</div>
										<div className='flex items-center justify-between p-3 border rounded-lg'>
											<div className='flex items-center gap-2'>
												<FileText className='h-4 w-4 text-muted-foreground' />
												<span className='text-sm font-medium'>Risk Management System</span>
											</div>
											<Badge className='bg-green-100 text-green-700 text-xs'>Complete</Badge>
										</div>
										<div className='flex items-center justify-between p-3 border rounded-lg'>
											<div className='flex items-center gap-2'>
												<FileText className='h-4 w-4 text-muted-foreground' />
												<span className='text-sm font-medium'>Data Governance Procedures</span>
											</div>
											<Badge className='bg-green-100 text-green-700 text-xs'>Complete</Badge>
										</div>
										<div className='flex items-center justify-between p-3 border rounded-lg'>
											<div className='flex items-center gap-2'>
												<FileText className='h-4 w-4 text-muted-foreground' />
												<span className='text-sm font-medium'>Human Oversight Protocol</span>
											</div>
											<Badge className='bg-green-100 text-green-700 text-xs'>Complete</Badge>
										</div>
										<div className='flex items-center justify-between p-3 border rounded-lg'>
											<div className='flex items-center gap-2'>
												<FileText className='h-4 w-4 text-muted-foreground' />
												<span className='text-sm font-medium'>Notified Body Assessment Report</span>
											</div>
											<Badge className='bg-amber-100 text-amber-700 text-xs'>In Progress</Badge>
										</div>
										<div className='flex items-center justify-between p-3 border rounded-lg'>
											<div className='flex items-center gap-2'>
												<FileText className='h-4 w-4 text-muted-foreground' />
												<span className='text-sm font-medium'>CE Declaration of Conformity</span>
											</div>
											<Badge className='bg-blue-100 text-blue-700 text-xs'>Pending</Badge>
										</div>
									</div>
								</div>
							</CardContent>
						</Card>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	)
}
