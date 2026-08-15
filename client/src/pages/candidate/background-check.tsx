import {
	AlertCircle,
	Briefcase,
	Building2,
	CheckCircle,
	Clock,
	GraduationCap,
	Plus,
	Search,
	ShieldAlert,
	XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState } from '@/components/domain/empty-state'
import { Skeleton } from '@/components/domain/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/auth-context'
import { trackEvent } from '@/lib/analytics'
import { apiCall } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────

type EmploymentEntry = {
	id: number
	company_name: string
	job_title: string
	start_date: string | null
	end_date: string | null
	is_current: boolean
	reference_name: string | null
	reference_email: string | null
	reference_phone: string | null
	description: string | null
	created_at: string
}

type EducationEntry = {
	id: number
	institution_name: string
	degree: string | null
	field_of_study: string | null
	start_date: string | null
	end_date: string | null
	is_current: boolean
	description: string | null
	created_at: string
}

type VerificationRequest = {
	id: number
	candidate_id: number
	type: 'employment' | 'education' | 'reference'
	target_id: number
	status: 'pending' | 'sent' | 'responded' | 'verified' | 'rejected' | 'manual_review'
	notes: string | null
	target_email: string | null
	created_at: string
	responded_at: string | null
	declared_data?: Record<string, unknown>
	discrepancy_list?: Array<{ field: string; severity: string; status: string }>
}

type Discrepancy = {
	id: number
	verification_request_id: number
	field_name: string
	declared_value: string | null
	verified_value: string | null
	severity: 'major' | 'minor'
	status: 'open' | 'candidate_responded' | 'resolved' | 'dismissed'
	candidate_response: string | null
	created_at: string
	verification_type: string
}

type ReferenceCheck = {
	id: number
	reference_name: string
	reference_email: string | null
	reference_phone: string | null
	relationship: string | null
	status: string
	created_at: string
}

// ─── Status helpers ───────────────────────────────────────────────────────

const verificationStatusConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
	pending: { icon: <Clock className='h-3.5 w-3.5' />, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', label: 'Pending' },
	sent: { icon: <Clock className='h-3.5 w-3.5' />, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: 'Sent' },
	responded: { icon: <CheckCircle className='h-3.5 w-3.5' />, color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', label: 'Responded' },
	verified: { icon: <CheckCircle className='h-3.5 w-3.5' />, color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', label: 'Verified' },
	rejected: { icon: <XCircle className='h-3.5 w-3.5' />, color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: 'Rejected' },
	manual_review: { icon: <AlertCircle className='h-3.5 w-3.5' />, color: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400', label: 'Manual Review' },
}

const discrepancyStatusConfig: Record<string, { color: string; label: string }> = {
	open: { color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: 'Open' },
	candidate_responded: { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: 'Responded' },
	resolved: { color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', label: 'Resolved' },
	dismissed: { color: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400', label: 'Dismissed' },
}

function formatDate(dateStr: string | null): string {
	if (!dateStr) return '—'
	return new Date(dateStr).toLocaleDateString()
}

// ─── Component ────────────────────────────────────────────────────────────

export function CandidateBackgroundCheckPage() {
	const { user } = useAuth()
	const candidateId = user?.id

	const [employment, setEmployment] = useState<EmploymentEntry[]>([])
	const [education, setEducation] = useState<EducationEntry[]>([])
	const [verifications, setVerifications] = useState<VerificationRequest[]>([])
	const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([])
	const [references, setReferences] = useState<ReferenceCheck[]>([])
	const [loading, setLoading] = useState(true)
	const [activeTab, setActiveTab] = useState('employment')
	const [error, setError] = useState<string | null>(null)

	// Add forms state
	const [showEmploymentForm, setShowEmploymentForm] = useState(false)
	const [showEducationForm, setShowEducationForm] = useState(false)
	const [submitting, setSubmitting] = useState(false)

	// Employment form
	const [empForm, setEmpForm] = useState({
		company_name: '',
		job_title: '',
		start_date: '',
		end_date: '',
		is_current: false,
		reference_name: '',
		reference_email: '',
		reference_phone: '',
		description: '',
	})

	// Education form
	const [eduForm, setEduForm] = useState({
		institution_name: '',
		degree: '',
		field_of_study: '',
		start_date: '',
		end_date: '',
		is_current: false,
		description: '',
	})

	// Discrepancy response
	const [respondingId, setRespondingId] = useState<number | null>(null)
	const [responseText, setResponseText] = useState('')

	useEffect(() => {
		if (!candidateId) return
		loadAll()
	}, [candidateId])

	async function loadAll() {
		if (!candidateId) return
		setLoading(true)
		setError(null)
		try {
			const [empRes, eduRes, discRes, refRes] = await Promise.all([
				apiCall<{ success: boolean; employment: EmploymentEntry[] }>(`/candidates/${candidateId}/employment`),
				apiCall<{ success: boolean; education: EducationEntry[] }>(`/candidates/${candidateId}/education`),
				apiCall<{ success: boolean; discrepancies: Discrepancy[] }>(`/candidates/${candidateId}/discrepancies`),
				apiCall<{ success: boolean; reference_checks: ReferenceCheck[] }>(`/reference-checks?candidate_id=${candidateId}`),
			])
			setEmployment(empRes.employment || [])
			setEducation(eduRes.education || [])
			setDiscrepancies(discRes.discrepancies || [])
			setReferences(refRes.reference_checks || [])

			// Try to load verification requests — backend may not have a list endpoint,
			// so we fetch individually from any entries that might have them.
			// # ponytail: no GET /verification-requests list endpoint; individual fetches if needed
			try {
				// Gather any existing verification IDs from discrepancies
				const vIds = new Set(discRes.discrepancies?.map((d) => d.verification_request_id) || [])
				const fetched: VerificationRequest[] = []
				for (const vid of vIds) {
					const v = await apiCall<{ success: boolean; verification_request: VerificationRequest }>(`/verification-requests/${vid}`)
					if (v.verification_request) fetched.push(v.verification_request)
				}
				setVerifications(fetched)
			} catch {
				// Ignore — list endpoint may not exist
			}
		} catch (err) {
			setError('Failed to load background check data')
			console.error(err)
		} finally {
			setLoading(false)
		}
	}

	async function addEmployment(e: React.FormEvent) {
		e.preventDefault()
		if (!candidateId || !empForm.company_name || !empForm.job_title) return
		setSubmitting(true)
		try {
			const data = await apiCall<{ success: boolean; employment: EmploymentEntry }>(`/candidates/${candidateId}/employment`, {
				method: 'POST',
				body: {
					...empForm,
					start_date: empForm.start_date || null,
					end_date: empForm.end_date || null,
				},
			})
			setEmployment((prev) => [data.employment, ...prev])
			setShowEmploymentForm(false)
			setEmpForm({ company_name: '', job_title: '', start_date: '', end_date: '', is_current: false, reference_name: '', reference_email: '', reference_phone: '', description: '' })
			trackEvent('background_check_employment_added')
		} catch (err) {
			console.error('Failed to add employment:', err)
		} finally {
			setSubmitting(false)
		}
	}

	async function addEducation(e: React.FormEvent) {
		e.preventDefault()
		if (!candidateId || !eduForm.institution_name) return
		setSubmitting(true)
		try {
			const data = await apiCall<{ success: boolean; education: EducationEntry }>(`/candidates/${candidateId}/education`, {
				method: 'POST',
				body: {
					...eduForm,
					start_date: eduForm.start_date || null,
					end_date: eduForm.end_date || null,
				},
			})
			setEducation((prev) => [data.education, ...prev])
			setShowEducationForm(false)
			setEduForm({ institution_name: '', degree: '', field_of_study: '', start_date: '', end_date: '', is_current: false, description: '' })
			trackEvent('background_check_education_added')
		} catch (err) {
			console.error('Failed to add education:', err)
		} finally {
			setSubmitting(false)
		}
	}

	async function respondToDiscrepancy(discrepancyId: number) {
		if (!responseText.trim()) return
		try {
			await apiCall(`/discrepancies/${discrepancyId}/respond`, {
				method: 'POST',
				body: { candidate_response: responseText },
			})
			setDiscrepancies((prev) =>
				prev.map((d) =>
					d.id === discrepancyId ? { ...d, status: 'candidate_responded' as const, candidate_response: responseText } : d,
				),
			)
			setRespondingId(null)
			setResponseText('')
			trackEvent('discrepancy_responded', { discrepancy_id: discrepancyId })
		} catch (err) {
			console.error('Failed to respond:', err)
		}
	}

	async function requestVerification(type: 'employment' | 'education', targetId: number, targetEmail?: string) {
		if (!candidateId) return
		try {
			await apiCall('/verification-requests', {
				method: 'POST',
				body: { candidate_id: candidateId, type, target_id: targetId, target_email: targetEmail || null },
			})
			trackEvent('verification_requested', { type, target_id: targetId })
			// Reload to show updated state
			loadAll()
		} catch (err) {
			console.error('Failed to request verification:', err)
		}
	}

	// Stats
	const totalEntries = employment.length + education.length
	const verifiedCount = verifications.filter((v) => v.status === 'verified').length
	const pendingVerifications = verifications.filter((v) => ['pending', 'sent'].includes(v.status)).length
	const openDiscrepancies = discrepancies.filter((d) => d.status === 'open').length

	return (
		<div className='space-y-6 px-4 sm:px-6'>
			{/* Header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='font-heading text-2xl font-bold'>Background Check</h1>
					<p className='text-muted-foreground'>
						Manage your employment history, education, and verification status
					</p>
				</div>
			</div>

			{/* Stats */}
			<div className='grid gap-4 grid-cols-2 lg:grid-cols-4'>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold'>{totalEntries}</p>
								<p className='text-xs text-muted-foreground'>Total Entries</p>
							</div>
							<Briefcase className='h-8 w-8 text-muted-foreground/50' />
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold text-green-600'>{verifiedCount}</p>
								<p className='text-xs text-muted-foreground'>Verified</p>
							</div>
							<CheckCircle className='h-8 w-8 text-green-500/50' />
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold text-amber-600'>{pendingVerifications}</p>
								<p className='text-xs text-muted-foreground'>Pending Verifications</p>
							</div>
							<Clock className='h-8 w-8 text-amber-500/50' />
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold text-red-600'>{openDiscrepancies}</p>
								<p className='text-xs text-muted-foreground'>Open Discrepancies</p>
							</div>
							<ShieldAlert className='h-8 w-8 text-red-500/50' />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Error */}
			{error && (
				<div className='rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400'>
					{error}
				</div>
			)}

			{/* Tabs */}
			<Tabs value={activeTab} onValueChange={setActiveTab}>
				<TabsList className='flex-wrap h-auto'>
					<TabsTrigger value='employment'>
						Employment
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{employment.length}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='education'>
						Education
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{education.length}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='verifications'>
						Verification Status
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{verifications.length}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='discrepancies'>
						Discrepancies
						{openDiscrepancies > 0 && (
							<Badge variant='destructive' className='ml-1 h-5 px-1.5 text-xs'>
								{openDiscrepancies}
							</Badge>
						)}
					</TabsTrigger>
				</TabsList>

				{/* ── Employment Tab ── */}
				<TabsContent value='employment' className='mt-4 space-y-4'>
					<div className='flex justify-end'>
						<Button size='sm' onClick={() => setShowEmploymentForm((s) => !s)} className='gap-1 min-h-[44px]'>
							<Plus className='h-4 w-4' />
							{showEmploymentForm ? 'Cancel' : 'Add Employment'}
						</Button>
					</div>

					{showEmploymentForm && (
						<Card>
							<CardContent className='p-4 space-y-4'>
								<form onSubmit={addEmployment} className='grid gap-4 sm:grid-cols-2'>
									<div className='space-y-1 sm:col-span-2'>
										<Label htmlFor='emp-company'>Company Name *</Label>
										<Input id='emp-company' value={empForm.company_name} onChange={(e) => setEmpForm((p) => ({ ...p, company_name: e.target.value }))} required />
									</div>
									<div className='space-y-1 sm:col-span-2'>
										<Label htmlFor='emp-title'>Job Title *</Label>
										<Input id='emp-title' value={empForm.job_title} onChange={(e) => setEmpForm((p) => ({ ...p, job_title: e.target.value }))} required />
									</div>
									<div className='space-y-1'>
										<Label htmlFor='emp-start'>Start Date</Label>
										<Input id='emp-start' type='date' value={empForm.start_date} onChange={(e) => setEmpForm((p) => ({ ...p, start_date: e.target.value }))} />
									</div>
									<div className='space-y-1'>
										<Label htmlFor='emp-end'>End Date</Label>
										<Input id='emp-end' type='date' value={empForm.end_date} onChange={(e) => setEmpForm((p) => ({ ...p, end_date: e.target.value }))} />
									</div>
									<div className='space-y-1 sm:col-span-2'>
										<label className='flex items-center gap-2 text-sm'>
											<input
												type='checkbox'
												checked={empForm.is_current}
												onChange={(e) => setEmpForm((p) => ({ ...p, is_current: e.target.checked }))}
												className='h-4 w-4'
											/>
											Current position
										</label>
									</div>
									<div className='space-y-1 sm:col-span-2'>
										<Label htmlFor='emp-ref-name'>Reference Contact Name</Label>
										<Input id='emp-ref-name' value={empForm.reference_name} onChange={(e) => setEmpForm((p) => ({ ...p, reference_name: e.target.value }))} />
									</div>
									<div className='space-y-1'>
										<Label htmlFor='emp-ref-email'>Reference Email</Label>
										<Input id='emp-ref-email' type='email' value={empForm.reference_email} onChange={(e) => setEmpForm((p) => ({ ...p, reference_email: e.target.value }))} />
									</div>
									<div className='space-y-1'>
										<Label htmlFor='emp-ref-phone'>Reference Phone</Label>
										<Input id='emp-ref-phone' value={empForm.reference_phone} onChange={(e) => setEmpForm((p) => ({ ...p, reference_phone: e.target.value }))} />
									</div>
									<div className='space-y-1 sm:col-span-2'>
										<Label htmlFor='emp-desc'>Description</Label>
										<Textarea id='emp-desc' value={empForm.description} onChange={(e) => setEmpForm((p) => ({ ...p, description: e.target.value }))} />
									</div>
									<div className='sm:col-span-2 flex justify-end'>
										<Button type='submit' disabled={submitting} className='min-h-[44px]'>
											{submitting ? 'Saving...' : 'Save Employment Entry'}
										</Button>
									</div>
								</form>
							</CardContent>
						</Card>
					)}

					{loading ? (
						<Skeleton count={3} variant='card' />
					) : employment.length === 0 ? (
						<EmptyState
							icon={Briefcase}
							title='No employment history'
							description='Add your work history to help recruiters verify your background'
							action={{ label: 'Add your first job', onClick: () => setShowEmploymentForm(true) }}
						/>
					) : (
						<div className='grid gap-4'>
							{employment.map((emp) => (
								<Card key={emp.id}>
									<CardContent className='p-4'>
										<div className='flex items-start gap-4'>
											<div className='h-10 w-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 dark:bg-indigo-900/30 dark:text-indigo-400'>
												<Building2 className='h-5 w-5' />
											</div>
											<div className='flex-1 min-w-0 space-y-1'>
												<div className='flex items-center gap-2 flex-wrap'>
													<h3 className='font-semibold truncate'>{emp.company_name}</h3>
													<Badge className='bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'>
														{emp.job_title}
													</Badge>
													{emp.is_current && (
														<Badge className='bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'>
															Current
														</Badge>
													)}
												</div>
												<div className='text-xs text-muted-foreground'>
													{formatDate(emp.start_date)} — {emp.is_current ? 'Present' : formatDate(emp.end_date)}
												</div>
												{emp.reference_name && (
													<div className='text-xs text-muted-foreground'>
														Reference: {emp.reference_name}
														{emp.reference_email && ` • ${emp.reference_email}`}
													</div>
												)}
											</div>
											<div className='shrink-0'>
												<Button
													size='sm'
													variant='outline'
													onClick={() => requestVerification('employment', emp.id, emp.reference_email || undefined)}
													className='min-h-[44px]'
												>
													Request Verification
												</Button>
											</div>
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					)}
				</TabsContent>

				{/* ── Education Tab ── */}
				<TabsContent value='education' className='mt-4 space-y-4'>
					<div className='flex justify-end'>
						<Button size='sm' onClick={() => setShowEducationForm((s) => !s)} className='gap-1 min-h-[44px]'>
							<Plus className='h-4 w-4' />
							{showEducationForm ? 'Cancel' : 'Add Education'}
						</Button>
					</div>

					{showEducationForm && (
						<Card>
							<CardContent className='p-4 space-y-4'>
								<form onSubmit={addEducation} className='grid gap-4 sm:grid-cols-2'>
									<div className='space-y-1 sm:col-span-2'>
										<Label htmlFor='edu-inst'>Institution Name *</Label>
										<Input id='edu-inst' value={eduForm.institution_name} onChange={(e) => setEduForm((p) => ({ ...p, institution_name: e.target.value }))} required />
									</div>
									<div className='space-y-1'>
										<Label htmlFor='edu-degree'>Degree</Label>
										<Input id='edu-degree' value={eduForm.degree} onChange={(e) => setEduForm((p) => ({ ...p, degree: e.target.value }))} />
									</div>
									<div className='space-y-1'>
										<Label htmlFor='edu-field'>Field of Study</Label>
										<Input id='edu-field' value={eduForm.field_of_study} onChange={(e) => setEduForm((p) => ({ ...p, field_of_study: e.target.value }))} />
									</div>
									<div className='space-y-1'>
										<Label htmlFor='edu-start'>Start Date</Label>
										<Input id='edu-start' type='date' value={eduForm.start_date} onChange={(e) => setEduForm((p) => ({ ...p, start_date: e.target.value }))} />
									</div>
									<div className='space-y-1'>
										<Label htmlFor='edu-end'>End Date</Label>
										<Input id='edu-end' type='date' value={eduForm.end_date} onChange={(e) => setEduForm((p) => ({ ...p, end_date: e.target.value }))} />
									</div>
									<div className='space-y-1 sm:col-span-2'>
										<label className='flex items-center gap-2 text-sm'>
											<input
												type='checkbox'
												checked={eduForm.is_current}
												onChange={(e) => setEduForm((p) => ({ ...p, is_current: e.target.checked }))}
												className='h-4 w-4'
											/>
											Currently studying
										</label>
									</div>
									<div className='space-y-1 sm:col-span-2'>
										<Label htmlFor='edu-desc'>Description</Label>
										<Textarea id='edu-desc' value={eduForm.description} onChange={(e) => setEduForm((p) => ({ ...p, description: e.target.value }))} />
									</div>
									<div className='sm:col-span-2 flex justify-end'>
										<Button type='submit' disabled={submitting} className='min-h-[44px]'>
											{submitting ? 'Saving...' : 'Save Education Entry'}
										</Button>
									</div>
								</form>
							</CardContent>
						</Card>
					)}

					{loading ? (
						<Skeleton count={3} variant='card' />
					) : education.length === 0 ? (
						<EmptyState
							icon={GraduationCap}
							title='No education history'
							description='Add your degrees and certifications for verification'
							action={{ label: 'Add your first education', onClick: () => setShowEducationForm(true) }}
						/>
					) : (
						<div className='grid gap-4'>
							{education.map((edu) => (
								<Card key={edu.id}>
									<CardContent className='p-4'>
										<div className='flex items-start gap-4'>
											<div className='h-10 w-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 dark:bg-indigo-900/30 dark:text-indigo-400'>
												<GraduationCap className='h-5 w-5' />
											</div>
											<div className='flex-1 min-w-0 space-y-1'>
												<div className='flex items-center gap-2 flex-wrap'>
													<h3 className='font-semibold truncate'>{edu.institution_name}</h3>
													{edu.degree && (
														<Badge className='bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'>
															{edu.degree}
														</Badge>
													)}
													{edu.is_current && (
														<Badge className='bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'>
															Current
														</Badge>
													)}
												</div>
												<div className='text-xs text-muted-foreground'>
													{formatDate(edu.start_date)} — {edu.is_current ? 'Present' : formatDate(edu.end_date)}
												</div>
												{edu.field_of_study && (
													<div className='text-xs text-muted-foreground'>Field: {edu.field_of_study}</div>
												)}
											</div>
											<div className='shrink-0'>
												<Button
													size='sm'
													variant='outline'
													onClick={() => requestVerification('education', edu.id)}
													className='min-h-[44px]'
												>
													Request Verification
												</Button>
											</div>
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					)}
				</TabsContent>

				{/* ── Verification Status Tab ── */}
				<TabsContent value='verifications' className='mt-4 space-y-4'>
					{loading ? (
						<Skeleton count={3} variant='card' />
					) : verifications.length === 0 ? (
						<EmptyState
							icon={Search}
							title='No verifications yet'
							description='Request verification for your employment or education entries from the Employment or Education tabs'
						/>
					) : (
						<div className='grid gap-4'>
							{verifications.map((v) => {
								const status = verificationStatusConfig[v.status] || verificationStatusConfig.pending
								return (
									<Card key={v.id}>
										<CardContent className='p-4'>
											<div className='flex items-start gap-4'>
												<div className='h-10 w-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 dark:bg-indigo-900/30 dark:text-indigo-400'>
													<CheckCircle className='h-5 w-5' />
												</div>
												<div className='flex-1 min-w-0 space-y-1'>
													<div className='flex items-center gap-2 flex-wrap'>
														<h3 className='font-semibold capitalize'>{v.type} Verification</h3>
														<Badge className={`text-xs ${status.color}`}>
															{status.icon}
															<span className='ml-1'>{status.label}</span>
														</Badge>
													</div>
													{v.target_email && (
														<div className='text-xs text-muted-foreground'>Sent to: {v.target_email}</div>
													)}
													{v.notes && (
														<div className='text-xs text-muted-foreground'>Notes: {v.notes}</div>
													)}
													{v.responded_at && (
														<div className='text-xs text-muted-foreground'>
															Responded: {new Date(v.responded_at).toLocaleDateString()}
														</div>
													)}
													{v.discrepancy_list && v.discrepancy_list.length > 0 && (
														<div className='mt-2 p-2 rounded bg-red-50 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400'>
															{v.discrepancy_list.length} discrepancy(s) found
														</div>
													)}
												</div>
											</div>
										</CardContent>
									</Card>
								)
							})}
						</div>
					)}
				</TabsContent>

				{/* ── Discrepancies Tab ── */}
				<TabsContent value='discrepancies' className='mt-4 space-y-4'>
					{loading ? (
						<Skeleton count={3} variant='card' />
					) : discrepancies.length === 0 ? (
						<EmptyState
							icon={CheckCircle}
							title='No discrepancies found'
							description='All your background check information matches verified records'
						/>
					) : (
						<div className='grid gap-4'>
							{discrepancies.map((d) => {
								const status = discrepancyStatusConfig[d.status] || discrepancyStatusConfig.open
								return (
									<Card key={d.id}>
										<CardContent className='p-4'>
											<div className='flex items-start gap-4'>
												<div className='h-10 w-10 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0 dark:bg-red-900/30 dark:text-red-400'>
													<ShieldAlert className='h-5 w-5' />
												</div>
												<div className='flex-1 min-w-0 space-y-2'>
													<div className='flex items-center gap-2 flex-wrap'>
														<h3 className='font-semibold'>Discrepancy: {d.field_name}</h3>
														<Badge className={`text-xs ${status.color}`}>{status.label}</Badge>
														<Badge variant='outline' className='text-xs'>
															{d.severity}
														</Badge>
													</div>
													<div className='text-sm'>
														<p>
															<span className='text-muted-foreground'>You declared:</span>{' '}
															<span className='font-medium'>{d.declared_value || '—'}</span>
														</p>
														<p>
															<span className='text-muted-foreground'>Verified:</span>{' '}
															<span className='font-medium'>{d.verified_value || '—'}</span>
														</p>
													</div>
													{d.candidate_response && (
														<div className='p-2 rounded bg-muted/50 text-sm'>
															<span className='text-muted-foreground'>Your response:</span>{' '}
															{d.candidate_response}
														</div>
													)}
													{d.status === 'open' && (
														<div className='space-y-2'>
															{respondingId === d.id ? (
																<>
																	<Textarea
																		placeholder='Explain this discrepancy...'
																		value={responseText}
																		onChange={(e) => setResponseText(e.target.value)}
																	/>
																	<div className='flex gap-2'>
																		<Button
																			size='sm'
																			onClick={() => respondToDiscrepancy(d.id)}
																			className='min-h-[44px]'
																		>
																			Submit Response
																		</Button>
																		<Button
																			size='sm'
																			variant='ghost'
																			onClick={() => {
																				setRespondingId(null)
																				setResponseText('')
																			}}
																			className='min-h-[44px]'
																		>
																			Cancel
																		</Button>
																	</div>
																</>
															) : (
																<Button
																	size='sm'
																	variant='outline'
																	onClick={() => setRespondingId(d.id)}
																	className='min-h-[44px]'
																>
																	Respond / Explain
																</Button>
															)}
														</div>
													)}
												</div>
											</div>
										</CardContent>
									</Card>
								)
							})}
						</div>
					)}
				</TabsContent>
			</Tabs>
		</div>
	)
}
