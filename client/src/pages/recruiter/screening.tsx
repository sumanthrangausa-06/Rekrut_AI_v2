import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/domain/skeleton"
import { EmptyState } from "@/components/domain/empty-state"
import { apiCall } from "@/lib/api"
import { trackEvent } from "@/lib/analytics"
import {
  BrainCircuit,
  Target,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronRight,
  MessageSquare,
  Calendar,
  Star,
  TrendingUp,
  TrendingDown,
  FileText,
  Sparkles,
  UserCheck,
  Ban,
  ArrowRight,
  Loader2,
  Heart,
} from "lucide-react"

export type ScreeningResult = {
  id: string
  candidateId: string
  candidateName: string
  candidateAvatar?: string
  candidateHeadline?: string
  jobId: string
  jobTitle: string
  overallScore: number
  recommendation: "strong_hire" | "hire" | "consider" | "pass" | "strong_pass"
  skillMatch: {
    required: string[]
    matched: string[]
    missing: string[]
    score: number
  }
  experienceMatch: {
    requiredYears: number
    candidateYears: number
    score: number
    gap: string
  }
  cultureFit: {
    score: number
    alignment: string[]
    concerns: string[]
  }
  strengths: string[]
  concerns: string[]
  autoQuestions: string[]
  aiExplanation: string
  generatedAt: string
  status: "pending" | "completed" | "reviewed"
}

const recommendationConfig: Record<string, { color: string; icon: React.ReactNode; label: string; bg: string }> = {
  strong_hire: { color: "text-emerald-600", icon: <Star className="h-4 w-4" />, label: "Strong Hire", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
  hire: { color: "text-green-600", icon: <UserCheck className="h-4 w-4" />, label: "Hire", bg: "bg-green-50 dark:bg-green-900/20" },
  consider: { color: "text-amber-600", icon: <AlertTriangle className="h-4 w-4" />, label: "Consider", bg: "bg-amber-50 dark:bg-amber-900/20" },
  pass: { color: "text-orange-600", icon: <Ban className="h-4 w-4" />, label: "Pass", bg: "bg-orange-50 dark:bg-orange-900/20" },
  strong_pass: { color: "text-red-600", icon: <XCircle className="h-4 w-4" />, label: "Strong Pass", bg: "bg-red-50 dark:bg-red-900/20" },
}

export function RecruiterScreeningPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [screenings, setScreenings] = useState<ScreeningResult[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTab, setSelectedTab] = useState("all")
  const [selectedScreening, setSelectedScreening] = useState<ScreeningResult | null>(null)
  const [runningScreening, setRunningScreening] = useState(false)

  const candidateId = searchParams.get("candidate")
  const jobId = searchParams.get("job")

  useEffect(() => {
    async function loadScreenings() {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (candidateId) params.append("candidateId", candidateId)
        if (jobId) params.append("jobId", jobId)
        const data = await apiCall<{ screenings: ScreeningResult[] }>(`/recruiter/screenings?${params}`)
        setScreenings(data.screenings || [])
      } catch (err) {
        console.error("Failed to load screenings:", err)
      } finally {
        setLoading(false)
      }
    }
    loadScreenings()
  }, [candidateId, jobId])

  const runScreening = async (candidateId: string, jobId: string) => {
    setRunningScreening(true)
    try {
      const data = await apiCall<{ screening: ScreeningResult }>("/recruiter/screenings/run", {
        method: "POST",
        body: { candidateId, jobId },
      })
      setScreenings((prev) => [data.screening, ...prev])
      setSelectedScreening(data.screening)
      trackEvent("screening_run", { candidate_id: candidateId, job_id: jobId, score: data.screening.overallScore })
    } catch (err) {
      console.error("Screening failed:", err)
    } finally {
      setRunningScreening(false)
    }
  }

  const filteredScreenings = screenings.filter((s) => {
    if (selectedTab === "all") return true
    return s.recommendation === selectedTab || s.status === selectedTab
  })

  const tabCounts = {
    all: screenings.length,
    strong_hire: screenings.filter((s) => s.recommendation === "strong_hire").length,
    hire: screenings.filter((s) => s.recommendation === "hire").length,
    consider: screenings.filter((s) => s.recommendation === "consider").length,
    pass: screenings.filter((s) => s.recommendation === "pass" || s.recommendation === "strong_pass").length,
  }

  if (selectedScreening) {
    return <ScreeningDetail screening={selectedScreening} onBack={() => setSelectedScreening(null)} />
  }

  return (
    <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-heading text-2xl font-bold">AI Screener</h1>
            <p className="text-muted-foreground">AI-powered candidate analysis and fit scoring</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/recruiter/candidates")}>
              View Candidates
            </Button>
            <Button size="sm" className="gap-1" onClick={() => runScreening(candidateId || "", jobId || "")} disabled={runningScreening}>
              {runningScreening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Run Screening
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold">{screenings.length}</p>
                  <p className="text-xs text-muted-foreground">Screenings</p>
                </div>
                <BrainCircuit className="h-8 w-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-emerald-600">{tabCounts.strong_hire + tabCounts.hire}</p>
                  <p className="text-xs text-muted-foreground">Recommended</p>
                </div>
                <CheckCircle2 className="h-8 w-8 text-emerald-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-amber-600">{tabCounts.consider}</p>
                  <p className="text-xs text-muted-foreground">Consider</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-amber-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-red-600">{tabCounts.pass}</p>
                  <p className="text-xs text-muted-foreground">Not Fit</p>
                </div>
                <XCircle className="h-8 w-8 text-red-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold">
                    {screenings.length > 0
                      ? Math.round(screenings.reduce((s, c) => s + c.overallScore, 0) / screenings.length)
                      : 0}
                    %
                  </p>
                  <p className="text-xs text-muted-foreground">Avg Score</p>
                </div>
                <Target className="h-8 w-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="all">
              All <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{tabCounts.all}</Badge>
            </TabsTrigger>
            <TabsTrigger value="strong_hire">
              Strong Hire <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{tabCounts.strong_hire}</Badge>
            </TabsTrigger>
            <TabsTrigger value="hire">
              Hire <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{tabCounts.hire}</Badge>
            </TabsTrigger>
            <TabsTrigger value="consider">
              Consider <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{tabCounts.consider}</Badge>
            </TabsTrigger>
            <TabsTrigger value="pass">
              Pass <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{tabCounts.pass}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value={selectedTab} className="mt-4">
            {loading ? (
              <Skeleton count={3} variant="card" />
            ) : filteredScreenings.length === 0 ? (
              <EmptyState
                icon={BrainCircuit}
                title="No screenings yet"
                description="Select a candidate and job to run AI screening"
                action={{ label: "Go to candidates", onClick: () => navigate("/recruiter/candidates") }}
              />
            ) : (
              <div className="grid gap-4">
                {filteredScreenings.map((screening) => {
                  const rec = recommendationConfig[screening.recommendation]
                  return (
                    <Card key={screening.id} className="overflow-hidden cursor-pointer hover:shadow-md transition-all" onClick={() => setSelectedScreening(screening)}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          <Avatar className="h-12 w-12 border">
                            <AvatarImage src={screening.candidateAvatar} alt={screening.candidateName} />
                            <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                              {screening.candidateName.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center justify-between">
                              <div>
                                <h3 className="font-semibold">{screening.candidateName}</h3>
                                <p className="text-sm text-muted-foreground">{screening.candidateHeadline}</p>
                              </div>
                              <Badge className={`${rec.bg} ${rec.color} border-0`}>
                                {rec.icon}
                                <span className="ml-1">{rec.label}</span>
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <span>For: {screening.jobTitle}</span>
                              <span>•</span>
                              <span>{new Date(screening.generatedAt).toLocaleDateString()}</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="flex-1">
                                <div className="flex items-center justify-between text-xs mb-1">
                                  <span>Overall Fit</span>
                                  <span className="font-semibold">{screening.overallScore}%</span>
                                </div>
                                <Progress value={screening.overallScore} className="h-2" />
                              </div>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
  )
}

function ScreeningDetail({ screening, onBack }: { screening: ScreeningResult; onBack: () => void }) {
  const rec = recommendationConfig[screening.recommendation]

  return (
    <div className="space-y-6">
        {/* Breadcrumb */}
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowRight className="h-4 w-4 rotate-180" />
          Back to screenings
        </Button>

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar className="h-16 w-16 border">
            <AvatarImage src={screening.candidateAvatar} alt={screening.candidateName} />
            <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
              {screening.candidateName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-heading text-2xl font-bold">{screening.candidateName}</h1>
              <Badge className={`${rec.bg} ${rec.color} border-0 text-sm px-3 py-1`}>
                {rec.icon}
                <span className="ml-1">{rec.label}</span>
              </Badge>
            </div>
            <p className="text-muted-foreground">{screening.candidateHeadline}</p>
            <p className="text-sm text-muted-foreground mt-1">
              Screening for: <span className="font-medium">{screening.jobTitle}</span>
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="outline" className="gap-1">
              <MessageSquare className="h-4 w-4" />
              Message
            </Button>
            <Button size="sm" className="gap-1">
              <Calendar className="h-4 w-4" />
              Schedule
            </Button>
          </div>
        </div>

        {/* Overall Score */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-6">
              <div className="relative h-24 w-24">
                <svg className="h-full w-full -rotate-90">
                  <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/20" />
                  <circle
                    cx="48" cy="48" r="40" fill="none" stroke={screening.overallScore >= 80 ? "#10b981" : screening.overallScore >= 60 ? "#f59e0b" : "#ef4444"}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 40}
                    strokeDashoffset={2 * Math.PI * 40 * (1 - screening.overallScore / 100)}
                    className="transition-all duration-1000"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-bold">{screening.overallScore}%</span>
                </div>
              </div>
              <div className="flex-1 space-y-2">
                <p className="text-sm text-muted-foreground">AI Explanation</p>
                <p className="text-sm">{screening.aiExplanation}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Detailed breakdown */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Skill Match */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-4 w-4" />
                Skill Match
                <span className="ml-auto text-sm font-normal text-muted-foreground">{screening.skillMatch.score}%</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  Matched ({screening.skillMatch.matched.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {screening.skillMatch.matched.map((skill) => (
                    <Badge key={skill} variant="secondary" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium mb-2 flex items-center gap-1">
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                  Missing ({screening.skillMatch.missing.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {screening.skillMatch.missing.map((skill) => (
                    <Badge key={skill} variant="secondary" className="bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Experience */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Experience
                <span className="ml-auto text-sm font-normal text-muted-foreground">{screening.experienceMatch.score}%</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span>Required</span>
                <span className="font-semibold">{screening.experienceMatch.requiredYears} years</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Candidate</span>
                <span className="font-semibold">{screening.experienceMatch.candidateYears} years</span>
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Gap Analysis</p>
                <p className="text-sm text-muted-foreground">{screening.experienceMatch.gap}</p>
              </div>
            </CardContent>
          </Card>

          {/* Culture Fit */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Heart className="h-4 w-4" />
                Culture Fit
                <span className="ml-auto text-sm font-normal text-muted-foreground">{screening.cultureFit.score}%</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2 flex items-center gap-1">
                  <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                  Alignment
                </p>
                <ul className="text-sm space-y-1">
                  {screening.cultureFit.alignment.map((item, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-sm font-medium mb-2 flex items-center gap-1">
                  <TrendingDown className="h-3.5 w-3.5 text-amber-500" />
                  Concerns
                </p>
                <ul className="text-sm space-y-1">
                  {screening.cultureFit.concerns.map((item, i) => (
                    <li key={i} className="flex items-start gap-1 text-muted-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Strengths & Concerns */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                AI Assessment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2 text-green-700 dark:text-green-400">Strengths</p>
                <ul className="text-sm space-y-1">
                  {screening.strengths.map((item, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <TrendingUp className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-sm font-medium mb-2 text-amber-700 dark:text-amber-400">Concerns</p>
                <ul className="text-sm space-y-1">
                  {screening.concerns.map((item, i) => (
                    <li key={i} className="flex items-start gap-1 text-muted-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Auto-generated questions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Suggested Interview Questions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {screening.autoQuestions.map((q, i) => (
                <li key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <p className="text-sm">{q}</p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
  )
}

