import {
	AlertTriangle,
	ArrowLeft,
	Building2,
	CheckCircle,
	Loader2,
	MessageSquare,
	Plus,
	Search,
	Shield,
	Star,
	X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { apiCall } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────

interface CompareCompany {
	id: number;
	name: string;
	slug: string;
	logo_url: string | null;
	industry: string;
	is_verified: boolean;
	badges: Array<{ type: string; label: string }>;
}

interface ComparisonFactor {
	key: string;
	label: string;
	max: number;
	values: Array<{
		company_id: number;
		company_name: string;
		value: number;
		percentage: number;
		winner: boolean;
	}>;
}

interface ComparisonResponse {
	success: boolean;
	companies: CompareCompany[];
	comparison: ComparisonFactor[];
	overall_winner: number | null;
}

interface LeaderboardCompany {
	company_id: number;
	company_name: string;
	slug: string;
	logo_url: string | null;
	industry: string;
	is_verified: boolean;
	total_score: number;
}

// ─── Helpers ────────────────────────────────────────────────

const _tierColors: Record<string, string> = {
	exceptional: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
	excellent: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
	trusted: 'bg-green-500/10 text-green-600 border-green-500/30',
	good: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
	building: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
	new: 'bg-slate-500/10 text-slate-500 border-slate-500/30',
};

const factorLabels: Record<string, string> = {
	total_score: 'Overall TrustScore',
	verification_score: 'Verification',
	job_authenticity_score: 'Job Authenticity',
	hiring_ratio_score: 'Hiring Ratio',
	feedback_score: 'Candidate Feedback',
	behavior_score: 'Platform Behavior',
	employee_satisfaction_score: 'Employee Satisfaction',
	interview_experience_score: 'Interview Experience',
	offer_acceptance_rate_score: 'Offer Acceptance',
	time_to_hire_score: 'Time to Hire',
	response_rate_score: 'Response Rate',
	salary_competitiveness_score: 'Salary Competitiveness',
	career_growth_score: 'Career Growth',
};

// ─── Component ──────────────────────────────────────────────

export function CompanyComparePage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const idsParam = searchParams.get('ids') || '';
	const selectedIds = idsParam
		.split(',')
		.map((id) => parseInt(id.trim(), 10))
		.filter((id) => !Number.isNaN(id) && id > 0);

	const [comparison, setComparison] = useState<ComparisonResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Add company search
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const [searchResults, setSearchResults] = useState<LeaderboardCompany[]>([]);
	const [searchLoading, setSearchLoading] = useState(false);

	const loadComparison = useCallback(async () => {
		if (selectedIds.length < 2) {
			setComparison(null);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const data = await apiCall<ComparisonResponse>(
				`/trustscore/compare?company_ids=${selectedIds.join(',')}`,
			);
			setComparison(data);
		} catch (err: any) {
			setError(err.message || 'Failed to load comparison');
		} finally {
			setLoading(false);
		}
	}, [selectedIds]);

	useEffect(() => {
		loadComparison();
	}, [loadComparison]);

	const searchCompanies = useCallback(async (query: string) => {
		if (!query.trim() || query.trim().length < 2) {
			setSearchResults([]);
			return;
		}
		setSearchLoading(true);
		try {
			const data = await apiCall<{
				success: boolean;
				companies: LeaderboardCompany[];
			}>(`/trustscore/leaderboard?limit=20&min_score=0`);
			const filtered = (data.companies || []).filter((c) =>
				c.company_name.toLowerCase().includes(query.trim().toLowerCase()),
			);
			setSearchResults(filtered);
		} catch {
			setSearchResults([]);
		} finally {
			setSearchLoading(false);
		}
	}, []);

	useEffect(() => {
		const timer = setTimeout(() => {
			searchCompanies(searchQuery);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchQuery, searchCompanies]);

	function addCompany(id: number) {
		if (selectedIds.includes(id)) return;
		if (selectedIds.length >= 3) {
			setError('You can compare up to 3 companies at a time');
			setTimeout(() => setError(null), 3000);
			return;
		}
		const newIds = [...selectedIds, id];
		setSearchParams({ ids: newIds.join(',') });
		setSearchOpen(false);
		setSearchQuery('');
		setSearchResults([]);
	}

	function removeCompany(id: number) {
		const newIds = selectedIds.filter((i) => i !== id);
		if (newIds.length < 2) {
			setSearchParams({});
		} else {
			setSearchParams({ ids: newIds.join(',') });
		}
	}

	// If no companies selected, show empty state
	if (selectedIds.length < 2) {
		return (
			<div className="max-w-3xl mx-auto space-y-6">
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="sm" asChild>
						<Link to="/candidate/jobs">
							<ArrowLeft className="h-4 w-4 mr-1" /> Back
						</Link>
					</Button>
				</div>
				<div className="text-center space-y-4 py-12">
					<Shield className="h-12 w-12 mx-auto text-muted-foreground/30" />
					<h1 className="text-2xl font-bold">Compare Companies</h1>
					<p className="text-muted-foreground max-w-md mx-auto">
						Select companies to compare their TrustScore factors side-by-side. See response rates,
						interview experience, and more before you apply.
					</p>
				</div>

				{/* Search to add */}
				<Card>
					<CardContent className="p-6 space-y-4">
						<h2 className="font-semibold flex items-center gap-2">
							<Search className="h-4 w-4" /> Search companies to compare
						</h2>
						<div className="relative">
							<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder="Type a company name..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-9"
							/>
						</div>
						{searchLoading && (
							<div className="flex justify-center py-4">
								<Loader2 className="h-5 w-5 animate-spin text-primary" />
							</div>
						)}
						<div className="space-y-2 max-h-64 overflow-y-auto">
							{searchResults.map((c) => (
								<button type="button"
									key={c.company_id}
									onClick={() => addCompany(c.company_id)}
									className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
								>
									<div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
										{c.logo_url ? (
											<img src={c.logo_url} alt="" className="h-full w-full object-cover" />
										) : (
											<Building2 className="h-4 w-4 text-muted-foreground" />
										)}
									</div>
									<div className="flex-1 min-w-0">
										<p className="font-medium text-sm truncate">{c.company_name}</p>
										<p className="text-xs text-muted-foreground">
											{c.industry} · TrustScore {c.total_score}
										</p>
									</div>
									<Plus className="h-4 w-4 text-muted-foreground shrink-0" />
								</button>
							))}
							{searchQuery.trim().length >= 2 && !searchLoading && searchResults.length === 0 && (
								<p className="text-sm text-muted-foreground text-center py-4">No companies found</p>
							)}
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="max-w-6xl mx-auto space-y-6">
			{/* Header */}
			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div>
					<div className="flex items-center gap-2 mb-1">
						<Button variant="ghost" size="sm" asChild>
							<Link to="/candidate/jobs">
								<ArrowLeft className="h-4 w-4 mr-1" /> Back
							</Link>
						</Button>
					</div>
					<h1 className="text-2xl font-bold flex items-center gap-2">
						<Shield className="h-6 w-6 text-primary" />
						Company Comparison
					</h1>
					<p className="text-muted-foreground text-sm">
						Compare TrustScore factors across companies before you apply.
					</p>
				</div>
				{selectedIds.length < 3 && (
					<Button variant="outline" onClick={() => setSearchOpen(!searchOpen)} className="shrink-0">
						<Plus className="h-4 w-4 mr-1" />
						Add Company
					</Button>
				)}
			</div>

			{/* Error */}
			{error && (
				<div className="rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3">
					<AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
					<div className="flex-1">
						<p className="text-sm font-medium text-red-800">{error}</p>
					</div>
					<button type="button" onClick={() => setError(null)} className="shrink-0">
						<X className="h-4 w-4 text-red-600" />
					</button>
				</div>
			)}

			{/* Add company search */}
			{searchOpen && selectedIds.length < 3 && (
				<Card>
					<CardContent className="p-4 space-y-3">
						<div className="relative">
							<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder="Search company to add..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-9"
								autoFocus
							/>
						</div>
						{searchLoading && (
							<div className="flex justify-center py-2">
								<Loader2 className="h-4 w-4 animate-spin text-primary" />
							</div>
						)}
						<div className="space-y-1 max-h-48 overflow-y-auto">
							{searchResults
								.filter((c) => !selectedIds.includes(c.company_id))
								.map((c) => (
									<button type="button"
										key={c.company_id}
										onClick={() => addCompany(c.company_id)}
										className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
									>
										<div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
											{c.logo_url ? (
												<img src={c.logo_url} alt="" className="h-full w-full object-cover" />
											) : (
												<Building2 className="h-3.5 w-3.5 text-muted-foreground" />
											)}
										</div>
										<div className="flex-1 min-w-0">
											<p className="font-medium text-sm truncate">{c.company_name}</p>
										</div>
										<Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
									</button>
								))}
							{searchQuery.trim().length >= 2 &&
								!searchLoading &&
								searchResults.filter((c) => !selectedIds.includes(c.company_id)).length === 0 && (
									<p className="text-sm text-muted-foreground text-center py-2">
										No companies found
									</p>
								)}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Loading */}
			{loading && (
				<div className="flex items-center justify-center py-16">
					<Loader2 className="h-8 w-8 animate-spin text-primary" />
				</div>
			)}

			{/* Comparison Table */}
			{comparison && !loading && (
				<div className="space-y-6">
					{/* Company Headers */}
					<div
						className="grid gap-4"
						style={{
							gridTemplateColumns: `repeat(${comparison.companies.length}, minmax(0, 1fr))`,
						}}
					>
						{comparison.companies.map((company) => (
							<Card key={company.id} className="overflow-hidden">
								<CardContent className="p-4 text-center relative">
									<button type="button"
										onClick={() => removeCompany(company.id)}
										className="absolute top-2 right-2 p-1 rounded hover:bg-muted text-muted-foreground"
										aria-label="Remove company"
									>
										<X className="h-3.5 w-3.5" />
									</button>
									<div className="h-14 w-14 rounded-xl bg-muted border flex items-center justify-center mx-auto mb-3 overflow-hidden">
										{company.logo_url ? (
											<img
												src={company.logo_url}
												alt={company.name}
												className="h-full w-full object-cover"
											/>
										) : (
											<Building2 className="h-6 w-6 text-muted-foreground/60" />
										)}
									</div>
									<h3 className="font-semibold text-sm truncate">{company.name}</h3>
									<div className="flex items-center justify-center gap-1 mt-1 flex-wrap">
										{company.is_verified && (
											<Badge
												variant="outline"
												className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] gap-0.5"
											>
												<CheckCircle className="h-3 w-3" /> Verified
											</Badge>
										)}
									</div>
									{company.badges.length > 0 && (
										<div className="flex flex-wrap justify-center gap-1 mt-2">
											{company.badges.map((b) => (
												<Badge key={b.type} variant="secondary" className="text-[10px] h-5">
													{b.label}
												</Badge>
											))}
										</div>
									)}
									<Link
										to={`/company/${company.slug}`}
										className="text-xs text-primary hover:underline mt-2 inline-block"
									>
										View profile
									</Link>
								</CardContent>
							</Card>
						))}
					</div>

					{/* Factors */}
					<div className="space-y-3">
						{comparison.comparison.map((factor) => {
							const isResponseRate = factor.key === 'response_rate_score';
							return (
								<Card
									key={factor.key}
									className={isResponseRate ? 'border-amber-300 bg-amber-50/30' : ''}
								>
									<CardContent className="p-4">
										<div className="flex items-center gap-2 mb-3">
											{isResponseRate && <MessageSquare className="h-4 w-4 text-amber-600" />}
											<h4
												className={`font-semibold text-sm ${isResponseRate ? 'text-amber-800' : ''}`}
											>
												{factorLabels[factor.key] || factor.label}
												{isResponseRate && (
													<span className="ml-2 text-[10px] font-normal text-amber-600">
														(ghosting metric)
													</span>
												)}
											</h4>
										</div>
										<div
											className="grid gap-4"
											style={{
												gridTemplateColumns: `repeat(${factor.values.length}, minmax(0, 1fr))`,
											}}
										>
											{factor.values.map((v) => (
												<div key={v.company_id} className="space-y-1">
													<div className="flex items-center justify-between">
														<span
															className={`text-lg font-bold ${
																v.winner ? 'text-emerald-600' : 'text-muted-foreground'
															}`}
														>
															{v.value}
															{v.winner && (
																<Star className="h-3.5 w-3.5 inline ml-1 text-emerald-500" />
															)}
														</span>
														<span className="text-xs text-muted-foreground">/ {factor.max}</span>
													</div>
													<Progress value={v.percentage} className="h-2" />
													<p className="text-xs text-muted-foreground">{v.percentage}%</p>
												</div>
											))}
										</div>
									</CardContent>
								</Card>
							);
						})}
					</div>

					{/* Overall winner */}
					{comparison.overall_winner && (
						<Card className="bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200">
							<CardContent className="p-4 flex items-center gap-3">
								<Star className="h-5 w-5 text-emerald-600" />
								<p className="text-sm font-medium text-emerald-800">
									Top pick:{' '}
									<strong>
										{comparison.companies.find((c) => c.id === comparison.overall_winner)?.name ||
											'Best match'}
									</strong>{' '}
									based on overall TrustScore
								</p>
							</CardContent>
						</Card>
					)}
				</div>
			)}
		</div>
	);
}
