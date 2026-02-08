import { useEffect, useState, useRef } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  CheckCircle, Circle, ArrowRight, ArrowLeft, Shield, FileText,
  User, Phone, Building2, CreditCard, PenTool, Loader2, Lock,
  ClipboardCheck, Sparkles, AlertCircle, PartyPopper,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────
interface WizardData {
  id: number
  candidate_id: number
  checklist_id: number
  current_step: number
  wizard_status: string
  steps_completed: string[]
  legal_first_name: string | null
  legal_middle_name: string | null
  legal_last_name: string | null
  date_of_birth: string | null
  ssn_encrypted: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  phone: string | null
  emergency_contact_name: string | null
  emergency_contact_relationship: string | null
  emergency_contact_phone: string | null
  emergency_contact_email: string | null
  bank_name: string | null
  routing_number_encrypted: string | null
  account_number_encrypted: string | null
  account_type: string | null
  w4_filing_status: string | null
}

interface OnboardingDoc {
  id: number
  document_type: string
  status: string
  signed_at: string | null
  signer_ip: string | null
  created_at: string
}

interface ChecklistData {
  id: number
  offer_id: number
  title: string
  status: string
  items: any[]
  completed_items: number[]
  due_date: string | null
  company_name: string
  offer_title: string
  job_title: string
  salary: string
  start_date: string
}

interface ProgressResponse {
  has_onboarding: boolean
  checklist?: ChecklistData
  wizard?: WizardData
  documents?: OnboardingDoc[]
}

// ─── Steps config ────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'Personal Info', icon: User, description: 'Legal name, SSN, address' },
  { id: 2, label: 'Emergency Contact', icon: Phone, description: 'Emergency contact details' },
  { id: 3, label: 'Banking & Tax', icon: CreditCard, description: 'Direct deposit & W-4' },
  { id: 4, label: 'Review & Sign', icon: PenTool, description: 'Review documents & e-sign' },
]

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]

// ─── Component ───────────────────────────────────────────────────────
export function CandidateOnboardingPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<ProgressResponse | null>(null)
  const [currentStep, setCurrentStep] = useState(1)
  const [error, setError] = useState('')
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({})

  // Step 1 form
  const [firstName, setFirstName] = useState('')
  const [middleName, setMiddleName] = useState('')
  const [lastName, setLastName] = useState('')
  const [dob, setDob] = useState('')
  const [ssn, setSsn] = useState('')
  const [address1, setAddress1] = useState('')
  const [address2, setAddress2] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [phone, setPhone] = useState('')

  // Step 2 form
  const [ecName, setEcName] = useState('')
  const [ecRelationship, setEcRelationship] = useState('')
  const [ecPhone, setEcPhone] = useState('')
  const [ecEmail, setEcEmail] = useState('')

  // Step 3 form
  const [bankName, setBankName] = useState('')
  const [routingNumber, setRoutingNumber] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountType, setAccountType] = useState('checking')
  const [filingStatus, setFilingStatus] = useState('single')

  // Step 4
  const [documents, setDocuments] = useState<OnboardingDoc[]>([])
  const [generatingDocs, setGeneratingDocs] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signatureText, setSignatureText] = useState('')

  // Canvas ref for signature
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)

  useEffect(() => {
    loadProgress()
  }, [])

  async function loadProgress() {
    try {
      setLoading(true)
      const data = await apiCall<ProgressResponse>('/onboarding/wizard/progress')
      setProgress(data)

      if (data.has_onboarding && data.wizard) {
        const w = data.wizard
        // Restore form data
        setFirstName(w.legal_first_name || '')
        setMiddleName(w.legal_middle_name || '')
        setLastName(w.legal_last_name || '')
        setDob(w.date_of_birth ? w.date_of_birth.split('T')[0] : '')
        setAddress1(w.address_line1 || '')
        setAddress2(w.address_line2 || '')
        setCity(w.city || '')
        setState(w.state || '')
        setZip(w.zip_code || '')
        setPhone(w.phone || '')
        setEcName(w.emergency_contact_name || '')
        setEcRelationship(w.emergency_contact_relationship || '')
        setEcPhone(w.emergency_contact_phone || '')
        setEcEmail(w.emergency_contact_email || '')
        setBankName(w.bank_name || '')
        setAccountType(w.account_type || 'checking')
        setFilingStatus(w.w4_filing_status || 'single')
        // SSN/routing/account are encrypted — don't prefill

        if (w.wizard_status === 'completed') {
          setCurrentStep(5)
        } else {
          setCurrentStep(Math.max(w.current_step || 1, 1))
        }
      }
      if (data.documents) {
        setDocuments(data.documents)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function validateStep(step: number): boolean {
    const errors: Record<string, string> = {}

    if (step === 1) {
      if (!firstName.trim()) errors.firstName = 'Required'
      if (!lastName.trim()) errors.lastName = 'Required'
      if (!dob) errors.dob = 'Required'
      if (!ssn.trim() && !progress?.wizard?.ssn_encrypted) errors.ssn = 'Required'
      if (ssn && !/^\d{3}-?\d{2}-?\d{4}$/.test(ssn.replace(/\s/g, ''))) errors.ssn = 'Invalid SSN format (XXX-XX-XXXX)'
      if (!address1.trim()) errors.address1 = 'Required'
      if (!city.trim()) errors.city = 'Required'
      if (!state) errors.state = 'Required'
      if (!zip.trim()) errors.zip = 'Required'
      if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) errors.zip = 'Invalid ZIP'
      if (!phone.trim()) errors.phone = 'Required'
    }

    if (step === 2) {
      if (!ecName.trim()) errors.ecName = 'Required'
      if (!ecRelationship.trim()) errors.ecRelationship = 'Required'
      if (!ecPhone.trim()) errors.ecPhone = 'Required'
    }

    if (step === 3) {
      if (!bankName.trim()) errors.bankName = 'Required'
      if (!routingNumber.trim() && !progress?.wizard?.routing_number_encrypted) errors.routingNumber = 'Required'
      if (routingNumber && !/^\d{9}$/.test(routingNumber)) errors.routingNumber = 'Must be 9 digits'
      if (!accountNumber.trim() && !progress?.wizard?.account_number_encrypted) errors.accountNumber = 'Required'
    }

    setStepErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function saveStep(step: number) {
    if (!validateStep(step)) return false
    if (!progress?.checklist) return false

    setSaving(true)
    setError('')
    try {
      let data: any = {}

      if (step === 1) {
        data = {
          legal_first_name: firstName.trim(),
          legal_middle_name: middleName.trim() || null,
          legal_last_name: lastName.trim(),
          date_of_birth: dob,
          ssn: ssn.replace(/[^0-9]/g, '') || undefined,
          address_line1: address1.trim(),
          address_line2: address2.trim() || null,
          city: city.trim(),
          state,
          zip_code: zip.trim(),
          phone: phone.trim(),
        }
      } else if (step === 2) {
        data = {
          emergency_contact_name: ecName.trim(),
          emergency_contact_relationship: ecRelationship.trim(),
          emergency_contact_phone: ecPhone.trim(),
          emergency_contact_email: ecEmail.trim() || null,
        }
      } else if (step === 3) {
        data = {
          bank_name: bankName.trim(),
          routing_number: routingNumber || undefined,
          account_number: accountNumber || undefined,
          account_type: accountType,
          w4_filing_status: filingStatus,
        }
      }

      await apiCall('/onboarding/wizard/save-step', {
        method: 'POST',
        body: { checklist_id: progress.checklist.id, step, data },
      })

      return true
    } catch (err: any) {
      setError(err.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleNext() {
    if (currentStep <= 3) {
      const success = await saveStep(currentStep)
      if (success) {
        if (currentStep === 3) {
          // After step 3, generate documents automatically
          await generateDocuments()
        }
        setCurrentStep(currentStep + 1)
      }
    }
  }

  async function handleBack() {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
      setStepErrors({})
    }
  }

  async function generateDocuments() {
    if (!progress?.checklist) return
    setGeneratingDocs(true)
    try {
      const res = await apiCall<{ documents: OnboardingDoc[] }>('/onboarding/wizard/generate-documents', {
        method: 'POST',
        body: { checklist_id: progress.checklist.id },
      })
      setDocuments(res.documents)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setGeneratingDocs(false)
    }
  }

  async function signAllDocuments() {
    if (!progress?.checklist) return
    if (!signatureText.trim() && !hasSignature) {
      setStepErrors({ signature: 'Please type your name or draw your signature' })
      return
    }

    setSigning(true)
    setError('')
    try {
      const sigData = hasSignature && canvasRef.current
        ? canvasRef.current.toDataURL()
        : `text:${signatureText}`

      await apiCall('/onboarding/wizard/sign-all', {
        method: 'POST',
        body: {
          checklist_id: progress.checklist.id,
          signature_data: sigData,
        },
      })
      setCurrentStep(5)
      await loadProgress()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSigning(false)
    }
  }

  // Canvas drawing helpers
  function startDrawing(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.beginPath()
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top)
    setIsDrawing(true)
  }

  function draw(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#1e293b'
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top)
    ctx.stroke()
    setHasSignature(true)
  }

  function stopDrawing() {
    setIsDrawing(false)
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
  }

  // ─── Loading state ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading your onboarding...</p>
      </div>
    )
  }

  // ─── No onboarding available ───────────────────────────────────────
  if (!progress?.has_onboarding) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="flex justify-center mb-6">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
          </div>
        </div>
        <h1 className="text-2xl font-bold mb-2">No Onboarding Available</h1>
        <p className="text-muted-foreground">
          Onboarding begins after you accept an offer. Check your <strong>Offers</strong> page for pending offers.
        </p>
      </div>
    )
  }

  const checklist = progress.checklist!
  const wizard = progress.wizard

  // ─── Completed state ───────────────────────────────────────────────
  if (currentStep === 5 || wizard?.wizard_status === 'completed') {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <div className="h-20 w-20 rounded-full bg-green-100 flex items-center justify-center">
              <PartyPopper className="h-10 w-10 text-green-600" />
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-2">Onboarding Complete!</h1>
          <p className="text-muted-foreground text-lg">
            All documents are signed and submitted. Your HR team has been notified.
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Signed Documents
            </h2>
            <div className="space-y-3">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <span className="font-medium">{doc.document_type}</span>
                  </div>
                  <Badge variant="success">Signed</Badge>
                </div>
              ))}
            </div>

            <div className="mt-6 p-4 rounded-lg bg-blue-50 border border-blue-200">
              <div className="flex gap-3">
                <Sparkles className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-blue-900">What happens next?</p>
                  <p className="text-sm text-blue-700 mt-1">
                    Your HR team will review your documents and finalize your onboarding.
                    You'll receive confirmation before your start date
                    {checklist.start_date && (
                      <> on <strong>{new Date(checklist.start_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong></>
                    )}.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─── Active wizard ─────────────────────────────────────────────────
  const completedSteps = wizard?.steps_completed || []
  const progressPct = Math.round(((currentStep - 1) / STEPS.length) * 100)

  return (
    <div className="max-w-3xl mx-auto pb-12">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <Shield className="h-4 w-4" />
          <span>Encrypted & Secure</span>
        </div>
        <h1 className="text-2xl font-bold">
          Welcome aboard{checklist.company_name ? `, ${checklist.company_name}` : ''}!
        </h1>
        <p className="text-muted-foreground mt-1">
          Complete your onboarding to get started as <strong>{checklist.job_title || checklist.offer_title}</strong>
          {checklist.start_date && (
            <> — starting {new Date(checklist.start_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</>
          )}
        </p>
      </div>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex justify-between text-sm mb-2">
          <span className="font-medium">Progress</span>
          <span className="text-muted-foreground">{progressPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
        {STEPS.map((step, i) => {
          const isComplete = completedSteps.includes(String(step.id)) || currentStep > step.id
          const isCurrent = currentStep === step.id
          const Icon = step.icon

          return (
            <div key={step.id} className="flex items-center gap-2">
              {i > 0 && (
                <div className={`h-px w-4 sm:w-8 ${isComplete ? 'bg-primary' : 'bg-border'}`} />
              )}
              <button
                onClick={() => {
                  if (isComplete || isCurrent) setCurrentStep(step.id)
                }}
                disabled={!isComplete && !isCurrent}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                  isCurrent
                    ? 'bg-primary text-primary-foreground'
                    : isComplete
                    ? 'bg-primary/10 text-primary hover:bg-primary/20'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {isComplete ? (
                  <CheckCircle className="h-4 w-4" />
                ) : isCurrent ? (
                  <Icon className="h-4 w-4" />
                ) : (
                  <Circle className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{step.label}</span>
                <span className="sm:hidden">{step.id}</span>
              </button>
            </div>
          )
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Step content */}
      <Card>
        <CardContent className="p-6 sm:p-8">
          {/* Step 1: Personal Info */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  Personal Information
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  This information is used to generate your I-9 employment eligibility form.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FieldGroup label="Legal First Name *" error={stepErrors.firstName}>
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="John" />
                </FieldGroup>
                <FieldGroup label="Middle Name">
                  <Input value={middleName} onChange={(e) => setMiddleName(e.target.value)} placeholder="Michael" />
                </FieldGroup>
                <FieldGroup label="Legal Last Name *" error={stepErrors.lastName}>
                  <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" />
                </FieldGroup>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FieldGroup label="Date of Birth *" error={stepErrors.dob}>
                  <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
                </FieldGroup>
                <FieldGroup label="Social Security Number *" error={stepErrors.ssn}>
                  <div className="relative">
                    <Input
                      type="password"
                      value={ssn}
                      onChange={(e) => setSsn(e.target.value)}
                      placeholder={progress?.wizard?.ssn_encrypted ? '••••••••• (already saved)' : 'XXX-XX-XXXX'}
                    />
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                </FieldGroup>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FieldGroup label="Phone *" error={stepErrors.phone}>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
                </FieldGroup>
              </div>

              <div className="space-y-4">
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Address</h3>
                <FieldGroup label="Street Address *" error={stepErrors.address1}>
                  <Input value={address1} onChange={(e) => setAddress1(e.target.value)} placeholder="123 Main St" />
                </FieldGroup>
                <FieldGroup label="Apartment, Suite, etc.">
                  <Input value={address2} onChange={(e) => setAddress2(e.target.value)} placeholder="Apt 4B" />
                </FieldGroup>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <FieldGroup label="City *" error={stepErrors.city}>
                    <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="New York" />
                  </FieldGroup>
                  <FieldGroup label="State *" error={stepErrors.state}>
                    <Select value={state} onChange={(e) => setState(e.target.value)}>
                      <option value="">Select</option>
                      {US_STATES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </Select>
                  </FieldGroup>
                  <FieldGroup label="ZIP *" error={stepErrors.zip}>
                    <Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="10001" />
                  </FieldGroup>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Emergency Contact */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Phone className="h-5 w-5 text-primary" />
                  Emergency Contact
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Provide an emergency contact who can be reached if needed.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FieldGroup label="Contact Name *" error={stepErrors.ecName}>
                  <Input value={ecName} onChange={(e) => setEcName(e.target.value)} placeholder="Jane Doe" />
                </FieldGroup>
                <FieldGroup label="Relationship *" error={stepErrors.ecRelationship}>
                  <Select value={ecRelationship} onChange={(e) => setEcRelationship(e.target.value)}>
                    <option value="">Select relationship</option>
                    {['Spouse', 'Partner', 'Parent', 'Sibling', 'Child', 'Friend', 'Other'].map((r) => (
                      <option key={r} value={r.toLowerCase()}>{r}</option>
                    ))}
                  </Select>
                </FieldGroup>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FieldGroup label="Phone Number *" error={stepErrors.ecPhone}>
                  <Input value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} placeholder="(555) 123-4567" />
                </FieldGroup>
                <FieldGroup label="Email (optional)">
                  <Input type="email" value={ecEmail} onChange={(e) => setEcEmail(e.target.value)} placeholder="jane@example.com" />
                </FieldGroup>
              </div>
            </div>
          )}

          {/* Step 3: Banking & Tax */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  Direct Deposit & Tax Withholding
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Set up your direct deposit and W-4 tax withholding preferences.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex gap-3">
                <Lock className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-800">
                  Your banking information is encrypted end-to-end. Only authorized payroll personnel can access it.
                </p>
              </div>

              <div>
                <h3 className="font-medium mb-3">Bank Details</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FieldGroup label="Bank Name *" error={stepErrors.bankName}>
                    <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Chase, Bank of America, etc." />
                  </FieldGroup>
                  <FieldGroup label="Account Type">
                    <Select value={accountType} onChange={(e) => setAccountType(e.target.value)}>
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                    </Select>
                  </FieldGroup>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                  <FieldGroup label="Routing Number *" error={stepErrors.routingNumber}>
                    <div className="relative">
                      <Input
                        type="password"
                        value={routingNumber}
                        onChange={(e) => setRoutingNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
                        placeholder={progress?.wizard?.routing_number_encrypted ? '••••••••• (saved)' : '9 digits'}
                      />
                      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    </div>
                  </FieldGroup>
                  <FieldGroup label="Account Number *" error={stepErrors.accountNumber}>
                    <div className="relative">
                      <Input
                        type="password"
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                        placeholder={progress?.wizard?.account_number_encrypted ? '••••••••• (saved)' : 'Account number'}
                      />
                      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    </div>
                  </FieldGroup>
                </div>
              </div>

              <div>
                <h3 className="font-medium mb-3">W-4 Tax Withholding</h3>
                <FieldGroup label="Filing Status *">
                  <Select value={filingStatus} onChange={(e) => setFilingStatus(e.target.value)}>
                    <option value="single">Single or Married Filing Separately</option>
                    <option value="married">Married Filing Jointly</option>
                    <option value="head_of_household">Head of Household</option>
                  </Select>
                </FieldGroup>
              </div>
            </div>
          )}

          {/* Step 4: Review & Sign */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <PenTool className="h-5 w-5 text-primary" />
                  Review & E-Sign Documents
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Your documents have been generated from the information you provided. Review and sign below.
                </p>
              </div>

              {generatingDocs ? (
                <div className="flex flex-col items-center py-8 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-muted-foreground">Generating your documents with AI...</p>
                </div>
              ) : documents.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">Documents haven't been generated yet.</p>
                  <Button onClick={generateDocuments} disabled={generatingDocs}>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Documents
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between p-4 rounded-lg border bg-card"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-primary" />
                          <div>
                            <p className="font-medium">{doc.document_type}</p>
                            <p className="text-xs text-muted-foreground">
                              Generated {new Date(doc.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        {doc.signed_at ? (
                          <Badge variant="success">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Signed
                          </Badge>
                        ) : (
                          <Badge variant="warning">Pending</Badge>
                        )}
                      </div>
                    ))}
                  </div>

                  {documents.some(d => !d.signed_at) && (
                    <div className="space-y-4 border-t pt-6">
                      <h3 className="font-medium">Electronic Signature</h3>
                      <p className="text-sm text-muted-foreground">
                        By signing below, you certify that all information provided is accurate and complete.
                        Your signature, IP address, and timestamp will be recorded for compliance.
                      </p>

                      {/* Typed signature */}
                      <FieldGroup label="Type your full legal name" error={stepErrors.signature}>
                        <Input
                          value={signatureText}
                          onChange={(e) => setSignatureText(e.target.value)}
                          placeholder={`${firstName} ${lastName}`}
                          className="font-serif text-lg italic"
                        />
                      </FieldGroup>

                      <div className="text-center text-xs text-muted-foreground">— or draw your signature —</div>

                      {/* Canvas signature */}
                      <div className="border rounded-lg p-2 bg-white">
                        <canvas
                          ref={canvasRef}
                          width={500}
                          height={120}
                          className="w-full cursor-crosshair border border-dashed rounded"
                          onMouseDown={startDrawing}
                          onMouseMove={draw}
                          onMouseUp={stopDrawing}
                          onMouseLeave={stopDrawing}
                        />
                        <div className="flex justify-end mt-1">
                          <Button variant="ghost" size="sm" onClick={clearCanvas}>
                            Clear
                          </Button>
                        </div>
                      </div>

                      <Button
                        onClick={signAllDocuments}
                        disabled={signing}
                        className="w-full"
                        size="lg"
                      >
                        {signing ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Signing...
                          </>
                        ) : (
                          <>
                            <PenTool className="h-4 w-4 mr-2" />
                            Sign All Documents ({documents.filter(d => !d.signed_at).length})
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Navigation buttons */}
          {currentStep <= 3 && (
            <div className="flex justify-between mt-8 pt-6 border-t">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={currentStep === 1 || saving}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button onClick={handleNext} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    {currentStep === 3 ? 'Generate Documents' : 'Continue'}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security notice */}
      <p className="text-center text-xs text-muted-foreground mt-6 flex items-center justify-center gap-1">
        <Shield className="h-3 w-3" />
        All personal data is encrypted at rest. Your information is only shared with authorized HR personnel.
      </p>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────
function FieldGroup({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
