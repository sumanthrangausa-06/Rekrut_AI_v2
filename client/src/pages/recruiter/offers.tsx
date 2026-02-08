import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Gift, Plus, Send, DollarSign, Calendar, CheckCircle, XCircle, Clock, Eye,
  Ban, FileText, User, Briefcase, Building2, Sparkles, Download, RefreshCw,
  MapPin, UserCheck, PenTool,
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
  reporting_to: string
  location: string
  employment_type: string
  status: string
  sent_at: string
  viewed_at: string
  accepted_at: string
  declined_at: string
  decline_reason: string
  created_at: string
  has_letter: boolean
  offer_letter_html: string
  offer_letter_generated_at: string
  candidate_signature: string
  candidate_signed_at: string
}

interface Candidate {
  id: number
  name: string
  email: string
}

interface Job {
  id: number
  title: string
  location?: string
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive'; icon: React.ElementType }> = {
  draft: { label: 'Draft', variant: 'secondary', icon: Clock },
  sent: { label: 'Sent', variant: 'warning', icon: Send },
  viewed: { label: 'Viewed', variant: 'default', icon: Eye },
  accepted: { label: 'Accepted', variant: 'success', icon: CheckCircle },
  declined: { label: 'Declined', variant: 'destructive', icon: XCircle },
  withdrawn: { label: 'Withdrawn', variant: 'secondary', icon: Ban },
}

export function RecruiterOffersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [offers, setOffers] = useState<Offer[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState<number | null>(null)
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [generating, setGenerating] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [previewOfferId, setPreviewOfferId] = useState<number | null>(null)

  // Form fields
  const [candidateId, setCandidateId] = useState('')
  const [jobId, setJobId] = useState('')
  const [offerTitle, setOfferTitle] = useState('')
  const [salary, setSalary] = useState('')
  const [startDate, setStartDate] = useState('')
  const [benefits, setBenefits] = useState('')
  const [reportingTo, setReportingTo] = useState('')
  const [location, setLocation] = useState('')
  const [employmentType, setEmploymentType] = useState('full-time')

  useEffect(() => {
    loadData()
  }, [])

  // Handle query params for pre-filled offer creation
  useEffect(() => {
    const create = searchParams.get('create')
    const cId = searchParams.get('candidateId')
    const jId = searchParams.get('jobId')

    if (create === '1') {
      if (cId) setCandidateId(cId)
      if (jId) setJobId(jId)
      setShowCreate(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams])

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
      const newOffer = await apiCall<Offer>('/onboarding/offers', {
        method: 'POST',
        body: {
          candidate_id: Number(candidateId),
          job_id: Number(jobId),
          title: offerTitle || jobs.find(j => j.id === Number(jobId))?.title || 'Job Offer',
          salary: Number(salary),
          start_date: startDate || null,
          benefits,
          reporting_to: reportingTo || null,
          location: location || null,
          employment_type: employmentType,
        },
      })
      setShowCreate(false)
      resetForm()
      await loadData()
      // Auto-open the new offer to generate a letter
      if (newOffer?.id) {
        const refreshed = offers.find(o => o.id === newOffer.id) || newOffer
        setSelectedOffer(refreshed as Offer)
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create offer')
    } finally {
      setSaving(false)
    }
  }

  async function generateLetter(offerId: number) {
    setGenerating(true)
    try {
      const result = await apiCall<{ success: boolean; offer_letter_html: string }>(`/onboarding/offers/${offerId}/generate-letter`, {
        method: 'POST',
      })
      if (result.offer_letter_html) {
        setPreviewHtml(result.offer_letter_html)
        setPreviewOfferId(offerId)
        setShowPreview(true)
        // Update the offer in local state
        setOffers(prev => prev.map(o => o.id === offerId ? { ...o, has_letter: true, offer_letter_html: result.offer_letter_html } : o))
        if (selectedOffer?.id === offerId) {
          setSelectedOffer(prev => prev ? { ...prev, has_letter: true, offer_letter_html: result.offer_letter_html } : null)
        }
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to generate offer letter')
    } finally {
      setGenerating(false)
    }
  }

  async function viewLetter(offerId: number) {
    try {
      const result = await apiCall<{ offer_letter_html: string }>(`/onboarding/offers/${offerId}/letter`)
      if (result.offer_letter_html) {
        setPreviewHtml(result.offer_letter_html)
        setPreviewOfferId(offerId)
        setShowPreview(true)
      }
    } catch {
      alert('Failed to load offer letter')
    }
  }

  async function sendOffer(id: number, e?: React.MouseEvent) {
    e?.stopPropagation()
    setSending(id)
    try {
      await apiCall(`/onboarding/offers/${id}/send`, { method: 'POST' })
      loadData()
      if (selectedOffer?.id === id) {
        setSelectedOffer(prev => prev ? { ...prev, status: 'sent', sent_at: new Date().toISOString() } : null)
      }
    } catch {
      // silent
    } finally {
      setSending(null)
    }
  }

  async function withdrawOffer(id: number) {
    if (!confirm('Are you sure you want to withdraw this offer?')) return
    setWithdrawing(true)
    try {
      await apiCall(`/onboarding/offers/${id}/withdraw`, { method: 'POST' })
      setSelectedOffer(null)
      loadData()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to withdraw offer')
    } finally {
      setWithdrawing(false)
    }
  }

  function resetForm() {
    setCandidateId('')
    setJobId('')
    setOfferTitle('')
    setSalary('')
    setStartDate('')
    setBenefits('')
    setReportingTo('')
    setLocation('')
    setEmploymentType('full-time')
  }

  const allStatuses = ['draft', 'sent', 'viewed', 'accepted', 'declined', 'withdrawn']
  const statusCounts = allStatuses.reduce((acc, s) => {
    acc[s] = offers.filter(o => o.status === s).length
    return acc
  }, {} as Record<string, number>)

  const filtered = offers.filter(o => !statusFilter || o.status === statusFilter)

  const draftOffers = filtered.filter(o => o.status === 'draft')
  const pendingOffers = filtered.filter(o => ['sent', 'viewed'].includes(o.status))
  const resolvedOffers = filtered.filter(o => ['accepted', 'declined', 'withdrawn'].includes(o.status))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Offers</h1>
          <p className="text-muted-foreground">Create AI-generated professional offer letters</p>
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
            <p className="text-2xl font-bold text-amber-600">
              {offers.filter(o => ['sent', 'viewed'].includes(o.status)).length}
            </p>
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

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={!statusFilter ? 'default' : 'outline'}
          size="sm"
          onClick={() => setStatusFilter('')}
        >
          All ({offers.length})
        </Button>
        {allStatuses.map(s => (
          statusCounts[s] > 0 ? (
            <Button
              key={s}
              variant={statusFilter === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {statusConfig[s]?.label || s} ({statusCounts[s]})
            </Button>
          ) : null
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Gift className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-muted-foreground mb-4">
              {offers.length === 0 ? 'No offers created yet' : 'No offers match this filter'}
            </p>
            {offers.length === 0 && (
              <Button onClick={() => setShowCreate(true)} className="gap-2">
                <Plus className="h-4 w-4" /> Create Your First Offer
              </Button>
            )}
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
                    onSend={(e) => sendOffer(offer.id, e)}
                    sending={sending === offer.id}
                    onClick={() => setSelectedOffer(offer)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Pending */}
          {pendingOffers.length > 0 && (
            <div>
              <h2 className="font-medium text-sm text-muted-foreground mb-3">
                Pending Response ({pendingOffers.length})
              </h2>
              <div className="space-y-2">
                {pendingOffers.map(offer => (
                  <OfferRow key={offer.id} offer={offer} onClick={() => setSelectedOffer(offer)} />
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
                  <OfferRow key={offer.id} offer={offer} onClick={() => setSelectedOffer(offer)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Offer detail dialog */}
      {selectedOffer && !showPreview && (
        <Dialog open={true} onClose={() => setSelectedOffer(null)} className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-primary" />
              Offer Details
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Status badge */}
            {(() => {
              const config = statusConfig[selectedOffer.status] || { label: selectedOffer.status, variant: 'secondary' as const, icon: Clock }
              const Icon = config.icon
              return (
                <Badge variant={config.variant} className="gap-1 w-fit">
                  <Icon className="h-3 w-3" /> {config.label}
                </Badge>
              )
            })()}

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" /> Candidate
                </p>
                <p className="font-medium">{selectedOffer.candidate_name || 'Unknown'}</p>
                <p className="text-xs text-muted-foreground">{selectedOffer.candidate_email}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Briefcase className="h-3 w-3" /> Position
                </p>
                <p className="font-medium">{selectedOffer.job_title || selectedOffer.title}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Salary
                </p>
                <p className="font-medium text-emerald-600">
                  ${Number(selectedOffer.salary).toLocaleString()}/yr
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Start Date
                </p>
                <p className="font-medium">
                  {selectedOffer.start_date
                    ? new Date(selectedOffer.start_date).toLocaleDateString()
                    : 'TBD'}
                </p>
              </div>
            </div>

            {/* Offer Letter Status */}
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="font-medium text-sm">Offer Letter Document</span>
                </div>
                {selectedOffer.has_letter && (
                  <Badge variant="success" className="gap-1 text-xs">
                    <CheckCircle className="h-3 w-3" /> Generated
                  </Badge>
                )}
              </div>
              {selectedOffer.has_letter ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => viewLetter(selectedOffer.id)}
                  >
                    <Eye className="h-3 w-3" /> Preview
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => generateLetter(selectedOffer.id)}
                    disabled={generating}
                  >
                    {generating ? (
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Regenerate
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={() => generateLetter(selectedOffer.id)}
                  disabled={generating}
                >
                  {generating ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      AI is writing your offer letter...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Generate Offer Letter with AI
                    </>
                  )}
                </Button>
              )}
            </div>

            {/* Signature status */}
            {selectedOffer.candidate_signed_at && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <PenTool className="h-4 w-4 text-emerald-600" />
                  <span className="font-medium text-sm text-emerald-800">E-Signed by Candidate</span>
                </div>
                <p className="text-xs text-emerald-700">
                  Signed on {new Date(selectedOffer.candidate_signed_at).toLocaleString()}
                </p>
              </div>
            )}

            {/* Benefits */}
            {selectedOffer.benefits && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">Benefits</p>
                <p className="text-sm whitespace-pre-wrap">{selectedOffer.benefits}</p>
              </div>
            )}

            {/* Timeline */}
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Timeline</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{new Date(selectedOffer.created_at).toLocaleDateString()}</span>
                </div>
                {selectedOffer.sent_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sent</span>
                    <span>{new Date(selectedOffer.sent_at).toLocaleDateString()}</span>
                  </div>
                )}
                {selectedOffer.viewed_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Viewed</span>
                    <span>{new Date(selectedOffer.viewed_at).toLocaleDateString()}</span>
                  </div>
                )}
                {selectedOffer.accepted_at && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Accepted</span>
                    <span>{new Date(selectedOffer.accepted_at).toLocaleDateString()}</span>
                  </div>
                )}
                {selectedOffer.declined_at && (
                  <div className="flex justify-between text-destructive">
                    <span>Declined</span>
                    <span>{new Date(selectedOffer.declined_at).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Decline reason */}
            {selectedOffer.decline_reason && (
              <div className="rounded-lg bg-destructive/10 p-3">
                <p className="text-xs text-muted-foreground mb-1">Decline Reason</p>
                <p className="text-sm">{selectedOffer.decline_reason}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              {selectedOffer.status === 'draft' && (
                <>
                  <Button
                    onClick={() => sendOffer(selectedOffer.id)}
                    disabled={sending === selectedOffer.id || !selectedOffer.has_letter}
                    className="gap-2 flex-1"
                    title={!selectedOffer.has_letter ? 'Generate offer letter first' : ''}
                  >
                    {sending === selectedOffer.id ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {selectedOffer.has_letter ? 'Send to Candidate' : 'Generate Letter First'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => withdrawOffer(selectedOffer.id)}
                    disabled={withdrawing}
                    className="gap-2"
                  >
                    <Ban className="h-4 w-4" /> Delete
                  </Button>
                </>
              )}
              {['sent', 'viewed'].includes(selectedOffer.status) && (
                <Button
                  variant="outline"
                  onClick={() => withdrawOffer(selectedOffer.id)}
                  disabled={withdrawing}
                  className="gap-2 text-destructive"
                >
                  {withdrawing ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Ban className="h-4 w-4" />
                  )}
                  Withdraw Offer
                </Button>
              )}
            </div>
          </div>
        </Dialog>
      )}

      {/* Offer Letter Preview Dialog */}
      {showPreview && (
        <Dialog
          open={true}
          onClose={() => { setShowPreview(false); setPreviewHtml(''); setPreviewOfferId(null) }}
          className="max-w-4xl"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Offer Letter Preview
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Letter preview in a document-style container */}
            <div className="bg-white rounded-lg border shadow-inner overflow-auto max-h-[70vh]">
              <div
                className="p-8"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  if (previewOfferId) generateLetter(previewOfferId)
                }}
                disabled={generating}
              >
                {generating ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Regenerate
              </Button>
              <Button
                className="gap-2"
                onClick={() => {
                  setShowPreview(false)
                  setPreviewHtml('')
                  setPreviewOfferId(null)
                }}
              >
                <CheckCircle className="h-4 w-4" />
                Looks Good
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Create offer dialog */}
      <Dialog open={showCreate} onClose={() => { setShowCreate(false); resetForm() }} className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Create Offer Letter
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2 mb-2">
          Fill in the key terms below. AI will generate a professional offer letter document.
        </p>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
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
              <Label>Annual Salary ($) *</Label>
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Reporting To</Label>
              <Input
                value={reportingTo}
                onChange={e => setReportingTo(e.target.value)}
                placeholder="e.g. VP of Engineering"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Location</Label>
              <Input
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="e.g. San Francisco, CA"
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label>Employment Type</Label>
            <Select value={employmentType} onChange={e => setEmploymentType(e.target.value)} className="mt-1">
              <option value="full-time">Full-time</option>
              <option value="part-time">Part-time</option>
              <option value="contract">Contract</option>
              <option value="internship">Internship</option>
            </Select>
          </div>
          <div>
            <Label>Benefits</Label>
            <Textarea
              value={benefits}
              onChange={e => setBenefits(e.target.value)}
              placeholder="Health insurance, 401k, PTO, stock options, etc..."
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
            <Button variant="outline" onClick={() => { setShowCreate(false); resetForm() }}>Cancel</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

function OfferRow({ offer, onSend, sending, onClick }: {
  offer: Offer
  onSend?: (e: React.MouseEvent) => void
  sending?: boolean
  onClick?: () => void
}) {
  const config = statusConfig[offer.status] || { label: offer.status, variant: 'secondary' as const, icon: Clock }
  const Icon = config.icon

  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold truncate">{offer.candidate_name || 'Unknown'}</h3>
              <Badge variant={config.variant} className="gap-1">
                <Icon className="h-3 w-3" /> {config.label}
              </Badge>
              {offer.has_letter && (
                <Badge variant="default" className="gap-1 text-xs bg-indigo-100 text-indigo-700 border-indigo-200">
                  <FileText className="h-3 w-3" /> Letter
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Briefcase className="h-3 w-3" />
                {offer.job_title || offer.title}
              </span>
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
          <div className="flex items-center gap-2 shrink-0">
            {offer.status === 'draft' && onSend && (
              <Button size="sm" onClick={onSend} disabled={sending || !offer.has_letter} className="gap-1">
                {sending ? (
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Send
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
