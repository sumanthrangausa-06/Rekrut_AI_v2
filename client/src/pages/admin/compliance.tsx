import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/domain/skeleton"
import { EmptyState } from "@/components/domain/empty-state"
import { ChartCard } from "@/components/domain/chart-card"
import { apiCall } from "@/lib/api"
import { trackEvent } from "@/lib/analytics"
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  FileText,
  Download,
  Eye,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  BrainCircuit,
  Users,
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  Filter,
  Calendar,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Ban,
  FileCheck,
  ListChecks,
  GitPullRequest,
  Activity,
  BarChart3,
  PieChart,
  FileSpreadsheet,
  ArrowDownToLine,
  History,
  Gauge,
} from "lucide-react"

export type ComplianceDecision = {
  id: string
  timestamp: string
  decisionType: "screening" | "matching" | "interview" | "assessment" | "offer" | "scoring"
  candidateId: string
  candidateName: string
  jobId?: string
  jobTitle?: string
  aiModel: string
  confidence: number
  decision: string
  explanation: string
  humanReviewed: boolean
  humanReviewer?: string
  humanOverride?: boolean
  biasFlags: string[]
  dataRetention: string
  auditHash: string
}

export type BiasReport = {
  id: string
  period: string
  totalDecisions: number
  biasFlagsFound: number
  falsePositiveRate: number
  falseNegativeRate: number
  demographicBreakdown: Array<{
    demographic: string
    total: number
    positiveRate: number
    biasFlag: boolean
  }>
  topConcerns: string[]
  improvements: string[]
}

export type BiasHistoryReport = {
  id: number
  auditDate: string
  auditType: string
  overallFairnessScore: number
  issuesFound: number
  demographicCount: number
  appealCount: number
  createdAt: string
}

export type ModelPerformance = {
  period: number
  volumeOverTime: Array<{ date: string; count: number }>
  modelPerformance: Array<{
    model: string
    decisions: number
    avgConfidence: number
    overrideRate: number
  }>
  scoreDistribution: Array<{ bucket: number; count: number }>
  reviewRate: number
  totalDecisions: number
}

export type RiskClassification = {
  category: string
  level: "high" | "limited" | "minimal"
  description: string
  measures: string[]
  lastReviewed: string
  nextReview: string
}

export type ExplainabilityLog = {
  id: string
  timestamp: string
  actionType: string
  adminUser: { id: number; name: string }
  candidate: { id: number; name: string }
  targetType: string
  explanationType: string
  summary: string
  modelVersion: string
  confidence: number
  viewedFromIp: string
}

export type HumanOverride = {
  id: string
  timestamp: string
  overriddenBy: { id: number; name: string }
  candidate: { id: number; name: string }
  originalDecision: string
  overrideDecision: string
  overrideReason: string
  jobTitle: string
  aiModel: string
  aiConfidence: number
  overrideFromIp: string
}

export type RiskChecklistItem = {
  id: string
  category: string
  item: string
  required: boolean
  status: "complete" | "incomplete" | "pending" | "in_progress"
  evidence: string
  eu_ai_act_ref: string
  lastVerified: string
}

export type RiskChecklistSummary = {
  total: number
  completed: number
  pending: number
  incomplete: number
  inProgress: number
  complianceScore: number
  overallStatus: string
  nextReview: string
}

const decisionTypeConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  screening: { icon: <Shield className="h-4 w-4" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", label: "Screening" },
  matching: { icon: <Users className="h-4 w-4" />, color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", label: "Matching" },
  interview: { icon: <BrainCircuit className="h-4 w-4" />, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", label: "Interview" },
  assessment: { icon: <FileText className="h-4 w-4" />, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", label: "Assessment" },
  offer: { icon: <CheckCircle className="h-4 w-4" />, color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", label: "Offer" },
  scoring: { icon: <TrendingUp className="h-4 w-4" />, color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400", label: "Scoring" },
}

const riskConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  high: { color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: <ShieldAlert className="h-4 w-4" />, label: "High Risk" },
  limited: { color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: <Shield className="h-4 w-4" />, label: "Limited Risk" },
  minimal: { color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: <ShieldCheck className="h-4 w-4" />, label: "Minimal Risk" },
}

export function AdminCompliancePage() {
  const [decisions, setDecisions] = useState<ComplianceDecision[]>([])
  const [biasReport, setBiasReport] = useState<BiasReport | null>(null)
  const [riskClasses, setRiskClasses] = useState<RiskClassification[]>([])
  const [explanations, setExplanations] = useState<ExplainabilityLog[]>([])
  const [overrides, setOverrides] = useState<HumanOverride[]>([])
  const [riskChecklist, setRiskChecklist] = useState<RiskChecklistItem[]>([])
  const [riskChecklistSummary, setRiskChecklistSummary] = useState<RiskChecklistSummary | null>(null)
  const [biasHistory, setBiasHistory] = useState<BiasHistoryReport[]>([])
  const [modelPerformance, setModelPerformance] = useState<ModelPerformance | null>(null)
  const [loading, setLoading] = useState(true)
  const [exportLoading, setExportLoading] = useState(false)
  const [selectedTab, setSelectedTab] = useState("audit")
  const [expandedDecision, setExpandedDecision] = useState<string | null>(null)

  useEffect(() => {
    async function loadCompliance() {
      setLoading(true)
      try {
        const [decisionsData, biasData, riskData, explanationsData, overridesData, checklistData, biasHistoryData, performanceData] = await Promise.all([
          apiCall<{ decisions: ComplianceDecision[] }>("/admin/compliance/decisions"),
          apiCall<{ report: BiasReport }>("/admin/compliance/bias-report").catch(() => ({ report: null })),
          apiCall<{ classifications: RiskClassification[] }>("/admin/compliance/risk-classifications").catch(() => ({ classifications: [] })),
          apiCall<{ explanations: ExplainabilityLog[] }>("/admin/compliance/explanations").catch(() => ({ explanations: [] })),
          apiCall<{ overrides: HumanOverride[]; summary: RiskChecklistSummary }>("/admin/compliance/overrides").catch(() => ({ overrides: [], summary: null })),
          apiCall<{ checklist: RiskChecklistItem[]; summary: RiskChecklistSummary }>("/admin/compliance/risk-checklist").catch(() => ({ checklist: [], summary: null })),
          apiCall<{ reports: BiasHistoryReport[] }>("/admin/compliance/bias-reports").catch(() => ({ reports: [] })),
          apiCall<{ modelPerformance: ModelPerformance }>("/admin/compliance/performance").catch(() => ({ modelPerformance: null })),
        ])
        setDecisions(decisionsData.decisions || [])
        setBiasReport(biasData.report)
        setRiskClasses(riskData.classifications || [])
        setExplanations(explanationsData.explanations || [])
        setOverrides(overridesData.overrides || [])
        setRiskChecklist(checklistData.checklist || [])
        setRiskChecklistSummary(checklistData.summary || null)
        setBiasHistory(biasHistoryData.reports || [])
        setModelPerformance(performanceData.modelPerformance || null)
      } catch (err) {
        console.error("Failed to load compliance data:", err)
      } finally {
        setLoading(false)
      }
    }
    loadCompliance()
  }, [])

  const handleExportCSV = async () => {
    setExportLoading(true)
    trackEvent("compliance_export_csv", { count: decisions.length })
    try {
      const response = await apiCall<Blob>("/admin/compliance/export", {
        method: "POST",
        body: JSON.stringify({ format: "csv" }),
        headers: { "Content-Type": "application/json" },
      })
      const blob = response instanceof Blob ? response : new Blob([response as any], { type: "text/csv" })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `compliance-export-${new Date().toISOString().split("T")[0]}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Export failed:", err)
    } finally {
      setExportLoading(false)
    }
  }

  const handleExportJSON = async () => {
    setExportLoading(true)
    trackEvent("compliance_export_json", { count: decisions.length })
    try {
      const data = await apiCall<{ decisions: any[] }>("/admin/compliance/export", {
        method: "POST",
        body: JSON.stringify({ format: "json" }),
        headers: { "Content-Type": "application/json" },
      })
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `compliance-export-${new Date().toISOString().split("T")[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Export failed:", err)
    } finally {
      setExportLoading(false)
    }
  }

  const handleExport = () => {
    handleExportCSV()
  }

  const handleHumanReview = async (decisionId: string) => {
    try {
      await apiCall(`/admin/compliance/decisions/${decisionId}/review`, { method: "POST" })
      setDecisions((prev) =>
        prev.map((d) => (d.id === decisionId ? { ...d, humanReviewed: true } : d))
      )
      trackEvent("compliance_human_review", { decision_id: decisionId })
    } catch (err) {
      console.error("Review failed:", err)
    }
  }

  const stats = {
    total: decisions.length,
    reviewed: decisions.filter((d) => d.humanReviewed).length,
    biasFlags: decisions.filter((d) => d.biasFlags.length > 0).length,
    overrides: decisions.filter((d) => d.humanOverride).length,
  }

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-heading text-2xl font-bold">EU AI Act Compliance</h1>
            <p className="text-muted-foreground">
              Audit trail, risk classification, and transparency reports for AI decisions
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={exportLoading || decisions.length === 0}
              className="gap-1"
            >
              <FileSpreadsheet className="h-4 w-4" />
              {exportLoading ? "Exporting..." : "Export CSV"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportJSON}
              disabled={exportLoading || decisions.length === 0}
              className="gap-1"
            >
              <ArrowDownToLine className="h-4 w-4" />
              JSON
            </Button>
          </div>
        </div>

        
        {/* Compliance Score Banner */}
        {riskChecklistSummary && (
          <Card className="border-l-4 border-l-primary">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="shrink-0">
                    <div className="relative h-16 w-16">
                      <Gauge className="h-16 w-16 text-muted-foreground" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-bold">{riskChecklistSummary.complianceScore}%</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h2 className="font-heading text-lg font-semibold">EU AI Act Compliance Score</h2>
                    <p className="text-sm text-muted-foreground">
                      {riskChecklistSummary.overallStatus === "compliant"
                        ? "System is fully compliant with EU AI Act requirements"
                        : riskChecklistSummary.overallStatus === "needs_attention"
                          ? "Attention needed: some requirements are pending"
                          : "Partially compliant: complete remaining requirements"}
                    </p>
                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CheckCircle className="h-3 w-3 text-green-500" />
                        {riskChecklistSummary.completed} complete
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-amber-500" />
                        {riskChecklistSummary.pending} pending
                      </span>
                      <span className="flex items-center gap-1">
                        <XCircle className="h-3 w-3 text-red-500" />
                        {riskChecklistSummary.incomplete} incomplete
                      </span>
                      <span className="flex items-center gap-1">
                        <Activity className="h-3 w-3 text-blue-500" />
                        {riskChecklistSummary.inProgress} in progress
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-1 min-w-[200px]">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Progress</span>
                    <span>{riskChecklistSummary.complianceScore}%</span>
                  </div>
                  <Progress value={riskChecklistSummary.complianceScore} max={100} />
                  <p className="text-xs text-muted-foreground">
                    Next review: {new Date(riskChecklistSummary.nextReview).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ChartCard
            title="Total Decisions"
            value={stats.total}
            icon={<FileText className="h-4 w-4" />}
          />
          <ChartCard
            title="Human Reviewed"
            value={stats.reviewed}
            trend="up"
            trendValue={`${Math.round((stats.reviewed / Math.max(stats.total, 1)) * 100)}%`}
            icon={<Eye className="h-4 w-4" />}
          />
          <ChartCard
            title="Bias Flags"
            value={stats.biasFlags}
            trend={stats.biasFlags > 0 ? "down" : "neutral"}
            trendValue={stats.biasFlags > 0 ? "Needs attention" : "Clean"}
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <ChartCard
            title="Human Overrides"
            value={stats.overrides}
            icon={<Ban className="h-4 w-4" />}
          />
        </div>

        {/* Risk Classification Banner */}
        <div className="grid gap-4 lg:grid-cols-3">
          {riskClasses.map((risk) => {
            const config = riskConfig[risk.level]
            const isMitigated = risk.measures.length > 0 && new Date(risk.nextReview) > new Date()
            return (
              <Card key={risk.category}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">{risk.category}</p>
                      <Badge className={`mt-1 ${config.color}`}>
                        {config.icon}
                        <span className="ml-1">{config.label}</span>
                      </Badge>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>Last: {new Date(risk.lastReviewed).toLocaleDateString()}</p>
                      <p>Next: {new Date(risk.nextReview).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <p className="text-sm mt-2">{risk.description}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-xs gap-1 ${
                        isMitigated
                          ? "text-green-600 border-green-200"
                          : "text-amber-600 border-amber-200"
                      }`}
                    >
                      {isMitigated ? (
                        <>
                          <CheckCircle className="h-3 w-3" />
                          Mitigated
                        </>
                      ) : (
                        <>
                          <Clock className="h-3 w-3" />
                          Mitigation Pending
                        </>
                      )}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {risk.measures.length} measure{risk.measures.length !== 1 ? "s" : ""} in place
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {risk.measures.map((m) => (
                      <Badge key={m} variant="outline" className="text-xs">
                        {m}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Tabs */}
        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="overview" className="gap-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              Compliance Score
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-1">
              <FileText className="h-3.5 w-3.5" />
              Audit Trail
            </TabsTrigger>
            <TabsTrigger value="bias" className="gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Bias Detection
            </TabsTrigger>
            <TabsTrigger value="bias-history" className="gap-1">
              <History className="h-3.5 w-3.5" />
              Bias History
            </TabsTrigger>
            <TabsTrigger value="explanations" className="gap-1">
              <BrainCircuit className="h-3.5 w-3.5" />
              Explainability
            </TabsTrigger>
            <TabsTrigger value="overrides" className="gap-1">
              <GitPullRequest className="h-3.5 w-3.5" />
              Overrides
            </TabsTrigger>
            <TabsTrigger value="risk-checklist" className="gap-1">
              <ListChecks className="h-3.5 w-3.5" />
              Risk Checklist
            </TabsTrigger>
            <TabsTrigger value="performance" className="gap-1">
              <BarChart3 className="h-3.5 w-3.5" />
              Model Performance
            </TabsTrigger>
            <TabsTrigger value="transparency" className="gap-1">
              <Eye className="h-3.5 w-3.5" />
              Transparency
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            {loading ? (
              <Skeleton count={4} variant="card" />
            ) : !riskChecklistSummary ? (
              <EmptyState
                icon={ShieldCheck}
                title="Compliance score not available"
                description="Complete the risk checklist to generate a compliance score"
              />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <ChartCard
                    title="Compliance Score"
                    value={`${riskChecklistSummary.complianceScore}%`}
                    trend={riskChecklistSummary.complianceScore >= 80 ? "up" : "down"}
                    trendValue={riskChecklistSummary.complianceScore >= 80 ? "On track" : "Needs work"}
                    icon={<ShieldCheck className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="Requirements Complete"
                    value={`${riskChecklistSummary.completed} / ${riskChecklistSummary.total}`}
                    trend="up"
                    trendValue={`${Math.round((riskChecklistSummary.completed / Math.max(riskChecklistSummary.total, 1)) * 100)}%`}
                    icon={<CheckCircle className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="Pending Actions"
                    value={riskChecklistSummary.pending + riskChecklistSummary.incomplete}
                    trend={riskChecklistSummary.pending + riskChecklistSummary.incomplete > 0 ? "down" : "neutral"}
                    trendValue={riskChecklistSummary.pending + riskChecklistSummary.incomplete > 0 ? "Action needed" : "Clean"}
                    icon={<Clock className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="In Progress"
                    value={riskChecklistSummary.inProgress}
                    icon={<Activity className="h-4 w-4" />}
                  />
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <PieChart className="h-5 w-5" />
                      Score Breakdown
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">Complete</span>
                        <span className="text-green-600 font-medium">{riskChecklistSummary.completed}</span>
                      </div>
                      <Progress value={riskChecklistSummary.completed} max={riskChecklistSummary.total} />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">In Progress</span>
                        <span className="text-blue-600 font-medium">{riskChecklistSummary.inProgress}</span>
                      </div>
                      <Progress value={riskChecklistSummary.inProgress} max={riskChecklistSummary.total} />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">Pending</span>
                        <span className="text-amber-600 font-medium">{riskChecklistSummary.pending}</span>
                      </div>
                      <Progress value={riskChecklistSummary.pending} max={riskChecklistSummary.total} />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">Incomplete</span>
                        <span className="text-red-600 font-medium">{riskChecklistSummary.incomplete}</span>
                      </div>
                      <Progress value={riskChecklistSummary.incomplete} max={riskChecklistSummary.total} />
                    </div>

                    <Separator />

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <h4 className="font-semibold text-sm">Overall Status</h4>
                        <Badge
                          className={
                            riskChecklistSummary.overallStatus === "compliant"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : riskChecklistSummary.overallStatus === "needs_attention"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                          }
                        >
                          {riskChecklistSummary.overallStatus === "compliant"
                            ? "Compliant"
                            : riskChecklistSummary.overallStatus === "needs_attention"
                              ? "Needs Attention"
                              : "Partially Compliant"}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-semibold text-sm">Next Review</h4>
                        <p className="text-sm text-muted-foreground">
                          {new Date(riskChecklistSummary.nextReview).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5" />
                      Priority Actions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {riskChecklist
                        .filter((item) => item.status === "incomplete" || item.status === "pending")
                        .slice(0, 5)
                        .map((item) => (
                          <div key={item.id} className="flex items-start gap-3 p-3 rounded-lg border">
                            <div className="shrink-0 mt-0.5">
                              {item.status === "incomplete" ? (
                                <XCircle className="h-4 w-4 text-red-500" />
                              ) : (
                                <Clock className="h-4 w-4 text-amber-500" />
                              )}
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium">{item.item}</p>
                              <p className="text-xs text-muted-foreground">
                                {item.category} — {item.eu_ai_act_ref}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0">
                              {item.status === "incomplete" ? "Incomplete" : "Pending"}
                            </Badge>
                          </div>
                        ))}
                      {riskChecklist.filter((item) => item.status === "incomplete" || item.status === "pending").length === 0 && (
                        <div className="flex items-center gap-2 text-sm text-green-600">
                          <CheckCircle className="h-4 w-4" />
                          All requirements are complete. No priority actions needed.
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            {loading ? (
              <Skeleton count={3} variant="table" />
            ) : decisions.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No audit records yet"
                description="AI decision audit trail will appear here once decisions are made"
              />
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Candidate</TableHead>
                        <TableHead>Decision</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Reviewed</TableHead>
                        <TableHead>Flags</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {decisions.map((d) => {
                        const type = decisionTypeConfig[d.decisionType]
                        const isExpanded = expandedDecision === d.id
                        return (
                          <React.Fragment key={d.id}>
                            <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedDecision(isExpanded ? null : d.id)}>
                              <TableCell>
                                <Badge className={`${type.color} gap-1`}>
                                  {type.icon}
                                  {type.label}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div>
                                  <p className="font-medium text-sm">{d.candidateName}</p>
                                  {d.jobTitle && <p className="text-xs text-muted-foreground">{d.jobTitle}</p>}
                                </div>
                              </TableCell>
                              <TableCell className="font-medium">{d.decision}</TableCell>
                              <TableCell>{Math.round(d.confidence * 100)}%</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{d.aiModel}</TableCell>
                              <TableCell>
                                {d.humanReviewed ? (
                                  <Badge variant="outline" className="text-xs text-green-600 border-green-200">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Yes
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-200">
                                    <Clock className="h-3 w-3 mr-1" />
                                    Pending
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                {d.biasFlags.length > 0 ? (
                                  <Badge variant="destructive" className="text-xs">
                                    {d.biasFlags.length} flag{d.biasFlags.length > 1 ? "s" : ""}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow className="bg-muted/30">
                                <TableCell colSpan={8} className="p-4">
                                  <div className="space-y-3">
                                    <div>
                                      <p className="text-sm font-medium mb-1">AI Explanation</p>
                                      <p className="text-sm text-muted-foreground">{d.explanation}</p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <div className="text-xs text-muted-foreground">
                                        <span className="font-medium">Retention:</span> {d.dataRetention}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        <span className="font-medium">Audit Hash:</span> {d.auditHash.slice(0, 16)}...
                                      </div>
                                      {d.humanReviewer && (
                                        <div className="text-xs text-muted-foreground">
                                          <span className="font-medium">Reviewer:</span> {d.humanReviewer}
                                        </div>
                                      )}
                                    </div>
                                    {!d.humanReviewed && (
                                      <Button size="sm" onClick={() => handleHumanReview(d.id)} className="gap-1">
                                        <Eye className="h-3.5 w-3.5" />
                                        Mark as Reviewed
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="bias" className="mt-4">
            {loading ? (
              <Skeleton count={2} variant="card" />
            ) : !biasReport ? (
              <EmptyState
                icon={AlertTriangle}
                title="No bias report available"
                description="Run bias detection analysis to generate a report"
              />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <ChartCard title="Total Decisions" value={biasReport.totalDecisions} icon={<FileText className="h-4 w-4" />} />
                  <ChartCard
                    title="Bias Flags"
                    value={biasReport.biasFlagsFound}
                    trend={biasReport.biasFlagsFound > 0 ? "down" : "up"}
                    trendValue={biasReport.biasFlagsFound > 0 ? "Needs review" : "Clean"}
                    icon={<AlertTriangle className="h-4 w-4" />}
                  />
                  <ChartCard title="False Positive Rate" value={`${(biasReport.falsePositiveRate * 100).toFixed(1)}%`} icon={<TrendingUp className="h-4 w-4" />} />
                  <ChartCard title="False Negative Rate" value={`${(biasReport.falseNegativeRate * 100).toFixed(1)}%`} icon={<TrendingDown className="h-4 w-4" />} />
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Demographic Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Demographic</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Positive Rate</TableHead>
                          <TableHead>Bias Flag</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {biasReport.demographicBreakdown.map((d) => (
                          <TableRow key={d.demographic}>
                            <TableCell className="font-medium">{d.demographic}</TableCell>
                            <TableCell>{d.total}</TableCell>
                            <TableCell>{(d.positiveRate * 100).toFixed(1)}%</TableCell>
                            <TableCell>
                              {d.biasFlag ? (
                                <Badge variant="destructive" className="text-xs">Flagged</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs text-green-600 border-green-200">
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  Clean
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-red-600">
                        <AlertTriangle className="h-4 w-4" />
                        Top Concerns
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {biasReport.topConcerns.map((concern, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                            {concern}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-green-600">
                        <CheckCircle className="h-4 w-4" />
                        Improvements
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {biasReport.improvements.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="bias-history" className="mt-4">
            {loading ? (
              <Skeleton count={3} variant="table" />
            ) : biasHistory.length === 0 ? (
              <EmptyState
                icon={History}
                title="No bias history available"
                description="Historical bias audit reports will appear once audits are conducted"
              />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <ChartCard
                    title="Total Audits"
                    value={biasHistory.length}
                    icon={<History className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="Avg Fairness Score"
                    value={`${(biasHistory.reduce((s, r) => s + r.overallFairnessScore, 0) / Math.max(biasHistory.length, 1)).toFixed(1)}%`}
                    icon={<TrendingUp className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="Total Issues"
                    value={biasHistory.reduce((s, r) => s + r.issuesFound, 0)}
                    trend={biasHistory.reduce((s, r) => s + r.issuesFound, 0) > 0 ? "down" : "up"}
                    trendValue={biasHistory.reduce((s, r) => s + r.issuesFound, 0) > 0 ? "Needs attention" : "Clean"}
                    icon={<AlertTriangle className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="Total Appeals"
                    value={biasHistory.reduce((s, r) => s + r.appealCount, 0)}
                    icon={<Users className="h-4 w-4" />}
                  />
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <History className="h-5 w-5" />
                      Historical Bias Audit Reports
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Fairness Score</TableHead>
                          <TableHead>Issues</TableHead>
                          <TableHead>Demographics</TableHead>
                          <TableHead>Appeals</TableHead>
                          <TableHead>Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {biasHistory.map((report) => (
                          <TableRow key={report.id}>
                            <TableCell className="text-xs whitespace-nowrap">
                              {new Date(report.auditDate).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs capitalize">
                                {report.auditType}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Progress
                                  value={report.overallFairnessScore}
                                  max={100}
                                  className="h-2 w-24"
                                />
                                <span className="text-xs font-medium">
                                  {report.overallFairnessScore.toFixed(1)}%
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {report.issuesFound > 0 ? (
                                <Badge variant="destructive" className="text-xs">
                                  {report.issuesFound}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">{report.demographicCount}</TableCell>
                            <TableCell className="text-xs">{report.appealCount}</TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(report.createdAt).toLocaleDateString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="explanations" className="mt-4">
            {loading ? (
              <Skeleton count={3} variant="table" />
            ) : explanations.length === 0 ? (
              <EmptyState
                icon={BrainCircuit}
                title="No explainability logs yet"
                description="AI explanation records will appear here once explanations are viewed or generated"
              />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <ChartCard
                    title="Total Explanations"
                    value={explanations.length}
                    icon={<BrainCircuit className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="Avg Confidence"
                    value={`${(explanations.reduce((sum, e) => sum + e.confidence, 0) / Math.max(explanations.length, 1) * 100).toFixed(1)}%`}
                    icon={<Activity className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="Unique Models"
                    value={new Set(explanations.map(e => e.modelVersion)).size}
                    icon={<FileText className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="Last 24h"
                    value={explanations.filter(e => new Date(e.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)).length}
                    icon={<Clock className="h-4 w-4" />}
                  />
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle>Explainability Log</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Timestamp</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Candidate</TableHead>
                          <TableHead>Model</TableHead>
                          <TableHead>Confidence</TableHead>
                          <TableHead>Accessed By</TableHead>
                          <TableHead>IP Address</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {explanations.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(e.timestamp).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-xs">
                                {e.actionType}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {e.explanationType}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium text-sm">{e.candidate.name}</p>
                                <p className="text-xs text-muted-foreground">ID: {e.candidate.id}</p>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">{e.modelVersion}</TableCell>
                            <TableCell>{Math.round(e.confidence * 100)}%</TableCell>
                            <TableCell>
                              <p className="text-sm">{e.adminUser.name}</p>
                              <p className="text-xs text-muted-foreground">ID: {e.adminUser.id}</p>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {e.viewedFromIp || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="overrides" className="mt-4">
            {loading ? (
              <Skeleton count={3} variant="table" />
            ) : overrides.length === 0 ? (
              <EmptyState
                icon={GitPullRequest}
                title="No human overrides yet"
                description="Records of recruiters overriding AI decisions will appear here"
              />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <ChartCard
                    title="Total Overrides"
                    value={overrides.length}
                    icon={<GitPullRequest className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="Avg AI Confidence"
                    value={`${(overrides.reduce((sum, o) => sum + o.aiConfidence, 0) / Math.max(overrides.length, 1) * 100).toFixed(1)}%`}
                    icon={<Activity className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="Unique Recruiters"
                    value={new Set(overrides.map(o => o.overriddenBy.id)).size}
                    icon={<Users className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="Last 24h"
                    value={overrides.filter(o => new Date(o.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)).length}
                    icon={<Clock className="h-4 w-4" />}
                  />
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle>Human Override Log</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Timestamp</TableHead>
                          <TableHead>Candidate</TableHead>
                          <TableHead>Job</TableHead>
                          <TableHead>Original Decision</TableHead>
                          <TableHead>Override Decision</TableHead>
                          <TableHead>AI Confidence</TableHead>
                          <TableHead>Override By</TableHead>
                          <TableHead>Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {overrides.map((o) => (
                          <TableRow key={o.id}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(o.timestamp).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <p className="font-medium text-sm">{o.candidate.name}</p>
                              <p className="text-xs text-muted-foreground">ID: {o.candidate.id}</p>
                            </TableCell>
                            <TableCell className="text-sm">{o.jobTitle}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {o.originalDecision}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                {o.overrideDecision}
                              </Badge>
                            </TableCell>
                            <TableCell>{Math.round(o.aiConfidence * 100)}%</TableCell>
                            <TableCell>
                              <p className="text-sm">{o.overriddenBy.name}</p>
                              <p className="text-xs text-muted-foreground">ID: {o.overriddenBy.id}</p>
                            </TableCell>
                            <TableCell className="text-sm max-w-xs truncate" title={o.overrideReason}>
                              {o.overrideReason}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="risk-checklist" className="mt-4">
            {loading ? (
              <Skeleton count={4} variant="card" />
            ) : riskChecklist.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title="Risk checklist not available"
                description="Checklist data will appear once compliance monitoring is configured"
              />
            ) : (
              <div className="space-y-4">
                {riskChecklistSummary && (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <ChartCard
                      title="Compliance Score"
                      value={`${riskChecklistSummary.complianceScore}%`}
                      trend={riskChecklistSummary.complianceScore >= 80 ? "up" : "down"}
                      trendValue={riskChecklistSummary.complianceScore >= 80 ? "On track" : "Needs work"}
                      icon={<ShieldCheck className="h-4 w-4" />}
                    />
                    <ChartCard
                      title="Complete"
                      value={riskChecklistSummary.completed}
                      icon={<CheckCircle className="h-4 w-4" />}
                    />
                    <ChartCard
                      title="Pending"
                      value={riskChecklistSummary.pending}
                      icon={<Clock className="h-4 w-4" />}
                    />
                    <ChartCard
                      title="Incomplete"
                      value={riskChecklistSummary.incomplete}
                      trend="down"
                      trendValue={riskChecklistSummary.incomplete > 0 ? "Action needed" : "Clean"}
                      icon={<XCircle className="h-4 w-4" />}
                    />
                  </div>
                )}

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ListChecks className="h-5 w-5" />
                      EU AI Act Risk Assessment Checklist
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Status</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Requirement</TableHead>
                          <TableHead>Evidence</TableHead>
                          <TableHead>EU AI Act Ref</TableHead>
                          <TableHead>Last Verified</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {riskChecklist.map((item) => {
                          const statusConfig = {
                            complete: {
                              color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                              icon: <CheckCircle className="h-4 w-4" />,
                              label: "Complete",
                            },
                            pending: {
                              color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                              icon: <Clock className="h-4 w-4" />,
                              label: "Pending",
                            },
                            incomplete: {
                              color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                              icon: <XCircle className="h-4 w-4" />,
                              label: "Incomplete",
                            },
                            in_progress: {
                              color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                              icon: <Activity className="h-4 w-4" />,
                              label: "In Progress",
                            },
                          };
                          const config = statusConfig[item.status] || statusConfig.incomplete;
                          return (
                            <TableRow key={item.id}>
                              <TableCell>
                                <Badge className={`${config.color} gap-1`}>
                                  {config.icon}
                                  {config.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-medium">{item.category}</TableCell>
                              <TableCell>
                                <div>
                                  <p className="text-sm font-medium">{item.item}</p>
                                  {item.required && (
                                    <p className="text-xs text-red-500">Required</p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground max-w-sm">
                                {item.evidence}
                              </TableCell>
                              <TableCell className="text-xs font-mono">
                                {item.eu_ai_act_ref}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {new Date(item.lastVerified).toLocaleDateString()}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="performance" className="mt-4">
            {loading ? (
              <Skeleton count={3} variant="card" />
            ) : !modelPerformance ? (
              <EmptyState
                icon={BarChart3}
                title="Model performance data not available"
                description="Performance metrics will appear once AI decisions are logged"
              />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <ChartCard
                    title="Total Decisions (30d)"
                    value={modelPerformance.totalDecisions}
                    icon={<FileText className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="Human Review Rate"
                    value={`${(modelPerformance.reviewRate * 100).toFixed(1)}%`}
                    trend={modelPerformance.reviewRate >= 0.9 ? "up" : "down"}
                    trendValue={modelPerformance.reviewRate >= 0.9 ? "On target" : "Needs review"}
                    icon={<Eye className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="Active Models"
                    value={modelPerformance.modelPerformance.length}
                    icon={<BrainCircuit className="h-4 w-4" />}
                  />
                  <ChartCard
                    title="Avg Confidence"
                    value={
                      modelPerformance.modelPerformance.length > 0
                        ? `${(
                            modelPerformance.modelPerformance.reduce((s, m) => s + m.avgConfidence, 0) /
                            modelPerformance.modelPerformance.length *
                            100
                          ).toFixed(1)}%`
                        : "N/A"
                    }
                    icon={<TrendingUp className="h-4 w-4" />}
                  />
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      Volume Over Time
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {modelPerformance.volumeOverTime.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No volume data available for the selected period.</p>
                    ) : (
                      <div className="space-y-3">
                        {modelPerformance.volumeOverTime.map((day) => (
                          <div key={day.date} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">
                                {new Date(day.date).toLocaleDateString()}
                              </span>
                              <span className="font-medium">{day.count}</span>
                            </div>
                            <Progress
                              value={day.count}
                              max={Math.max(
                                ...modelPerformance.volumeOverTime.map((d) => d.count)
                              )}
                              className="h-2"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BrainCircuit className="h-5 w-5" />
                      Model Performance by System
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Model</TableHead>
                          <TableHead>Decisions</TableHead>
                          <TableHead>Avg Confidence</TableHead>
                          <TableHead>Override Rate</TableHead>
                          <TableHead>Health</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {modelPerformance.modelPerformance.map((model) => (
                          <TableRow key={model.model}>
                            <TableCell className="font-medium text-sm">{model.model}</TableCell>
                            <TableCell>{model.decisions}</TableCell>
                            <TableCell>{(model.avgConfidence * 100).toFixed(1)}%</TableCell>
                            <TableCell>{(model.overrideRate * 100).toFixed(1)}%</TableCell>
                            <TableCell>
                              {model.overrideRate > 0.1 ? (
                                <Badge variant="destructive" className="text-xs">High Override</Badge>
                              ) : model.avgConfidence < 0.7 ? (
                                <Badge variant="outline" className="text-xs text-amber-600 border-amber-200">Low Confidence</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs text-green-600 border-green-200">
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  Healthy
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      Score Distribution
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {modelPerformance.scoreDistribution.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No score data available for the selected period.</p>
                    ) : (
                      <div className="space-y-3">
                        {modelPerformance.scoreDistribution.map((bucket) => (
                          <div key={bucket.bucket} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">
                                {bucket.bucket}-{bucket.bucket + 9}
                              </span>
                              <span className="font-medium">{bucket.count}</span>
                            </div>
                            <Progress
                              value={bucket.count}
                              max={Math.max(
                                ...modelPerformance.scoreDistribution.map((b) => b.count)
                              )}
                              className="h-2"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="transparency" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>EU AI Act Transparency Report</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <h3 className="font-semibold">1. AI System Description</h3>
                  <p className="text-sm text-muted-foreground">
                    Rekrut AI uses multiple AI models for candidate screening, job matching, interview assessment, and scoring. All decisions are logged with explainability and audit trails.
                  </p>
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold">2. Decision Making Process</h3>
                  <p className="text-sm text-muted-foreground">
                    AI models analyze candidate profiles, job requirements, interview responses, and documents. Human reviewers can override AI decisions. All overrides are logged.
                  </p>
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold">3. Data Usage</h3>
                  <p className="text-sm text-muted-foreground">
                    Candidate data is used solely for hiring purposes. Data retention follows GDPR and EU AI Act requirements. Candidates can request deletion at any time.
                  </p>
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold">4. Human Oversight</h3>
                  <p className="text-sm text-muted-foreground">
                    All high-risk AI decisions require human review. Recruiters can override AI recommendations. Bias detection runs continuously on all decisions.
                  </p>
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold">5. Rights of Individuals</h3>
                  <p className="text-sm text-muted-foreground">
                    Candidates have the right to: request explanation of AI decisions, challenge decisions, request human review, and access their data.
                  </p>
                </div>
                <Button variant="outline" className="gap-1" onClick={handleExport}>
                  <Download className="h-4 w-4" />
                  Download Full Report
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    
  )
}
