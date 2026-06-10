import {
	Award,
	Bookmark,
	BookmarkPlus,
	Brain,
	Briefcase,
	Building2,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Clock,
	DollarSign,
	ExternalLink,
	Filter,
	Flame,
	Globe,
	GraduationCap,
	History,
	Loader2,
	MapPin,
	RotateCcw,
	Search,
	Send,
	SlidersHorizontal,
	Sparkles,
	Target,
	TrendingUp,
	X,
	Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { Tooltip } from '@/components/ui/tooltip'
import { useAuth } from '@/contexts/auth-context'
import { apiCall } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Job {
	id: number
	job_id?: number
	title: string
	company: string
	poster_company?: string
	description: string
	requirements: string
	location: string
	salary_range: string
	salary_min?: number
	salary_max?: number
	job_type: string
	status: string
	created_at: string
	screening_questions?: string
	// Match fields
	weighted_score?: number
	match_level?: string
	skill_match_pct?: number
	matching_skills?: string[]
	missing_skills?: string[]
	success_prediction?: string
	similarity_score?: number
	// Extended
	company_logo?: string
	company_size?: string
	remote_type?: 'remote' | 'hybrid' | 'onsite' | 'flexible'
	experience_level?: string
	skills_required?: string[]
	posted_by?: string
	applicants_count?: number
	has_applied?: boolean
	has_saved?: boolean
}

interface SavedJob {
	job_id: number
	saved_at: string
}
interface RecentSearch {
	query: string
	filters: FilterState
	timestamp: number
}
interface FilterState {
	search: string
	type: string
	location: string
	remoteType: string
	experienceLevel: string
	salaryMin: number
	salaryMax: number
	skills: string[]
	companySize: string
	sortBy: 'match' | 'newest' | 'salary_high' | 'salary_low'
}

const DEFAULT_FILTERS: FilterState = {
	search: '',
	type: '',
	location: '',
	remoteType: '',
	experienceLevel: '',
	salaryMin: 0,
	salaryMax: 300000,
	skills: [],
	companySize: '',
	sortBy: 'match',
}

function _matchColor(score: number): string {
	if (score >= 80) return 'text-green-600'
	if (score >= 60) return 'text-amber-600'
	return 'text-red-500'
}

function matchBg(score: number): string {
	if (score >= 80) return 'bg-green-100 text-green-700 border-green-200'
	if (score >= 60) return 'bg-amber-100 text-amber-700 border-amber-200'
	return 'bg-red-100 text-red-600 border-red-200'
}

function matchBadgeColor(score: number): string {
	if (score >= 80) return 'bg-green-500'
	if (score >= 60) return 'bg-amber-500'
	return 'bg-red-400'
}

function matchLevelLabel(level: string): string {
	if (level === 'excellent') return 'Excellent Match'
	if (level === 'good') return 'Good Match'
	if (level === 'fair') return 'Fair Match'
	return ''
}

function timeAgo(dateStr: string) {
	const diff = Date.now() - new Date(dateStr).getTime()
	const days = Math.floor(diff / 86400000)
	if (days === 0) return 'Today'
	if (days === 1) return '1 day ago'
	if (days < 30) return `${days} days ago`
	return `${Math.floor(days / 30)} months ago`
}

export function CandidateJobsPage() {
	const navigate = useNavigate()
	const { user } = useAuth()

	// === Data state ===
	const [jobs, setJobs] = useState<Job[]>([])
	const [recommendedJobs, setRecommendedJobs] = useState<Job[]>([])
	const [loading, setLoading] = useState(true)
	const [savedJobIds, setSavedJobIds] = useState<Set<number>>(new Set())
	const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([])

	// === Filter state ===
	const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
	const [activeFilterCount, setActiveFilterCount] = useState(0)
	const [showFiltersMobile, setShowFiltersMobile] = useState(false)

	// === AI search ===
	const [aiSearchMode, setAiSearchMode] = useState(false)
	const [aiSearchQuery, setAiSearchQuery] = useState('')
	const [aiSearching, setAiSearching] = useState(false)
	const [aiResults, setAiResults] = useState<Job[] | null>(null)

	// === Split view ===
	const [selectedJob, setSelectedJob] = useState<Job | null>(null)
	const [showDetailPanel, setShowDetailPanel] = useState(false)

	// === Pagination ===
	const [page, setPage] = useState(1)
	const [_hasMore, _setHasMore] = useState(true)
	const PAGE_SIZE = 10

	const jobListRef = useRef<HTMLDivElement>(null)

	// Load recent searches from localStorage
	useEffect(() => {
		try {
			const saved = localStorage.getItem('rekrut_recent_searches')
			if (saved) setRecentSearches(JSON.parse(saved))
		} catch {}
	}, [])

	useEffect(() => {
		loadJobs()
		if (user) loadSavedJobs()
	}, [user, loadJobs, loadSavedJobs])

	// Save search to history when filters change significantly
	useEffect(() => {
		const timer = setTimeout(() => {
			if (filters.search || filters.location || filters.type) {
				saveRecentSearch(filters)
			}
		}, 3000)
		return () => clearTimeout(timer)
	}, [filters.search, filters.type, filters.location, saveRecentSearch, filters])

	function saveRecentSearch(f: FilterState) {
		if (!f.search && !f.location) return
		const searchKey = `${f.search}|${f.location}|${f.type}`
		setRecentSearches((prev) => {
			const filtered = prev.filter(
				(s) => `${s.filters.search}|${s.filters.location}|${s.filters.type}` !== searchKey,
			)
			const updated = [
				{ query: f.search || 'All jobs', filters: f, timestamp: Date.now() },
				...filtered,
			].slice(0, 5)
			localStorage.setItem('rekrut_recent_searches', JSON.stringify(updated))
			return updated
		})
	}

	async function loadJobs() {
		try {
			const [allData, recData] = await Promise.allSettled([
				apiCall<{ data: Job[]; pagination: { total: number } }>('/candidate/jobs?limit=200'),
				apiCall<{ recommended_jobs: Job[] }>('/candidate/jobs/recommended'),
			])
			const allJobs = allData.status === 'fulfilled' ? allData.value.data || [] : []
			const recJobs = recData.status === 'fulfilled' ? recData.value.recommended_jobs || [] : []

			const recMap = new Map<number, Job>()
			for (const rj of recJobs) recMap.set(rj.job_id ?? rj.id, rj)

			const enriched = allJobs.map((j) => {
				const rec = recMap.get(j.id)
				return rec ? { ...j, ...rec } : j
			})

			setJobs(enriched)
			setRecommendedJobs(recJobs.slice(0, 5))
		} catch {
		} finally {
			setLoading(false)
		}
	}

	async function loadSavedJobs() {
		try {
			const data = await apiCall<{ saved_jobs: SavedJob[] }>('/candidate/saved-jobs')
			if (data.saved_jobs) {
				setSavedJobIds(new Set(data.saved_jobs.map((sj) => sj.job_id)))
			}
		} catch {}
	}

	async function toggleSaveJob(jobId: number, e: React.MouseEvent) {
		e.preventDefault()
		e.stopPropagation()
		try {
			if (savedJobIds.has(jobId)) {
				await apiCall(`/candidate/saved-jobs/${jobId}`, { method: 'DELETE' })
				setSavedJobIds((prev) => {
					const next = new Set(prev)
					next.delete(jobId)
					return next
				})
			} else {
				await apiCall(`/candidate/saved-jobs`, { method: 'POST', body: { job_id: jobId } })
				setSavedJobIds((prev) => new Set(prev).add(jobId))
			}
		} catch {}
	}

	async function handleAiSearch() {
		if (!aiSearchQuery.trim()) return
		setAiSearching(true)
		try {
			const data = await apiCall<{ success: boolean; results: Job[] }>(
				'/candidate/ai/smart-search',
				{
					method: 'POST',
					body: { query: aiSearchQuery },
				},
			)
			if (data.results) {
				setAiResults(data.results)
				saveRecentSearch({ ...filters, search: aiSearchQuery })
			}
		} catch {
			setFilters((prev) => ({ ...prev, search: aiSearchQuery }))
			setPage(1)
			setAiSearchMode(false)
			setAiResults(null)
		} finally {
			setAiSearching(false)
		}
	}

	function clearAiSearch() {
		setAiResults(null)
		setAiSearchQuery('')
		setAiSearchMode(false)
	}

	function setSearch(key: keyof FilterState, value: any) {
		setFilters((prev) => ({ ...prev, [key]: value }))
		setPage(1)
	}

	function toggleSkill(skill: string) {
		setFilters((prev) => {
			const skills = prev.skills.includes(skill)
				? prev.skills.filter((s) => s !== skill)
				: [...prev.skills, skill]
			return { ...prev, skills }
		})
		setPage(1)
	}

	function clearAllFilters() {
		setFilters(DEFAULT_FILTERS)
		setAiResults(null)
		setAiSearchMode(false)
		setPage(1)
	}

	// Count active filters
	useEffect(() => {
		let count = 0
		if (filters.type) count++
		if (filters.location) count++
		if (filters.remoteType) count++
		if (filters.experienceLevel) count++
		if (filters.salaryMin > 0) count++
		if (filters.salaryMax < 300000) count++
		if (filters.skills.length) count++
		if (filters.companySize) count++
		if (filters.sortBy !== 'match') count++
		setActiveFilterCount(count)
	}, [filters])

	const jobTypes = [...new Set(jobs.map((j) => j.job_type).filter(Boolean))]
	const allSkills = [
		...new Set(
			jobs
				.flatMap((j) => [
					...(j.matching_skills || []),
					...(j.skills_required || []),
					...(j.missing_skills || []),
				])
				.filter(Boolean),
		),
	]
	const allLocations = [...new Set(jobs.map((j) => j.location).filter(Boolean))]
	const _allCompanies = [...new Set(jobs.map((j) => j.company || j.poster_company).filter(Boolean))]

	const filtered = jobs
		.filter((j) => {
			const matchSearch =
				!filters.search ||
				j.title?.toLowerCase().includes(filters.search.toLowerCase()) ||
				j.company?.toLowerCase().includes(filters.search.toLowerCase()) ||
				j.description?.toLowerCase().includes(filters.search.toLowerCase())
			const matchType = !filters.type || j.job_type === filters.type
			const matchLocation =
				!filters.location || j.location?.toLowerCase().includes(filters.location.toLowerCase())
			const matchRemote =
				!filters.remoteType ||
				j.remote_type === filters.remoteType ||
				j.location?.toLowerCase().includes(filters.remoteType.toLowerCase())
			const matchExp =
				!filters.experienceLevel ||
				(j.experience_level || '').toLowerCase().includes(filters.experienceLevel.toLowerCase())
			const matchSalary =
				(!filters.salaryMin || (j.salary_max ?? 0) >= filters.salaryMin) &&
				(!filters.salaryMax || (j.salary_min ?? 0) <= filters.salaryMax)
			const matchSkills =
				filters.skills.length === 0 ||
				filters.skills.some((s) => j.matching_skills?.includes(s) || j.skills_required?.includes(s))
			return (
				matchSearch &&
				matchType &&
				matchLocation &&
				matchRemote &&
				matchExp &&
				matchSalary &&
				matchSkills
			)
		})
		.sort((a, b) => {
			if (filters.sortBy === 'match') {
				const sa = b.weighted_score ?? 0
				const sb = a.weighted_score ?? 0
				if (sa !== sb) return sa - sb
			}
			if (filters.sortBy === 'newest')
				return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
			if (filters.sortBy === 'salary_high') return (b.salary_max ?? 0) - (a.salary_max ?? 0)
			if (filters.sortBy === 'salary_low')
				return (a.salary_min ?? Infinity) - (b.salary_min ?? Infinity)
			return 0
		})

	const displayed = (aiResults || filtered).slice(0, page * PAGE_SIZE)
	const hasMoreResults = (aiResults || filtered).length > page * PAGE_SIZE

	const savedJobs = jobs.filter((j) => savedJobIds.has(j.id))

	return (
		<div className='h-[calc(100dvh-4rem)] flex flex-col overflow-hidden'>
			{/* === HERO SEARCH BAR === */}
			<div className='shrink-0 bg-gradient-to-br from-indigo-600 via-indigo-500 to-purple-600 px-4 py-6 sm:py-8'>
				<div className='max-w-4xl mx-auto'>
					<div className='flex items-center justify-between mb-4'>
						<div>
							<h1 className='text-white text-xl sm:text-2xl font-bold flex items-center gap-2'>
								<Briefcase className='h-5 w-5' />
								Find Your Next Opportunity
							</h1>
							<p className='text-indigo-100 text-sm mt-1'>
								{aiResults
									? `${aiResults.length} AI-matched results`
									: `${filtered.length} active jobs`}
							</p>
						</div>
						<div className='flex items-center gap-2'>
							{savedJobs.length > 0 && (
								<Button
									variant='outline'
									size='sm'
									className='bg-white/10 border-white/20 text-white hover:bg-white/20 gap-1.5'
									onClick={() => setShowDetailPanel(true)}
								>
									<Bookmark className='h-3.5 w-3.5' />
									<span className='hidden sm:inline'>Saved</span>
									<Badge className='bg-white/20 text-white ml-1 text-[10px] px-1.5 py-0'>
										{savedJobs.length}
									</Badge>
								</Button>
							)}
							<Button
								variant='outline'
								size='sm'
								className='bg-white/10 border-white/20 text-white hover:bg-white/20 gap-1.5'
								onClick={() => setAiSearchMode(!aiSearchMode)}
							>
								{aiSearchMode ? <X className='h-3.5 w-3.5' /> : <Brain className='h-3.5 w-3.5' />}
								<span className='hidden sm:inline'>{aiSearchMode ? 'Close AI' : 'AI Search'}</span>
							</Button>
						</div>
					</div>

					{aiSearchMode ? (
						<div className='space-y-2'>
							<div className='flex gap-2'>
								<div className='relative flex-1'>
									<Brain className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-300' />
									<Input
										placeholder='Try: "remote Python jobs paying over $120k in San Francisco"'
										value={aiSearchQuery}
										onChange={(e) => setAiSearchQuery(e.target.value)}
										onKeyDown={(e) => e.key === 'Enter' && handleAiSearch()}
										className='pl-10 bg-white/95 border-0 text-foreground h-11 shadow-lg'
										autoFocus
									/>
								</div>
								<Button
									onClick={handleAiSearch}
									disabled={aiSearching || !aiSearchQuery.trim()}
									className='bg-white text-indigo-600 hover:bg-white/90 h-11 px-6 font-semibold shadow-lg'
								>
									{aiSearching ? (
										<Loader2 className='h-4 w-4 animate-spin' />
									) : (
										<Search className='h-4 w-4' />
									)}
									<span className='hidden sm:inline'>
										{aiSearching ? 'Searching...' : 'Search'}
									</span>
								</Button>
							</div>
							{aiResults && (
								<p className='text-xs text-indigo-100 flex items-center gap-1.5'>
									<CheckCircle2 className='h-3 w-3 text-green-300' />
									AI found {aiResults.length} matching jobs for "{aiSearchQuery}"
									<button className='underline ml-1 hover:text-white' onClick={clearAiSearch}>
										Clear
									</button>
								</p>
							)}
						</div>
					) : (
						<div className='flex flex-col sm:flex-row gap-2'>
							<div className='relative flex-1'>
								<Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
								<Input
									placeholder='Search by title, company, or keywords...'
									value={filters.search}
									onChange={(e) => setSearch('search', e.target.value)}
									className='pl-10 bg-white/95 border-0 text-foreground h-11 shadow-lg'
								/>
							</div>
							<div className='relative sm:w-48'>
								<MapPin className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
								<Input
									placeholder='Location...'
									value={filters.location}
									onChange={(e) => setSearch('location', e.target.value)}
									className='pl-10 bg-white/95 border-0 text-foreground h-11 shadow-lg'
								/>
							</div>
							<Button
								className='bg-white text-indigo-600 hover:bg-white/90 h-11 px-6 font-semibold shadow-lg gap-2'
								onClick={() => setShowFiltersMobile(true)}
							>
								<Filter className='h-4 w-4' />
								<span>Filters</span>
								{activeFilterCount > 0 && (
									<Badge className='bg-indigo-600 text-white text-[10px] px-1.5 py-0'>
										{activeFilterCount}
									</Badge>
								)}
							</Button>
						</div>
					)}

					{/* Recent searches */}
					{!aiSearchMode && recentSearches.length > 0 && !filters.search && !filters.location && (
						<div className='flex items-center gap-2 mt-3 overflow-x-auto'>
							<History className='h-3.5 w-3.5 text-indigo-200 shrink-0' />
							<span className='text-xs text-indigo-200 shrink-0'>Recent:</span>
							{recentSearches.slice(0, 3).map((rs, i) => (
								<button
									key={i}
									onClick={() => setFilters(rs.filters)}
									className='text-xs text-white/80 hover:text-white bg-white/10 rounded-full px-2.5 py-1 transition-colors whitespace-nowrap flex items-center gap-1'
								>
									<Clock className='h-3 w-3' />
									{rs.query}
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			{/* === MAIN CONTENT: Split View === */}
			<div className='flex-1 flex overflow-hidden'>
				{/* Left: Job List */}
				<div className='flex-1 flex flex-col overflow-hidden min-w-0'>
					{/* Toolbar */}
					<div className='shrink-0 flex items-center justify-between px-4 py-2 border-b bg-background'>
						<div className='flex items-center gap-2'>
							<span className='text-sm font-medium text-muted-foreground'>
								{(aiResults || filtered).length} result
								{(aiResults || filtered).length !== 1 ? 's' : ''}
							</span>
							{activeFilterCount > 0 && (
								<button
									onClick={clearAllFilters}
									className='text-xs text-primary hover:underline flex items-center gap-1'
								>
									<X className='h-3 w-3' /> Clear all
								</button>
							)}
						</div>
						<div className='flex items-center gap-2'>
							<select
								value={filters.sortBy}
								onChange={(e) => setSearch('sortBy', e.target.value)}
								className='text-xs bg-transparent border rounded px-2 py-1'
							>
								<option value='match'>Best Match</option>
								<option value='newest'>Newest</option>
								<option value='salary_high'>Salary: High-Low</option>
								<option value='salary_low'>Salary: Low-High</option>
							</select>
						</div>
					</div>

					{/* Desktop Filter Bar (horizontal) */}
					<div className='shrink-0 hidden sm:flex items-center gap-2 px-4 py-2 border-b bg-background/50 overflow-x-auto'>
						{jobTypes.length > 0 && (
							<select
								value={filters.type}
								onChange={(e) => setSearch('type', e.target.value)}
								className='text-xs bg-transparent border rounded px-2 py-1 min-w-[100px]'
							>
								<option value=''>All Types</option>
								{jobTypes.map((t) => (
									<option key={t} value={t}>
										{t}
									</option>
								))}
							</select>
						)}
						<select
							value={filters.remoteType}
							onChange={(e) => setSearch('remoteType', e.target.value)}
							className='text-xs bg-transparent border rounded px-2 py-1 min-w-[100px]'
						>
							<option value=''>All Work Modes</option>
							<option value='remote'>Remote</option>
							<option value='hybrid'>Hybrid</option>
							<option value='onsite'>On-site</option>
							<option value='flexible'>Flexible</option>
						</select>
						<select
							value={filters.experienceLevel}
							onChange={(e) => setSearch('experienceLevel', e.target.value)}
							className='text-xs bg-transparent border rounded px-2 py-1 min-w-[100px]'
						>
							<option value=''>All Levels</option>
							<option value='entry'>Entry Level</option>
							<option value='mid'>Mid Level</option>
							<option value='senior'>Senior</option>
							<option value='lead'>Lead / Staff</option>
							<option value='executive'>Executive</option>
						</select>
						<select
							value={filters.companySize}
							onChange={(e) => setSearch('companySize', e.target.value)}
							className='text-xs bg-transparent border rounded px-2 py-1 min-w-[100px]'
						>
							<option value=''>All Sizes</option>
							<option value='startup'>Startup (1-50)</option>
							<option value='small'>Small (51-200)</option>
							<option value='medium'>Medium (201-1000)</option>
							<option value='large'>Large (1000+)</option>
						</select>
					</div>

					{/* Job List */}
					<div ref={jobListRef} className='flex-1 overflow-y-auto px-4 py-3 space-y-3'>
						{loading ? (
							<div className='flex items-center justify-center py-16'>
								<div className='h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent' />
							</div>
						) : displayed.length === 0 ? (
							<div className='py-16 text-center'>
								<Briefcase className='mx-auto mb-3 h-12 w-12 opacity-20' />
								<p className='text-muted-foreground font-medium'>
									No jobs found matching your criteria
								</p>
								<p className='text-sm text-muted-foreground mt-1'>
									Try adjusting your filters or search terms
								</p>
								<Button variant='outline' className='mt-4 gap-1' onClick={clearAllFilters}>
									<RotateCcw className='h-4 w-4' /> Reset Filters
								</Button>
							</div>
						) : (
							<>
								{/* Recommended banner at top of results when not searching */}
								{!filters.search &&
									!filters.location &&
									!aiResults &&
									recommendedJobs.length > 0 && (
										<div className='flex items-center gap-2 mb-1'>
											<Sparkles className='h-4 w-4 text-amber-500' />
											<span className='text-xs font-medium text-amber-600'>
												Recommended for you
											</span>
											<Separator className='flex-1' />
										</div>
									)}

								{displayed.map((job) => {
									const score = job.weighted_score ? Math.round(job.weighted_score) : null
									const isSaved = savedJobIds.has(job.id)
									const isSelected = selectedJob?.id === job.id
									return (
										<Card
											key={job.id}
											className={cn(
												'transition-all cursor-pointer hover:shadow-md',
												isSelected
													? 'ring-2 ring-indigo-500 shadow-md border-indigo-200'
													: 'border',
											)}
											onClick={() => {
												setSelectedJob(job)
												setShowDetailPanel(true)
											}}
										>
											<CardContent className='p-4'>
												<div className='flex items-start gap-3'>
													{/* Company Logo placeholder */}
													<Avatar
														src={job.company_logo}
														fallback={(job.company || job.poster_company || 'C').charAt(0)}
														size='lg'
														className='h-12 w-12 shrink-0'
													/>

													<div className='flex-1 min-w-0'>
														{/* Title row */}
														<div className='flex items-start justify-between gap-2'>
															<div className='min-w-0'>
																<h3 className='font-semibold text-sm truncate leading-tight'>
																	{job.title}
																</h3>
																<p className='text-xs text-muted-foreground flex items-center gap-1 mt-0.5'>
																	<Building2 className='h-3 w-3' />
																	{job.company || job.poster_company || 'Company'}
																	{job.company_size && (
																		<span className='text-[10px] bg-muted rounded px-1'>
																			{job.company_size}
																		</span>
																	)}
																</p>
															</div>
															<div className='flex items-center gap-1.5 shrink-0'>
																{job.has_applied && (
																	<Badge className='bg-green-500 text-white text-[10px] px-1.5 py-0'>
																		Applied
																	</Badge>
																)}
																{score != null && (
																	<Tooltip
																		content={`${matchLevelLabel(job.match_level || '')} - ${score}% match`}
																	>
																		<div
																			className={`text-center rounded-lg border px-2 py-0.5 shrink-0 ${matchBg(score)}`}
																		>
																			<div className='text-sm font-bold leading-tight'>
																				{score}%
																			</div>
																		</div>
																	</Tooltip>
																)}
																<button
																	onClick={(e) => toggleSaveJob(job.id, e)}
																	className='p-1 rounded hover:bg-muted transition-colors'
																	aria-label={isSaved ? 'Unsave job' : 'Save job'}
																>
																	{isSaved ? (
																		<Bookmark className='h-4 w-4 text-amber-500 fill-amber-500' />
																	) : (
																		<BookmarkPlus className='h-4 w-4 text-muted-foreground hover:text-amber-500' />
																	)}
																</button>
															</div>
														</div>

														{/* Meta row */}
														<div className='flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground'>
															{job.location && (
																<span className='flex items-center gap-0.5'>
																	<MapPin className='h-3 w-3' /> {job.location}
																</span>
															)}
															{job.salary_range && (
																<span className='flex items-center gap-0.5'>
																	<DollarSign className='h-3 w-3' /> {job.salary_range}
																</span>
															)}
															{job.job_type && (
																<Badge variant='secondary' className='text-[10px] h-5'>
																	{job.job_type}
																</Badge>
															)}
															{job.remote_type && (
																<Badge variant='outline' className='text-[10px] h-5'>
																	{job.remote_type === 'remote' && (
																		<Globe className='h-2.5 w-2.5 mr-0.5' />
																	)}
																	{job.remote_type}
																</Badge>
															)}
															<span className='flex items-center gap-0.5'>
																<Clock className='h-3 w-3' /> {timeAgo(job.created_at)}
															</span>
															{job.applicants_count != null && (
																<span className='flex items-center gap-0.5'>
																	<Flame className='h-3 w-3' /> {job.applicants_count} applicants
																</span>
															)}
														</div>

														{/* Skills match */}
														{job.matching_skills && job.matching_skills.length > 0 && (
															<div className='flex flex-wrap items-center gap-1 mt-2'>
																<Target className='h-3 w-3 text-green-500 shrink-0' />
																{job.matching_skills.slice(0, 3).map((s) => (
																	<Badge
																		key={s}
																		variant='outline'
																		className='text-[10px] bg-green-50 text-green-700 border-green-200 h-5'
																	>
																		{s}
																	</Badge>
																))}
																{job.matching_skills.length > 3 && (
																	<span className='text-[10px] text-green-600'>
																		+{job.matching_skills.length - 3} more
																	</span>
																)}
															</div>
														)}

														{/* Missing skills hint */}
														{job.missing_skills &&
															job.missing_skills.length > 0 &&
															score != null &&
															score < 80 && (
																<div className='flex flex-wrap items-center gap-1 mt-1'>
																	<span className='text-[10px] text-amber-500'>To improve:</span>
																	{job.missing_skills.slice(0, 2).map((s) => (
																		<span
																			key={s}
																			className='text-[10px] bg-amber-50 text-amber-700 rounded px-1.5 py-0.5 border border-amber-100'
																		>
																			{s}
																		</span>
																	))}
																	{job.missing_skills.length > 2 && (
																		<span className='text-[10px] text-amber-600'>
																			+{job.missing_skills.length - 2}
																		</span>
																	)}
																</div>
															)}
													</div>
												</div>
											</CardContent>
										</Card>
									)
								})}

								{/* Load more / Pagination */}
								{hasMoreResults && (
									<div className='flex justify-center py-4'>
										<Button
											variant='outline'
											onClick={() => setPage((p) => p + 1)}
											className='gap-2'
										>
											<TrendingUp className='h-4 w-4' />
											Load More ({(aiResults || filtered).length - page * PAGE_SIZE} remaining)
										</Button>
									</div>
								)}
							</>
						)}
					</div>
				</div>

				{/* Right: Detail Panel (desktop only) */}
				<div
					className={cn(
						'hidden lg:block w-[480px] xl:w-[520px] border-l bg-background overflow-y-auto shrink-0 transition-all',
						showDetailPanel ? 'opacity-100' : 'opacity-0',
					)}
				>
					{selectedJob ? (
						<JobDetailPanel
							job={selectedJob}
							isSaved={savedJobIds.has(selectedJob.id)}
							onToggleSave={(e) => toggleSaveJob(selectedJob.id, e)}
							onClose={() => {
								setShowDetailPanel(false)
								setSelectedJob(null)
							}}
							onApply={() => navigate(`/candidate/jobs/${selectedJob.id}?apply=true`)}
						/>
					) : (
						<div className='flex flex-col items-center justify-center h-full text-center p-8'>
							<Briefcase className='h-16 w-16 text-muted-foreground/20 mb-4' />
							<p className='text-muted-foreground font-medium'>Select a job to view details</p>
							<p className='text-sm text-muted-foreground mt-1'>
								Click any job card from the list to see the full description, requirements, and
								apply options.
							</p>
						</div>
					)}
				</div>
			</div>

			{/* Mobile Detail Panel */}
			<div className='lg:hidden'>
				<Sheet
					open={showDetailPanel && selectedJob != null}
					onOpenChange={setShowDetailPanel}
					className='w-full'
				>
					<SheetHeader>
						<SheetTitle className='flex items-center gap-2'>
							<Briefcase className='h-5 w-5' /> Job Details
						</SheetTitle>
						<SheetClose />
					</SheetHeader>
					<SheetContent className='p-0 overflow-x-hidden'>
						{selectedJob && (
							<JobDetailPanel
								job={selectedJob}
								isSaved={savedJobIds.has(selectedJob.id)}
								onToggleSave={(e) => toggleSaveJob(selectedJob.id, e)}
								onClose={() => {
									setShowDetailPanel(false)
									setSelectedJob(null)
								}}
								onApply={() => navigate(`/candidate/jobs/${selectedJob.id}?apply=true`)}
							/>
						)}
					</SheetContent>
				</Sheet>
			</div>

			{/* === MOBILE FILTERS SHEET === */}
			<Sheet open={showFiltersMobile} onOpenChange={setShowFiltersMobile} side='left'>
				<SheetHeader>
					<SheetTitle className='flex items-center gap-2'>
						<SlidersHorizontal className='h-5 w-5' /> Filters
					</SheetTitle>
					<SheetClose />
				</SheetHeader>
				<SheetContent>
					<FilterSidebar
						filters={filters}
						setSearch={setSearch}
						toggleSkill={toggleSkill}
						clearAllFilters={clearAllFilters}
						jobTypes={jobTypes}
						allSkills={allSkills}
						allLocations={allLocations}
					/>
				</SheetContent>
			</Sheet>
		</div>
	)
}

// === FILTER SIDEBAR COMPONENT ===
function FilterSidebar({
	filters,
	setSearch,
	toggleSkill,
	clearAllFilters,
	jobTypes,
	allSkills,
	allLocations,
}: {
	filters: FilterState
	setSearch: (key: keyof FilterState, value: any) => void
	toggleSkill: (skill: string) => void
	clearAllFilters: () => void
	jobTypes: string[]
	allSkills: string[]
	allLocations: string[]
}) {
	const [showSalary, setShowSalary] = useState(true)
	const [showSkills, setShowSkills] = useState(true)
	const [showExperience, setShowExperience] = useState(true)
	const [showRemote, setShowRemote] = useState(true)

	return (
		<div className='space-y-5'>
			<div className='flex items-center justify-between'>
				<span className='text-sm font-medium text-muted-foreground'>
					{allSkills.length} skills available
				</span>
				<button
					onClick={clearAllFilters}
					className='text-xs text-primary hover:underline flex items-center gap-1'
				>
					<RotateCcw className='h-3 w-3' /> Reset all
				</button>
			</div>

			{/* Job Type */}
			<div>
				<p className='text-sm font-semibold mb-2'>Job Type</p>
				<div className='space-y-1.5'>
					<label className='flex items-center gap-2 cursor-pointer'>
						<input
							type='radio'
							name='jobType'
							checked={filters.type === ''}
							onChange={() => setSearch('type', '')}
							className='h-4 w-4 text-primary'
						/>
						<span className='text-sm'>All Types</span>
					</label>
					{jobTypes.map((t) => (
						<label key={t} className='flex items-center gap-2 cursor-pointer'>
							<input
								type='radio'
								name='jobType'
								checked={filters.type === t}
								onChange={() => setSearch('type', t)}
								className='h-4 w-4 text-primary'
							/>
							<span className='text-sm'>{t}</span>
						</label>
					))}
				</div>
			</div>

			<Separator />

			{/* Remote / Work Mode */}
			<div>
				<button
					onClick={() => setShowRemote(!showRemote)}
					className='flex items-center justify-between w-full mb-2'
				>
					<p className='text-sm font-semibold'>Work Mode</p>
					{showRemote ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
				</button>
				{showRemote && (
					<div className='space-y-1.5'>
						{['', 'remote', 'hybrid', 'onsite', 'flexible'].map((val) => (
							<label key={val} className='flex items-center gap-2 cursor-pointer'>
								<input
									type='radio'
									name='remoteType'
									checked={filters.remoteType === val}
									onChange={() => setSearch('remoteType', val)}
									className='h-4 w-4 text-primary'
								/>
								<span className='text-sm'>
									{val === '' ? 'All' : val.charAt(0).toUpperCase() + val.slice(1)}
								</span>
							</label>
						))}
					</div>
				)}
			</div>

			<Separator />

			{/* Experience Level */}
			<div>
				<button
					onClick={() => setShowExperience(!showExperience)}
					className='flex items-center justify-between w-full mb-2'
				>
					<p className='text-sm font-semibold'>Experience Level</p>
					{showExperience ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
				</button>
				{showExperience && (
					<div className='space-y-1.5'>
						{['', 'entry', 'mid', 'senior', 'lead', 'executive'].map((val) => (
							<label key={val} className='flex items-center gap-2 cursor-pointer'>
								<input
									type='radio'
									name='expLevel'
									checked={filters.experienceLevel === val}
									onChange={() => setSearch('experienceLevel', val)}
									className='h-4 w-4 text-primary'
								/>
								<span className='text-sm'>
									{val === ''
										? 'All Levels'
										: val === 'entry'
											? 'Entry Level'
											: val === 'mid'
												? 'Mid Level'
												: val === 'lead'
													? 'Lead / Staff'
													: val.charAt(0).toUpperCase() + val.slice(1)}
								</span>
							</label>
						))}
					</div>
				)}
			</div>

			<Separator />

			{/* Salary Range */}
			<div>
				<button
					onClick={() => setShowSalary(!showSalary)}
					className='flex items-center justify-between w-full mb-2'
				>
					<p className='text-sm font-semibold'>Salary Range</p>
					{showSalary ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
				</button>
				{showSalary && (
					<div className='space-y-3'>
						<Slider
							value={[filters.salaryMin]}
							onValueChange={(v) => setSearch('salaryMin', v[0])}
							min={0}
							max={300000}
							step={5000}
							label='Minimum Salary'
							formatLabel={(v) => `$${(v / 1000).toFixed(0)}k`}
						/>
						<Slider
							value={[filters.salaryMax]}
							onValueChange={(v) => setSearch('salaryMax', v[0])}
							min={0}
							max={300000}
							step={5000}
							label='Maximum Salary'
							formatLabel={(v) => `$${(v / 1000).toFixed(0)}k`}
						/>
					</div>
				)}
			</div>

			<Separator />

			{/* Skills */}
			<div>
				<button
					onClick={() => setShowSkills(!showSkills)}
					className='flex items-center justify-between w-full mb-2'
				>
					<p className='text-sm font-semibold'>Skills ({allSkills.length})</p>
					{showSkills ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
				</button>
				{showSkills && (
					<div className='max-h-48 overflow-y-auto space-y-1.5'>
						{allSkills.map((skill) => (
							<Checkbox
								key={skill}
								checked={filters.skills.includes(skill)}
								onCheckedChange={() => toggleSkill(skill)}
								label={skill}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

// === JOB DETAIL PANEL (Right side) ===
function JobDetailPanel({
	job,
	isSaved,
	onToggleSave,
	onClose,
	onApply,
}: {
	job: Job
	isSaved: boolean
	onToggleSave: (e: React.MouseEvent) => void
	onClose: () => void
	onApply: () => void
}) {
	const score = job.weighted_score ? Math.round(job.weighted_score) : null
	const screeningQuestions = (() => {
		if (!job.screening_questions) return []
		try {
			const raw =
				typeof job.screening_questions === 'string'
					? JSON.parse(job.screening_questions)
					: job.screening_questions
			return Array.isArray(raw) ? raw : []
		} catch {
			return []
		}
	})()

	return (
		<div className='p-4 sm:p-5 space-y-5'>
			{/* Header with actions */}
			<div className='flex items-start justify-between gap-3'>
				<div className='flex items-start gap-3'>
					<Avatar
						src={job.company_logo}
						fallback={(job.company || job.poster_company || 'C').charAt(0)}
						size='lg'
						className='h-14 w-14'
					/>
					<div className='min-w-0'>
						<h2 className='font-bold text-lg leading-tight break-words'>{job.title}</h2>
						<p className='text-sm text-muted-foreground flex items-center gap-1 mt-0.5'>
							<Building2 className='h-3.5 w-3.5' />
							<span className='break-words'>{job.company || job.poster_company || 'Company'}</span>
						</p>
					</div>
				</div>
				<div className='flex items-center gap-1.5 shrink-0'>
					<button
						onClick={onToggleSave}
						className='p-2 rounded-lg hover:bg-muted transition-colors'
						aria-label={isSaved ? 'Unsave' : 'Save'}
					>
						{isSaved ? (
							<Bookmark className='h-5 w-5 text-amber-500 fill-amber-500' />
						) : (
							<BookmarkPlus className='h-5 w-5 text-muted-foreground' />
						)}
					</button>
					<button
						onClick={onClose}
						className='p-2 rounded-lg hover:bg-muted transition-colors lg:hidden'
					>
						<X className='h-5 w-5' />
					</button>
				</div>
			</div>

			{/* Match Score Banner */}
			{score != null && (
				<div className={cn('rounded-lg border p-3', matchBg(score))}>
					<div className='flex items-center justify-between'>
						<div className='flex items-center gap-2'>
							<div
								className={`h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${matchBadgeColor(score)}`}
							>
								{score}%
							</div>
							<div>
								<p className='font-semibold text-sm'>{matchLevelLabel(job.match_level || '')}</p>
								<p className='text-xs opacity-80'>
									{job.skill_match_pct != null && `${job.skill_match_pct}% skills match`}
									{job.matching_skills &&
										` · ${job.matching_skills.length}/${(job.matching_skills?.length || 0) + (job.missing_skills?.length || 0)} skills`}
								</p>
							</div>
						</div>
						{job.match_level === 'excellent' && <Zap className='h-5 w-5 text-green-600' />}
					</div>
					{job.missing_skills && job.missing_skills.length > 0 && score < 80 && (
						<div className='mt-2 pt-2 border-t border-current/10'>
							<p className='text-xs font-medium opacity-70'>
								To reach 90% match, add these skills:
							</p>
							<div className='flex flex-wrap gap-1 mt-1'>
								{job.missing_skills.map((s) => (
									<span key={s} className='text-[10px] bg-white/50 rounded px-1.5 py-0.5'>
										{s}
									</span>
								))}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Job Meta */}
			<div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
				<div className='flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50'>
					<MapPin className='h-4 w-4 text-muted-foreground shrink-0' />
					<span className='truncate'>{job.location || 'Location not specified'}</span>
				</div>
				<div className='flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50'>
					<DollarSign className='h-4 w-4 text-muted-foreground shrink-0' />
					<span className='truncate'>{job.salary_range || 'Salary not specified'}</span>
				</div>
				<div className='flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50'>
					<Briefcase className='h-4 w-4 text-muted-foreground shrink-0' />
					<span>{job.job_type || 'Not specified'}</span>
				</div>
				<div className='flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50'>
					<Clock className='h-4 w-4 text-muted-foreground shrink-0' />
					<span>Posted {timeAgo(job.created_at)}</span>
				</div>
			</div>

			{/* Skills Required */}
			{(job.skills_required || job.matching_skills) && (
				<div>
					<p className='text-sm font-semibold mb-2 flex items-center gap-1'>
						<GraduationCap className='h-4 w-4' /> Required Skills
					</p>
					<div className='flex flex-wrap gap-1.5'>
						{(job.skills_required || job.matching_skills || []).map((skill) => {
							const isMatch = job.matching_skills?.includes(skill)
							return (
								<Badge
									key={skill}
									variant={isMatch ? 'default' : 'outline'}
									className={cn(
										'text-xs h-6',
										isMatch
											? 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200'
											: '',
									)}
								>
									{isMatch && <CheckCircle2 className='h-3 w-3 mr-1' />}
									{skill}
								</Badge>
							)
						})}
					</div>
				</div>
			)}

			<Separator />

			{/* Description */}
			<div>
				<p className='text-sm font-semibold mb-2'>About the Role</p>
				<div className='prose prose-sm max-w-none text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed break-words overflow-x-hidden'>
					{job.description || 'No description provided.'}
				</div>
			</div>

			{/* Requirements */}
			{job.requirements && (
				<div>
					<p className='text-sm font-semibold mb-2'>Requirements</p>
					<div className='prose prose-sm max-w-none text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed break-words overflow-x-hidden'>
						{job.requirements}
					</div>
				</div>
			)}

			{/* Screening Questions */}
			{screeningQuestions.length > 0 && (
				<div>
					<p className='text-sm font-semibold mb-2 flex items-center gap-1'>
						<Award className='h-4 w-4' /> Screening Questions ({screeningQuestions.length})
					</p>
					<div className='space-y-2'>
						{screeningQuestions.map((q, i) => (
							<div key={i} className='text-sm p-2 rounded-lg bg-muted/50'>
								<p className='font-medium text-xs'>
									{q.question}
									{q.required && <span className='text-destructive'> *</span>}
								</p>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Apply Actions */}
			<div className='sticky bottom-0 bg-background pt-2 pb-4 border-t'>
				<div className='flex flex-col sm:flex-row gap-2'>
					<Button className='flex-1 gap-2' onClick={onApply}>
						<Send className='h-4 w-4' /> Apply Now
					</Button>
					<Button variant='outline' className='gap-2' onClick={onApply}>
						<ExternalLink className='h-4 w-4' /> View Full Page
					</Button>
				</div>
			</div>
		</div>
	)
}
