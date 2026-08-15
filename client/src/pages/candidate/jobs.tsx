import { SEO } from '@/components/SEO'
import {
	Bookmark,
	BookmarkPlus,
	Brain,
	Briefcase,
	CheckCircle2,
	Clock,
	Filter,
	Globe,
	Heart,
	History,
	Loader2,
	MapPin,
	RotateCcw,
	Search,
	SlidersHorizontal,
	Sparkles,
	Target,
	ThumbsUp,
	TrendingUp,
	X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScoreRing } from '@/components/domain/score-ring'
import { JobDetailDrawer } from '@/components/domain/job-detail-drawer'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip } from '@/components/ui/tooltip'
import { useAuth } from '@/contexts/auth-context'
import {
	apiCall,
	dismissJob,
	getDismissedJobs,
	getFitScores,
	getLikedJobs,
	likeJob,
	restoreJob,
	unlikeJob,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { JobCard, JobFilterBar } from '@/components/candidate'
import type { JobFilterValues } from '@/components/candidate'
import { useSubscription } from '@/hooks/use-subscription'

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
	explanation?: {
		why_matched: string
		skills_match: string
		company_quality: string
		your_strength: string
	}
	// Fit score
	fit_score?: number
	fit_breakdown?: {
		skills: number
		experience: number
		location: number
		salary: number
		type: number
	}
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
	remoteOnly: boolean
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
	remoteOnly: false,
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
	const { isPro, canUseFeature, usageFor } = useSubscription()

	// === Data state ===
	const [jobs, setJobs] = useState<Job[]>([])
	const [recommendedJobs, setRecommendedJobs] = useState<Job[]>([])
	const [loading, setLoading] = useState(true)
	const [fitScoresLoading, setFitScoresLoading] = useState(false)
	const [savedJobIds, setSavedJobIds] = useState<Set<number>>(new Set())
	const [likedJobIds, setLikedJobIds] = useState<Set<number>>(new Set())
	const [dismissedJobIds, setDismissedJobIds] = useState<Set<number>>(new Set())
	const [likedJobsData, setLikedJobsData] = useState<Job[]>([])
	const [dismissedJobsData, setDismissedJobsData] = useState<Job[]>([])
	const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([])
	const [userSkills, setUserSkills] = useState<string[]>([])

	// === Tab state ===
	const [activeTab, setActiveTab] = useState<'all' | 'liked' | 'dismissed'>('all')

	// === Filter state ===
	const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
	const [activeFilterCount, setActiveFilterCount] = useState(0)
	const [showFiltersMobile, setShowFiltersMobile] = useState(false)

	// === AI search ===
	const [aiSearchMode, setAiSearchMode] = useState(false)
	const [aiSearchQuery, setAiSearchQuery] = useState('')
	const [aiSearching, setAiSearching] = useState(false)
	const [aiResults, setAiResults] = useState<Job[] | null>(null)

	// === Auto-Apply ===
	const [autoApplyLoadingId, setAutoApplyLoadingId] = useState<number | null>(null)
	const [autoApplyRemaining, setAutoApplyRemaining] = useState<number | null>(null)
	const [toastMessage, setToastMessage] = useState<string | null>(null)

	// === Split view ===
	const [selectedJob, setSelectedJob] = useState<Job | null>(null)
	const [showDetailPanel, setShowDetailPanel] = useState(false)

	// === Pagination ===
	const [page, setPage] = useState(1)
	const [_hasMore, _setHasMore] = useState(true)
	const PAGE_SIZE = 10

	const [searchParams, setSearchParams] = useSearchParams()

	const jobListRef = useRef<HTMLDivElement>(null)

	// Load auto-apply usage when user/pro status changes
	useEffect(() => {
		if (isPro) {
			usageFor('auto_apply').then((u) => setAutoApplyRemaining(u.remaining))
		} else {
			setAutoApplyRemaining(null)
		}
	}, [isPro, usageFor])

	const showToast = useCallback((msg: string) => {
		setToastMessage(msg)
		setTimeout(() => setToastMessage(null), 4000)
	}, [])

	async function handleAutoApply(jobId: number) {
		if (!isPro || !canUseFeature('auto_apply')) {
			navigate('/pricing')
			return
		}
		setAutoApplyLoadingId(jobId)
		try {
			await apiCall('/candidate/applications/auto-apply', {
				method: 'POST',
				body: { job_id: jobId },
			})
			setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, has_applied: true } : j)))
			setRecommendedJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, has_applied: true } : j)))
			showToast('Auto-applied successfully!')
			const u = await usageFor('auto_apply')
			setAutoApplyRemaining(u.remaining)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : ''
			const code = (err as Error & { code?: string }).code
			if (msg.toLowerCase().includes('already') || code === 'ALREADY_APPLIED') {
				showToast('You have already applied to this job')
				setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, has_applied: true } : j)))
			} else if (msg.toLowerCase().includes('upgrade') || msg.toLowerCase().includes('premium') || code === 'UPGRADE_REQUIRED') {
				navigate('/pricing')
			} else {
				showToast(msg || 'Auto-apply failed. Please try again.')
			}
		} finally {
			setAutoApplyLoadingId(null)
		}
	}

	function getAutoApplyState(): 'hidden' | 'locked' | 'available' | 'limit_reached' {
		if (!user) return 'hidden'
		if (!isPro) return 'locked'
		if (autoApplyRemaining !== null && autoApplyRemaining <= 0) return 'limit_reached'
		return 'available'
	}

	// Sync URL skill param to search filter
	useEffect(() => {
		const skillParam = searchParams.get('skill')
		if (skillParam && filters.search !== skillParam) {
			setFilters((prev) => ({ ...prev, search: skillParam }))
			setPage(1)
		}
	}, [searchParams])

	// Load recent searches from localStorage
	useEffect(() => {
		try {
			const saved = localStorage.getItem('rekrut_recent_searches')
			if (saved) setRecentSearches(JSON.parse(saved))
		} catch (err) { console.error("[jobs] Operation failed:", err); }
	}, [])

	const saveRecentSearch = useCallback((f: FilterState) => {
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
	}, [])

	// Save search to history when filters change significantly
	useEffect(() => {
		const timer = setTimeout(() => {
			if (filters.search || filters.location || filters.type) {
				saveRecentSearch(filters)
			}
		}, 3000)
		return () => clearTimeout(timer)
	}, [filters.search, filters.type, filters.location, saveRecentSearch, filters])

	const loadJobs = useCallback(async () => {
		setLoading(true)
		try {
			const params = new URLSearchParams()
			params.set('limit', '200')
			if (filters.search) params.set('search', filters.search)
			if (filters.type) params.set('type', filters.type)
			if (filters.location) params.set('location', filters.location)
			if (filters.remoteType) params.set('remote_type', filters.remoteType)
			if (filters.experienceLevel) params.set('experience_level', filters.experienceLevel)
			if (filters.salaryMin > 0) params.set('salary_min', String(filters.salaryMin))
			if (filters.salaryMax < 300000) params.set('salary_max', String(filters.salaryMax))
			if (filters.companySize) params.set('company_size', filters.companySize)
			if (filters.skills.length) params.set('skills', filters.skills.join(','))
			if (filters.sortBy !== 'match') params.set('sort_by', filters.sortBy)

			const queryString = params.toString()
			const url = queryString ? `/candidate/jobs?${queryString}` : '/candidate/jobs?limit=200'

			// Primary call — render jobs immediately, do NOT block on recommended
			const primaryRes = await apiCall<{ data: Job[]; pagination: { total: number } }>(url)
			const allJobs = primaryRes?.data || []
			setJobs(allJobs)
			setLoading(false)

			// Fetch fit scores for all visible jobs — non-blocking enrichment
			if (allJobs.length > 0) {
				setFitScoresLoading(true)
				const jobIds = allJobs.map((j) => j.id)
				getFitScores(jobIds)
					.then((fitScores) => {
						const fitMap = new Map<number, { fit_score: number; fit_breakdown: Job['fit_breakdown'] }>()
						for (const fs of fitScores) {
							fitMap.set(fs.job_id, {
								fit_score: fs.fit_score,
								fit_breakdown: fs.breakdown,
							})
						}
						setJobs((prev) =>
							prev.map((j) => {
								const fit = fitMap.get(j.id)
								return fit ? { ...j, fit_score: fit.fit_score, fit_breakdown: fit.fit_breakdown } : j
							}),
						)
					})
					.catch((err) => {
						console.warn('[jobs] Fit scores fetch failed (non-blocking):', err)
					})
					.finally(() => setFitScoresLoading(false))
			}

			// Recommended call — best-effort background enrichment
			try {
				const recRes = await apiCall<{ recommended_jobs: Job[] }>('/candidate/jobs/recommended')
				const recJobs = recRes?.recommended_jobs || []

				const recMap = new Map<number, Job>()
				for (const rj of recJobs) recMap.set(rj.job_id ?? rj.id, rj)

				setJobs((prev) =>
					prev.map((j) => {
						const rec = recMap.get(j.id)
						return rec ? { ...j, ...rec } : j
					}),
				)
				setRecommendedJobs(recJobs.slice(0, 5))
			} catch (recErr) {
				console.warn('[jobs] Recommended jobs fetch failed (non-blocking):', recErr)
			}
		} catch (err) {
			console.error('[jobs] Failed to load jobs:', err)
			setLoading(false)
		}
	}, [filters])

	const loadSavedJobs = useCallback(async () => {
		try {
			const data = await apiCall<{ saved_jobs: SavedJob[] }>('/candidate/saved-jobs')
			if (data.saved_jobs) {
				setSavedJobIds(new Set(data.saved_jobs.map((sj) => sj.job_id)))
			}
		} catch (err) { console.error("[jobs] Operation failed:", err); }
	}, [])

	const loadLikedJobs = useCallback(async () => {
		try {
			const liked = (await getLikedJobs()) as unknown as Job[]
			setLikedJobIds(
				new Set(liked.map((j) => j.id ?? j.job_id).filter((id): id is number => id !== undefined)),
			)
			setLikedJobsData(liked)
		} catch (err) { console.error("[jobs] Operation failed:", err); }
	}, [])

	const loadDismissedJobs = useCallback(async () => {
		try {
			const dismissed = (await getDismissedJobs()) as unknown as Job[]
			setDismissedJobIds(
				new Set(
					dismissed.map((j) => j.id ?? j.job_id).filter((id): id is number => id !== undefined),
				),
			)
			setDismissedJobsData(dismissed)
		} catch (err) { console.error("[jobs] Operation failed:", err); }
	}, [])

	const loadUserSkills = useCallback(async () => {
		try {
			const data = await apiCall<{ profile: { skills: Array<{ skill_name: string }> } }>('/candidate/profile')
			const skills = data.profile?.skills?.map((s) => s.skill_name) || []
			setUserSkills(skills)
		} catch (err) { console.error("[jobs] Failed to load user skills:", err); }
	}, [])

	useEffect(() => {
		loadJobs()
		if (user) {
			loadSavedJobs()
			loadLikedJobs()
			loadDismissedJobs()
			loadUserSkills()
		}
	}, [user, loadJobs, loadSavedJobs, loadLikedJobs, loadDismissedJobs, loadUserSkills])

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
				await apiCall('/candidate/saved-jobs', { method: 'POST', body: { job_id: jobId } })
				setSavedJobIds((prev) => new Set(prev).add(jobId))
			}
		} catch (err) { console.error("[jobs] Operation failed:", err); }
	}

	async function toggleLikeJob(jobId: number, e: React.MouseEvent) {
		e.preventDefault()
		e.stopPropagation()
		try {
			if (likedJobIds.has(jobId)) {
				await unlikeJob(jobId)
				setLikedJobIds((prev) => {
					const next = new Set(prev)
					next.delete(jobId)
					return next
				})
				setLikedJobsData((prev) => prev.filter((j) => j.id !== jobId))
			} else {
				await likeJob(jobId)
				setLikedJobIds((prev) => new Set(prev).add(jobId))
				const job = jobs.find((j) => j.id === jobId)
				if (job) setLikedJobsData((prev) => [job, ...prev])
				if (dismissedJobIds.has(jobId)) {
					setDismissedJobIds((prev) => {
						const next = new Set(prev)
						next.delete(jobId)
						return next
					})
					setDismissedJobsData((prev) => prev.filter((j) => j.id !== jobId))
				}
			}
		} catch (err) { console.error("[jobs] Operation failed:", err); }
	}

	async function toggleDismissJob(jobId: number, e: React.MouseEvent) {
		e.preventDefault()
		e.stopPropagation()
		try {
			if (dismissedJobIds.has(jobId)) {
				await restoreJob(jobId)
				setDismissedJobIds((prev) => {
					const next = new Set(prev)
					next.delete(jobId)
					return next
				})
				setDismissedJobsData((prev) => prev.filter((j) => j.id !== jobId))
			} else {
				await dismissJob(jobId)
				setDismissedJobIds((prev) => new Set(prev).add(jobId))
				const job = jobs.find((j) => j.id === jobId)
				if (job) setDismissedJobsData((prev) => [job, ...prev])
				if (likedJobIds.has(jobId)) {
					setLikedJobIds((prev) => {
						const next = new Set(prev)
						next.delete(jobId)
						return next
					})
					setLikedJobsData((prev) => prev.filter((j) => j.id !== jobId))
				}
				if (savedJobIds.has(jobId)) {
					setSavedJobIds((prev) => {
						const next = new Set(prev)
						next.delete(jobId)
						return next
					})
				}
			}
		} catch (err) { console.error("[jobs] Operation failed:", err); }
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

	const handleSkillClick = useCallback((skill: string) => {
		setSearchParams({ skill })
		setFilters((prev) => ({ ...prev, search: skill }))
		setPage(1)
	}, [setSearchParams])

	const clearSkillFilter = useCallback(() => {
		setSearchParams({})
		setFilters((prev) => ({ ...prev, search: '' }))
		setPage(1)
	}, [setSearchParams])

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
		if (filters.remoteOnly) count++
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
			const matchRemoteOnly = !filters.remoteOnly || j.remote_type === 'remote'
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
				matchRemoteOnly &&
				matchExp &&
				matchSalary &&
				matchSkills
			)
		})
		.sort((a, b) => {
			if (filters.sortBy === 'match') {
				// Prefer fit_score, fallback to weighted_score
				const sa = b.fit_score ?? b.weighted_score ?? 0
				const sb = a.fit_score ?? a.weighted_score ?? 0
				if (sa !== sb) return sa - sb
			}
			if (filters.sortBy === 'newest')
				return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
			if (filters.sortBy === 'salary_high') return (b.salary_max ?? 0) - (a.salary_max ?? 0)
			if (filters.sortBy === 'salary_low')
				return (a.salary_min ?? Infinity) - (b.salary_min ?? Infinity)
			return 0
		})

	const savedJobs = jobs.filter((j) => savedJobIds.has(j.id))

	const tabJobs =
		activeTab === 'liked'
			? likedJobsData
			: activeTab === 'dismissed'
				? dismissedJobsData
				: aiResults || filtered

	const displayed = tabJobs.slice(0, page * PAGE_SIZE)
	const hasMoreResults = tabJobs.length > page * PAGE_SIZE

	return (
		<div className='min-h-[calc(100dvh-4rem)] flex flex-col overflow-hidden'>
			<SEO
				title='Find Your Next Job — AI-Powered Job Matching'
				description='Browse thousands of AI-matched jobs on Rekrut AI. Filter by location, salary, remote work, and more. Get personalized job recommendations based on your skills.'
				canonical='/candidate/jobs'
			/>

			{/* === HERO SEARCH BAR === */}
			<div className='shrink-0 bg-gradient-to-br from-indigo-600 via-indigo-500 to-purple-600 px-4 py-6 sm:py-8'>
				<div className='max-w-4xl mx-auto'>
					<div className='flex items-center justify-between mb-4 gap-2'>
						<div className='min-w-0'>
							<h1 className='text-white text-xl sm:text-2xl font-bold flex items-center gap-2'>
								<Briefcase className='h-5 w-5 shrink-0' />
								<span className='break-words'>Find Your Next Opportunity</span>
							</h1>
							<p className='text-indigo-100 text-sm mt-1'>
								{aiResults
									? `${aiResults.length} AI-matched results`
									: `${filtered.length} active jobs`}
								{fitScoresLoading && (
										<span className='inline-flex items-center gap-1 ml-2'>
											<Loader2 className='h-3 w-3 animate-spin' />
											<span className='text-[10px]'>calculating fit…</span>
										</span>
									)}
							</p>
						</div>
						<div className='flex items-center gap-2 shrink-0'>
							{savedJobs.length > 0 && (
								<Button
									variant='outline'
									size='sm'
									className='bg-white/10 border-white/20 text-white hover:bg-white/20 gap-1.5 min-h-[44px] min-w-[44px]'
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
								className='bg-white/10 border-white/20 text-white hover:bg-white/20 gap-1.5 min-h-[44px] min-w-[44px]'
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
										className='pl-10 bg-white/95 border-0 text-foreground h-11 shadow-lg text-base sm:text-sm'
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
									<CheckCircle2 className='h-3 w-3 text-green-300 shrink-0' />
									<span className='break-words'>
										AI found {aiResults.length} matching jobs for "{aiSearchQuery}"
									</span>
									<button className='underline ml-1 hover:text-white shrink-0' onClick={clearAiSearch}>
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
									onChange={(e) => {
										const value = e.target.value
										setSearch('search', value)
										if (!value) {
											setSearchParams({})
										}
									}}
									className='pl-10 bg-white/95 border-0 text-foreground h-11 shadow-lg text-base sm:text-sm'
								/>
							</div>
							<div className='relative sm:w-48'>
								<MapPin className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
								<Input
									placeholder='Location...'
									value={filters.location}
									onChange={(e) => setSearch('location', e.target.value)}
									className='pl-10 bg-white/95 border-0 text-foreground h-11 shadow-lg text-base sm:text-sm'
								/>
							</div>
							<Button
								className='bg-white text-indigo-600 hover:bg-white/90 h-11 px-6 font-semibold shadow-lg gap-2 min-h-[44px] hidden sm:flex'
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
						<div className='flex items-center gap-2 mt-3 overflow-x-auto scrollbar-hide pb-1'>
							<History className='h-3.5 w-3.5 text-indigo-200 shrink-0' />
							<span className='text-xs text-indigo-200 shrink-0'>Recent:</span>
							{recentSearches.slice(0, 3).map((rs, i) => (
								<button
									key={rs.query || `rs-${i}`}
									onClick={() => setFilters(rs.filters)}
									className='text-xs text-white/80 hover:text-white bg-white/10 rounded-full px-2.5 py-1.5 transition-colors whitespace-nowrap flex items-center gap-1 min-h-[44px]'
								>
									<Clock className='h-3 w-3 shrink-0' />
									{rs.query}
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			{/* === MAIN CONTENT === */}
			<div className='flex-1 flex overflow-hidden'>
				{/* Left: Job List */}
				<div className='flex-1 flex flex-col overflow-hidden min-w-0'>
					{/* Toolbar with tabs */}
					<div className='shrink-0 flex items-center justify-between px-4 py-2 border-b bg-background gap-2'>
						<div className='flex items-center gap-1 overflow-x-auto scrollbar-hide min-h-[44px]'>
							<button
								onClick={() => setActiveTab('all')}
								className={cn(
									'px-3 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 min-h-[44px] whitespace-nowrap',
									activeTab === 'all'
										? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
										: 'text-muted-foreground hover:bg-muted',
								)}
							>
								<Briefcase className='h-3.5 w-3.5' />
								All
								<Badge variant='secondary' className='text-[10px] px-1.5 py-0 ml-0.5'>
									{filtered.length}
								</Badge>
							</button>
							<button
								onClick={() => setActiveTab('liked')}
								className={cn(
									'px-3 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 min-h-[44px] whitespace-nowrap',
									activeTab === 'liked'
										? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
										: 'text-muted-foreground hover:bg-muted',
								)}
							>
								<ThumbsUp className='h-3.5 w-3.5' />
								Liked
								{likedJobIds.size > 0 && (
									<Badge variant='secondary' className='text-[10px] px-1.5 py-0 ml-0.5'>
										{likedJobIds.size}
									</Badge>
									)}
							</button>
							<button
								onClick={() => setActiveTab('dismissed')}
								className={cn(
									'px-3 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 min-h-[44px] whitespace-nowrap',
									activeTab === 'dismissed'
										? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
										: 'text-muted-foreground hover:bg-muted',
								)}
							>
								<X className='h-3.5 w-3.5' />
								Trash
								{dismissedJobIds.size > 0 && (
									<Badge variant='secondary' className='text-[10px] px-1.5 py-0 ml-0.5'>
										{dismissedJobIds.size}
									</Badge>
									)}
							</button>
							{activeFilterCount > 0 && (
								<button
									onClick={clearAllFilters}
									className='text-xs text-primary hover:underline flex items-center gap-1 ml-2 min-h-[44px] px-2 shrink-0'
								>
									<X className='h-3 w-3' /> Clear all
								</button>
							)}
							{searchParams.get('skill') && (
								<div className='flex items-center gap-1.5 ml-2 shrink-0'>
									<Badge className='bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 px-2.5 py-1 text-xs font-medium gap-1.5'>
										<span>Skill: {searchParams.get('skill')}</span>
										<button
											onClick={clearSkillFilter}
											className='inline-flex items-center justify-center rounded-full hover:bg-indigo-200 dark:hover:bg-indigo-800/50 p-0.5 transition-colors'
											aria-label='Clear skill filter'
										>
											<X className='h-3 w-3' />
										</button>
									</Badge>
								</div>
							)}
						</div>
						<div className='flex items-center gap-2 shrink-0'>
							<select
								value={filters.sortBy}
								onChange={(e) => setSearch('sortBy', e.target.value)}
								className='text-xs bg-transparent border rounded px-2 py-1.5 h-9'
							>
								<option value='match'>Best Match</option>
								<option value='newest'>Newest</option>
								<option value='salary_high'>Salary: High-Low</option>
								<option value='salary_low'>Salary: Low-High</option>
							</select>
						</div>
					</div>

					{/* Desktop Filter Bar (horizontal) */}
					<JobFilterBar
						filters={filters}
						jobTypes={jobTypes}
						allSkills={allSkills}
						activeFilterCount={activeFilterCount}
						onFilterChange={setSearch}
						onToggleSkill={toggleSkill}
						onClearAll={clearAllFilters}
					/>

					{/* Job List */}
					<div ref={jobListRef} data-job-list className='flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-3'>
						{loading ? (
							<div className='flex items-center justify-center py-16'>
								<div className='h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent' />
							</div>
						) : displayed.length === 0 ? (
							<div className='py-16 text-center px-4'>
								{activeTab === 'liked' ? (
									<EmptyState
										icon={<ThumbsUp className='h-12 w-12 text-indigo-300' />}
										title='No liked jobs yet'
										description='Like jobs to save them here for quick access'
									/>
								) : activeTab === 'dismissed' ? (
									<EmptyState
										icon={<X className='h-12 w-12 text-indigo-300' />}
										title='Trash is empty'
										description='Dismissed jobs will appear here. You can restore them anytime.'
									/>
								) : (
									<EmptyState
										icon={<Search className='h-12 w-12 text-indigo-300' />}
										title='No jobs match your filters'
										description='Try adjusting your filters or search terms to find more opportunities'
										action={
											<Button
												variant='outline'
												className='mt-4 gap-2 min-h-[44px]'
												onClick={clearAllFilters}
											>
												<RotateCcw className='h-4 w-4' /> Clear Filters
											</Button>
										}
									/>
								)}
							</div>
						) : (
							<>
								{/* Recommended banner at top of results when not searching */}
								{!filters.search &&
									!filters.location &&
									!aiResults &&
									recommendedJobs.length > 0 && (
										<div className='flex items-center gap-2 mb-1'>
											<Sparkles className='h-4 w-4 text-amber-500 shrink-0' />
											<span className='text-xs font-medium text-amber-600'>
												Recommended for you
											</span>
											<Separator className='flex-1' />
										</div>
									)}

								{displayed.map((job) => (
									<JobCard
										key={job.id}
										job={job}
										isSelected={selectedJob?.id === job.id}
										isSaved={savedJobIds.has(job.id)}
										isLiked={likedJobIds.has(job.id)}
										isDismissed={dismissedJobIds.has(job.id)}
										activeTab={activeTab}
										onSelect={(j) => {
											setSelectedJob(j)
											setShowDetailPanel(true)
										}}
										onToggleSave={toggleSaveJob}
										onToggleLike={toggleLikeJob}
										onToggleDismiss={toggleDismissJob}
										userSkills={userSkills}
										onSkillClick={handleSkillClick}
										onAutoApply={handleAutoApply}
										autoApplyLoading={autoApplyLoadingId === job.id}
										autoApplyState={getAutoApplyState()}
									/>
								))}

								{/* Load more / Pagination */}
								{hasMoreResults && (
									<div className='flex justify-center py-4'>
										<Button
											variant='outline'
											onClick={() => setPage((p) => p + 1)}
											className='gap-2 min-h-[44px]'
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

				{/* Job Detail Drawer (all viewports) */}
				<JobDetailDrawer
					job={selectedJob}
					open={showDetailPanel && selectedJob != null}
					onOpenChange={(open) => {
						setShowDetailPanel(open)
						if (!open) setSelectedJob(null)
					}}
					isSaved={selectedJob ? savedJobIds.has(selectedJob.id) : false}
					onToggleSave={(e) => {
						if (selectedJob) toggleSaveJob(selectedJob.id, e)
					}}
					onApply={() => {
						if (selectedJob) navigate(`/candidate/jobs/${selectedJob.id}?apply=true`)
					}}
					onViewFullPage={() => {
						if (selectedJob) navigate(`/candidate/jobs/${selectedJob.id}`)
					}}
					onSkillClick={handleSkillClick}
				/>
			</div>

			{/* Toast */}
			{toastMessage && (
				<div className='fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-foreground text-background px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium animate-in fade-in slide-in-from-bottom-2'>
					{toastMessage}
				</div>
			)}
		</div>
	)
}

// === Empty State Component ===
function EmptyState({
	icon,
	title,
	description,
	action,
}: {
	icon: React.ReactNode
	title: string
	description: string
	action?: React.ReactNode
}) {
	return (
		<div className='flex flex-col items-center justify-center py-12'>
			<div className='rounded-full bg-indigo-50 dark:bg-indigo-900/20 p-4 mb-4'>
				{icon}
			</div>
			<p className='text-foreground font-semibold text-base'>{title}</p>
			<p className='text-sm text-muted-foreground mt-1 max-w-xs text-center'>{description}</p>
			{action}
		</div>
	)
}
