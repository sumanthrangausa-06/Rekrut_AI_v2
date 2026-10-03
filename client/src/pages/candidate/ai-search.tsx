import {
	Bookmark,
	BookmarkCheck,
	Brain,
	Building2,
	ChevronDown,
	Clock,
	DollarSign,
	Loader2,
	MapPin,
	Search,
	SlidersHorizontal,
	Sparkles,
	X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SEO } from '@/components/SEO';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiCall } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────

interface JobResult {
	id: number;
	title: string;
	company: string;
	company_logo?: string;
	location: string;
	remote_type?: string;
	job_type: string;
	salary_range?: string;
	salary_min?: number;
	salary_max?: number;
	description: string;
	skills_required?: string[];
	created_at: string;
	match_score?: number;
	match_explanation?: string;
	has_saved?: boolean;
}

interface FilterState {
	location: string;
	jobType: string;
	remote: string;
	salaryMin: number;
	experience: string;
}

const EXPERIENCE_LEVELS = ['', 'entry', 'mid', 'senior', 'lead', 'executive'];

// ─── Helpers ─────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
	const diff = Date.now() - new Date(dateStr).getTime();
	const days = Math.floor(diff / 86400000);
	if (days === 0) return 'Today';
	if (days === 1) return 'Yesterday';
	if (days < 7) return `${days} days ago`;
	if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
	return `${Math.floor(days / 30)} months ago`;
}

function getMatchColor(score: number): string {
	if (score >= 85) return 'bg-green-500 text-white';
	if (score >= 70) return 'bg-indigo-500 text-white';
	if (score >= 50) return 'bg-amber-500 text-white';
	return 'bg-slate-400 text-white';
}

function getMatchLabel(score: number): string {
	if (score >= 85) return 'Excellent Match';
	if (score >= 70) return 'Great Match';
	if (score >= 50) return 'Good Match';
	return 'Fair Match';
}

// ─── Components ──────────────────────────────────────────────────────────

function MatchScoreBadge({ score }: { score: number }) {
	return (
		<div
			className={cn(
				'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
				getMatchColor(score),
			)}
		>
			<Sparkles className="h-3 w-3" />
			{Math.round(score)}% Match
		</div>
	);
}

function SearchResultCard({
	job,
	onToggleSave,
	saving,
	onClick,
}: {
	job: JobResult;
	onToggleSave: (jobId: number, current: boolean) => void;
	saving: boolean;
	onClick: () => void;
}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<Card
			className="overflow-hidden transition-all hover:shadow-md hover:border-primary/20 cursor-pointer"
			onClick={onClick}
		>
			<CardContent className="p-4 sm:p-5">
				<div className="flex items-start gap-4">
					{/* Company logo */}
					<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
						{job.company_logo ? (
							<img src={job.company_logo} alt={job.company} className="h-8 w-8 object-contain" />
						) : (
							<Building2 className="h-6 w-6 text-muted-foreground" />
						)}
					</div>

					<div className="flex-1 min-w-0">
						{/* Title row */}
						<div className="flex items-start justify-between gap-2">
							<div className="min-w-0">
								<h3 className="font-semibold text-base truncate">{job.title}</h3>
								<p className="text-sm text-muted-foreground">{job.company}</p>
							</div>
							<div className="flex items-center gap-2 shrink-0">
								{job.match_score !== undefined && <MatchScoreBadge score={job.match_score} />}
								<Button
									variant="ghost"
									size="sm"
									className={cn(
										'h-8 w-8 p-0',
										job.has_saved
											? 'text-indigo-600'
											: 'text-muted-foreground hover:text-indigo-600',
									)}
									onClick={(e) => {
										e.stopPropagation();
										onToggleSave(job.id, !!job.has_saved);
									}}
									disabled={saving}
								>
									{job.has_saved ? (
										<BookmarkCheck className="h-4 w-4" />
									) : (
										<Bookmark className="h-4 w-4" />
									)}
								</Button>
							</div>
						</div>

						{/* Meta */}
						<div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
							{job.location && (
								<span className="flex items-center gap-1">
									<MapPin className="h-3 w-3" />
									{job.location}
								</span>
							)}
							{job.salary_range && (
								<span className="flex items-center gap-1">
									<DollarSign className="h-3 w-3" />
									{job.salary_range}
								</span>
							)}
							{job.job_type && (
								<Badge variant="outline" className="text-[10px] font-normal">
									{job.job_type}
								</Badge>
							)}
							{job.remote_type && (
								<Badge variant="outline" className="text-[10px] font-normal">
									{job.remote_type}
								</Badge>
							)}
							<span className="flex items-center gap-1">
								<Clock className="h-3 w-3" />
								{timeAgo(job.created_at)}
							</span>
						</div>

						{/* Match explanation */}
						{job.match_explanation && (
							<div className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1.5 rounded-md inline-flex items-center gap-1.5">
								<Brain className="h-3 w-3" />
								{job.match_explanation}
							</div>
						)}

						{/* Description preview */}
						<p className="text-sm text-muted-foreground mt-2 line-clamp-2">
							{job.description?.slice(0, 160)}...
						</p>

						{/* Skills tags */}
						{job.skills_required && job.skills_required.length > 0 && (
							<div className="flex flex-wrap gap-1 mt-3">
								{job.skills_required.slice(0, 5).map((skill) => (
									<Badge key={skill} variant="secondary" className="text-[10px]">
										{skill}
									</Badge>
								))}
								{job.skills_required.length > 5 && (
									<Badge variant="secondary" className="text-[10px]">
										+{job.skills_required.length - 5}
									</Badge>
								)}
							</div>
						)}

						{/* Expandable match details */}
						{job.match_score !== undefined && (
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									setExpanded(!expanded);
								}}
								className="mt-3 text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
							>
								{expanded ? 'Hide details' : 'Why this matches you'}
								<ChevronDown
									className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')}
								/>
							</button>
						)}

						{expanded && job.match_score !== undefined && (
							<div className="mt-2 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg text-xs space-y-1.5">
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Overall Match</span>
									<span className="font-semibold">{Math.round(job.match_score)}%</span>
								</div>
								<div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
									<div
										className={cn(
											'h-full rounded-full',
											getMatchColor(job.match_score).split(' ')[0],
										)}
										style={{ width: `${job.match_score}%` }}
									/>
								</div>
								<p className="text-muted-foreground">{getMatchLabel(job.match_score)}</p>
							</div>
						)}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

function EmptySearch({ hasQuery, onClear }: { hasQuery: boolean; onClear: () => void }) {
	return (
		<div className="flex flex-col items-center justify-center py-20 text-center">
			<div className="p-4 rounded-full bg-indigo-50 dark:bg-indigo-900/20 mb-4">
				<Search className="h-10 w-10 text-indigo-400" />
			</div>
			<h3 className="text-lg font-semibold">
				{hasQuery ? 'No jobs found' : 'Search for your next role'}
			</h3>
			<p className="text-sm text-muted-foreground mt-1 max-w-sm">
				{hasQuery
					? 'Try adjusting your search or filters to find more opportunities'
					: 'Enter a job title, skill, or company to find AI-matched opportunities'}
			</p>
			{hasQuery && (
				<Button variant="outline" onClick={onClear} className="mt-4">
					Clear Search
				</Button>
			)}
		</div>
	);
}

// ─── Main Page ───────────────────────────────────────────────────────────

export function AISearchPage() {
	const navigate = useNavigate();
	const searchInputRef = useRef<HTMLInputElement>(null);

	const [query, setQuery] = useState('');
	const [results, setResults] = useState<JobResult[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(false);
	const [savingJobId, setSavingJobId] = useState<number | null>(null);
	const [showFilters, setShowFilters] = useState(false);

	const [filters, setFilters] = useState<FilterState>({
		location: '',
		jobType: '',
		remote: '',
		salaryMin: 0,
		experience: '',
	});

	const loadRecommendations = useCallback(async () => {
		setLoading(true);
		setError(false);
		try {
			const data = await apiCall<{ recommendations: JobResult[] }>(
				'/matching/recommendations?limit=20&min_score=50',
			);
			setResults(data.recommendations || []);
		} catch (err) {
			console.error('[ai-search] Failed to load recommendations:', err);
			setError(true);
		} finally {
			setLoading(false);
		}
	}, []);

	// Load AI recommendations on mount
	useEffect(() => {
		loadRecommendations();
	}, [loadRecommendations]);

	const handleSearch = useCallback(async () => {
		if (!query.trim()) {
			loadRecommendations();
			return;
		}

		setLoading(true);
		setError(false);
		try {
			// Build search params
			const params = new URLSearchParams();
			params.set('q', query.trim());
			params.set('limit', '30');
			if (filters.location) params.set('location', filters.location);
			if (filters.jobType) params.set('job_type', filters.jobType);
			if (filters.remote) params.set('remote_type', filters.remote);
			if (filters.experience) params.set('experience', filters.experience);

			const data = await apiCall<{ jobs: JobResult[]; data?: JobResult[] }>(
				`/jobs?${params.toString()}`,
			);
			const jobs = data.jobs || data.data || [];

			// Try to enrich with match scores if possible
			try {
				const matchData = await apiCall<{ recommendations: JobResult[] }>(
					'/matching/recommendations?limit=30&min_score=30',
				);
				const matchMap = new Map(
					matchData.recommendations?.map((r) => [r.id, r.match_score]) || [],
				);
				jobs.forEach((j) => {
					if (matchMap.has(j.id)) {
						j.match_score = matchMap.get(j.id);
					}
				});
			} catch {
				// matching not available, show without scores
			}

			setResults(jobs);
		} catch (err) {
			console.error('[ai-search] Search failed:', err);
			setError(true);
		} finally {
			setLoading(false);
		}
	}, [query, filters, loadRecommendations]);

	const handleToggleSave = useCallback(async (jobId: number, currentlySaved: boolean) => {
		setSavingJobId(jobId);
		try {
			if (currentlySaved) {
				await apiCall(`/candidate/saved-jobs/${jobId}`, { method: 'DELETE' });
			} else {
				await apiCall('/candidate/saved-jobs', { method: 'POST', body: { job_id: jobId } });
			}
			setResults((prev) =>
				prev.map((j) => (j.id === jobId ? { ...j, has_saved: !currentlySaved } : j)),
			);
		} catch (err) {
			console.error('[ai-search] Save toggle failed:', err);
		} finally {
			setSavingJobId(null);
		}
	}, []);

	const activeFilterCount = Object.values(filters).filter((v) => v !== '' && v !== 0).length;

	return (
		<div className="min-h-[calc(100dvh-4rem)] space-y-6 px-4 sm:px-6 py-6">
			<SEO
				title="AI Job Search — Find Your Perfect Match"
				description="Search jobs with AI-powered matching. Find roles that fit your skills and experience."
				canonical="/candidate/ai-search"
			/>

			{/* ─── Header + Search Bar ───────────────────────────────────────── */}
			<div className="max-w-3xl mx-auto space-y-4">
				<div className="text-center space-y-2">
					<h1 className="text-2xl sm:text-3xl font-bold flex items-center justify-center gap-2">
						<Brain className="h-7 w-7 text-indigo-600" />
						AI Job Search
					</h1>
					<p className="text-sm text-muted-foreground">
						Smart matching finds roles that actually fit your skills
					</p>
				</div>

				{/* Search input */}
				<div className="flex gap-2">
					<div className="relative flex-1">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							ref={searchInputRef}
							placeholder="Search by title, skill, or company..."
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
							className="pl-9 h-11"
						/>
						{query && (
							<button
								type="button"
								onClick={() => {
									setQuery('');
									loadRecommendations();
								}}
								className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
							>
								<X className="h-4 w-4" />
							</button>
						)}
					</div>
					<Button onClick={handleSearch} disabled={loading} className="h-11 gap-2">
						{loading ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Search className="h-4 w-4" />
						)}
						Search
					</Button>
					<Button
						variant={showFilters ? 'default' : 'outline'}
						onClick={() => setShowFilters(!showFilters)}
						className="h-11 gap-2 relative"
					>
						<SlidersHorizontal className="h-4 w-4" />
						Filters
						{activeFilterCount > 0 && (
							<span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center">
								{activeFilterCount}
							</span>
						)}
					</Button>
				</div>

				{/* Filters panel */}
				{showFilters && (
					<Card className="p-4">
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
							<div className="space-y-1.5">
								<label
									htmlFor="filter-location"
									className="text-xs font-medium text-muted-foreground"
								>
									Location
								</label>
								<Input
									id="filter-location"
									placeholder="City or remote"
									value={filters.location}
									onChange={(e) => setFilters((f) => ({ ...f, location: e.target.value }))}
								/>
							</div>
							<div className="space-y-1.5">
								<label
									htmlFor="filter-jobtype"
									className="text-xs font-medium text-muted-foreground"
								>
									Job Type
								</label>
								<select
									id="filter-jobtype"
									value={filters.jobType}
									onChange={(e) => setFilters((f) => ({ ...f, jobType: e.target.value }))}
									className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
								>
									<option value="">Any</option>
									<option value="full-time">Full-time</option>
									<option value="part-time">Part-time</option>
									<option value="contract">Contract</option>
									<option value="internship">Internship</option>
								</select>
							</div>
							<div className="space-y-1.5">
								<label
									htmlFor="filter-remote"
									className="text-xs font-medium text-muted-foreground"
								>
									Work Mode
								</label>
								<select
									id="filter-remote"
									value={filters.remote}
									onChange={(e) => setFilters((f) => ({ ...f, remote: e.target.value }))}
									className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
								>
									<option value="">Any</option>
									<option value="remote">Remote</option>
									<option value="hybrid">Hybrid</option>
									<option value="onsite">On-site</option>
									<option value="flexible">Flexible</option>
								</select>
							</div>
							<div className="space-y-1.5">
								<label htmlFor="filter-exp" className="text-xs font-medium text-muted-foreground">
									Experience
								</label>
								<select
									id="filter-exp"
									value={filters.experience}
									onChange={(e) => setFilters((f) => ({ ...f, experience: e.target.value }))}
									className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
								>
									{EXPERIENCE_LEVELS.map((level) => (
										<option key={level} value={level}>
											{level ? level.charAt(0).toUpperCase() + level.slice(1) : 'Any'}
										</option>
									))}
								</select>
							</div>
						</div>
						<div className="flex justify-end gap-2 mt-3">
							<Button
								variant="ghost"
								size="sm"
								onClick={() =>
									setFilters({
										location: '',
										jobType: '',
										remote: '',
										salaryMin: 0,
										experience: '',
									})
								}
							>
								Reset
							</Button>
							<Button size="sm" onClick={handleSearch}>
								Apply Filters
							</Button>
						</div>
					</Card>
				)}
			</div>

			{/* ─── Results ───────────────────────────────────────────────────── */}
			<div className="max-w-3xl mx-auto space-y-4">
				{/* Results header */}
				{results.length > 0 && (
					<div className="flex items-center justify-between">
						<p className="text-sm text-muted-foreground">
							{results.length} {results.length === 1 ? 'job' : 'jobs'} found
							{!query && ' — AI-ranked for your profile'}
						</p>
						{!query && (
							<Badge variant="secondary" className="text-xs gap-1">
								<Sparkles className="h-3 w-3" />
								AI Ranked
							</Badge>
						)}
					</div>
				)}

				{loading ? (
					<div className="flex items-center justify-center py-20">
						<Loader2 className="h-8 w-8 animate-spin text-primary" />
					</div>
				) : error ? (
					<div className="text-center py-16">
						<p className="text-muted-foreground">Failed to load results. Please try again.</p>
						<Button onClick={handleSearch} variant="outline" className="mt-4">
							Retry
						</Button>
					</div>
				) : results.length === 0 ? (
					<EmptySearch
						hasQuery={!!query}
						onClear={() => {
							setQuery('');
							loadRecommendations();
						}}
					/>
				) : (
					<div className="space-y-3">
						{results.map((job) => (
							<SearchResultCard
								key={job.id}
								job={job}
								onToggleSave={handleToggleSave}
								saving={savingJobId === job.id}
								onClick={() => navigate(`/candidate/jobs/${job.id}`)}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

export default AISearchPage;
