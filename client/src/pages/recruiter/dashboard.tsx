import {
	ArrowDownRight,
	ArrowRight,
	ArrowUpRight,
	BarChart3,
	Bell,
	Briefcase,
	Calendar,
	ChevronRight,
	Clock,
	Eye,
	FileText,
	Globe,
	Inbox,
	MapPin,
	MessageSquare,
	Minus,
	Plus,
	Search,
	Shield,
	Sparkles,
	Star,
	Target,
	TrendingUp,
	UserCheck,
	Users,
	Video,
	X,
	Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { RecruiterDashboardSkeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { apiCall } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────

interface PipelineStage {
	id: string;
	label: string;
	count: number;
	color: string;
	bgColor: string;
	borderColor: string;
	candidates: Array<{
		id: string;
		name: string;
		avatar?: string;
		jobTitle: string;
		matchScore?: number;
		daysInStage: number;
	}>;
}

interface DashboardAction {
	id: string;
	type: 'review' | 'interview' | 'offer' | 'message' | 'screening';
	title: string;
	subtitle: string;
	count: number;
	priority: 'high' | 'medium' | 'low';
	link: string;
}

interface DashboardActivity {
	id: string;
	type: 'applied' | 'status_change' | 'message' | 'interview_scheduled' | 'offer_sent' | 'hired';
	actorName: string;
	actorAvatar?: string;
	description: string;
	timestamp: string;
	jobTitle: string;
	meta?: string;
}

interface QuickStat {
	label: string;
	value: string | number;
	change?: number;
	icon: React.ReactNode;
	trend?: 'up' | 'down' | 'neutral';
	color: string;
	bgColor: string;
}

interface PerformanceMetric {
	label: string;
	value: string | number;
	target: string | number;
	progress: number;
	description: string;
}

interface RecruiterDashboardData {
	trust_score: {
		total_score: number;
		tier: string;
		tier_label: string;
		tier_color: string;
	};
	job_stats: {
		active_jobs: string;
		paused_jobs: string;
		closed_jobs: string;
	};
	application_stats: {
		total_applications: string;
		new_applications: string;
		reviewing: string;
		interviewed: string;
		offered: string;
		hired: string;
	};
	upcoming_interviews: Array<{
		id: number;
		candidate_name: string;
		job_title: string;
		scheduled_at: string;
	}>;
	recent_applications: Array<{
		id: number;
		candidate_name: string;
		job_title: string;
		status: string;
		applied_at: string;
		match_score?: number;
	}>;
}

// ─── Constants ──────────────────────────────────────────────

const PIPELINE_STAGES: PipelineStage[] = [
	{
		id: 'applied',
		label: 'Applied',
		count: 0,
		color: 'text-blue-700',
		bgColor: 'bg-blue-50',
		borderColor: 'border-blue-200',
		candidates: [],
	},
	{
		id: 'screening',
		label: 'Screened',
		count: 0,
		color: 'text-amber-700',
		bgColor: 'bg-amber-50',
		borderColor: 'border-amber-200',
		candidates: [],
	},
	{
		id: 'interview',
		label: 'Interview',
		count: 0,
		color: 'text-purple-700',
		bgColor: 'bg-purple-50',
		borderColor: 'border-purple-200',
		candidates: [],
	},
	{
		id: 'offer',
		label: 'Offer',
		count: 0,
		color: 'text-emerald-700',
		bgColor: 'bg-emerald-50',
		borderColor: 'border-emerald-200',
		candidates: [],
	},
	{
		id: 'hired',
		label: 'Hired',
		count: 0,
		color: 'text-indigo-700',
		bgColor: 'bg-indigo-50',
		borderColor: 'border-indigo-200',
		candidates: [],
	},
];

const statusToStage: Record<string, string> = {
	applied: 'applied',
	screening: 'screening',
	shortlisted: 'interview',
	reviewing: 'screening',
	interviewed: 'interview',
	offered: 'offer',
	hired: 'hired',
	rejected: 'rejected',
};

// ─── Helpers ────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);
	if (mins < 1) return 'Just now';
	if (mins < 60) return `${mins}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days === 1) return 'Yesterday';
	if (days < 7) return `${days}d ago`;
	if (days < 30) return `${Math.floor(days / 7)}w ago`;
	return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildDailyAppData(
	apps: RecruiterDashboardData['recent_applications'],
	days = 30,
): { label: string; value: number; fullDate: string }[] {
	const result: { label: string; value: number; fullDate: string }[] = [];
	const now = new Date();
	now.setHours(0, 0, 0, 0);

	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		const key = d.toISOString().split('T')[0];
		result.push({
			label:
				i === 0
					? 'Today'
					: d.getDate() === 1
						? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
						: `${d.getDate()}`,
			value: 0,
			fullDate: key,
		});
	}

	if (!apps || apps.length === 0) return result;

	apps.forEach((app) => {
		const appDate = new Date(app.applied_at).toISOString().split('T')[0];
		const entry = result.find((r) => r.fullDate === appDate);
		if (entry) entry.value += 1;
	});

	return result;
}

function computeMomChange(apps: RecruiterDashboardData['recent_applications']): {
	trend: 'up' | 'down' | 'neutral';
	change: number;
} {
	if (!apps || apps.length === 0) return { trend: 'neutral', change: 0 };
	const now = new Date();
	const thisMonth = now.getMonth();
	const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
	const thisYear = now.getFullYear();
	const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;

	let thisCount = 0;
	let lastCount = 0;

	apps.forEach((app) => {
		const d = new Date(app.applied_at);
		if (d.getMonth() === thisMonth && d.getFullYear() === thisYear) thisCount++;
		if (d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear) lastCount++;
	});

	if (lastCount === 0)
		return { trend: thisCount > 0 ? 'up' : 'neutral', change: thisCount > 0 ? 100 : 0 };
	const pct = Math.round(((thisCount - lastCount) / lastCount) * 100);
	return {
		trend: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral',
		change: Math.abs(pct),
	};
}

function computeHiresThisMonth(apps: RecruiterDashboardData['recent_applications']): number {
	if (!apps) return 0;
	const now = new Date();
	return apps.filter(
		(a) => a.status === 'hired' && new Date(a.applied_at).getMonth() === now.getMonth(),
	).length;
}

function computeAvgTimeToFill(apps: RecruiterDashboardData['recent_applications']): string {
	if (!apps) return '—';
	const hired = apps.filter((a) => a.status === 'hired');
	if (hired.length === 0) return '—';
	const totalDays = hired.reduce((sum, a) => {
		return sum + Math.floor((Date.now() - new Date(a.applied_at).getTime()) / 86400000);
	}, 0);
	return `${Math.round(totalDays / hired.length)}d`;
}

// ─── Chart Components ───────────────────────────────────────

function AreaChart({ data }: { data: { label: string; value: number }[] }) {
	if (data.length === 0) return null;
	const max = Math.max(...data.map((d) => d.value), 1);
	const padX = 4;
	const padY = 8;
	const viewW = 100;
	const viewH = 40;
	const chartW = viewW - padX * 2;
	const chartH = viewH - padY * 2;

	const stepX = chartW / (data.length - 1);
	const points = data.map((d, i) => {
		const x = padX + i * stepX;
		const y = padY + chartH - (d.value / max) * chartH;
		return [x, y] as const;
	});

	const areaPath = [
		`M ${points[0][0]} ${viewH - padY}`,
		...points.map((p) => `L ${p[0]} ${p[1]}`),
		`L ${points[points.length - 1][0]} ${viewH - padY}`,
		'Z',
	].join(' ');

	const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');

	// Show every ~5th label
	const labelIndices = data
		.map((_, i) => i)
		.filter((i) => i % Math.max(1, Math.floor(data.length / 6)) === 0 || i === data.length - 1);

	return (
		<div className="relative w-full">
			<svg
				viewBox={`0 0 ${viewW} ${viewH}`}
				className="w-full h-32 sm:h-40"
				preserveAspectRatio="none"
			>
				<defs>
					<linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor="#6366f1" stopOpacity="0.18" />
						<stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
					</linearGradient>
				</defs>
				<path d={areaPath} fill="url(#areaFill)" />
				<path
					d={linePath}
					fill="none"
					stroke="#6366f1"
					strokeWidth="0.6"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				{points.map((p, i) => (
					<circle key={i} cx={p[0]} cy={p[1]} r="0.7" fill="#6366f1" />
				))}
			</svg>
			<div className="flex justify-between mt-1 px-1">
				{labelIndices.map((i) => (
					<span key={i} className="text-[10px] text-muted-foreground">
						{data[i].label}
					</span>
				))}
			</div>
		</div>
	);
}

function FunnelChart({
	stages,
}: {
	stages: { label: string; count: number; color: string; bgColor: string }[];
}) {
	const total = stages.reduce((sum, s) => sum + s.count, 0);
	const max = Math.max(...stages.map((s) => s.count), 1);

	return (
		<div className="space-y-2">
			{stages.map((stage, i) => {
				const pct = total > 0 ? Math.round((stage.count / total) * 100) : 0;
				const widthPct = Math.max(20, (stage.count / max) * 100);
				return (
					<div key={stage.label} className="flex items-center gap-3">
						<span className="text-xs text-muted-foreground w-20 shrink-0 text-right whitespace-nowrap">
							{stage.label}
						</span>
						<div className="flex-1 flex items-center gap-2">
							<div
								className={`h-8 rounded-md flex items-center px-3 transition-all duration-500 ${stage.bgColor}`}
								style={{ width: `${widthPct}%`, minWidth: stage.count > 0 ? '48px' : '24px' }}
							>
								{stage.count > 0 && (
									<span className={`text-sm font-semibold ${stage.color}`}>{stage.count}</span>
								)}
							</div>
							{stage.count > 0 && (
								<span className="text-[10px] text-muted-foreground w-8">{pct}%</span>
							)}
						</div>
					</div>
				);
			})}
			{total === 0 && (
				<div className="text-center py-6 text-sm text-muted-foreground">
					No candidates in pipeline yet
				</div>
			)}
		</div>
	);
}

function BarChart({
	data,
	max,
}: {
	data: { label: string; value: number; color: string }[];
	max: number;
}) {
	return (
		<div className="flex items-end gap-2 h-32 sm:h-40">
			{data.map((d) => (
				<div key={d.label} className="flex flex-col items-center gap-1 flex-1">
					<div className="w-full flex items-end justify-center">
						<div
							className="w-full max-w-[40px] rounded-t-md transition-all duration-500"
							style={{ height: `${(d.value / max) * 100}%`, backgroundColor: d.color }}
						/>
					</div>
					<span className="text-[10px] text-muted-foreground text-center leading-tight">
						{d.label}
					</span>
				</div>
			))}
		</div>
	);
}

function DonutChart({
	data,
	total,
}: {
	data: { label: string; value: number; color: string }[];
	total: number;
}) {
	const radius = 50;
	const circumference = 2 * Math.PI * radius;
	let offset = 0;
	return (
		<div className="flex items-center gap-4">
			<svg viewBox="0 0 120 120" className="h-28 w-28 sm:h-32 sm:w-32 shrink-0">
				{data.map((d) => {
					const arc = total > 0 ? (d.value / total) * circumference : 0;
					if (arc === 0) return null;
					const el = (
						<circle
							key={d.label}
							cx="60"
							cy="60"
							r={radius}
							fill="none"
							stroke={d.color}
							strokeWidth="12"
							strokeDasharray={`${arc} ${circumference - arc}`}
							strokeDashoffset={-offset}
							strokeLinecap="round"
							className="transition-all duration-500"
						/>
					);
					offset += arc;
					return el;
				})}
				<text
					x="60"
					y="58"
					textAnchor="middle"
					className="text-sm font-bold fill-foreground"
					style={{ fontSize: '14px' }}
				>
					{total}
				</text>
				<text
					x="60"
					y="72"
					textAnchor="middle"
					className="text-[10px] fill-muted-foreground"
					style={{ fontSize: '10px' }}
				>
					total
				</text>
			</svg>
			<div className="space-y-1.5">
				{data.map((d) => (
					<div key={d.label} className="flex items-center gap-2">
						<div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
						<span className="text-xs text-muted-foreground">
							{d.label}: <span className="font-medium text-foreground">{d.value}</span>
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function WorldMapPlaceholder() {
	// Simplified world map SVG with dots for major regions
	const dots = [
		{ cx: 28, cy: 32, label: 'North America' },
		{ cx: 30, cy: 48, label: 'South America' },
		{ cx: 50, cy: 28, label: 'Europe' },
		{ cx: 52, cy: 42, label: 'Africa' },
		{ cx: 68, cy: 30, label: 'Asia' },
		{ cx: 78, cy: 50, label: 'Australia' },
	];

	return (
		<div className="relative w-full h-48 sm:h-56">
			<svg viewBox="0 0 100 60" className="w-full h-full">
				{/* Simplified continent shapes */}
				<path
					d="M18 18 Q22 12 28 14 L32 16 Q34 14 36 18 L34 24 Q30 26 26 24 L22 26 Q18 24 18 18Z"
					fill="#e2e8f0"
				/>
				<path d="M24 30 Q28 28 30 32 L28 40 Q26 44 24 42 L22 36 Q20 32 24 30Z" fill="#e2e8f0" />
				<path d="M44 16 Q48 14 52 16 L54 20 Q52 24 48 22 L44 20 Q42 18 44 16Z" fill="#e2e8f0" />
				<path d="M46 30 Q50 28 54 30 L52 38 Q50 42 48 40 L46 34 Q44 32 46 30Z" fill="#e2e8f0" />
				<path d="M60 16 Q66 14 72 18 L74 24 Q72 28 66 26 L60 24 Q58 20 60 16Z" fill="#e2e8f0" />
				<path d="M72 42 Q76 40 80 42 L82 48 Q80 52 76 50 L72 48 Q70 44 72 42Z" fill="#e2e8f0" />
				{/* Active dots */}
				{dots.map((dot, i) => (
					<g key={i}>
						<circle cx={dot.cx} cy={dot.cy} r="1.5" fill="#6366f1" opacity="0.8" />
						<circle cx={dot.cx} cy={dot.cy} r="3" fill="#6366f1" opacity="0.15" />
					</g>
				))}
			</svg>
			<div className="absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1">
				{dots.slice(0, 4).map((dot, i) => (
					<div key={i} className="flex items-center gap-1">
						<div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
						<span className="text-[10px] text-muted-foreground">{dot.label}</span>
					</div>
				))}
			</div>
		</div>
	);
}

function KpiCard({ stat, onClick }: { stat: QuickStat; onClick?: () => void }) {
	return (
		<Card
			className="overflow-hidden transition-shadow hover:shadow-md cursor-pointer border-0 shadow-sm"
			onClick={onClick}
		>
			<CardContent className="p-5">
				<div className="flex items-center justify-between mb-3">
					<div
						className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.bgColor} ${stat.color}`}
					>
						{stat.icon}
					</div>
					{stat.change !== undefined && stat.trend && (
						<div
							className={`flex items-center gap-0.5 text-xs font-medium px-2 py-0.5 rounded-full ${
								stat.trend === 'up'
									? 'bg-green-50 text-green-700'
									: stat.trend === 'down'
										? 'bg-red-50 text-red-700'
										: 'bg-slate-50 text-slate-600'
							}`}
						>
							{stat.trend === 'up' ? (
								<ArrowUpRight className="h-3 w-3" />
							) : stat.trend === 'down' ? (
								<ArrowDownRight className="h-3 w-3" />
							) : (
								<Minus className="h-3 w-3" />
							)}
							{stat.change}%
						</div>
					)}
				</div>
				<p className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
					{stat.value}
				</p>
				<p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
			</CardContent>
		</Card>
	);
}

function ActivityItem({
	activity,
	onClick,
}: {
	activity: DashboardActivity;
	onClick?: () => void;
}) {
	const getIcon = (type: string) => {
		switch (type) {
			case 'applied':
				return <FileText className="h-4 w-4 text-blue-500" />;
			case 'status_change':
				return <ChevronRight className="h-4 w-4 text-purple-500" />;
			case 'message':
				return <MessageSquare className="h-4 w-4 text-amber-500" />;
			case 'interview_scheduled':
				return <Calendar className="h-4 w-4 text-emerald-500" />;
			case 'offer_sent':
				return <Star className="h-4 w-4 text-amber-500" />;
			case 'hired':
				return <UserCheck className="h-4 w-4 text-indigo-500" />;
			default:
				return <Bell className="h-4 w-4 text-slate-400" />;
		}
	};

	const initials = activity.actorName
		.split(' ')
		.map((n) => n[0])
		.join('')
		.slice(0, 2)
		.toUpperCase();

	return (
		<div
			className="flex items-start gap-3 rounded-lg p-2.5 hover:bg-slate-50 transition-colors cursor-pointer group"
			onClick={onClick}
		>
			<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 shrink-0 group-hover:bg-white transition-colors">
				{getIcon(activity.type)}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<p className="text-sm font-medium truncate">{activity.actorName}</p>
					<span className="text-xs text-muted-foreground shrink-0">
						{timeAgo(activity.timestamp)}
					</span>
				</div>
				<p className="text-xs text-muted-foreground truncate mt-0.5">{activity.description}</p>
			</div>
		</div>
	);
}

function EmptyState({
	icon,
	title,
	description,
	action,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center py-10 text-center">
			<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400 mb-3">
				{icon}
			</div>
			<p className="text-sm font-medium text-foreground">{title}</p>
			<p className="text-xs text-muted-foreground mt-1 max-w-xs">{description}</p>
			{action && <div className="mt-3">{action}</div>}
		</div>
	);
}

// ─── Main Component ─────────────────────────────────────────

export function RecruiterDashboard() {
	const { user } = useAuth();
	const navigate = useNavigate();
	const [data, setData] = useState<RecruiterDashboardData | null>(null);
	const [loading, setLoading] = useState(true);
	const [showUpgradeBanner, setShowUpgradeBanner] = useState(true);

	useEffect(() => {
		async function loadDashboard() {
			try {
				const res = await apiCall<RecruiterDashboardData>('/recruiter/dashboard');
				setData(res);
			} catch {
				// Best-effort
			} finally {
				setLoading(false);
			}
		}
		loadDashboard();
	}, []);

	const stats = useMemo(
		() =>
			data
				? {
						activeJobs: parseInt(data.job_stats?.active_jobs || '0', 10),
						totalApplications: parseInt(data.application_stats?.total_applications || '0', 10),
						newApplications: parseInt(data.application_stats?.new_applications || '0', 10),
						hired: parseInt(data.application_stats?.hired || '0', 10),
						interviews: parseInt(data.application_stats?.interviewed || '0', 10),
						offers: parseInt(data.application_stats?.offered || '0', 10),
						reviewing: parseInt(data.application_stats?.reviewing || '0', 10),
					}
				: {
						activeJobs: 0,
						totalApplications: 0,
						newApplications: 0,
						hired: 0,
						interviews: 0,
						offers: 0,
						reviewing: 0,
					},
		[data],
	);

	// Build pipeline data from applications
	const pipelineStages = useMemo(() => {
		return PIPELINE_STAGES.map((stage) => {
			const stageCandidates =
				data?.recent_applications
					?.filter((app) => statusToStage[app.status] === stage.id)
					.map((app) => ({
						id: String(app.id),
						name: app.candidate_name || 'Anonymous',
						avatar: undefined,
						jobTitle: app.job_title,
						matchScore: app.match_score || 0,
						daysInStage: Math.floor((Date.now() - new Date(app.applied_at).getTime()) / 86400000),
					})) || [];
			return {
				...stage,
				count: stageCandidates.length,
				candidates: stageCandidates,
			};
		});
	}, [data]);

	const mom = useMemo(() => computeMomChange(data?.recent_applications), [data]);
	const hiresThisMonth = useMemo(() => computeHiresThisMonth(data?.recent_applications), [data]);
	const avgTimeToFill = useMemo(() => computeAvgTimeToFill(data?.recent_applications), [data]);

	// KPI stats
	const kpiStats: QuickStat[] = [
		{
			label: 'Active Jobs',
			value: stats.activeJobs,
			change: stats.activeJobs > 0 ? 12 : 0,
			trend: stats.activeJobs > 0 ? 'up' : 'neutral',
			icon: <Briefcase className="h-5 w-5" />,
			color: 'text-indigo-600',
			bgColor: 'bg-indigo-50',
		},
		{
			label: 'Total Applicants',
			value: stats.totalApplications,
			change: mom.change,
			trend: mom.trend,
			icon: <Users className="h-5 w-5" />,
			color: 'text-blue-600',
			bgColor: 'bg-blue-50',
		},
		{
			label: 'Hires This Month',
			value: hiresThisMonth,
			change: hiresThisMonth > 0 ? 8 : 0,
			trend: hiresThisMonth > 0 ? 'up' : 'neutral',
			icon: <UserCheck className="h-5 w-5" />,
			color: 'text-emerald-600',
			bgColor: 'bg-emerald-50',
		},
		{
			label: 'Avg Time-to-Fill',
			value: avgTimeToFill,
			change: 0,
			trend: 'neutral',
			icon: <Clock className="h-5 w-5" />,
			color: 'text-amber-600',
			bgColor: 'bg-amber-50',
		},
	];

	// 30-day applicant data
	const dailyAppData = useMemo(() => buildDailyAppData(data?.recent_applications, 30), [data]);

	// Recent activity
	const recentActivity: DashboardActivity[] = useMemo(() => {
		if (!data?.recent_applications || data.recent_applications.length === 0) return [];
		return data.recent_applications.slice(0, 8).map((app) => ({
			id: String(app.id),
			type: 'applied' as const,
			actorName: app.candidate_name || 'Anonymous',
			description: `Applied for ${app.job_title}`,
			timestamp: app.applied_at,
			jobTitle: app.job_title,
			meta: app.status,
		}));
	}, [data]);

	// Action items
	const actionItems: DashboardAction[] = useMemo(
		() => [
			{
				id: '1',
				type: 'review',
				title: `${stats.newApplications} candidates need review`,
				subtitle:
					stats.newApplications > 0
						? 'New applications awaiting review'
						: 'No new applications to review',
				count: stats.newApplications,
				priority: stats.newApplications > 5 ? 'high' : stats.newApplications > 0 ? 'medium' : 'low',
				link: '/recruiter/candidates?status=applied',
			},
			{
				id: '2',
				type: 'interview',
				title: `${stats.interviews} interviews today`,
				subtitle:
					stats.interviews > 0
						? 'Check your calendar and prepare'
						: 'No interviews scheduled today',
				count: stats.interviews,
				priority: stats.interviews > 0 ? 'high' : 'low',
				link: '/recruiter/interviews',
			},
			{
				id: '3',
				type: 'offer',
				title: `${stats.offers} offers pending`,
				subtitle: stats.offers > 0 ? 'Awaiting candidate response' : 'No pending offers',
				count: stats.offers,
				priority: stats.offers > 0 ? 'medium' : 'low',
				link: '/recruiter/offers',
			},
			{
				id: '4',
				type: 'screening',
				title: 'AI screening ready',
				subtitle:
					stats.totalApplications > 0
						? `${stats.totalApplications} candidates in pipeline`
						: 'No candidates to screen',
				count: stats.totalApplications,
				priority: stats.totalApplications > 10 ? 'medium' : 'low',
				link: '/recruiter/screening',
			},
		],
		[stats],
	);

	const getActionIcon = (type: string) => {
		switch (type) {
			case 'review':
				return <Eye className="h-4 w-4" />;
			case 'interview':
				return <Video className="h-4 w-4" />;
			case 'offer':
				return <FileText className="h-4 w-4" />;
			case 'message':
				return <MessageSquare className="h-4 w-4" />;
			case 'screening':
				return <Sparkles className="h-4 w-4" />;
			default:
				return <Bell className="h-4 w-4" />;
		}
	};

	const getPriorityColor = (priority: string) => {
		switch (priority) {
			case 'high':
				return 'bg-red-50 border-red-200 text-red-700';
			case 'medium':
				return 'bg-amber-50 border-amber-200 text-amber-700';
			case 'low':
				return 'bg-slate-50 border-slate-200 text-slate-700';
			default:
				return 'bg-slate-50 border-slate-200 text-slate-700';
		}
	};

	const totalPipeline = pipelineStages.reduce((sum, s) => sum + s.count, 0);

	if (loading) {
		return <RecruiterDashboardSkeleton />;
	}

	return (
		<div className="space-y-8">
			{/* ── Header ── */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
						Welcome back,{' '}
						<span className="text-indigo-600">{user?.name?.split(' ')[0] || 'Recruiter'}</span>
					</h1>
					<p className="text-muted-foreground mt-1">
						Here's what's happening with your hiring pipeline today
					</p>
				</div>
				<div className="flex gap-2">
					<Link to="/recruiter/jobs/new">
						<Button className="gap-2 bg-indigo-600 hover:bg-indigo-700 shadow-sm">
							<Plus className="h-4 w-4" />
							Post New Job
						</Button>
					</Link>
				</div>
			</div>

			{/* ── Upgrade Banner ── */}
			{showUpgradeBanner && (
				<Card className="border-indigo-200 bg-indigo-50/60 relative overflow-hidden">
					<CardContent className="p-4 flex items-center gap-4">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 shrink-0">
							<Sparkles className="h-5 w-5 text-indigo-600" />
						</div>
						<div className="flex-1 min-w-0">
							<p className="font-medium text-sm">Upgrade to Pro to unlock advanced features</p>
							<p className="text-xs text-muted-foreground">
								Search entire candidate database, AI video interviews, advanced analytics, and
								contract generation
							</p>
						</div>
						<Button
							size="sm"
							className="bg-indigo-600 hover:bg-indigo-700 shrink-0 min-h-[44px]"
							onClick={() => navigate('/recruiter/billing')}
						>
							Upgrade
						</Button>
						<button
							onClick={() => setShowUpgradeBanner(false)}
							className="shrink-0 text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md p-2"
						>
							<X className="h-4 w-4" />
						</button>
					</CardContent>
				</Card>
			)}

			{/* ── Trust Score Banner ── */}
			{data?.trust_score && (
				<Card className="border-slate-200 shadow-sm">
					<CardContent className="flex items-center gap-4 p-4">
						<Shield className="h-8 w-8 shrink-0" style={{ color: data.trust_score.tier_color }} />
						<div className="flex-1">
							<p className="font-medium">
								Employer Trust Score:{' '}
								<span style={{ color: data.trust_score.tier_color }}>
									{data.trust_score.total_score}/100
								</span>
							</p>
							<p className="text-xs text-muted-foreground">
								{data.trust_score.tier_label} — Higher scores attract more qualified candidates
							</p>
						</div>
						<Link to="/recruiter/company">
							<Button variant="outline" size="sm" className="gap-1 min-h-[44px]">
								Improve Score
								<ArrowRight className="h-3 w-3" />
							</Button>
						</Link>
					</CardContent>
				</Card>
			)}

			{/* ── KPI Stats ── */}
			<div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
				{kpiStats.map((stat) => (
					<KpiCard
						key={stat.label}
						stat={stat}
						onClick={() => {
							if (stat.label === 'Active Jobs') navigate('/recruiter/jobs');
							if (stat.label === 'Total Applicants') navigate('/recruiter/candidates');
							if (stat.label === 'Hires This Month') navigate('/recruiter/candidates?status=hired');
						}}
					/>
				))}
			</div>

			{/* ── Quick Actions ── */}
			<div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
				<Link to="/recruiter/jobs/new">
					<Card className="transition-all hover:shadow-md hover:border-indigo-200 cursor-pointer h-full border-0 shadow-sm bg-indigo-600 text-white">
						<CardContent className="flex items-center gap-4 p-5">
							<div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 shrink-0">
								<Plus className="h-5 w-5 text-white" />
							</div>
							<div className="min-w-0 flex-1">
								<span className="text-sm font-semibold">Post New Job</span>
								<p className="text-xs text-indigo-100 mt-0.5">AI-assisted job creation</p>
							</div>
							<ArrowRight className="h-5 w-5 text-indigo-200 shrink-0" />
						</CardContent>
					</Card>
				</Link>
				<Link to="/recruiter/candidates">
					<Card className="transition-all hover:shadow-md hover:border-blue-200 cursor-pointer h-full border-0 shadow-sm">
						<CardContent className="flex items-center gap-4 p-5">
							<div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 shrink-0">
								<Search className="h-5 w-5" />
							</div>
							<div className="min-w-0 flex-1">
								<span className="text-sm font-semibold">View Candidates</span>
								<p className="text-xs text-muted-foreground mt-0.5">Browse your talent pool</p>
							</div>
							<ArrowRight className="h-5 w-5 text-muted-foreground shrink-0" />
						</CardContent>
					</Card>
				</Link>
				<Link to="/recruiter/interviews">
					<Card className="transition-all hover:shadow-md hover:border-purple-200 cursor-pointer h-full border-0 shadow-sm">
						<CardContent className="flex items-center gap-4 p-5">
							<div className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-50 text-purple-600 shrink-0">
								<Calendar className="h-5 w-5" />
							</div>
							<div className="min-w-0 flex-1">
								<span className="text-sm font-semibold">Schedule Interview</span>
								<p className="text-xs text-muted-foreground mt-0.5">Calendar integration</p>
							</div>
							<ArrowRight className="h-5 w-5 text-muted-foreground shrink-0" />
						</CardContent>
					</Card>
				</Link>
			</div>

			{/* ── Main Analytics Grid ── */}
			<div className="grid gap-6 lg:grid-cols-3">
				{/* Left column: Charts */}
				<div className="lg:col-span-2 space-y-6">
					{/* Applicants Over Time + Pipeline Breakdown */}
					<div className="grid gap-6 sm:grid-cols-2">
						{/* Applicants Over Time */}
						<Card className="border-0 shadow-sm">
							<CardHeader className="pb-3">
								<CardTitle className="text-sm flex items-center gap-2 font-medium">
									<TrendingUp className="h-4 w-4 text-indigo-500" />
									Applicants Over Time
								</CardTitle>
							</CardHeader>
							<CardContent className="pt-0">
								{stats.totalApplications > 0 ? (
									<>
										<AreaChart data={dailyAppData} />
										<div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-100">
											<span className="text-xs text-muted-foreground">Last 30 days</span>
											<Badge variant="outline" className="text-xs gap-1 font-normal">
												{mom.trend === 'up' ? (
													<ArrowUpRight className="h-3 w-3 text-green-500" />
												) : mom.trend === 'down' ? (
													<ArrowDownRight className="h-3 w-3 text-red-500" />
												) : (
													<Minus className="h-3 w-3 text-slate-400" />
												)}
												{mom.change > 0 ? `${mom.change}% vs last month` : 'No change'}
											</Badge>
										</div>
									</>
								) : (
									<EmptyState
										icon={<TrendingUp className="h-6 w-6" />}
										title="No applicant data yet"
										description="Applications will appear here once candidates start applying to your jobs."
										action={
											<Link to="/recruiter/jobs/new">
												<Button size="sm" className="gap-1 bg-indigo-600 hover:bg-indigo-700">
													<Plus className="h-3 w-3" /> Post a Job
												</Button>
											</Link>
										}
									/>
								)}
							</CardContent>
						</Card>

						{/* Pipeline Funnel */}
						<Card className="border-0 shadow-sm">
							<CardHeader className="pb-3">
								<CardTitle className="text-sm flex items-center gap-2 font-medium">
									<BarChart3 className="h-4 w-4 text-blue-500" />
									Pipeline Funnel
								</CardTitle>
							</CardHeader>
							<CardContent className="pt-0">
								<FunnelChart
									stages={pipelineStages.map((s) => ({
										label: s.label,
										count: s.count,
										color: s.color,
										bgColor: s.bgColor,
									}))}
								/>
								<div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
									<span className="text-xs text-muted-foreground">
										{totalPipeline} candidates total
									</span>
									<Button
										variant="ghost"
										size="sm"
										className="text-xs h-7 gap-1"
										onClick={() => navigate('/recruiter/candidates')}
									>
										View pipeline <ArrowRight className="h-3 w-3" />
									</Button>
								</div>
							</CardContent>
						</Card>
					</div>

					{/* Pipeline Overview */}
					<Card className="border-0 shadow-sm">
						<CardHeader className="pb-3 flex flex-row items-center justify-between">
							<CardTitle className="text-sm flex items-center gap-2 font-medium">
								<Zap className="h-4 w-4 text-indigo-500" />
								Pipeline Overview
							</CardTitle>
							<Link to="/recruiter/candidates">
								<Button variant="ghost" size="sm" className="gap-1 h-7 text-xs">
									View all <ArrowRight className="h-3 w-3" />
								</Button>
							</Link>
						</CardHeader>
						<CardContent className="pt-0">
							{/* Horizontal pipeline stages */}
							<div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
								{pipelineStages.map((stage) => (
									<div
										key={stage.id}
										className={`flex flex-col items-center gap-1 rounded-lg px-2 py-3 cursor-pointer transition-all hover:shadow-sm ${stage.bgColor} border ${stage.borderColor} min-h-[72px] justify-center`}
										onClick={() => navigate(`/recruiter/candidates?status=${stage.id}`)}
									>
										<span className={`text-xl font-bold ${stage.color}`}>{stage.count}</span>
										<span className="text-[11px] text-muted-foreground">{stage.label}</span>
									</div>
								))}
							</div>

							{/* Candidate mini-cards */}
							{totalPipeline > 0 ? (
								<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
									{pipelineStages
										.filter((s) => s.candidates.length > 0)
										.slice(0, 3)
										.map((stage) => (
											<Card key={stage.id} className={`${stage.bgColor} ${stage.borderColor}`}>
												<CardHeader className="pb-2">
													<CardTitle className="text-sm flex items-center justify-between font-medium">
														<span className={stage.color}>{stage.label}</span>
														<Badge variant="outline" className="text-xs">
															{stage.count}
														</Badge>
													</CardTitle>
												</CardHeader>
												<CardContent className="pt-0 space-y-2">
													{stage.candidates.slice(0, 3).map((candidate) => (
														<div
															key={candidate.id}
															className="flex items-center gap-2 rounded-md p-2 bg-white/80 cursor-pointer hover:bg-white transition-colors"
															onClick={() => navigate(`/recruiter/candidates?id=${candidate.id}`)}
														>
															<Avatar className="h-7 w-7">
																<AvatarFallback className={`text-xs ${stage.color} bg-white`}>
																	{candidate.name.slice(0, 2).toUpperCase()}
																</AvatarFallback>
															</Avatar>
															<div className="min-w-0 flex-1">
																<p className="text-sm font-medium truncate">{candidate.name}</p>
																<p className="text-xs text-muted-foreground truncate">
																	{candidate.jobTitle}
																</p>
															</div>
															{candidate.matchScore && candidate.matchScore > 0 && (
																<Badge
																	className={`text-xs shrink-0 ${
																		candidate.matchScore >= 80
																			? 'bg-green-100 text-green-700'
																			: candidate.matchScore >= 60
																				? 'bg-amber-100 text-amber-700'
																				: 'bg-red-100 text-red-700'
																	}`}
																>
																	{candidate.matchScore}%
																</Badge>
															)}
														</div>
													))}
													{stage.candidates.length > 3 && (
														<p className="text-xs text-muted-foreground text-center py-1">
															+{stage.candidates.length - 3} more
														</p>
													)}
												</CardContent>
											</Card>
										))}
								</div>
							) : (
								<EmptyState
									icon={<Users className="h-6 w-6" />}
									title="No candidates in pipeline"
									description="Your pipeline will fill up as candidates apply to your open positions."
									action={
										<Link to="/recruiter/jobs/new">
											<Button size="sm" className="gap-1 bg-indigo-600 hover:bg-indigo-700">
												<Plus className="h-3 w-3" /> Post a Job
											</Button>
										</Link>
									}
								/>
							)}
						</CardContent>
					</Card>
				</div>

				{/* Right column: Activity + Map */}
				<div className="space-y-6">
					{/* Recent Activity */}
					<Card className="border-0 shadow-sm">
						<CardHeader className="pb-3">
							<CardTitle className="text-sm flex items-center gap-2 font-medium">
								<Bell className="h-4 w-4 text-slate-500" />
								Recent Activity
							</CardTitle>
						</CardHeader>
						<CardContent className="pt-0">
							{recentActivity.length > 0 ? (
								<div className="space-y-1">
									{recentActivity.map((activity) => (
										<ActivityItem
											key={activity.id}
											activity={activity}
											onClick={() => navigate(`/recruiter/candidates?status=${activity.meta}`)}
										/>
									))}
								</div>
							) : (
								<EmptyState
									icon={<Bell className="h-6 w-6" />}
									title="No recent activity"
									description="Activity from candidates and your team will appear here."
								/>
							)}
							<Link to="/recruiter/candidates">
								<Button variant="ghost" size="sm" className="w-full mt-3 gap-1 h-9 text-xs">
									View all activity <ArrowRight className="h-3 w-3" />
								</Button>
							</Link>
						</CardContent>
					</Card>

					{/* World Map */}
					<Card className="border-0 shadow-sm">
						<CardHeader className="pb-2">
							<CardTitle className="text-sm flex items-center gap-2 font-medium">
								<Globe className="h-4 w-4 text-indigo-500" />
								Applicant Geography
							</CardTitle>
						</CardHeader>
						<CardContent className="pt-0">
							<WorldMapPlaceholder />
							<div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
								<span className="text-xs text-muted-foreground">
									{stats.totalApplications} applicants worldwide
								</span>
								<MapPin className="h-3.5 w-3.5 text-muted-foreground" />
							</div>
						</CardContent>
					</Card>
				</div>
			</div>

			{/* ── Action Items ── */}
			<Card className="border-amber-200 bg-amber-50/40 shadow-sm">
				<CardHeader className="pb-3">
					<CardTitle className="text-sm flex items-center gap-2 font-medium">
						<Inbox className="h-4 w-4 text-amber-600" />
						Action Items
					</CardTitle>
				</CardHeader>
				<CardContent className="pt-0">
					<div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
						{actionItems.map((action) => (
							<div
								key={action.id}
								onClick={() => navigate(action.link)}
								className={`flex flex-col gap-2 rounded-lg border p-3 cursor-pointer transition-all hover:shadow-sm ${getPriorityColor(action.priority)}`}
							>
								<div className="flex items-center gap-2">
									<div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/80 shrink-0">
										{getActionIcon(action.type)}
									</div>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium leading-tight">{action.title}</p>
									</div>
									<Badge className="shrink-0 h-5 px-1.5 text-xs bg-white/80">{action.count}</Badge>
								</div>
								<p className="text-xs opacity-75 leading-relaxed">{action.subtitle}</p>
							</div>
						))}
					</div>
				</CardContent>
			</Card>

			{/* ── Upcoming Interviews ── */}
			{data?.upcoming_interviews && data.upcoming_interviews.length > 0 && (
				<Card className="border-0 shadow-sm">
					<CardHeader className="flex flex-row items-center justify-between pb-3">
						<CardTitle className="text-sm flex items-center gap-2 font-medium">
							<Calendar className="h-4 w-4 text-purple-500" />
							Upcoming Interviews
						</CardTitle>
						<Link to="/recruiter/interviews">
							<Button variant="ghost" size="sm" className="gap-1 h-7 text-xs">
								View all <ArrowRight className="h-3 w-3" />
							</Button>
						</Link>
					</CardHeader>
					<CardContent className="pt-0">
						<div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
							{data.upcoming_interviews.slice(0, 3).map((interview) => (
								<div
									key={interview.id}
									className="flex items-center gap-3 rounded-lg border p-3 hover:bg-slate-50 transition-colors cursor-pointer"
									onClick={() => navigate(`/recruiter/interviews/${interview.id}`)}
								>
									<div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 shrink-0">
										<span className="text-sm font-medium text-purple-700">
											{interview.candidate_name.slice(0, 2).toUpperCase()}
										</span>
									</div>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium">{interview.candidate_name}</p>
										<p className="text-xs text-muted-foreground">{interview.job_title}</p>
										<p className="text-xs text-purple-600">
											{new Date(interview.scheduled_at).toLocaleDateString('en-US', {
												weekday: 'short',
												month: 'short',
												day: 'numeric',
												hour: '2-digit',
												minute: '2-digit',
											})}
										</p>
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
