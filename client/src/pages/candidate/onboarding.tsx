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
  ClipboardCheck, Sparkles, AlertCircle, PartyPopper, HelpCircle,
  Globe, Receipt, Eye,
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
  i9_citizenship_status: string | null
  i9_alien_number: string | null
  i9_admission_number: string | null
  i9_passport_number: string | null
  i9_country_of_issuance: string | null
  i9_work_auth_expiry: string | null
  i9_other_last_names: string | null
  i9_email: string | null
  i9_preparer_used: boolean
  w4_multiple_jobs: boolean
  w4_spouse_works: boolean
  w4_num_dependents_under_17: number
  w4_num_other_dependents: number
  w4_other_income: number
  w4_deductions: number
  w4_extra_withholding: number
  w4_exempt: boolean
}

interface OnboardingDoc {
  id: number
  document_type: string
  status: string
  signed_at: string | null
  signer_ip: string | null
  ai_generated_html: string | null
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

interface W4Guidance {
  step1_guidance: string
  step2_guidance: string
  step3_guidance: string
  step4_guidance: string
  personalized_tip: string
  estimated_credits: string
  withholding_impact: string
}

// ─── Steps config ────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'I-9 Form', icon: Globe, description: 'Personal info & employment eligibility' },
  { id: 2, label: 'Emergency Contact', icon: Phone, description: 'Emergency contact details' },
  { id: 3, label: 'Direct Deposit', icon: Building2, description: 'Banking information' },
  { id: 4, label: 'W-4 Tax Form', icon: Receipt, description: 'Federal tax withholding' },
  { id: 5, label: 'Review & Sign', icon: PenTool, description: 'Review documents & e-sign' },
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
  const [prefillLoaded, setPrefillLoaded] = useState(false)

  // Step 1: Personal Info + I-9
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
  // I-9 Attestation (USCIS Form I-9, Edition 01/20/2025)
  const [citizenshipStatus, setCitizenshipStatus] = useState('citizen')
  const [alienNumber, setAlienNumber] = useState('')
  const [admissionNumber, setAdmissionNumber] = useState('')
  const [passportNumber, setPassportNumber] = useState('')
  const [countryOfIssuance, setCountryOfIssuance] = useState('')
  const [workAuthExpiry, setWorkAuthExpiry] = useState('')
  const [otherLastNames, setOtherLastNames] = useState('')
  const [i9Email, setI9Email] = useState('')
  const [preparerUsed, setPreparerUsed] = useState(false)

  // Step 2: Emergency Contact
  const [ecName, setEcName] = useState('')
  const [ecRelationship, setEcRelationship] = useState('')
  const [ecPhone, setEcPhone] = useState('')
  const [ecEmail, setEcEmail] = useState('')

  // Step 3: Banking
  const [bankName, setBankName] = useState('')
  const [routingNumber, setRoutingNumber] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountType, setAccountType] = useState('checking')

  // Step 4: Full W-4
  const [filingStatus, setFilingStatus] = useState('single')
  const [multipleJobs, setMultipleJobs] = useState(false)
  const [spouseWorks, setSpouseWorks] = useState(false)
  const [dependentsUnder17, setDependentsUnder17] = useState(0)
  const [otherDependents, setOtherDependents] = useState(0)
  const [otherIncome, setOtherIncome] = useState('')
  const [deductions, setDeductions] = useState('')
  const [extraWithholding, setExtraWithholding] = useState('')
  const [w4Exempt, setW4Exempt] = useState(false)
  const [w4Guidance, setW4Guidance] = useState<W4Guidance | null>(null)
  const [loadingGuidance, setLoadingGuidance] = useState(false)
  const [showGuidance, setShowGuidance] = useState(false)

  // Step 5: Review & Sign
  const [documents, setDocuments] = useState<OnboardingDoc[]>([])
  const [generatingDocs, setGeneratingDocs] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signatureText, setSignatureText] = useState('')
  const [previewDoc, setPreviewDoc] = useState<OnboardingDoc | null>(null)

  // Canvas signature
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)

  useEffect(() => { loadProgress() }, [])

  async function loadProgress() {
    try {
      setLoading(true)
      const data = await apiCall<ProgressResponse>('/onboarding/wizard/progress')
      setProgress(data)

      if (data.has_onboarding && data.wizard) {
        const w = data.wizard
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
        setCitizenshipStatus(w.i9_citizenship_status || 'citizen')
        setAlienNumber(w.i9_alien_number || '')
        setAdmissionNumber(w.i9_admission_number || '')
        setPassportNumber(w.i9_passport_number || '')
        setCountryOfIssuance(w.i9_country_of_issuance || '')
        setWorkAuthExpiry(w.i9_work_auth_expiry ? w.i9_work_auth_expiry.split('T')[0] : '')
        setOtherLastNames(w.i9_other_last_names || '')
        setI9Email(w.i9_email || '')
        setPreparerUsed(w.i9_preparer_used || false)
        setEcName(w.emergency_contact_name || '')
        setEcRelationship(w.emergency_contact_relationship || '')
        setEcPhone(w.emergency_contact_phone || '')
        setEcEmail(w.emergency_contact_email || '')
        setBankName(w.bank_name || '')
        setAccountType(w.account_type || 'checking')
        setFilingStatus(w.w4_filing_status || 'single')
        setMultipleJobs(w.w4_multiple_jobs || false)
        setSpouseWorks(w.w4_spouse_works || false)
        setDependentsUnder17(w.w4_num_dependents_under_17 || 0)
        setOtherDependents(w.w4_num_other_dependents || 0)
        setOtherIncome(w.w4_other_income ? String(w.w4_other_income) : '')
        setDeductions(w.w4_deductions ? String(w.w4_deductions) : '')
        setExtraWithholding(w.w4_extra_withholding ? String(w.w4_extra_withholding) : '')
        setW4Exempt(w.w4_exempt || false)

        if (w.wizard_status === 'completed') {
          setCurrentStep(6)
        } else {
          setCurrentStep(Math.max(w.current_step || 1, 1))
        }
      }
      if (data.documents) setDocuments(data.documents)

      // Load AI pre-fill if first visit (no data saved yet)
      if (data.has_onboarding && data.wizard && !data.wizard.legal_first_name && !prefillLoaded) {
        loadAIPrefill()
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadAIPrefill() {
    try {
      setPrefillLoaded(true)
      const res = await apiCall<{ prefill: any; ai_suggestions: any }>('/onboarding/wizard/ai-prefill')
      const p = res.prefill
      if (p.legal_first_name && !firstName) setFirstName(p.legal_first_name)
      if (p.legal_middle_name && !middleName) setMiddleName(p.legal_middle_name)
      if (p.legal_last_name && !lastName) setLastName(p.legal_last_name)
      if (p.phone && !phone) setPhone(p.phone)
      if (p.address_line1 && !address1) setAddress1(p.address_line1)
      if (p.city && !city) setCity(p.city)
      if (p.state && !state) setState(p.state)
      if (p.zip_code && !zip) setZip(p.zip_code)
    } catch {
      // Non-blocking
    }
  }

  async function loadW4Guidance() {
    setLoadingGuidance(true)
    try {
      const salary = progress?.checklist?.salary || ''
      const res = await apiCall<{ guidance: W4Guidance }>('/onboarding/wizard/w4-guidance', {
        method: 'POST',
        body: {
          filing_status: filingStatus,
          salary,
          multiple_jobs: multipleJobs,
          num_dependents: dependentsUnder17 + otherDependents,
        },
      })
      setW4Guidance(res.guidance)
      setShowGuidance(true)
    } catch {
      // Fallback handled by backend
    } finally {
      setLoadingGuidance(false)
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
      if (!citizenshipStatus) errors.citizenshipStatus = 'Required'
      if (citizenshipStatus === 'permanent_resident' && !alienNumber.trim()) errors.alienNumber = 'Required for permanent residents'
      if (citizenshipStatus === 'work_authorized' && !workAuthExpiry) errors.workAuthExpiry = 'Required for work authorization'
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

    // Step 4 (W-4) — filing status is required, rest is optional
    if (step === 4) {
      if (!filingStatus) errors.filingStatus = 'Required'
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
          i9_citizenship_status: citizenshipStatus,
          i9_alien_number: alienNumber.trim() || null,
          i9_admission_number: admissionNumber.trim() || null,
          i9_passport_number: passportNumber.trim() || null,
          i9_country_of_issuance: countryOfIssuance.trim() || null,
          i9_work_auth_expiry: workAuthExpiry || null,
          i9_other_last_names: otherLastNames.trim() || null,
          i9_email: i9Email.trim() || null,
          i9_preparer_used: preparerUsed,
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
        }
      } else if (step === 4) {
        data = {
          w4_filing_status: filingStatus,
          w4_multiple_jobs: multipleJobs,
          w4_spouse_works: spouseWorks,
          w4_num_dependents_under_17: dependentsUnder17,
          w4_num_other_dependents: otherDependents,
          w4_other_income: parseFloat(otherIncome) || 0,
          w4_deductions: parseFloat(deductions) || 0,
          w4_extra_withholding: parseFloat(extraWithholding) || 0,
          w4_exempt: w4Exempt,
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
    if (currentStep <= 4) {
      const success = await saveStep(currentStep)
      if (success) {
        if (currentStep === 4) {
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
        body: { checklist_id: progress.checklist.id, signature_data: sigData },
      })
      setCurrentStep(6)
      await loadProgress()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSigning(false)
    }
  }

  function previewDocument(doc: OnboardingDoc) {
    const token = localStorage.getItem('rekrutai_token')
    const url = `/api/onboarding/recruiter/document/${doc.id}/download`
    // Open in new tab
    window.open(url + `?token=${token}`, '_blank')
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
  function stopDrawing() { setIsDrawing(false) }
  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
  }

  // ─── Loading ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading your onboarding...</p>
      </div>
    )
  }

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

  // ─── Completed ────────────────────────────────────────────────────
  if (currentStep === 6 || wizard?.wizard_status === 'completed') {
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

  // ─── Active wizard ────────────────────────────────────────────────
  const completedSteps = wizard?.steps_completed || []
  const progressPct = Math.round(((currentStep - 1) / STEPS.length) * 100)

  // W-4 calculated values
  const childCredits = dependentsUnder17 * 2000
  const otherDepCredits = otherDependents * 500
  const totalCredits = childCredits + otherDepCredits

  return (
    <div className="max-w-3xl mx-auto pb-12">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <Shield className="h-4 w-4" />
          <span>Encrypted & Secure</span>
          <span className="mx-1">•</span>
          <Sparkles className="h-4 w-4" />
          <span>AI-Assisted</span>
        </div>
        <h1 className="text-2xl font-bold">
          Welcome aboard{checklist.company_name ? ` to ${checklist.company_name}` : ''}!
        </h1>
        <p className="text-muted-foreground mt-1">
          Complete your onboarding for <strong>{checklist.job_title || checklist.offer_title}</strong>
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
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-2">
        {STEPS.map((step, i) => {
          const isComplete = completedSteps.includes(String(step.id)) || currentStep > step.id
          const isCurrent = currentStep === step.id
          const Icon = step.icon

          return (
            <div key={step.id} className="flex items-center gap-1">
              {i > 0 && <div className={`h-px w-3 sm:w-6 ${isComplete ? 'bg-primary' : 'bg-border'}`} />}
              <button
                onClick={() => { if (isComplete || isCurrent) setCurrentStep(step.id) }}
                disabled={!isComplete && !isCurrent}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  isCurrent ? 'bg-primary text-primary-foreground' :
                  isComplete ? 'bg-primary/10 text-primary hover:bg-primary/20' :
                  'bg-muted text-muted-foreground'
                }`}
              >
                {isComplete ? <CheckCircle className="h-3.5 w-3.5" /> :
                 isCurrent ? <Icon className="h-3.5 w-3.5" /> :
                 <Circle className="h-3.5 w-3.5" />}
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

          {/* ══════════ STEP 1: I-9 Form (Personal Info + Employment Eligibility) ══════════ */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Globe className="h-5 w-5 text-primary" />
                    USCIS Form I-9 — Employment Eligibility Verification
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Section 1. Employee Information and Attestation — Edition 01/20/2025, OMB No. 1615-0047, Expires 05/31/2027
                </p>
                <div className="mt-2 p-2 rounded bg-blue-50 border border-blue-200 text-xs text-blue-800 flex gap-2">
                  <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>Fields auto-filled from your profile where possible. Verify and complete all required fields.</span>
                </div>
              </div>

              {/* Row 1: Name fields per official I-9 layout */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <FieldGroup label="Last Name (Family Name) *" error={stepErrors.lastName}>
                  <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" />
                </FieldGroup>
                <FieldGroup label="First Name (Given Name) *" error={stepErrors.firstName}>
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="John" />
                </FieldGroup>
                <FieldGroup label="Middle Initial">
                  <Input value={middleName} onChange={(e) => setMiddleName(e.target.value)} placeholder="M" maxLength={50} />
                </FieldGroup>
                <FieldGroup label="Other Last Names Used">
                  <Input value={otherLastNames} onChange={(e) => setOtherLastNames(e.target.value)} placeholder="Maiden name, etc." />
                </FieldGroup>
              </div>

              {/* Row 2: Address per official I-9 layout */}
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="sm:col-span-2">
                    <FieldGroup label="Address (Street Number and Name) *" error={stepErrors.address1}>
                      <Input value={address1} onChange={(e) => setAddress1(e.target.value)} placeholder="123 Main St" />
                    </FieldGroup>
                  </div>
                  <FieldGroup label="Apt. Number">
                    <Input value={address2} onChange={(e) => setAddress2(e.target.value)} placeholder="Apt 4B" />
                  </FieldGroup>
                  <FieldGroup label="City or Town *" error={stepErrors.city}>
                    <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="New York" />
                  </FieldGroup>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <FieldGroup label="State *" error={stepErrors.state}>
                    <Select value={state} onChange={(e) => setState(e.target.value)}>
                      <option value="">Select</option>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </FieldGroup>
                  <FieldGroup label="ZIP Code *" error={stepErrors.zip}>
                    <Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="10001" />
                  </FieldGroup>
                </div>
              </div>

              {/* Row 3: DOB, SSN, Email, Phone per official I-9 layout */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FieldGroup label="Date of Birth (mm/dd/yyyy) *" error={stepErrors.dob}>
                  <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
                </FieldGroup>
                <FieldGroup label="U.S. Social Security Number *" error={stepErrors.ssn}>
                  <div className="relative">
                    <Input type="password" value={ssn} onChange={(e) => setSsn(e.target.value)}
                      placeholder={progress?.wizard?.ssn_encrypted ? '••••••••• (saved)' : 'XXX-XX-XXXX'} />
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                </FieldGroup>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FieldGroup label="Employee's Email Address">
                  <Input type="email" value={i9Email} onChange={(e) => setI9Email(e.target.value)} placeholder="john.doe@email.com" />
                </FieldGroup>
                <FieldGroup label="Employee's Telephone Number *" error={stepErrors.phone}>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
                </FieldGroup>
              </div>

              {/* I-9 Section 1 Attestation */}
              <div className="border-t pt-6 space-y-4">
                <div>
                  <h3 className="font-semibold text-base flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    Citizenship / Immigration Status Attestation
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    I attest, under penalty of perjury, that I am (check one of the following boxes):
                  </p>
                </div>

                <FieldGroup label="" error={stepErrors.citizenshipStatus}>
                  <div className="space-y-2">
                    {[
                      { value: 'citizen', label: '1. A citizen of the United States' },
                      { value: 'noncitizen_national', label: '2. A noncitizen national of the United States' },
                      { value: 'permanent_resident', label: '3. A lawful permanent resident (Alien Registration Number/USCIS Number)' },
                      { value: 'work_authorized', label: '4. An alien authorized to work until (expiration date, if applicable)' },
                    ].map(opt => (
                      <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        citizenshipStatus === opt.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                      }`}>
                        <input type="radio" name="citizenship" value={opt.value} checked={citizenshipStatus === opt.value}
                          onChange={() => setCitizenshipStatus(opt.value)}
                          className="mt-0.5" />
                        <span className="text-sm">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </FieldGroup>

                {/* Conditional fields for lawful permanent resident */}
                {citizenshipStatus === 'permanent_resident' && (
                  <FieldGroup label="Alien Registration Number / USCIS Number *" error={stepErrors.alienNumber}>
                    <Input value={alienNumber} onChange={(e) => setAlienNumber(e.target.value)} placeholder="A-number (e.g., A012345678)" className="max-w-xs" />
                  </FieldGroup>
                )}

                {/* Conditional fields for alien authorized to work */}
                {citizenshipStatus === 'work_authorized' && (
                  <div className="space-y-4 p-4 rounded-lg bg-muted/50 border">
                    <p className="text-xs text-blue-700 bg-blue-50 p-2 rounded border border-blue-200">
                      <strong>Note:</strong> Provide only <strong>ONE</strong> of the following document numbers: Alien Registration Number/USCIS Number <em>OR</em> Form I-94 Admission Number <em>OR</em> Foreign Passport Number and Country of Issuance.
                    </p>
                    <FieldGroup label="Work Authorization Expiration Date *" error={stepErrors.workAuthExpiry}>
                      <Input type="date" value={workAuthExpiry} onChange={(e) => setWorkAuthExpiry(e.target.value)} className="max-w-xs" />
                    </FieldGroup>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FieldGroup label="Alien Registration Number / USCIS Number">
                        <Input value={alienNumber} onChange={(e) => setAlienNumber(e.target.value)} placeholder="A-number (if applicable)" />
                      </FieldGroup>
                      <FieldGroup label="Form I-94 Admission Number">
                        <Input value={admissionNumber} onChange={(e) => setAdmissionNumber(e.target.value)} placeholder="I-94 number (if applicable)" />
                      </FieldGroup>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FieldGroup label="Foreign Passport Number">
                        <Input value={passportNumber} onChange={(e) => setPassportNumber(e.target.value)} placeholder="Passport number (if applicable)" />
                      </FieldGroup>
                      {passportNumber && (
                        <FieldGroup label="Country of Issuance *">
                          <Input value={countryOfIssuance} onChange={(e) => setCountryOfIssuance(e.target.value)} placeholder="Country" />
                        </FieldGroup>
                      )}
                    </div>
                  </div>
                )}

                {/* Preparer/Translator Certification */}
                <div className="border-t pt-4">
                  <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    preparerUsed ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                  }`}>
                    <input type="checkbox" checked={preparerUsed} onChange={(e) => setPreparerUsed(e.target.checked)} className="mt-0.5" />
                    <div>
                      <span className="text-sm font-medium">A preparer and/or translator assisted me in completing Section 1</span>
                      <p className="text-xs text-muted-foreground">Check this box if someone helped you fill out this form. (Preparer and/or Translator Certification)</p>
                    </div>
                  </label>
                </div>

                {/* Perjury and false statements warning */}
                <p className="text-xs text-muted-foreground italic p-3 bg-amber-50 border border-amber-200 rounded">
                  I am aware that federal law provides for imprisonment and/or fines for false statements, or the use of false documents, in connection with the completion of this form. I attest, under penalty of perjury, that the information I have provided is true and correct.
                </p>

                {/* Anti-Discrimination Notice */}
                <div className="p-3 rounded bg-slate-50 border border-slate-200 text-xs text-slate-700">
                  <p className="font-semibold mb-1">Anti-Discrimination Notice</p>
                  <p>
                    It is illegal to discriminate against work-authorized individuals in hiring, firing, recruitment or referral for a fee, or in the employment eligibility verification (Form I-9 and E-Verify) process based on that individual's citizenship status, immigration status, or national origin. Employers <strong>cannot</strong> specify which document(s) an employee may present. For more information, contact the Immigrant and Employee Rights Section (IER), Department of Justice, Civil Rights Division: <strong>1-800-255-7688</strong> (employees) or <strong>1-800-255-8155</strong> (employers).
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ══════════ STEP 2: Emergency Contact ══════════ */}
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
                    {['Spouse', 'Partner', 'Parent', 'Sibling', 'Child', 'Friend', 'Other'].map(r => (
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

          {/* ══════════ STEP 3: Direct Deposit ══════════ */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  Direct Deposit Authorization
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Set up your bank account for direct deposit of your pay.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex gap-3">
                <Lock className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-800">
                  Your banking information is encrypted end-to-end. Only authorized payroll personnel can access it.
                </p>
              </div>

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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FieldGroup label="Routing Number *" error={stepErrors.routingNumber}>
                  <div className="relative">
                    <Input type="password" value={routingNumber}
                      onChange={(e) => setRoutingNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
                      placeholder={progress?.wizard?.routing_number_encrypted ? '••••••••• (saved)' : '9 digits'} />
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                </FieldGroup>
                <FieldGroup label="Account Number *" error={stepErrors.accountNumber}>
                  <div className="relative">
                    <Input type="password" value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                      placeholder={progress?.wizard?.account_number_encrypted ? '••••••••• (saved)' : 'Account number'} />
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                </FieldGroup>
              </div>

              <p className="text-xs text-muted-foreground">
                By providing your banking details, you authorize {checklist.company_name || 'your employer'} to deposit your net pay directly into this account.
              </p>
            </div>
          )}

          {/* ══════════ STEP 4: Full W-4 Tax Form ══════════ */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Receipt className="h-5 w-5 text-primary" />
                    IRS Form W-4 — Employee's Withholding Certificate
                  </h2>
                  <Button variant="outline" size="sm" onClick={loadW4Guidance} disabled={loadingGuidance}>
                    {loadingGuidance ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> :
                      <Sparkles className="h-4 w-4 mr-1" />}
                    AI Help
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Department of the Treasury — Internal Revenue Service — 2025 — OMB No. 1545-0074
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Complete Form W-4 so that your employer can withhold the correct federal income tax from your pay.
                  Complete Steps 2–4 <strong>ONLY</strong> if they apply to you; otherwise, skip to Step 5 (Sign).
                </p>
              </div>

              {/* AI Guidance Panel */}
              {showGuidance && w4Guidance && (
                <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-blue-900 flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      AI Tax Guidance
                    </h3>
                    <Button variant="ghost" size="sm" onClick={() => setShowGuidance(false)} className="text-blue-600 h-6 px-2">
                      Dismiss
                    </Button>
                  </div>
                  <div className="space-y-2 text-sm text-blue-800">
                    <p><strong>💡 Personalized tip:</strong> {w4Guidance.personalized_tip}</p>
                    <p><strong>Filing Status:</strong> {w4Guidance.step1_guidance}</p>
                    <p><strong>Multiple Jobs:</strong> {w4Guidance.step2_guidance}</p>
                    <p><strong>Dependents:</strong> {w4Guidance.step3_guidance}</p>
                    <p><strong>Adjustments:</strong> {w4Guidance.step4_guidance}</p>
                    <p className="text-xs italic">{w4Guidance.withholding_impact}</p>
                  </div>
                </div>
              )}

              {/* Step 1(c): Filing Status */}
              <div className="space-y-3">
                <h3 className="font-medium flex items-center gap-2">
                  Step 1(c): Filing Status
                  <span className="text-xs text-muted-foreground font-normal">(Required)</span>
                </h3>
                <FieldGroup label="" error={stepErrors.filingStatus}>
                  <div className="space-y-2">
                    {[
                      { value: 'single', label: 'Single or Married filing separately' },
                      { value: 'married', label: 'Married filing jointly or Qualifying surviving spouse' },
                      { value: 'head_of_household', label: 'Head of household', description: 'Check only if you\'re unmarried and pay more than half the costs of keeping up a home for yourself and a qualifying individual.' },
                    ].map(opt => (
                      <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        filingStatus === opt.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                      }`}>
                        <input type="radio" name="filing" value={opt.value} checked={filingStatus === opt.value}
                          onChange={() => setFilingStatus(opt.value)} className="mt-0.5" />
                        <div>
                          <span className="text-sm">{opt.label}</span>
                          {'description' in opt && opt.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </FieldGroup>
              </div>

              {/* Step 2: Multiple Jobs or Spouse Works */}
              <div className="space-y-3 border-t pt-4">
                <h3 className="font-medium flex items-center gap-2">
                  Step 2: Multiple Jobs or Spouse Works
                  <span className="text-xs text-muted-foreground font-normal">(Complete only if applies)</span>
                </h3>
                <p className="text-xs text-muted-foreground">
                  Complete this step if you (1) hold more than one job at a time, or (2) are married filing jointly and your spouse also works. The correct amount of withholding depends on income earned from all of these jobs.
                </p>

                <div className="space-y-2 text-xs text-muted-foreground p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="font-medium text-slate-700">Choose one approach:</p>
                  <p><strong>(a)</strong> For the most accurate withholding, use the IRS Tax Withholding Estimator at <a href="https://www.irs.gov/W4App" target="_blank" rel="noopener noreferrer" className="text-primary underline">www.irs.gov/W4App</a></p>
                  <p><strong>(b)</strong> Use the Multiple Jobs Worksheet on page 3 of the official W-4 form.</p>
                  <p><strong>(c)</strong> If there are only two jobs total, check the box below. Do the same on the W-4 for the other job. This option is generally more accurate if pay at the lower paying job is more than half of the pay at the higher paying job.</p>
                </div>

                <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  multipleJobs ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                }`}>
                  <input type="checkbox" checked={multipleJobs} onChange={(e) => setMultipleJobs(e.target.checked)} className="mt-0.5" />
                  <div>
                    <span className="text-sm font-medium">Step 2(c): Two jobs total</span>
                    <p className="text-xs text-muted-foreground">Check if there are only two jobs total (yours and your spouse's). Also check the box on Form W-4 for the other job.</p>
                  </div>
                </label>
              </div>

              {/* Step 3: Dependents */}
              <div className="space-y-3 border-t pt-4">
                <h3 className="font-medium flex items-center gap-2">
                  Step 3: Claim Dependents
                  <span className="text-xs text-muted-foreground font-normal">(Optional)</span>
                </h3>
                <p className="text-xs text-muted-foreground">
                  If your total income will be $200,000 or less ($400,000 if married filing jointly), complete this section.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FieldGroup label="Qualifying children under age 17">
                    <div className="flex items-center gap-3">
                      <Input type="number" min={0} max={20} value={dependentsUnder17}
                        onChange={(e) => setDependentsUnder17(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-20" />
                      <span className="text-sm text-muted-foreground">× $2,000 = <strong>${childCredits.toLocaleString()}</strong></span>
                    </div>
                  </FieldGroup>
                  <FieldGroup label="Other dependents">
                    <div className="flex items-center gap-3">
                      <Input type="number" min={0} max={20} value={otherDependents}
                        onChange={(e) => setOtherDependents(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-20" />
                      <span className="text-sm text-muted-foreground">× $500 = <strong>${otherDepCredits.toLocaleString()}</strong></span>
                    </div>
                  </FieldGroup>
                </div>

                {totalCredits > 0 && (
                  <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                    <p className="text-sm font-medium text-green-800">
                      Total dependent credits: <strong>${totalCredits.toLocaleString()}</strong>
                    </p>
                  </div>
                )}
              </div>

              {/* Step 4: Other Adjustments */}
              <div className="space-y-3 border-t pt-4">
                <h3 className="font-medium flex items-center gap-2">
                  Step 4: Other Adjustments
                  <span className="text-xs text-muted-foreground font-normal">(Optional)</span>
                </h3>
                <p className="text-xs text-muted-foreground">
                  Use this section to adjust withholding for other income, deductions, or additional amounts.
                </p>

                <div className="space-y-4">
                  <FieldGroup label="(a) Other income — not from jobs (investments, retirement, etc.)">
                    <div className="relative max-w-xs">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input value={otherIncome} onChange={(e) => setOtherIncome(e.target.value.replace(/[^0-9.]/g, ''))}
                        placeholder="0" className="pl-7" />
                    </div>
                  </FieldGroup>

                  <FieldGroup label="(b) Deductions — if you expect to claim deductions other than the standard deduction">
                    <div className="relative max-w-xs">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input value={deductions} onChange={(e) => setDeductions(e.target.value.replace(/[^0-9.]/g, ''))}
                        placeholder="0" className="pl-7" />
                    </div>
                  </FieldGroup>

                  <FieldGroup label="(c) Extra withholding — additional tax you want withheld each pay period">
                    <div className="relative max-w-xs">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input value={extraWithholding} onChange={(e) => setExtraWithholding(e.target.value.replace(/[^0-9.]/g, ''))}
                        placeholder="0" className="pl-7" />
                    </div>
                  </FieldGroup>
                </div>

                {/* Exempt */}
                <div className="border-t pt-4">
                  <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    w4Exempt ? 'border-amber-400 bg-amber-50' : 'border-border hover:bg-muted/50'
                  }`}>
                    <input type="checkbox" checked={w4Exempt} onChange={(e) => setW4Exempt(e.target.checked)} className="mt-0.5" />
                    <div>
                      <span className="text-sm font-medium">Claim exemption from withholding</span>
                      <p className="text-xs text-muted-foreground">
                        You may claim exemption only if: (1) you had no federal income tax liability last year, AND (2) you expect no liability this year.
                        If claiming exempt, do not complete Steps 2–4. You must submit a new W-4 by February 17 of next year.
                      </p>
                    </div>
                  </label>
                </div>

                {/* Privacy Act Notice */}
                <div className="p-3 rounded bg-slate-50 border border-slate-200 text-xs text-slate-600 mt-4">
                  <p className="font-semibold text-slate-700 mb-1">Privacy Act and Paperwork Reduction Act Notice</p>
                  <p>
                    The IRS asks for the information on this form to carry out the Internal Revenue laws of the United States. You are required to give this information to your employer, but you are not required to respond to any questions that are not relevant to your tax situation. The estimated average time to complete this form is 12 minutes.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ══════════ STEP 5: Review & Sign ══════════ */}
          {currentStep === 5 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <PenTool className="h-5 w-5 text-primary" />
                  Review & E-Sign Documents
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Your documents have been generated from the information you provided. Review each document and sign below.
                </p>
              </div>

              {generatingDocs ? (
                <div className="flex flex-col items-center py-8 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-muted-foreground">Generating your documents with AI...</p>
                  <p className="text-xs text-muted-foreground">Creating I-9, W-4, Direct Deposit, and Employee Handbook...</p>
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
                      <div key={doc.id} className="flex items-center justify-between p-4 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-primary" />
                          <div>
                            <p className="font-medium">{doc.document_type}</p>
                            <p className="text-xs text-muted-foreground">
                              {doc.ai_generated_html ? '✨ AI-formatted document' : 'Standard format'} · Generated {new Date(doc.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {doc.signed_at ? (
                            <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" />Signed</Badge>
                          ) : (
                            <Badge variant="warning">Pending</Badge>
                          )}
                        </div>
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

                      <FieldGroup label="Type your full legal name" error={stepErrors.signature}>
                        <Input value={signatureText} onChange={(e) => setSignatureText(e.target.value)}
                          placeholder={`${firstName} ${lastName}`} className="font-serif text-lg italic" />
                      </FieldGroup>

                      <div className="text-center text-xs text-muted-foreground">— or draw your signature —</div>

                      <div className="border rounded-lg p-2 bg-white">
                        <canvas ref={canvasRef} width={500} height={120}
                          className="w-full cursor-crosshair border border-dashed rounded"
                          onMouseDown={startDrawing} onMouseMove={draw}
                          onMouseUp={stopDrawing} onMouseLeave={stopDrawing} />
                        <div className="flex justify-end mt-1">
                          <Button variant="ghost" size="sm" onClick={clearCanvas}>Clear</Button>
                        </div>
                      </div>

                      <Button onClick={signAllDocuments} disabled={signing} className="w-full" size="lg">
                        {signing ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Signing...</>
                        ) : (
                          <><PenTool className="h-4 w-4 mr-2" />Sign All Documents ({documents.filter(d => !d.signed_at).length})</>
                        )}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Navigation */}
          {currentStep <= 4 && (
            <div className="flex justify-between mt-8 pt-6 border-t">
              <Button variant="outline" onClick={handleBack} disabled={currentStep === 1 || saving}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button onClick={handleNext} disabled={saving}>
                {saving ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
                ) : (
                  <>{currentStep === 4 ? 'Generate Documents' : 'Continue'}<ArrowRight className="h-4 w-4 ml-2" /></>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground mt-6 flex items-center justify-center gap-1">
        <Shield className="h-3 w-3" />
        All personal data is encrypted at rest. Your information is only shared with authorized HR personnel.
      </p>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────
function FieldGroup({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      {label && <Label className="text-sm font-medium">{label}</Label>}
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
