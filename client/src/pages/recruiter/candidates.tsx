import {
	Bookmark,
	BrainCircuit,
	Calendar,
	CheckSquare,
	ChevronLeft,
	ChevronRight,
	Clock,
	Download,
	Filter,
	Kanban,
	List,
	Mail,
	MapPin,
	Save,
	Search,
	Send,
	SlidersHorizontal,
	Sparkles,
	Square,
	User,
	UserCheck,
	Users,
	X,
	Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CandidateCard } from '@/components/domain/candidate-card'
import { ChartCard } from '@/components/domain/chart-card'
import { EmptyState } from '@/components/domain/empty-state'
import { FilterBar } from '@/components/domain/filter-bar'
import { Skeleton } from '@/components/domain/skeleton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { trackEvent } from '@/lib/analytics'
import { apiCall } from '@/lib/api'

export type Candidate = {
	id: string
	name: string
	avatar?: string
	headline?: string
	location?: string
	experienceYears?: number
	education?: string
	skills: string[]
	matchScore?: number
	omniScore?: number
	omniscore?: number
	trustscore?: number
	isTopCandidate?: boolean
	applicationStatus?: 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected'
	lastActivity?: string
	email?: string
	phone?: string
	salaryExpectation?: string
	availability?: string
	languages?: string[]
	appliedAt?: string
}

export type PipelineStats = {
	total: number
	new: number
	screening: number
	interview: number
	offer: number
	hired: number
	rejected: number
	topCandidates?: number
	last24h?: number
	last7d?: number
}

export type SavedSearch = {
	id: string
	name: string
	filters: Record<string, string>
	searchQuery: string
	alertEnabled: boolean
	createdAt: string
}

export type ProfilePreviewData = {
	id: string
	name: string
	avatar?: string
	headline?: string
	bio?: string
	location?: string
	experienceYears?: number
	education?: string
	skills: string[]
	matchScore?: number
	omniScore?: number
	trustscore?: number
	email?: string
	phone?: string
	website?: string
	linkedin?: string
	github?: string
	salaryExpectation?: string
	availability?: string
	languages?: string[]
	resumeUrl?: string
	experience?: Array<{
		company: string
		title: string
		duration: string
		description?: string
	}>
	certifications?: string[]
}

const filterOptions = [
	{
		id: 'status',
		label: 'Status',
		type: 'select' as const,
		options: [
			{ value: 'applied', label: 'Applied' },
			{ value: 'screening', label: 'Screening' },
			{ value: 'interview', label: 'Interview' },
			{ value: 'offer', label: 'Offer' },
			{ value: 'hired', label: 'Hired' },
			{ value: 'rejected', label: 'Rejected' },
		],
	},
	{
		id: 'experience',
		label: 'Experience',
		type: 'select' as const,
		options: [
			{ value: '0-2', label: '0-2 years' },
			{ value: '3-5', label: '3-5 years' },
			{ value: '6-10', label: '6-10 years' },
			{ value: '10+', label: '10+ years' },
		],
	},
	{
		id: 'location',
		label: 'Location',
		type: 'select' as const,
		options: [
			{ value: 'remote', label: 'Remote' },
			{ value: 'hybrid', label: 'Hybrid' },
			{ value: 'onsite', label: 'On-site' },
		],
	},
	{
		id: 'matchScore',
		label: 'Match Score',
		type: 'select' as const,
		options: [
			{ value: '90-100', label: '90-100%' },
			{ value: '80-89', label: '80-89%' },
			{ value: '70-79', label: '70-79%' },
			{ value: 'below-70', label: 'Below 70%' },
		],
	},
	{
		id: 'salary',
		label: 'Salary Range',
		type: 'select' as const,
		options: [
			{ value: '0-50', label: '$0-50k' },
			{ value: '50-100', label: '$50-100k' },
			{ value: '100-150', label: '$100-150k' },
			{ value: '150+', label: '$150k+' },
		],
	},
	{
		id: 'availability',
		label: 'Availability',
		type: 'select' as const,
		options: [
			{ value: 'immediate', label: 'Immediate' },
			{ value: '2-weeks', label: '2 weeks' },
			{ value: '1-month', label: '1 month' },
			{ value: '3-months', label: '3+ months' },
		],
	},
]

const statusColors: Record<string, string> = {
	applied: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
	screening: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
	interview: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
	offer: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
	hired: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
	rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const statusLabels: Record<string, string> = {
	applied: 'Applied',
	screening: 'Screening',
	interview: 'Interview',
	offer: 'Offer',
	hired: 'Hired',
	rejected: 'Rejected',
}

function normalizeCandidate(raw: any): Candidate {
	return {
		...raw,
		skills: raw.skills?.map((s: any) => (typeof s === 'string' ? s : s.name)) || [],
		// Map omniScore (API) to omniscore (component prop) for display
		omniscore: raw.omniScore ?? raw.omniscore ?? null,
	}
}

export function RecruiterCandidatesPage() {
	const navigate = useNavigate()
	const [searchParams] = useSearchParams()
	const [candidates, setCandidates] = useState<Candidate[]>([])
	const [stats, setStats] = useState<PipelineStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '')
	const [activeFilters, setActiveFilters] = useState<Record<string, string>>({})
	const [selectedTab, setSelectedTab] = useState(searchParams.get('status') || 'all')
	const [page, setPage] = useState(1)
	const [totalPages, setTotalPages] = useState(1)
	const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list')
	const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set())
	const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([])
	const [showSaveSearchDialog, setShowSaveSearchDialog] = useState(false)
	const [saveSearchName, setSaveSearchName] = useState('')
	const [_showScreeningDialog, _setShowScreeningDialog] = useState(false)
	const [selectedJobForScreening, setSelectedJobForScreening] = useState('')
	const [jobs, setJobs] = useState<Array<{ id: string; title: string }>>([])
	const [isRunningScreening, setIsRunningScreening] = useState(false)
	const [aiScreenerOpen, setAiScreenerOpen] = useState(false)
	const [aiScreenerCandidate, setAiScreenerCandidate] = useState<Candidate | null>(null)
	const [sortBy, setSortBy] = useState<
		'relevance' | 'newest' | 'experience' | 'matchScore' | 'name'
	>('relevance')
	const [recentSearches, setRecentSearches] = useState<string[]>([])

	// ── New state for Issue #3 ──
	const [semanticSearchEnabled, setSemanticSearchEnabled] = useState(false)
	const [profilePreviewOpen, setProfilePreviewOpen] = useState(false)
	const [profilePreviewCandidate, setProfilePreviewCandidate] = useState<Candidate | null>(null)
	const [profilePreviewData, setProfilePreviewData] = useState<ProfilePreviewData | null>(null)
	const [profilePreviewLoading, setProfilePreviewLoading] = useState(false)
	const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
	const [inviteCandidate, setInviteCandidate] = useState<Candidate | null>(null)
	const [selectedJobForInvite, setSelectedJobForInvite] = useState('')
	const [isInviting, setIsInviting] = useState(false)

	const limit = 20

	const buildSearchParams = useCallback(() => {
		const params = new URLSearchParams()
		params.set('page', String(page))
		params.set('limit', String(limit))
		if (searchQuery) params.set('search', searchQuery)
		if (selectedTab !== 'all') params.set('status', selectedTab)
		if (activeFilters.experience) params.set('experience', activeFilters.experience)
		if (activeFilters.location) params.set('location', activeFilters.location)
		if (activeFilters.matchScore) {
			const score = activeFilters.matchScore
			if (score === '90-100') {
				params.set('minScore', '90')
			} else if (score === '80-89') {
				params.set('minScore', '80')
				params.set('maxScore', '89')
			} else if (score === '70-79') {
				params.set('minScore', '70')
				params.set('maxScore', '79')
			} else if (score === 'below-70') {
				params.set('maxScore', '69')
			}
		}
		if (activeFilters.salary) params.set('salary', activeFilters.salary)
		if (activeFilters.availability) params.set('availability', activeFilters.availability)
		return params
	}, [page, searchQuery, activeFilters, selectedTab])

	const loadCandidates = useCallback(async () => {
		setLoading(true)
		try {
			const params = buildSearchParams()

			// Use semantic search endpoint when toggle is on
			const searchEndpoint = semanticSearchEnabled
				? `/candidates/search/semantic?${params.toString()}`
				: `/candidates/search?${params.toString()}`

			const [candidatesData, statsData] = await Promise.all([
				apiCall<{ candidates: Array<any>; pagination: { totalPages: number } }>(searchEndpoint),
				apiCall<{ stats: PipelineStats }>('/recruiter/pipeline-stats'),
			])

			if (candidatesData) {
				const raw =
					candidatesData.candidates ??
					(Array.isArray(candidatesData) ? candidatesData : [])
				setCandidates(raw.map(normalizeCandidate))
				setTotalPages(candidatesData.pagination?.totalPages || 1)
			}
			if (statsData.stats) {
				setStats(statsData.stats)
			}
		} catch (err) {
			console.error('Failed to load candidates:', err)
		} finally {
			setLoading(false)
		}
	}, [buildSearchParams, semanticSearchEnabled])

	const loadJobs = useCallback(async () => {
		try {
			const data = await apiCall<{ jobs: Array<{ id: number; title: string }> }>('/recruiter/jobs')
			setJobs((data.jobs || []).map((j) => ({ id: String(j.id), title: j.title })))
		} catch (err) {
			console.error('[candidates] Failed to load jobs:', err)
			setJobs([])
		}
	}, [])

	const loadSavedSearches = useCallback(async () => {
		try {
			const data = await apiCall<{ searches: SavedSearch[] }>('/candidates/search/saved')
			if (data.searches) setSavedSearches(data.searches)
		} catch (err) {
			console.error('[candidates] Failed to load saved searches:', err)
			setSavedSearches([])
		}
	}, [])

	useEffect(() => {
		loadCandidates()
	}, [loadCandidates])

	useEffect(() => {
		loadSavedSearches()
		loadJobs()
	}, [loadSavedSearches, loadJobs])

	useEffect(() => {
		const stored = localStorage.getItem('recruiter_recent_searches')
		if (stored) {
			try {
				setRecentSearches(JSON.parse(stored))
			} catch {
				/* ignore */
			}
		}
	}, [])

	useEffect(() => {
		if (searchQuery.trim()) {
			setRecentSearches((prev) => {
				const next = [searchQuery.trim(), ...prev.filter((s) => s !== searchQuery.trim())].slice(
					0,
					5,
				)
				localStorage.setItem('recruiter_recent_searches', JSON.stringify(next))
				return next
			})
		}
	}, [searchQuery])

	useEffect(() => {
		setPage(1)
	}, [])

	const handleFilterChange = (id: string, value: string | string[]) => {
		setActiveFilters((prev) => ({ ...prev, [id]: value as string }))
		trackEvent('candidate_filter_change', { filter_id: id, value })
	}

	const handleClearFilters = () => {
		setActiveFilters({})
		setSearchQuery('')
		setSelectedTab('all')
		setSemanticSearchEnabled(false)
		trackEvent('candidate_filters_clear')
	}

	const handleMessage = (id: string) => {
		navigate(`/recruiter/messages?candidate=${id}`)
	}

	const handleSchedule = (id: string) => {
		navigate(`/recruiter/interviews/schedule?candidate=${id}`)
	}

	const handleShortlist = (id: string) => {
		trackEvent('candidate_shortlist', { candidate_id: id })
	}

	const handleExport = () => {
		trackEvent('candidates_export')
	}

	const toggleSelectCandidate = (id: string) => {
		setSelectedCandidates((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	const selectAll = () => {
		if (selectedCandidates.size === candidates.length) {
			setSelectedCandidates(new Set())
		} else {
			setSelectedCandidates(new Set(candidates.map((c) => c.id)))
		}
	}

	const handleBulkMessage = () => {
		const ids = Array.from(selectedCandidates)
		navigate(`/recruiter/messages?candidates=${ids.join(',')}`)
		trackEvent('candidates_bulk_message', { count: ids.length })
	}

	const handleBulkExport = () => {
		const ids = Array.from(selectedCandidates)
		trackEvent('candidates_bulk_export', { count: ids.length })
	}

	const handleBulkStatusChange = async (status: string) => {
		if (!status || selectedCandidates.size === 0) return
		try {
			await apiCall('/recruiter/candidates/bulk-status', {
				method: 'POST',
				body: { candidateIds: Array.from(selectedCandidates), status },
			})
			setSelectedCandidates(new Set())
			loadCandidates()
			alert(`Status updated to ${status} for ${selectedCandidates.size} candidates`)
		} catch (_err) {
			alert('Failed to update status. Please try again.')
		}
	}

	const handleSaveSearch = async () => {
		if (!saveSearchName.trim()) return
		try {
			await apiCall('/candidates/search/save', {
				method: 'POST',
				body: {
					name: saveSearchName,
					filters: activeFilters,
					searchQuery,
					alertEnabled: true,
				},
			})
			setShowSaveSearchDialog(false)
			setSaveSearchName('')
			loadSavedSearches()
		} catch {
			// Fallback: add to local state
			const newSearch: SavedSearch = {
				id: `local_${Date.now()}`,
				name: saveSearchName,
				filters: activeFilters,
				searchQuery,
				alertEnabled: true,
				createdAt: new Date().toISOString(),
			}
			setSavedSearches((prev) => [...prev, newSearch])
			setShowSaveSearchDialog(false)
			setSaveSearchName('')
		}
	}

	const handleLoadSavedSearch = (search: SavedSearch) => {
		setActiveFilters(search.filters)
		setSearchQuery(search.searchQuery)
	}

	const handleDeleteSavedSearch = async (id: string) => {
		try {
			await apiCall(`/candidates/search/saved/${id}`, { method: 'DELETE' })
			setSavedSearches((prev) => prev.filter((s) => s.id !== id))
		} catch {
			setSavedSearches((prev) => prev.filter((s) => s.id !== id))
		}
	}

	const handleAiScreen = (candidate: Candidate) => {
		setAiScreenerCandidate(candidate)
		setAiScreenerOpen(true)
	}

	const handleRunScreening = async () => {
		if (!aiScreenerCandidate || !selectedJobForScreening) return
		setIsRunningScreening(true)
		try {
			const _data = await apiCall<{ screening: any }>('/recruiter/screenings/run', {
				method: 'POST',
				body: { candidateId: aiScreenerCandidate.id, jobId: selectedJobForScreening },
			})
			setIsRunningScreening(false)
			setAiScreenerOpen(false)
			navigate(
				`/recruiter/screening?candidate=${aiScreenerCandidate.id}&job=${selectedJobForScreening}`,
			)
		} catch {
			setIsRunningScreening(false)
		}
	}

	// ── Profile Preview ──
	const handleOpenProfilePreview = async (candidate: Candidate) => {
		setProfilePreviewCandidate(candidate)
		setProfilePreviewOpen(true)
		setProfilePreviewLoading(true)
		try {
			const data = await apiCall<ProfilePreviewData>(`/candidates/${candidate.id}/preview`)
			setProfilePreviewData(data)
		} catch (err) {
			console.error('Failed to load profile preview:', err)
			// Fallback: use candidate data from list
			setProfilePreviewData({
				id: candidate.id,
				name: candidate.name,
				avatar: candidate.avatar,
				headline: candidate.headline,
				location: candidate.location,
				experienceYears: candidate.experienceYears,
				education: candidate.education,
				skills: candidate.skills,
				matchScore: candidate.matchScore,
				omniScore: candidate.omniScore ?? candidate.omniscore,
				trustscore: candidate.trustscore,
				email: candidate.email,
				availability: candidate.availability,
				languages: candidate.languages,
			})
		} finally {
			setProfilePreviewLoading(false)
		}
	}

	// ── Invite to Apply ──
	const handleOpenInvite = (candidateId: string) => {
		const candidate = candidates.find((c) => c.id === candidateId)
		if (candidate) {
			setInviteCandidate(candidate)
			setInviteDialogOpen(true)
			setSelectedJobForInvite('')
		}
	}

	const handleSendInvite = async () => {
		if (!inviteCandidate || !selectedJobForInvite) return
		setIsInviting(true)
		try {
			await apiCall(`/candidates/${inviteCandidate.id}/invite`, {
				method: 'POST',
				body: { jobId: selectedJobForInvite },
			})
			setIsInviting(false)
			setInviteDialogOpen(false)
			setInviteCandidate(null)
			setSelectedJobForInvite('')
			trackEvent('candidate_invite_sent', {
				candidate_id: inviteCandidate.id,
				job_id: selectedJobForInvite,
			})
		} catch (err) {
			console.error('Failed to send invite:', err)
			setIsInviting(false)
			alert('Failed to send invite. Please try again.')
		}
	}

	const tabCounts = {
		all: stats?.total || 0,
		applied: stats?.new || 0,
		screening: stats?.screening || 0,
		interview: stats?.interview || 0,
		offer: stats?.offer || 0,
	}

	const sortedCandidates = [...candidates].sort((a, b) => {
		switch (sortBy) {
			case 'newest':
				return (b.appliedAt || b.lastActivity || '').localeCompare(
					a.appliedAt || a.lastActivity || '',
				)
			case 'experience':
				return (b.experienceYears || 0) - (a.experienceYears || 0)
			case 'matchScore':
				return (b.matchScore || 0) - (a.matchScore || 0)
			case 'name':
				return a.name.localeCompare(b.name)
			default:
				return 0
		}
	})

	// Kanban board grouping
	const kanbanColumns = [
		{
			id: 'applied',
			label: 'Applied',
			color: 'border-blue-200',
			bg: 'bg-blue-50/50',
			badge: 'bg-blue-100 text-blue-700',
		},
		{
			id: 'screening',
			label: 'Screening',
			color: 'border-amber-200',
			bg: 'bg-amber-50/50',
			badge: 'bg-amber-100 text-amber-700',
		},
		{
			id: 'interview',
			label: 'Interview',
			color: 'border-purple-200',
			bg: 'bg-purple-50/50',
			badge: 'bg-purple-100 text-purple-700',
		},
		{
			id: 'offer',
			label: 'Offer',
			color: 'border-green-200',
			bg: 'bg-green-50/50',
			badge: 'bg-green-100 text-green-700',
		},
		{
			id: 'hired',
			label: 'Hired',
			color: 'border-emerald-200',
			bg: 'bg-emerald-50/50',
			badge: 'bg-emerald-100 text-emerald-700',
		},
	]

	return (
		<div className='space-y-6'>
			{/* Header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='font-heading text-2xl font-bold'>Candidates</h1>
					<p className='text-muted-foreground'>Manage and review your candidate pipeline</p>
				</div>
				<div className='flex gap-2'>
					<Button variant='outline' size='sm' onClick={handleExport} className='gap-1 min-h-[44px]'>
						<Download className='h-4 w-4' />
						Export CSV
					</Button>
					<Button
						size='sm'
						className='gap-1 bg-indigo-600 hover:bg-indigo-700 min-h-[44px]'
						onClick={() => navigate('/recruiter/jobs')}
					>
						<Users className='h-4 w-4' />
						Post a Job
					</Button>
				</div>
			</div>

			{/* Stats */}
			{stats && (
				<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
					<ChartCard
						title='Total Candidates'
						value={stats.total}
						icon={<Users className='h-4 w-4' />}
					/>
					<ChartCard
						title='New Applications'
						value={stats.new}
						icon={<Search className='h-4 w-4' />}
					/>
					<ChartCard
						title='In Screening'
						value={stats.screening}
						icon={<SlidersHorizontal className='h-4 w-4' />}
					/>
					<ChartCard
						title='Interviews'
						value={stats.interview}
						icon={<Calendar className='h-4 w-4' />}
					/>
					<ChartCard
						title='Hired'
						value={stats.hired}
						icon={<UserCheck className='h-4 w-4' />}
					/>
				</div>
			)}

			{/* Saved Searches */}
			{savedSearches.length > 0 && (
				<div className='flex flex-wrap items-center gap-2'>
					<span className='text-xs font-medium text-muted-foreground'>Saved Searches:</span>
					{savedSearches.map((search) => (
						<div
							key={search.id}
							className='flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs group'
						>
							<button
								onClick={() => handleLoadSavedSearch(search)}
								className='flex items-center gap-1 hover:text-indigo-600 transition-colors'
							>
								<Bookmark className='h-3 w-3' />
								{search.name}
								{search.alertEnabled && <span className='text-amber-500'>★</span>}
							</button>
							<button
								onClick={() => handleDeleteSavedSearch(search.id)}
								className='opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500'
							>
								<X className='h-3 w-3' />
							</button>
						</div>
					))}
				</div>
			)}

			{/* Filters */}
			<div className='space-y-3'>
				<div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
					<FilterBar
						searchPlaceholder='Search by name, skill, or location...'
						onSearch={setSearchQuery}
						filters={filterOptions}
						activeFilters={activeFilters}
						onFilterChange={handleFilterChange}
						onClearFilters={handleClearFilters}
						className='flex-1'
					/>
					<div className='flex gap-2 shrink-0 flex-wrap'>
						{/* Semantic Search Toggle */}
						<div className='flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 min-h-[44px]'>
							<Switch
								checked={semanticSearchEnabled}
								onCheckedChange={(checked) => {
									setSemanticSearchEnabled(checked)
									setPage(1)
									trackEvent('candidate_semantic_search_toggle', { enabled: checked })
								}}
							/>
							{semanticSearchEnabled ? (
								<span className='flex items-center gap-1 text-sm font-medium text-indigo-600'>
									<Sparkles className='h-3.5 w-3.5' />
									AI Semantic
								</span>
							) : (
								<span className='flex items-center gap-1 text-sm font-medium text-muted-foreground'>
									<BrainCircuit className='h-3.5 w-3.5' />
									AI Semantic
								</span>
							)}
						</div>
						<Button
							variant='outline'
							size='sm'
							onClick={() => setShowSaveSearchDialog(true)}
							className='gap-1 min-h-[44px]'
							disabled={Object.keys(activeFilters).length === 0 && !searchQuery}
						>
							<Save className='h-3.5 w-3.5' />
							Save Search
						</Button>
						<Button
							variant='outline'
							size='sm'
							onClick={() => setViewMode(viewMode === 'list' ? 'kanban' : 'list')}
							className='gap-1 min-h-[44px]'
						>
							{viewMode === 'list' ? (
								<Kanban className='h-3.5 w-3.5' />
							) : (
								<List className='h-3.5 w-3.5' />
							)}
							{viewMode === 'list' ? 'Kanban' : 'List'}
						</Button>
						<div className='relative'>
							<select
								value={sortBy}
								onChange={(e) => setSortBy(e.target.value as any)}
								className='h-11 min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
							>
								<option value='relevance'>Sort: Relevance</option>
								<option value='newest'>Sort: Newest</option>
								<option value='experience'>Sort: Experience</option>
								<option value='matchScore'>Sort: Match Score</option>
								<option value='name'>Sort: Name A-Z</option>
							</select>
						</div>
					</div>
				</div>

				{/* Boolean search hint */}
				<div className='text-xs text-muted-foreground flex items-center gap-1'>
					<Filter className='h-3 w-3' />
					Pro tip: Use "AND", "OR", "NOT" for Boolean search. Example: "react AND senior NOT junior"
				</div>

				{/* Recent Searches */}
				{recentSearches.length > 0 && (
					<div className='flex flex-wrap items-center gap-2'>
						<span className='text-xs font-medium text-muted-foreground flex items-center gap-1'>
							<Clock className='h-3 w-3' />
							Recent:
						</span>
						{recentSearches.map((query) => (
							<button
								key={query}
								onClick={() => setSearchQuery(query)}
								className='rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground hover:bg-indigo-100 hover:text-indigo-700 transition-colors'
							>
								{query}
							</button>
						))}
						<button
							onClick={() => {
								setRecentSearches([])
								localStorage.removeItem('recruiter_recent_searches')
							}}
							className='text-xs text-muted-foreground hover:text-red-500 transition-colors'
						>
							Clear
						</button>
					</div>
				)}

				{/* Results count */}
				{candidates.length > 0 && !loading && (
					<div className='text-xs text-muted-foreground'>
						Showing {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}
						{sortBy !== 'relevance' && (
							<span className='ml-1 text-indigo-600 font-medium'>
								· sorted by{' '}
								{sortBy.replace('matchScore', 'match score').replace('name', 'name A-Z')}
							</span>
						)}
						{semanticSearchEnabled && (
							<span className='ml-1 text-indigo-600 font-medium flex items-center gap-0.5 inline-flex'>
								<Sparkles className='h-3 w-3' />
								AI Semantic Search
							</span>
						)}
					</div>
				)}
			</div>

			{/* Bulk Actions Bar */}
			{selectedCandidates.size > 0 && (
				<div className='flex items-center gap-3 rounded-lg border bg-indigo-50 p-3'>
					<div className='flex items-center gap-2'>
						<CheckSquare className='h-4 w-4 text-indigo-600' />
						<span className='text-sm font-medium'>{selectedCandidates.size} selected</span>
					</div>
					<div className='h-4 w-px bg-indigo-200' />
					<div className='flex gap-2'>
						<Button
							size='sm'
							variant='outline'
							className='gap-1 text-xs h-8 min-h-[44px]'
							onClick={handleBulkMessage}
						>
							<Mail className='h-3 w-3' /> Message
						</Button>
						<Button
							size='sm'
							variant='outline'
							className='gap-1 text-xs h-8 min-h-[44px]'
							onClick={handleBulkExport}
						>
							<Download className='h-3 w-3' /> Export
						</Button>
						<Button
							size='sm'
							variant='outline'
							className='gap-1 text-xs h-8 min-h-[44px]'
							onClick={selectAll}
						>
							<Square className='h-3 w-3' /> Select All
						</Button>
						<select
							className='h-8 min-h-[44px] rounded-md border border-input bg-background px-2 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500'
							onChange={(e) => {
								handleBulkStatusChange(e.target.value)
								e.target.selectedIndex = 0
							}}
							defaultValue=''
						>
							<option value='' disabled>
								Change Status
							</option>
							<option value='applied'>Applied</option>
							<option value='screening'>Screening</option>
							<option value='interview'>Interview</option>
							<option value='offer'>Offer</option>
							<option value='hired'>Hired</option>
							<option value='rejected'>Rejected</option>
						</select>
					</div>
					<Button
						size='sm'
						variant='ghost'
						className='ml-auto h-8 w-8 p-0 min-h-[44px] min-w-[44px]'
						onClick={() => setSelectedCandidates(new Set())}
					>
						<X className='h-4 w-4' />
					</Button>
				</div>
			)}

			{/* Tabs */}
			<Tabs value={selectedTab} onValueChange={setSelectedTab}>
				<TabsList className='flex-wrap h-auto'>
					<TabsTrigger value='all'>
						All
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.all}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='applied'>
						Applied
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.applied}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='screening'>
						Screening
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.screening}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='interview'>
						Interview
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.interview}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='offer'>
						Offer
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.offer}
						</Badge>
					</TabsTrigger>
				</TabsList>

				<TabsContent value={selectedTab} className='mt-4'>
					{loading ? (
						<Skeleton count={4} variant='card' />
					) : candidates.length === 0 ? (
						<EmptyState
							icon={Search}
							title='No candidates found'
							description={
								searchQuery || Object.keys(activeFilters).length > 0 || semanticSearchEnabled
									? 'Try adjusting your filters, search query, or turning off AI Semantic Search'
									: 'Post a job to start receiving applications'
							}
							action={
								searchQuery || Object.keys(activeFilters).length > 0 || semanticSearchEnabled
									? { label: 'Clear filters', onClick: handleClearFilters }
									: { label: 'Post a job', href: '/recruiter/jobs' }
							}
							image={UNSPLASH_IMAGES.emptyCandidates}
						/>
					) : viewMode === 'list' ? (
						<div className='space-y-4'>
							<div className='grid gap-4'>
								{sortedCandidates.map((candidate) => (
									<div key={candidate.id} className='relative group'>
										{/* Selection checkbox */}
										<div className='absolute top-3 left-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity'>
											<button
												onClick={() => toggleSelectCandidate(candidate.id)}
												className='flex h-5 w-5 items-center justify-center rounded border bg-background shadow-sm hover:border-indigo-400 min-h-[44px] min-w-[44px]'
											>
												{selectedCandidates.has(candidate.id) && (
													<CheckSquare className='h-4 w-4 text-indigo-600' />
												)}
											</button>
										</div>

										{candidate.applicationStatus && (
											<Badge
												className={`absolute top-3 right-3 z-10 ${statusColors[candidate.applicationStatus]}`}
											>
												{statusLabels[candidate.applicationStatus]}
											</Badge>
										)}
										<CandidateCard
											id={candidate.id}
											name={candidate.name}
											avatar={candidate.avatar}
											headline={candidate.headline}
											location={candidate.location}
											experienceYears={candidate.experienceYears}
											education={candidate.education}
											skills={candidate.skills}
											matchScore={candidate.matchScore}
											omniscore={candidate.omniscore}
											trustscore={candidate.trustscore}
											isTopCandidate={candidate.isTopCandidate}
											onMessage={handleMessage}
											onSchedule={handleSchedule}
											onShortlist={handleShortlist}
											onInvite={handleOpenInvite}
											onClick={() => handleOpenProfilePreview(candidate)}
											className={
												selectedCandidates.has(candidate.id) ? 'ring-2 ring-indigo-200' : ''
											}
										/>
										{/* AI Screener button overlay */}
										<div className='absolute bottom-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block'>
											<Button
												size='sm'
												variant='outline'
												className='gap-1 text-xs h-7 min-h-[44px] bg-background border-indigo-200 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:hover:bg-indigo-950'
												onClick={(e) => {
													e.stopPropagation()
													handleAiScreen(candidate)
												}}
											>
												<BrainCircuit className='h-3 w-3' />
												AI Screen
											</Button>
										</div>
									</div>
								))}
							</div>

							{/* Pagination */}
							{totalPages > 1 && (
								<div className='flex items-center justify-center gap-2'>
									<Button
										variant='outline'
										size='sm'
										disabled={page <= 1}
										onClick={() => setPage((p) => p - 1)}
										className='min-h-[44px] min-w-[44px]'
									>
										<ChevronLeft className='h-4 w-4' />
									</Button>
									<span className='text-sm text-muted-foreground'>
										Page {page} of {totalPages}
									</span>
									<Button
										variant='outline'
										size='sm'
										disabled={page >= totalPages}
										onClick={() => setPage((p) => p + 1)}
										className='min-h-[44px] min-w-[44px]'
									>
										<ChevronRight className='h-4 w-4' />
									</Button>
								</div>
							)}
						</div>
					) : (
						/* Kanban View */
						<div className='flex gap-4 overflow-x-auto pb-2'>
							{kanbanColumns.map((column) => {
								const columnCandidates = sortedCandidates.filter(
									(c) => c.applicationStatus === column.id,
								)
								return (
									<div
										key={column.id}
										className={`flex-shrink-0 w-72 rounded-lg border ${column.color} ${column.bg} p-3`}
									>
										<div className='flex items-center justify-between mb-3'>
											<h3 className='text-sm font-semibold'>{column.label}</h3>
											<Badge className={`text-xs ${column.badge}`}>{columnCandidates.length}</Badge>
										</div>
										<div className='space-y-3'>
											{columnCandidates.map((candidate) => (
												<div
													key={candidate.id}
													className='rounded-lg border bg-white p-3 cursor-pointer hover:shadow-md transition-shadow'
													onClick={() => handleOpenProfilePreview(candidate)}
												>
													<div className='flex items-center gap-2 mb-2'>
														<Avatar
															className='h-8 w-8'
															seed={candidate.id}
															fallback={candidate.name.slice(0, 2).toUpperCase()}
															useDiceBear={true}
														/>
														<div className='min-w-0 flex-1'>
															<p className='text-sm font-medium truncate'>{candidate.name}</p>
															<p className='text-xs text-muted-foreground truncate'>
																{candidate.headline || candidate.location}
															</p>
														</div>
													</div>
													{candidate.omniscore != null && (
														<div className='flex items-center gap-2 mb-2'>
															<Zap className='h-3 w-3 text-indigo-500' />
															<span className='text-xs font-bold text-indigo-600'>
																OmniScore {candidate.omniscore}
															</span>
														</div>
													)}
													{candidate.matchScore && candidate.matchScore > 0 && (
														<div className='flex items-center gap-2 mb-2'>
															<div className='flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden'>
																<div
																	className={`h-full rounded-full ${
																		candidate.matchScore >= 80
																			? 'bg-green-500'
																			: candidate.matchScore >= 60
																				? 'bg-amber-500'
																				: 'bg-red-500'
																	}`}
																	style={{ width: `${candidate.matchScore}%` }}
																/>
															</div>
															<span className='text-xs font-medium'>{candidate.matchScore}%</span>
														</div>
													)}
													<div className='flex flex-wrap gap-1'>
														{candidate.skills.slice(0, 3).map((skill) => (
															<Badge key={skill} variant='secondary' className='text-[10px]'>
																{skill}
															</Badge>
														))}
													</div>
												</div>
											))}
											{columnCandidates.length === 0 && (
												<div className='text-center py-6 text-xs text-muted-foreground'>
													No candidates in this stage
												</div>
											)}
										</div>
									</div>
								)
							})}
						</div>
					)}
				</TabsContent>
			</Tabs>

			{/* Save Search Dialog */}
			<Dialog open={showSaveSearchDialog} onOpenChange={setShowSaveSearchDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className='flex items-center gap-2'>
							<Save className='h-4 w-4' />
							Save Search
						</DialogTitle>
					</DialogHeader>
					<div className='space-y-4 py-2'>
						<div>
							<Label className='text-sm font-medium'>Search Name</Label>
							<Input
								value={saveSearchName}
								onChange={(e) => setSaveSearchName(e.target.value)}
								placeholder='e.g. Remote Frontend Developers'
								className='mt-1'
							/>
						</div>
						<div className='rounded-lg bg-muted p-3 text-xs text-muted-foreground'>
							<p className='font-medium mb-1'>Current filters:</p>
							{searchQuery && <p>Search: {searchQuery}</p>}
							{semanticSearchEnabled && (
								<p className='text-indigo-600 font-medium'>AI Semantic Search: On</p>
							)}
							{Object.entries(activeFilters).map(([k, v]) => (
								<p key={k}>
									{k}: {v}
								</p>
							))}
						</div>
					</div>
					<DialogFooter>
						<Button variant='outline' onClick={() => setShowSaveSearchDialog(false)}>
							Cancel
						</Button>
						<Button onClick={handleSaveSearch} disabled={!saveSearchName.trim()}>
							Save Search
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* AI Screener Dialog */}
			<Dialog open={aiScreenerOpen} onOpenChange={setAiScreenerOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className='flex items-center gap-2'>
							<Sparkles className='h-4 w-4 text-indigo-500' />
							AI Screener
						</DialogTitle>
					</DialogHeader>
					<div className='space-y-4 py-2'>
						<p className='text-sm'>
							Run AI screening for <strong>{aiScreenerCandidate?.name}</strong> against a specific
							job to get fit score, skill analysis, and recommendations.
						</p>
						<div>
							<Label className='text-sm font-medium'>Select Job</Label>
							<select
								className='mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
								value={selectedJobForScreening}
								onChange={(e) => setSelectedJobForScreening(e.target.value)}
							>
								<option value=''>Choose a job...</option>
								{jobs.map((job) => (
									<option key={job.id} value={job.id}>
										{job.title}
									</option>
								))}
							</select>
						</div>
					</div>
					<DialogFooter>
						<Button variant='outline' onClick={() => setAiScreenerOpen(false)}>
							Cancel
						</Button>
						<Button
							onClick={handleRunScreening}
							disabled={!selectedJobForScreening || isRunningScreening}
							className='gap-1'
						>
							{isRunningScreening ? (
								<>
									<span className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
									Analyzing...
								</>
							) : (
								<>
									<Sparkles className='h-4 w-4' />
									Run AI Screening
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Profile Preview Dialog */}
			<Dialog open={profilePreviewOpen} onOpenChange={setProfilePreviewOpen}>
				<DialogContent className='max-w-2xl'>
					<DialogHeader>
						<DialogTitle className='flex items-center gap-2'>
							<User className='h-4 w-4' />
							Profile Preview
						</DialogTitle>
					</DialogHeader>
					{profilePreviewLoading ? (
						<div className='py-8 space-y-4'>
							<Skeleton count={3} variant='card' />
						</div>
					) : profilePreviewData ? (
						<div className='space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-2'>
							{/* Header */}
							<div className='flex items-start gap-4'>
								<Avatar className='h-16 w-16 border'>
									<AvatarFallback className='bg-indigo-100 text-indigo-600 text-lg font-semibold'>
										{profilePreviewData.name
											.split(' ')
											.map((n) => n[0])
											.join('')
											.toUpperCase()
											.slice(0, 2)}
									</AvatarFallback>
								</Avatar>
								<div className='flex-1 min-w-0'>
									<h3 className='text-lg font-semibold'>{profilePreviewData.name}</h3>
									{profilePreviewData.headline && (
										<p className='text-sm text-muted-foreground'>{profilePreviewData.headline}</p>
									)}
									<div className='flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-muted-foreground'>
										{profilePreviewData.location && (
											<span className='flex items-center gap-1'>
												<MapPin className='h-3.5 w-3.5' />
												{profilePreviewData.location}
											</span>
										)}
										{profilePreviewData.email && (
											<span className='flex items-center gap-1'>
												<Mail className='h-3.5 w-3.5' />
												{profilePreviewData.email}
											</span>
										)}
									</div>
								</div>
								<div className='flex flex-col items-end gap-1 shrink-0'>
									{profilePreviewData.omniScore != null && (
										<div className='inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-sm'>
											<Zap className='h-3 w-3' />
											OmniScore {profilePreviewData.omniScore}
										</div>
									)}
									{profilePreviewData.matchScore != null && (
										<Badge
											variant='secondary'
											className={`text-xs ${
												profilePreviewData.matchScore >= 80
													? 'bg-green-100 text-green-700'
													: profilePreviewData.matchScore >= 60
														? 'bg-amber-100 text-amber-700'
														: 'bg-red-100 text-red-700'
											}`}
										>
											{profilePreviewData.matchScore}% match
										</Badge>
									)}
								</div>
							</div>

							<Separator />

							{/* Bio */}
							{profilePreviewData.bio && (
								<div>
									<Label className='text-sm font-medium'>About</Label>
									<p className='text-sm text-muted-foreground mt-1'>{profilePreviewData.bio}</p>
								</div>
							)}

							{/* Details */}
							<div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
								{profilePreviewData.experienceYears != null && (
									<div>
										<Label className='text-sm font-medium'>Experience</Label>
										<p className='text-sm text-muted-foreground mt-0.5'>
											{profilePreviewData.experienceYears} years
										</p>
									</div>
								)}
								{profilePreviewData.education && (
									<div>
										<Label className='text-sm font-medium'>Education</Label>
										<p className='text-sm text-muted-foreground mt-0.5'>
											{profilePreviewData.education}
										</p>
									</div>
								)}
								{profilePreviewData.salaryExpectation && (
									<div>
										<Label className='text-sm font-medium'>Salary Expectation</Label>
										<p className='text-sm text-muted-foreground mt-0.5'>
											{profilePreviewData.salaryExpectation}
										</p>
									</div>
								)}
								{profilePreviewData.availability && (
									<div>
										<Label className='text-sm font-medium'>Availability</Label>
										<p className='text-sm text-muted-foreground mt-0.5'>
											{profilePreviewData.availability}
										</p>
									</div>
								)}
							</div>

							{/* Skills */}
							{profilePreviewData.skills.length > 0 && (
								<div>
									<Label className='text-sm font-medium'>Skills</Label>
									<div className='flex flex-wrap gap-1.5 mt-1'>
										{profilePreviewData.skills.map((skill) => (
											<Badge key={skill} variant='secondary' className='text-xs'>
												{skill}
											</Badge>
										))}
									</div>
								</div>
							)}

							{/* Languages */}
							{profilePreviewData.languages && profilePreviewData.languages.length > 0 && (
								<div>
									<Label className='text-sm font-medium'>Languages</Label>
									<p className='text-sm text-muted-foreground mt-0.5'>
										{profilePreviewData.languages.join(', ')}
									</p>
								</div>
							)}

							{/* Experience */}
							{profilePreviewData.experience && profilePreviewData.experience.length > 0 && (
								<div>
									<Label className='text-sm font-medium'>Work Experience</Label>
									<div className='space-y-2 mt-1'>
										{profilePreviewData.experience.map((exp, i) => (
											<div key={i} className='rounded-lg bg-muted p-3'>
												<p className='text-sm font-medium'>{exp.title}</p>
												<p className='text-xs text-muted-foreground'>
													{exp.company} · {exp.duration}
												</p>
												{exp.description && (
													<p className='text-xs text-muted-foreground mt-1'>
														{exp.description}
													</p>
												)}
											</div>
										))}
									</div>
								</div>
							)}

							{/* Certifications */}
							{profilePreviewData.certifications &&
								profilePreviewData.certifications.length > 0 && (
									<div>
										<Label className='text-sm font-medium'>Certifications</Label>
										<div className='flex flex-wrap gap-1.5 mt-1'>
											{profilePreviewData.certifications.map((cert) => (
												<Badge
													key={cert}
													variant='outline'
													className='text-xs'
												>
													{cert}
												</Badge>
											))}
										</div>
									</div>
								)}
						</div>
					) : (
						<div className='py-8 text-center text-sm text-muted-foreground'>
							Failed to load profile preview.
						</div>
					)}
					<DialogFooter>
						<Button variant='outline' onClick={() => setProfilePreviewOpen(false)}>
							Close
						</Button>
						{profilePreviewCandidate && (
							<Button
								className='gap-1'
								onClick={() => {
									setProfilePreviewOpen(false)
									handleOpenInvite(profilePreviewCandidate.id)
								}}
							>
								<Send className='h-4 w-4' />
								Invite to Apply
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Invite to Apply Dialog */}
			<Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className='flex items-center gap-2'>
							<Send className='h-4 w-4 text-indigo-500' />
							Invite to Apply
						</DialogTitle>
					</DialogHeader>
					<div className='space-y-4 py-2'>
						<p className='text-sm'>
							Invite <strong>{inviteCandidate?.name}</strong> to apply for a specific job.
						</p>
						<div>
							<Label className='text-sm font-medium'>Select Job</Label>
							<select
								className='mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
								value={selectedJobForInvite}
								onChange={(e) => setSelectedJobForInvite(e.target.value)}
							>
								<option value=''>Choose a job...</option>
								{jobs.map((job) => (
									<option key={job.id} value={job.id}>
										{job.title}
									</option>
								))}
							</select>
						</div>
					</div>
					<DialogFooter>
						<Button variant='outline' onClick={() => setInviteDialogOpen(false)}>
							Cancel
						</Button>
						<Button
							onClick={handleSendInvite}
							disabled={!selectedJobForInvite || isInviting}
							className='gap-1'
						>
							{isInviting ? (
								<>
									<span className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
									Sending...
								</>
							) : (
								<>
									<Send className='h-4 w-4' />
									Send Invite
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
