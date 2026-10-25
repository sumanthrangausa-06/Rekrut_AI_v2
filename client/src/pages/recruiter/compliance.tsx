import {
	AlertTriangle,
	ArrowLeft,
	BarChart3,
	Clock,
	FileText,
	Scale,
	Shield,
	UserCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { apiCall } from '@/lib/api';

// ─── Real API shapes (routes/compliance.js + services at HEAD) ────────────
// Every figure on this page comes from one of these recruiter-accessible,
// /api/compliance endpoints. There is no other data source for this page,
// and the admin compliance API is deliberately not used (platform-wide,
// requireAdmin — recruiters get 403s).

interface Job {
	id: number;
	title: string;
	status?: string;
}

interface GroupBreakdown {
	group_value: string;
	total_applicants?: number | string;
	selected_count?: number | string;
	total?: number | string;
	selected?: number | string;
	selection_rate: number | string;
}

interface BiasMetricRow {
	id: number;
	job_id: number;
	job_title?: string;
	metric_type: string;
	demographic_attribute: string;
	group_breakdowns: GroupBreakdown[] | string;
	overall_ratio: number | string | null;
	flagged: boolean;
	threshold_used: number | string | null;
	calculated_at: string;
}

interface FourFifthsResult {
	attribute: string;
	groups: GroupBreakdown[];
	ratio: number | string;
	flagged: boolean;
	threshold: number | string;
}

interface BiasReport {
	id: number;
	report_date: string;
	analysis_type: string;
	created_at?: string;
}

interface FairnessAudit {
	id: number;
	audit_date: string;
	audit_type: string;
	overall_fairness_score: number | string | null;
	issues_found: number | null;
	status?: string;
}

interface RetentionPolicy {
	id: number;
	data_type: string;
	retention_days: number;
	auto_delete: boolean;
	description?: string | null;
}

interface OverrideRow {
	id: number;
	application_id: number;
	original_status?: string | null;
	new_status?: string | null;
	original_score?: number | string | null;
	new_score?: number | string | null;
	reason: string;
	overridden_by_name?: string | null;
	overridden_at: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function asGroups(value: BiasMetricRow['group_breakdowns']): GroupBreakdown[] {
	if (Array.isArray(value)) return value;
	try {
		const parsed = JSON.parse(String(value));
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/** Fraction (0–1) returned by the API → "25.0%". Null stays a dash, never a guess. */
function pct(value: number | string | null | undefined): string {
	if (value === null || value === undefined || value === '') return '—';
	const n = Number(value);
	return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—';
}

function formatDate(dateStr?: string | null) {
	if (!dateStr) return '—';
	const d = new Date(dateStr);
	return Number.isNaN(d.getTime())
		? '—'
		: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function EmptyNote({ children }: { children: string }) {
	return <p className="text-sm text-muted-foreground py-4 text-center">{children}</p>;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function RecruiterCompliancePage() {
	const [jobs, setJobs] = useState<Job[]>([]);
	const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
	const [flagged, setFlagged] = useState<BiasMetricRow[]>([]);
	const [flaggedTotal, setFlaggedTotal] = useState(0);
	const [metrics, setMetrics] = useState<BiasMetricRow[]>([]);
	const [fourFifths, setFourFifths] = useState<FourFifthsResult[]>([]);
	const [overrides, setOverrides] = useState<OverrideRow[]>([]);
	const [reports, setReports] = useState<BiasReport[]>([]);
	const [audits, setAudits] = useState<FairnessAudit[]>([]);
	const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const settle = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
			const [jobsRes, flaggedRes, reportsRes, auditsRes, policiesRes] = await Promise.all([
				settle(apiCall<{ jobs: Job[] }>('/recruiter/jobs')),
				settle(
					apiCall<{ rows: BiasMetricRow[]; total: number }>('/compliance/bias/flagged'),
				),
				settle(apiCall<{ reports: BiasReport[] }>('/compliance/bias/reports')),
				settle(apiCall<{ audits: FairnessAudit[] }>('/compliance/fairness/audits')),
				settle(apiCall<{ policies: RetentionPolicy[] }>('/compliance/retention/policies')),
			]);
			if (cancelled) return;
			if (!jobsRes || !flaggedRes || !reportsRes || !auditsRes || !policiesRes) {
				setLoadError('Some compliance data could not be loaded. Figures shown are only those the service returned.');
			}
			const jobList = jobsRes?.jobs || [];
			setJobs(jobList);
			setSelectedJobId((prev) => prev ?? jobList[0]?.id ?? null);
			setFlagged(flaggedRes?.rows || []);
			setFlaggedTotal(flaggedRes?.total ?? flaggedRes?.rows?.length ?? 0);
			setReports(reportsRes?.reports || []);
			setAudits(auditsRes?.audits || []);
			setPolicies(policiesRes?.policies || []);
			setLoading(false);
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (selectedJobId == null) return;
		let cancelled = false;
		(async () => {
			const settle = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
			const [metricsRes, fourFifthsRes, overridesRes] = await Promise.all([
				settle(apiCall<{ metrics: BiasMetricRow[] }>(`/compliance/bias/metrics/${selectedJobId}`)),
				settle(
					apiCall<{ four_fifths_results: FourFifthsResult[] }>(
						`/compliance/bias/four-fifths/${selectedJobId}`,
					),
				),
				settle(
					apiCall<{ rows: OverrideRow[]; total: number }>(
						`/compliance/overrides/job/${selectedJobId}`,
					),
				),
			]);
			if (cancelled) return;
			setMetrics(metricsRes?.metrics || []);
			setFourFifths(fourFifthsRes?.four_fifths_results || []);
			setOverrides(overridesRes?.rows || []);
		})();
		return () => {
			cancelled = true;
		};
	}, [selectedJobId]);

	const selectedJob = jobs.find((j) => j.id === selectedJobId);

	return (
		<div className="space-y-6">
			{/* Header — no verdict badge: this page states records, not conclusions. */}
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
					Compliance
				</h1>
				<p className="text-muted-foreground mt-1">
					Live records returned by the compliance service: bias monitoring for your
					company&apos;s jobs, fairness audits, retention policies, and human overrides. Where
					there are no records, this page says so — nothing here is estimated or pre-filled.
				</p>
			</div>

			{loadError && (
				<Card className="border-red-200 bg-red-50/50 dark:bg-red-900/10">
					<CardContent className="p-4 flex items-start gap-3">
						<AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
						<p className="text-sm text-red-700 dark:text-red-400">{loadError}</p>
					</CardContent>
				</Card>
			)}

			{loading ? (
				<p className="text-sm text-muted-foreground flex items-center gap-2">
					<Clock className="h-4 w-4" /> Loading compliance records…
				</p>
			) : (
				<>
					{/* Summary — counts of records the service actually returned. */}
					<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
						<Card>
							<CardContent className="p-4">
								<p className="text-sm text-muted-foreground">Flagged bias metrics</p>
								<p className="text-xl font-bold">{flaggedTotal}</p>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="p-4">
								<p className="text-sm text-muted-foreground">Jobs</p>
								<p className="text-xl font-bold">{jobs.length}</p>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="p-4">
								<p className="text-sm text-muted-foreground">Fairness audits on record</p>
								<p className="text-xl font-bold">{audits.length}</p>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="p-4">
								<p className="text-sm text-muted-foreground">Retention policies on record</p>
								<p className="text-xl font-bold">{policies.length}</p>
							</CardContent>
						</Card>
					</div>

					{/* ── Flagged bias metrics (company-scoped) ── */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<AlertTriangle className="h-5 w-5 text-primary" />
								Flagged Bias Metrics
							</CardTitle>
						</CardHeader>
						<CardContent className="p-0">
							{flagged.length === 0 ? (
								<EmptyNote>
									No flagged bias metrics returned for your company.
								</EmptyNote>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Job</TableHead>
											<TableHead>Attribute</TableHead>
											<TableHead>Overall Ratio</TableHead>
											<TableHead>Threshold</TableHead>
											<TableHead>Calculated</TableHead>
											<TableHead>Status</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{flagged.map((row) => (
											<TableRow key={row.id}>
												<TableCell className="font-medium">
													{row.job_title || `Job #${row.job_id}`}
												</TableCell>
												<TableCell>{row.demographic_attribute}</TableCell>
												<TableCell>{pct(row.overall_ratio)}</TableCell>
												<TableCell>{pct(row.threshold_used)}</TableCell>
												<TableCell className="text-muted-foreground">
													{formatDate(row.calculated_at)}
												</TableCell>
												<TableCell>
													<Badge variant="destructive" className="text-xs gap-1">
														<AlertTriangle className="h-3 w-3" />
														Flagged
													</Badge>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>

					{/* ── Per-job bias detail ── */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<BarChart3 className="h-5 w-5 text-primary" />
								Bias Metrics by Job
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-6">
							{jobs.length === 0 ? (
								<EmptyNote>
									No jobs returned for your company, so there is no per-job bias data to
									show.
								</EmptyNote>
							) : (
								<>
									<label className="flex items-center gap-2 text-sm">
										<span className="text-muted-foreground">Job</span>
										<select
											aria-label="Select a job"
											className="border rounded-md px-2 py-1.5 bg-background"
											value={selectedJobId ?? ''}
											onChange={(e) => setSelectedJobId(Number(e.target.value))}
										>
											{jobs.map((job) => (
												<option key={job.id} value={job.id}>
													{job.title}
												</option>
											))}
										</select>
									</label>

									{metrics.length === 0 ? (
										<EmptyNote>
											No bias metrics stored for this job yet.
										</EmptyNote>
									) : (
										metrics.map((metric) => (
											<div key={metric.id} className="space-y-2">
												<div className="flex flex-wrap items-center gap-2">
													<p className="font-medium capitalize">
														{metric.demographic_attribute}
													</p>
													<span className="text-sm text-muted-foreground">
														Overall ratio: {pct(metric.overall_ratio)}
													</span>
													{metric.flagged ? (
														<Badge variant="destructive" className="text-xs">
															Flagged
														</Badge>
													) : (
														<Badge variant="outline" className="text-xs">
															Not flagged
														</Badge>
													)}
													<span className="text-xs text-muted-foreground">
														{formatDate(metric.calculated_at)}
													</span>
												</div>
												<Table>
													<TableHeader>
														<TableRow>
															<TableHead>Group</TableHead>
															<TableHead>Applicants</TableHead>
															<TableHead>Selected</TableHead>
															<TableHead>Selection Rate</TableHead>
														</TableRow>
													</TableHeader>
													<TableBody>
														{asGroups(metric.group_breakdowns).map((g) => (
															<TableRow key={g.group_value}>
																<TableCell className="font-medium">
																	{g.group_value}
																</TableCell>
																<TableCell>{g.total_applicants ?? g.total ?? '—'}</TableCell>
																<TableCell>{g.selected_count ?? g.selected ?? '—'}</TableCell>
																<TableCell>{pct(g.selection_rate)}</TableCell>
															</TableRow>
														))}
													</TableBody>
												</Table>
											</div>
										))
									)}

									{/* Four-fifths rule, calculated on demand for this job */}
									<div className="space-y-2">
										<p className="font-medium flex items-center gap-2">
											<Scale className="h-4 w-4 text-primary" />
											Four-Fifths Rule — {selectedJob?.title}
										</p>
										{fourFifths.length === 0 ? (
											<EmptyNote>
												No four-fifths results returned for this job. This can mean fewer
												than two demographic groups have applicants.
											</EmptyNote>
										) : (
											<Table>
												<TableHeader>
													<TableRow>
														<TableHead>Attribute</TableHead>
														<TableHead>Lowest / Highest Selection Rate Ratio</TableHead>
														<TableHead>Threshold</TableHead>
														<TableHead>Status</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{fourFifths.map((r) => (
														<TableRow key={r.attribute}>
															<TableCell className="font-medium capitalize">
																{r.attribute}
															</TableCell>
															<TableCell>{pct(r.ratio)}</TableCell>
															<TableCell>{pct(r.threshold)}</TableCell>
															<TableCell>
																{r.flagged ? (
																	<Badge variant="destructive" className="text-xs">
																		Flagged
																	</Badge>
																) : (
																	<Badge variant="outline" className="text-xs">
																		Not flagged
																	</Badge>
																)}
															</TableCell>
														</TableRow>
													))}
												</TableBody>
											</Table>
										)}
									</div>

									{/* Human overrides for this job */}
									<div className="space-y-2">
										<p className="font-medium flex items-center gap-2">
											<UserCheck className="h-4 w-4 text-primary" />
											Human Overrides — {selectedJob?.title}
										</p>
										{overrides.length === 0 ? (
											<EmptyNote>
												No human overrides recorded for this job.
											</EmptyNote>
										) : (
											<Table>
												<TableHeader>
													<TableRow>
														<TableHead>Reason</TableHead>
														<TableHead>Status Change</TableHead>
														<TableHead>Score Change</TableHead>
														<TableHead>Overridden By</TableHead>
														<TableHead>Date</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{overrides.map((o) => (
														<TableRow key={o.id}>
															<TableCell>{o.reason}</TableCell>
															<TableCell>
																{o.original_status || '—'} → {o.new_status || '—'}
															</TableCell>
															<TableCell>
																{o.original_score ?? '—'} → {o.new_score ?? '—'}
															</TableCell>
															<TableCell>{o.overridden_by_name || '—'}</TableCell>
															<TableCell className="text-muted-foreground">
																{formatDate(o.overridden_at)}
															</TableCell>
														</TableRow>
													))}
												</TableBody>
											</Table>
										)}
									</div>
								</>
							)}
						</CardContent>
					</Card>

					{/* ── Bias reports on record ── */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<FileText className="h-5 w-5 text-primary" />
								Bias Reports
							</CardTitle>
						</CardHeader>
						<CardContent className="p-0">
							{reports.length === 0 ? (
								<EmptyNote>No bias reports returned.</EmptyNote>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Report Date</TableHead>
											<TableHead>Analysis Type</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{reports.map((r) => (
											<TableRow key={r.id}>
												<TableCell>{formatDate(r.report_date)}</TableCell>
												<TableCell>{r.analysis_type}</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>

					{/* ── Fairness audits on record ── */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Scale className="h-5 w-5 text-primary" />
								Fairness Audits
							</CardTitle>
						</CardHeader>
						<CardContent className="p-0">
							{audits.length === 0 ? (
								<EmptyNote>No fairness audits returned.</EmptyNote>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Audit Date</TableHead>
											<TableHead>Type</TableHead>
											<TableHead>Overall Fairness Score</TableHead>
											<TableHead>Issues Found</TableHead>
											<TableHead>Status</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{audits.map((a) => (
											<TableRow key={a.id}>
												<TableCell>{formatDate(a.audit_date)}</TableCell>
												<TableCell>{a.audit_type}</TableCell>
												<TableCell>
													{a.overall_fairness_score ?? '—'}
												</TableCell>
												<TableCell>{a.issues_found ?? '—'}</TableCell>
												<TableCell>{a.status || '—'}</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>

					{/* ── Retention policies on record ── */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Clock className="h-5 w-5 text-primary" />
								Retention Policies
							</CardTitle>
						</CardHeader>
						<CardContent className="p-0">
							{policies.length === 0 ? (
								<EmptyNote>No retention policies returned.</EmptyNote>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Data Type</TableHead>
											<TableHead>Retention Days</TableHead>
											<TableHead>Auto-Delete</TableHead>
											<TableHead>Description</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{policies.map((p) => (
											<TableRow key={p.id}>
												<TableCell className="font-medium">{p.data_type}</TableCell>
												<TableCell>{p.retention_days}</TableCell>
												<TableCell>{p.auto_delete ? 'Yes' : 'No'}</TableCell>
												<TableCell className="text-muted-foreground">
													{p.description || '—'}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>
				</>
			)}
		</div>
	);
}

export default RecruiterCompliancePage;
