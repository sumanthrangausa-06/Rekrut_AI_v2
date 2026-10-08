/**
 * Task 9 (#322) — shared AI interview report renderer.
 *
 * Renders the `generateScreeningReport` output stored on `session.config.report`.
 * Defensive by design: it handles both the current `dimension_scores` shape and
 * the legacy `technical_depth` / `communication_clarity` shape found on older
 * screening reports, so one component serves every session type.
 */
import { AlertCircle, CheckCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface SessionReport {
	overall_score?: number | null;
	recommendation?: 'advance' | 'consider' | 'decline' | string;
	recommendation_reasoning?: string;
	strengths?: string[];
	red_flags?: string[];
	dimension_scores?: Record<string, { score?: number; evidence?: string; feedback?: string }>;
	technical_depth?: { score?: number; feedback?: string };
	communication_clarity?: { score?: string | number; feedback?: string };
	confidence_enthusiasm?: { score?: string | number; feedback?: string };
	key_moments?: string[];
	question_scores?: Array<{
		question_index?: number;
		topic?: string;
		score?: number;
		feedback?: string;
	}>;
}

interface Dimension {
	label: string;
	score?: number | string;
	feedback?: string;
}

/** Normalize both report shapes into a uniform dimension list. */
function toDimensions(report: SessionReport): Dimension[] {
	if (report.dimension_scores) {
		const labels: Record<string, string> = {
			can_do_work: 'Can do the work',
			wants_move: 'Wants the move',
			logistics_fit: 'Logistics fit',
			communication: 'Communication',
		};
		return Object.entries(report.dimension_scores).map(([key, d]) => ({
			label: labels[key] || key,
			score: d?.score,
			feedback: d?.evidence || d?.feedback,
		}));
	}
	const dims: Dimension[] = [];
	if (report.technical_depth)
		dims.push({
			label: 'Technical Depth',
			score: report.technical_depth.score,
			feedback: report.technical_depth.feedback,
		});
	if (report.communication_clarity)
		dims.push({
			label: 'Communication',
			score: report.communication_clarity.score,
			feedback: report.communication_clarity.feedback,
		});
	if (report.confidence_enthusiasm)
		dims.push({
			label: 'Confidence',
			score: report.confidence_enthusiasm.score,
			feedback: report.confidence_enthusiasm.feedback,
		});
	return dims;
}

function scoreColor(score: number): string {
	return score >= 70 ? 'text-green-600' : score >= 50 ? 'text-yellow-600' : 'text-red-600';
}

export function SessionReportBody({ report }: { report: SessionReport }) {
	const score = report.overall_score ?? 0;
	const dimensions = toDimensions(report);
	const questions = report.question_scores || [];

	return (
		<div className="space-y-4">
			{/* Score + recommendation */}
			<div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
				<div className={`text-2xl sm:text-3xl font-bold ${scoreColor(score)}`}>{score}/100</div>
				<div>
					<Badge
						variant={
							report.recommendation === 'advance'
								? 'success'
								: report.recommendation === 'consider'
									? 'warning'
									: 'destructive'
						}
					>
						{report.recommendation?.toUpperCase() || 'N/A'}
					</Badge>
					{report.recommendation_reasoning && (
						<p className="text-sm text-muted-foreground mt-1">{report.recommendation_reasoning}</p>
					)}
				</div>
			</div>

			{/* Strengths */}
			{report.strengths && report.strengths.length > 0 && (
				<div>
					<h4 className="font-medium text-sm mb-1 text-green-700">Strengths</h4>
					<ul className="space-y-1">
						{report.strengths.map((s) => (
							<li key={s} className="text-sm flex items-start gap-1.5">
								<CheckCircle className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" /> {s}
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Red flags */}
			{report.red_flags && report.red_flags.length > 0 && (
				<div>
					<h4 className="font-medium text-sm mb-1 text-red-700">Red Flags</h4>
					<ul className="space-y-1">
						{report.red_flags.map((f) => (
							<li key={f} className="text-sm flex items-start gap-1.5">
								<AlertCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" /> {f}
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Dimensions */}
			{dimensions.length > 0 && (
				<div>
					<h4 className="font-medium text-sm mb-2">Evaluation Dimensions</h4>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
						{dimensions.map((d) => (
							<div key={d.label} className="p-3 border rounded-lg">
								<div className="flex items-center justify-between mb-1">
									<span className="text-xs font-medium text-muted-foreground">{d.label}</span>
									<span className="text-lg font-bold">{d.score ?? '—'}</span>
								</div>
								{d.feedback && <p className="text-xs text-muted-foreground">{d.feedback}</p>}
							</div>
						))}
					</div>
				</div>
			)}

			{/* Key moments */}
			{report.key_moments && report.key_moments.length > 0 && (
				<div>
					<h4 className="font-medium text-sm mb-1">Key Moments</h4>
					<ul className="space-y-1">
						{report.key_moments.map((m) => (
							<li key={m} className="text-sm text-muted-foreground">
								• {m}
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Per-question breakdown */}
			{questions.length > 0 && (
				<div>
					<h4 className="font-medium text-sm mb-2">Per-Question Breakdown</h4>
					<div className="space-y-2">
						{questions.map((qs, i) => (
							<div key={qs.question_index ?? i} className="p-3 border rounded-lg">
								<div className="flex items-center justify-between mb-1">
									<span className="text-sm font-medium">
										Q{(qs.question_index ?? i) + 1}
										{qs.topic && <span className="font-normal text-muted-foreground"> — {qs.topic}</span>}
									</span>
									<span className={`text-sm font-bold ${scoreColor(qs.score || 0)}`}>
										{qs.score ?? '—'}/100
									</span>
								</div>
								{qs.feedback && <p className="text-xs text-muted-foreground">{qs.feedback}</p>}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
