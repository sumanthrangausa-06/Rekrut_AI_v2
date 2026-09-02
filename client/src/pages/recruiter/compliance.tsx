import {
	AlertTriangle,
	ArrowLeft,
	BarChart3,
	BrainCircuit,
	CheckCircle2,
	Clock,
	Database,
	FileText,
	GitBranch,
	GitCommit,
	Globe,
	History,
	Shield,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	Tag,
	UserCheck,
	Users,
	XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ─── Mock Data ───────────────────────────────────────────────────────────

interface BiasMetric {
	demographic: string;
	group: string;
	totalCandidates: number;
	selected: number;
	selectionRate: number;
	benchmarkRate: number;
	eightyPercentRule: number;
	flagged: boolean;
}

interface ConsentRecord {
	id: string;
	candidateName: string;
	candidateId: string;
	consentType: 'AI Screening' | 'Data Processing' | 'Automated Decision' | 'Profiling';
	status: 'given' | 'withdrawn' | 'pending';
	givenAt: string;
	updatedAt: string;
	ipAddress: string;
	region: string;
}

interface ModelVersion {
	version: string;
	deployedAt: string;
	status: 'active' | 'deprecated' | 'rollback';
	provider: string;
	modelName: string;
	accuracy: number;
	decisionsMade: number;
}

interface PromptVersion {
	version: string;
	updatedAt: string;
	updatedBy: string;
	changeSummary: string;
	active: boolean;
}

interface AIDecision {
	id: string;
	timestamp: string;
	candidateName: string;
	jobTitle: string;
	decisionType: 'screening' | 'matching' | 'interview' | 'scoring';
	decision: string;
	explanation: string;
	confidence: number;
	modelVersion: string;
	humanReviewed: boolean;
	reviewerName?: string;
	biasFlags: string[];
}

const biasMetrics: BiasMetric[] = [
	{
		demographic: 'Gender',
		group: 'Female',
		totalCandidates: 342,
		selected: 89,
		selectionRate: 26.0,
		benchmarkRate: 28.5,
		eightyPercentRule: 91.2,
		flagged: false,
	},
	{
		demographic: 'Gender',
		group: 'Male',
		totalCandidates: 398,
		selected: 118,
		selectionRate: 29.6,
		benchmarkRate: 28.5,
		eightyPercentRule: 100.0,
		flagged: false,
	},
	{
		demographic: 'Gender',
		group: 'Non-binary',
		totalCandidates: 24,
		selected: 5,
		selectionRate: 20.8,
		benchmarkRate: 28.5,
		eightyPercentRule: 70.3,
		flagged: true,
	},
	{
		demographic: 'Ethnicity',
		group: 'Asian',
		totalCandidates: 186,
		selected: 52,
		selectionRate: 28.0,
		benchmarkRate: 27.8,
		eightyPercentRule: 100.0,
		flagged: false,
	},
	{
		demographic: 'Ethnicity',
		group: 'White',
		totalCandidates: 312,
		selected: 91,
		selectionRate: 29.2,
		benchmarkRate: 27.8,
		eightyPercentRule: 100.0,
		flagged: false,
	},
	{
		demographic: 'Ethnicity',
		group: 'Black',
		totalCandidates: 98,
		selected: 22,
		selectionRate: 22.4,
		benchmarkRate: 27.8,
		eightyPercentRule: 76.7,
		flagged: true,
	},
	{
		demographic: 'Ethnicity',
		group: 'Hispanic',
		totalCandidates: 87,
		selected: 21,
		selectionRate: 24.1,
		benchmarkRate: 27.8,
		eightyPercentRule: 86.7,
		flagged: false,
	},
	{
		demographic: 'Age',
		group: '18-25',
		totalCandidates: 156,
		selected: 38,
		selectionRate: 24.4,
		benchmarkRate: 26.5,
		eightyPercentRule: 92.1,
		flagged: false,
	},
	{
		demographic: 'Age',
		group: '26-35',
		totalCandidates: 298,
		selected: 87,
		selectionRate: 29.2,
		benchmarkRate: 26.5,
		eightyPercentRule: 100.0,
		flagged: false,
	},
	{
		demographic: 'Age',
		group: '36-45',
		totalCandidates: 198,
		selected: 52,
		selectionRate: 26.3,
		benchmarkRate: 26.5,
		eightyPercentRule: 99.2,
		flagged: false,
	},
	{
		demographic: 'Age',
		group: '46-55',
		totalCandidates: 72,
		selected: 16,
		selectionRate: 22.2,
		benchmarkRate: 26.5,
		eightyPercentRule: 83.8,
		flagged: false,
	},
	{
		demographic: 'Age',
		group: '55+',
		totalCandidates: 40,
		selected: 7,
		selectionRate: 17.5,
		benchmarkRate: 26.5,
		eightyPercentRule: 66.0,
		flagged: true,
	},
];

const consentRecords: ConsentRecord[] = [
	{
		id: 'c-001',
		candidateName: 'Sarah Chen',
		candidateId: 'C-4821',
		consentType: 'AI Screening',
		status: 'given',
		givenAt: '2026-05-12T09:30:00Z',
		updatedAt: '2026-05-12T09:30:00Z',
		ipAddress: '203.45.12.88',
		region: 'EU',
	},
	{
		id: 'c-002',
		candidateName: 'Michael Park',
		candidateId: 'C-4822',
		consentType: 'Data Processing',
		status: 'given',
		givenAt: '2026-05-10T14:15:00Z',
		updatedAt: '2026-05-10T14:15:00Z',
		ipAddress: '198.23.67.12',
		region: 'US',
	},
	{
		id: 'c-003',
		candidateName: 'Emma Wilson',
		candidateId: 'C-4823',
		consentType: 'Automated Decision',
		status: 'withdrawn',
		givenAt: '2026-04-28T11:00:00Z',
		updatedAt: '2026-06-08T16:45:00Z',
		ipAddress: '185.45.89.33',
		region: 'EU',
	},
	{
		id: 'c-004',
		candidateName: 'James Liu',
		candidateId: 'C-4824',
		consentType: 'Profiling',
		status: 'pending',
		givenAt: '—',
		updatedAt: '2026-06-10T08:20:00Z',
		ipAddress: '—',
		region: 'APAC',
	},
	{
		id: 'c-005',
		candidateName: 'Amanda Rodriguez',
		candidateId: 'C-4825',
		consentType: 'AI Screening',
		status: 'given',
		givenAt: '2026-05-15T10:00:00Z',
		updatedAt: '2026-05-15T10:00:00Z',
		ipAddress: '204.56.78.91',
		region: 'US',
	},
	{
		id: 'c-006',
		candidateName: 'David Kim',
		candidateId: 'C-4826',
		consentType: 'Data Processing',
		status: 'given',
		givenAt: '2026-05-18T13:30:00Z',
		updatedAt: '2026-05-18T13:30:00Z',
		ipAddress: '210.34.56.78',
		region: 'APAC',
	},
	{
		id: 'c-007',
		candidateName: 'Lisa Thompson',
		candidateId: 'C-4827',
		consentType: 'Automated Decision',
		status: 'given',
		givenAt: '2026-05-20T09:00:00Z',
		updatedAt: '2026-05-20T09:00:00Z',
		ipAddress: '192.45.67.89',
		region: 'EU',
	},
	{
		id: 'c-008',
		candidateName: 'Robert Johnson',
		candidateId: 'C-4828',
		consentType: 'AI Screening',
		status: 'withdrawn',
		givenAt: '2026-04-15T16:00:00Z',
		updatedAt: '2026-06-05T11:30:00Z',
		ipAddress: '198.67.45.23',
		region: 'US',
	},
	{
		id: 'c-009',
		candidateName: 'Anna Schmidt',
		candidateId: 'C-4829',
		consentType: 'Profiling',
		status: 'given',
		givenAt: '2026-05-22T08:45:00Z',
		updatedAt: '2026-05-22T08:45:00Z',
		ipAddress: '185.23.45.67',
		region: 'EU',
	},
	{
		id: 'c-010',
		candidateName: 'Carlos Mendez',
		candidateId: 'C-4830',
		consentType: 'Data Processing',
		status: 'pending',
		givenAt: '—',
		updatedAt: '2026-06-12T14:00:00Z',
		ipAddress: '—',
		region: 'LATAM',
	},
];

const modelVersions: ModelVersion[] = [
	{
		version: 'v2.4.1',
		deployedAt: '2026-06-01T00:00:00Z',
		status: 'active',
		provider: 'OpenAI',
		modelName: 'GPT-4o',
		accuracy: 94.2,
		decisionsMade: 1247,
	},
	{
		version: 'v2.4.0',
		deployedAt: '2026-05-15T00:00:00Z',
		status: 'deprecated',
		provider: 'OpenAI',
		modelName: 'GPT-4o',
		accuracy: 93.1,
		decisionsMade: 3892,
	},
	{
		version: 'v2.3.2',
		deployedAt: '2026-04-20T00:00:00Z',
		status: 'deprecated',
		provider: 'OpenAI',
		modelName: 'GPT-4 Turbo',
		accuracy: 91.8,
		decisionsMade: 5621,
	},
	{
		version: 'v2.3.1',
		deployedAt: '2026-03-10T00:00:00Z',
		status: 'rollback',
		provider: 'Anthropic',
		modelName: 'Claude 3 Opus',
		accuracy: 89.5,
		decisionsMade: 2103,
	},
];

const promptVersions: PromptVersion[] = [
	{
		version: 'prompt-v3.2',
		updatedAt: '2026-06-05T10:00:00Z',
		updatedBy: 'Dr. Elena Rossi (AI Ethics)',
		changeSummary: 'Added explicit anti-bias guardrails for age and gender',
		active: true,
	},
	{
		version: 'prompt-v3.1',
		updatedAt: '2026-05-20T14:30:00Z',
		updatedBy: 'Marcus Wei (ML Eng)',
		changeSummary: 'Refined experience weighting to reduce over-indexing on Ivy League',
		active: false,
	},
	{
		version: 'prompt-v3.0',
		updatedAt: '2026-04-15T09:00:00Z',
		updatedBy: 'Dr. Elena Rossi (AI Ethics)',
		changeSummary: 'Complete rewrite with structured output format',
		active: false,
	},
	{
		version: 'prompt-v2.9',
		updatedAt: '2026-03-28T11:00:00Z',
		updatedBy: 'Sarah Chen (Product)',
		changeSummary: 'Added explainability requirements per EU AI Act Art. 13',
		active: false,
	},
];

const aiDecisions: AIDecision[] = [
	{
		id: 'dec-001',
		timestamp: '2026-06-13T14:30:00Z',
		candidateName: 'Sarah Chen',
		jobTitle: 'Senior Frontend Engineer',
		decisionType: 'screening',
		decision: 'Shortlisted',
		explanation:
			'Strong technical assessment (92/100), 5 years React experience, relevant portfolio projects. No bias flags detected.',
		confidence: 0.94,
		modelVersion: 'v2.4.1',
		humanReviewed: true,
		reviewerName: 'James Liu',
		biasFlags: [],
	},
	{
		id: 'dec-002',
		timestamp: '2026-06-13T13:15:00Z',
		candidateName: 'Michael Park',
		jobTitle: 'Product Manager',
		decisionType: 'matching',
		decision: 'Strong Match',
		explanation:
			'High alignment with job requirements: 8 years PM experience, B2B SaaS background, leadership skills score 88/100.',
		confidence: 0.89,
		modelVersion: 'v2.4.1',
		humanReviewed: false,
		biasFlags: [],
	},
	{
		id: 'dec-003',
		timestamp: '2026-06-13T11:00:00Z',
		candidateName: 'Emma Wilson',
		jobTitle: 'Data Scientist',
		decisionType: 'screening',
		decision: 'Rejected',
		explanation:
			'Insufficient ML engineering experience (2 years vs. required 4+). Portfolio lacks production deployment examples.',
		confidence: 0.78,
		modelVersion: 'v2.4.1',
		humanReviewed: true,
		reviewerName: 'Dr. A. Patel',
		biasFlags: ['Age proxy detected in experience gap'],
	},
	{
		id: 'dec-004',
		timestamp: '2026-06-12T16:45:00Z',
		candidateName: 'James Liu',
		jobTitle: 'DevOps Engineer',
		decisionType: 'interview',
		decision: 'Interview Recommended',
		explanation:
			'Excellent infrastructure automation skills, AWS certified, demonstrated CI/CD pipeline design in assessment.',
		confidence: 0.91,
		modelVersion: 'v2.4.1',
		humanReviewed: false,
		biasFlags: [],
	},
	{
		id: 'dec-005',
		timestamp: '2026-06-12T10:20:00Z',
		candidateName: 'Amanda Rodriguez',
		jobTitle: 'UX Designer',
		decisionType: 'scoring',
		decision: 'Score: 87/100',
		explanation:
			'Strong design portfolio, user research experience, Figma proficiency. Minor gap in accessibility knowledge.',
		confidence: 0.85,
		modelVersion: 'v2.4.0',
		humanReviewed: true,
		reviewerName: 'Lisa Thompson',
		biasFlags: [],
	},
	{
		id: 'dec-006',
		timestamp: '2026-06-11T09:00:00Z',
		candidateName: 'David Kim',
		jobTitle: 'Backend Engineer',
		decisionType: 'screening',
		decision: 'Shortlisted',
		explanation:
			'Solid backend fundamentals, Go and Python experience, system design score 90/100. Clean background check.',
		confidence: 0.92,
		modelVersion: 'v2.4.1',
		humanReviewed: false,
		biasFlags: [],
	},
	{
		id: 'dec-007',
		timestamp: '2026-06-11T08:30:00Z',
		candidateName: 'Robert Johnson',
		jobTitle: 'Sales Engineer',
		decisionType: 'matching',
		decision: 'Moderate Match',
		explanation:
			'Good technical skills but limited enterprise sales experience. Recommend further interview to assess soft skills.',
		confidence: 0.72,
		modelVersion: 'v2.4.1',
		humanReviewed: false,
		biasFlags: ['Geographic bias: under-represented region'],
	},
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
	if (dateStr === '—') return '—';
	return new Date(dateStr).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	});
}

function formatDateTime(dateStr: string) {
	return new Date(dateStr).toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

function getStatusBadge(status: string) {
	switch (status) {
		case 'given':
			return (
				<Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 gap-1">
					<CheckCircle2 className="h-3 w-3" />
					Given
				</Badge>
			);
		case 'withdrawn':
			return (
				<Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 gap-1">
					<XCircle className="h-3 w-3" />
					Withdrawn
				</Badge>
			);
		case 'pending':
			return (
				<Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 gap-1">
					<Clock className="h-3 w-3" />
					Pending
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}

function getModelStatusBadge(status: string) {
	switch (status) {
		case 'active':
			return (
				<Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 gap-1">
					<CheckCircle2 className="h-3 w-3" />
					Active
				</Badge>
			);
		case 'deprecated':
			return (
				<Badge className="bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400 gap-1">
					<History className="h-3 w-3" />
					Deprecated
				</Badge>
			);
		case 'rollback':
			return (
				<Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 gap-1">
					<GitBranch className="h-3 w-3" />
					Rollback
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}

function getDecisionTypeConfig(type: string) {
	switch (type) {
		case 'screening':
			return {
				icon: <Shield className="h-4 w-4" />,
				color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
				label: 'Screening',
			};
		case 'matching':
			return {
				icon: <Users className="h-4 w-4" />,
				color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
				label: 'Matching',
			};
		case 'interview':
			return {
				icon: <BrainCircuit className="h-4 w-4" />,
				color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
				label: 'Interview',
			};
		case 'scoring':
			return {
				icon: <BarChart3 className="h-4 w-4" />,
				color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
				label: 'Scoring',
			};
		default:
			return {
				icon: <Sparkles className="h-4 w-4" />,
				color: 'bg-gray-100 text-gray-700',
				label: type,
			};
	}
}

// Simple horizontal bar chart for selection rates
function SelectionRateBar({ value, max, color }: { value: number; max: number; color: string }) {
	return (
		<div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
			<div
				className="h-full rounded-full transition-all duration-500"
				style={{ width: `${(value / max) * 100}%`, backgroundColor: color }}
			/>
		</div>
	);
}

// ─── Component ─────────────────────────────────────────────────────────────

export function RecruiterCompliancePage() {
	const [activeTab, setActiveTab] = useState('bias');
	const [expandedDecision, setExpandedDecision] = useState<string | null>(null);

	// Group bias metrics by demographic for cards
	const demographics = ['Gender', 'Ethnicity', 'Age'];
	const flaggedCount = biasMetrics.filter((m) => m.flagged).length;
	const _totalCandidates = biasMetrics.reduce((sum, m) => sum + m.totalCandidates, 0) / 3; // divide by 3 because each candidate counted in 3 demographics
	const avgSelectionRate =
		biasMetrics.reduce((sum, m) => sum + m.selectionRate, 0) / biasMetrics.length;

	// Consent summary stats
	const givenCount = consentRecords.filter((c) => c.status === 'given').length;
	const withdrawnCount = consentRecords.filter((c) => c.status === 'withdrawn').length;
	const pendingCount = consentRecords.filter((c) => c.status === 'pending').length;

	// Decision summary
	const reviewedCount = aiDecisions.filter((d) => d.humanReviewed).length;
	const biasFlagCount = aiDecisions.filter((d) => d.biasFlags.length > 0).length;

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<Link
						to="/recruiter"
						className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm mb-2"
					>
						<ArrowLeft className="w-4 h-4" />
						Back to Dashboard
					</Link>
					<h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-3">
						<Shield className="w-8 h-8 text-primary" />
						Compliance (EU AI Act)
					</h1>
					<p className="text-muted-foreground mt-1">
						Bias audits, consent management, data lineage, and AI explainability in accordance with
						Regulation (EU) 2024/1689
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 gap-1">
						<ShieldCheck className="h-3.5 w-3.5" />
						Compliant
					</Badge>
					<Button variant="outline" size="sm" className="gap-1">
						<FileText className="h-4 w-4" />
						Export Report
					</Button>
				</div>
			</div>

			{/* Summary Stats */}
			<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardContent className="p-4 flex items-center gap-4">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 shrink-0">
							<BarChart3 className="h-5 w-5" />
						</div>
						<div>
							<p className="text-sm text-muted-foreground">Avg Selection Rate</p>
							<p className="text-xl font-bold">{avgSelectionRate.toFixed(1)}%</p>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4 flex items-center gap-4">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 text-red-600 shrink-0">
							<ShieldAlert className="h-5 w-5" />
						</div>
						<div>
							<p className="text-sm text-muted-foreground">Bias Flags</p>
							<p className="text-xl font-bold">{flaggedCount}</p>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4 flex items-center gap-4">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600 shrink-0">
							<UserCheck className="h-5 w-5" />
						</div>
						<div>
							<p className="text-sm text-muted-foreground">Consents Given</p>
							<p className="text-xl font-bold">
								{givenCount}/{consentRecords.length}
							</p>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4 flex items-center gap-4">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-600 shrink-0">
							<BrainCircuit className="h-5 w-5" />
						</div>
						<div>
							<p className="text-sm text-muted-foreground">Human Reviewed</p>
							<p className="text-xl font-bold">
								{reviewedCount}/{aiDecisions.length}
							</p>
						</div>
					</CardContent>
				</Card>
			</div>

			{/* 80% Rule Violation Alert */}
			{flaggedCount > 0 && (
				<Card className="border-red-200 bg-red-50/50 dark:bg-red-900/10">
					<CardContent className="p-4 flex items-start gap-4">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 text-red-600 shrink-0 mt-0.5">
							<AlertTriangle className="h-5 w-5" />
						</div>
						<div className="flex-1">
							<p className="font-medium text-red-700 dark:text-red-400">
								80% Rule Violation Detected
							</p>
							<p className="text-sm text-red-600/80 dark:text-red-400/80 mt-1">
								{flaggedCount} demographic groups have selection rates below 80% of the benchmark
								group. This may indicate disparate impact under EU AI Act Article 10 and requires
								immediate review.
							</p>
							<div className="flex flex-wrap gap-2 mt-3">
								{biasMetrics
									.filter((m) => m.flagged)
									.map((m) => (
										<Badge
											key={`${m.demographic}-${m.group}`}
											variant="outline"
											className="text-xs border-red-300 text-red-700 dark:text-red-400"
										>
											{m.demographic}: {m.group} ({m.eightyPercentRule.toFixed(1)}%)
										</Badge>
									))}
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Tabs */}
			<Tabs value={activeTab} onValueChange={setActiveTab}>
				<TabsList className="flex-wrap h-auto">
					<TabsTrigger value="bias" className="gap-1">
						<BarChart3 className="h-3.5 w-3.5" />
						Bias Audit
					</TabsTrigger>
					<TabsTrigger value="consent" className="gap-1">
						<UserCheck className="h-3.5 w-3.5" />
						Consent Management
					</TabsTrigger>
					<TabsTrigger value="lineage" className="gap-1">
						<Database className="h-3.5 w-3.5" />
						Data Lineage
					</TabsTrigger>
					<TabsTrigger value="explainability" className="gap-1">
						<BrainCircuit className="h-3.5 w-3.5" />
						Explainability
					</TabsTrigger>
				</TabsList>

				{/* ── Bias Audit Tab ── */}
				<TabsContent value="bias" className="mt-4 space-y-6">
					{/* Demographic Overview Cards */}
					<div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
						{demographics.map((demo) => {
							const demoMetrics = biasMetrics.filter((m) => m.demographic === demo);
							const maxRate = Math.max(...demoMetrics.map((m) => m.selectionRate));
							const demoFlagged = demoMetrics.filter((m) => m.flagged).length;
							return (
								<Card key={demo}>
									<CardHeader className="pb-2">
										<CardTitle className="text-sm flex items-center justify-between">
											<span className="flex items-center gap-2">
												<Users className="h-4 w-4 text-primary" />
												{demo} Distribution
											</span>
											{demoFlagged > 0 && (
												<Badge variant="destructive" className="text-xs">
													{demoFlagged} flag{demoFlagged > 1 ? 's' : ''}
												</Badge>
											)}
										</CardTitle>
									</CardHeader>
									<CardContent className="space-y-3 pt-0">
										{demoMetrics.map((m) => (
											<div key={`${m.demographic}-${m.group}`} className="space-y-1">
												<div className="flex items-center justify-between text-sm">
													<span className="flex items-center gap-2">
														{m.group}
														{m.flagged && <AlertTriangle className="h-3 w-3 text-red-500" />}
													</span>
													<span className="font-medium">
														{m.selected}/{m.totalCandidates} ({m.selectionRate.toFixed(1)}%)
													</span>
												</div>
												<SelectionRateBar
													value={m.selectionRate}
													max={maxRate}
													color={m.flagged ? '#ef4444' : '#3b82f6'}
												/>
												<div className="flex justify-between text-xs text-muted-foreground">
													<span>80% Rule: {m.eightyPercentRule.toFixed(1)}%</span>
													<span>Benchmark: {m.benchmarkRate.toFixed(1)}%</span>
												</div>
											</div>
										))}
									</CardContent>
								</Card>
							);
						})}
					</div>

					{/* Detailed Bias Table */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<BarChart3 className="h-5 w-5 text-primary" />
								Detailed Bias Metrics
							</CardTitle>
						</CardHeader>
						<CardContent className="p-0">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Demographic</TableHead>
										<TableHead>Group</TableHead>
										<TableHead>Total</TableHead>
										<TableHead>Selected</TableHead>
										<TableHead>Selection Rate</TableHead>
										<TableHead>80% Rule</TableHead>
										<TableHead>Status</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{biasMetrics.map((m) => (
										<TableRow key={`${m.demographic}-${m.group}`}>
											<TableCell className="font-medium">{m.demographic}</TableCell>
											<TableCell>{m.group}</TableCell>
											<TableCell>{m.totalCandidates}</TableCell>
											<TableCell>{m.selected}</TableCell>
											<TableCell>
												<div className="flex items-center gap-2">
													<span className="font-medium">{m.selectionRate.toFixed(1)}%</span>
													<div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
														<div
															className="h-full rounded-full"
															style={{
																width: `${(m.selectionRate / 35) * 100}%`,
																backgroundColor: m.flagged ? '#ef4444' : '#3b82f6',
															}}
														/>
													</div>
												</div>
											</TableCell>
											<TableCell>
												<span
													className={
														m.eightyPercentRule >= 80
															? 'text-green-600'
															: 'text-red-600 font-medium'
													}
												>
													{m.eightyPercentRule.toFixed(1)}%
												</span>
											</TableCell>
											<TableCell>
												{m.flagged ? (
													<Badge variant="destructive" className="text-xs gap-1">
														<AlertTriangle className="h-3 w-3" />
														Violation
													</Badge>
												) : (
													<Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs gap-1">
														<CheckCircle2 className="h-3 w-3" />
														Pass
													</Badge>
												)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				</TabsContent>

				{/* ── Consent Management Tab ── */}
				<TabsContent value="consent" className="mt-4 space-y-6">
					{/* Consent Summary Cards */}
					<div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
						<Card>
							<CardContent className="p-4 flex items-center gap-4">
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600 shrink-0">
									<CheckCircle2 className="h-5 w-5" />
								</div>
								<div>
									<p className="text-sm text-muted-foreground">Given</p>
									<p className="text-xl font-bold">{givenCount}</p>
									<p className="text-xs text-muted-foreground">
										{((givenCount / consentRecords.length) * 100).toFixed(0)}% of total
									</p>
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="p-4 flex items-center gap-4">
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-100 text-yellow-600 shrink-0">
									<Clock className="h-5 w-5" />
								</div>
								<div>
									<p className="text-sm text-muted-foreground">Pending</p>
									<p className="text-xl font-bold">{pendingCount}</p>
									<p className="text-xs text-muted-foreground">
										{((pendingCount / consentRecords.length) * 100).toFixed(0)}% of total
									</p>
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="p-4 flex items-center gap-4">
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 text-red-600 shrink-0">
									<XCircle className="h-5 w-5" />
								</div>
								<div>
									<p className="text-sm text-muted-foreground">Withdrawn</p>
									<p className="text-xl font-bold">{withdrawnCount}</p>
									<p className="text-xs text-muted-foreground">
										{((withdrawnCount / consentRecords.length) * 100).toFixed(0)}% of total
									</p>
								</div>
							</CardContent>
						</Card>
					</div>

					{/* Consent Table */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<UserCheck className="h-5 w-5 text-primary" />
								Candidate Consent Records
							</CardTitle>
						</CardHeader>
						<CardContent className="p-0">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Candidate</TableHead>
										<TableHead>Consent Type</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Given At</TableHead>
										<TableHead>Last Updated</TableHead>
										<TableHead>Region</TableHead>
										<TableHead>IP Address</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{consentRecords.map((c) => (
										<TableRow key={c.id}>
											<TableCell>
												<div>
													<p className="font-medium text-sm">{c.candidateName}</p>
													<p className="text-xs text-muted-foreground">ID: {c.candidateId}</p>
												</div>
											</TableCell>
											<TableCell>
												<Badge variant="outline" className="text-xs">
													{c.consentType}
												</Badge>
											</TableCell>
											<TableCell>{getStatusBadge(c.status)}</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{formatDateTime(c.givenAt)}
											</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{formatDateTime(c.updatedAt)}
											</TableCell>
											<TableCell>
												<span className="flex items-center gap-1 text-sm">
													<Globe className="h-3 w-3 text-muted-foreground" />
													{c.region}
												</span>
											</TableCell>
											<TableCell className="text-xs font-mono text-muted-foreground">
												{c.ipAddress}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				</TabsContent>

				{/* ── Data Lineage Tab ── */}
				<TabsContent value="lineage" className="mt-4 space-y-6">
					{/* Provider Info */}
					<Card>
						<CardContent className="p-4 flex items-center gap-4">
							<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 shrink-0">
								<Sparkles className="h-6 w-6" />
							</div>
							<div className="flex-1">
								<p className="font-medium">Active AI Provider</p>
								<p className="text-sm text-muted-foreground">OpenAI — GPT-4o</p>
							</div>
							<div className="text-right">
								<Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 gap-1">
									<CheckCircle2 className="h-3 w-3" />
									Operational
								</Badge>
								<p className="text-xs text-muted-foreground mt-1">API region: EU-West</p>
							</div>
						</CardContent>
					</Card>

					<div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
						{/* Model Versions */}
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<Database className="h-5 w-5 text-primary" />
									AI Model Version History
								</CardTitle>
							</CardHeader>
							<CardContent className="space-y-4">
								{modelVersions.map((model, _idx) => (
									<div
										key={model.version}
										className={`p-3 rounded-lg border ${model.status === 'active' ? 'border-primary/30 bg-primary/5' : 'border-gray-100'}`}
									>
										<div className="flex items-center justify-between mb-2">
											<div className="flex items-center gap-2">
												<Tag className="h-4 w-4 text-muted-foreground" />
												<span className="font-medium">{model.version}</span>
												{getModelStatusBadge(model.status)}
											</div>
											<span className="text-xs text-muted-foreground">
												{formatDate(model.deployedAt)}
											</span>
										</div>
										<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
											<div className="text-muted-foreground">
												Provider:{' '}
												<span className="text-foreground font-medium">{model.provider}</span>
											</div>
											<div className="text-muted-foreground">
												Model:{' '}
												<span className="text-foreground font-medium">{model.modelName}</span>
											</div>
											<div className="text-muted-foreground">
												Accuracy:{' '}
												<span className="text-foreground font-medium">{model.accuracy}%</span>
											</div>
											<div className="text-muted-foreground">
												Decisions:{' '}
												<span className="text-foreground font-medium">
													{model.decisionsMade.toLocaleString()}
												</span>
											</div>
										</div>
										{model.status === 'active' && (
											<div className="mt-2">
												<Progress value={model.accuracy} className="h-1.5" />
											</div>
										)}
									</div>
								))}
							</CardContent>
						</Card>

						{/* Prompt Versions */}
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<GitCommit className="h-5 w-5 text-primary" />
									Prompt Version History
								</CardTitle>
							</CardHeader>
							<CardContent className="space-y-3">
								{promptVersions.map((prompt, _idx) => (
									<div
										key={prompt.version}
										className={`p-3 rounded-lg border ${prompt.active ? 'border-primary/30 bg-primary/5' : 'border-gray-100'}`}
									>
										<div className="flex items-center justify-between mb-1">
											<div className="flex items-center gap-2">
												<FileText className="h-4 w-4 text-muted-foreground" />
												<span className="font-medium text-sm">{prompt.version}</span>
												{prompt.active && (
													<Badge className="bg-primary/10 text-primary text-xs gap-1">
														<CheckCircle2 className="h-3 w-3" />
														Active
													</Badge>
												)}
											</div>
											<span className="text-xs text-muted-foreground">
												{formatDate(prompt.updatedAt)}
											</span>
										</div>
										<p className="text-sm text-muted-foreground">{prompt.changeSummary}</p>
										<p className="text-xs text-muted-foreground mt-1">
											Updated by:{' '}
											<span className="font-medium text-foreground">{prompt.updatedBy}</span>
										</p>
									</div>
								))}
							</CardContent>
						</Card>
					</div>
				</TabsContent>

				{/* ── Explainability Tab ── */}
				<TabsContent value="explainability" className="mt-4 space-y-6">
					{/* Explainability Stats */}
					<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
						<Card>
							<CardContent className="p-4 flex items-center gap-4">
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 shrink-0">
									<BrainCircuit className="h-5 w-5" />
								</div>
								<div>
									<p className="text-sm text-muted-foreground">Total Decisions</p>
									<p className="text-xl font-bold">{aiDecisions.length}</p>
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="p-4 flex items-center gap-4">
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600 shrink-0">
									<CheckCircle2 className="h-5 w-5" />
								</div>
								<div>
									<p className="text-sm text-muted-foreground">Human Reviewed</p>
									<p className="text-xl font-bold">
										{reviewedCount}/{aiDecisions.length}
									</p>
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="p-4 flex items-center gap-4">
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-600 shrink-0">
									<BarChart3 className="h-5 w-5" />
								</div>
								<div>
									<p className="text-sm text-muted-foreground">Avg Confidence</p>
									<p className="text-xl font-bold">
										{(
											(aiDecisions.reduce((sum, d) => sum + d.confidence, 0) / aiDecisions.length) *
											100
										).toFixed(1)}
										%
									</p>
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="p-4 flex items-center gap-4">
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 text-red-600 shrink-0">
									<AlertTriangle className="h-5 w-5" />
								</div>
								<div>
									<p className="text-sm text-muted-foreground">Bias Flags</p>
									<p className="text-xl font-bold">{biasFlagCount}</p>
								</div>
							</CardContent>
						</Card>
					</div>

					{/* Decisions Table */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<BrainCircuit className="h-5 w-5 text-primary" />
								Recent AI Decisions & Explanations
							</CardTitle>
						</CardHeader>
						<CardContent className="p-0">
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
									</TableRow>
								</TableHeader>
								<TableBody>
									{aiDecisions.map((d) => {
										const typeConfig = getDecisionTypeConfig(d.decisionType);
										const isExpanded = expandedDecision === d.id;
										return (
											<>
												<TableRow
													key={d.id}
													className="cursor-pointer hover:bg-muted/50"
													onClick={() => setExpandedDecision(isExpanded ? null : d.id)}
												>
													<TableCell>
														<Badge className={`${typeConfig.color} gap-1 text-xs`}>
															{typeConfig.icon}
															{typeConfig.label}
														</Badge>
													</TableCell>
													<TableCell>
														<div>
															<p className="font-medium text-sm">{d.candidateName}</p>
															<p className="text-xs text-muted-foreground">{d.jobTitle}</p>
														</div>
													</TableCell>
													<TableCell className="font-medium text-sm">{d.decision}</TableCell>
													<TableCell>
														<div className="flex items-center gap-2">
															<span className="text-sm font-medium">
																{Math.round(d.confidence * 100)}%
															</span>
															<div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
																<div
																	className="h-full rounded-full bg-indigo-500"
																	style={{ width: `${d.confidence * 100}%` }}
																/>
															</div>
														</div>
													</TableCell>
													<TableCell className="text-xs text-muted-foreground">
														{d.modelVersion}
													</TableCell>
													<TableCell>
														{d.humanReviewed ? (
															<Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs gap-1">
																<CheckCircle2 className="h-3 w-3" />
																Yes{d.reviewerName && ` — ${d.reviewerName}`}
															</Badge>
														) : (
															<Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs gap-1">
																<Clock className="h-3 w-3" />
																Pending
															</Badge>
														)}
													</TableCell>
													<TableCell>
														{d.biasFlags.length > 0 ? (
															<Badge variant="destructive" className="text-xs">
																{d.biasFlags.length} flag{d.biasFlags.length > 1 ? 's' : ''}
															</Badge>
														) : (
															<span className="text-xs text-muted-foreground">—</span>
														)}
													</TableCell>
												</TableRow>
												{isExpanded && (
													<TableRow className="bg-muted/30">
														<TableCell colSpan={7} className="p-4">
															<div className="space-y-3">
																<div>
																	<p className="text-sm font-medium mb-1">AI Explanation</p>
																	<p className="text-sm text-muted-foreground">{d.explanation}</p>
																</div>
																<div className="flex flex-wrap gap-2">
																	<div className="text-xs text-muted-foreground">
																		<span className="font-medium">Timestamp:</span>{' '}
																		{formatDateTime(d.timestamp)}
																	</div>
																	<div className="text-xs text-muted-foreground">
																		<span className="font-medium">Decision ID:</span> {d.id}
																	</div>
																	<div className="text-xs text-muted-foreground">
																		<span className="font-medium">Model:</span> {d.modelVersion}
																	</div>
																</div>
																{d.biasFlags.length > 0 && (
																	<div className="flex flex-wrap gap-2">
																		{d.biasFlags.map((flag) => (
																			<Badge
																				key={flag}
																				variant="outline"
																				className="text-xs border-red-300 text-red-700 dark:text-red-400"
																			>
																				<AlertTriangle className="h-3 w-3 mr-1" />
																				{flag}
																			</Badge>
																		))}
																	</div>
																)}
																{!d.humanReviewed && (
																	<Button size="sm" className="gap-1">
																		<UserCheck className="h-3.5 w-3.5" />
																		Mark as Reviewed
																	</Button>
																)}
															</div>
														</TableCell>
													</TableRow>
												)}
											</>
										);
									})}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	);
}

export default RecruiterCompliancePage;
