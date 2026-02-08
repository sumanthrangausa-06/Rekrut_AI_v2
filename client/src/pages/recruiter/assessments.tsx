import { useEffect, useState } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  GraduationCap, Users, Trophy, TrendingUp, Search, ChevronDown,
  CheckCircle, XCircle, Clock, Shield, Eye, BarChart3, AlertTriangle,
} from 'lucide-react'

interface AssessmentResult {
  id: number
  score: number
  max_score: number
  passed: boolean
  anti_cheat_score: number
  duration_seconds: number
  completed_at: string
  title: string
  skill_name: string
  category: string
  is_verified: boolean
  max_difficulty_reached: number
  tab_switches: number
  copy_paste_attempts: number
  candidate_name: string
  candidate_email: string
  candidate_id: number
}

interface SkillBreakdown {
  skill_name: string
  category: string
  attempt_count: number
  pass_count: number
  avg_score: number
}

interface Stats {
  total_candidates: number
  total_assessments: number
  total_passed: number
  avg_score: number
  skills_tested: number
}

interface DetailedAnswer {
  questionId: number
  answer: string
  isCorrect: boolean
  scorePoints: number
  timeTaken: number
  aiFeedback?: string
  questionText: string
  questionType: string
  correctAnswer?: string
  explanation?: string
  difficulty?: number
}

interface AssessmentDetail {
  id: number
  score: number
  max_score: number
  passed: boolean
  anti_cheat_score: number
  duration_seconds: number
  completed_at: string
  title: string
  skill_name: string
  category: string
  candidate_name: string
  candidate_email: string
  tab_switches: number
  copy_paste_attempts: number
  time_anomalies: number
  max_difficulty_reached: number
  detailedAnswers: DetailedAnswer[]
}

interface CatalogSkill {
  name: string
  category: string
  icon: string
  description: string
  difficulty: string
}

export function RecruiterAssessmentsPage() {
  const [tab, setTab] = useState('results')
  const [assessments, setAssessments] = useState<AssessmentResult[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [skillBreakdown, setSkillBreakdown] = useState<SkillBreakdown[]>([])
  const [catalog, setCatalog] = useState<CatalogSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterSkill, setFilterSkill] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [sortBy, setSortBy] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedDetail, setSelectedDetail] = useState<AssessmentDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [filterSkill, filterStatus, sortBy])

  async function loadData() {
    try {
      const params = new URLSearchParams()
      if (filterSkill) params.set('skill', filterSkill)
      if (filterStatus) params.set('status', filterStatus)
      if (sortBy) params.set('sort', sortBy)

      const [resultsRes, catalogRes] = await Promise.allSettled([
        apiCall<{ assessments: AssessmentResult[]; stats: Stats; skillBreakdown: SkillBreakdown[] }>(
          `/assessments/recruiter/all?${params.toString()}`
        ),
        apiCall<{ catalog: CatalogSkill[] }>('/assessments/recruiter/catalog'),
      ])

      if (resultsRes.status === 'fulfilled') {
        setAssessments(resultsRes.value.assessments || [])
        setStats(resultsRes.value.stats || null)
        setSkillBreakdown(resultsRes.value.skillBreakdown || [])
      }
      if (catalogRes.status === 'fulfilled') {
        setCatalog(catalogRes.value.catalog || [])
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function viewDetail(assessmentId: number) {
    setDetailLoading(true)
    setDetailOpen(true)
    try {
      const data = await apiCall<{ assessment: AssessmentDetail }>(
        `/assessments/recruiter/detail/${assessmentId}`
      )
      setSelectedDetail(data.assessment)
    } catch {
      setSelectedDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const filteredAssessments = assessments.filter(a => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      (a.candidate_name || '').toLowerCase().includes(q) ||
      (a.candidate_email || '').toLowerCase().includes(q) ||
      (a.skill_name || '').toLowerCase().includes(q)
    )
  })

  const uniqueSkills = [...new Set(assessments.map(a => a.skill_name).filter(Boolean))]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">Skill Assessments</h1>
        <p className="text-muted-foreground">Review candidate test scores and skill verifications</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardContent className="p-4 text-center">
              <Users className="mx-auto h-5 w-5 text-muted-foreground mb-1" />
              <p className="text-2xl font-bold">{stats.total_candidates || 0}</p>
              <p className="text-xs text-muted-foreground">Candidates Tested</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <GraduationCap className="mx-auto h-5 w-5 text-muted-foreground mb-1" />
              <p className="text-2xl font-bold">{stats.total_assessments || 0}</p>
              <p className="text-xs text-muted-foreground">Total Tests</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Trophy className="mx-auto h-5 w-5 text-emerald-500 mb-1" />
              <p className="text-2xl font-bold text-emerald-600">{stats.total_passed || 0}</p>
              <p className="text-xs text-muted-foreground">Passed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <TrendingUp className="mx-auto h-5 w-5 text-blue-500 mb-1" />
              <p className="text-2xl font-bold text-blue-600">{stats.avg_score || 0}</p>
              <p className="text-xs text-muted-foreground">Avg Score</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <BarChart3 className="mx-auto h-5 w-5 text-purple-500 mb-1" />
              <p className="text-2xl font-bold text-purple-600">{stats.skills_tested || 0}</p>
              <p className="text-xs text-muted-foreground">Skills Tested</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="results">Candidate Results</TabsTrigger>
          <TabsTrigger value="skills">Skill Breakdown</TabsTrigger>
          <TabsTrigger value="catalog">Test Catalog</TabsTrigger>
        </TabsList>

        {/* ===== RESULTS TAB ===== */}
        <TabsContent value="results">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4 mt-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name, email, or skill..."
                className="pl-9"
              />
            </div>
            <select
              value={filterSkill}
              onChange={e => setFilterSkill(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All Skills</option>
              {uniqueSkills.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All Results</option>
              <option value="passed">Passed Only</option>
              <option value="failed">Failed Only</option>
            </select>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Most Recent</option>
              <option value="score_desc">Highest Score</option>
              <option value="score_asc">Lowest Score</option>
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : filteredAssessments.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <GraduationCap className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p className="text-muted-foreground">No assessment results yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Candidates can take skill tests from their Assessments page
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {filteredAssessments.length} result{filteredAssessments.length !== 1 ? 's' : ''}
              </p>
              {filteredAssessments.map(a => (
                <Card key={a.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium truncate">{a.candidate_name || 'Unknown'}</h4>
                          {a.passed ? (
                            <Badge variant="success" className="gap-1 shrink-0">
                              <CheckCircle className="h-3 w-3" /> Passed
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1 shrink-0">
                              <XCircle className="h-3 w-3" /> Failed
                            </Badge>
                          )}
                          {a.anti_cheat_score < 70 && (
                            <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 shrink-0">
                              <AlertTriangle className="h-3 w-3" /> Low Integrity
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{a.candidate_email}</p>
                        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                          <Badge variant="secondary" className="text-[10px]">{a.skill_name}</Badge>
                          <span>Score: <strong className="text-foreground">{a.score}/{a.max_score || 100}</strong></span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {Math.round((a.duration_seconds || 0) / 60)}m
                          </span>
                          <span className="flex items-center gap-1">
                            <Shield className="h-3 w-3" />
                            {a.anti_cheat_score}%
                          </span>
                          <span>Diff: {a.max_difficulty_reached}/5</span>
                          <span>{new Date(a.completed_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className={`text-2xl font-bold ${a.passed ? 'text-emerald-600' : 'text-destructive'}`}>
                            {a.score}%
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 shrink-0"
                          onClick={() => viewDetail(a.id)}
                        >
                          <Eye className="h-3 w-3" /> Details
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ===== SKILLS TAB ===== */}
        <TabsContent value="skills">
          {skillBreakdown.length === 0 ? (
            <Card className="mt-4">
              <CardContent className="py-16 text-center">
                <BarChart3 className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p className="text-muted-foreground">No skill data yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3 mt-4">
              {skillBreakdown.map(s => {
                const passRate = s.attempt_count > 0 ? Math.round((s.pass_count / s.attempt_count) * 100) : 0
                return (
                  <Card key={s.skill_name}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h4 className="font-medium">{s.skill_name}</h4>
                          <p className="text-xs text-muted-foreground capitalize">{s.category}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">Avg: {s.avg_score}/100</p>
                          <p className="text-xs text-muted-foreground">{s.attempt_count} attempts</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              passRate >= 70 ? 'bg-emerald-500' : passRate >= 40 ? 'bg-amber-500' : 'bg-destructive'
                            }`}
                            style={{ width: `${passRate}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium w-12 text-right">{passRate}%</span>
                      </div>
                      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="text-emerald-600">{s.pass_count} passed</span>
                        <span className="text-destructive">{s.attempt_count - s.pass_count} failed</span>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* ===== CATALOG TAB ===== */}
        <TabsContent value="catalog">
          <div className="mt-4">
            <p className="text-sm text-muted-foreground mb-4">
              These AI-powered adaptive tests are available for all candidates. Tests auto-adjust difficulty based on performance.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.map(skill => {
                const breakdown = skillBreakdown.find(
                  s => s.skill_name?.toLowerCase() === skill.name.toLowerCase()
                )
                return (
                  <Card key={skill.name}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3 mb-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-mono font-bold text-xs shrink-0">
                          {skill.icon}
                        </div>
                        <div>
                          <h4 className="font-medium text-sm">{skill.name}</h4>
                          <p className="text-xs text-muted-foreground capitalize">{skill.category}</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">{skill.description}</p>
                      <div className="flex items-center justify-between text-xs">
                        <Badge variant="secondary">{skill.difficulty}</Badge>
                        {breakdown ? (
                          <span className="text-muted-foreground">
                            {breakdown.attempt_count} taken | Avg: {breakdown.avg_score}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No attempts yet</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ===== DETAIL DIALOG ===== */}
      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assessment Details</DialogTitle>
        </DialogHeader>
        {detailLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : selectedDetail ? (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">{selectedDetail.candidate_name}</h3>
                <p className="text-xs text-muted-foreground">{selectedDetail.candidate_email}</p>
              </div>
              <div className="text-right">
                <div className={`text-3xl font-bold ${selectedDetail.passed ? 'text-emerald-600' : 'text-destructive'}`}>
                  {selectedDetail.score}%
                </div>
                <Badge variant={selectedDetail.passed ? 'success' : 'destructive'}>
                  {selectedDetail.passed ? 'PASSED' : 'FAILED'}
                </Badge>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <p className="font-medium text-sm">{selectedDetail.skill_name}</p>
                <p className="text-xs text-muted-foreground">Skill</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <p className="font-medium text-sm">{Math.round((selectedDetail.duration_seconds || 0) / 60)}m</p>
                <p className="text-xs text-muted-foreground">Duration</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <p className="font-medium text-sm">{selectedDetail.max_difficulty_reached}/5</p>
                <p className="text-xs text-muted-foreground">Max Difficulty</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <p className={`font-medium text-sm ${
                  (selectedDetail.anti_cheat_score || 100) >= 80 ? 'text-emerald-600' :
                  (selectedDetail.anti_cheat_score || 100) >= 50 ? 'text-amber-600' : 'text-destructive'
                }`}>
                  {selectedDetail.anti_cheat_score || 100}%
                </p>
                <p className="text-xs text-muted-foreground">Integrity</p>
              </div>
            </div>

            {/* Anti-cheat flags */}
            {((selectedDetail.tab_switches || 0) > 0 || (selectedDetail.copy_paste_attempts || 0) > 0 || (selectedDetail.time_anomalies || 0) > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-800 mb-1">Behavioral Flags</p>
                <div className="flex gap-4 text-xs text-amber-700">
                  {(selectedDetail.tab_switches || 0) > 0 && (
                    <span>Tab switches: {selectedDetail.tab_switches}</span>
                  )}
                  {(selectedDetail.copy_paste_attempts || 0) > 0 && (
                    <span>Copy/paste: {selectedDetail.copy_paste_attempts}</span>
                  )}
                  {(selectedDetail.time_anomalies || 0) > 0 && (
                    <span>Time anomalies: {selectedDetail.time_anomalies}</span>
                  )}
                </div>
              </div>
            )}

            {/* Question-by-question breakdown */}
            {selectedDetail.detailedAnswers && selectedDetail.detailedAnswers.length > 0 && (
              <div>
                <h4 className="font-medium text-sm mb-3">Question-by-Question</h4>
                <div className="space-y-3">
                  {selectedDetail.detailedAnswers.map((answer, idx) => (
                    <div
                      key={idx}
                      className={`rounded-lg border p-3 ${
                        answer.isCorrect ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <span className="text-xs font-medium">
                          Q{idx + 1}
                          {answer.difficulty && <span className="text-muted-foreground ml-1">(Diff {answer.difficulty}/5)</span>}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{answer.timeTaken}s</span>
                          {answer.isCorrect ? (
                            <CheckCircle className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                        </div>
                      </div>
                      <p className="text-sm mb-1">{answer.questionText}</p>
                      <div className="text-xs space-y-1">
                        <p>
                          <span className="text-muted-foreground">Answer: </span>
                          <span className={answer.isCorrect ? 'text-emerald-700' : 'text-destructive'}>
                            {answer.answer}
                          </span>
                        </p>
                        {!answer.isCorrect && answer.correctAnswer && (
                          <p>
                            <span className="text-muted-foreground">Correct: </span>
                            <span className="text-emerald-700">{answer.correctAnswer}</span>
                          </p>
                        )}
                        {answer.aiFeedback && (
                          <p className="text-muted-foreground italic">{answer.aiFeedback}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground text-right">
              Completed: {new Date(selectedDetail.completed_at).toLocaleString()}
            </p>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">Failed to load details</p>
        )}
      </Dialog>
    </div>
  )
}
