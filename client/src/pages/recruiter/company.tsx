import { useEffect, useState } from 'react'
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
  Building2, Users, Globe, MapPin, Calendar, Shield,
  Save, Plus, Pencil, Trash2, Mail, CheckCircle, AlertCircle,
  Award, Briefcase, Heart, Linkedin, Star, Upload, X,
  UserPlus, Crown,
} from 'lucide-react'

// ============= Types =============

interface Company {
  id?: number
  name?: string
  slug?: string
  description?: string
  industry?: string
  company_size?: string
  website?: string
  linkedin_url?: string
  headquarters?: string
  founded_year?: number
  logo_url?: string
  email_domain?: string
  is_verified?: boolean
  culture_description?: string
  core_values?: string[]
  benefits?: string[]
  office_locations?: string[]
  trust_score?: number
  score_tier?: string
}

interface TeamMember {
  id: number
  name: string
  email: string
  role: string
  created_at: string
}

// ============= Main Component =============

export function RecruiterCompanyPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState('overview')
  const [company, setCompany] = useState<Company>({})
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(null), 3000)
      return () => clearTimeout(t)
    }
  }, [message])

  async function loadData() {
    try {
      const [companyData, teamData] = await Promise.all([
        apiCall<{ company: Company }>('/company/profile'),
        apiCall<{ members: TeamMember[] }>('/company/team/members').catch(() => ({ members: [] })),
      ])
      setCompany(companyData.company || {})
      setMembers(teamData.members || [])
    } catch {
      // Company might not exist yet
    } finally {
      setLoading(false)
    }
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
  }

  // Profile completeness
  const completenessFields = [
    company.name,
    company.description,
    company.industry,
    company.company_size,
    company.website,
    company.headquarters,
    company.logo_url,
    company.culture_description,
    company.linkedin_url,
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
      {/* Toast */}
      {message && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
          message.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-destructive text-white'
        }`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Company Profile</h1>
          <p className="text-muted-foreground">Manage your company's brand and team</p>
        </div>
        <div className="flex items-center gap-3">
          <CompanyCompleteness value={completeness} />
          {company.trust_score && (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
              <Shield className="h-4 w-4 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">TrustScore</p>
                <p className="text-sm font-bold">{company.trust_score}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Company header card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="h-20 w-20 rounded-xl bg-muted flex items-center justify-center overflow-hidden border-2 border-border shrink-0">
              {company.logo_url ? (
                <img src={company.logo_url} alt="Logo" className="h-full w-full object-cover" />
              ) : (
                <Building2 className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold truncate">{company.name || 'Company Name'}</h2>
                {company.is_verified && (
                  <Badge variant="success" className="gap-0.5">
                    <CheckCircle className="h-3 w-3" /> Verified
                  </Badge>
                )}
              </div>
              {company.description && (
                <p className="text-muted-foreground text-sm mt-1 line-clamp-2">{company.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
                {company.industry && (
                  <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" /> {company.industry}</span>
                )}
                {company.headquarters && (
                  <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {company.headquarters}</span>
                )}
                {company.company_size && (
                  <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {company.company_size} employees</span>
                )}
                {company.founded_year && (
                  <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Est. {company.founded_year}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {company.website && (
                  <a href={company.website} target="_blank" rel="noopener noreferrer">
                    <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-muted">
                      <Globe className="h-3 w-3" /> Website
                    </Badge>
                  </a>
                )}
                {company.linkedin_url && (
                  <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer">
                    <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-muted">
                      <Linkedin className="h-3 w-3" /> LinkedIn
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
          <TabsTrigger value="overview" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Overview</TabsTrigger>
          <TabsTrigger value="branding" className="gap-1.5"><Heart className="h-3.5 w-3.5" /> Branding</TabsTrigger>
          <TabsTrigger value="team" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Team ({members.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <CompanyOverviewTab
            company={company}
            setCompany={setCompany}
            saving={saving}
            setSaving={setSaving}
            showMessage={showMessage}
          />
        </TabsContent>

        <TabsContent value="branding">
          <CompanyBrandingTab
            company={company}
            setCompany={setCompany}
            saving={saving}
            setSaving={setSaving}
            showMessage={showMessage}
          />
        </TabsContent>

        <TabsContent value="team">
          <TeamTab
            members={members}
            setMembers={setMembers}
            showMessage={showMessage}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============= Completeness =============

function CompanyCompleteness({ value }: { value: number }) {
  const color = value >= 80 ? 'text-emerald-600' : value >= 50 ? 'text-amber-500' : 'text-red-500'
  const bg = value >= 80 ? 'bg-emerald-600' : value >= 50 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className={`text-sm font-bold ${color}`}>{value}%</p>
        <p className="text-[10px] text-muted-foreground">Profile</p>
      </div>
      <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${bg}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

// ============= Company Overview Tab =============

function CompanyOverviewTab({ company, setCompany, saving, setSaving, showMessage }: {
  company: Company
  setCompany: React.Dispatch<React.SetStateAction<Company>>
  saving: boolean
  setSaving: React.Dispatch<React.SetStateAction<boolean>>
  showMessage: (type: 'success' | 'error', text: string) => void
}) {
  const [form, setForm] = useState({ ...company })

  useEffect(() => {
    setForm({ ...company })
  }, [company])

  function update(key: string, value: string | number) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const data = await apiCall<{ success: boolean; company: Company }>('/company/profile', {
        method: 'PUT',
        body: form,
      })
      setCompany(data.company)
      showMessage('success', 'Company profile saved')
    } catch {
      showMessage('error', 'Failed to save company profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-6">
        <h3 className="font-semibold flex items-center gap-2"><Building2 className="h-4 w-4" /> Company Information</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Company Name</Label>
            <Input value={form.name || ''} onChange={e => update('name', e.target.value)} placeholder="Acme Corp" />
          </div>
          <div>
            <Label>Industry</Label>
            <select
              value={form.industry || ''}
              onChange={e => update('industry', e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Select Industry</option>
              <option value="Technology">Technology</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Finance">Finance</option>
              <option value="Education">Education</option>
              <option value="Retail">Retail</option>
              <option value="Manufacturing">Manufacturing</option>
              <option value="Media">Media</option>
              <option value="Consulting">Consulting</option>
              <option value="Government">Government</option>
              <option value="Non-Profit">Non-Profit</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <Label>Company Size</Label>
            <select
              value={form.company_size || ''}
              onChange={e => update('company_size', e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Select Size</option>
              <option value="1-10">1-10</option>
              <option value="11-50">11-50</option>
              <option value="51-200">51-200</option>
              <option value="201-500">201-500</option>
              <option value="501-1000">501-1,000</option>
              <option value="1001-5000">1,001-5,000</option>
              <option value="5001+">5,001+</option>
            </select>
          </div>
          <div>
            <Label>Founded Year</Label>
            <Input
              type="number"
              value={form.founded_year ?? ''}
              onChange={e => update('founded_year', parseInt(e.target.value) || 0)}
              placeholder="2020"
            />
          </div>
          <div>
            <Label>Headquarters</Label>
            <Input value={form.headquarters || ''} onChange={e => update('headquarters', e.target.value)} placeholder="San Francisco, CA" />
          </div>
          <div>
            <Label>Website</Label>
            <Input value={form.website || ''} onChange={e => update('website', e.target.value)} placeholder="https://acme.com" />
          </div>
          <div>
            <Label className="flex items-center gap-1"><Linkedin className="h-3 w-3" /> LinkedIn URL</Label>
            <Input value={form.linkedin_url || ''} onChange={e => update('linkedin_url', e.target.value)} placeholder="https://linkedin.com/company/..." />
          </div>
          <div>
            <Label>Logo URL</Label>
            <Input value={form.logo_url || ''} onChange={e => update('logo_url', e.target.value)} placeholder="https://..." />
          </div>
        </div>

        <div>
          <Label>Company Description</Label>
          <Textarea
            value={form.description || ''}
            onChange={e => update('description', e.target.value)}
            placeholder="Brief description of your company, mission, and what you do..."
            rows={4}
          />
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

// ============= Company Branding Tab =============

function CompanyBrandingTab({ company, setCompany, saving, setSaving, showMessage }: {
  company: Company
  setCompany: React.Dispatch<React.SetStateAction<Company>>
  saving: boolean
  setSaving: React.Dispatch<React.SetStateAction<boolean>>
  showMessage: (type: 'success' | 'error', text: string) => void
}) {
  const [culture, setCulture] = useState(company.culture_description || '')
  const [values, setValues] = useState<string[]>(
    Array.isArray(company.core_values) ? company.core_values
      : typeof company.core_values === 'string' ? JSON.parse(company.core_values || '[]')
      : []
  )
  const [benefits, setBenefits] = useState<string[]>(
    Array.isArray(company.benefits) ? company.benefits
      : typeof company.benefits === 'string' ? JSON.parse(company.benefits || '[]')
      : []
  )
  const [newValue, setNewValue] = useState('')
  const [newBenefit, setNewBenefit] = useState('')

  async function handleSave() {
    setSaving(true)
    try {
      const data = await apiCall<{ success: boolean; company: Company }>('/company/profile', {
        method: 'PUT',
        body: {
          culture_description: culture,
          core_values: JSON.stringify(values),
          benefits: JSON.stringify(benefits),
        },
      })
      setCompany(data.company)
      showMessage('success', 'Branding saved')
    } catch {
      showMessage('error', 'Failed to save branding')
    } finally {
      setSaving(false)
    }
  }

  function addValue() {
    if (newValue.trim()) {
      setValues([...values, newValue.trim()])
      setNewValue('')
    }
  }

  function addBenefit() {
    if (newBenefit.trim()) {
      setBenefits([...benefits, newBenefit.trim()])
      setNewBenefit('')
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6 space-y-6">
          <h3 className="font-semibold flex items-center gap-2"><Heart className="h-4 w-4" /> Culture & Values</h3>

          <div>
            <Label>Culture Description</Label>
            <Textarea
              value={culture}
              onChange={e => setCulture(e.target.value)}
              placeholder="Describe your company culture, work environment, and what makes it special..."
              rows={4}
            />
          </div>

          <div>
            <Label className="mb-2 block">Core Values</Label>
            <div className="flex flex-wrap gap-2 mb-3">
              {values.map((v, i) => (
                <Badge key={i} variant="secondary" className="gap-1 pr-1">
                  <Star className="h-3 w-3 text-amber-500" />
                  {v}
                  <button onClick={() => setValues(values.filter((_, idx) => idx !== i))} className="ml-1 hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
                placeholder="e.g. Innovation, Transparency..."
                onKeyDown={e => e.key === 'Enter' && addValue()}
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={addValue} className="gap-1">
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Benefits & Perks</Label>
            <div className="flex flex-wrap gap-2 mb-3">
              {benefits.map((b, i) => (
                <Badge key={i} variant="outline" className="gap-1 pr-1">
                  <Award className="h-3 w-3 text-emerald-500" />
                  {b}
                  <button onClick={() => setBenefits(benefits.filter((_, idx) => idx !== i))} className="ml-1 hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newBenefit}
                onChange={e => setNewBenefit(e.target.value)}
                placeholder="e.g. Health Insurance, 401k, Unlimited PTO..."
                onKeyDown={e => e.key === 'Enter' && addBenefit()}
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={addBenefit} className="gap-1">
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Save className="h-4 w-4" />}
              Save Branding
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============= Team Tab =============

function TeamTab({ members, setMembers, showMessage }: {
  members: TeamMember[]
  setMembers: React.Dispatch<React.SetStateAction<TeamMember[]>>
  showMessage: (type: 'success' | 'error', text: string) => void
}) {
  const { user } = useAuth()
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState('recruiter')
  const [inviting, setInviting] = useState(false)

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      const data = await apiCall<{ success: boolean; member: TeamMember; temp_password: string }>('/company/team/invite', {
        method: 'POST',
        body: { email: inviteEmail, name: inviteName, role: inviteRole },
      })
      setMembers(prev => [...prev, data.member])
      setShowInvite(false)
      setInviteEmail('')
      setInviteName('')
      showMessage('success', `${data.member.name || data.member.email} invited`)
    } catch (err: unknown) {
      showMessage('error', err instanceof Error ? err.message : 'Failed to invite')
    } finally {
      setInviting(false)
    }
  }

  const roleLabels: Record<string, string> = {
    recruiter: 'Recruiter',
    hiring_manager: 'Hiring Manager',
    employer: 'Admin',
    admin: 'Super Admin',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Team Members ({members.length})</h3>
        <Button size="sm" onClick={() => setShowInvite(true)} className="gap-1"><UserPlus className="h-4 w-4" /> Invite</Button>
      </div>

      {members.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-muted-foreground mb-4">No team members yet</p>
            <Button onClick={() => setShowInvite(true)} className="gap-1"><UserPlus className="h-4 w-4" /> Invite Team Member</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {members.map(member => (
            <Card key={member.id}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">
                      {(member.name || member.email)[0]?.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{member.name || 'Unnamed'}</p>
                      {member.id === user?.id && (
                        <Badge variant="secondary" className="gap-0.5 text-[10px]">
                          <Crown className="h-2.5 w-2.5" /> You
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {member.email}
                    </p>
                  </div>
                  <Badge variant="outline">{roleLabels[member.role] || member.role}</Badge>
                  <p className="text-xs text-muted-foreground hidden sm:block">
                    Joined {new Date(member.created_at).toLocaleDateString()}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Invite dialog */}
      {showInvite && (
        <Dialog open={true} onClose={() => !inviting && setShowInvite(false)} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" /> Invite Team Member
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Email *</Label>
              <Input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="colleague@company.com" type="email" />
            </div>
            <div>
              <Label>Name</Label>
              <Input value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="John Smith" />
            </div>
            <div>
              <Label>Role</Label>
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="recruiter">Recruiter</option>
                <option value="hiring_manager">Hiring Manager</option>
                <option value="employer">Admin</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowInvite(false)} disabled={inviting}>Cancel</Button>
              <Button onClick={handleInvite} disabled={!inviteEmail.trim() || inviting} className="gap-1">
                {inviting ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                Send Invite
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
