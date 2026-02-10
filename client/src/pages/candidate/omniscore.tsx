import { useEffect, useState } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Star, TrendingUp, Building2, Zap, Shield, Users, ArrowUpRight, ArrowDownRight,
  MessageSquare, ThumbsUp, Target, Sparkles, Award, BarChart3, ChevronRight,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────
interface ScoreBreakdown {
  score: number
  max: number
  label: string
  description: string
}

interface OmniScoreData {
  total_score: number
  interview: number
  technical: number
  resume: number
  behavior: number
  tier: string
  tier_label: string
}

interface Recommendation {
  type: string
  priority: string
  title: string
  description: string
  potential_gain: number
}

interface HistoryItem {
  previous_score: number
  new_score: number
  change_amount: number
  change_reason: string
  component_type: string
  created_at: string
}

interface MutualMatch {
  job_id: number
  title: string
  location: string
  salary_range: string
  job_type: string
  company_id: number
  company_name: string
  company_tier: string
  company_trust_score: number
  application_status: string | null
  match_score: number | null
  mutual_fit_score: number
  mutual_level: string
  signals: {
    your_score: string
    company_score: string
    skill_match: string
  }
}

interface RatableCompany {
  company_id: number
  name: string
  logo_url: string | null
  industry: string | null
  is_verified: boolean
  application_status: string
  job_title: string
  job_id: number
  trust_score: number | null
  score_tier: string | null
  my_rating: number | null
}

// ─── Helpers ────────────────────────────────────────────────
const tierColors: Record<string, string> = {
  exceptional: 'text-yellow-400',
  excellent: 'text-emerald-400',
  good: 'text-green-500',
  fair: 'text-amber-500',
  needs_work: 'text-orange-500',
  new: 'text-slate-400',
}

const tierBg: Record<string, string> = {
  exceptional: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  excellent: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  good: 'bg-green-500/10 text-green-500 border-green-500/30',
  fair: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  needs_work: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  new: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
}

const mutualColors: Record<string, string> = {
  excellent: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
  good: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  fair: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  low: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
}

function ScoreRing({ score, max = 850, min = 300, size = 160 }: {
  score: number; max?: number; min?: number; size?: number
}) {
  const progress = Math.max(0, Math.min(100, ((score - min) / (max - min)) * 100))
  const radius = (size - 16) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDasharray = `${(progress / 100) * circumference} ${circumference}`

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="absolute -rotate-90" width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none"
          stroke="currentColor" className="text-muted/20" strokeWidth={10} />
        <circle cx={size/2} cy={size/2} r={radius} fill="none"
          stroke="url(#scoreGradient)" strokeWidth={10} strokeLinecap="round"
          style={{ strokeDasharray, transition: 'stroke-dasharray 1s ease' }} />
        <defs>
          <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
        </defs>
      </svg>
      <div className="flex flex-col items-center z-10">
        <span className="font-heading text-4xl font-bold">{score}</span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider">OmniScore</span>
      </div>
    </div>
  )
}

function StarRating({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'lg' }) {
  const s = size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5'
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`${s} ${i <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'}`} />
      ))}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────
export function CandidateOmniScorePage() {
  const [tab, setTab] = useState('my-score')
  const [loading, setLoading] = useState(true)

  // My Score data
  const [scoreData, setScoreData] = useState<{
    current: OmniScoreData
    breakdown: Record<string, ScoreBreakdown>
    recommendations: Recommendation[]
    history: HistoryItem[]
  } | null>(null)

  // Mutual matches
  const [matches, setMatches] = useState<MutualMatch[]>([])
  const [matchesLoading, setMatchesLoading] = useState(false)

  // Ratable companies
  const [companies, setCompanies] = useState<RatableCompany[]>([])
  const [companiesLoading, setCompaniesLoading] = useState(false)

  // Rating form
  const [ratingForm, setRatingForm] = useState<{
    company_id: number; job_id: number; company_name: string
  } | null>(null)
  const [ratings, setRatings] = useState({
    overall_rating: 0, interview_experience: 0, communication: 0,
    transparency: 0, work_life_balance: 0, culture: 0, growth_opportunity: 0,
    review_text: '', pros: '', cons: ''
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadMyScore()
  }, [])

  useEffect(() => {
    if (tab === 'matches' && matches.length === 0) loadMatches()
    if (tab === 'rate-companies' && companies.length === 0) loadCompanies()
  }, [tab])

  async function loadMyScore() {
    try {
      // Daily checkin + breakdown in parallel
      await apiCall('/omniscore/checkin', { method: 'POST' }).catch(() => {})
      const data = await apiCall<any>('/omniscore/breakdown')
      setScoreData(data)
    } catch {
      // If no score yet, still show the page
    } finally {
      setLoading(false)
    }
  }

  async function loadMatches() {
    setMatchesLoading(true)
    try {
      const data = await apiCall<any>('/omniscore/mutual-matches')
      setMatches(data.mutual_matches || [])
    } catch { }
    finally { setMatchesLoading(false) }
  }

  async function loadCompanies() {
    setCompaniesLoading(true)
    try {
      const data = await apiCall<any>('/omniscore/ratable-companies')
      setCompanies(data.companies || [])
    } catch { }
    finally { setCompaniesLoading(false) }
  }

  async function submitRating() {
    if (!ratingForm || ratings.overall_rating === 0) return
    setSubmitting(true)
    try {
      await apiCall('/omniscore/rate-company', {
        method: 'POST',
        body: {
          company_id: ratingForm.company_id,
          job_id: ratingForm.job_id,
          ...ratings,
          is_anonymous: true
        }
      })
      setRatingForm(null)
      setRatings({
        overall_rating: 0, interview_experience: 0, communication: 0,
        transparency: 0, work_life_balance: 0, culture: 0, growth_opportunity: 0,
        review_text: '', pros: '', cons: ''
      })
      loadCompanies()
    } catch { }
    finally { setSubmitting(false) }
  }

  const score = scoreData?.current
  const breakdown = scoreData?.breakdown

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">OmniScore</h1>
          <p className="text-sm text-muted-foreground">Your candidate credit score — like FICO for hiring</p>
        </div>
        <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
          <Sparkles className="h-3 w-3" /> Two-Sided Scoring
        </Badge>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="my-score">
            <Star className="h-4 w-4 mr-1.5" /> My Score
          </TabsTrigger>
          <TabsTrigger value="matches">
            <Target className="h-4 w-4 mr-1.5" /> Mutual Matches
          </TabsTrigger>
          <TabsTrigger value="rate-companies">
            <Building2 className="h-4 w-4 mr-1.5" /> Rate Companies
          </TabsTrigger>
        </TabsList>

        {/* ─── MY SCORE TAB ───────────────────────────────── */}
        <TabsContent value="my-score">
          <div className="space-y-6">
            {/* Score Hero Card */}
            <Card className="overflow-hidden border-primary/20">
              <div className="bg-gradient-to-br from-card to-primary/5 p-8">
                <div className="flex flex-col md:flex-row items-center gap-8">
                  <ScoreRing score={score?.total_score || 300} />
                  <div className="flex-1 text-center md:text-left">
                    <Badge variant="outline" className={tierBg[score?.tier || 'new']}>
                      {score?.tier_label || 'New'}
                    </Badge>
                    <h2 className="font-heading text-2xl font-bold mt-3">Your Candidate Credit Score</h2>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Ranges from 300 (minimum) to 850 (exceptional). This score is visible to recruiters
                      and affects your ranking in job matches.
                    </p>
                    <div className="flex items-center gap-3 mt-4">
                      <span className="text-xs text-muted-foreground">300</span>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full transition-all duration-1000"
                          style={{ width: `${Math.max(0, ((score?.total_score || 300) - 300) / 550 * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">850</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Score Breakdown */}
            {breakdown && (
              <div>
                <h3 className="font-heading text-lg font-semibold mb-3">Score Breakdown</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {Object.entries(breakdown).map(([key, data]) => {
                    const pct = Math.round((data.score / data.max) * 100)
                    const icons: Record<string, React.ReactNode> = {
                      interview: <MessageSquare className="h-4 w-4 text-blue-500" />,
                      technical: <Zap className="h-4 w-4 text-purple-500" />,
                      resume: <BarChart3 className="h-4 w-4 text-emerald-500" />,
                      behavior: <Shield className="h-4 w-4 text-amber-500" />,
                    }
                    return (
                      <Card key={key}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {icons[key] || <Star className="h-4 w-4" />}
                              <span className="font-medium text-sm">{data.label}</span>
                            </div>
                            <span className="text-sm font-bold text-primary">{data.score}/{data.max}</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-primary to-cyan-500 rounded-full transition-all"
                              style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">{data.description}</p>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {scoreData?.recommendations && scoreData.recommendations.length > 0 && (
              <div>
                <h3 className="font-heading text-lg font-semibold mb-3">How to Improve</h3>
                <div className="space-y-3">
                  {scoreData.recommendations.map((rec, i) => (
                    <Card key={i} className={rec.priority === 'high' ? 'border-red-500/30' : ''}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className={
                                rec.priority === 'high' ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                                'bg-amber-500/10 text-amber-500 border-amber-500/30'
                              }>
                                {rec.priority.toUpperCase()}
                              </Badge>
                              <span className="text-xs text-primary font-medium">+{rec.potential_gain} pts potential</span>
                            </div>
                            <h4 className="font-semibold">{rec.title}</h4>
                            <p className="text-sm text-muted-foreground mt-1">{rec.description}</p>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Score History */}
            {scoreData?.history && scoreData.history.length > 0 && (
              <div>
                <h3 className="font-heading text-lg font-semibold mb-3">Score History</h3>
                <Card>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {scoreData.history.map((item, i) => (
                        <div key={i} className="flex items-center gap-4 px-4 py-3">
                          <span className="text-xs text-muted-foreground w-16 shrink-0">
                            {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                          <span className="text-sm flex-1">{item.change_reason}</span>
                          <span className={`text-sm font-bold ${item.change_amount >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {item.change_amount >= 0 ? '+' : ''}{item.change_amount}
                          </span>
                          <span className="text-sm font-heading font-bold w-12 text-right">{item.new_score}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Empty state */}
            {!score || score.total_score <= 300 ? (
              <Card className="border-dashed">
                <CardContent className="p-8 text-center">
                  <Award className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                  <h3 className="font-heading text-lg font-semibold">Start Building Your Score</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                    Complete mock interviews, take skill assessments, and stay active to grow your OmniScore.
                    Higher scores get better job matches and more recruiter attention.
                  </p>
                  <div className="flex gap-3 justify-center mt-4">
                    <Button variant="default" onClick={() => window.location.href = '/candidate/assessments'}>
                      Take Assessment
                    </Button>
                    <Button variant="outline" onClick={() => window.location.href = '/candidate/ai-coaching'}>
                      Practice Interview
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </TabsContent>

        {/* ─── MUTUAL MATCHES TAB ─────────────────────────── */}
        <TabsContent value="matches">
          <div className="space-y-4">
            <Card className="bg-gradient-to-r from-primary/5 to-cyan-500/5 border-primary/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Target className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium text-sm">Mutual Fit Score</p>
                    <p className="text-xs text-muted-foreground">
                      Combines your OmniScore + company TrustScore + skill match.
                      Higher = better fit for both sides.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {matchesLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : matches.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="p-8 text-center">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                  <h3 className="font-heading text-lg font-semibold">No Mutual Matches Yet</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Apply to jobs and build your OmniScore to see mutual compatibility scores.
                  </p>
                  <Button variant="default" className="mt-4" onClick={() => window.location.href = '/candidate/jobs'}>
                    Browse Jobs
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {matches.map((match) => (
                  <Card key={`${match.job_id}-${match.company_id}`} className="hover:border-primary/30 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        {/* Company avatar */}
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-semibold text-sm truncate">{match.title}</h4>
                            <Badge variant="outline" className={mutualColors[match.mutual_level]}>
                              {match.mutual_fit_score}% Mutual Fit
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {match.company_name} · {match.location || 'Remote'} · {match.job_type || 'Full-time'}
                          </p>
                          {match.salary_range && (
                            <p className="text-xs text-emerald-500 font-medium mt-0.5">{match.salary_range}</p>
                          )}
                          {/* Signals */}
                          <div className="flex flex-wrap gap-2 mt-2">
                            <span className="text-[11px] bg-muted px-2 py-0.5 rounded-full">{match.signals.your_score}</span>
                            <span className="text-[11px] bg-muted px-2 py-0.5 rounded-full">{match.signals.company_score}</span>
                            <span className="text-[11px] bg-muted px-2 py-0.5 rounded-full">{match.signals.skill_match}</span>
                          </div>
                        </div>
                        {/* Right: Status */}
                        <div className="text-right shrink-0">
                          {match.application_status ? (
                            <Badge variant="outline" className="text-[11px]">{match.application_status}</Badge>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => window.location.href = `/candidate/jobs/${match.job_id}`}>
                              View
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ─── RATE COMPANIES TAB ─────────────────────────── */}
        <TabsContent value="rate-companies">
          <div className="space-y-4">
            <Card className="bg-gradient-to-r from-amber-500/5 to-orange-500/5 border-amber-500/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <ThumbsUp className="h-5 w-5 text-amber-500" />
                  <div>
                    <p className="font-medium text-sm">Rate Your Experience</p>
                    <p className="text-xs text-muted-foreground">
                      Your anonymous ratings help other candidates and improve company TrustScores.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Rating Form Dialog */}
            {ratingForm && (
              <Card className="border-primary">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Rate {ratingForm.company_name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Star ratings */}
                  {[
                    { key: 'overall_rating', label: 'Overall Experience' },
                    { key: 'interview_experience', label: 'Interview Experience' },
                    { key: 'communication', label: 'Communication' },
                    { key: 'transparency', label: 'Transparency' },
                    { key: 'work_life_balance', label: 'Work-Life Balance' },
                    { key: 'culture', label: 'Culture' },
                    { key: 'growth_opportunity', label: 'Growth Opportunity' },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-sm">{label} {key === 'overall_rating' && <span className="text-red-500">*</span>}</span>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map(val => (
                          <button key={val} onClick={() => setRatings(r => ({ ...r, [key]: val }))}
                            className="p-0.5 hover:scale-110 transition-transform">
                            <Star className={`h-5 w-5 ${
                              val <= (ratings as any)[key] ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'
                            }`} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Text fields */}
                  <div>
                    <label className="text-sm font-medium">Pros</label>
                    <textarea className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
                      rows={2} placeholder="What did you like?"
                      value={ratings.pros} onChange={e => setRatings(r => ({ ...r, pros: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Cons</label>
                    <textarea className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
                      rows={2} placeholder="What could be improved?"
                      value={ratings.cons} onChange={e => setRatings(r => ({ ...r, cons: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Additional Comments</label>
                    <textarea className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
                      rows={3} placeholder="Share your experience..."
                      value={ratings.review_text} onChange={e => setRatings(r => ({ ...r, review_text: e.target.value }))} />
                  </div>

                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" onClick={() => setRatingForm(null)}>Cancel</Button>
                    <Button disabled={ratings.overall_rating === 0 || submitting} onClick={submitRating}>
                      {submitting ? 'Submitting...' : 'Submit Rating'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Companies list */}
            {companiesLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : companies.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="p-8 text-center">
                  <Building2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                  <h3 className="font-heading text-lg font-semibold">No Companies to Rate</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Apply to jobs first — after interviewing, you'll be able to rate the company.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {companies.map(company => (
                  <Card key={`${company.company_id}-${company.job_id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm">{company.name}</h4>
                          <p className="text-xs text-muted-foreground">
                            {company.job_title} · {company.application_status}
                            {company.trust_score ? ` · TrustScore ${company.trust_score}` : ''}
                          </p>
                        </div>
                        {company.my_rating ? (
                          <div className="flex items-center gap-1.5">
                            <StarRating rating={company.my_rating} />
                            <span className="text-xs text-muted-foreground">Rated</span>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setRatingForm({
                            company_id: company.company_id,
                            job_id: company.job_id,
                            company_name: company.name
                          })}>
                            Rate
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
