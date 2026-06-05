import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { CandidateCard } from "@/components/domain/candidate-card"
import { FilterBar } from "@/components/domain/filter-bar"
import { EmptyState } from "@/components/domain/empty-state"
import { Skeleton } from "@/components/domain/skeleton"
import { ChartCard } from "@/components/domain/chart-card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { apiCall } from "@/lib/api"
import { trackEvent } from "@/lib/analytics"
import {
  Users,
  Search,
  UserCheck,
  MessageSquare,
  Calendar,
  Bookmark,
  Download,
  Mail,
  Phone,
  SlidersHorizontal,
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
}

export type PipelineStats = {
  total: number
  new: number
  screening: number
  interview: number
  offer: number
  hired: number
  rejected: number
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
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [stats, setStats] = useState<PipelineStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({})
  const [selectedTab, setSelectedTab] = useState("all")
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function loadCandidates() {
      setLoading(true)
      try {
        const [candidatesData, statsData] = await Promise.all([
          apiCall<{ candidates: Candidate[] }>("/recruiter/candidates"),
          apiCall<PipelineStats>("/recruiter/pipeline-stats"),
        ])
        setCandidates(candidatesData.candidates || [])
        setStats(statsData)
      } catch (err) {
        console.error("Failed to load candidates:", err)
        // Fallback: empty state will show
      } finally {
        setLoading(false)
      }
    }
    loadCandidates()
  }, [])

  // Filter candidates
  const filteredCandidates = candidates.filter((c) => {
    // Search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const matchesSearch =
        c.name.toLowerCase().includes(q) ||
        c.headline?.toLowerCase().includes(q) ||
        c.skills.some((s) => s.toLowerCase().includes(q)) ||
        c.location?.toLowerCase().includes(q)
      if (!matchesSearch) return false
    }

    // Status filter
    if (activeFilters.status && c.applicationStatus !== activeFilters.status) return false

    // Tab filter
    if (selectedTab !== "all" && c.applicationStatus !== selectedTab) return false

    // Experience filter
    if (activeFilters.experience && c.experienceYears != null) {
      const range = activeFilters.experience
      if (range === "0-2" && c.experienceYears > 2) return false
      if (range === "3-5" && (c.experienceYears < 3 || c.experienceYears > 5)) return false
      if (range === "6-10" && (c.experienceYears < 6 || c.experienceYears > 10)) return false
      if (range === "10+" && c.experienceYears < 10) return false
    }

    // Location filter
    if (activeFilters.location && !c.location?.toLowerCase().includes(activeFilters.location)) return false

    // Match score filter
    if (activeFilters.matchScore && c.matchScore != null) {
      const range = activeFilters.matchScore
      if (range === "90-100" && c.matchScore < 90) return false
      if (range === "80-89" && (c.matchScore < 80 || c.matchScore >= 90)) return false
      if (range === "70-79" && (c.matchScore < 70 || c.matchScore >= 80)) return false
      if (range === "below-70" && c.matchScore >= 70) return false
    }

    return true
  })

  const handleFilterChange = (id: string, value: string | string[]) => {
    setActiveFilters((prev) => ({ ...prev, [id]: value as string }))
    trackEvent("candidate_filter_change", { filter_id: id, value })
  }

  const handleClearFilters = () => {
    setActiveFilters({})
    setSearchQuery("")
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
    // TODO: API call to shortlist
  }

  const handleExport = () => {
    trackEvent("candidates_export")
    // TODO: CSV export
  }

  const tabCounts = {
    all: candidates.length,
    applied: candidates.filter((c) => c.applicationStatus === "applied").length,
    screening: candidates.filter((c) => c.applicationStatus === "screening").length,
    interview: candidates.filter((c) => c.applicationStatus === "interview").length,
    offer: candidates.filter((c) => c.applicationStatus === "offer").length,
  }

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
            <Button size="sm" className="gap-1" onClick={() => navigate("/recruiter/jobs")}>
              <Users className="h-4 w-4" />
              Post a Job
            </Button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <ChartCard
              title="Total Candidates"
              value={stats.total}
              icon={<Users className="h-4 w-4" />}
            />
            <ChartCard
              title="New Applications"
              value={stats.new}
              trend="up"
              trendValue="+12%"
              icon={<Search className="h-4 w-4" />}
            />
            <ChartCard
              title="In Screening"
              value={stats.screening}
              icon={<SlidersHorizontal className="h-4 w-4" />}
            />
            <ChartCard
              title="Interviews"
              value={stats.interview}
              icon={<Calendar className="h-4 w-4" />}
            />
            <ChartCard
              title="Hired"
              value={stats.hired}
              trend="up"
              trendValue="+5%"
              icon={<UserCheck className="h-4 w-4" />}
            />
          </div>
        )}

        {/* Filters */}
        <FilterBar
          searchPlaceholder="Search by name, skill, or location..."
          onSearch={setSearchQuery}
          filters={filterOptions}
          activeFilters={activeFilters}
          onFilterChange={handleFilterChange}
          onClearFilters={handleClearFilters}
        />

        {/* Tabs */}
        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="all">
              All
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{tabCounts.all}</Badge>
            </TabsTrigger>
            <TabsTrigger value="applied">
              Applied
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{tabCounts.applied}</Badge>
            </TabsTrigger>
            <TabsTrigger value="screening">
              Screening
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{tabCounts.screening}</Badge>
            </TabsTrigger>
            <TabsTrigger value="interview">
              Interview
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{tabCounts.interview}</Badge>
            </TabsTrigger>
            <TabsTrigger value="offer">
              Offer
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{tabCounts.offer}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value={selectedTab} className="mt-4">
            {loading ? (
              <Skeleton count={4} variant="card" />
            ) : filteredCandidates.length === 0 ? (
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
            ) : (
              <div className="grid gap-4">
                {filteredCandidates.map((candidate) => (
                  <div key={candidate.id} className="relative">
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
                    />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
  )
}
