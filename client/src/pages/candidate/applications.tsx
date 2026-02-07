import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  FileText, Building2, MapPin, Calendar, Clock, ExternalLink,
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

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days} days ago`
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`
    return `${Math.floor(days / 30)} months ago`
  }

  // Group by status
  const active = applications.filter(a => !['rejected', 'withdrawn', 'hired'].includes(a.status))
  const completed = applications.filter(a => ['rejected', 'withdrawn', 'hired'].includes(a.status))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">My Applications</h1>
        <p className="text-muted-foreground">Track your job application status</p>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{applications.length}</p>
            <p className="text-xs text-muted-foreground">Total Applied</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{active.length}</p>
            <p className="text-xs text-muted-foreground">Active</p>
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
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <div>
              <h2 className="font-medium text-sm text-muted-foreground mb-3">Active Applications ({active.length})</h2>
              <div className="space-y-3">
                {active.map(app => (
                  <ApplicationCard key={app.id} app={app} timeAgo={timeAgo} />
                ))}
              </div>
            </div>
          )}

          {completed.length > 0 && (
            <div>
              <h2 className="font-medium text-sm text-muted-foreground mb-3">Completed ({completed.length})</h2>
              <div className="space-y-3">
                {completed.map(app => (
                  <ApplicationCard key={app.id} app={app} timeAgo={timeAgo} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ApplicationCard({ app, timeAgo }: { app: Application; timeAgo: (d: string) => string }) {
  const config = statusConfig[app.status] || { label: app.status, variant: 'secondary' as const }

  // Build timeline steps
  const steps = ['Applied', 'Reviewing', 'Interview', 'Offer']
  const currentStep = {
    applied: 0, reviewing: 1, shortlisted: 1, interviewed: 2,
    offered: 3, hired: 4, rejected: -1, withdrawn: -1,
  }[app.status] ?? 0

  return (
    <Card>
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
          <Link to={`/candidate/jobs/${app.job_id}`}>
            <Button variant="ghost" size="sm" className="gap-1 shrink-0">
              View Job <ExternalLink className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
