import {
	AlertCircle,
	ChevronDown,
	ChevronUp,
	Crown,
	FileText,
	Lightbulb,
	Loader2,
	RefreshCw,
	Sparkles,
	Upload,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { apiCall } from '@/lib/api';
import { cn } from '@/lib/utils';

// ── Types ───────────────────────────────────────────────────────────────────

interface SectionScore {
	name: string;
	score: number;
	impact: 'Highest' | 'Medium' | 'Low';
	recommendations: string[];
}

interface CVAnalysis {
	id: number;
	status: 'pending' | 'completed' | 'failed';
	overall_score: number;
	section_scores: SectionScore[];
	recommendations?: Array<{ section: string; impact: string; text: string }>;
}

interface TriggerResponse {
	success: boolean;
	analysis_id: number;
	status: string;
}

interface AnalysisResponse {
	success: boolean;
	analysis: CVAnalysis;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function scoreColorClass(score: number): string {
	if (score >= 80) return 'text-emerald-600';
	if (score >= 60) return 'text-amber-600';
	if (score >= 40) return 'text-orange-600';
	return 'text-red-600';
}

function scoreBorderBgClass(score: number): string {
	if (score >= 80) return 'bg-emerald-50 border-emerald-200';
	if (score >= 60) return 'bg-amber-50 border-amber-200';
	if (score >= 40) return 'bg-orange-50 border-orange-200';
	return 'bg-red-50 border-red-200';
}

function impactBadgeClass(impact: string): string {
	switch (impact) {
		case 'Highest':
			return 'bg-red-100 text-red-700 border-red-200';
		case 'Medium':
			return 'bg-amber-100 text-amber-700 border-amber-200';
		default:
			return 'bg-gray-100 text-gray-600 border-gray-200';
	}
}

function overallScoreLabel(score: number): string {
	if (score >= 90) return 'Outstanding';
	if (score >= 80) return 'Great';
	if (score >= 70) return 'Good';
	if (score >= 60) return 'Fair';
	if (score >= 50) return 'Needs Improvement';
	return 'Critical';
}

// ── Section Accordion ───────────────────────────────────────────────────────

function SectionAccordion({
	section,
	expanded,
	onToggle,
}: {
	section: SectionScore;
	expanded: boolean;
	onToggle: () => void;
}) {
	return (
		<Card className="overflow-hidden">
			<button
				onClick={onToggle}
				className="w-full flex items-center justify-between p-4 hover:bg-muted/40 transition-colors text-left"
			>
				<div className="flex items-center gap-3 flex-wrap">
					<span className="font-semibold text-sm">{section.name}</span>
					<span className={cn('text-xs font-bold tabular-nums', scoreColorClass(section.score))}>
						{section.score}%
					</span>
					<span
						className={cn(
							'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border',
							impactBadgeClass(section.impact),
						)}
					>
						{section.impact} Impact
					</span>
				</div>
				{expanded ? (
					<ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
				) : (
					<ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
				)}
			</button>
			{expanded && (
				<div className="px-4 pb-4">
					{section.recommendations.length > 0 ? (
						<ul className="space-y-2">
							{section.recommendations.map((rec, i) => (
								<li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
									<Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
									<span>{rec}</span>
								</li>
							))}
						</ul>
					) : (
						<p className="text-sm text-muted-foreground">
							No specific recommendations for this section.
						</p>
					)}
				</div>
			)}
		</Card>
	);
}

// ── Main Page ───────────────────────────────────────────────────────────────

type PageState =
	| { kind: 'idle' }
	| { kind: 'analyzing'; analysisId: number }
	| { kind: 'completed'; analysis: CVAnalysis }
	| { kind: 'failed'; message: string }
	| { kind: 'upgrade_required' }
	| { kind: 'no_document' };

export function CVReviewPage() {
	const navigate = useNavigate();
	const [state, setState] = useState<PageState>({ kind: 'idle' });
	const [expandedSection, setExpandedSection] = useState<string | null>(null);
	const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const clearPoll = useCallback(() => {
		if (pollTimerRef.current) {
			clearInterval(pollTimerRef.current);
			pollTimerRef.current = null;
		}
	}, []);

	useEffect(() => {
		return () => clearPoll();
	}, [clearPoll]);

	const toggleSection = useCallback((name: string) => {
		setExpandedSection((prev) => (prev === name ? null : name));
	}, []);

	const startPolling = useCallback(
		(analysisId: number) => {
			clearPoll();
			setState({ kind: 'analyzing', analysisId });

			const poll = async () => {
				try {
					const data = await apiCall<AnalysisResponse>(`/candidate/cv/analysis/${analysisId}`);
					const analysis = data.analysis;

					if (analysis.status === 'completed') {
						clearPoll();
						setState({ kind: 'completed', analysis });
						setExpandedSection(analysis.section_scores[0]?.name ?? null);
					} else if (analysis.status === 'failed') {
						clearPoll();
						setState({
							kind: 'failed',
							message: 'CV analysis failed. Please try again.',
						});
					}
					// pending → keep polling
				} catch (err: any) {
					clearPoll();
					setState({
						kind: 'failed',
						message: err?.message || 'Failed to fetch analysis results.',
					});
				}
			};

			poll(); // immediate first check
			pollTimerRef.current = setInterval(poll, 2000);
		},
		[clearPoll],
	);

	const handleAnalyze = useCallback(async () => {
		setState({ kind: 'idle' });
		setExpandedSection(null);

		try {
			const data = await apiCall<TriggerResponse>('/candidate/cv/analyze', {
				method: 'POST',
			});
			startPolling(data.analysis_id);
		} catch (err: any) {
			const code = (err as Error & { code?: string }).code;
			if (code === 'UPGRADE_REQUIRED') {
				setState({ kind: 'upgrade_required' });
			} else if (code === 'NO_DOCUMENT') {
				setState({ kind: 'no_document' });
			} else {
				setState({
					kind: 'failed',
					message: err?.message || 'Failed to start CV analysis.',
				});
			}
		}
	}, [startPolling]);

	const handleReset = useCallback(() => {
		clearPoll();
		setState({ kind: 'idle' });
		setExpandedSection(null);
	}, [clearPoll]);

	const analysis = state.kind === 'completed' ? state.analysis : null;
	const overallScore = analysis?.overall_score ?? 0;

	return (
		<div className="space-y-6 px-4 sm:px-6 max-w-4xl mx-auto">
			{/* Header */}
			<div className="flex items-center gap-3">
				<div className="p-2 rounded-lg bg-primary/10">
					<FileText className="h-5 w-5 text-primary" />
				</div>
				<div>
					<h1 className="text-2xl font-bold">CV Review</h1>
					<p className="text-muted-foreground text-sm">
						Get AI-powered feedback on your CV strengths, improvements, and ATS compatibility
					</p>
				</div>
			</div>

			{/* ── Idle / Trigger ── */}
			{state.kind === 'idle' && (
				<Card>
					<CardContent className="p-8 flex flex-col items-center text-center gap-4">
						<div className="p-3 rounded-full bg-primary/10">
							<Sparkles className="h-8 w-8 text-primary" />
						</div>
						<div>
							<h2 className="text-lg font-semibold">Analyze Your CV</h2>
							<p className="text-sm text-muted-foreground mt-1 max-w-md">
								Our AI will review your latest uploaded CV and provide actionable feedback on how to
								improve it.
							</p>
						</div>
						<Button onClick={handleAnalyze} className="gap-2">
							<Sparkles className="h-4 w-4" />
							Analyze My CV
						</Button>
					</CardContent>
				</Card>
			)}

			{/* ── Analyzing ── */}
			{state.kind === 'analyzing' && (
				<Card>
					<CardContent className="p-8 flex flex-col items-center text-center gap-4">
						<Loader2 className="h-8 w-8 text-primary animate-spin" />
						<div>
							<h2 className="text-lg font-semibold">Analyzing your CV…</h2>
							<p className="text-sm text-muted-foreground mt-1">
								This usually takes 10–30 seconds. We're checking structure, keywords, ATS
								compatibility, and more.
							</p>
						</div>
					</CardContent>
				</Card>
			)}

			{/* ── Upgrade Required ── */}
			{state.kind === 'upgrade_required' && (
				<Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-white">
					<CardContent className="p-8 flex flex-col items-center text-center gap-4">
						<div className="p-3 rounded-full bg-amber-100">
							<Crown className="h-8 w-8 text-amber-600" />
						</div>
						<div>
							<h2 className="text-lg font-semibold">Upgrade to Pro</h2>
							<p className="text-sm text-muted-foreground mt-1 max-w-md">
								CV Review is a Pro feature. Upgrade your plan to unlock AI-powered CV analysis,
								recommendations, and ATS scoring.
							</p>
						</div>
						<Button
							onClick={() => navigate('/pricing')}
							className="gap-2 bg-amber-600 hover:bg-amber-700"
						>
							<Crown className="h-4 w-4" />
							Upgrade to Pro
						</Button>
						<Button variant="ghost" size="sm" onClick={handleReset}>
							Go Back
						</Button>
					</CardContent>
				</Card>
			)}

			{/* ── No Document ── */}
			{state.kind === 'no_document' && (
				<Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-white">
					<CardContent className="p-8 flex flex-col items-center text-center gap-4">
						<div className="p-3 rounded-full bg-blue-100">
							<Upload className="h-8 w-8 text-blue-600" />
						</div>
						<div>
							<h2 className="text-lg font-semibold">Upload Your CV First</h2>
							<p className="text-sm text-muted-foreground mt-1 max-w-md">
								We couldn't find a CV on file. Please upload your resume to the Documents section
								first, then come back to analyze it.
							</p>
						</div>
						<Button onClick={() => navigate('/candidate/documents')} className="gap-2">
							<Upload className="h-4 w-4" />
							Go to Documents
						</Button>
						<Button variant="ghost" size="sm" onClick={handleReset}>
							Go Back
						</Button>
					</CardContent>
				</Card>
			)}

			{/* ── Failed ── */}
			{state.kind === 'failed' && (
				<Card className="border-red-200">
					<CardContent className="p-6">
						<div className="flex items-start gap-3">
							<AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
							<div className="flex-1">
								<h3 className="font-semibold text-sm">Analysis Failed</h3>
								<p className="text-sm text-muted-foreground mt-1">{state.message}</p>
							</div>
						</div>
						<div className="flex gap-2 mt-4">
							<Button onClick={handleAnalyze} className="gap-2">
								<RefreshCw className="h-4 w-4" />
								Try Again
							</Button>
							<Button variant="outline" onClick={handleReset}>
								Cancel
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{/* ── Results ── */}
			{analysis && (
				<div className="space-y-6">
					{/* Overall Score Card */}
					<Card className={cn('border-2', scoreBorderBgClass(overallScore))}>
						<CardContent className="p-6">
							<div className="flex flex-col sm:flex-row items-center gap-6">
								<div className="flex flex-col items-center">
									<div
										className={cn('text-6xl font-bold tabular-nums', scoreColorClass(overallScore))}
									>
										{overallScore}
									</div>
									<div className="text-sm font-medium text-muted-foreground mt-1">out of 100</div>
								</div>
								<div className="flex-1 text-center sm:text-left">
									<h2 className={cn('text-xl font-bold', scoreColorClass(overallScore))}>
										{overallScore > 0 ? overallScoreLabel(overallScore) : 'Analysis Complete'}
									</h2>
									<p className="text-sm text-muted-foreground mt-1">
										Based on {analysis.section_scores.length} evaluated sections
									</p>
								</div>
								<Button variant="outline" onClick={handleReset}>
									<RefreshCw className="h-4 w-4 mr-1.5" />
									Analyze Again
								</Button>
							</div>
						</CardContent>
					</Card>

					{/* Score Breakdown */}
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="text-base">Score Breakdown</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							{analysis.section_scores.map((section) => (
								<div key={section.name} className="space-y-1.5">
									<div className="flex items-center justify-between text-sm">
										<span className="font-medium">{section.name}</span>
										<span className={cn('font-bold tabular-nums', scoreColorClass(section.score))}>
											{section.score}%
										</span>
									</div>
									<Progress value={section.score} />
								</div>
							))}
						</CardContent>
					</Card>

					{/* Section Accordion Feedback */}
					<div className="space-y-3">
						<h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
							Detailed Feedback
						</h3>
						{analysis.section_scores.map((section) => (
							<SectionAccordion
								key={section.name}
								section={section}
								expanded={expandedSection === section.name}
								onToggle={() => toggleSection(section.name)}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

export default CVReviewPage;
