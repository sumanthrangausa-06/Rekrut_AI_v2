import { useEffect, useState, useRef } from 'react'
import { apiCall } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  User, Briefcase, GraduationCap, Wrench, FileText,
  Plus, Pencil, Trash2, Save, Upload, MapPin, Phone, Link2,
  Github, Linkedin, Globe, CheckCircle, AlertCircle, X,
  Calendar, Building2, Award, Star,
} from 'lucide-react'

// ============= Types =============

interface Profile {
  user_id?: number
  name?: string
  email?: string
  avatar_url?: string
  headline?: string
  bio?: string
  location?: string
  phone?: string
  linkedin_url?: string
  github_url?: string
  portfolio_url?: string
  resume_url?: string
  availability?: string
  salary_min?: number
  salary_max?: number
  preferred_job_types?: string[]
  preferred_locations?: string[]
  remote_preference?: string
  years_experience?: number
}

interface Experience {
  id: number
  company_name: string
  title: string
  location?: string
  start_date?: string
  end_date?: string
  is_current?: boolean
  description?: string
  achievements?: string[]
  skills_used?: string[]
}

interface Education {
  id: number
  institution: string
  degree: string
  field_of_study?: string
  start_date?: string
  end_date?: string
  is_current?: boolean
  gpa?: string
  achievements?: string[]
}

interface Skill {
  id: number
  skill_name: string
  category: string
  level: number
  years_experience?: number
  is_verified?: boolean
}

// ============= Main Component =============

export function CandidateProfilePage() {
  const { user } = useAuth()
  const [tab, setTab] = useState('personal')
  const [profile, setProfile] = useState<Profile>({})
  const [experience, setExperience] = useState<Experience[]>([])
  const [education, setEducation] = useState<Education[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadProfile()
  }, [])

  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(null), 3000)
      return () => clearTimeout(t)
    }
  }, [message])

  async function loadProfile() {
    try {
      const data = await apiCall<{
        success: boolean
        profile: Profile
        experience: Experience[]
        education: Education[]
        skills: Skill[]
      }>('/candidate/profile')
      setProfile({ ...data.profile, name: data.profile.name || user?.name, email: data.profile.email || user?.email })
      setExperience(data.experience || [])
      setEducation(data.education || [])
      setSkills(data.skills || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
  }

  // Compute profile completeness
  const completenessFields = [
    profile.name,
    profile.headline,
    profile.bio,
    profile.location,
    profile.linkedin_url || profile.github_url,
    profile.resume_url,
    skills.length > 0,
    experience.length > 0,
    education.length > 0,
    profile.phone,
  ]
  const completeness = Math.round((completenessFields.filter(Boolean).length / completenessFields.length) * 100)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Toast message */}
      {message && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
          message.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-destructive text-white'
        }`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">My Profile</h1>
          <p className="text-muted-foreground">Manage your professional profile for employers</p>
        </div>
        <div className="flex items-center gap-3">
          <ProfileCompleteness value={completeness} />
        </div>
      </div>

      {/* Profile header card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <AvatarUpload profile={profile} onUploaded={(url) => setProfile(p => ({ ...p, avatar_url: url }))} showMessage={showMessage} />
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold truncate">{profile.name || 'Your Name'}</h2>
              <p className="text-muted-foreground">{profile.headline || 'Add a professional headline'}</p>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
                {profile.location && (
                  <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {profile.location}</span>
                )}
                {profile.email && (
                  <span className="flex items-center gap-1">✉ {profile.email}</span>
                )}
                {profile.phone && (
                  <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {profile.phone}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {profile.linkedin_url && (
                  <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer">
                    <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-muted">
                      <Linkedin className="h-3 w-3" /> LinkedIn
                    </Badge>
                  </a>
                )}
                {profile.github_url && (
                  <a href={profile.github_url} target="_blank" rel="noopener noreferrer">
                    <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-muted">
                      <Github className="h-3 w-3" /> GitHub
                    </Badge>
                  </a>
                )}
                {profile.portfolio_url && (
                  <a href={profile.portfolio_url} target="_blank" rel="noopener noreferrer">
                    <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-muted">
                      <Globe className="h-3 w-3" /> Portfolio
                    </Badge>
                  </a>
                )}
                {profile.resume_url && (
                  <a href={profile.resume_url} target="_blank" rel="noopener noreferrer">
                    <Badge variant="secondary" className="gap-1 cursor-pointer hover:bg-muted">
                      <FileText className="h-3 w-3" /> Resume
                    </Badge>
                  </a>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full flex flex-wrap gap-1">
          <TabsTrigger value="personal" className="gap-1.5"><User className="h-3.5 w-3.5" /> Personal</TabsTrigger>
          <TabsTrigger value="experience" className="gap-1.5"><Briefcase className="h-3.5 w-3.5" /> Experience</TabsTrigger>
          <TabsTrigger value="education" className="gap-1.5"><GraduationCap className="h-3.5 w-3.5" /> Education</TabsTrigger>
          <TabsTrigger value="skills" className="gap-1.5"><Wrench className="h-3.5 w-3.5" /> Skills</TabsTrigger>
          <TabsTrigger value="resume" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Resume</TabsTrigger>
        </TabsList>

        <TabsContent value="personal">
          <PersonalInfoTab
            profile={profile}
            setProfile={setProfile}
            saving={saving}
            setSaving={setSaving}
            showMessage={showMessage}
          />
        </TabsContent>

        <TabsContent value="experience">
          <ExperienceTab
            experience={experience}
            setExperience={setExperience}
            showMessage={showMessage}
          />
        </TabsContent>

        <TabsContent value="education">
          <EducationTab
            education={education}
            setEducation={setEducation}
            showMessage={showMessage}
          />
        </TabsContent>

        <TabsContent value="skills">
          <SkillsTab
            skills={skills}
            setSkills={setSkills}
            showMessage={showMessage}
          />
        </TabsContent>

        <TabsContent value="resume">
          <ResumeTab
            profile={profile}
            setProfile={setProfile}
            showMessage={showMessage}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============= Profile Completeness =============

function ProfileCompleteness({ value }: { value: number }) {
  const color = value >= 80 ? 'text-emerald-600' : value >= 50 ? 'text-amber-500' : 'text-red-500'
  const bg = value >= 80 ? 'bg-emerald-600' : value >= 50 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className={`text-sm font-bold ${color}`}>{value}%</p>
        <p className="text-[10px] text-muted-foreground">Complete</p>
      </div>
      <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${bg}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

// ============= Avatar Upload =============

function AvatarUpload({ profile, onUploaded, showMessage }: {
  profile: Profile
  onUploaded: (url: string) => void
  showMessage: (type: 'success' | 'error', text: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('photo', file)
      const data = await apiCall<{ success: boolean; photo_url: string }>('/candidate/profile/photo', {
        method: 'POST',
        body: formData,
        isFormData: true,
      })
      onUploaded(data.photo_url)
      showMessage('success', 'Photo updated')
    } catch {
      showMessage('error', 'Failed to upload photo')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="relative group">
      <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center overflow-hidden border-2 border-border">
        {profile.avatar_url ? (
          <img src={profile.avatar_url} alt="Avatar" className="h-full w-full object-cover" />
        ) : (
          <User className="h-8 w-8 text-muted-foreground" />
        )}
      </div>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {uploading ? (
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : (
          <Upload className="h-5 w-5 text-white" />
        )}
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
    </div>
  )
}

// ============= Personal Info Tab =============

function PersonalInfoTab({ profile, setProfile, saving, setSaving, showMessage }: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
  saving: boolean
  setSaving: React.Dispatch<React.SetStateAction<boolean>>
  showMessage: (type: 'success' | 'error', text: string) => void
}) {
  const [form, setForm] = useState({ ...profile })

  useEffect(() => {
    setForm({ ...profile })
  }, [profile])

  function updateForm(key: string, value: string | number) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await apiCall('/candidate/profile', {
        method: 'PUT',
        body: form,
      })
      setProfile(f => ({ ...f, ...form }))
      showMessage('success', 'Profile saved')
    } catch {
      showMessage('error', 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-6">
        <h3 className="font-semibold flex items-center gap-2"><User className="h-4 w-4" /> Personal Information</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Full Name</Label>
            <Input value={form.name || ''} onChange={e => updateForm('name', e.target.value)} placeholder="John Doe" />
          </div>
          <div>
            <Label>Headline</Label>
            <Input value={form.headline || ''} onChange={e => updateForm('headline', e.target.value)} placeholder="Senior Software Engineer" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={form.phone || ''} onChange={e => updateForm('phone', e.target.value)} placeholder="+1 (555) 000-0000" />
          </div>
          <div>
            <Label>Location</Label>
            <Input value={form.location || ''} onChange={e => updateForm('location', e.target.value)} placeholder="San Francisco, CA" />
          </div>
        </div>

        <div>
          <Label>Bio / Summary</Label>
          <Textarea
            value={form.bio || ''}
            onChange={e => updateForm('bio', e.target.value)}
            placeholder="Brief professional summary..."
            rows={4}
          />
        </div>

        <h3 className="font-semibold flex items-center gap-2 pt-2"><Link2 className="h-4 w-4" /> Social Links</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="flex items-center gap-1"><Linkedin className="h-3 w-3" /> LinkedIn URL</Label>
            <Input value={form.linkedin_url || ''} onChange={e => updateForm('linkedin_url', e.target.value)} placeholder="https://linkedin.com/in/..." />
          </div>
          <div>
            <Label className="flex items-center gap-1"><Github className="h-3 w-3" /> GitHub URL</Label>
            <Input value={form.github_url || ''} onChange={e => updateForm('github_url', e.target.value)} placeholder="https://github.com/..." />
          </div>
          <div>
            <Label className="flex items-center gap-1"><Globe className="h-3 w-3" /> Portfolio URL</Label>
            <Input value={form.portfolio_url || ''} onChange={e => updateForm('portfolio_url', e.target.value)} placeholder="https://yoursite.com" />
          </div>
        </div>

        <h3 className="font-semibold flex items-center gap-2 pt-2"><Briefcase className="h-4 w-4" /> Preferences</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Years of Experience</Label>
            <Input
              type="number"
              value={form.years_experience ?? ''}
              onChange={e => updateForm('years_experience', parseInt(e.target.value) || 0)}
              placeholder="5"
            />
          </div>
          <div>
            <Label>Remote Preference</Label>
            <select
              value={form.remote_preference || 'hybrid'}
              onChange={e => updateForm('remote_preference', e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="remote">Remote Only</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
              <option value="flexible">Flexible</option>
            </select>
          </div>
          <div>
            <Label>Availability</Label>
            <select
              value={form.availability || 'open'}
              onChange={e => updateForm('availability', e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="open">Open to Opportunities</option>
              <option value="actively_looking">Actively Looking</option>
              <option value="not_looking">Not Looking</option>
              <option value="available_soon">Available Soon</option>
            </select>
          </div>
          <div>
            <Label>Minimum Salary ($)</Label>
            <Input
              type="number"
              value={form.salary_min ?? ''}
              onChange={e => updateForm('salary_min', parseInt(e.target.value) || 0)}
              placeholder="80000"
            />
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Save className="h-4 w-4" />}
            Save Changes
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ============= Experience Tab =============

function ExperienceTab({ experience, setExperience, showMessage }: {
  experience: Experience[]
  setExperience: React.Dispatch<React.SetStateAction<Experience[]>>
  showMessage: (type: 'success' | 'error', text: string) => void
}) {
  const [editing, setEditing] = useState<Experience | null>(null)
  const [isNew, setIsNew] = useState(false)

  function openNew() {
    setEditing({ id: 0, company_name: '', title: '', is_current: false })
    setIsNew(true)
  }

  function openEdit(exp: Experience) {
    setEditing({ ...exp })
    setIsNew(false)
  }

  async function handleSave() {
    if (!editing) return
    try {
      if (isNew) {
        const data = await apiCall<{ success: boolean; experience: Experience }>('/candidate/experience', {
          method: 'POST',
          body: editing,
        })
        setExperience(prev => [data.experience, ...prev])
      } else {
        const data = await apiCall<{ success: boolean; experience: Experience }>(`/candidate/experience/${editing.id}`, {
          method: 'PUT',
          body: editing,
        })
        setExperience(prev => prev.map(e => e.id === editing.id ? data.experience : e))
      }
      setEditing(null)
      showMessage('success', isNew ? 'Experience added' : 'Experience updated')
    } catch {
      showMessage('error', 'Failed to save experience')
    }
  }

  async function handleDelete(id: number) {
    try {
      await apiCall(`/candidate/experience/${id}`, { method: 'DELETE' })
      setExperience(prev => prev.filter(e => e.id !== id))
      showMessage('success', 'Experience removed')
    } catch {
      showMessage('error', 'Failed to delete experience')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><Briefcase className="h-4 w-4" /> Work Experience</h3>
        <Button size="sm" onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> Add</Button>
      </div>

      {experience.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Briefcase className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-muted-foreground mb-4">No work experience added yet</p>
            <Button onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> Add Experience</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {experience.map(exp => (
            <Card key={exp.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold">{exp.title}</h4>
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5" /> {exp.company_name}
                      {exp.location && <> · <MapPin className="h-3.5 w-3.5" /> {exp.location}</>}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {exp.start_date ? new Date(exp.start_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Start'} —{' '}
                      {exp.is_current ? 'Present' : exp.end_date ? new Date(exp.end_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'End'}
                    </p>
                    {exp.description && <p className="text-sm mt-2 text-muted-foreground line-clamp-2">{exp.description}</p>}
                    {exp.skills_used && Array.isArray(exp.skills_used) && exp.skills_used.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(typeof exp.skills_used === 'string' ? JSON.parse(exp.skills_used) : exp.skills_used).map((s: string) => (
                          <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(exp)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(exp.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit/Add dialog */}
      {editing && (
        <Dialog open={true} onClose={() => setEditing(null)} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isNew ? 'Add Experience' : 'Edit Experience'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Job Title *</Label>
                <Input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Software Engineer" />
              </div>
              <div>
                <Label>Company *</Label>
                <Input value={editing.company_name} onChange={e => setEditing({ ...editing, company_name: e.target.value })} placeholder="Acme Corp" />
              </div>
              <div>
                <Label>Location</Label>
                <Input value={editing.location || ''} onChange={e => setEditing({ ...editing, location: e.target.value })} placeholder="San Francisco, CA" />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editing.is_current || false}
                    onChange={e => setEditing({ ...editing, is_current: e.target.checked, end_date: e.target.checked ? undefined : editing.end_date })}
                    className="rounded border-input"
                  />
                  <span className="text-sm">Current Position</span>
                </label>
              </div>
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={editing.start_date?.split('T')[0] || ''} onChange={e => setEditing({ ...editing, start_date: e.target.value })} />
              </div>
              {!editing.is_current && (
                <div>
                  <Label>End Date</Label>
                  <Input type="date" value={editing.end_date?.split('T')[0] || ''} onChange={e => setEditing({ ...editing, end_date: e.target.value })} />
                </div>
              )}
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={editing.description || ''}
                onChange={e => setEditing({ ...editing, description: e.target.value })}
                placeholder="Describe your responsibilities and achievements..."
                rows={4}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={!editing.title || !editing.company_name} className="gap-1">
                <Save className="h-4 w-4" /> {isNew ? 'Add' : 'Save'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}

// ============= Education Tab =============

function EducationTab({ education, setEducation, showMessage }: {
  education: Education[]
  setEducation: React.Dispatch<React.SetStateAction<Education[]>>
  showMessage: (type: 'success' | 'error', text: string) => void
}) {
  const [editing, setEditing] = useState<Education | null>(null)
  const [isNew, setIsNew] = useState(false)

  function openNew() {
    setEditing({ id: 0, institution: '', degree: '' })
    setIsNew(true)
  }

  function openEdit(edu: Education) {
    setEditing({ ...edu })
    setIsNew(false)
  }

  async function handleSave() {
    if (!editing) return
    try {
      if (isNew) {
        const data = await apiCall<{ success: boolean; education: Education }>('/candidate/education', {
          method: 'POST',
          body: editing,
        })
        setEducation(prev => [data.education, ...prev])
      } else {
        const data = await apiCall<{ success: boolean; education: Education }>(`/candidate/education/${editing.id}`, {
          method: 'PUT',
          body: editing,
        })
        setEducation(prev => prev.map(e => e.id === editing.id ? data.education : e))
      }
      setEditing(null)
      showMessage('success', isNew ? 'Education added' : 'Education updated')
    } catch {
      showMessage('error', 'Failed to save education')
    }
  }

  async function handleDelete(id: number) {
    try {
      await apiCall(`/candidate/education/${id}`, { method: 'DELETE' })
      setEducation(prev => prev.filter(e => e.id !== id))
      showMessage('success', 'Education removed')
    } catch {
      showMessage('error', 'Failed to delete education')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><GraduationCap className="h-4 w-4" /> Education</h3>
        <Button size="sm" onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> Add</Button>
      </div>

      {education.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <GraduationCap className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-muted-foreground mb-4">No education added yet</p>
            <Button onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> Add Education</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {education.map(edu => (
            <Card key={edu.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold">{edu.degree}{edu.field_of_study ? ` in ${edu.field_of_study}` : ''}</h4>
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5" /> {edu.institution}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {edu.start_date ? new Date(edu.start_date).getFullYear() : 'Start'} —{' '}
                      {edu.is_current ? 'Present' : edu.end_date ? new Date(edu.end_date).getFullYear() : 'End'}
                      {edu.gpa && <> · GPA: {edu.gpa}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(edu)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(edu.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit/Add dialog */}
      {editing && (
        <Dialog open={true} onClose={() => setEditing(null)} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isNew ? 'Add Education' : 'Edit Education'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Institution *</Label>
                <Input value={editing.institution} onChange={e => setEditing({ ...editing, institution: e.target.value })} placeholder="MIT" />
              </div>
              <div>
                <Label>Degree *</Label>
                <Input value={editing.degree} onChange={e => setEditing({ ...editing, degree: e.target.value })} placeholder="Bachelor of Science" />
              </div>
              <div>
                <Label>Field of Study</Label>
                <Input value={editing.field_of_study || ''} onChange={e => setEditing({ ...editing, field_of_study: e.target.value })} placeholder="Computer Science" />
              </div>
              <div>
                <Label>GPA</Label>
                <Input value={editing.gpa || ''} onChange={e => setEditing({ ...editing, gpa: e.target.value })} placeholder="3.8" />
              </div>
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={editing.start_date?.split('T')[0] || ''} onChange={e => setEditing({ ...editing, start_date: e.target.value })} />
              </div>
              <div>
                <Label>End Date</Label>
                <Input type="date" value={editing.end_date?.split('T')[0] || ''} onChange={e => setEditing({ ...editing, end_date: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={!editing.institution || !editing.degree} className="gap-1">
                <Save className="h-4 w-4" /> {isNew ? 'Add' : 'Save'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}

// ============= Skills Tab =============

function SkillsTab({ skills, setSkills, showMessage }: {
  skills: Skill[]
  setSkills: React.Dispatch<React.SetStateAction<Skill[]>>
  showMessage: (type: 'success' | 'error', text: string) => void
}) {
  const [newSkill, setNewSkill] = useState('')
  const [newCategory, setNewCategory] = useState('technical')
  const [newLevel, setNewLevel] = useState(3)
  const [adding, setAdding] = useState(false)

  async function addSkill() {
    if (!newSkill.trim()) return
    setAdding(true)
    try {
      const data = await apiCall<{ success: boolean; skill: Skill }>('/candidate/skills', {
        method: 'POST',
        body: { skill_name: newSkill.trim(), category: newCategory, level: newLevel },
      })
      setSkills(prev => [...prev, data.skill])
      setNewSkill('')
      setNewLevel(3)
      showMessage('success', 'Skill added')
    } catch {
      showMessage('error', 'Failed to add skill')
    } finally {
      setAdding(false)
    }
  }

  async function updateLevel(skill: Skill, level: number) {
    try {
      await apiCall(`/candidate/skills/${skill.id}`, {
        method: 'PUT',
        body: { level },
      })
      setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, level } : s))
    } catch {
      showMessage('error', 'Failed to update skill')
    }
  }

  async function removeSkill(id: number) {
    try {
      await apiCall(`/candidate/skills/${id}`, { method: 'DELETE' })
      setSkills(prev => prev.filter(s => s.id !== id))
      showMessage('success', 'Skill removed')
    } catch {
      showMessage('error', 'Failed to delete skill')
    }
  }

  const levelLabels: Record<number, string> = { 1: 'Beginner', 2: 'Elementary', 3: 'Intermediate', 4: 'Advanced', 5: 'Expert' }

  // Group skills by category
  const grouped = skills.reduce((acc, s) => {
    const cat = s.category || 'other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(s)
    return acc
  }, {} as Record<string, Skill[]>)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><Wrench className="h-4 w-4" /> Skills ({skills.length})</h3>
      </div>

      {/* Add skill form */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium mb-3">Add a Skill</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label>Skill Name</Label>
              <Input
                value={newSkill}
                onChange={e => setNewSkill(e.target.value)}
                placeholder="e.g. React, Python, Project Management"
                onKeyDown={e => e.key === 'Enter' && addSkill()}
              />
            </div>
            <div className="w-36">
              <Label>Category</Label>
              <select
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="technical">Technical</option>
                <option value="soft">Soft Skills</option>
                <option value="language">Language</option>
                <option value="tool">Tools</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="w-36">
              <Label>Level ({levelLabels[newLevel]})</Label>
              <Input type="range" min={1} max={5} value={newLevel} onChange={e => setNewLevel(parseInt(e.target.value))} />
            </div>
            <Button onClick={addSkill} disabled={!newSkill.trim() || adding} className="gap-1">
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {skills.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Wrench className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-muted-foreground">No skills added yet. Add your skills above.</p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([category, categorySkills]) => (
          <div key={category}>
            <h4 className="text-sm font-medium text-muted-foreground mb-2 capitalize">{category} Skills</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {categorySkills.map(skill => (
                <Card key={skill.id}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{skill.skill_name}</span>
                        {skill.is_verified && (
                          <Badge variant="success" className="gap-0.5 text-[10px]">
                            <Award className="h-2.5 w-2.5" /> Verified
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        {[1, 2, 3, 4, 5].map(level => (
                          <button
                            key={level}
                            onClick={() => updateLevel(skill, level)}
                            className="focus:outline-none"
                          >
                            <Star
                              className={`h-3.5 w-3.5 transition-colors ${
                                level <= skill.level ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'
                              }`}
                            />
                          </button>
                        ))}
                        <span className="text-[10px] text-muted-foreground ml-1">{levelLabels[skill.level]}</span>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => removeSkill(skill.id)} className="shrink-0 text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// ============= Resume Tab =============

function ResumeTab({ profile, setProfile, showMessage }: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
  showMessage: (type: 'success' | 'error', text: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('resume', file)
      const data = await apiCall<{ success: boolean; resume_url: string; parsed_data?: Record<string, unknown> }>('/candidate/resume/upload', {
        method: 'POST',
        body: formData,
        isFormData: true,
      })
      setProfile(p => ({ ...p, resume_url: data.resume_url }))
      showMessage('success', data.parsed_data ? 'Resume uploaded & parsed!' : 'Resume uploaded')
    } catch {
      showMessage('error', 'Failed to upload resume')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><FileText className="h-4 w-4" /> Resume</h3>

      <Card>
        <CardContent className="p-6">
          {profile.resume_url ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border p-4 bg-muted/50">
                <FileText className="h-8 w-8 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">Current Resume</p>
                  <p className="text-sm text-muted-foreground truncate">{profile.resume_url}</p>
                </div>
                <a href={profile.resume_url} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm">View</Button>
                </a>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => fileRef.current?.click()} variant="outline" className="gap-1" disabled={uploading}>
                  {uploading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Replace Resume
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
              <h4 className="font-semibold mb-1">Upload Your Resume</h4>
              <p className="text-sm text-muted-foreground mb-4">
                Support for PDF, DOC, DOCX files (max 10MB). We'll try to parse it automatically.
              </p>
              <Button onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-2">
                {uploading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Choose File
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={handleUpload} />
    </div>
  )
}
