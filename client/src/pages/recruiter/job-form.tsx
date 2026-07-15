import {
	AlertCircle,
	ArrowLeft,
	Briefcase,
	Building2,
	Check,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	DollarSign,
	Eye,
	FileText,
	GraduationCap,
	GripVertical,
	Lightbulb,
	ListChecks,
	Loader2,
	MapPin,
	Plus,
	Save,
	Search,
	Sparkles,
	Wand2,
	X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { apiCall } from '@/lib/api'

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
	{
		question: 'Are you legally authorized to work in this country?',
		type: 'yes_no',
		required: true,
		category: 'work_authorization',
	},
	{
		question: 'What are your salary expectations? (annual, USD)',
		type: 'text',
		required: false,
		placeholder: 'e.g. $80,000 - $100,000',
		category: 'salary',
	},
	{
		question: 'When can you start?',
		type: 'select',
		required: true,
		options: ['Immediately', 'Within 2 weeks', 'Within 1 month', 'More than 1 month'],
		category: 'availability',
	},
	{
		question: 'Are you willing to relocate for this position?',
		type: 'yes_no',
		required: false,
		category: 'relocation',
	},
	{
		question: 'How many years of relevant experience do you have?',
		type: 'select',
		required: true,
		options: ['0-1 years', '1-3 years', '3-5 years', '5-10 years', '10+ years'],
		category: 'experience',
	},
]

const typeLabels: Record<string, string> = {
	text: 'Text',
	yes_no: 'Yes / No',
	select: 'Dropdown',
}

const jobTypeLabels: Record<string, string> = {
	'full-time': 'Full-time',
	'part-time': 'Part-time',
	contract: 'Contract',
	internship: 'Internship',
	remote: 'Remote',
	freelance: 'Freelance',
}

const stepLabels = [
	{ label: 'Job Details', icon: Briefcase },
	{ label: 'Requirements', icon: ListChecks },
	{ label: 'Preview & Post', icon: Eye },
]

function trackEvent(event: string, data?: Record<string, any>) {
	try {
		if (typeof window !== 'undefined' && (window as any).trackEvent) {
			;(window as any).trackEvent(event, data)
		}
	} catch {
		/* analytics disabled */
	}
}

export function RecruiterJobFormPage() {
	const { id } = useParams()
	const navigate = useNavigate()
	const isEdit = !!id
	const [loading, setLoading] = useState(isEdit)
	const [saving, setSaving] = useState(false)
	const [step, setStep] = useState(1)
	const [visitedSteps, setVisitedSteps] = useState<Set<number>>(new Set([1]))

	const [title, setTitle] = useState('')
	const [company, setCompany] = useState('')
	const [department, setDepartment] = useState('')
	const [description, setDescription] = useState('')
	const [requirements, setRequirements] = useState('')
	const [location, setLocation] = useState('')
	const [salaryRange, setSalaryRange] = useState('')
	const [jobType, setJobType] = useState('full-time')
	const [experienceLevel, setExperienceLevel] = useState('')
	const [educationLevel, setEducationLevel] = useState('')
	const [screeningQuestions, setScreeningQuestions] = useState<ScreeningQuestion[]>([])
	const [showTemplates, setShowTemplates] = useState(false)
	const [titleError, setTitleError] = useState('')
	const [aiSuggestingQuestions, setAiSuggestingQuestions] = useState(false)
	const [questionBank, setQuestionBank] = useState<ScreeningQuestion[]>([])
	const [showQuestionBank, setShowQuestionBank] = useState(false)
	const [bankLoading, setBankLoading] = useState(false)

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
	const [previousPostings, setPreviousPostings] = useState<any[]>([])
	const [showPreviousPostings, setShowPreviousPostings] = useState(false)
	const [loadingPostings, setLoadingPostings] = useState(false)

	// Multi-country fields
	const [countryCode, setCountryCode] = useState('US')
	const [currencyCode, setCurrencyCode] = useState('USD')
	const [currencySymbol, setCurrencySymbol] = useState('$')
	const [salaryMin, setSalaryMin] = useState('')
	const [salaryMax, setSalaryMax] = useState('')
	const [countries, setCountries] = useState<
		{ country_code: string; country_name: string; currency_code: string; currency_symbol: string }[]
	>([])

	useEffect(() => {
		loadCountries()
		if (isEdit) loadJob()
	}, [loadJob, loadCountries, isEdit])

	async function loadCountries() {
		try {
			const data = await apiCall<{ countries: any[] }>('/countries')
			setCountries(data.countries)
		} catch {
			/* fallback to US only */
		}
	}

	async function loadPreviousPostings() {
		setLoadingPostings(true)
		try {
			const data = await apiCall<{ success: boolean; autofill: { recent_postings: any[] } }>(
				'/memory/autofill/recruiter',
			)
			setPreviousPostings(data.autofill?.recent_postings || [])
			setShowPreviousPostings(true)
		} catch {
		} finally {
			setLoadingPostings(false)
		}
	}

	function applyTemplate(posting: any) {
		if (posting.title) setTitle(posting.title)
		if (posting.company) setCompany(posting.company)
		if (posting.description) setDescription(posting.description)
		if (posting.requirements) setRequirements(posting.requirements)
		if (posting.location) setLocation(posting.location)
		if (posting.salary_range) setSalaryRange(posting.salary_range)
		if (posting.job_type) setJobType(posting.job_type)
		if (posting.salary_min) setSalaryMin(String(posting.salary_min))
		if (posting.salary_max) setSalaryMax(String(posting.salary_max))
		setShowPreviousPostings(false)
		flashSuccess('Form populated from previous posting — edit as needed')
		trackEvent('job_form_apply_template', { title: posting.title })
	}

	function handleCountryChange(code: string) {
		setCountryCode(code)
		const country = countries.find((c) => c.country_code === code)
		if (country) {
			setCurrencyCode(country.currency_code)
			setCurrencySymbol(country.currency_symbol)
		}
	}

	async function loadJob() {
		try {
			const data = await apiCall<{
				job: {
					title: string
					company: string
					description: string
					requirements: string
					location: string
					salary_range: string
					job_type: string
					screening_questions: string | ScreeningQuestion[]
					department?: string
					experience_level?: string
					education_level?: string
				}
			}>(`/jobs/${id}`)
			const job = data.job
			setTitle(job.title || '')
			setCompany(job.company || '')
			setDepartment(job.department || '')
			setDescription(job.description || '')
			setRequirements(job.requirements || '')
			setLocation(job.location || '')
			setSalaryRange(job.salary_range || '')
			setJobType(job.job_type || 'full-time')
			setExperienceLevel(job.experience_level || '')
			setEducationLevel(job.education_level || '')
			if (job.screening_questions) {
				const parsed =
					typeof job.screening_questions === 'string'
						? JSON.parse(job.screening_questions)
						: job.screening_questions
				if (Array.isArray(parsed)) {
					setScreeningQuestions(
						parsed.map((q: ScreeningQuestion) => ({
							...q,
							type: q.type || 'text',
							required: q.required ?? false,
						})),
					)
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

	function goToStep(s: number) {
		if (s < 1 || s > 3) return
		setStep(s)
		setVisitedSteps((prev) => new Set([...prev, s]))
		trackEvent('job_form_step_change', { step: s, from: step })
	}

	function nextStep() {
		if (step === 1) {
			if (!title.trim()) {
				setTitleError('Job title is required')
				return
			}
			setTitleError('')
		}
		goToStep(step + 1)
	}

	function prevStep() {
		goToStep(step - 1)
	}

	async function handleAiGenerate() {
		if (!title.trim()) {
			setTitleError('Enter a job title first so AI can generate a description')
			return
		}
		setAiGenerating(true)
		trackEvent('job_form_ai_generate', { title, jobType })
		try {
			const data = await apiCall<{
				generated: {
					description: string
					requirements: string
					suggested_skills: string[]
					suggested_title: string
				}
			}>('/recruiter/jobs/generate', {
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
		trackEvent('job_form_ai_suggest_skills', { title })
		try {
			const data = await apiCall<{
				suggestions: { required_skills: SkillSuggestion[]; suggested_requirements: string[] }
			}>('/recruiter/jobs/suggest-skills', {
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
		trackEvent('job_form_ai_suggest_titles', { title })
		try {
			const data = await apiCall<{ suggestions: { suggestions: TitleSuggestion[] } }>(
				'/recruiter/jobs/suggest-title',
				{
					method: 'POST',
					body: { title, description },
				},
			)
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
		const skillsList = skillSuggestions.map((s) => s.skill).join(', ')
		const combined = `${requirements ? `${requirements}\n\n` : ''}Skills: ${skillsList}\n\n• ${newReqs}`
		setRequirements(combined)
		setShowSkillPanel(false)
		flashSuccess('Skills added to requirements!')
		trackEvent('job_form_apply_skills', { count: skillSuggestions.length })
	}

	async function handleSave() {
		if (!title.trim()) {
			setTitleError('Job title is required')
			goToStep(1)
			return
		}
		setTitleError('')
		setSaving(true)
		trackEvent('job_form_save', { isEdit, title, step })
		try {
			const payload = {
				title,
				company: company || undefined,
				department: department || undefined,
				description,
				requirements,
				location,
				salary_range: salaryRange,
				job_type: jobType,
				experience_level: experienceLevel || undefined,
				education_level: educationLevel || undefined,
				screening_questions: screeningQuestions.filter((q) => q.question.trim()),
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
			trackEvent('job_form_save_success', { isEdit, title })
			navigate('/recruiter/jobs')
		} catch (err: unknown) {
			alert(err instanceof Error ? err.message : 'Failed to save job')
			trackEvent('job_form_save_error', { error: err instanceof Error ? err.message : 'unknown' })
		} finally {
			setSaving(false)
		}
	}

	async function handleAiSuggestQuestions() {
		if (!title.trim()) {
			setTitleError('Enter a job title first')
			return
		}
		setAiSuggestingQuestions(true)
		trackEvent('job_form_ai_suggest_questions', { title })
		try {
			const data = await apiCall<{
				success: boolean
				suggestions: Array<{ question: string; type: string; category: string; options?: string[] }>
			}>('/recruiter/ai/suggest-questions', {
				method: 'POST',
				body: {
					job_title: title,
					job_description: description,
					existing_questions: screeningQuestions.map((q) => q.question),
				},
			})
			if (data.suggestions && data.suggestions.length > 0) {
				const newQuestions = data.suggestions.map((s) => ({
					id: `sq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
					question: s.question,
					type: (s.type === 'yes_no' || s.type === 'select'
						? s.type
						: 'text') as ScreeningQuestion['type'],
					required: false,
					options: s.options || [],
					category: s.category || 'general',
				}))
				setScreeningQuestions((prev) => [...prev, ...newQuestions])
				flashSuccess(`${newQuestions.length} AI-suggested questions added!`)
			}
		} catch {
			alert('AI question suggestion failed')
		} finally {
			setAiSuggestingQuestions(false)
		}
	}

	async function loadQuestionBank() {
		setBankLoading(true)
		try {
			const data = await apiCall<{
				success: boolean
				questions: Array<{
					id: number
					question_text: string
					question_type: string
					category: string
					options: string[]
				}>
			}>('/recruiter/question-bank')
			if (data.questions) {
				setQuestionBank(
					data.questions.map((q) => ({
						id: `bank_${q.id}`,
						question: q.question_text,
						type: (q.question_type === 'yes_no' || q.question_type === 'select'
							? q.question_type
							: 'text') as ScreeningQuestion['type'],
						required: false,
						options: q.options || [],
						category: q.category || 'general',
					})),
				)
			}
			setShowQuestionBank(true)
		} catch {
			alert('Failed to load question bank')
		} finally {
			setBankLoading(false)
		}
	}

	async function saveQuestionsToBank() {
		const toSave = screeningQuestions.filter((q) => q.question.trim())
		if (toSave.length === 0) return
		trackEvent('job_form_save_question_bank', { count: toSave.length })
		try {
			for (const q of toSave) {
				await apiCall('/recruiter/question-bank', {
					method: 'POST',
					body: {
						question_text: q.question,
						question_type: q.type,
						category: q.category || 'general',
						options: q.options || [],
					},
				})
			}
			flashSuccess(`${toSave.length} questions saved to your bank!`)
		} catch {
			alert('Failed to save to question bank')
		}
	}

	function addQuestion(template?: ScreeningQuestion) {
		const newQ: ScreeningQuestion = template
			? { ...template, id: `sq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
			: {
					question: '',
					type: 'text',
					required: false,
					id: `sq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
				}
		setScreeningQuestions((prev) => [...prev, newQ])
		setShowTemplates(false)
		trackEvent('job_form_add_question', { type: newQ.type, fromTemplate: !!template })
	}

	function addAllDefaults() {
		const existing = new Set(screeningQuestions.map((q) => q.question.toLowerCase()))
		const toAdd = defaultQuestionTemplates
			.filter((t) => !existing.has(t.question.toLowerCase()))
			.map((t) => ({ ...t, id: `sq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }))
		setScreeningQuestions((prev) => [...prev, ...toAdd])
		setShowTemplates(false)
		trackEvent('job_form_add_all_defaults', { count: toAdd.length })
	}

	function updateQuestion(index: number, updates: Partial<ScreeningQuestion>) {
		setScreeningQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...updates } : q)))
	}

	function removeQuestion(index: number) {
		setScreeningQuestions((prev) => prev.filter((_, i) => i !== index))
	}

	function addOption(qIndex: number) {
		setScreeningQuestions((prev) =>
			prev.map((q, i) => (i === qIndex ? { ...q, options: [...(q.options || []), ''] } : q)),
		)
	}

	function updateOption(qIndex: number, optIndex: number, value: string) {
		setScreeningQuestions((prev) =>
			prev.map((q, i) =>
				i === qIndex
					? { ...q, options: (q.options || []).map((o, j) => (j === optIndex ? value : o)) }
					: q,
			),
		)
	}

	function removeOption(qIndex: number, optIndex: number) {
		setScreeningQuestions((prev) =>
			prev.map((q, i) =>
				i === qIndex ? { ...q, options: (q.options || []).filter((_, j) => j !== optIndex) } : q,
			),
		)
	}

	function formatSalaryDisplay(): string {
		if (salaryRange) return salaryRange
		if (salaryMin && salaryMax) {
			return `${currencySymbol}${Number(salaryMin).toLocaleString()} - ${currencySymbol}${Number(salaryMax).toLocaleString()} ${currencyCode}`
		}
		if (salaryMin) return `${currencySymbol}${Number(salaryMin).toLocaleString()} ${currencyCode}`
		if (salaryMax)
			return `Up to ${currencySymbol}${Number(salaryMax).toLocaleString()} ${currencyCode}`
		return 'Competitive salary'
	}

	if (loading) {
		return (
			<div className='flex items-center justify-center py-16'>
				<div className='h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent' />
			</div>
		)
	}

	return (
		<div className='max-w-3xl mx-auto space-y-6 px-4 sm:px-6'>
			{/* AI Success Toast */}
			{aiSuccess && (
				<div className='fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-2 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm'>
					<CheckCircle2 className='h-4 w-4' />
					{aiSuccess}
				</div>
			)}

			{/* Header */}
			<div className='flex items-center gap-3'>
				<Button variant='ghost' size='sm' onClick={() => navigate('/recruiter/jobs')} className='min-h-[44px]'>
					<ArrowLeft className='h-4 w-4' />
				</Button>
				<div>
					<h1 className='text-xl sm:text-2xl font-bold'>{isEdit ? 'Edit Job' : 'Post New Job'}</h1>
					<p className='text-muted-foreground text-sm'>
						{isEdit ? 'Update your job listing' : 'Create a new job posting in 3 steps'}
					</p>
				</div>
			</div>

			{/* Step Indicator */}
			<div className='w-full'>
				<div className='flex items-center justify-between mb-2'>
					{stepLabels.map((s, i) => {
						const stepNum = i + 1
						const isActive = step === stepNum
						const isCompleted = step > stepNum || (visitedSteps.has(stepNum) && step !== stepNum)
						const Icon = s.icon
						return (
							<button
								key={stepNum}
								onClick={() => goToStep(stepNum)}
								className='flex flex-col items-center gap-1.5 group relative min-h-[44px]'
							>
								<div
									className={`
                  flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full text-sm font-semibold transition-all
                  ${isActive ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 ring-2 ring-indigo-500/20' : ''}
                  ${isCompleted ? 'bg-green-500 text-white' : ''}
                  ${!isActive && !isCompleted ? 'bg-muted text-muted-foreground border border-border' : ''}
                `}
								>
									{isCompleted ? <Check className='h-4 w-4' /> : <Icon className='h-4 w-4' />}
								</div>
								<span
									className={`
                  text-[10px] sm:text-xs font-medium transition-colors
                  ${isActive ? 'text-indigo-600' : ''}
                  ${isCompleted ? 'text-green-600' : ''}
                  ${!isActive && !isCompleted ? 'text-muted-foreground' : ''}
                `}
								>
									{s.label}
								</span>
								{isActive && (
									<div className='absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-500' />
								)}
							</button>
						)
					})}
				</div>
				{/* Progress bar */}
				<div className='h-1.5 w-full bg-muted rounded-full overflow-hidden'>
					<div
						className='h-full bg-indigo-500 rounded-full transition-all duration-500 ease-out'
						style={{ width: `${((step - 1) / 2) * 100}%` }}
					/>
				</div>
			</div>

			{/* Previous postings auto-fill (only on new) */}
			{!isEdit && step === 1 && (
				<div className='flex flex-wrap items-center gap-2'>
					<Button
						variant='outline'
						size='sm'
						onClick={loadPreviousPostings}
						disabled={loadingPostings}
						className='gap-1.5 text-xs sm:text-sm min-h-[44px]'
					>
						{loadingPostings ? (
							<Loader2 className='h-3.5 w-3.5 animate-spin' />
						) : (
							<Sparkles className='h-3.5 w-3.5' />
						)}
						Use Previous Posting as Template
					</Button>
				</div>
			)}
			{!isEdit && showPreviousPostings && previousPostings.length > 0 && (
				<div className='rounded-lg border bg-blue-50/30 p-3 space-y-2'>
					<div className='flex items-center justify-between mb-1'>
						<p className='text-xs font-medium text-blue-700 flex items-center gap-1'>
							<Sparkles className='h-3 w-3' /> Your Recent Postings
						</p>
						<Button
							variant='ghost'
							size='sm'
							onClick={() => setShowPreviousPostings(false)}
							className='h-6 w-6 p-0 min-h-[44px]'
						>
							<X className='h-3 w-3' />
						</Button>
					</div>
					{previousPostings.slice(0, 5).map((p, i) => (
						<button
							key={p.id || p.title || `posting-${i}`}
							onClick={() => applyTemplate(p)}
							className='w-full text-left rounded-md border bg-white p-3 text-sm hover:border-indigo-300 hover:bg-blue-50/60 transition-colors cursor-pointer min-h-[44px]'
						>
							<div className='flex items-center justify-between'>
								<span className='font-medium'>{p.title}</span>
								<Badge variant='outline' className='text-[10px]'>
									{p.job_type || 'full-time'}
								</Badge>
							</div>
							<p className='text-xs text-muted-foreground mt-0.5'>
								{p.location || 'No location'} · {p.salary_range || 'No salary'} · Posted{' '}
								{new Date(p.created_at).toLocaleDateString()}
							</p>
						</button>
					))}
				</div>
			)}
			{!isEdit && showPreviousPostings && previousPostings.length === 0 && (
				<p className='text-xs text-muted-foreground'>
					No previous postings found. Your first posting will be saved as a template.
				</p>
			)}

			{/* ==================== STEP 1: Job Details ==================== */}
			{step === 1 && (
				<Card className='border-border/60 shadow-sm'>
					<CardHeader className='pb-4'>
						<CardTitle className='flex items-center gap-2 text-lg'>
							<Briefcase className='h-5 w-5 text-indigo-500' /> Job Details
						</CardTitle>
					</CardHeader>
					<CardContent className='space-y-5'>
						{/* Title */}
						<div>
							<div className='flex flex-wrap items-center justify-between gap-2'>
								<Label className='text-sm font-medium'>Job Title *</Label>
								<Button
									variant='ghost'
									size='sm'
									onClick={handleSuggestTitles}
									disabled={aiSuggestingTitles || !title.trim()}
									className='h-7 text-xs gap-1 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 min-h-[44px]'
								>
									{aiSuggestingTitles ? (
										<Loader2 className='h-3 w-3 animate-spin' />
									) : (
										<Lightbulb className='h-3 w-3' />
									)}
									Suggest Titles
								</Button>
							</div>
							<Input
								value={title}
								onChange={(e) => {
									setTitle(e.target.value)
									setTitleError('')
								}}
								placeholder='e.g. Senior Software Engineer'
								className={`mt-1.5 ${titleError ? 'border-red-400 focus-visible:ring-red-400' : ''} min-h-[44px]`}
							/>
							{titleError && (
								<p className='text-xs text-red-500 mt-1 flex items-center gap-1'>
									<AlertCircle className='h-3 w-3' />
									{titleError}
								</p>
							)}
							{/* AI Title Suggestions */}
							{showTitleSuggestions && titleSuggestions.length > 0 && (
								<div className='mt-2 rounded-lg border bg-blue-50/50 p-3 space-y-2'>
									<div className='flex items-center justify-between'>
										<p className='text-xs font-medium text-blue-700 flex items-center gap-1'>
											<Sparkles className='h-3 w-3' /> AI Title Suggestions
										</p>
										<Button
											variant='ghost'
											size='sm'
											onClick={() => setShowTitleSuggestions(false)}
											className='h-6 w-6 p-0 min-h-[44px]'
										>
											<X className='h-3 w-3' />
										</Button>
									</div>
									{titleSuggestions.map((s, i) => (
										<button
											key={s.title}
											onClick={() => {
												setTitle(s.title)
												setShowTitleSuggestions(false)
												flashSuccess('Title updated!')
											}}
											className='w-full text-left rounded-md border bg-white p-2.5 text-sm hover:border-indigo-300 hover:bg-blue-50/60 transition-colors cursor-pointer min-h-[44px]'
										>
											<div className='flex items-center justify-between'>
												<span className='font-medium'>{s.title}</span>
												{s.search_volume && (
													<Badge variant='outline' className='text-[9px]'>
														{s.search_volume} search
													</Badge>
												)}
											</div>
											<p className='text-xs text-muted-foreground mt-0.5'>{s.reason}</p>
										</button>
									))}
								</div>
							)}
						</div>

						{/* Company + Department */}
						<div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
							<div>
								<Label className='text-sm font-medium'>Company Name</Label>
								<Input
									value={company}
									onChange={(e) => setCompany(e.target.value)}
									placeholder='Leave blank to use your company name'
									className='mt-1.5 min-h-[44px]'
								/>
								<p className='text-[11px] text-muted-foreground mt-0.5'>
									Auto-filled from your account if blank
								</p>
							</div>
							<div>
								<Label className='text-sm font-medium'>Department</Label>
								<Input
									value={department}
									onChange={(e) => setDepartment(e.target.value)}
									placeholder='e.g. Engineering, Sales, Marketing'
									className='mt-1.5 min-h-[44px]'
								/>
							</div>
						</div>

						{/* Type, Country, Location */}
						<div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
							<div>
								<Label className='text-sm font-medium'>Job Type</Label>
								<Select
									value={jobType}
									onChange={(e) => setJobType(e.target.value)}
									className='mt-1.5 min-h-[44px]'
								>
									<option value='full-time'>Full-time</option>
									<option value='part-time'>Part-time</option>
									<option value='contract'>Contract</option>
									<option value='internship'>Internship</option>
									<option value='remote'>Remote</option>
									<option value='freelance'>Freelance</option>
								</Select>
							</div>
							<div>
								<Label className='text-sm font-medium'>Country</Label>
								<Select
									value={countryCode}
									onChange={(e) => handleCountryChange(e.target.value)}
									className='mt-1.5 min-h-[44px]'
								>
									{countries.length > 0 ? (
										countries.map((c) => (
											<option key={c.country_code} value={c.country_code}>
												{c.country_name}
											</option>
										))
									) : (
										<>
											<option value='US'>United States</option>
											<option value='IN'>India</option>
											<option value='GB'>United Kingdom</option>
											<option value='CA'>Canada</option>
											<option value='DE'>Germany</option>
											<option value='FR'>France</option>
											<option value='AU'>Australia</option>
											<option value='SG'>Singapore</option>
										</>
									)}
								</Select>
							</div>
							<div>
								<Label className='text-sm font-medium'>Location</Label>
								<Input
									value={location}
									onChange={(e) => setLocation(e.target.value)}
									placeholder='e.g. New York, NY or Remote'
									className='mt-1.5 min-h-[44px]'
								/>
							</div>
						</div>

						{/* Salary */}
						<div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
							<div>
								<Label className='text-sm font-medium'>Min Salary ({currencySymbol})</Label>
								<Input
									type='number'
									value={salaryMin}
									onChange={(e) => setSalaryMin(e.target.value)}
									placeholder={`e.g. ${currencyCode === 'INR' ? '800000' : currencyCode === 'GBP' ? '40000' : '80000'}`}
									className='mt-1.5 min-h-[44px]'
								/>
							</div>
							<div>
								<Label className='text-sm font-medium'>Max Salary ({currencySymbol})</Label>
								<Input
									type='number'
									value={salaryMax}
									onChange={(e) => setSalaryMax(e.target.value)}
									placeholder={`e.g. ${currencyCode === 'INR' ? '1500000' : currencyCode === 'GBP' ? '70000' : '120000'}`}
									className='mt-1.5 min-h-[44px]'
								/>
							</div>
							<div>
								<Label className='text-sm font-medium'>
									Salary Range (text){' '}
									<span className='text-muted-foreground text-[10px] font-normal'>optional</span>
								</Label>
								<Input
									value={salaryRange}
									onChange={(e) => setSalaryRange(e.target.value)}
									placeholder={`e.g. ${currencySymbol}80,000 - ${currencySymbol}120,000`}
									className='mt-1.5 min-h-[44px]'
								/>
							</div>
						</div>
						{currencyCode !== 'USD' && (
							<div className='flex items-center gap-2'>
								<Badge variant='outline' className='text-xs'>
									{currencyCode} ({currencySymbol})
								</Badge>
								<span className='text-xs text-muted-foreground'>
									Salary will be displayed in {currencyCode}
								</span>
							</div>
						)}

						{/* Description */}
						<div>
							<div className='flex flex-wrap items-center justify-between gap-2'>
								<Label className='text-sm font-medium'>Job Description</Label>
								<Button
									variant='outline'
									size='sm'
									onClick={handleAiGenerate}
									disabled={aiGenerating || !title.trim()}
									className='h-7 text-xs gap-1.5 border-indigo-300 text-indigo-600 hover:bg-indigo-500 hover:text-white transition-colors min-h-[44px]'
								>
									{aiGenerating ? (
										<Loader2 className='h-3 w-3 animate-spin' />
									) : (
										<Wand2 className='h-3 w-3' />
									)}
									{aiGenerating ? 'Generating...' : '✨ Generate with AI'}
								</Button>
							</div>
							<Textarea
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="Describe the role, responsibilities, and what a typical day looks like... or click 'Generate with AI' to auto-fill"
								rows={6}
								className='mt-1.5 resize-y min-h-[44px]'
							/>
							{aiGenerating && (
								<div className='mt-2 flex items-center gap-2 text-xs text-indigo-600'>
									<Loader2 className='h-3 w-3 animate-spin' />
									AI is writing a tailored description based on your job title...
								</div>
							)}
						</div>
					</CardContent>
				</Card>
			)}

			{/* ==================== STEP 2: Requirements ==================== */}
			{step === 2 && (
				<Card className='border-border/60 shadow-sm'>
					<CardHeader className='pb-4'>
						<CardTitle className='flex items-center gap-2 text-lg'>
							<ListChecks className='h-5 w-5 text-indigo-500' /> Requirements & Screening
						</CardTitle>
					</CardHeader>
					<CardContent className='space-y-5'>
						{/* Requirements */}
						<div>
							<div className='flex flex-wrap items-center justify-between gap-2'>
								<Label className='text-sm font-medium'>Requirements & Skills</Label>
								<Button
									variant='ghost'
									size='sm'
									onClick={handleSuggestSkills}
									disabled={aiSuggestingSkills || !title.trim()}
									className='h-7 text-xs gap-1 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 min-h-[44px]'
								>
									{aiSuggestingSkills ? (
										<Loader2 className='h-3 w-3 animate-spin' />
									) : (
										<Lightbulb className='h-3 w-3' />
									)}
									Suggest Skills
								</Button>
							</div>
							<Textarea
								value={requirements}
								onChange={(e) => setRequirements(e.target.value)}
								placeholder='List the required skills, experience, and qualifications...'
								rows={5}
								className='mt-1.5 resize-y min-h-[44px]'
							/>
							{/* AI Skills Panel */}
							{showSkillPanel &&
								(skillSuggestions.length > 0 || suggestedRequirements.length > 0) && (
									<div className='mt-2 rounded-lg border bg-violet-50/50 p-3 space-y-3'>
										<div className='flex items-center justify-between'>
											<p className='text-xs font-medium text-violet-700 flex items-center gap-1'>
												<Sparkles className='h-3 w-3' /> AI Suggested Skills & Requirements
											</p>
											<Button
												variant='ghost'
												size='sm'
												onClick={() => setShowSkillPanel(false)}
												className='h-6 w-6 p-0 min-h-[44px]'
											>
												<X className='h-3 w-3' />
											</Button>
										</div>
										{skillSuggestions.length > 0 && (
											<div className='flex flex-wrap gap-1.5'>
												{skillSuggestions.map((s, i) => (
													<span
														key={s.skill}
														className={`text-[11px] rounded-full px-2.5 py-1 border ${
															s.importance === 'must-have'
																? 'bg-violet-100 text-violet-700 border-violet-200 font-medium'
																: 'bg-white text-muted-foreground border-gray-200'
														}`}
													>
														{s.skill}
														{s.importance === 'must-have' && (
															<span className='ml-1 text-[9px]'>★</span>
														)}
													</span>
												))}
											</div>
										)}
										{suggestedRequirements.length > 0 && (
											<div className='text-xs text-muted-foreground space-y-1'>
												{suggestedRequirements.slice(0, 5).map((r, i) => (
													<p key={r} className='flex items-start gap-1.5'>
														<CheckCircle2 className='h-3 w-3 text-violet-400 mt-0.5 shrink-0' />
														{r}
													</p>
												))}
											</div>
										)}
										<Button
											size='sm'
											onClick={applySkillsToRequirements}
											className='w-full text-xs gap-1 bg-violet-600 hover:bg-violet-700 min-h-[44px]'
										>
											<Plus className='h-3 w-3' /> Apply to Requirements
										</Button>
									</div>
								)}
						</div>

						{/* Experience & Education */}
						<div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
							<div>
								<Label className='text-sm font-medium'>Experience Level</Label>
								<Select
									value={experienceLevel}
									onChange={(e) => setExperienceLevel(e.target.value)}
									className='mt-1.5 min-h-[44px]'
								>
									<option value=''>Select experience level</option>
									<option value='entry'>Entry-level (0-2 years)</option>
									<option value='mid'>Mid-level (2-5 years)</option>
									<option value='senior'>Senior (5+ years)</option>
									<option value='lead'>Lead / Principal</option>
								</Select>
							</div>
							<div>
								<Label className='text-sm font-medium'>Education Level</Label>
								<Select
									value={educationLevel}
									onChange={(e) => setEducationLevel(e.target.value)}
									className='mt-1.5 min-h-[44px]'
								>
									<option value=''>Select education level</option>
									<option value='high-school'>High School</option>
									<option value='associate'>Associate's Degree</option>
									<option value='bachelor'>Bachelor's Degree</option>
									<option value='master'>Master's Degree</option>
									<option value='phd'>PhD / Doctorate</option>
								</Select>
							</div>
						</div>

						{/* Screening Questions */}
						<div className='border-t pt-5'>
							<div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4'>
								<h3 className='text-sm font-semibold flex items-center gap-2'>
									<ListChecks className='h-4 w-4 text-indigo-500' /> Pre-screening Questions
								</h3>
								<div className='flex items-center gap-2 flex-wrap'>
									<Button
										variant='outline'
										size='sm'
										onClick={handleAiSuggestQuestions}
										disabled={aiSuggestingQuestions || !title.trim()}
										className='gap-1 text-xs border-indigo-300 text-indigo-600 hover:bg-indigo-500 hover:text-white min-h-[44px]'
									>
										{aiSuggestingQuestions ? (
											<Loader2 className='h-3 w-3 animate-spin' />
										) : (
											<Wand2 className='h-3 w-3' />
										)}
										AI Suggest
									</Button>
									<Button
										variant='outline'
										size='sm'
										onClick={loadQuestionBank}
										disabled={bankLoading}
										className='gap-1 text-xs min-h-[44px]'
									>
										{bankLoading ? (
											<Loader2 className='h-3 w-3 animate-spin' />
										) : (
											<Lightbulb className='h-3 w-3' />
										)}
										My Bank
									</Button>
									<Button
										variant='outline'
										size='sm'
										onClick={() => setShowTemplates(!showTemplates)}
										className='gap-1 text-xs min-h-[44px]'
									>
										<Sparkles className='h-3 w-3' /> Templates
									</Button>
									<Button
										variant='outline'
										size='sm'
										onClick={() => addQuestion()}
										className='gap-1 text-xs min-h-[44px]'
									>
										<Plus className='h-3 w-3' /> Custom
									</Button>
								</div>
							</div>

							{/* Templates dropdown */}
							{showTemplates && (
								<div className='mb-4 rounded-lg border bg-muted/30 p-3 space-y-2'>
									<div className='flex items-center justify-between mb-2'>
										<p className='text-sm font-medium'>Common Questions</p>
										<Button variant='ghost' size='sm' onClick={addAllDefaults} className='text-xs min-h-[44px]'>
											Add All
										</Button>
									</div>
									{defaultQuestionTemplates.map((t, i) => {
										const alreadyAdded = screeningQuestions.some(
											(q) => q.question.toLowerCase() === t.question.toLowerCase(),
										)
										return (
											<button
												key={t.question}
												onClick={() => !alreadyAdded && addQuestion(t)}
												disabled={alreadyAdded}
												className={`w-full text-left rounded-md border p-2.5 text-sm transition-colors ${
													alreadyAdded
														? 'opacity-50 cursor-not-allowed bg-muted'
														: 'hover:bg-background hover:border-indigo-300 cursor-pointer'
												} min-h-[44px]`}
											>
												<div className='flex items-center justify-between'>
													<span>{t.question}</span>
													<div className='flex items-center gap-1.5'>
														<Badge variant='outline' className='text-[10px]'>
															{typeLabels[t.type]}
														</Badge>
														{t.required && (
															<Badge variant='secondary' className='text-[10px]'>
																Required
															</Badge>
														)}
														{alreadyAdded && (
															<span className='text-[10px] text-muted-foreground'>Added</span>
														)}
													</div>
												</div>
											</button>
										)
									})}
								</div>
							)}

							{/* Question Bank panel */}
							{showQuestionBank && (
								<div className='mb-4 rounded-lg border bg-indigo-50/30 p-3 space-y-2'>
									<div className='flex items-center justify-between mb-2'>
										<p className='text-sm font-medium flex items-center gap-1'>
											<Lightbulb className='h-3.5 w-3.5 text-indigo-600' /> Your Question Bank
										</p>
										<Button
											variant='ghost'
											size='sm'
											onClick={() => setShowQuestionBank(false)}
											className='h-6 w-6 p-0 min-h-[44px]'
										>
											<X className='h-3 w-3' />
										</Button>
									</div>
									{questionBank.length === 0 ? (
										<p className='text-xs text-muted-foreground text-center py-4'>
											No saved questions yet. Add screening questions and save them to your bank.
										</p>
									) : (
										questionBank.map((q, i) => {
											const alreadyAdded = screeningQuestions.some(
												(sq) => sq.question.toLowerCase() === q.question.toLowerCase(),
											)
											return (
												<button
													key={q.id || i}
													onClick={() => {
														if (!alreadyAdded) {
															addQuestion({
																...q,
																id: `sq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
															})
														}
													}}
													disabled={alreadyAdded}
													className={`w-full text-left rounded-md border p-2.5 text-sm transition-colors ${
														alreadyAdded
															? 'opacity-50 cursor-not-allowed bg-muted'
															: 'hover:bg-white hover:border-indigo-300 cursor-pointer'
													} min-h-[44px]`}
												>
													<div className='flex items-center justify-between'>
														<span>{q.question}</span>
														<div className='flex items-center gap-1.5'>
															{q.category && (
																<Badge variant='outline' className='text-[10px]'>
																	{q.category}
																</Badge>
															)}
															{alreadyAdded && (
																<span className='text-[10px] text-muted-foreground'>Added</span>
															)}
														</div>
													</div>
												</button>
											)
										})
									)}
								</div>
							)}

							{screeningQuestions.length === 0 ? (
								<div className='text-center py-8 rounded-lg border border-dashed border-muted-foreground/20'>
									<ListChecks className='mx-auto mb-2 h-8 w-8 opacity-30' />
									<p className='text-sm text-muted-foreground mb-1'>No screening questions yet</p>
									<p className='text-xs text-muted-foreground max-w-xs mx-auto'>
										Add questions to filter candidates before reviewing applications. Use AI,
										templates, or create your own.
									</p>
								</div>
							) : (
								<div className='space-y-3'>
									{screeningQuestions.map((q, i) => (
										<div key={q.id || i} className='rounded-lg border p-4 space-y-3 group bg-card'>
											<div className='flex items-start gap-2'>
												<GripVertical className='h-4 w-4 mt-2.5 text-muted-foreground/40 shrink-0' />
												<div className='flex-1 space-y-3'>
													<Input
														value={q.question}
														onChange={(e) => updateQuestion(i, { question: e.target.value })}
														placeholder={`Question ${i + 1}...`}
													 className='min-h-[44px]' />
													<div className='flex flex-wrap items-center gap-2'>
														<Select
															value={q.type}
															onChange={(e) => {
																const newType = e.target.value as ScreeningQuestion['type']
																const updates: Partial<ScreeningQuestion> = { type: newType }
																if (
																	newType === 'select' &&
																	(!q.options || q.options.length === 0)
																) {
																	updates.options = ['']
																}
																if (newType !== 'select') {
																	updates.options = undefined
																}
																updateQuestion(i, updates)
															}}
															className='w-32 text-xs min-h-[44px]'
														>
															<option value='text'>Text</option>
															<option value='yes_no'>Yes / No</option>
															<option value='select'>Dropdown</option>
														</Select>

														<label className='flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer'>
															<input
																type='checkbox'
																checked={q.required}
																onChange={() => updateQuestion(i, { required: !q.required })}
																className='rounded'
															/>
															Required
														</label>

														{q.type === 'text' && (
															<Input
																value={q.placeholder || ''}
																onChange={(e) => updateQuestion(i, { placeholder: e.target.value })}
																placeholder='Placeholder text...'
																className='flex-1 text-xs h-8 min-h-[44px]'
															/>
														)}
													</div>
													{q.type === 'select' && (
														<div className='space-y-2 pl-2 border-l-2 border-muted'>
															<p className='text-xs text-muted-foreground font-medium'>
																Dropdown Options
															</p>
															{(q.options || []).map((opt, oi) => (
																<div key={oi} className='flex items-center gap-2'>
																	<span className='text-xs text-muted-foreground w-4'>
																		{oi + 1}.
																	</span>
																	<Input
																		value={opt}
																		onChange={(e) => updateOption(i, oi, e.target.value)}
																		placeholder={`Option ${oi + 1}`}
																		className='flex-1 text-sm h-8 min-h-[44px]'
																	/>
																	<Button
																		variant='ghost'
																		size='icon'
																		className='h-8 w-8 shrink-0 min-h-[44px]'
																		onClick={() => removeOption(i, oi)}
																	>
																		<X className='h-3 w-3' />
																	</Button>
																</div>
															))}
															<Button
																variant='ghost'
																size='sm'
																onClick={() => addOption(i)}
																className='text-xs gap-1 min-h-[44px]'
															>
																<Plus className='h-3 w-3' /> Add Option
															</Button>
														</div>
													)}
												</div>
												<Button
													variant='ghost'
													size='icon'
													onClick={() => removeQuestion(i)}
													className='shrink-0 text-muted-foreground hover:text-destructive min-h-[44px]'
												>
													<X className='h-4 w-4' />
												</Button>
											</div>
										</div>
									))}
								</div>
							)}
							{screeningQuestions.length > 0 && (
								<div className='flex justify-end mt-3'>
									<Button
										variant='ghost'
										size='sm'
										onClick={saveQuestionsToBank}
										className='gap-1 text-xs text-muted-foreground min-h-[44px]'
									>
										<Save className='h-3 w-3' /> Save Questions to My Bank
									</Button>
								</div>
							)}
						</div>
					</CardContent>
				</Card>
			)}

			{/* ==================== STEP 3: Preview & Post ==================== */}
			{step === 3 && (
				<div className='space-y-5'>
					{/* Candidate Preview */}
					<Card className='border-border/60 shadow-sm overflow-hidden'>
						<CardHeader className='pb-3 bg-gradient-to-r from-indigo-50/50 to-white'>
							<CardTitle className='flex items-center gap-2 text-lg'>
								<Eye className='h-5 w-5 text-indigo-500' /> Candidate Preview
							</CardTitle>
							<p className='text-xs text-muted-foreground'>
								This is how your job will appear to candidates
							</p>
						</CardHeader>
						<CardContent className='p-0'>
							<div className='bg-white p-5 sm:p-6 space-y-5'>
								{/* Job header */}
								<div className='space-y-2'>
									<h2 className='text-xl sm:text-2xl font-bold text-gray-900'>
										{title || 'Untitled Job'}
									</h2>
									<div className='flex flex-wrap items-center gap-2 text-sm text-muted-foreground'>
										{company && (
											<span className='flex items-center gap-1'>
												<Building2 className='h-3.5 w-3.5' /> {company}
											</span>
										)}
										{department && (
											<span className='flex items-center gap-1'>
												<span className='text-gray-300'>·</span> {department}
											</span>
										)}
										<span className='flex items-center gap-1'>
											<span className='text-gray-300'>·</span> <MapPin className='h-3.5 w-3.5' />{' '}
											{location || 'Location not specified'}
										</span>
									</div>
									<div className='flex flex-wrap gap-2 mt-2'>
										<Badge className='bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-50'>
											{jobTypeLabels[jobType] || jobType}
										</Badge>
										{experienceLevel && (
											<Badge variant='outline' className='text-xs'>
												{experienceLevel === 'entry'
													? 'Entry-level'
													: experienceLevel === 'mid'
														? 'Mid-level'
														: experienceLevel === 'senior'
															? 'Senior'
															: 'Lead / Principal'}
											</Badge>
										)}
										{educationLevel && (
											<Badge variant='outline' className='text-xs'>
												{educationLevel === 'high-school'
													? 'High School'
													: educationLevel === 'associate'
														? 'Associate'
														: educationLevel === 'bachelor'
															? 'Bachelor'
															: educationLevel === 'master'
																? 'Master'
																: 'PhD'}
											</Badge>
										)}
										<Badge variant='outline' className='text-xs flex items-center gap-1'>
											<DollarSign className='h-3 w-3' /> {formatSalaryDisplay()}
										</Badge>
									</div>
								</div>

								{/* Description */}
								{description && (
									<div className='space-y-2'>
										<h3 className='text-sm font-semibold text-gray-900 flex items-center gap-1.5'>
											<FileText className='h-4 w-4 text-gray-400' /> About the Role
										</h3>
										<div className='text-sm text-gray-700 leading-relaxed whitespace-pre-line'>
											{description}
										</div>
									</div>
								)}

								{/* Requirements */}
								{requirements && (
									<div className='space-y-2'>
										<h3 className='text-sm font-semibold text-gray-900 flex items-center gap-1.5'>
											<GraduationCap className='h-4 w-4 text-gray-400' /> Requirements
										</h3>
										<div className='text-sm text-gray-700 leading-relaxed whitespace-pre-line'>
											{requirements}
										</div>
									</div>
								)}

								{/* Screening questions preview */}
								{screeningQuestions.length > 0 && (
									<div className='space-y-2'>
										<h3 className='text-sm font-semibold text-gray-900 flex items-center gap-1.5'>
											<ListChecks className='h-4 w-4 text-gray-400' /> Application Questions
										</h3>
										<div className='space-y-2'>
											{screeningQuestions.map((q, i) => (
												<div
													key={q.id || i}
													className='rounded-md border border-gray-100 bg-gray-50/50 p-3'
												>
													<p className='text-sm text-gray-800'>
														{i + 1}. {q.question}
														{q.required && <span className='text-red-500 ml-1'>*</span>}
													</p>
													<p className='text-[11px] text-muted-foreground mt-0.5'>
														{typeLabels[q.type]} {q.required && '· Required'}
													</p>
												</div>
											))}
										</div>
									</div>
								)}

								{/* Apply button mock */}
								<div className='pt-2'>
									<Button className='w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white gap-2 min-h-[44px]'>
										<CheckCircle2 className='h-4 w-4' /> Apply Now
									</Button>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* SEO / Meta Preview */}
					<Card className='border-border/60 shadow-sm'>
						<CardHeader className='pb-3'>
							<CardTitle className='flex items-center gap-2 text-base'>
								<Search className='h-4 w-4 text-indigo-500' /> SEO & Social Preview
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className='rounded-lg border bg-gray-50 p-4 space-y-3'>
								<div className='text-sm'>
									<p className='text-[11px] text-green-700 font-medium mb-0.5'>
										Google Search Result
									</p>
									<p className='text-indigo-700 text-base font-medium hover:underline cursor-pointer truncate'>
										{title || 'Untitled Job'} | {company || 'Rekrut AI'}
									</p>
									<p className='text-green-800 text-xs'>
										rekrutai.co/recruiter/jobs · {location || 'Remote'} ·{' '}
										{jobTypeLabels[jobType] || 'Full-time'}
									</p>
									<p className='text-gray-600 text-xs mt-0.5 line-clamp-2'>
										{description
											? description.slice(0, 140) + (description.length > 140 ? '...' : '')
											: 'Job description preview will appear here.'}
									</p>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Summary checklist */}
					<Card className='border-border/60 shadow-sm'>
						<CardHeader className='pb-3'>
							<CardTitle className='flex items-center gap-2 text-base'>
								<CheckCircle2 className='h-4 w-4 text-green-500' /> Before You Publish
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className='grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm'>
								<div
									className={`flex items-center gap-2 ${title ? 'text-green-700' : 'text-amber-600'}`}
								>
									{title ? (
										<CheckCircle2 className='h-4 w-4' />
									) : (
										<AlertCircle className='h-4 w-4' />
									)}
									Job title {title ? 'set' : 'required'}
								</div>
								<div
									className={`flex items-center gap-2 ${description ? 'text-green-700' : 'text-amber-600'}`}
								>
									{description ? (
										<CheckCircle2 className='h-4 w-4' />
									) : (
										<AlertCircle className='h-4 w-4' />
									)}
									Description {description ? 'filled' : 'recommended'}
								</div>
								<div
									className={`flex items-center gap-2 ${requirements ? 'text-green-700' : 'text-amber-600'}`}
								>
									{requirements ? (
										<CheckCircle2 className='h-4 w-4' />
									) : (
										<AlertCircle className='h-4 w-4' />
									)}
									Requirements {requirements ? 'filled' : 'recommended'}
								</div>
								<div
									className={`flex items-center gap-2 ${location ? 'text-green-700' : 'text-amber-600'}`}
								>
									{location ? (
										<CheckCircle2 className='h-4 w-4' />
									) : (
										<AlertCircle className='h-4 w-4' />
									)}
									Location {location ? 'set' : 'recommended'}
								</div>
								<div
									className={`flex items-center gap-2 ${salaryMin || salaryMax || salaryRange ? 'text-green-700' : 'text-amber-600'}`}
								>
									{salaryMin || salaryMax || salaryRange ? (
										<CheckCircle2 className='h-4 w-4' />
									) : (
										<AlertCircle className='h-4 w-4' />
									)}
									Salary {salaryMin || salaryMax || salaryRange ? 'set' : 'recommended'}
								</div>
								<div className='flex items-center gap-2 text-green-700'>
									<CheckCircle2 className='h-4 w-4' />
									{screeningQuestions.length} screening question
									{screeningQuestions.length !== 1 ? 's' : ''}
								</div>
							</div>
						</CardContent>
					</Card>
				</div>
			)}

			{/* Navigation Buttons */}
			<div
				className={`
        flex flex-wrap items-center gap-3 pt-2
        ${step === 3 ? 'sticky bottom-4 bg-background/80 backdrop-blur-sm py-3 px-4 rounded-xl border shadow-lg' : ''}
      `}
			>
				{step > 1 && (
					<Button variant='outline' onClick={prevStep} className='gap-1 min-h-[44px]'>
						<ChevronLeft className='h-4 w-4' /> Back
					</Button>
				)}
				<div className='flex-1' />
				{step < 3 ? (
					<Button onClick={nextStep} className='gap-1 bg-indigo-600 hover:bg-indigo-700 min-h-[44px]'>
						Next <ChevronRight className='h-4 w-4' />
					</Button>
				) : (
					<Button
						onClick={handleSave}
						disabled={saving}
						className='gap-2 bg-indigo-600 hover:bg-indigo-700 min-h-[44px]'
					>
						{saving ? (
							<div className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
						) : (
							<Save className='h-4 w-4' />
						)}
						{isEdit ? 'Update Job' : 'Publish Job'}
					</Button>
				)}
			</div>
		</div>
	)
}
