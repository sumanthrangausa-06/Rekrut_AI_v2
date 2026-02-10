import { useEffect, useState } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Shield, Star, Users, TrendingUp, Building2, MessageSquare, BarChart3,
  Award, ChevronRight, ArrowUpRight, Target, Eye, Sparkles
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────
interface TrustScoreBreakdown {
  score: number; max: number; label: string
}

interface TrustScoreData {
  score: number; tier: string; tier_label: string; tier_color: string
  breakdown: Record<string, TrustScoreBreakdown>
}

interface RatingsSummary {
  total_ratings: string
  avg_overall: string | null
  avg_interview: string | null
  avg_communication: string | null
  avg_transparency: string | null
  avg_work_life: string | null
  avg_culture: string | null
  avg_growth: string | null
}

interface Review {
  overall_rating: number
  interview_experience: number | null
  communication: number | null
  review_text: string | null
  pros: string | null
  cons: string | null
  created_at: string
  reviewer_name: string
}

interface HiringFunnel {
  total_applications: string
  reviewing: string
  interviewed: string
  offered: string
  hired: string
  rejected: string
  avg_applicant_omniscore: string | null
}

interface Recommendation {
  type: string; priority: string; title: string; description: string; potential_gain: number
}

interface CandidateRow {
  user_id: number; total_score: number; score_tier: string
  interview_score: number; technical_score: number; resume_score: number; behavior_score: number
  name: string; email: string; avatar_url: string | null
  headline: string | null; location: string | null; years_experience: number | null
  applications_count: string
}

interface Distribution { score_tier: string; count: string }

// ─── Helpers ────────────────────────────────────────────────
const tierBg: Record<string, string> = {
  exceptional: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  excellent: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  trusted: 'bg-green-500/10 text-green-500 border-green-500/30',
  good: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  building: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  new: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
}

const candidateTierBg: Record<string, string> = {
  exceptional: 'bg-yellow-500/10 text-yellow-400',
  excellent: 'bg-emerald-500/10 text-emerald-400',
  good: 'bg-green-500/10 text-green-500',
  fair: 'bg-amber-500/10 text-amber-500',
  needs_work: 'bg-orange-500/10 text-orange-500',
  new: 'bg-slate-500/10 text-slate-400',
}

function ScoreRing({ score, max = 1000, size = 140, label = 'TrustScore' }: {
  score: number; max?: number; size?: number; label?: string
}) {
  const progress = Math.max(0, Math.min(100, (score / max) * 100))
  const radius = (size - 14) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDasharray = `${(progress / 100) * circumference} ${circumference}`

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="absolute -rotate-90" width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none"
          stroke="currentColor" className="text-muted/20" strokeWidth={8} />
        <circle cx={size/2} cy={size/2} r={radius} fill="none"
          stroke="url(#trustGradient)" strokeWidth={8} strokeLinecap="round"
          style={{ strokeDasharray, transition: 'stroke-dasharray 1s ease' }} />
        <defs>
          <linearGradient id="trustGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
        </defs>
      </svg>
      <div className="flex flex-col items-center z-10">
        <span className="font-heading text-3xl font-bold">{score}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
    </div>
  )
}

function StarDisplay({ rating }: { rating: number | string | null }) {
  const val = typeof rating === 'string' ? parseFloat(rating) : (rating || 0)
  return (
    <div className="flex gap-0.5 items-center">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`h-3.5 w-3.5 ${i <= val ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/20'}`} />
      ))}
      {val > 0 && <span className="text-xs font-medium ml-1">{val}</span>}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────
export function RecruiterOmniScorePage() {
  const [tab, setTab] = useState('company-score')
  const [loading, setLoading] = useState(true)

  // Company dashboard data
  const [trustScore, setTrustScore] = useState<TrustScoreData | null>(null)
  const [ratings, setRatings] = useState<RatingsSummary | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [funnel, setFunnel] = useState<HiringFunnel | null>(null)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])

  // Candidate leaderboard
  const [candidates, setCandidates] = useState<CandidateRow[]>([])
  const [distribution, setDistribution] = useState<Distribution[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)

  useEffect(() => {
    loadCompanyDashboard()
  }, [])

  useEffect(() => {
    if (tab === 'candidates' && candidates.length === 0) loadCandidates()
  }, [tab])

  async function loadCompanyDashboard() {
    try {
      const data = await apiCall<any>('/omniscore/company-dashboard')
      setTrustScore(data.trust_score)
      setRatings(data.candidate_ratings?.summary)
      setReviews(data.candidate_ratings?.reviews || [])
      setFunnel(data.hiring_funnel)
      setRecommendations(data.recommendations || [])
    } catch (err) {
      console.error('Load company dashboard error:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadCandidates() {
    setCandidatesLoading(true)
    try {
      const data = await apiCall<any>('/omniscore/leaderboard?limit=50')
      setCandidates(data.candidates || [])
      setDistribution(data.distribution || [])
    } catch { }
    finally { setCandidatesLoading(false) }
  }

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
          <h1 className="font-heading text-2xl font-bold">OmniScore Dashboard</h1>
          <p className="text-sm text-muted-foreground">Two-sided scoring — your TrustScore + candidate OmniScores</p>
        </div>
        <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
          <Shield className="h-3 w-3" /> Employer Score
        </Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="company-score">
            <Shield className="h-4 w-4 mr-1.5" /> Your TrustScore
          </TabsTrigger>
          <TabsTrigger value="candidates">
            <Users className="h-4 w-4 mr-1.5" /> Candidate Scores
          </TabsTrigger>
          <TabsTrigger value="feedback">
            <MessageSquare className="h-4 w-4 mr-1.5" /> Candidate Feedback
          </TabsTrigger>
        </TabsList>

        {/* ─── COMPANY TRUST SCORE TAB ────────────────────── */}
        <TabsContent value="company-score">
          <div className="space-y-6">
            {/* TrustScore Hero */}
            <Card className="overflow-hidden border-purple-500/20">
              <div className="bg-gradient-to-br from-card to-purple-500/5 p-8">
                <div className="flex flex-col md:flex-row items-center gap-8">
                  <ScoreRing score={trustScore?.score || 500} />
                  <div className="flex-1 text-center md:text-left">
                    <Badge variant="outline" className={tierBg[trustScore?.tier || 'new']}>
                      {trustScore?.tier_label || 'New Employer'}
                    </Badge>
                    <h2 className="font-heading text-2xl font-bold mt-3">Your Employer TrustScore</h2>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Candidates see this score when evaluating your company. Higher TrustScores attract
                      better candidates and improve match quality.
                    </p>
                    <div className="flex items-center gap-3 mt-4">
                      <span className="text-xs text-muted-foreground">0</span>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 rounded-full transition-all duration-1000"
                          style={{ width: `${(trustScore?.score || 0) / 10}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">1000</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* TrustScore Breakdown */}
            {trustScore?.breakdown && (
              <div>
                <h3 className="font-heading text-lg font-semibold mb-3">Score Breakdown</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(trustScore.breakdown).map(([key, data]) => {
                    const pct = Math.round((data.score / data.max) * 100)
                    return (
                      <Card key={key}>
                        <CardContent className="p-4">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-medium">{data.label}</span>
                            <span className="text-sm font-bold text-primary">{data.score}/{data.max}</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 rounded-full"
                              style={{ width: `${pct}%` }} />
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Hiring Funnel */}
            {funnel && (
              <div>
                <h3 className="font-heading text-lg font-semibold mb-3">Hiring Funnel</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { label: 'Applications', value: funnel.total_applications, color: 'text-blue-500' },
                    { label: 'Reviewing', value: funnel.reviewing, color: 'text-amber-500' },
                    { label: 'Interviewed', value: funnel.interviewed, color: 'text-purple-500' },
                    { label: 'Offered', value: funnel.offered, color: 'text-emerald-500' },
                    { label: 'Hired', value: funnel.hired, color: 'text-green-500' },
                    { label: 'Avg OmniScore', value: funnel.avg_applicant_omniscore || '—', color: 'text-cyan-500' },
                  ].map(item => (
                    <Card key={item.label}>
                      <CardContent className="p-3 text-center">
                        <p className={`font-heading text-2xl font-bold ${item.color}`}>{item.value}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{item.label}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {recommendations.length > 0 && (
              <div>
                <h3 className="font-heading text-lg font-semibold mb-3">Improve Your TrustScore</h3>
                <div className="space-y-3">
                  {recommendations.map((rec, i) => (
                    <Card key={i} className={rec.priority === 'high' ? 'border-red-500/30' : ''}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className={
                                rec.priority === 'high' ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                                rec.priority === 'medium' ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' :
                                'bg-slate-500/10 text-slate-400 border-slate-500/30'
                              }>
                                {rec.priority.toUpperCase()}
                              </Badge>
                              <span className="text-xs text-primary font-medium">+{rec.potential_gain} pts</span>
                            </div>
                            <h4 className="font-semibold text-sm">{rec.title}</h4>
                            <p className="text-xs text-muted-foreground mt-1">{rec.description}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Candidate Ratings Summary */}
            {ratings && parseInt(ratings.total_ratings) > 0 && (
              <div>
                <h3 className="font-heading text-lg font-semibold mb-3">How Candidates Rate You</h3>
                <Card>
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {[
                        { label: 'Overall', value: ratings.avg_overall },
                        { label: 'Interview', value: ratings.avg_interview },
                        { label: 'Communication', value: ratings.avg_communication },
                        { label: 'Transparency', value: ratings.avg_transparency },
                        { label: 'Work-Life', value: ratings.avg_work_life },
                        { label: 'Culture', value: ratings.avg_culture },
                        { label: 'Growth', value: ratings.avg_growth },
                        { label: 'Total Reviews', value: ratings.total_ratings },
                      ].map(item => (
                        <div key={item.label} className="text-center">
                          {item.label !== 'Total Reviews' ? (
                            <StarDisplay rating={item.value} />
                          ) : (
                            <p className="font-heading text-xl font-bold text-primary">{item.value}</p>
                          )}
                          <p className="text-[11px] text-muted-foreground mt-1">{item.label}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ─── CANDIDATE SCORES TAB ──────────────────────── */}
        <TabsContent value="candidates">
          <div className="space-y-4">
            {/* Distribution */}
            {distribution.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {distribution.map(d => (
                  <Badge key={d.score_tier} variant="outline" className={candidateTierBg[d.score_tier] || ''}>
                    {d.score_tier.replace('_', ' ')}: {d.count}
                  </Badge>
                ))}
              </div>
            )}

            {candidatesLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : candidates.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="p-8 text-center">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                  <h3 className="font-heading text-lg font-semibold">No Candidate Scores Yet</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Candidate OmniScores build over time as they take assessments, do interviews, and stay active.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left p-3 font-medium">Candidate</th>
                          <th className="text-center p-3 font-medium">OmniScore</th>
                          <th className="text-center p-3 font-medium hidden sm:table-cell">Interview</th>
                          <th className="text-center p-3 font-medium hidden sm:table-cell">Technical</th>
                          <th className="text-center p-3 font-medium hidden md:table-cell">Resume</th>
                          <th className="text-center p-3 font-medium hidden md:table-cell">Behavior</th>
                          <th className="text-center p-3 font-medium">Tier</th>
                          <th className="text-center p-3 font-medium">Apps</th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidates.map((c, i) => (
                          <tr key={c.user_id} className="border-b hover:bg-muted/20 transition-colors">
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-bold text-primary">
                                  {i + 1}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-medium truncate">{c.name}</p>
                                  <p className="text-[11px] text-muted-foreground truncate">
                                    {c.headline || c.email}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="text-center p-3">
                              <span className="font-heading text-lg font-bold">{c.total_score}</span>
                            </td>
                            <td className="text-center p-3 hidden sm:table-cell text-muted-foreground">{c.interview_score}</td>
                            <td className="text-center p-3 hidden sm:table-cell text-muted-foreground">{c.technical_score}</td>
                            <td className="text-center p-3 hidden md:table-cell text-muted-foreground">{c.resume_score}</td>
                            <td className="text-center p-3 hidden md:table-cell text-muted-foreground">{c.behavior_score}</td>
                            <td className="text-center p-3">
                              <Badge variant="outline" className={`text-[10px] ${candidateTierBg[c.score_tier] || ''}`}>
                                {c.score_tier.replace('_', ' ')}
                              </Badge>
                            </td>
                            <td className="text-center p-3 text-muted-foreground">{c.applications_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ─── FEEDBACK TAB ──────────────────────────────── */}
        <TabsContent value="feedback">
          <div className="space-y-4">
            {reviews.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="p-8 text-center">
                  <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                  <h3 className="font-heading text-lg font-semibold">No Reviews Yet</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Candidates can anonymously rate their experience after applying or interviewing.
                    Better experiences = higher TrustScore.
                  </p>
                </CardContent>
              </Card>
            ) : (
              reviews.map((review, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <StarDisplay rating={review.overall_rating} />
                        <span className="text-xs text-muted-foreground">
                          by {review.reviewer_name}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(review.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>

                    {review.review_text && (
                      <p className="text-sm mb-3">{review.review_text}</p>
                    )}

                    <div className="flex flex-wrap gap-4">
                      {review.pros && (
                        <div className="flex-1 min-w-[150px]">
                          <p className="text-xs font-medium text-emerald-500 mb-1">Pros</p>
                          <p className="text-xs text-muted-foreground">{review.pros}</p>
                        </div>
                      )}
                      {review.cons && (
                        <div className="flex-1 min-w-[150px]">
                          <p className="text-xs font-medium text-red-500 mb-1">Cons</p>
                          <p className="text-xs text-muted-foreground">{review.cons}</p>
                        </div>
                      )}
                    </div>

                    {/* Sub-ratings */}
                    {(review.interview_experience || review.communication) && (
                      <div className="flex gap-4 mt-3 pt-3 border-t">
                        {review.interview_experience && (
                          <div className="text-center">
                            <StarDisplay rating={review.interview_experience} />
                            <p className="text-[10px] text-muted-foreground">Interview</p>
                          </div>
                        )}
                        {review.communication && (
                          <div className="text-center">
                            <StarDisplay rating={review.communication} />
                            <p className="text-[10px] text-muted-foreground">Communication</p>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
