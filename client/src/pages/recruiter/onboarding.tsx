import { useEffect, useState } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { AiOnboardingRecruiter } from '@/components/ai-onboarding-recruiter'
import {
  Users, FileText, CheckCircle, Clock, AlertCircle, Search,
  Download, Eye, ChevronRight, BarChart3, Loader2, Sparkles,
  User, Building2, Mail, RefreshCw, XCircle, ArrowLeft,
  ClipboardCheck, TrendingUp, Timer, UserCheck,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────
interface OnboardingCandidate {
  candidate_id: number
  candidate_name: string
  candidate_email: string
  total_documents: string
  signed_documents: string
  last_activity: string | null
  onboarding_status: string
  due_date: string | null
  job_title: string | null
  wizard_step: number | null
}

interface CandidateDocument {
  id: number
  document_type: string
  status: string
  signed_at: string | null
  signer_ip: string | null
  signer_user_agent: string | null
  created_at: string
  candidate_name: string
  candidate_email: string
  checklist_title: string
  checklist_status: string
  due_date: string | null
  salary: string | null
  start_date: string | null
  job_title: string | null
}

// ─── Status config ───────────────────────────────────────────────────
const statusConfig: Record<string, {
  label: string
  variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive'
  icon: React.ElementType
}> = {
  completed: { label: 'Completed', variant: 'success', icon: CheckCircle },
  in_progress: { label: 'In Progress', variant: 'warning', icon: Clock },
  pending: { label: 'Not Started', variant: 'secondary', icon: AlertCircle },
}

const DOCUMENT_TYPES = ['I-9 Employment Eligibility', 'W-4 Tax Withholding', 'Direct Deposit Authorization', 'Employee Handbook Acknowledgment']

// ─── Component ───────────────────────────────────────────────────────
export function RecruiterOnboardingPage() {
  const [loading, setLoading] = useState(true)
  const [candidates, setCandidates] = useState<OnboardingCandidate[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('employees')

  // Detail view
  const [selectedCandidate, setSelectedCandidate] = useState<OnboardingCandidate | null>(null)
  const [candidateDocs, setCandidateDocs] = useState<CandidateDocument[]>([])
  const [loadingDocs, setLoadingDocs] = useState(false)

  useEffect(() => {
    loadCandidates()
  }, [])

  async function loadCandidates() {
    try {
      setLoading(true)
      const data = await apiCall<OnboardingCandidate[]>('/onboarding/recruiter/summary')
      setCandidates(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function viewCandidate(c: OnboardingCandidate) {
    setSelectedCandidate(c)
    setLoadingDocs(true)
    try {
      const docs = await apiCall<CandidateDocument[]>(`/onboarding/recruiter/candidate/${c.candidate_id}/documents`)
      setCandidateDocs(docs)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoadingDocs(false)
    }
  }

  async function downloadDocument(docId: number) {
    try {
      const token = localStorage.getItem('rekrutai_token')
      const res = await fetch(`/api/onboarding/recruiter/document/${docId}/download`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('Failed to download')
      const html = await res.text()
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (err: any) {
      setError(err.message || 'Failed to download document')
    }
  }

  // ─── Computed values ───────────────────────────────────────────────
  const filtered = candidates.filter(c => {
    const matchesSearch = !search ||
      c.candidate_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.candidate_email?.toLowerCase().includes(search.toLowerCase()) ||
      c.job_title?.toLowerCase().includes(search.toLowerCase())

    const matchesStatus = statusFilter === 'all' || c.onboarding_status === statusFilter

    return matchesSearch && matchesStatus
  })

  const stats = {
    total: candidates.length,
    completed: candidates.filter(c => c.onboarding_status === 'completed').length,
    inProgress: candidates.filter(c => c.onboarding_status === 'in_progress').length,
    pending: candidates.filter(c => c.onboarding_status === 'pending').length,
  }

  const completionRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0

  // ─── Loading ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading onboarding data...</p>
      </div>
    )
  }

  // ─── Candidate detail view ─────────────────────────────────────────
  if (selectedCandidate) {
    const sc = selectedCandidate
    const s = statusConfig[sc.onboarding_status] || statusConfig.pending
    const totalDocs = parseInt(sc.total_documents) || 0
    const signedDocs = parseInt(sc.signed_documents) || 0
    const docPct = totalDocs > 0 ? Math.round((signedDocs / totalDocs) * 100) : 0

    return (
      <div className="space-y-6">
        {/* Back button */}
        <Button variant="ghost" onClick={() => setSelectedCandidate(null)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to all candidates
        </Button>

        {/* Candidate header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">{sc.candidate_name}</h1>
              <p className="text-sm text-muted-foreground">{sc.candidate_email}</p>
              {sc.job_title && (
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Building2 className="h-3 w-3" />
                  {sc.job_title}
                </p>
              )}
            </div>
          </div>
          <Badge variant={s.variant} className="text-sm px-3 py-1 w-fit">
            <s.icon className="h-4 w-4 mr-1" />
            {s.label}
          </Badge>
        </div>

        {/* Progress card */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Document Completion</h2>
              <span className="text-2xl font-bold text-primary">{docPct}%</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden mb-4">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  docPct === 100 ? 'bg-green-500' : docPct > 0 ? 'bg-primary' : 'bg-muted'
                }`}
                style={{ width: `${docPct}%` }}
              />
            </div>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{signedDocs} of {totalDocs} documents signed</span>
              {sc.due_date && (
                <span>Due: {new Date(sc.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Documents list */}
        <Card>
          <CardContent className="p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Documents
            </h2>

            {loadingDocs ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : candidateDocs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                <p>No documents generated yet.</p>
                <p className="text-sm">Candidate hasn't completed the onboarding wizard.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {candidateDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {doc.signed_at ? (
                        <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                      ) : (
                        <Clock className="h-5 w-5 text-amber-500 shrink-0" />
                      )}
                      <div>
                        <p className="font-medium">{doc.document_type}</p>
                        <p className="text-xs text-muted-foreground">
                          {doc.signed_at ? (
                            <>Signed {new Date(doc.signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · IP: {doc.signer_ip || 'N/A'}</>
                          ) : (
                            <>Generated {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · Awaiting signature</>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {doc.signed_at ? (
                        <Badge variant="success" className="mr-2">Signed</Badge>
                      ) : (
                        <Badge variant="warning" className="mr-2">Pending</Badge>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadDocument(doc.id)}
                        title="View / Download"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Audit trail info */}
            {candidateDocs.some(d => d.signed_at) && (
              <div className="mt-6 p-4 rounded-lg bg-blue-50 border border-blue-200 text-sm">
                <p className="font-medium text-blue-900 mb-1">Audit Trail</p>
                <p className="text-blue-700">
                  All e-signatures include timestamp, IP address, and user agent for compliance.
                  Click the download button on any document to view the full printable version.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─── Main dashboard ────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Onboarding Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Track employee onboarding progress, documents, and compliance.
        </p>
      </div>

      {/* Tab Navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="employees" className="gap-1.5">
            <ClipboardCheck className="h-4 w-4" /> Employees
          </TabsTrigger>
          <TabsTrigger value="ai-plans" className="gap-1.5">
            <Sparkles className="h-4 w-4" /> AI Plans
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai-plans">
          <AiOnboardingRecruiter />
        </TabsContent>

        <TabsContent value="employees">
          <div />
        </TabsContent>
      </Tabs>

      {activeTab !== 'employees' ? null : (
      <>
      {/* Analytics cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Onboarding"
          value={stats.total}
          icon={Users}
          color="bg-blue-100 text-blue-700"
        />
        <StatCard
          label="Completed"
          value={stats.completed}
          icon={CheckCircle}
          color="bg-green-100 text-green-700"
        />
        <StatCard
          label="In Progress"
          value={stats.inProgress}
          icon={Clock}
          color="bg-amber-100 text-amber-700"
        />
        <StatCard
          label="Completion Rate"
          value={`${completionRate}%`}
          icon={TrendingUp}
          color="bg-purple-100 text-purple-700"
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, or job title..."
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              {['all', 'pending', 'in_progress', 'completed'].map((s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter(s)}
                >
                  {s === 'all' ? 'All' : s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Candidates list */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ClipboardCheck className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-lg font-semibold mb-1">No Onboarding Employees</h3>
            <p className="text-muted-foreground">
              {candidates.length === 0
                ? 'Employees will appear here after they accept an offer.'
                : 'No employees match your current filters.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const s = statusConfig[c.onboarding_status] || statusConfig.pending
            const StatusIcon = s.icon
            const totalDocs = parseInt(c.total_documents) || 0
            const signedDocs = parseInt(c.signed_documents) || 0
            const docPct = totalDocs > 0 ? Math.round((signedDocs / totalDocs) * 100) : 0

            return (
              <Card
                key={c.candidate_id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => viewCandidate(c)}
              >
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="h-6 w-6 text-primary" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold truncate">{c.candidate_name}</h3>
                        <Badge variant={s.variant} className="text-xs">
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {s.label}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{c.candidate_email}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        {c.job_title && (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {c.job_title}
                          </span>
                        )}
                        {c.due_date && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Due {new Date(c.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                        {c.last_activity && (
                          <span>
                            Last active {new Date(c.last_activity).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress bar + arrow */}
                    <div className="hidden sm:flex items-center gap-4">
                      <div className="w-32">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground">Documents</span>
                          <span className="font-medium">{signedDocs}/{totalDocs}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              docPct === 100 ? 'bg-green-500' : docPct > 0 ? 'bg-primary' : 'bg-muted'
                            }`}
                            style={{ width: `${Math.max(docPct, totalDocs > 0 ? 0 : 0)}%` }}
                          />
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </div>

                  {/* Mobile progress */}
                  <div className="sm:hidden mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Documents signed</span>
                      <span className="font-medium">{signedDocs}/{totalDocs}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          docPct === 100 ? 'bg-green-500' : docPct > 0 ? 'bg-primary' : 'bg-muted'
                        }`}
                        style={{ width: `${docPct}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Document checklist legend */}
      {candidates.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-3">Required Documents</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {DOCUMENT_TYPES.map((dt) => (
                <div key={dt} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="truncate">{dt.replace('Employment Eligibility', '').replace('Tax Withholding', '').trim() || dt}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      </>
      )}
    </div>
  )
}

// ─── Stat Card ───────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string
  value: string | number
  icon: React.ElementType
  color: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className={`h-9 w-9 rounded-lg ${color} flex items-center justify-center`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  )
}
