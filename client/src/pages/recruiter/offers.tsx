import { useEffect, useState } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Gift, Plus, Send, DollarSign, Calendar, Users, CheckCircle, XCircle, Clock, Eye,
} from 'lucide-react'

interface Offer {
  id: number
  candidate_id: number
  job_id: number
  title: string
  company_name: string
  candidate_name: string
  candidate_email: string
  job_title: string
  recruiter_name: string
  salary: number
  start_date: string
  benefits: string
  status: string
  sent_at: string
  viewed_at: string
  accepted_at: string
  declined_at: string
  decline_reason: string
  created_at: string
}

interface Candidate {
  id: number
  name: string
  email: string
}

interface Job {
  id: number
  title: string
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive'; icon: React.ElementType }> = {
  draft: { label: 'Draft', variant: 'secondary', icon: Clock },
  sent: { label: 'Sent', variant: 'warning', icon: Send },
  viewed: { label: 'Viewed', variant: 'default', icon: Eye },
  accepted: { label: 'Accepted', variant: 'success', icon: CheckCircle },
  declined: { label: 'Declined', variant: 'destructive', icon: XCircle },
}

export function RecruiterOffersPage() {
  const [offers, setOffers] = useState<Offer[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState<number | null>(null)

  // Form fields
  const [candidateId, setCandidateId] = useState('')
  const [jobId, setJobId] = useState('')
  const [offerTitle, setOfferTitle] = useState('')
  const [salary, setSalary] = useState('')
  const [startDate, setStartDate] = useState('')
  const [benefits, setBenefits] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [offersRes, candidatesRes, jobsRes] = await Promise.allSettled([
        apiCall<Offer[]>('/onboarding/offers'),
        apiCall<{ candidates: Candidate[] }>('/recruiter/candidates'),
        apiCall<{ jobs: Job[] }>('/recruiter/jobs'),
      ])
      if (offersRes.status === 'fulfilled') setOffers(Array.isArray(offersRes.value) ? offersRes.value : [])
      if (candidatesRes.status === 'fulfilled') setCandidates(candidatesRes.value.candidates || [])
      if (jobsRes.status === 'fulfilled') setJobs(jobsRes.value.jobs || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function createOffer() {
    if (!candidateId || !jobId || !salary) {
      alert('Please fill in candidate, job, and salary')
      return
    }
    setSaving(true)
    try {
      await apiCall('/onboarding/offers', {
        method: 'POST',
        body: {
          candidate_id: Number(candidateId),
          job_id: Number(jobId),
          title: offerTitle || jobs.find(j => j.id === Number(jobId))?.title || 'Job Offer',
          salary: Number(salary),
          start_date: startDate || null,
          benefits,
        },
      })
      setShowCreate(false)
      resetForm()
      loadData()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create offer')
    } finally {
      setSaving(false)
    }
  }

  async function sendOffer(id: number) {
    setSending(id)
    try {
      await apiCall(`/onboarding/offers/${id}/send`, { method: 'POST' })
      loadData()
    } catch {
      // silent
    } finally {
      setSending(null)
    }
  }

  function resetForm() {
    setCandidateId('')
    setJobId('')
    setOfferTitle('')
    setSalary('')
    setStartDate('')
    setBenefits('')
  }

  const draftOffers = offers.filter(o => o.status === 'draft')
  const sentOffers = offers.filter(o => ['sent', 'viewed'].includes(o.status))
  const resolvedOffers = offers.filter(o => ['accepted', 'declined'].includes(o.status))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Offers</h1>
          <p className="text-muted-foreground">Create and manage job offers</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Create Offer
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{offers.length}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{sentOffers.length}</p>
            <p className="text-xs text-muted-foreground">Pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">
              {offers.filter(o => o.status === 'accepted').length}
            </p>
            <p className="text-xs text-muted-foreground">Accepted</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-destructive">
              {offers.filter(o => o.status === 'declined').length}
            </p>
            <p className="text-xs text-muted-foreground">Declined</p>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : offers.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Gift className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-muted-foreground mb-4">No offers created yet</p>
            <Button onClick={() => setShowCreate(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Create Your First Offer
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Draft offers */}
          {draftOffers.length > 0 && (
            <div>
              <h2 className="font-medium text-sm text-muted-foreground mb-3">
                Drafts ({draftOffers.length})
              </h2>
              <div className="space-y-2">
                {draftOffers.map(offer => (
                  <OfferRow
                    key={offer.id}
                    offer={offer}
                    onSend={() => sendOffer(offer.id)}
                    sending={sending === offer.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Sent/Viewed */}
          {sentOffers.length > 0 && (
            <div>
              <h2 className="font-medium text-sm text-muted-foreground mb-3">
                Pending Response ({sentOffers.length})
              </h2>
              <div className="space-y-2">
                {sentOffers.map(offer => (
                  <OfferRow key={offer.id} offer={offer} />
                ))}
              </div>
            </div>
          )}

          {/* Resolved */}
          {resolvedOffers.length > 0 && (
            <div>
              <h2 className="font-medium text-sm text-muted-foreground mb-3">
                Resolved ({resolvedOffers.length})
              </h2>
              <div className="space-y-2">
                {resolvedOffers.map(offer => (
                  <OfferRow key={offer.id} offer={offer} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create offer dialog */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Offer</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Candidate *</Label>
            <Select value={candidateId} onChange={e => setCandidateId(e.target.value)} className="mt-1">
              <option value="">Select candidate...</option>
              {candidates.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Job Position *</Label>
            <Select value={jobId} onChange={e => setJobId(e.target.value)} className="mt-1">
              <option value="">Select job...</option>
              {jobs.map(j => (
                <option key={j.id} value={j.id}>{j.title}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Offer Title</Label>
            <Input
              value={offerTitle}
              onChange={e => setOfferTitle(e.target.value)}
              placeholder="e.g. Senior Engineer Offer"
              className="mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Annual Salary *</Label>
              <Input
                type="number"
                value={salary}
                onChange={e => setSalary(e.target.value)}
                placeholder="e.g. 120000"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label>Benefits</Label>
            <Textarea
              value={benefits}
              onChange={e => setBenefits(e.target.value)}
              placeholder="Health insurance, 401k, PTO, etc..."
              rows={3}
              className="mt-1"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={createOffer} disabled={saving} className="gap-2">
              {saving ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <Gift className="h-4 w-4" />
              )}
              Create Offer
            </Button>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

function OfferRow({ offer, onSend, sending }: {
  offer: Offer
  onSend?: () => void
  sending?: boolean
}) {
  const config = statusConfig[offer.status] || { label: offer.status, variant: 'secondary' as const, icon: Clock }
  const Icon = config.icon

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold truncate">{offer.candidate_name || 'Unknown'}</h3>
              <Badge variant={config.variant} className="gap-1">
                <Icon className="h-3 w-3" /> {config.label}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>{offer.job_title || offer.title}</span>
              <span className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                ${Number(offer.salary).toLocaleString()}/yr
              </span>
              {offer.start_date && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Start: {new Date(offer.start_date).toLocaleDateString()}
                </span>
              )}
              {offer.decline_reason && (
                <span className="text-destructive">Reason: {offer.decline_reason}</span>
              )}
            </div>
          </div>
          {offer.status === 'draft' && onSend && (
            <Button size="sm" onClick={onSend} disabled={sending} className="gap-1 shrink-0">
              {sending ? (
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Send to Candidate
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
