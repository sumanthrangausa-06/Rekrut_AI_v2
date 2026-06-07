import { useEffect, useState, useCallback } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { CandidateCard } from "@/components/domain/candidate-card"
import { FilterBar } from "@/components/domain/filter-bar"
import { EmptyState } from "@/components/domain/empty-state"
import { Skeleton } from "@/components/domain/skeleton"
import { ChartCard } from "@/components/domain/chart-card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { apiCall } from "@/lib/api"
import { trackEvent } from "@/lib/analytics"
import {
  Users, Search, UserCheck, Download, SlidersHorizontal, Calendar, ChevronLeft, ChevronRight,
  LayoutGrid, List, Filter, Sparkles, Save, Star, Bookmark, Trash2, ArrowRight, CheckSquare,
  Square, Plus, Mail, X, GripVertical, Kanban, BookmarkX, Video, BrainCircuit,
} from "lucide-react"

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
  omniscore?: number
  trustscore?: number
  isTopCandidate?: boolean
  applicationStatus?: "applied" | "screening" | "interview" | "offer" | "hired" | "rejected"
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

const filterOptions = [
  {
    id: "status",
    label: "Status",
    type: "select" as const,
    options: [
      { value: "applied", label: "Applied" },
      { value: "screening", label: "Screening" },
      { value: "interview", label: "Interview" },
      { value: "offer", label: "Offer" },
      { value: "hired", label: "Hired" },
      { value: "rejected", label: "Rejected" },
    ],
  },
  {
    id: "experience",
    label: "Experience",
    type: "select" as const,
    options: [
      { value: "0-2", label: "0-2 years" },
      { value: "3-5", label: "3-5 years" },
      { value: "6-10", label: "6-10 years" },
      { value: "10+", label: "10+ years" },
    ],
  },
  {
    id: "location",
    label: "Location",
    type: "select" as const,
    options: [
      { value: "remote", label: "Remote" },
      { value: "hybrid", label: "Hybrid" },
      { value: "onsite", label: "On-site" },
    ],
  },
  {
    id: "matchScore",
    label: "Match Score",
    type: "select" as const,
    options: [
      { value: "90-100", label: "90-100%" },
      { value: "80-89", label: "80-89%" },
      { value: "70-79", label: "70-79%" },
      { value: "below-70", label: "Below 70%" },
    ],
  },
  {
    id: "salary",
    label: "Salary Range",
    type: "select" as const,
    options: [
      { value: "0-50", label: "$0-50k" },
      { value: "50-100", label: "$50-100k" },
      { value: "100-150", label: "$100-150k" },
      { value: "150+", label: "$150k+" },
    ],
  },
  {
    id: "availability",
    label: "Availability",
    type: "select" as const,
    options: [
      { value: "immediate", label: "Immediate" },
      { value: "2-weeks", label: "2 weeks" },
      { value: "1-month", label: "1 month" },
      { value: "3-months", label: "3+ months" },
    ],
  },
]

const statusColors: Record<string, string> = {
  applied: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  screening: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  interview: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  offer: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  hired: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

const statusLabels: Record<string, string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
}

export function RecruiterCandidatesPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [stats, setStats] = useState<PipelineStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "")
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({})
  const [selectedTab, setSelectedTab] = useState(searchParams.get("status") || "all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list")
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set())
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([])
  const [showSaveSearchDialog, setShowSaveSearchDialog] = useState(false)
  const [saveSearchName, setSaveSearchName] = useState("")
  const [showScreeningDialog, setShowScreeningDialog] = useState(false)
  const [selectedJobForScreening, setSelectedJobForScreening] = useState("")
  const [jobs, setJobs] = useState<Array<{ id: string; title: string }>>([])
  const [isRunningScreening, setIsRunningScreening] = useState(false)
  const [aiScreenerOpen, setAiScreenerOpen] = useState(false)
  const [aiScreenerCandidate, setAiScreenerCandidate] = useState<Candidate | null>(null)
  const limit = 20

  const loadCandidates = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("limit", String(limit))
      if (searchQuery) params.set("search", searchQuery)
      if (selectedTab !== "all") params.set("status", selectedTab)
      if (activeFilters.experience) params.set("experience", activeFilters.experience)
      if (activeFilters.location) params.set("location", activeFilters.location)
      if (activeFilters.matchScore) {
        const score = activeFilters.matchScore
        if (score === "90-100") { params.set("minScore", "90") }
        else if (score === "80-89") { params.set("minScore", "80"); params.set("maxScore", "89") }
        else if (score === "70-79") { params.set("minScore", "70"); params.set("maxScore", "79") }
        else if (score === "below-70") { params.set("maxScore", "69") }
      }
      if (activeFilters.salary) params.set("salary", activeFilters.salary)
      if (activeFilters.availability) params.set("availability", activeFilters.availability)

      const [candidatesData, statsData] = await Promise.all([
        apiCall<{ candidates: Array<any>; pagination: { totalPages: number } }>(
          `/recruiter/candidates/full?${params.toString()}`
        ),
        apiCall<{ stats: PipelineStats }>("/recruiter/pipeline-stats"),
      ])

      if (candidatesData.success) {
        setCandidates(
          candidatesData.candidates.map((c) => ({
            ...c,
            skills: c.skills?.map((s: any) => (typeof s === "string" ? s : s.name)) || [],
          }))
        )
        setTotalPages(candidatesData.pagination?.totalPages || 1)
      }
      if (statsData.success) {
        setStats(statsData.stats)
      }
    } catch (err) {
      console.error("Failed to load candidates:", err)
    } finally {
      setLoading(false)
    }
  }, [page, searchQuery, activeFilters, selectedTab])

  useEffect(() => {
    loadCandidates()
    loadSavedSearches()
    loadJobs()
  }, [loadCandidates])

  useEffect(() => {
    setPage(1)
  }, [searchQuery, activeFilters, selectedTab])

  async function loadSavedSearches() {
    try {
      const data = await apiCall<{ searches: SavedSearch[] }>("/recruiter/saved-searches")
      if (data.searches) setSavedSearches(data.searches)
    } catch {
      // Use mock data if API not available
      setSavedSearches([
        { id: "1", name: "Senior Engineers - Remote", filters: { experience: "6-10", location: "remote" }, searchQuery: "engineer", alertEnabled: true, createdAt: "2026-06-01" },
        { id: "2", name: "High Match - Frontend", filters: { matchScore: "80-89" }, searchQuery: "frontend", alertEnabled: false, createdAt: "2026-05-28" },
      ])
    }
  }

  async function loadJobs() {
    try {
      const data = await apiCall<{ jobs: Array<{ id: number; title: string }> }>("/recruiter/jobs")
      setJobs((data.jobs || []).map(j => ({ id: String(j.id), title: j.title })))
    } catch {
      setJobs([])
    }
  }

  const handleFilterChange = (id: string, value: string | string[]) => {
    setActiveFilters((prev) => ({ ...prev, [id]: value as string }))
    trackEvent("candidate_filter_change", { filter_id: id, value })
  }

  const handleClearFilters = () => {
    setActiveFilters({})
    setSearchQuery("")
    setSelectedTab("all")
    trackEvent("candidate_filters_clear")
  }

  const handleMessage = (id: string) => {
    navigate(`/recruiter/messages?candidate=${id}`)
  }

  const handleSchedule = (id: string) => {
    navigate(`/recruiter/interviews/schedule?candidate=${id}`)
  }

  const handleShortlist = (id: string) => {
    trackEvent("candidate_shortlist", { candidate_id: id })
  }

  const handleExport = () => {
    trackEvent("candidates_export")
  }

  const toggleSelectCandidate = (id: string) => {
    setSelectedCandidates(prev => {
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
      setSelectedCandidates(new Set(candidates.map(c => c.id)))
    }
  }

  const handleBulkMessage = () => {
    const ids = Array.from(selectedCandidates)
    navigate(`/recruiter/messages?candidates=${ids.join(",")}`)
    trackEvent("candidates_bulk_message", { count: ids.length })
  }

  const handleBulkExport = () => {
    const ids = Array.from(selectedCandidates)
    trackEvent("candidates_bulk_export", { count: ids.length })
  }

  const handleSaveSearch = async () => {
    if (!saveSearchName.trim()) return
    try {
      await apiCall("/recruiter/saved-searches", {
        method: "POST",
        body: {
          name: saveSearchName,
          filters: activeFilters,
          searchQuery,
          alertEnabled: true,
        },
      })
      setShowSaveSearchDialog(false)
      setSaveSearchName("")
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
      setSavedSearches(prev => [...prev, newSearch])
      setShowSaveSearchDialog(false)
      setSaveSearchName("")
    }
  }

  const handleLoadSavedSearch = (search: SavedSearch) => {
    setActiveFilters(search.filters)
    setSearchQuery(search.searchQuery)
  }

  const handleDeleteSavedSearch = async (id: string) => {
    try {
      await apiCall(`/recruiter/saved-searches/${id}`, { method: "DELETE" })
      setSavedSearches(prev => prev.filter(s => s.id !== id))
    } catch {
      setSavedSearches(prev => prev.filter(s => s.id !== id))
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
      const data = await apiCall<{ screening: any }>("/recruiter/screenings/run", {
        method: "POST",
        body: { candidateId: aiScreenerCandidate.id, jobId: selectedJobForScreening },
      })
      setIsRunningScreening(false)
      setAiScreenerOpen(false)
      navigate(`/recruiter/screening?candidate=${aiScreenerCandidate.id}&job=${selectedJobForScreening}`)
    } catch {
      setIsRunningScreening(false)
    }
  }

  const tabCounts = {
    all: stats?.total || 0,
    applied: stats?.new || 0,
    screening: stats?.screening || 0,
    interview: stats?.interview || 0,
    offer: stats?.offer || 0,
  }

  const filteredCandidates = candidates

  // Kanban board grouping
  const kanbanColumns = [
    { id: "applied", label: "Applied", color: "border-blue-200", bg: "bg-blue-50/50", badge: "bg-blue-100 text-blue-700" },
    { id: "screening", label: "Screening", color: "border-amber-200", bg: "bg-amber-50/50", badge: "bg-amber-100 text-amber-700" },
    { id: "interview", label: "Interview", color: "border-purple-200", bg: "bg-purple-50/50", badge: "bg-purple-100 text-purple-700" },
    { id: "offer", label: "Offer", color: "border-green-200", bg: "bg-green-50/50", badge: "bg-green-100 text-green-700" },
    { id: "hired", label: "Hired", color: "border-emerald-200", bg: "bg-emerald-50/50", badge: "bg-emerald-100 text-emerald-700" },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Candidates</h1>
          <p className="text-muted-foreground">Manage and review your candidate pipeline</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button size="sm" className="gap-1 bg-indigo-600 hover:bg-indigo-700" onClick={() => navigate("/recruiter/jobs")}>
            <Users className="h-4 w-4" />
            Post a Job
          </Button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <ChartCard title="Total Candidates" value={stats.total} icon={<Users className="h-4 w-4" />} trend="up" trendValue="12%" />
          <ChartCard title="New Applications" value={stats.new} icon={<Search className="h-4 w-4" />} trend="up" trendValue="8%" />
          <ChartCard title="In Screening" value={stats.screening} icon={<SlidersHorizontal className="h-4 w-4" />} trend="neutral" trendValue="0%" />
          <ChartCard title="Interviews" value={stats.interview} icon={<Calendar className="h-4 w-4" />} trend="up" trendValue="15%" />
          <ChartCard title="Hired" value={stats.hired} icon={<UserCheck className="h-4 w-4" />} trend="up" trendValue="5%" />
        </div>
      )}

      {/* Saved Searches */}
      {savedSearches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2"
        >
          <span className="text-xs font-medium text-muted-foreground"
          >Saved Searches:</span>
          {savedSearches.map(search => (
            <div key={search.id} className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs group"
            >
              <button
                onClick={() => handleLoadSavedSearch(search)}
                className="flex items-center gap-1 hover:text-indigo-600 transition-colors"
              >
                <Bookmark className="h-3 w-3" />
                {search.name}
                {search.alertEnabled && <span className="text-amber-500"
                >★</span>}
              </button>
              <button
                onClick={() => handleDeleteSavedSearch(search.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <FilterBar
            searchPlaceholder="Search by name, skill, or location..."
            onSearch={setSearchQuery}
            filters={filterOptions}
            activeFilters={activeFilters}
            onFilterChange={handleFilterChange}
            onClearFilters={handleClearFilters}
            className="flex-1"
          />
          <div className="flex gap-2 shrink-0"
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSaveSearchDialog(true)}
              className="gap-1"
              disabled={Object.keys(activeFilters).length === 0 && !searchQuery}
            >
              <Save className="h-3.5 w-3.5" />
              Save Search
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewMode(viewMode === "list" ? "kanban" : "list")}
              className="gap-1"
            >
              {viewMode === "list" ? <Kanban className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
              {viewMode === "list" ? "Kanban" : "List"}
            </Button>
          </div>
        </div>

        {/* Boolean search hint */}
        <div className="text-xs text-muted-foreground flex items-center gap-1"
        >
          <Filter className="h-3 w-3" />
          Pro tip: Use "AND", "OR", "NOT" for Boolean search. Example: "react AND senior NOT junior"
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedCandidates.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-indigo-50 p-3"
        >
          <div className="flex items-center gap-2"
          >
            <CheckSquare className="h-4 w-4 text-indigo-600" />
            <span className="text-sm font-medium"
            >{selectedCandidates.size} selected</span>
          </div>
          <div className="h-4 w-px bg-indigo-200" />
          <div className="flex gap-2"
          >
            <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={handleBulkMessage}
            >
              <Mail className="h-3 w-3" /> Message
            </Button>
            <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={handleBulkExport}
            >
              <Download className="h-3 w-3" /> Export
            </Button>
            <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={selectAll}
            >
              <Square className="h-3 w-3" /> Select All
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-8 w-8 p-0"
            onClick={() => setSelectedCandidates(new Set())}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}
      >
        <TabsList className="flex-wrap h-auto"
        >
          <TabsTrigger value="all"
          >
            All
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs"
            >{tabCounts.all}</Badge>
          </TabsTrigger>
          <TabsTrigger value="applied"
          >
            Applied
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs"
            >{tabCounts.applied}</Badge>
          </TabsTrigger>
          <TabsTrigger value="screening"
          >
            Screening
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs"
            >{tabCounts.screening}</Badge>
          </TabsTrigger>
          <TabsTrigger value="interview"
          >
            Interview
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs"
            >{tabCounts.interview}</Badge>
          </TabsTrigger>
          <TabsTrigger value="offer"
          >
            Offer
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs"
            >{tabCounts.offer}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={selectedTab} className="mt-4"
        >
          {loading ? (
            <Skeleton count={4} variant="card" />
          ) : candidates.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No candidates found"
              description={
                searchQuery || Object.keys(activeFilters).length > 0
                  ? "Try adjusting your filters or search query"
                  : "Post a job to start receiving applications"
              }
              action={
                searchQuery || Object.keys(activeFilters).length > 0
                  ? { label: "Clear filters", onClick: handleClearFilters }
                  : { label: "Post a job", href: "/recruiter/jobs" }
              }
            />
          ) : viewMode === "list" ? (
            <div className="space-y-4"
            >
              <div className="grid gap-4"
              >
                {candidates.map((candidate) => (
                  <div key={candidate.id} className="relative group"
                  >
                    {/* Selection checkbox */}
                    <div className="absolute top-3 left-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <button
                        onClick={() => toggleSelectCandidate(candidate.id)}
                        className="flex h-5 w-5 items-center justify-center rounded border bg-background shadow-sm hover:border-indigo-400"
                      >
                        {selectedCandidates.has(candidate.id) && <CheckSquare className="h-4 w-4 text-indigo-600" />}
                      </button>
                    </div>

                    {candidate.applicationStatus && (
                      <Badge className={`absolute top-3 right-3 z-10 ${statusColors[candidate.applicationStatus]}`}
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
                      className={selectedCandidates.has(candidate.id) ? "ring-2 ring-indigo-200" : ""}
                    />
                    {/* AI Screener button overlay */}
                    <div className="absolute bottom-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-xs h-7 bg-background border-indigo-200 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:hover:bg-indigo-950"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleAiScreen(candidate)
                        }}
                      >
                        <BrainCircuit className="h-3 w-3" />
                        AI Screen
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2"
                >
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground"
                  >
                    Page {page} of {totalPages}
                  </span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ) : (
            /* Kanban View */
            <div className="flex gap-4 overflow-x-auto pb-2"
            >
              {kanbanColumns.map(column => {
                const columnCandidates = candidates.filter(c => c.applicationStatus === column.id)
                return (
                  <div key={column.id} className={`flex-shrink-0 w-72 rounded-lg border ${column.color} ${column.bg} p-3`}
                  >
                    <div className="flex items-center justify-between mb-3"
                    >
                      <h3 className="text-sm font-semibold"
                      >{column.label}</h3>
                      <Badge className={`text-xs ${column.badge}`}
                      >{columnCandidates.length}</Badge>
                    </div>
                    <div className="space-y-3"
                    >
                      {columnCandidates.map(candidate => (
                        <div
                          key={candidate.id}
                          className="rounded-lg border bg-white p-3 cursor-pointer hover:shadow-md transition-shadow"
                          onClick={() => navigate(`/recruiter/candidates?id=${candidate.id}`)}
                        >
                          <div className="flex items-center gap-2 mb-2"
                          >
                            <Avatar className="h-8 w-8"
                            >
                              <AvatarFallback className="text-xs bg-indigo-100 text-indigo-600"
                              >
                                {candidate.name.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1"
                            >
                              <p className="text-sm font-medium truncate"
                              >{candidate.name}</p>
                              <p className="text-xs text-muted-foreground truncate"
                              >{candidate.headline || candidate.location}</p>
                            </div>
                          </div>
                          {candidate.matchScore && candidate.matchScore > 0 && (
                            <div className="flex items-center gap-2 mb-2"
                            >
                              <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"
                              >
                                <div
                                  className={`h-full rounded-full ${
                                    candidate.matchScore >= 80 ? "bg-green-500" :
                                    candidate.matchScore >= 60 ? "bg-amber-500" : "bg-red-500"
                                  }`}
                                  style={{ width: `${candidate.matchScore}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium"
                              >{candidate.matchScore}%</span>
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1"
                          >
                            {candidate.skills.slice(0, 3).map(skill => (
                              <Badge key={skill} variant="secondary" className="text-[10px]"
                              >{skill}</Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                      {columnCandidates.length === 0 && (
                        <div className="text-center py-6 text-xs text-muted-foreground"
                        >
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
      <Dialog open={showSaveSearchDialog} onOpenChange={setShowSaveSearchDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              Save Search
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2"
          >
            <div>
              <label className="text-sm font-medium"
              >Search Name</label>
              <Input
                value={saveSearchName}
                onChange={e => setSaveSearchName(e.target.value)}
                placeholder="e.g. Senior Engineers - Remote"
                className="mt-1"
              />
            </div>
            <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground"
            >
              <p className="font-medium mb-1"
              >Current filters:</p>
              {searchQuery && <p
              >Search: {searchQuery}</p>}
              {Object.entries(activeFilters).map(([k, v]) => (
                <p key={k}
                >{k}: {v}</p>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveSearchDialog(false)}
            >Cancel</Button>
            <Button onClick={handleSaveSearch} disabled={!saveSearchName.trim()}
            >Save Search</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Screener Dialog */}
      <Dialog open={aiScreenerOpen} onOpenChange={setAiScreenerOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"
            >
              <Sparkles className="h-4 w-4 text-indigo-500" />
              AI Screener
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2"
          >
            <p className="text-sm"
            >
              Run AI screening for <strong>{aiScreenerCandidate?.name}</strong> against a specific job to get fit score, skill analysis, and recommendations.
            </p>
            <div>
              <label className="text-sm font-medium"
              >Select Job</label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedJobForScreening}
                onChange={e => setSelectedJobForScreening(e.target.value)}
              >
                <option value=""
                >Choose a job...</option>
                {jobs.map(job => (
                  <option key={job.id} value={job.id}
                  >{job.title}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiScreenerOpen(false)}
            >Cancel</Button>
            <Button
              onClick={handleRunScreening}
              disabled={!selectedJobForScreening || isRunningScreening}
              className="gap-1"
            >
              {isRunningScreening ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Run AI Screening
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
