import {
	AlertCircle,
	Briefcase,
	Building2,
	CheckCircle,
	ChevronLeft,
	Clock,
	GraduationCap,
	Search,
	ShieldAlert,
	User,
	XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/domain/empty-state';
import { Skeleton } from '@/components/domain/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trackEvent } from '@/lib/analytics';
import { apiCall } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────

type CandidateResult = {
	id: string;
	name: string;
	email?: string;
	avatar?: string;
	headline?: string;
};

type EmploymentEntry = {
	id: number;
	company_name: string;
	job_title: string;
	start_date: string | null;
	end_date: string | null;
	is_current: boolean;
	reference_name: string | null;
	reference_email: string | null;
	reference_phone: string | null;
	description: string | null;
};

type EducationEntry = {
	id: number;
	institution_name: string;
	degree: string | null;
	field_of_study: string | null;
	start_date: string | null;
	end_date: string | null;
	is_current: boolean;
};

type VerificationRequest = {
	id: number;
	type: 'employment' | 'education' | 'reference';
	status: string;
	declared_data?: Record<string, unknown>;
	discrepancy_list?: Array<{ field: string; severity: string; status: string }>;
	responded_at?: string | null;
	notes?: string | null;
};

type Discrepancy = {
	id: number;
	field_name: string;
	declared_value: string | null;
	verified_value: string | null;
	severity: 'major' | 'minor';
	status: string;
	candidate_response: string | null;
	created_at: string;
	verification_type: string;
	verification_request_id?: number;
};

type ReferenceCheck = {
	id: number;
	reference_name: string;
	reference_email: string | null;
	reference_phone: string | null;
	relationship: string | null;
	status: string;
	created_at: string;
};

type CandidateBgData = {
	employment: EmploymentEntry[];
	education: EducationEntry[];
	verifications: VerificationRequest[];
	discrepancies: Discrepancy[];
	references: ReferenceCheck[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────

const _verificationStatusConfig: Record<
	string,
	{ icon: React.ReactNode; color: string; label: string }
> = {
	pending: {
		icon: <Clock className="h-3.5 w-3.5" />,
		color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
		label: 'Pending',
	},
	sent: {
		icon: <Clock className="h-3.5 w-3.5" />,
		color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
		label: 'Sent',
	},
	responded: {
		icon: <CheckCircle className="h-3.5 w-3.5" />,
		color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
		label: 'Responded',
	},
	verified: {
		icon: <CheckCircle className="h-3.5 w-3.5" />,
		color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
		label: 'Verified',
	},
	rejected: {
		icon: <XCircle className="h-3.5 w-3.5" />,
		color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
		label: 'Rejected',
	},
	manual_review: {
		icon: <AlertCircle className="h-3.5 w-3.5" />,
		color: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400',
		label: 'Manual Review',
	},
};

function formatDate(dateStr: string | null): string {
	if (!dateStr) return '—';
	return new Date(dateStr).toLocaleDateString();
}

// ─── Component ────────────────────────────────────────────────────────────

export function RecruiterBackgroundCheckPage() {
	const [searchQuery, setSearchQuery] = useState('');
	const [searchResults, setSearchResults] = useState<CandidateResult[]>([]);
	const [searching, setSearching] = useState(false);
	const [selectedCandidate, setSelectedCandidate] = useState<CandidateResult | null>(null);
	const [data, setData] = useState<CandidateBgData | null>(null);
	const [loading, setLoading] = useState(false);
	const [activeTab, setActiveTab] = useState('overview');
	const [markingReviewed, setMarkingReviewed] = useState(false);

	useEffect(() => {
		const timer = setTimeout(() => {
			if (searchQuery.trim().length >= 2) {
				performSearch(searchQuery);
			} else {
				setSearchResults([]);
			}
		}, 300);
		return () => clearTimeout(timer);
	}, [searchQuery, performSearch]);

	async function performSearch(q: string) {
		setSearching(true);
		try {
			const res = await apiCall<{ candidates: Array<any> }>(
				`/candidates/search?q=${encodeURIComponent(q)}&limit=10`,
			);
			setSearchResults(
				(res.candidates || []).map((c) => ({
					id: String(c.id),
					name: c.name || 'Unknown',
					email: c.email,
					avatar: c.avatar,
					headline: c.headline,
				})),
			);
		} catch (err) {
			console.error('Search failed:', err);
		} finally {
			setSearching(false);
		}
	}

	async function loadCandidateData(candidateId: string) {
		setLoading(true);
		setActiveTab('overview');
		try {
			const [empRes, eduRes, discRes, refRes] = await Promise.all([
				apiCall<{ success: boolean; employment: EmploymentEntry[] }>(
					`/candidates/${candidateId}/employment`,
				),
				apiCall<{ success: boolean; education: EducationEntry[] }>(
					`/candidates/${candidateId}/education`,
				),
				apiCall<{ success: boolean; discrepancies: Discrepancy[] }>(
					`/candidates/${candidateId}/discrepancies`,
				),
				apiCall<{ success: boolean; reference_checks: ReferenceCheck[] }>(
					`/reference-checks?candidate_id=${candidateId}`,
				),
			]);

			// Fetch verification details from discrepancy IDs if any
			const verifications: VerificationRequest[] = [];
			const vIds = new Set(discRes.discrepancies?.map((d) => d.verification_request_id) || []);
			for (const vid of vIds) {
				try {
					const v = await apiCall<{ success: boolean; verification_request: VerificationRequest }>(
						`/verification-requests/${vid}`,
					);
					if (v.verification_request) verifications.push(v.verification_request);
				} catch {
					// ignore
				}
			}

			setData({
				employment: empRes.employment || [],
				education: eduRes.education || [],
				verifications,
				discrepancies: discRes.discrepancies || [],
				references: refRes.reference_checks || [],
			});
		} catch (err) {
			console.error('Failed to load candidate data:', err);
		} finally {
			setLoading(false);
		}
	}

	async function selectCandidate(candidate: CandidateResult) {
		setSelectedCandidate(candidate);
		setSearchResults([]);
		setSearchQuery('');
		await loadCandidateData(candidate.id);
		trackEvent('recruiter_bg_check_candidate_selected', { candidate_id: candidate.id });
	}

	async function markAsReviewed() {
		if (!selectedCandidate) return;
		setMarkingReviewed(true);
		try {
			// # ponytail: no dedicated "mark reviewed" API; using manual-review as proxy
			for (const v of data?.verifications || []) {
				try {
					await apiCall(`/verification-requests/${v.id}/manual-review`, {
						method: 'POST',
						body: { notes: 'Recruiter reviewed background check' },
					});
				} catch {
					// ignore individual failures
				}
			}
			trackEvent('recruiter_bg_check_marked_reviewed', { candidate_id: selectedCandidate.id });
		} catch (err) {
			console.error('Failed to mark reviewed:', err);
		} finally {
			setMarkingReviewed(false);
		}
	}

	async function requestAdditionalVerification(type: 'employment' | 'education', targetId: number) {
		if (!selectedCandidate) return;
		try {
			await apiCall('/verification-requests', {
				method: 'POST',
				body: { candidate_id: parseInt(selectedCandidate.id, 10), type, target_id: targetId },
			});
			trackEvent('recruiter_bg_check_verification_requested', {
				candidate_id: selectedCandidate.id,
				type,
			});
			await loadCandidateData(selectedCandidate.id);
		} catch (err) {
			console.error('Failed to request verification:', err);
		}
	}

	// Stats
	const stats = data
		? {
				totalEntries: data.employment.length + data.education.length,
				verified: data.verifications.filter((v) => v.status === 'verified').length,
				pending: data.verifications.filter((v) => ['pending', 'sent'].includes(v.status)).length,
				openDiscrepancies: data.discrepancies.filter((d) => d.status === 'open').length,
			}
		: null;

	return (
		<div className="space-y-6 px-4 sm:px-6">
			{/* Header */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-heading text-2xl font-bold">Background Check Review</h1>
					<p className="text-muted-foreground">
						Review candidate employment, education, and verification results
					</p>
				</div>
			</div>

			{/* Candidate Search */}
			{!selectedCandidate && (
				<div className="space-y-4">
					<div className="relative max-w-md">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search candidate by name..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="pl-9"
						/>
					</div>
					{searching ? (
						<Skeleton count={3} variant="avatar" />
					) : searchResults.length > 0 ? (
						<div className="grid gap-2 max-w-md">
							{searchResults.map((c) => (
								<Card
									key={c.id}
									className="cursor-pointer hover:border-indigo-300 transition-colors"
									onClick={() => selectCandidate(c)}
								>
									<CardContent className="p-3 flex items-center gap-3">
										<div className="h-10 w-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
											<User className="h-5 w-5" />
										</div>
										<div className="min-w-0">
											<p className="font-medium truncate">{c.name}</p>
											{c.headline && (
												<p className="text-xs text-muted-foreground truncate">{c.headline}</p>
											)}
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					) : searchQuery.trim().length >= 2 ? (
						<EmptyState
							icon={Search}
							title="No candidates found"
							description="Try a different search term"
						/>
					) : (
						<EmptyState
							icon={Search}
							title="Search for a candidate"
							description="Type at least 2 characters to search"
						/>
					)}
				</div>
			)}

			{/* Selected Candidate View */}
			{selectedCandidate && (
				<div className="space-y-4">
					<div className="flex items-center gap-3">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								setSelectedCandidate(null);
								setData(null);
							}}
							className="gap-1 min-h-[44px]"
						>
							<ChevronLeft className="h-4 w-4" />
							Back
						</Button>
						<div className="h-10 w-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
							<User className="h-5 w-5" />
						</div>
						<div>
							<h2 className="font-semibold">{selectedCandidate.name}</h2>
							{selectedCandidate.email && (
								<p className="text-xs text-muted-foreground">{selectedCandidate.email}</p>
							)}
						</div>
						<div className="ml-auto flex gap-2">
							<Button
								size="sm"
								onClick={markAsReviewed}
								disabled={markingReviewed || !data}
								className="min-h-[44px]"
							>
								{markingReviewed ? 'Marking...' : 'Mark as Reviewed'}
							</Button>
						</div>
					</div>

					{/* Stats */}
					{stats && (
						<div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
							<Card>
								<CardContent className="p-4">
									<div className="flex items-center justify-between">
										<div>
											<p className="text-2xl font-bold">{stats.totalEntries}</p>
											<p className="text-xs text-muted-foreground">Total Entries</p>
										</div>
										<Briefcase className="h-8 w-8 text-muted-foreground/50" />
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardContent className="p-4">
									<div className="flex items-center justify-between">
										<div>
											<p className="text-2xl font-bold text-green-600">{stats.verified}</p>
											<p className="text-xs text-muted-foreground">Verified</p>
										</div>
										<CheckCircle className="h-8 w-8 text-green-500/50" />
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardContent className="p-4">
									<div className="flex items-center justify-between">
										<div>
											<p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
											<p className="text-xs text-muted-foreground">Pending</p>
										</div>
										<Clock className="h-8 w-8 text-amber-500/50" />
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardContent className="p-4">
									<div className="flex items-center justify-between">
										<div>
											<p className="text-2xl font-bold text-red-600">{stats.openDiscrepancies}</p>
											<p className="text-xs text-muted-foreground">Open Discrepancies</p>
										</div>
										<ShieldAlert className="h-8 w-8 text-red-500/50" />
									</div>
								</CardContent>
							</Card>
						</div>
					)}

					<Tabs value={activeTab} onValueChange={setActiveTab}>
						<TabsList className="flex-wrap h-auto">
							<TabsTrigger value="overview">Overview</TabsTrigger>
							<TabsTrigger value="employment">
								Employment
								{data && (
									<Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
										{data.employment.length}
									</Badge>
								)}
							</TabsTrigger>
							<TabsTrigger value="education">
								Education
								{data && (
									<Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
										{data.education.length}
									</Badge>
								)}
							</TabsTrigger>
							<TabsTrigger value="discrepancies">
								Discrepancies
								{data && data.discrepancies.length > 0 && (
									<Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">
										{data.discrepancies.length}
									</Badge>
								)}
							</TabsTrigger>
							<TabsTrigger value="references">
								References
								{data && (
									<Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
										{data.references.length}
									</Badge>
								)}
							</TabsTrigger>
						</TabsList>

						{/* Overview Tab */}
						<TabsContent value="overview" className="mt-4 space-y-4">
							{loading ? (
								<Skeleton count={3} variant="card" />
							) : !data ? (
								<EmptyState
									icon={Search}
									title="No data loaded"
									description="Select a candidate to view their background check"
								/>
							) : (
								<div className="grid gap-4">
									{/* Employment summary */}
									<Card>
										<CardContent className="p-4">
											<h3 className="font-semibold mb-2 flex items-center gap-2">
												<Building2 className="h-4 w-4 text-indigo-500" />
												Employment Summary
											</h3>
											{data.employment.length === 0 ? (
												<p className="text-sm text-muted-foreground">
													No employment history provided
												</p>
											) : (
												<div className="space-y-2">
													{data.employment.map((emp) => (
														<div key={emp.id} className="flex items-center justify-between text-sm">
															<span className="font-medium">{emp.company_name}</span>
															<span className="text-muted-foreground">
																{emp.job_title} • {formatDate(emp.start_date)} —{' '}
																{emp.is_current ? 'Present' : formatDate(emp.end_date)}
															</span>
														</div>
													))}
												</div>
											)}
										</CardContent>
									</Card>

									{/* Education summary */}
									<Card>
										<CardContent className="p-4">
											<h3 className="font-semibold mb-2 flex items-center gap-2">
												<GraduationCap className="h-4 w-4 text-indigo-500" />
												Education Summary
											</h3>
											{data.education.length === 0 ? (
												<p className="text-sm text-muted-foreground">
													No education history provided
												</p>
											) : (
												<div className="space-y-2">
													{data.education.map((edu) => (
														<div key={edu.id} className="flex items-center justify-between text-sm">
															<span className="font-medium">{edu.institution_name}</span>
															<span className="text-muted-foreground">
																{edu.degree || '—'} • {formatDate(edu.start_date)} —{' '}
																{edu.is_current ? 'Present' : formatDate(edu.end_date)}
															</span>
														</div>
													))}
												</div>
											)}
										</CardContent>
									</Card>

									{/* Discrepancies summary */}
									{data.discrepancies.length > 0 && (
										<Card>
											<CardContent className="p-4">
												<h3 className="font-semibold mb-2 flex items-center gap-2 text-red-600">
													<ShieldAlert className="h-4 w-4" />
													Discrepancies ({data.discrepancies.length})
												</h3>
												<div className="space-y-2">
													{data.discrepancies.map((d) => (
														<div key={d.id} className="text-sm">
															<span className="font-medium">{d.field_name}:</span> declared &quot;
															{d.declared_value || '—'}&quot; vs verified &quot;
															{d.verified_value || '—'}&quot;
															{d.candidate_response && (
																<span className="text-muted-foreground block mt-0.5">
																	Candidate response: {d.candidate_response}
																</span>
															)}
														</div>
													))}
												</div>
											</CardContent>
										</Card>
									)}
								</div>
							)}
						</TabsContent>

						{/* Employment Tab */}
						<TabsContent value="employment" className="mt-4 space-y-4">
							{loading ? (
								<Skeleton count={3} variant="card" />
							) : !data || data.employment.length === 0 ? (
								<EmptyState
									icon={Building2}
									title="No employment history"
									description="Candidate has not added any employment entries"
								/>
							) : (
								<div className="grid gap-4">
									{data.employment.map((emp) => (
										<Card key={emp.id}>
											<CardContent className="p-4">
												<div className="flex items-start gap-4">
													<div className="h-10 w-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
														<Building2 className="h-5 w-5" />
													</div>
													<div className="flex-1 min-w-0 space-y-1">
														<h3 className="font-semibold">{emp.company_name}</h3>
														<p className="text-sm text-muted-foreground">
															{emp.job_title} • {formatDate(emp.start_date)} —{' '}
															{emp.is_current ? 'Present' : formatDate(emp.end_date)}
														</p>
														{emp.reference_name && (
															<p className="text-xs text-muted-foreground">
																Reference: {emp.reference_name}{' '}
																{emp.reference_email && `• ${emp.reference_email}`}
															</p>
														)}
													</div>
													<Button
														size="sm"
														variant="outline"
														onClick={() => requestAdditionalVerification('employment', emp.id)}
														className="min-h-[44px]"
													>
														Request Verification
													</Button>
												</div>
											</CardContent>
										</Card>
									))}
								</div>
							)}
						</TabsContent>

						{/* Education Tab */}
						<TabsContent value="education" className="mt-4 space-y-4">
							{loading ? (
								<Skeleton count={3} variant="card" />
							) : !data || data.education.length === 0 ? (
								<EmptyState
									icon={GraduationCap}
									title="No education history"
									description="Candidate has not added any education entries"
								/>
							) : (
								<div className="grid gap-4">
									{data.education.map((edu) => (
										<Card key={edu.id}>
											<CardContent className="p-4">
												<div className="flex items-start gap-4">
													<div className="h-10 w-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
														<GraduationCap className="h-5 w-5" />
													</div>
													<div className="flex-1 min-w-0 space-y-1">
														<h3 className="font-semibold">{edu.institution_name}</h3>
														<p className="text-sm text-muted-foreground">
															{edu.degree || '—'} • {edu.field_of_study || '—'} •{' '}
															{formatDate(edu.start_date)} —{' '}
															{edu.is_current ? 'Present' : formatDate(edu.end_date)}
														</p>
													</div>
													<Button
														size="sm"
														variant="outline"
														onClick={() => requestAdditionalVerification('education', edu.id)}
														className="min-h-[44px]"
													>
														Request Verification
													</Button>
												</div>
											</CardContent>
										</Card>
									))}
								</div>
							)}
						</TabsContent>

						{/* Discrepancies Tab */}
						<TabsContent value="discrepancies" className="mt-4 space-y-4">
							{loading ? (
								<Skeleton count={3} variant="card" />
							) : !data || data.discrepancies.length === 0 ? (
								<EmptyState
									icon={CheckCircle}
									title="No discrepancies"
									description="No discrepancies found for this candidate"
								/>
							) : (
								<div className="grid gap-4">
									{data.discrepancies.map((d) => (
										<Card key={d.id}>
											<CardContent className="p-4">
												<div className="flex items-start gap-4">
													<div className="h-10 w-10 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0">
														<ShieldAlert className="h-5 w-5" />
													</div>
													<div className="flex-1 min-w-0 space-y-2">
														<div className="flex items-center gap-2 flex-wrap">
															<h3 className="font-semibold">{d.field_name}</h3>
															<Badge variant="outline" className="text-xs">
																{d.severity}
															</Badge>
															<Badge
																className={`text-xs ${
																	d.status === 'resolved'
																		? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
																		: d.status === 'candidate_responded'
																			? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
																			: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
																}`}
															>
																{d.status.replace('_', ' ')}
															</Badge>
														</div>
														<div className="text-sm">
															<p>
																<span className="text-muted-foreground">Declared:</span>{' '}
																<span className="font-medium">{d.declared_value || '—'}</span>
															</p>
															<p>
																<span className="text-muted-foreground">Verified:</span>{' '}
																<span className="font-medium">{d.verified_value || '—'}</span>
															</p>
														</div>
														{d.candidate_response && (
															<div className="p-2 rounded bg-muted/50 text-sm">
																<span className="text-muted-foreground">Candidate response:</span>{' '}
																{d.candidate_response}
															</div>
														)}
													</div>
												</div>
											</CardContent>
										</Card>
									))}
								</div>
							)}
						</TabsContent>

						{/* References Tab */}
						<TabsContent value="references" className="mt-4 space-y-4">
							{loading ? (
								<Skeleton count={3} variant="card" />
							) : !data || data.references.length === 0 ? (
								<EmptyState
									icon={User}
									title="No reference checks"
									description="No reference checks have been initiated for this candidate"
								/>
							) : (
								<div className="grid gap-4">
									{data.references.map((ref) => (
										<Card key={ref.id}>
											<CardContent className="p-4">
												<div className="flex items-start gap-4">
													<div className="h-10 w-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
														<User className="h-5 w-5" />
													</div>
													<div className="flex-1 min-w-0 space-y-1">
														<div className="flex items-center gap-2 flex-wrap">
															<h3 className="font-semibold">{ref.reference_name}</h3>
															<Badge className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
																{ref.status}
															</Badge>
														</div>
														{ref.relationship && (
															<p className="text-xs text-muted-foreground">
																Relationship: {ref.relationship}
															</p>
														)}
														{ref.reference_email && (
															<p className="text-xs text-muted-foreground">{ref.reference_email}</p>
														)}
													</div>
												</div>
											</CardContent>
										</Card>
									))}
								</div>
							)}
						</TabsContent>
					</Tabs>
				</div>
			)}
		</div>
	);
}
