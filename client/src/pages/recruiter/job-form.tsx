import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft, Save, Plus, X, Briefcase, ListChecks, GripVertical, AlertCircle, Sparkles,
  Wand2, Lightbulb, Loader2, CheckCircle2, ChevronDown, ChevronUp,
} from 'lucide-react'

interface TitleSuggestion {
  title: string
  reason: string
  search_volume?: string
  seniority_match?: string
}

interface SkillSuggestion {
  skill: string
  category: string
  importance: string
}

interface ScreeningQuestion {
  id?: string
  question: string
  type: 'text' | 'yes_no' | 'select'
  required: boolean
  options?: string[]
  placeholder?: string
  category?: string
}

const defaultQuestionTemplates: ScreeningQuestion[] = [
  { question: 'Are you legally authorized to work in this country?', type: 'yes_no', required: true, category: 'work_authorization' },
  { question: 'What are your salary expectations? (annual, USD)', type: 'text', required: false, placeholder: 'e.g. $80,000 - $100,000', category: 'salary' },
  { question: 'When can you start?', type: 'select', required: true, options: ['Immediately', 'Within 2 weeks', 'Within 1 month', 'More than 1 month'], category: 'availability' },
  { question: 'Are you willing to relocate for this position?', type: 'yes_no', required: false, category: 'relocation' },
  { question: 'How many years of relevant experience do you have?', type: 'select', required: true, options: ['0-1 years', '1-3 years', '3-5 years', '5-10 years', '10+ years'], category: 'experience' },
]

const typeLabels: Record<string, string> = {
  text: 'Text',
  yes_no: 'Yes / No',
  select: 'Dropdown',
}

export function RecruiterJobFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = !!id
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)

  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [description, setDescription] = useState('')
  const [requirements, setRequirements] = useState('')
  const [location, setLocation] = useState('')
  const [salaryRange, setSalaryRange] = useState('')
  const [jobType, setJobType] = useState('full-time')
  const [screeningQuestions, setScreeningQuestions] = useState<ScreeningQuestion[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [titleError, setTitleError] = useState('')

  // AI feature states
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiSuggestingSkills, setAiSuggestingSkills] = useState(false)
  const [aiSuggestingTitles, setAiSuggestingTitles] = useState(false)
  const [titleSuggestions, setTitleSuggestions] = useState<TitleSuggestion[]>([])
  const [showTitleSuggestions, setShowTitleSuggestions] = useState(false)
  const [skillSuggestions, setSkillSuggestions] = useState<SkillSuggestion[]>([])
  const [suggestedRequirements, setSuggestedRequirements] = useState<string[]>([])
  const [showSkillPanel, setShowSkillPanel] = useState(false)
  const [aiSuccess, setAiSuccess] = useState<string | null>(null)

  // Multi-country fields
  const [countryCode, setCountryCode] = useState('US')
  const [currencyCode, setCurrencyCode] = useState('USD')
  const [currencySymbol, setCurrencySymbol] = useState('$')
  const [salaryMin, setSalaryMin] = useState('')
  const [salaryMax, setSalaryMax] = useState('')
  const [countries, setCountries] = useState<{ country_code: string; country_name: string; currency_code: string; currency_symbol: string }[]>([])

  useEffect(() => {
    loadCountries()
    if (isEdit) loadJob()
  }, [id])

  async function loadCountries() {
    try {
      const data = await apiCall<{ countries: any[] }>('/countries')
      setCountries(data.countries)
    } catch { /* fallback to US only */ }
  }

  function handleCountryChange(code: string) {
    setCountryCode(code)
    const country = countries.find(c => c.country_code === code)
    if (country) {
      setCurrencyCode(country.currency_code)
      setCurrencySymbol(country.currency_symbol)
    }
  }

  async function loadJob() {
    try {
      const data = await apiCall<{ job: { title: string; company: string; description: string; requirements: string; location: string; salary_range: string; job_type: string; screening_questions: string | ScreeningQuestion[] } }>(`/jobs/${id}`)
      const job = data.job
      setTitle(job.title || '')
      setCompany(job.company || '')
      setDescription(job.description || '')
      setRequirements(job.requirements || '')
      setLocation(job.location || '')
      setSalaryRange(job.salary_range || '')
      setJobType(job.job_type || 'full-time')
      if (job.screening_questions) {
        const parsed = typeof job.screening_questions === 'string'
          ? JSON.parse(job.screening_questions)
          : job.screening_questions
        if (Array.isArray(parsed)) {
          setScreeningQuestions(parsed.map((q: ScreeningQuestion) => ({
            ...q,
            type: q.type || 'text',
            required: q.required ?? false,
          })))
        }
      }
    } catch {
      navigate('/recruiter/jobs')
    } finally {
      setLoading(false)
    }
  }

  function flashSuccess(msg: string) {
    setAiSuccess(msg)
    setTimeout(() => setAiSuccess(null), 3000)
  }

  async function handleAiGenerate() {
    if (!title.trim()) {
      setTitleError('Enter a job title first so AI can generate a description')
      return
    }
    setAiGenerating(true)
    try {
      const data = await apiCall<{ generated: { description: string; requirements: string; suggested_skills: string[]; suggested_title: string } }>('/recruiter/jobs/generate', {
        method: 'POST',
        body: { title, brief_notes: description, location, job_type: jobType },
      })
      if (data.generated) {
        setDescription(data.generated.description || '')
        setRequirements(data.generated.requirements || '')
        flashSuccess('Description & requirements generated!')
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'AI generation failed')
    } finally {
      setAiGenerating(false)
    }
  }

  async function handleSuggestSkills() {
    if (!title.trim()) {
      setTitleError('Enter a job title first')
      return
    }
    setAiSuggestingSkills(true)
    try {
      const data = await apiCall<{ suggestions: { required_skills: SkillSuggestion[]; suggested_requirements: string[] } }>('/recruiter/jobs/suggest-skills', {
        method: 'POST',
        body: { title, description, current_skills: [] },
      })
      if (data.suggestions) {
        setSkillSuggestions(data.suggestions.required_skills || [])
        setSuggestedRequirements(data.suggestions.suggested_requirements || [])
        setShowSkillPanel(true)
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Skill suggestion failed')
    } finally {
      setAiSuggestingSkills(false)
    }
  }

  async function handleSuggestTitles() {
    if (!title.trim()) {
      setTitleError('Enter a job title first')
      return
    }
    setAiSuggestingTitles(true)
    try {
      const data = await apiCall<{ suggestions: { suggestions: TitleSuggestion[] } }>('/recruiter/jobs/suggest-title', {
        method: 'POST',
        body: { title, description },
      })
      if (data.suggestions?.suggestions) {
        setTitleSuggestions(data.suggestions.suggestions)
        setShowTitleSuggestions(true)
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Title suggestion failed')
    } finally {
      setAiSuggestingTitles(false)
    }
  }

  function applySkillsToRequirements() {
    const newReqs = suggestedRequirements.join('\n• ')
    const skillsList = skillSuggestions.map(s => s.skill).join(', ')
    const combined = `${requirements ? requirements + '\n\n' : ''}Skills: ${skillsList}\n\n• ${newReqs}`
    setRequirements(combined)
    setShowSkillPanel(false)
    flashSuccess('Skills added to requirements!')
  }

  async function handleSave() {
    if (!title.trim()) {
      setTitleError('Job title is required')
      return
    }
    setTitleError('')
    setSaving(true)
    try {
      const payload = {
        title,
        company: company || undefined,
        description,
        requirements,
        location,
        salary_range: salaryRange,
        job_type: jobType,
        screening_questions: screeningQuestions.filter(q => q.question.trim()),
        country_code: countryCode,
        currency_code: currencyCode,
        salary_min: salaryMin ? parseFloat(salaryMin) : undefined,
        salary_max: salaryMax ? parseFloat(salaryMax) : undefined,
      }
      if (isEdit) {
        await apiCall(`/recruiter/jobs/${id}`, {
          method: 'PUT',
          body: { ...payload, screening_questions: JSON.stringify(payload.screening_questions) },
        })
      } else {
        await apiCall('/recruiter/jobs', {
          method: 'POST',
          body: payload,
        })
      }
      navigate('/recruiter/jobs')
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to save job')
    } finally {
      setSaving(false)
    }
  }

  function addQuestion(template?: ScreeningQuestion) {
    const newQ: ScreeningQuestion = template
      ? { ...template, id: `sq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
      : { question: '', type: 'text', required: false, id: `sq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
    setScreeningQuestions(prev => [...prev, newQ])
    setShowTemplates(false)
  }

  function addAllDefaults() {
    const existing = new Set(screeningQuestions.map(q => q.question.toLowerCase()))
    const toAdd = defaultQuestionTemplates
      .filter(t => !existing.has(t.question.toLowerCase()))
      .map(t => ({ ...t, id: `sq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }))
    setScreeningQuestions(prev => [...prev, ...toAdd])
    setShowTemplates(false)
  }

  function updateQuestion(index: number, updates: Partial<ScreeningQuestion>) {
    setScreeningQuestions(prev => prev.map((q, i) => i === index ? { ...q, ...updates } : q))
  }

  function removeQuestion(index: number) {
    setScreeningQuestions(prev => prev.filter((_, i) => i !== index))
  }

  function addOption(qIndex: number) {
    setScreeningQuestions(prev => prev.map((q, i) =>
      i === qIndex ? { ...q, options: [...(q.options || []), ''] } : q
    ))
  }

  function updateOption(qIndex: number, optIndex: number, value: string) {
    setScreeningQuestions(prev => prev.map((q, i) =>
      i === qIndex ? { ...q, options: (q.options || []).map((o, j) => j === optIndex ? value : o) } : q
    ))
  }

  function removeOption(qIndex: number, optIndex: number) {
    setScreeningQuestions(prev => prev.map((q, i) =>
      i === qIndex ? { ...q, options: (q.options || []).filter((_, j) => j !== optIndex) } : q
    ))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* AI Success Toast */}
      {aiSuccess && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-2 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4" />
          {aiSuccess}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/recruiter/jobs')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="font-heading text-2xl font-bold">
            {isEdit ? 'Edit Job' : 'Post New Job'}
          </h1>
          <p className="text-muted-foreground text-sm">
            {isEdit ? 'Update your job listing' : 'Create a new job posting'}
          </p>
        </div>
      </div>

      {/* Job details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" /> Job Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <Label>Job Title *</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSuggestTitles}
                disabled={aiSuggestingTitles || !title.trim()}
                className="h-7 text-xs gap-1 text-primary hover:text-primary"
              >
                {aiSuggestingTitles ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lightbulb className="h-3 w-3" />}
                Suggest Titles
              </Button>
            </div>
            <Input
              value={title}
              onChange={e => { setTitle(e.target.value); setTitleError('') }}
              placeholder="e.g. Senior Software Engineer"
              className={`mt-1 ${titleError ? 'border-destructive' : ''}`}
            />
            {titleError && (
              <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />{titleError}
              </p>
            )}
            {/* AI Title Suggestions */}
            {showTitleSuggestions && titleSuggestions.length > 0 && (
              <div className="mt-2 rounded-lg border bg-blue-50/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-blue-700 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> AI Title Suggestions
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => setShowTitleSuggestions(false)} className="h-6 w-6 p-0">
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                {titleSuggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => { setTitle(s.title); setShowTitleSuggestions(false); flashSuccess('Title updated!') }}
                    className="w-full text-left rounded-md border bg-white p-2.5 text-sm hover:border-primary/40 hover:bg-blue-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{s.title}</span>
                      {s.search_volume && (
                        <Badge variant="outline" className="text-[9px]">{s.search_volume} search</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.reason}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Company Name <span className="text-muted-foreground text-xs">(auto-filled from your account if blank)</span></Label>
            <Input
              value={company}
              onChange={e => setCompany(e.target.value)}
              placeholder="Leave blank to use your company name"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label>Job Type</Label>
              <Select value={jobType} onChange={e => setJobType(e.target.value)} className="mt-1">
                <option value="full-time">Full-time</option>
                <option value="part-time">Part-time</option>
                <option value="contract">Contract</option>
                <option value="internship">Internship</option>
                <option value="remote">Remote</option>
                <option value="freelance">Freelance</option>
              </Select>
            </div>
            <div>
              <Label>Country</Label>
              <Select value={countryCode} onChange={e => handleCountryChange(e.target.value)} className="mt-1">
                {countries.length > 0 ? countries.map(c => (
                  <option key={c.country_code} value={c.country_code}>{c.country_name}</option>
                )) : (
                  <>
                    <option value="US">United States</option>
                    <option value="IN">India</option>
                    <option value="GB">United Kingdom</option>
                    <option value="CA">Canada</option>
                    <option value="DE">Germany</option>
                    <option value="FR">France</option>
                    <option value="AU">Australia</option>
                    <option value="SG">Singapore</option>
                  </>
                )}
              </Select>
            </div>
            <div>
              <Label>Location</Label>
              <Input
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="e.g. New York, NY or Remote"
                className="mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label>Min Salary ({currencySymbol})</Label>
              <Input
                type="number"
                value={salaryMin}
                onChange={e => setSalaryMin(e.target.value)}
                placeholder={`e.g. ${currencyCode === 'INR' ? '800000' : currencyCode === 'GBP' ? '40000' : '80000'}`}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Max Salary ({currencySymbol})</Label>
              <Input
                type="number"
                value={salaryMax}
                onChange={e => setSalaryMax(e.target.value)}
                placeholder={`e.g. ${currencyCode === 'INR' ? '1500000' : currencyCode === 'GBP' ? '70000' : '120000'}`}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Salary Range (text) <span className="text-muted-foreground text-xs">(optional override)</span></Label>
              <Input
                value={salaryRange}
                onChange={e => setSalaryRange(e.target.value)}
                placeholder={`e.g. ${currencySymbol}80,000 - ${currencySymbol}120,000`}
                className="mt-1"
              />
            </div>
          </div>
          {currencyCode !== 'USD' && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {currencyCode} ({currencySymbol})
              </Badge>
              <span className="text-xs text-muted-foreground">Salary will be displayed in {currencyCode}</span>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between">
              <Label>Job Description</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAiGenerate}
                disabled={aiGenerating || !title.trim()}
                className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary hover:text-white transition-colors"
              >
                {aiGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                {aiGenerating ? 'Generating...' : '✨ Generate with AI'}
              </Button>
            </div>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the role, responsibilities, and what a typical day looks like... or click 'Generate with AI' to auto-fill"
              rows={6}
              className="mt-1"
            />
            {aiGenerating && (
              <div className="mt-2 flex items-center gap-2 text-xs text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                AI is writing a tailored description based on your job title...
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Requirements</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSuggestSkills}
                disabled={aiSuggestingSkills || !title.trim()}
                className="h-7 text-xs gap-1 text-primary hover:text-primary"
              >
                {aiSuggestingSkills ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lightbulb className="h-3 w-3" />}
                Suggest Skills
              </Button>
            </div>
            <Textarea
              value={requirements}
              onChange={e => setRequirements(e.target.value)}
              placeholder="List the required skills, experience, and qualifications..."
              rows={4}
              className="mt-1"
            />
            {/* AI Skills Panel */}
            {showSkillPanel && (skillSuggestions.length > 0 || suggestedRequirements.length > 0) && (
              <div className="mt-2 rounded-lg border bg-violet-50/50 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-violet-700 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> AI Suggested Skills & Requirements
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => setShowSkillPanel(false)} className="h-6 w-6 p-0">
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                {skillSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {skillSuggestions.map((s, i) => (
                      <span
                        key={i}
                        className={`text-[11px] rounded-full px-2.5 py-1 border ${
                          s.importance === 'must-have'
                            ? 'bg-violet-100 text-violet-700 border-violet-200 font-medium'
                            : 'bg-white text-muted-foreground border-gray-200'
                        }`}
                      >
                        {s.skill}
                        {s.importance === 'must-have' && <span className="ml-1 text-[9px]">★</span>}
                      </span>
                    ))}
                  </div>
                )}
                {suggestedRequirements.length > 0 && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    {suggestedRequirements.slice(0, 5).map((r, i) => (
                      <p key={i} className="flex items-start gap-1.5">
                        <CheckCircle2 className="h-3 w-3 text-violet-400 mt-0.5 shrink-0" />
                        {r}
                      </p>
                    ))}
                  </div>
                )}
                <Button
                  size="sm"
                  onClick={applySkillsToRequirements}
                  className="w-full text-xs gap-1 bg-violet-600 hover:bg-violet-700"
                >
                  <Plus className="h-3 w-3" /> Apply to Requirements
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Screening Questions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" /> Pre-screening Questions
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowTemplates(!showTemplates)} className="gap-1">
              <Sparkles className="h-3 w-3" /> Templates
            </Button>
            <Button variant="outline" size="sm" onClick={() => addQuestion()} className="gap-1">
              <Plus className="h-3 w-3" /> Custom
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Templates dropdown */}
          {showTemplates && (
            <div className="mb-4 rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Common Questions</p>
                <Button variant="ghost" size="sm" onClick={addAllDefaults} className="text-xs">
                  Add All
                </Button>
              </div>
              {defaultQuestionTemplates.map((t, i) => {
                const alreadyAdded = screeningQuestions.some(q => q.question.toLowerCase() === t.question.toLowerCase())
                return (
                  <button
                    key={i}
                    onClick={() => !alreadyAdded && addQuestion(t)}
                    disabled={alreadyAdded}
                    className={`w-full text-left rounded-md border p-2.5 text-sm transition-colors ${
                      alreadyAdded
                        ? 'opacity-50 cursor-not-allowed bg-muted'
                        : 'hover:bg-background hover:border-primary/30 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{t.question}</span>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px]">{typeLabels[t.type]}</Badge>
                        {t.required && <Badge variant="secondary" className="text-[10px]">Required</Badge>}
                        {alreadyAdded && <span className="text-[10px] text-muted-foreground">Added</span>}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {screeningQuestions.length === 0 ? (
            <div className="text-center py-8">
              <ListChecks className="mx-auto mb-2 h-8 w-8 opacity-30" />
              <p className="text-sm text-muted-foreground mb-1">No screening questions</p>
              <p className="text-xs text-muted-foreground">Add questions to filter candidates before reviewing applications</p>
            </div>
          ) : (
            <div className="space-y-3">
              {screeningQuestions.map((q, i) => (
                <div key={q.id || i} className="rounded-lg border p-4 space-y-3 group">
                  <div className="flex items-start gap-2">
                    <GripVertical className="h-4 w-4 mt-2.5 text-muted-foreground/40 shrink-0" />
                    <div className="flex-1 space-y-3">
                      {/* Question text */}
                      <Input
                        value={q.question}
                        onChange={e => updateQuestion(i, { question: e.target.value })}
                        placeholder={`Question ${i + 1}...`}
                      />

                      {/* Type and options row */}
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={q.type}
                          onChange={e => {
                            const newType = e.target.value as ScreeningQuestion['type']
                            const updates: Partial<ScreeningQuestion> = { type: newType }
                            if (newType === 'select' && (!q.options || q.options.length === 0)) {
                              updates.options = ['']
                            }
                            if (newType !== 'select') {
                              updates.options = undefined
                            }
                            updateQuestion(i, updates)
                          }}
                          className="w-32 text-xs"
                        >
                          <option value="text">Text</option>
                          <option value="yes_no">Yes / No</option>
                          <option value="select">Dropdown</option>
                        </Select>

                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={q.required}
                            onChange={() => updateQuestion(i, { required: !q.required })}
                            className="rounded"
                          />
                          Required
                        </label>

                        {q.type === 'text' && (
                          <Input
                            value={q.placeholder || ''}
                            onChange={e => updateQuestion(i, { placeholder: e.target.value })}
                            placeholder="Placeholder text..."
                            className="flex-1 text-xs h-8"
                          />
                        )}
                      </div>

                      {/* Options for select type */}
                      {q.type === 'select' && (
                        <div className="space-y-2 pl-2 border-l-2 border-muted">
                          <p className="text-xs text-muted-foreground font-medium">Dropdown Options</p>
                          {(q.options || []).map((opt, oi) => (
                            <div key={oi} className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground w-4">{oi + 1}.</span>
                              <Input
                                value={opt}
                                onChange={e => updateOption(i, oi, e.target.value)}
                                placeholder={`Option ${oi + 1}`}
                                className="flex-1 text-sm h-8"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={() => removeOption(i, oi)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => addOption(i)}
                            className="text-xs gap-1"
                          >
                            <Plus className="h-3 w-3" /> Add Option
                          </Button>
                        </div>
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeQuestion(i)}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-2 sticky bottom-4 bg-background/80 backdrop-blur-sm py-3 rounded-lg">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {isEdit ? 'Update Job' : 'Publish Job'}
        </Button>
        <Button variant="outline" onClick={() => navigate('/recruiter/jobs')}>Cancel</Button>
      </div>
    </div>
  )
}
