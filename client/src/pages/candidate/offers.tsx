import { useEffect, useState } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Gift, DollarSign, Calendar, Building2, CheckCircle, XCircle, Clock, Eye,
} from 'lucide-react'

interface Offer {
  id: number
  title: string
  company_name: string
  company?: string
  job_title: string
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

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive'; icon: React.ElementType }> = {
  draft: { label: 'Draft', variant: 'secondary', icon: Clock },
  sent: { label: 'Pending', variant: 'warning', icon: Clock },
  viewed: { label: 'Viewed', variant: 'default', icon: Eye },
  accepted: { label: 'Accepted', variant: 'success', icon: CheckCircle },
  declined: { label: 'Declined', variant: 'destructive', icon: XCircle },
}

export function CandidateOffersPage() {
  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null)
  const [declineDialog, setDeclineDialog] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [acting, setActing] = useState(false)

  useEffect(() => {
    loadOffers()
  }, [])

  async function loadOffers() {
    try {
      const data = await apiCall<Offer[]>('/onboarding/offers/me')
      setOffers(Array.isArray(data) ? data : [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function markViewed(offer: Offer) {
    if (!offer.viewed_at) {
      try {
        await apiCall(`/onboarding/offers/${offer.id}/view`, { method: 'POST' })
      } catch {
        // silent
      }
    }
    setSelectedOffer(offer)
  }

  async function acceptOffer() {
    if (!selectedOffer) return
    setActing(true)
    try {
      await apiCall(`/onboarding/offers/${selectedOffer.id}/accept`, { method: 'POST' })
      setSelectedOffer(null)
      loadOffers()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to accept offer')
    } finally {
      setActing(false)
    }
  }

  async function declineOffer() {
    if (!selectedOffer) return
    setActing(true)
    try {
      await apiCall(`/onboarding/offers/${selectedOffer.id}/decline`, {
        method: 'POST',
        body: { decline_reason: declineReason },
      })
      setDeclineDialog(false)
      setSelectedOffer(null)
      setDeclineReason('')
      loadOffers()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to decline offer')
    } finally {
      setActing(false)
    }
  }

  const pendingOffers = offers.filter(o => ['sent', 'viewed'].includes(o.status))
  const resolvedOffers = offers.filter(o => ['accepted', 'declined'].includes(o.status))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">My Offers</h1>
        <p className="text-muted-foreground">Review and respond to job offers</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : offers.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Gift className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-muted-foreground">No offers yet</p>
            <p className="text-sm text-muted-foreground mt-1">When a recruiter makes you an offer, it will appear here</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {pendingOffers.length > 0 && (
            <div>
              <h2 className="font-medium text-sm text-muted-foreground mb-3">
                Pending Offers ({pendingOffers.length})
              </h2>
              <div className="space-y-3">
                {pendingOffers.map(offer => (
                  <OfferCard key={offer.id} offer={offer} onClick={() => markViewed(offer)} />
                ))}
              </div>
            </div>
          )}
          {resolvedOffers.length > 0 && (
            <div>
              <h2 className="font-medium text-sm text-muted-foreground mb-3">Past Offers</h2>
              <div className="space-y-3">
                {resolvedOffers.map(offer => (
                  <OfferCard key={offer.id} offer={offer} onClick={() => setSelectedOffer(offer)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Offer detail dialog */}
      {selectedOffer && !declineDialog && (
        <Dialog open={true} onClose={() => setSelectedOffer(null)} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedOffer.title || selectedOffer.job_title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Company</p>
                <p className="font-medium">{selectedOffer.company_name || selectedOffer.company}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Position</p>
                <p className="font-medium">{selectedOffer.job_title || selectedOffer.title}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Salary</p>
                <p className="font-medium text-emerald-600">
                  ${Number(selectedOffer.salary).toLocaleString()}/yr
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Start Date</p>
                <p className="font-medium">
                  {selectedOffer.start_date
                    ? new Date(selectedOffer.start_date).toLocaleDateString()
                    : 'TBD'}
                </p>
              </div>
            </div>
            {selectedOffer.benefits && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">Benefits</p>
                <p className="text-sm whitespace-pre-wrap">{selectedOffer.benefits}</p>
              </div>
            )}

            {['sent', 'viewed'].includes(selectedOffer.status) && (
              <div className="flex gap-2 pt-2">
                <Button onClick={acceptOffer} disabled={acting} className="flex-1 gap-2">
                  <CheckCircle className="h-4 w-4" /> Accept Offer
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setDeclineDialog(true)}
                  disabled={acting}
                  className="flex-1 gap-2"
                >
                  <XCircle className="h-4 w-4" /> Decline
                </Button>
              </div>
            )}

            {selectedOffer.status === 'accepted' && (
              <Badge variant="success" className="w-full justify-center py-2 text-sm">
                <CheckCircle className="h-4 w-4 mr-1" /> You accepted this offer
              </Badge>
            )}
            {selectedOffer.status === 'declined' && (
              <div>
                <Badge variant="destructive" className="w-full justify-center py-2 text-sm">
                  <XCircle className="h-4 w-4 mr-1" /> You declined this offer
                </Badge>
                {selectedOffer.decline_reason && (
                  <p className="text-sm text-muted-foreground mt-2">Reason: {selectedOffer.decline_reason}</p>
                )}
              </div>
            )}
          </div>
        </Dialog>
      )}

      {/* Decline reason dialog */}
      <Dialog open={declineDialog} onClose={() => setDeclineDialog(false)}>
        <DialogHeader>
          <DialogTitle>Decline Offer</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to decline this offer? Please provide a reason (optional).
          </p>
          <Textarea
            placeholder="Reason for declining..."
            value={declineReason}
            onChange={e => setDeclineReason(e.target.value)}
            rows={3}
          />
          <div className="flex gap-2">
            <Button variant="destructive" onClick={declineOffer} disabled={acting} className="gap-2">
              {acting ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              Confirm Decline
            </Button>
            <Button variant="outline" onClick={() => setDeclineDialog(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

function OfferCard({ offer, onClick }: { offer: Offer; onClick: () => void }) {
  const config = statusConfig[offer.status] || { label: offer.status, variant: 'secondary' as const, icon: Clock }
  const Icon = config.icon

  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold">{offer.title || offer.job_title}</h3>
              <Badge variant={config.variant} className="gap-1">
                <Icon className="h-3 w-3" /> {config.label}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                {offer.company_name || offer.company}
              </span>
              <span className="flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5" />
                ${Number(offer.salary).toLocaleString()}/yr
              </span>
              {offer.start_date && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  Start: {new Date(offer.start_date).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
