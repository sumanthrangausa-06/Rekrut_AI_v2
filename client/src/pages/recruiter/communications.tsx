import { useEffect, useState } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Send, Save, Sparkles, MessageSquare, Mail, CheckCircle, Clock, AlertCircle,
  Users, BarChart3, RefreshCw, ChevronRight, X, FileText, Loader2,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────

interface Communication {
  id: number
  candidate_id: number | null
  candidate_name: string | null
  candidate_email: string | null
  job_id: number | null
  job_title: string | null
  type: string
  subject: string | null
  body: string | null
  tone: string | null
  status: string
  created_at: string
  metadata?: {
    pipeline?: {
      tone_check?: { passed: boolean }
      compliance?: { passed: boolean }
    }
  }
}

interface CommAnalytics {
  totals: {
    total: number
    sent: number
    drafts: number
    replied: number
    response_rate: number
  }
}

interface CandidateOption {
  id: number
  name: string
}

interface JobOption {
  id: number
  title: string
}

const MESSAGE_TYPES = [
  { value: 'outreach', label: 'Outreach', icon: Mail },
  { value: 'follow_up', label: 'Follow-up', icon: RefreshCw },
  { value: 'rejection', label: 'Rejection', icon: X },
  { value: 'offer_letter', label: 'Offer Letter', icon: FileText },
  { value: 'interview_confirmation', label: 'Interview', icon: MessageSquare },
]

const TONES = [
  { value: 'professional', label: 'Professional' },
  { value: 'conversational', label: 'Conversational' },
  { value: 'formal', label: 'Formal' },
  { value: 'executive', label: 'Executive' },
  { value: 'friendly', label: 'Friendly' },
]

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  sent: 'success',
  draft: 'warning',
  failed: 'destructive',
}

// ─── Component ────────────────────────────────────────────────────────────

export function RecruiterCommunicationsPage() {
  const [comms, setComms] = useState<Communication[]>([])
  const [analytics, setAnalytics] = useState<CommAnalytics | null>(null)
  const [candidates, setCandidates] = useState<CandidateOption[]>([])
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [selectedComm, setSelectedComm] = useState<Communication | null>(null)
  const [composeMode, setComposeMode] = useState(false)

  // Compose state
  const [composeCandidate, setComposeCandidate] = useState('')
  const [composeJob, setComposeJob] = useState('')
  const [composeType, setComposeType] = useState('outreach')
  const [composeTone, setComposeTone] = useState('professional')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      const [commsData, analyticsData, appsData, jobsData] = await Promise.all([
        apiCall<{ communications: Communication[] }>('/communications?limit=100').catch(() => ({ communications: [] })),
        apiCall<CommAnalytics>('/communications/analytics').catch(() => null),
        apiCall<{ applications: Array<{ candidate_id: number; candidate_name?: string; name?: string }> }>('/recruiter/applications').catch(() => ({ applications: [] })),
        apiCall<{ jobs: JobOption[] }>('/recruiter/jobs').catch(() => ({ jobs: [] })),
      ])

      setComms(commsData.communications || [])
      setAnalytics(analyticsData)

      const seen = new Set<number>()
      const uniqueCandidates = (appsData.applications || [])
        .filter((a) => {
          if (seen.has(a.candidate_id)) return false
          seen.add(a.candidate_id)
          return true
        })
        .map((a) => ({ id: a.candidate_id, name: a.candidate_name || a.name || 'Unknown' }))
      setCandidates(uniqueCandidates)
      setJobs(jobsData.jobs || [])
    } catch (err) {
      console.error('Failed to load communications data:', err)
    } finally {
      setLoading(false)
    }
  }

  const filteredComms = comms.filter((c) => {
    if (filter === 'all') return true
    return c.status === filter
  })

  async function generateMessage() {
    if (!composeCandidate) return
    setGenerating(true)
    try {
      const res = await apiCall<{ subject: string; body: string; pipeline: unknown }>('/communications/generate', {
        method: 'POST',
        body: {
          candidate_id: parseInt(composeCandidate),
          job_id: composeJob ? parseInt(composeJob) : null,
          type: composeType,
          tone: composeTone,
        },
      })
      setComposeSubject(res.subject)
      setComposeBody(res.body)
    } catch (err: any) {
      console.error('Generation failed:', err)
    } finally {
      setGenerating(false)
    }
  }

  async function sendMessage() {
    if (!composeCandidate || !composeBody) return
    setSending(true)
    try {
      await apiCall('/communications/send', {
        method: 'POST',
        body: {
          candidate_id: parseInt(composeCandidate),
          job_id: composeJob ? parseInt(composeJob) : null,
          type: composeType,
          subject: composeSubject,
          body: composeBody,
          tone: composeTone,
          run_pipeline: true,
        },
      })
      setComposeMode(false)
      resetCompose()
      loadData()
    } catch (err: any) {
      console.error('Send failed:', err)
    } finally {
      setSending(false)
    }
  }

  async function saveDraft() {
    if (!composeCandidate || !composeBody) return
    try {
      await apiCall('/communications/draft', {
        method: 'POST',
        body: {
          candidate_id: parseInt(composeCandidate),
          job_id: composeJob ? parseInt(composeJob) : null,
          type: composeType,
          subject: composeSubject,
          body: composeBody,
          tone: composeTone,
        },
      })
      setComposeMode(false)
      resetCompose()
      loadData()
    } catch (err: any) {
      console.error('Draft save failed:', err)
    }
  }

  async function sendDraft(comm: Communication) {
    try {
      await apiCall('/communications/send', {
        method: 'POST',
        body: {
          candidate_id: comm.candidate_id,
          job_id: comm.job_id,
          type: comm.type,
          subject: comm.subject,
          body: comm.body,
          tone: comm.tone,
          run_pipeline: true,
        },
      })
      loadData()
    } catch (err: any) {
      console.error('Send draft failed:', err)
    }
  }

  function resetCompose() {
    setComposeCandidate('')
    setComposeJob('')
    setComposeType('outreach')
    setComposeTone('professional')
    setComposeSubject('')
    setComposeBody('')
  }

  function formatRelative(date: string) {
    const d = new Date(date)
    const now = new Date()
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  const totals = analytics?.totals

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Communication Hub</h1>
          <p className="text-sm text-muted-foreground">AI-powered recruiter messaging</p>
        </div>
        <Button onClick={() => { setComposeMode(true); setSelectedComm(null) }}>
          <Sparkles className="mr-2 h-4 w-4" />
          Compose Message
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total Messages', value: totals?.total ?? 0, icon: Mail },
          { label: 'Sent', value: totals?.sent ?? 0, icon: Send },
          { label: 'Drafts', value: totals?.drafts ?? 0, icon: FileText },
          { label: 'Replied', value: totals?.replied ?? 0, icon: MessageSquare },
          { label: 'Response Rate', value: `${totals?.response_rate ?? 0}%`, icon: BarChart3 },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <stat.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{stat.label}</span>
              </div>
              <div className="mt-1 text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sidebar */}
        <Card className="lg:col-span-1">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold">Messages</span>
              <Button size="sm" variant="outline" onClick={() => { setComposeMode(true); setSelectedComm(null) }}>
                + New
              </Button>
            </div>

            <Tabs value={filter} onValueChange={setFilter} className="mb-4">
              <TabsList className="w-full grid grid-cols-3">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="sent">Sent</TabsTrigger>
                <TabsTrigger value="draft">Drafts</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredComms.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">No messages yet</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => { setComposeMode(true); setSelectedComm(null) }}>
                    Compose First Message
                  </Button>
                </div>
              ) : (
                filteredComms.map((comm) => (
                  <button
                    key={comm.id}
                    onClick={() => { setSelectedComm(comm); setComposeMode(false) }}
                    className={`w-full text-left p-3 rounded-lg border transition-colors hover:bg-accent ${
                      selectedComm?.id === comm.id ? 'border-primary bg-accent' : 'border-border'
                    }`}
                  >
                    <div className="font-medium text-sm truncate">{comm.candidate_name || 'Unknown'}</div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {(comm.subject || comm.body || '').substring(0, 60)}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {(comm.type || 'custom').replace(/_/g, ' ')}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{formatRelative(comm.created_at)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Main area */}
        <Card className="lg:col-span-2">
          <CardContent className="p-6">
            {composeMode ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Compose AI Message
                  </h3>
                  <Button size="sm" variant="ghost" onClick={() => { setComposeMode(false); resetCompose() }}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block">Candidate</label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={composeCandidate}
                      onChange={(e) => setComposeCandidate(e.target.value)}
                    >
                      <option value="">Select candidate...</option>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Job (optional)</label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={composeJob}
                      onChange={(e) => setComposeJob(e.target.value)}
                    >
                      <option value="">Select job...</option>
                      {jobs.map((j) => (
                        <option key={j.id} value={j.id}>{j.title}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium mb-1 block">Message Type</label>
                  <div className="flex flex-wrap gap-2">
                    {MESSAGE_TYPES.map((type) => (
                      <Button
                        key={type.value}
                        size="sm"
                        variant={composeType === type.value ? 'default' : 'outline'}
                        onClick={() => setComposeType(type.value)}
                      >
                        <type.icon className="mr-1 h-3 w-3" />
                        {type.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium mb-1 block">Tone</label>
                  <div className="flex flex-wrap gap-2">
                    {TONES.map((tone) => (
                      <Button
                        key={tone.value}
                        size="sm"
                        variant={composeTone === tone.value ? 'default' : 'outline'}
                        onClick={() => setComposeTone(tone.value)}
                      >
                        {tone.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <Button
                  onClick={generateMessage}
                  disabled={!composeCandidate || generating}
                  className="w-full"
                >
                  {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Generate AI Message
                </Button>

                {composeBody && (
                  <div className="space-y-3 pt-2 border-t">
                    <div>
                      <label className="text-xs font-medium mb-1 block">Subject</label>
                      <Input
                        value={composeSubject}
                        onChange={(e) => setComposeSubject(e.target.value)}
                        placeholder="Email subject..."
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium mb-1 block">Message</label>
                      <textarea
                        className="w-full min-h-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={composeBody}
                        onChange={(e) => setComposeBody(e.target.value)}
                        placeholder="Message body..."
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={sendMessage} disabled={sending}>
                        {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        Send
                      </Button>
                      <Button variant="secondary" onClick={saveDraft}>
                        <Save className="mr-2 h-4 w-4" />
                        Save Draft
                      </Button>
                      <Button variant="outline" onClick={generateMessage} disabled={generating}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Regenerate
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : selectedComm ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">
                    {selectedComm.subject || `${(selectedComm.type || 'Message').replace(/_/g, ' ')} to ${selectedComm.candidate_name || 'Candidate'}`}
                  </h3>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {(selectedComm.type || 'custom').replace(/_/g, ' ')}
                    </Badge>
                    <Badge variant={STATUS_VARIANTS[selectedComm.status] || 'default'} className="text-xs">
                      {selectedComm.status}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                    {(selectedComm.candidate_name || '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{selectedComm.candidate_name || 'Unknown Candidate'}</div>
                    <div className="text-xs text-muted-foreground">
                      {selectedComm.candidate_email || ''} · {selectedComm.job_title || 'No job linked'}
                    </div>
                  </div>
                </div>

                {selectedComm.subject && (
                  <div className="font-medium text-sm">Subject: {selectedComm.subject}</div>
                )}

                <div className="bg-accent rounded-lg p-4 text-sm whitespace-pre-wrap leading-relaxed">
                  {selectedComm.body || ''}
                </div>

                {selectedComm.metadata?.pipeline && (
                  <div className="space-y-2">
                    <span className="text-xs font-medium">AI Pipeline Results</span>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                        <CheckCircle className="mr-1 h-3 w-3" /> Personalized
                      </Badge>
                      <Badge variant="outline" className={`text-xs ${selectedComm.metadata.pipeline.tone_check?.passed !== false ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                        {selectedComm.metadata.pipeline.tone_check?.passed !== false ? <CheckCircle className="mr-1 h-3 w-3" /> : <X className="mr-1 h-3 w-3" />}
                        Tone
                      </Badge>
                      <Badge variant="outline" className={`text-xs ${selectedComm.metadata.pipeline.compliance?.passed !== false ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                        {selectedComm.metadata.pipeline.compliance?.passed !== false ? <CheckCircle className="mr-1 h-3 w-3" /> : <X className="mr-1 h-3 w-3" />}
                        Compliance
                      </Badge>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  {selectedComm.status === 'draft' && (
                    <Button onClick={() => sendDraft(selectedComm)}>
                      <Send className="mr-2 h-4 w-4" />
                      Send Message
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => {
                    setComposeMode(true)
                    setComposeCandidate(String(selectedComm.candidate_id || ''))
                    setComposeJob(String(selectedComm.job_id || ''))
                    setComposeType(selectedComm.type || 'outreach')
                    setComposeTone(selectedComm.tone || 'professional')
                    setComposeSubject(selectedComm.subject || '')
                    setComposeBody(selectedComm.body || '')
                  }}>
                    <MessageSquare className="mr-2 h-4 w-4" />
                    Reply / New Message
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">✨</div>
                <h3 className="font-semibold text-lg mb-1">AI-Powered Recruiter Communications</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
                  Draft personalized outreach, follow-ups, rejections, and offer letters — all powered by AI that adapts to each candidate.
                </p>
                <Button onClick={() => setComposeMode(true)}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Compose Message
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
