import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import {
  ArrowLeft, Plus, Send, Save, FileText, CheckCircle, XCircle, Clock,
  AlertTriangle, Loader2, DollarSign, Calendar, User, Briefcase,
} from 'lucide-react'

interface Offer {
  id: number
  candidate_name: string
  candidate_email: string
  title: string
  job_title: string | null
  salary: number
  start_date: string | null
  status: 'draft' | 'sent' | 'accepted' | 'declined'
  benefits: string | null
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

export function OfferManagementPage() {
  const navigate = useNavigate()
  const [offers, setOffers] = useState<Offer[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sending, setSending] = useState<number | null>(null)

  const [formData, setFormData] = useState({
    candidate_id: '',
    job_id: '',
    title: '',
    salary: '',
    start_date: '',
    benefits: '',
  })

  useEffect(() => {
    async function loadData() {
      try {
        const [offersRes, candidatesRes, jobsRes] = await Promise.all([
          apiCall<{ offers: Offer[] }>('/onboarding/offers'),
          apiCall<{ candidates: Candidate[] }>('/recruiter/candidates'),
          apiCall<{ jobs: Job[] }>('/jobs'),
        ])
        setOffers(offersRes.offers || [])
        setCandidates(candidatesRes.candidates || [])
        setJobs(jobsRes.jobs || [])
      } catch (err) {
        console.error('Failed to load data:', err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const stats = {
    total: offers.length,
    pending: offers.filter((o) => o.status === 'sent').length,
    accepted: offers.filter((o) => o.status === 'accepted').length,
    declined: offers.filter((o) => o.status === 'declined').length,
  }

  async function createOffer(sendImmediately: boolean) {
    if (!formData.candidate_id || !formData.job_id || !formData.title || !formData.salary) return

    setSubmitting(true)
    try {
      const res = await apiCall<{ offer: Offer }>('/onboarding/offers', {
        method: 'POST',
        body: {
          candidate_id: parseInt(formData.candidate_id),
          job_id: parseInt(formData.job_id),
          title: formData.title,
          salary: parseFloat(formData.salary),
          start_date: formData.start_date || null,
          benefits: formData.benefits || null,
        },
      })

      if (sendImmediately && res.offer) {
        await sendOffer(res.offer.id)
      }

      setFormData({
        candidate_id: '',
        job_id: '',
        title: '',
        salary: '',
        start_date: '',
        benefits: '',
      })
      setShowCreate(false)

      // Refresh offers
      const offersRes = await apiCall<{ offers: Offer[] }>('/onboarding/offers')
      setOffers(offersRes.offers || [])
    } catch (err) {
      console.error('Failed to create offer:', err)
    } finally {
      setSubmitting(false)
    }
  }

  async function sendOffer(offerId: number) {
    setSending(offerId)
    try {
      await apiCall(`/onboarding/offers/${offerId}/send`, {
        method: 'POST',
      })
      const offersRes = await apiCall<{ offers: Offer[] }>('/onboarding/offers')
      setOffers(offersRes.offers || [])
    } catch (err) {
      console.error('Failed to send offer:', err)
    } finally {
      setSending(null)
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'draft':
        return (
          <Badge variant="outline">
            <Clock className="h-3 w-3 mr-1" />
            Draft
          </Badge>
        )
      case 'sent':
        return (
          <Badge variant="secondary" className="text-amber-700 bg-amber-100">
            <Send className="h-3 w-3 mr-1" />
            Sent
          </Badge>
        )
      case 'accepted':
        return (
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
            <CheckCircle className="h-3 w-3 mr-1" />
            Accepted
          </Badge>
        )
      case 'declined':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
            <XCircle className="h-3 w-3 mr-1" />
            Declined
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading offers...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate('/candidate')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create New Offer
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Offer Management</h1>
        <p className="text-muted-foreground">Create, send, and track job offers</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <FileText className="h-8 w-8 text-primary mx-auto mb-2" />
            <div className="text-3xl font-bold">{stats.total}</div>
            <div className="text-sm text-muted-foreground">Total Offers</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Send className="h-8 w-8 text-amber-500 mx-auto mb-2" />
            <div className="text-3xl font-bold text-amber-600">{stats.pending}</div>
            <div className="text-sm text-muted-foreground">Pending Response</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
            <div className="text-3xl font-bold text-emerald-600">{stats.accepted}</div>
            <div className="text-sm text-muted-foreground">Accepted</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <XCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
            <div className="text-3xl font-bold text-red-600">{stats.declined}</div>
            <div className="text-sm text-muted-foreground">Declined</div>
          </CardContent>
        </Card>
      </div>

      {/* Offers Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            All Offers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">Candidate</th>
                  <th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">Position</th>
                  <th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">Salary</th>
                  <th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">Start Date</th>
                  <th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">Status</th>
                  <th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {offers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-muted-foreground">
                      <FileText className="h-12 w-12 mx-auto mb-2" />
                      <p>No offers created yet</p>
                    </td>
                  </tr>
                ) : (
                  offers.map((offer) => (
                    <tr key={offer.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-4">
                        <div className="font-medium">{offer.candidate_name || 'Unknown'}</div>
                        <div className="text-sm text-muted-foreground">{offer.candidate_email}</div>
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">{offer.title || offer.job_title || 'N/A'}</td>
                      <td className="px-4 py-4 text-muted-foreground">${offer.salary.toLocaleString()}</td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {offer.start_date ? new Date(offer.start_date).toLocaleDateString() : 'TBD'}
                      </td>
                      <td className="px-4 py-4">{getStatusBadge(offer.status)}</td>
                      <td className="px-4 py-4">
                        {offer.status === 'draft' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => sendOffer(offer.id)}
                            disabled={sending === offer.id}
                          >
                            {sending === offer.id ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : (
                              <Send className="h-4 w-4 mr-1" />
                            )}
                            Send
                          </Button>
                        )}
                        {offer.status === 'sent' && (
                          <span className="text-sm text-muted-foreground">Awaiting response</span>
                        )}
                        {(offer.status === 'accepted' || offer.status === 'declined') && (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Create Offer Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-background rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Create New Offer</h2>
                <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                  ✕
                </Button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <Label htmlFor="candidate">Candidate</Label>
                <select
                  id="candidate"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={formData.candidate_id}
                  onChange={(e) => setFormData((prev) => ({ ...prev, candidate_id: e.target.value }))}
                >
                  <option value="">Select candidate...</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} - {c.email}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="job">Job Position</Label>
                <select
                  id="job"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={formData.job_id}
                  onChange={(e) => setFormData((prev) => ({ ...prev, job_id: e.target.value }))}
                >
                  <option value="">Select job...</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="title">Job Title</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g., Senior Software Engineer"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="salary">Annual Salary</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="salary"
                      type="number"
                      min="0"
                      step="1000"
                      className="pl-8"
                      value={formData.salary}
                      onChange={(e) => setFormData((prev) => ({ ...prev, salary: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="start_date">Start Date</Label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="start_date"
                      type="date"
                      className="pl-8"
                      value={formData.start_date}
                      onChange={(e) => setFormData((prev) => ({ ...prev, start_date: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div>
                <Label htmlFor="benefits">Benefits Package</Label>
                <Textarea
                  id="benefits"
                  value={formData.benefits}
                  onChange={(e) => setFormData((prev) => ({ ...prev, benefits: e.target.value }))}
                  placeholder="Health insurance, 401(k), PTO, etc."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => createOffer(false)}
                  disabled={submitting}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save as Draft
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => createOffer(true)}
                  disabled={submitting}
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Send Offer
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
