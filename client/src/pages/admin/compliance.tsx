import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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

export type RiskClassification = {
  category: string
  level: "high" | "limited" | "minimal"
  description: string
  measures: string[]
  lastReviewed: string
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
  const [loading, setLoading] = useState(true)
  const [selectedTab, setSelectedTab] = useState("audit")
  const [expandedDecision, setExpandedDecision] = useState<string | null>(null)

  useEffect(() => {
    async function loadCompliance() {
      setLoading(true)
      try {
        const [decisionsData, biasData, riskData] = await Promise.all([
          apiCall<{ decisions: ComplianceDecision[] }>("/admin/compliance/decisions"),
          apiCall<{ report: BiasReport }>("/admin/compliance/bias-report").catch(() => ({ report: null })),
          apiCall<{ classifications: RiskClassification[] }>("/admin/compliance/risk-classifications").catch(() => ({ classifications: [] })),
        ])
        setDecisions(decisionsData.decisions || [])
        setBiasReport(biasData.report)
        setRiskClasses(riskData.classifications || [])
      } catch (err) {
        console.error("Failed to load compliance data:", err)
      } finally {
        setLoading(false)
      }
    }
    loadCompliance()
  }, [])

  const handleExport = () => {
    trackEvent("compliance_export", { count: decisions.length })
    // TODO: CSV export
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
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-1">
              <Download className="h-4 w-4" />
              Export Report
            </Button>
          </div>
        </div>

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
            <TabsTrigger value="audit" className="gap-1">
              <FileText className="h-3.5 w-3.5" />
              Audit Trail
            </TabsTrigger>
            <TabsTrigger value="bias" className="gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Bias Detection
            </TabsTrigger>
            <TabsTrigger value="transparency" className="gap-1">
              <Eye className="h-3.5 w-3.5" />
              Transparency
            </TabsTrigger>
          </TabsList>

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
                          <>
                            <TableRow key={d.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedDecision(isExpanded ? null : d.id)}>
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
                          </>
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
