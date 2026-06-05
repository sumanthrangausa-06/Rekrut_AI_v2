import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Building2, MapPin, Users, Globe, Calendar, Linkedin, Star, Shield,
  Heart, Award, Briefcase, ArrowRight, CheckCircle, ExternalLink,
  Sparkles, TrendingUp, ThumbsUp, MessageSquare,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────
interface PublicCompany {
  id: number
  name: string
  slug: string
  description: string
  industry: string
  company_size: string
  website: string
  linkedin_url: string
  headquarters: string
  founded_year: number
  logo_url: string
  is_verified: boolean
  culture_description: string
  core_values: string[]
  benefits: string[]
  office_locations: string[]
  trust_score: number
  score_tier: string
  total_ratings: number
  avg_rating: number
  avg_overall: number
  avg_interview: number
  avg_communication: number
  avg_transparency: number
  avg_culture: number
  avg_growth: number
}

interface PublicJob {
  id: number
  title: string
  location: string
  salary_range: string
  job_type: string
  created_at: string
  match_score?: number
}

interface PublicReview {
  overall_rating: number
  interview_experience: number
  communication: number
  review_text: string
  pros: string
  cons: string
  created_at: string
  reviewer_name: string
}

interface TeamMember {
  id: number
  name: string
  role: string
  avatar_url?: string
}

// ─── Helpers ────────────────────────────────────────────────
const tierColors: Record<string, string> = {
  exceptional: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  excellent: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  trusted: 'bg-green-500/10 text-green-600 border-green-500/30',
  good: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  building: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  new: 'bg-slate-500/10 text-slate-500 border-slate-500/30',
}

function StarRating({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'lg' }) {
  const s = size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`${s} ${i <= Math.round(rating) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'}`} />
      ))}
    </div>
  )
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

// ─── Mock Data ──────────────────────────────────────────────
const mockCompany: PublicCompany = {
  id: 1, name: 'TechCorp', slug: 'techcorp',
  description: 'TechCorp is a leading technology company building the future of cloud infrastructure. We help startups and enterprises scale their applications with cutting-edge distributed systems. Our mission is to make cloud computing accessible, reliable, and cost-effective for everyone.',
  industry: 'Technology', company_size: '201-500',
  website: 'https://techcorp.example.com', linkedin_url: 'https://linkedin.com/company/techcorp',
  headquarters: 'San Francisco, CA', founded_year: 2018,
  logo_url: '', is_verified: true,
  culture_description: 'We believe in transparency, autonomy, and continuous learning. Every team member has a voice in shaping our product and culture. We prioritize work-life balance and mental health.',
  core_values: ['Transparency', 'Innovation', 'Customer First', 'Diversity', 'Continuous Learning'],
  benefits: ['Health Insurance', '401k Match', 'Unlimited PTO', 'Remote Work', 'Professional Development', 'Parental Leave', 'Gym Membership', 'Stock Options'],
  office_locations: ['San Francisco, CA', 'New York, NY', 'Austin, TX', 'London, UK', 'Singapore'],
  trust_score: 847, score_tier: 'exceptional',
  total_ratings: 128, avg_rating: 4.6,
  avg_overall: 4.6, avg_interview: 4.5, avg_communication: 4.7, avg_transparency: 4.8, avg_culture: 4.6, avg_growth: 4.4,
}

const mockJobs: PublicJob[] = [
  { id: 1, title: 'Senior React Developer', location: 'San Francisco, CA / Remote', salary_range: '$140k - $180k', job_type: 'full-time', created_at: new Date(Date.now() - 86400000 * 2).toISOString(), match_score: 92 },
  { id: 2, title: 'Product Manager', location: 'New York, NY', salary_range: '$130k - $160k', job_type: 'full-time', created_at: new Date(Date.now() - 86400000 * 5).toISOString(), match_score: 88 },
  { id: 3, title: 'UX Designer', location: 'Remote', salary_range: '$110k - $145k', job_type: 'full-time', created_at: new Date(Date.now() - 86400000 * 7).toISOString(), match_score: 85 },
  { id: 4, title: 'DevOps Engineer', location: 'Austin, TX / Remote', salary_range: '$125k - $165k', job_type: 'full-time', created_at: new Date(Date.now() - 86400000 * 10).toISOString() },
  { id: 5, title: 'Data Engineer', location: 'San Francisco, CA', salary_range: '$135k - $175k', job_type: 'full-time', created_at: new Date(Date.now() - 86400000 * 14).toISOString() },
]

const mockReviews: PublicReview[] = [
  { overall_rating: 5, interview_experience: 5, communication: 5, review_text: 'Incredible interview process. The team was transparent about the role, timeline, and expectations. I received feedback within 24 hours of each round.', pros: 'Fast feedback, transparent process, great team culture', cons: 'Nothing significant', created_at: new Date(Date.now() - 86400000 * 30).toISOString(), reviewer_name: 'Alex M.' },
  { overall_rating: 4, interview_experience: 4, communication: 5, review_text: 'Great experience overall. The technical interview was challenging but fair. The team seemed genuinely interested in my growth, not just my current skills.', pros: 'Challenging but fair interviews, growth-oriented team', cons: 'Longer process than expected (3 weeks)', created_at: new Date(Date.now() - 86400000 * 60).toISOString(), reviewer_name: 'Sarah K.' },
  { overall_rating: 5, interview_experience: 5, communication: 4, review_text: 'The hiring manager was incredibly knowledgeable and took time to explain the product vision. I felt valued as a candidate throughout.', pros: 'Strong leadership, clear vision, good communication', cons: 'No cons', created_at: new Date(Date.now() - 86400000 * 90).toISOString(), reviewer_name: 'James T.' },
  { overall_rating: 4, interview_experience: 3, communication: 5, review_text: 'Good company with solid values. The interview process was a bit disorganized but the communication was excellent throughout.', pros: 'Great communication, transparent about salary', cons: 'Interview scheduling was a bit chaotic', created_at: new Date(Date.now() - 86400000 * 120).toISOString(), reviewer_name: 'Maria G.' },
]

const mockTeam: TeamMember[] = [
  { id: 1, name: 'Sarah Chen', role: 'CEO', avatar_url: '' },
  { id: 2, name: 'James Wilson', role: 'CTO', avatar_url: '' },
  { id: 3, name: 'Emily Park', role: 'Head of Design', avatar_url: '' },
  { id: 4, name: 'Michael Torres', role: 'VP Engineering', avatar_url: '' },
  { id: 5, name: 'Lisa Anderson', role: 'Head of People', avatar_url: '' },
  { id: 6, name: 'David Kim', role: 'Lead Data Engineer', avatar_url: '' },
]

// ─── Main Component ───────────────────────────────────────
export function PublicCompanyPage() {
  const { slug } = useParams()
  const [company, setCompany] = useState<PublicCompany | null>(null)
  const [jobs, setJobs] = useState<PublicJob[]>([])
  const [reviews, setReviews] = useState<PublicReview[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [slug])

  async function loadData() {
    setLoading(true)
    try {
      const [companyData, jobsData, reviewsData, teamData] = await Promise.allSettled([
        apiCall<{ company: PublicCompany }>(`/company/public/${slug}`),
        apiCall<{ jobs: PublicJob[] }>(`/company/${slug}/jobs`),
        apiCall<{ reviews: PublicReview[] }>(`/company/${slug}/reviews`),
        apiCall<{ team: TeamMember[] }>(`/company/${slug}/team`),
      ])

      setCompany(companyData.status === 'fulfilled' ? companyData.value.company : null)
      setJobs(jobsData.status === 'fulfilled' ? jobsData.value.jobs || [] : [])
      setReviews(reviewsData.status === 'fulfilled' ? reviewsData.value.reviews || [] : [])
      setTeam(teamData.status === 'fulfilled' ? teamData.value.team || [] : [])
    } catch {
      // Fallback to mock data for demo
      setCompany(mockCompany)
      setJobs(mockJobs)
      setReviews(mockReviews)
      setTeam(mockTeam)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!company) {
    return (
      <div className="text-center py-20">
        <Building2 className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
        <h2 className="font-heading text-xl font-bold">Company Not Found</h2>
        <p className="text-muted-foreground mt-2">This company profile doesn't exist or has been removed.</p>
        <Button className="mt-4" asChild>
          <Link to="/candidate/jobs">Browse Jobs</Link>
        </Button>
      </div>
    )
  }

  const c = company

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="relative bg-gradient-to-br from-primary/5 via-card to-cyan-500/5 rounded-2xl border border-primary/10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
        <div className="relative p-8 md:p-12">
          <div className="flex flex-col md:flex-row items-start gap-6">
            {/* Logo */}
            <div className="h-24 w-24 rounded-2xl bg-white border-2 border-border shadow-sm flex items-center justify-center shrink-0 overflow-hidden">
              {c.logo_url ? (
                <img src={c.logo_url} alt={c.name} className="h-full w-full object-cover" />
              ) : (
                <Building2 className="h-10 w-10 text-primary/60" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-heading text-3xl md:text-4xl font-bold">{c.name}</h1>
                {c.is_verified && (
                  <Badge variant="outline" className="gap-1 bg-blue-50 text-blue-700 border-blue-200">
                    <CheckCircle className="h-3 w-3" /> Verified
                  </Badge>
                )}
                <Badge variant="outline" className={tierColors[c.score_tier] || tierColors.new}>
                  <Shield className="h-3 w-3 mr-1" /> TrustScore {c.trust_score}
                </Badge>
              </div>

              <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">
                {c.description}
              </p>

              <div className="flex flex-wrap items-center gap-4 mt-4 text-sm text-muted-foreground">
                {c.industry && (
                  <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" /> {c.industry}</span>
                )}
                {c.company_size && (
                  <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {c.company_size} employees</span>
                )}
                {c.headquarters && (
                  <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {c.headquarters}</span>
                )}
                {c.founded_year && (
                  <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Est. {c.founded_year}</span>
                )}
              </div>

              <div className="flex items-center gap-2 mt-4">
                {c.website && (
                  <a href={c.website} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <Globe className="h-3.5 w-3.5" /> Website
                    </Button>
                  </a>
                )}
                {c.linkedin_url && (
                  <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <Linkedin className="h-3.5 w-3.5" /> LinkedIn
                    </Button>
                  </a>
                )}
                <Button size="sm" className="gap-1.5" asChild>
                  <Link to={`/candidate/jobs?company=${c.id}`}>
                    <Briefcase className="h-3.5 w-3.5" /> View Jobs
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <StarRating rating={c.avg_rating} />
            <p className="font-heading text-2xl font-bold mt-1">{c.avg_rating}</p>
            <p className="text-xs text-muted-foreground">{c.total_ratings} reviews</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Shield className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="font-heading text-2xl font-bold">{c.trust_score}</p>
            <p className="text-xs text-muted-foreground">TrustScore</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Briefcase className="h-5 w-5 mx-auto text-emerald-500 mb-1" />
            <p className="font-heading text-2xl font-bold">{jobs.length}</p>
            <p className="text-xs text-muted-foreground">Open Positions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Users className="h-5 w-5 mx-auto text-blue-500 mb-1" />
            <p className="font-heading text-2xl font-bold">{c.company_size}</p>
            <p className="text-xs text-muted-foreground">Company Size</p>
          </CardContent>
        </Card>
      </div>

      {/* Ratings Breakdown */}
      <Card>
        <CardContent className="p-6">
          <h2 className="font-heading text-lg font-bold mb-4 flex items-center gap-2">
            <ThumbsUp className="h-5 w-5 text-primary" /> Candidate Ratings
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Overall', value: c.avg_overall },
              { label: 'Interview', value: c.avg_interview },
              { label: 'Communication', value: c.avg_communication },
              { label: 'Transparency', value: c.avg_transparency },
              { label: 'Culture', value: c.avg_culture },
              { label: 'Growth', value: c.avg_growth },
            ].map(item => (
              <div key={item.label} className="text-center">
                <StarRating rating={item.value} />
                <p className="font-heading text-xl font-bold mt-1">{item.value}</p>
                <p className="text-xs text-muted-foreground">{item.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Culture & Values */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-bold mb-4 flex items-center gap-2">
              <Heart className="h-5 w-5 text-red-500" /> Our Culture
            </h2>
            <p className="text-muted-foreground leading-relaxed">{c.culture_description}</p>
            {c.core_values && c.core_values.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {c.core_values.map((v, i) => (
                  <Badge key={i} variant="secondary" className="gap-1">
                    <Sparkles className="h-3 w-3 text-amber-500" /> {v}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-bold mb-4 flex items-center gap-2">
              <Award className="h-5 w-5 text-emerald-500" /> Benefits & Perks
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {c.benefits.map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>{b}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Office Locations */}
      {c.office_locations && c.office_locations.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-bold mb-4 flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" /> Office Locations
            </h2>
            <div className="flex flex-wrap gap-2">
              {c.office_locations.map((loc, i) => (
                <Badge key={i} variant="outline" className="gap-1">
                  <MapPin className="h-3 w-3" /> {loc}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Open Positions */}
      <div>
        <h2 className="font-heading text-xl font-bold mb-4 flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" /> Open Positions
        </h2>
        {jobs.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center">
              <Briefcase className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">No open positions at this time</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {jobs.map(job => (
              <Card key={job.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{job.title}</h3>
                        {job.match_score && (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                            {job.match_score}% Match
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {job.location}</span>
                        <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" /> {job.job_type}</span>
                        {job.salary_range && <span className="flex items-center gap-1 text-emerald-600 font-medium">{job.salary_range}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Button size="sm" asChild>
                        <Link to={`/candidate/jobs/${job.id}`}>
                          Apply <ArrowRight className="h-3.5 w-3.5 ml-1" />
                        </Link>
                      </Button>
                      <span className="text-[10px] text-muted-foreground">{timeAgo(job.created_at)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Team */}
      {team.length > 0 && (
        <div>
          <h2 className="font-heading text-xl font-bold mb-4 flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" /> Meet the Team
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {team.map(member => (
              <Card key={member.id} className="text-center">
                <CardContent className="p-4">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                    <span className="text-lg font-bold text-primary">
                      {member.name[0]?.toUpperCase()}
                    </span>
                  </div>
                  <p className="font-medium text-sm truncate">{member.name}</p>
                  <p className="text-xs text-muted-foreground">{member.role}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Reviews */}
      {reviews.length > 0 && (
        <div>
          <h2 className="font-heading text-xl font-bold mb-4 flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" /> Candidate Reviews
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {reviews.slice(0, 4).map((review, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <StarRating rating={review.overall_rating} />
                      <span className="text-xs text-muted-foreground">{review.reviewer_name}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(review.created_at)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{review.review_text}</p>
                  <div className="flex gap-4">
                    {review.pros && (
                      <div className="flex-1">
                        <p className="text-[10px] font-medium text-emerald-600 mb-0.5">Pros</p>
                        <p className="text-xs text-muted-foreground">{review.pros}</p>
                      </div>
                    )}
                    {review.cons && (
                      <div className="flex-1">
                        <p className="text-[10px] font-medium text-red-500 mb-0.5">Cons</p>
                        <p className="text-xs text-muted-foreground">{review.cons}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* CTA Footer */}
      <Card className="bg-gradient-to-r from-primary/10 to-cyan-500/10 border-primary/20">
        <CardContent className="p-8 text-center">
          <h2 className="font-heading text-xl font-bold mb-2">Interested in joining {c.name}?</h2>
          <p className="text-muted-foreground mb-4">
            Explore open positions and apply with your Rekrut AI profile.
          </p>
          <Button size="lg" className="gap-2" asChild>
            <Link to="/candidate/jobs">
              <Briefcase className="h-4 w-4" /> View All Jobs
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
