import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import {
  ArrowLeft, Save, Plus, X, Briefcase,
} from 'lucide-react'

interface ScreeningQuestion {
  question: string
  required: boolean
}

export function RecruiterJobFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = !!id
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [requirements, setRequirements] = useState('')
  const [location, setLocation] = useState('')
  const [salaryRange, setSalaryRange] = useState('')
  const [jobType, setJobType] = useState('full-time')
  const [screeningQuestions, setScreeningQuestions] = useState<ScreeningQuestion[]>([])

  useEffect(() => {
    if (isEdit) loadJob()
  }, [id])

  async function loadJob() {
    try {
      const data = await apiCall<{ job: { title: string; description: string; requirements: string; location: string; salary_range: string; job_type: string; screening_questions: string } }>(`/jobs/${id}`)
      const job = data.job
      setTitle(job.title || '')
      setDescription(job.description || '')
      setRequirements(job.requirements || '')
      setLocation(job.location || '')
      setSalaryRange(job.salary_range || '')
      setJobType(job.job_type || 'full-time')
      if (job.screening_questions) {
        const parsed = typeof job.screening_questions === 'string'
          ? JSON.parse(job.screening_questions)
          : job.screening_questions
        setScreeningQuestions(Array.isArray(parsed) ? parsed : [])
      }
    } catch {
      navigate('/recruiter/jobs')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!title.trim()) {
      alert('Job title is required')
      return
    }
    setSaving(true)
    try {
      if (isEdit) {
        await apiCall(`/recruiter/jobs/${id}`, {
          method: 'PUT',
          body: { title, description, requirements, location, salary_range: salaryRange, job_type: jobType, screening_questions: JSON.stringify(screeningQuestions) },
        })
      } else {
        await apiCall('/jobs', {
          method: 'POST',
          body: { title, description, requirements, location, salary_range: salaryRange, job_type: jobType, screening_questions: screeningQuestions },
        })
      }
      navigate('/recruiter/jobs')
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to save job')
    } finally {
      setSaving(false)
    }
  }

  function addQuestion() {
    setScreeningQuestions(prev => [...prev, { question: '', required: false }])
  }

  function updateQuestion(index: number, question: string) {
    setScreeningQuestions(prev => prev.map((q, i) => i === index ? { ...q, question } : q))
  }

  function toggleRequired(index: number) {
    setScreeningQuestions(prev => prev.map((q, i) => i === index ? { ...q, required: !q.required } : q))
  }

  function removeQuestion(index: number) {
    setScreeningQuestions(prev => prev.filter((_, i) => i !== index))
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
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/recruiter/jobs')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="font-heading text-2xl font-bold">
            {isEdit ? 'Edit Job' : 'Post New Job'}
          </h1>
          <p className="text-muted-foreground">
            {isEdit ? 'Update your job listing' : 'Create a new job posting'}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" /> Job Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Job Title *</Label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Senior Software Engineer"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Job Type</Label>
              <Select value={jobType} onChange={e => setJobType(e.target.value)} className="mt-1">
                <option value="full-time">Full-time</option>
                <option value="part-time">Part-time</option>
                <option value="contract">Contract</option>
                <option value="internship">Internship</option>
                <option value="remote">Remote</option>
              </Select>
            </div>
            <div>
              <Label>Location</Label>
              <Input
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="e.g. New York, NY"
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label>Salary Range</Label>
            <Input
              value={salaryRange}
              onChange={e => setSalaryRange(e.target.value)}
              placeholder="e.g. $80,000 - $120,000"
              className="mt-1"
            />
          </div>

          <div>
            <Label>Job Description</Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the role, responsibilities, and what a typical day looks like..."
              rows={6}
              className="mt-1"
            />
          </div>

          <div>
            <Label>Requirements</Label>
            <Textarea
              value={requirements}
              onChange={e => setRequirements(e.target.value)}
              placeholder="List the required skills, experience, and qualifications..."
              rows={4}
              className="mt-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Screening Questions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Pre-screening Questions</CardTitle>
          <Button variant="outline" size="sm" onClick={addQuestion} className="gap-1">
            <Plus className="h-3 w-3" /> Add Question
          </Button>
        </CardHeader>
        <CardContent>
          {screeningQuestions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No screening questions. Add questions to filter candidates before reviewing applications.
            </p>
          ) : (
            <div className="space-y-3">
              {screeningQuestions.map((q, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border p-3">
                  <div className="flex-1">
                    <Input
                      value={q.question}
                      onChange={e => updateQuestion(i, e.target.value)}
                      placeholder={`Question ${i + 1}...`}
                      className="mb-2"
                    />
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={q.required}
                        onChange={() => toggleRequired(i)}
                        className="rounded"
                      />
                      Required
                    </label>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeQuestion(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-2">
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
