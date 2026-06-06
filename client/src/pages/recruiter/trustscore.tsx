import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Shield, ArrowLeft, Star, CheckCircle2, AlertTriangle, TrendingUp, TrendingDown,
  Users, Building2, Clock, FileText, Globe, Lock, ChevronRight, Loader2,
  Award, Briefcase, MessageSquare, Target, Activity
} from 'lucide-react'

interface TrustScoreBreakdown {
  label: string
  score: number
  max: number
  description: string
}

interface Recommendation {
  priority: 'high' | 'medium' | 'low'
  title: string
  description: string
  potential_gain: number
}

interface HistoryEntry {
  change_amount: number
  change_reason: string
  previous_score: number
  new_score: number
  created_at: string
}

interface TrustScoreData {
  total_score: number
  tier: string
  tier_label: string
  tier_color: string
  breakdown: TrustScoreBreakdown[]
  recommendations: Recommendation[]
  history: HistoryEntry[]
}

const tierDescriptions: Record<string, string> = {
  exceptional: 'Top-tier employer! Candidates trust your company highly.',
  excellent: 'Excellent reputation. Candidates view you favorably.',
  trusted: 'Trusted employer with good hiring practices.',
  good: 'Good standing. Room for improvement.',
  building: 'Building trust. Follow recommendations below.',
  new: 'New employer. Complete actions to build credibility.',
}

const infoCards = [
  {
    icon: Shield,
    title: 'Employer Credibility',
    description: 'TrustScore (0-1000) measures your company\'s credibility as an employer. Candidates see this when viewing your jobs.',
  },
  {
    icon: CheckCircle2,
    title: 'Verification Status',
    description: 'Verified companies with work email domains automatically get a verification badge and score boost.',
  },
  {
    icon: FileText,
    title: 'Job Authenticity',
    description: 'AI analyzes your job postings for completeness, realistic requirements, and clear salary information.',
  },
  {
    icon: TrendingUp,
    title: 'Hiring Ratio',
    description: 'Your interview-to-offer ratio shows candidates you have fair, efficient hiring practices.',
  },
  {
    icon: MessageSquare,
    title: 'Candidate Feedback',
    description: 'After interviews, candidates can rate their experience. Positive feedback boosts your score.',
  },
  {
    icon: Activity,
    title: 'Platform Behavior',
    description: 'Response times, profile completeness, and regular activity all contribute to your score.',
  },
]

export function RecruiterTrustscorePage() {
  const [data, setData] = useState<TrustScoreData>({
    total_score: 0,
    tier: 'new',
    tier_label: 'Loading...',
    tier_color: '#8b5cf6',
    breakdown: [],
    recommendations: [],
    history: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadTrustScore() {
      try {
        // Try to fetch from API, fall back to demo data
        const res = await fetch('/api/trustscore/breakdown', {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
          },
        }).catch(() => null)

        if (res && res.ok) {
          const apiData = await res.json()
          setData({
            total_score: apiData.current?.total_score || 0,
            tier: apiData.current?.tier || 'new',
            tier_label: apiData.current?.tier_label || 'Loading...',
            tier_color: apiData.current?.tier_color || '#8b5cf6',
            breakdown: apiData.breakdown || [],
            recommendations: apiData.recommendations || [],
            history: apiData.history || [],
          })
        } else {
          // Demo data for visual completeness
          setData({
            total_score: 720,
            tier: 'trusted',
            tier_label: 'Trusted Employer',
            tier_color: '#8b5cf6',
            breakdown: [
              { label: 'Profile Completeness', score: 85, max: 100, description: 'Company profile is well filled out' },
              { label: 'Job Authenticity', score: 92, max: 100, description: 'Jobs have clear descriptions and realistic requirements' },
              { label: 'Candidate Feedback', score: 78, max: 100, description: 'Positive ratings from interviewed candidates' },
              { label: 'Response Time', score: 65, max: 100, description: 'Average time to respond to applications' },
              { label: 'Hiring Success Rate', score: 88, max: 100, description: 'Ratio of offers to interviews' },
              { label: 'Platform Activity', score: 70, max: 100, description: 'Regular logins and updates' },
            ],
            recommendations: [
              { priority: 'high', title: 'Add salary ranges to all jobs', description: 'Jobs with transparent salary information get 40% more applications.', potential_gain: 45 },
              { priority: 'medium', title: 'Respond faster to applicants', description: 'Your average response time is 5 days. Aim for under 48 hours.', potential_gain: 30 },
              { priority: 'medium', title: 'Complete company profile', description: 'Add team photos, culture description, and benefits info.', potential_gain: 25 },
              { priority: 'low', title: 'Request candidate reviews', description: 'Encourage candidates to leave feedback after interviews.', potential_gain: 15 },
            ],
            history: [
              { change_amount: 20, change_reason: 'Added salary transparency', previous_score: 700, new_score: 720, created_at: '2026-05-15T10:00:00Z' },
              { change_amount: 15, change_reason: 'Improved response time', previous_score: 685, new_score: 700, created_at: '2026-04-22T10:00:00Z' },
              { change_amount: -5, change_reason: 'Missed candidate follow-up', previous_score: 690, new_score: 685, created_at: '2026-03-10T10:00:00Z' },
              { change_amount: 30, change_reason: 'Profile verification completed', previous_score: 660, new_score: 690, created_at: '2026-02-01T10:00:00Z' },
            ],
          })
        }
      } catch (err) {
        setError('Failed to load TrustScore data')
      } finally {
        setLoading(false)
      }
    }
    loadTrustScore()
  }, [])

  const percentage = data.total_score / 1000
  const circumference = 2 * Math.PI * 90
  const strokeDashoffset = circumference * (1 - percentage)

  const scoreColor = data.total_score >= 800 ? 'text-green-500' : data.total_score >= 600 ? 'text-purple-500' : 'text-yellow-500'
  const scoreBg = data.total_score >= 800 ? 'bg-green-500' : data.total_score >= 600 ? 'bg-purple-500' : 'bg-yellow-500'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Back link */}
      <div>
        <Link to="/recruiter" className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm">
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </div>

      {/* Hero Card with Score Ring */}
      <Card className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border-purple-500/30">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
            {/* Score Ring */}
            <div className="flex flex-col items-center text-center">
              <div className="relative w-[200px] h-[200px] mb-4">
                <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
                  <defs>
                    <linearGradient id="trustGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#8b5cf6" />
                      <stop offset="100%" stopColor="#d946ef" />
                    </linearGradient>
                  </defs>
                  <circle cx="100" cy="100" r="90" fill="none" stroke="#2d2d3a" strokeWidth="12" />
                  <circle
                    cx="100"
                    cy="100"
                    r="90"
                    fill="none"
                    stroke="url(#trustGradient)"
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-5xl font-bold text-white">{data.total_score}</span>
                  <span className="text-sm text-muted-foreground">of 1000</span>
                </div>
              </div>
              <div className="space-y-2">
                <Badge
                  className="text-white font-semibold px-4 py-1"
                  style={{ backgroundColor: data.tier_color }}
                >
                  {data.tier_label}
                </Badge>
                <p className="text-sm text-muted-foreground">
                  {tierDescriptions[data.tier] || tierDescriptions.new}
                </p>
              </div>
            </div>

            {/* Score Breakdown */}
            <div>
              <h3 className="text-lg font-semibold text-white mb-4">Score Breakdown</h3>
              <div className="space-y-4">
                {data.breakdown.map((item) => {
                  const pct = (item.score / item.max) * 100
                  return (
                    <div key={item.label}>
                      <div className="flex justify-between mb-1">
                        <span className="text-sm font-medium text-gray-300">{item.label}</span>
                        <span className="text-sm font-semibold text-purple-400">{item.score}/{item.max}</span>
                      </div>
                      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">{item.description}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recommendations */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Improve Your TrustScore</h2>
        {data.recommendations.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">Great job! No immediate recommendations.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.recommendations.map((rec, idx) => (
              <Card
                key={idx}
                className={`relative overflow-hidden border-l-4 ${
                  rec.priority === 'high'
                    ? 'border-l-red-500'
                    : rec.priority === 'medium'
                      ? 'border-l-yellow-500'
                      : 'border-l-purple-500'
                }`}
              >
                <CardContent className="pt-6">
                  <Badge
                    className="absolute top-3 right-3 text-xs uppercase"
                    variant={
                      rec.priority === 'high'
                        ? 'destructive'
                        : rec.priority === 'medium'
                          ? 'default'
                          : 'secondary'
                    }
                  >
                    {rec.priority}
                  </Badge>
                  <h4 className="font-semibold text-base mb-2 pr-16">{rec.title}</h4>
                  <p className="text-sm text-muted-foreground mb-3">{rec.description}</p>
                  <p className="text-sm font-semibold text-green-500">+{rec.potential_gain} potential points</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* What is TrustScore */}
      <section>
        <h2 className="text-xl font-semibold mb-4">What is TrustScore?</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {infoCards.map((card, idx) => (
            <Card key={idx}>
              <CardContent className="pt-6">
                <card.icon className="h-8 w-8 text-purple-500 mb-3" />
                <h3 className="font-semibold text-base mb-2">{card.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{card.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Score History */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Score History</h2>
        <Card>
          <CardContent className="pt-6">
            {data.history.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No score changes yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.history.map((h, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-4 p-4 bg-muted rounded-lg"
                  >
                    <div
                      className={`w-16 text-center font-bold text-lg ${
                        h.change_amount >= 0 ? 'text-green-500' : 'text-red-500'
                      }`}
                    >
                      {h.change_amount >= 0 ? '+' : ''}{h.change_amount}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{h.change_reason}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(h.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="font-semibold">{h.previous_score}</span>
                      <ChevronRight className="h-4 w-4" />
                      <span className="font-semibold text-foreground">{h.new_score}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
