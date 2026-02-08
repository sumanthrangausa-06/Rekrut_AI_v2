import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  GraduationCap, Play, Trophy, Clock, Shield, AlertTriangle, CheckCircle,
} from 'lucide-react'

interface SkillCatalog {
  catalog_name: string
  category: string
  icon: string
  description: string
  difficulty: string
  skill_id: number | null
  is_verified: boolean
  verified_score: number | null
  assessment_count: number
  best_score: number | null
  last_attempted: string | null
}

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
  max_difficulty_reached: number
  tab_switches: number
  copy_paste_attempts: number
}

export function CandidateAssessmentsPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('available')
  const [skills, setSkills] = useState<SkillCatalog[]>([])
  const [results, setResults] = useState<AssessmentResult[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [skillsRes, resultsRes] = await Promise.allSettled([
        apiCall<{ skills: SkillCatalog[] }>('/assessments/available'),
        apiCall<{ results: AssessmentResult[] }>('/assessments/results'),
      ])
      if (skillsRes.status === 'fulfilled') setSkills(skillsRes.value.skills || [])
      if (resultsRes.status === 'fulfilled') setResults(resultsRes.value.results || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function startAssessment(skill: SkillCatalog) {
    setStarting(skill.catalog_name)
    try {
      const data = await apiCall<{ sessionId: number; skillName: string; question: unknown }>('/assessments/start', {
        method: 'POST',
        body: {
          skillName: skill.catalog_name,
          category: skill.category,
          skillId: skill.skill_id,
        },
      })
      // Store the first question in sessionStorage so assessment-take can pick it up
      sessionStorage.setItem(`assessment_${data.sessionId}`, JSON.stringify({
        question: data.question,
        skillName: data.skillName || skill.catalog_name,
      }))
      navigate(`/candidate/assessments/${data.sessionId}/take`)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to start assessment')
    } finally {
      setStarting(null)
    }
  }

  const categoryGroups = skills.reduce((acc, s) => {
    const cat = s.category || 'other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(s)
    return acc
  }, {} as Record<string, SkillCatalog[]>)

  const categoryLabels: Record<string, string> = {
    technical: 'Technical Skills',
    analytical: 'Analytical Skills',
    soft_skill: 'Soft Skills',
    other: 'Other',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">Skill Assessments</h1>
        <p className="text-muted-foreground">Verify your skills with AI-powered assessments</p>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{results.length}</p>
            <p className="text-xs text-muted-foreground">Tests Taken</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">
              {results.filter(r => r.passed).length}
            </p>
            <p className="text-xs text-muted-foreground">Passed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">
              {skills.filter(s => s.is_verified).length}
            </p>
            <p className="text-xs text-muted-foreground">Verified Skills</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="available">Available Tests</TabsTrigger>
          <TabsTrigger value="results">My Results</TabsTrigger>
        </TabsList>

        <TabsContent value="available">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="space-y-6 mt-4">
              {Object.entries(categoryGroups).map(([cat, catSkills]) => (
                <div key={cat}>
                  <h3 className="font-medium text-sm text-muted-foreground mb-3">
                    {categoryLabels[cat] || cat}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {catSkills.map(skill => (
                      <Card key={skill.catalog_name} className="relative">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary font-mono font-bold text-xs">
                                {skill.icon}
                              </div>
                              <div>
                                <h4 className="font-medium text-sm">{skill.catalog_name}</h4>
                                <p className="text-xs text-muted-foreground">{skill.difficulty}</p>
                              </div>
                            </div>
                            {skill.is_verified && (
                              <Badge variant="success" className="text-[10px]">
                                <Shield className="h-3 w-3 mr-0.5" /> Verified
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mb-3">{skill.description}</p>
                          {skill.best_score !== null && (
                            <p className="text-xs mb-2">
                              Best: <span className="font-medium">{skill.best_score}/100</span>
                              <span className="text-muted-foreground ml-1">
                                ({skill.assessment_count} attempt{skill.assessment_count !== 1 ? 's' : ''})
                              </span>
                            </p>
                          )}
                          <Button
                            size="sm"
                            variant={skill.is_verified ? 'outline' : 'default'}
                            className="w-full gap-1"
                            onClick={() => startAssessment(skill)}
                            disabled={starting === skill.catalog_name}
                          >
                            {starting === skill.catalog_name ? (
                              <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                            {skill.is_verified ? 'Retake' : skill.assessment_count > 0 ? 'Try Again' : 'Start Test'}
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="results">
          {results.length === 0 ? (
            <Card className="mt-4">
              <CardContent className="py-16 text-center">
                <Trophy className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p className="text-muted-foreground">No assessment results yet</p>
                <Button className="mt-4" onClick={() => setTab('available')}>
                  Take a Test
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3 mt-4">
              {results.map(r => (
                <Card key={r.id}>
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium">{r.skill_name || r.title}</h4>
                          {r.passed ? (
                            <Badge variant="success" className="gap-1">
                              <CheckCircle className="h-3 w-3" /> Passed
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" /> Failed
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span>Score: {r.score}/{r.max_score || 100}</span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {Math.round((r.duration_seconds || 0) / 60)} min
                          </span>
                          <span>Max difficulty: {r.max_difficulty_reached}/5</span>
                          <span>{new Date(r.completed_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold">{r.score}%</div>
                        {r.anti_cheat_score < 80 && (
                          <span className="text-xs text-amber-600">Integrity: {r.anti_cheat_score}%</span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
