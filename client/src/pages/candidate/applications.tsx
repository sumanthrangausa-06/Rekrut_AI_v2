import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import {
  FileText, Building2, MapPin, Calendar, ExternalLink, XCircle, AlertTriangle,
  Clock, CheckCircle, Briefcase, DollarSign, Filter,
} from 'lucide-react'

interface Application {
  id: number
  job_id: number
  status: string
  title: string
  company: string
  location: string
  salary_range: string
  posted_by_company?: string
  applied_at: string
  updated_at: string
  match_score?: number
  cover_letter?: string
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  applied: { label: 'Applied', variant: 'secondary' },
  reviewing: { label: 'Under Review', variant: 'warning' },
  shortlisted: { label: 'Shortlisted', variant: 'default' },
  interviewed: { label: 'Interviewed', variant: 'default' },
  offered: { label: 'Offer Received', variant: 'success' },
  hired: { label: 'Hired', variant: 'success' },
  rejected: { label: 'Not Selected', variant: 'destructive' },
  withdrawn: { label: 'Withdrawn', variant: 'secondary' },
}

export function CandidateApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [withdrawTarget, setWithdrawTarget] = useState<Application | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [selectedApp, setSelectedApp] = useState<Application | null>(null)

  useEffect(() => {
    loadApplications()
  }, [])

  async function loadApplications() {
    try {
      const data = await apiCall<{ success: boolean; applications: Application[] }>('/candidate/applications')
      setApplications(data.applications || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function withdrawApplication() {
    if (!withdrawTarget) return
    setWithdrawing(true)
    try {
      await apiCall(`/candidate/applications/${withdrawTarget.id}/withdraw`, {
        method: 'PUT',
      })
      // Update local state
      setApplications(prev =>
        prev.map(a => a.id === withdrawTarget.id ? { ...a, status: 'withdrawn' } : a)
      )
      setWithdrawTarget(null)
      setSelectedApp(null)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to withdraw application')
    } finally {
      setWithdrawing(false)
    }
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days} days ago`
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`
    return `${Math.floor(days / 30)} months ago`
  }

  const statuses = ['applied', 'reviewing', 'shortlisted', 'interviewed', 'offered', 'hired', 'rejected', 'withdrawn']
  const statusCounts = statuses.reduce((acc, s) => {
    acc[s] = applications.filter(a => a.status === s).length
    return acc
  }, {} as Record<string, number>)

  const filtered = applications.filter(a => !statusFilter || a.status === statusFilter)

  // Group by status
  const active = filtered.filter(a => !['rejected', 'withdrawn', 'hired'].includes(a.status))
  const completed = filtered.filter(a => ['rejected', 'withdrawn', 'hired'].includes(a.status))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">My Applications</h1>
        <p className="text-muted-foreground">Track your job application status and manage active applications</p>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{applications.length}</p>
            <p className="text-xs text-muted-foreground">Total Applied</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">
              {applications.filter(a => !['rejected', 'withdrawn', 'hired'].includes(a.status)).length}
            </p>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">
              {applications.filter(a => ['reviewing', 'interviewed'].includes(a.status)).length}
            </p>
            <p className="text-xs text-muted-foreground">In Progress</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">
              {applications.filter(a => ['offered', 'hired'].includes(a.status)).length}
            </p>
            <p className="text-xs text-muted-foreground">Offers / Hired</p>
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
          All ({applications.length})
        </Button>
        {statuses.map(s => (
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
      ) : applications.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-muted-foreground mb-4">You haven't applied to any jobs yet</p>
            <Link to="/candidate/jobs">
              <Button>Browse Jobs</Button>
            </Link>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Filter className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-muted-foreground">No applications match this filter</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <div>
              <h2 className="font-medium text-sm text-muted-foreground mb-3">Active Applications ({active.length})</h2>
              <div className="space-y-3">
                {active.map(app => (
                  <ApplicationCard
                    key={app.id}
                    app={app}
                    timeAgo={timeAgo}
                    onWithdraw={() => setWithdrawTarget(app)}
                    onClick={() => setSelectedApp(app)}
                  />
                ))}
              </div>
            </div>
          )}

          {completed.length > 0 && (
            <div>
              <h2 className="font-medium text-sm text-muted-foreground mb-3">Completed ({completed.length})</h2>
              <div className="space-y-3">
                {completed.map(app => (
                  <ApplicationCard
                    key={app.id}
                    app={app}
                    timeAgo={timeAgo}
                    onClick={() => setSelectedApp(app)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Application detail dialog */}
      {selectedApp && (
        <Dialog open={true} onClose={() => setSelectedApp(null)} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedApp.title}</DialogTitle>
            <DialogDescription>
              {selectedApp.company || selectedApp.posted_by_company || 'Company'}
              {selectedApp.location ? ` • ${selectedApp.location}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Status */}
            {(() => {
              const config = statusConfig[selectedApp.status] || { label: selectedApp.status, variant: 'secondary' as const }
              return <Badge variant={config.variant} className="w-fit">{config.label}</Badge>
            })()}

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Applied
                </p>
                <p className="font-medium">{new Date(selectedApp.applied_at).toLocaleDateString()}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Last Update
                </p>
                <p className="font-medium">{timeAgo(selectedApp.updated_at)}</p>
              </div>
              {selectedApp.salary_range && (
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <DollarSign className="h-3 w-3" /> Salary
                  </p>
                  <p className="font-medium">{selectedApp.salary_range}</p>
                </div>
              )}
              {selectedApp.match_score && (
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Match Score</p>
                  <p className="font-medium text-primary">{selectedApp.match_score}%</p>
                </div>
              )}
            </div>

            {/* Progress timeline */}
            <ApplicationTimeline status={selectedApp.status} />

            {/* Cover letter */}
            {selectedApp.cover_letter && (
              <div>
                <h4 className="font-medium text-sm mb-1">Your Cover Letter</h4>
                <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {selectedApp.cover_letter}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Link to={`/candidate/jobs/${selectedApp.job_id}`} className="flex-1">
                <Button variant="outline" className="gap-2 w-full">
                  <ExternalLink className="h-4 w-4" /> View Job
                </Button>
              </Link>
              {!['rejected', 'withdrawn', 'hired'].includes(selectedApp.status) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedApp(null)
                    setWithdrawTarget(selectedApp)
                  }}
                  className="gap-2 text-destructive hover:text-destructive"
                >
                  <XCircle className="h-4 w-4" /> Withdraw
                </Button>
              )}
            </div>
          </div>
        </Dialog>
      )}

      {/* Withdraw confirmation dialog */}
      {withdrawTarget && (
        <Dialog open={true} onClose={() => !withdrawing && setWithdrawTarget(null)} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Withdraw Application?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to withdraw your application for{' '}
              <strong>{withdrawTarget.title}</strong> at{' '}
              <strong>{withdrawTarget.company || withdrawTarget.posted_by_company || 'this company'}</strong>?
            </p>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              This action cannot be undone. You may need to reapply if you change your mind.
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setWithdrawTarget(null)}
                disabled={withdrawing}
                className="flex-1"
              >
                Keep Application
              </Button>
              <Button
                variant="destructive"
                onClick={withdrawApplication}
                disabled={withdrawing}
                className="gap-2 flex-1"
              >
                {withdrawing ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                Withdraw
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}

function ApplicationTimeline({ status }: { status: string }) {
  const steps = [
    { key: 'applied', label: 'Applied', icon: FileText },
    { key: 'reviewing', label: 'Review', icon: Clock },
    { key: 'interviewed', label: 'Interview', icon: Briefcase },
    { key: 'offered', label: 'Offer', icon: CheckCircle },
  ]

  const stepIndex = {
    applied: 0, reviewing: 1, shortlisted: 1, interviewed: 2,
    offered: 3, hired: 4, rejected: -1, withdrawn: -1,
  }[status] ?? 0

  if (stepIndex < 0) return null

  return (
    <div>
      <h4 className="font-medium text-sm mb-3">Progress</h4>
      <div className="flex items-center gap-1">
        {steps.map((step, i) => {
          const isComplete = i <= stepIndex
          const Icon = step.icon
          return (
            <div key={step.key} className="flex items-center gap-1 flex-1">
              <div className={`flex items-center gap-1.5 ${isComplete ? 'text-primary' : 'text-muted-foreground/50'}`}>
                <div className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                  isComplete ? 'border-primary bg-primary/10' : 'border-muted'
                }`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span className="text-[11px] font-medium hidden sm:inline">{step.label}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 ${i < stepIndex ? 'bg-primary' : 'bg-muted'}`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ApplicationCard({
  app,
  timeAgo,
  onWithdraw,
  onClick,
}: {
  app: Application
  timeAgo: (d: string) => string
  onWithdraw?: () => void
  onClick?: () => void
}) {
  const config = statusConfig[app.status] || { label: app.status, variant: 'secondary' as const }

  // Progress steps
  const steps = ['Applied', 'Reviewing', 'Interview', 'Offer']
  const currentStep = {
    applied: 0, reviewing: 1, shortlisted: 1, interviewed: 2,
    offered: 3, hired: 4, rejected: -1, withdrawn: -1,
  }[app.status] ?? 0

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold truncate">{app.title}</h3>
              <Badge variant={config.variant}>{config.label}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                {app.company || app.posted_by_company || 'Company'}
              </span>
              {app.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {app.location}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                Applied {timeAgo(app.applied_at)}
              </span>
              {app.salary_range && (
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3.5 w-3.5" />
                  {app.salary_range}
                </span>
              )}
            </div>

            {/* Progress timeline */}
            {currentStep >= 0 && (
              <div className="mt-3 flex items-center gap-1">
                {steps.map((step, i) => (
                  <div key={step} className="flex items-center gap-1">
                    <div className={`h-2 w-2 rounded-full ${i <= currentStep ? 'bg-primary' : 'bg-muted'}`} />
                    <span className={`text-[10px] ${i <= currentStep ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {step}
                    </span>
                    {i < steps.length - 1 && (
                      <div className={`h-px w-4 ${i < currentStep ? 'bg-primary' : 'bg-muted'}`} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onWithdraw && !['rejected', 'withdrawn', 'hired'].includes(app.status) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={e => {
                  e.stopPropagation()
                  onWithdraw()
                }}
                className="gap-1 text-muted-foreground hover:text-destructive"
              >
                <XCircle className="h-3.5 w-3.5" /> Withdraw
              </Button>
            )}
            <Link
              to={`/candidate/jobs/${app.job_id}`}
              onClick={e => e.stopPropagation()}
            >
              <Button variant="ghost" size="sm" className="gap-1 shrink-0">
                View Job <ExternalLink className="h-3 w-3" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
