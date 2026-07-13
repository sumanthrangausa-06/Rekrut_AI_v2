import {
	AlertCircle,
	ArrowLeft,
	BarChart3,
	Bookmark,
	BookmarkPlus,
	BookOpen,
	Brain,
	Briefcase,
	Building2,
	CheckCircle,
	Clock,
	DollarSign,
	Eye,
	FileText,
	Globe,
	GraduationCap,
	ListChecks,
	Loader2,
	MapPin,
	Pencil,
	Send,
	Shield,
	Sparkles,
	Target,
	TrendingUp,
	Volume2,
	Wand2,
	X,
	Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Skeleton } from '@/components/domain/skeleton'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/auth-context'
import { apiCall } from '@/lib/api'

interface Job {
	id: number
	title: string
	company: string
	poster_company?: string
	description: string
	requirements: string
	location: string
	salary_range: string
	job_type: string
	remote_type?: string
	experience_level?: string
	company_size?: string
	company_logo?: string
	skills_required?: string[]
	applicants_count?: number
	posted_by?: string
	screening_questions?: string | ScreeningQuestion[]
	created_at: string
	updated_at?: string
}

interface ScreeningQuestion {
	id?: string
	question: string
	type?: 'text' | 'yes_no' | 'select'
	required?: boolean
	options?: string[]
	placeholder?: string
	category?: string
}

interface AutoFillData {
	resume_url: string | null
	cover_letter: string
	screening_answers: Record<string, { value: string; source: string }>
	profile: { name: string; email: string; phone: string; location: string }
}

interface TailoredDocument {
	resume: string
	cover_letter: string
	match_summary: string
	key_strengths: string[]
	why_fit: string
}

export function CandidateJobDetailPage() {
	const { id } = useParams()
	const navigate = useNavigate()
	const { user } = useAuth()
	const [job, setJob] = useState<Job | null>(null)
	const [loading, setLoading] = useState(true)
	const [applying, setApplying] = useState(false)
	const [applied, setApplied] = useState(false)
	const [showApplyForm, setShowApplyForm] = useState(false)
	const [showOneClickModal, setShowOneClickModal] = useState(false)
	const [coverLetter, setCoverLetter] = useState('')
	const [screeningAnswers, setScreeningAnswers] = useState<Record<string, string>>({})
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [autoFill, setAutoFill] = useState<AutoFillData | null>(null)
	const [autoFillSources, setAutoFillSources] = useState<Record<string, string>>({})
	const [generatingCL, setGeneratingCL] = useState(false)
	const [generatingSuggestions, setGeneratingSuggestions] = useState(false)
	const [matchBreakdown, setMatchBreakdown] = useState<any>(null)
	const [loadingMatch, setLoadingMatch] = useState(false)
	const [reviewResult, setReviewResult] = useState<any>(null)
	const [reviewing, setReviewing] = useState(false)
	const [jobAssessment, setJobAssessment] = useState<{
		id: number
		title: string
		status: string
		question_count: number
	} | null>(null)
	const [saved, setSaved] = useState(false)
	const [profileCompleteness, setProfileCompleteness] = useState(0)
	const [tailoredDocs, setTailoredDocs] = useState<TailoredDocument | null>(null)
	const [generatingDocs, setGeneratingDocs] = useState(false)
	const [showDocs, setShowDocs] = useState(false)
	const [_similarJobs, _setSimilarJobs] = useState<Job[]>([])
	const [audioUrl, setAudioUrl] = useState<string | null>(null)
	const [audioLoading, setAudioLoading] = useState(false)
	const [isPlaying, setIsPlaying] = useState(false)
	const audioRef = useRef<HTMLAudioElement | null>(null)

	useEffect(() => {
		loadJob()
		if (user) {
			checkIfApplied()
			loadMatchBreakdown()
			loadJobAssessment()
			checkSaved()
			loadProfileCompleteness()
		}
	}, [
		user,
		loadJob,
		loadMatchBreakdown,
		loadProfileCompleteness,
		checkSaved,
		loadJobAssessment,
		checkIfApplied,
	])

	async function loadJob() {
		try {
			const data = await apiCall<{ job: Job }>(`/jobs/${id}`)
			setJob(data.job)
		} catch {
		} finally {
			setLoading(false)
		}
	}

	async function handleListen() {
		if (!job) return
		if (audioUrl && audioRef.current) {
			if (audioRef.current.paused) {
				audioRef.current.play().catch(() => {})
				setIsPlaying(true)
			} else {
				audioRef.current.pause()
				setIsPlaying(false)
			}
			return
		}
		setAudioLoading(true)
		try {
			const data = await apiCall<{ audioUrl: string }>(`/jobs/${job.id}/audio`, { method: 'POST' })
			if (data.audioUrl) {
				setAudioUrl(data.audioUrl)
				// Small delay to let React render the audio element
				setTimeout(() => {
					if (audioRef.current) {
						audioRef.current.play().catch(() => {})
						setIsPlaying(true)
					}
				}, 100)
			}
		} catch (err: unknown) {
			alert(err instanceof Error ? err.message : 'Failed to generate audio')
		} finally {
			setAudioLoading(false)
		}
	}

	function handleAudioEnded() {
		setIsPlaying(false)
	}

	async function checkSaved() {
		try {
			const data = await apiCall<{ saved_jobs: { job_id: number }[] }>('/candidate/saved-jobs')
			if (data.saved_jobs?.some((sj) => sj.job_id === Number(id))) setSaved(true)
		} catch {}
	}

	async function loadProfileCompleteness() {
		try {
			const data = await apiCall<{ profile: { completeness: number } }>('/candidate/profile')
			setProfileCompleteness(data.profile?.completeness || 0)
		} catch {}
	}

	async function toggleSave() {
		try {
			if (saved) {
				await apiCall(`/candidate/saved-jobs/${id}`, { method: 'DELETE' })
				setSaved(false)
			} else {
				await apiCall('/candidate/saved-jobs', { method: 'POST', body: { job_id: Number(id) } })
				setSaved(true)
			}
		} catch {}
	}

	async function loadJobAssessment() {
		try {
			const data = await apiCall<{ assessment: any }>(`/assessments/job/${id}`)
			if (data.assessment?.status === 'published') setJobAssessment(data.assessment)
		} catch {}
	}

	async function checkIfApplied() {
		try {
			const data = await apiCall<{ success: boolean; applications: { job_id: number }[] }>(
				'/candidate/applications',
			)
			if (data.applications?.some((a) => a.job_id === Number(id))) setApplied(true)
		} catch {}
	}

	async function loadMatchBreakdown() {
		if (!user || !id) return
		setLoadingMatch(true)
		try {
			const data = await apiCall<{ success: boolean; breakdown: any }>(
				`/memory/match-breakdown/${user.id}/${id}`,
			)
			if (data.breakdown) setMatchBreakdown(data.breakdown)
		} catch {
		} finally {
			setLoadingMatch(false)
		}
	}

	async function loadAutoFill() {
		if (!user || !id) return
		try {
			const data = await apiCall<{ success: boolean; auto_fill: AutoFillData }>(
				`/candidate/auto-fill/${id}`,
			)
			if (data.auto_fill) {
				setAutoFill(data.auto_fill)
				if (data.auto_fill.cover_letter && !coverLetter) setCoverLetter(data.auto_fill.cover_letter)
				const newAnswers: Record<string, string> = { ...screeningAnswers }
				const sources: Record<string, string> = {}
				for (const [qId, info] of Object.entries(data.auto_fill.screening_answers || {})) {
					if (!newAnswers[qId] && info.value) {
						newAnswers[qId] = info.value
						sources[qId] = info.source
					}
				}
				setScreeningAnswers(newAnswers)
				setAutoFillSources(sources)
			}
		} catch {}
	}

	useEffect(() => {
		if (showApplyForm && user) loadAutoFill()
	}, [showApplyForm, user, loadAutoFill])

	const screeningQuestions: ScreeningQuestion[] = (() => {
		if (!job?.screening_questions) return []
		try {
			const raw =
				typeof job.screening_questions === 'string'
					? JSON.parse(job.screening_questions)
					: job.screening_questions
			return Array.isArray(raw) ? raw : []
		} catch {
			return []
		}
	})()

	function validateForm(): boolean {
		const newErrors: Record<string, string> = {}
		screeningQuestions.forEach((q, i) => {
			const key = q.id || `q${i}`
			if (q.required && !screeningAnswers[key]?.trim()) newErrors[key] = 'This question is required'
		})
		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	async function handleApply() {
		if (!job) return
		if (!validateForm()) return
		setApplying(true)
		try {
			await apiCall(`/candidate/jobs/${job.id}/apply`, {
				method: 'POST',
				body: { cover_letter: coverLetter, screening_answers: screeningAnswers },
			})
			setApplied(true)
			setShowApplyForm(false)
			setShowOneClickModal(false)
		} catch (err: unknown) {
			alert(err instanceof Error ? err.message : 'Failed to apply')
		} finally {
			setApplying(false)
		}
	}

	async function handleOneClickApply() {
		if (!job) return
		setShowOneClickModal(true)
		setGeneratingDocs(true)
		try {
			const data = await apiCall<{ success: boolean; tailored: TailoredDocument }>(
				'/candidate/ai/one-click-apply',
				{
					method: 'POST',
					body: { job_id: job.id },
				},
			)
			if (data.tailored) {
				setTailoredDocs(data.tailored)
				setCoverLetter(data.tailored.cover_letter)
			}
		} catch {
			setTailoredDocs(null)
		} finally {
			setGeneratingDocs(false)
		}
	}

	async function generateCoverLetter() {
		if (!job) return
		setGeneratingCL(true)
		try {
			const data = await apiCall<{ success: boolean; cover_letter: string }>(
				'/candidate/ai/cover-letter',
				{
					method: 'POST',
					body: { job_id: job.id },
				},
			)
			if (data.cover_letter) setCoverLetter(data.cover_letter)
		} catch (_err: unknown) {
			alert('AI generation failed. Try again.')
		} finally {
			setGeneratingCL(false)
		}
	}

	async function getSuggestions() {
		if (!job || screeningQuestions.length === 0) return
		setGeneratingSuggestions(true)
		try {
			const data = await apiCall<{
				success: boolean
				suggestions: Array<{
					question_id: string
					suggested_answer: string
					source: string
					confidence: string
				}>
			}>('/candidate/ai/screening-suggestions', {
				method: 'POST',
				body: { job_id: job.id, questions: screeningQuestions },
			})
			if (data.suggestions?.length) {
				const newAnswers = { ...screeningAnswers }
				const sources = { ...autoFillSources }
				for (const s of data.suggestions) {
					const key = s.question_id || screeningQuestions.find((q) => q.id === s.question_id)?.id
					if (key && !newAnswers[key]) {
						newAnswers[key] = s.suggested_answer
						sources[key] = `ai_${s.confidence}`
					}
				}
				setScreeningAnswers(newAnswers)
				setAutoFillSources(sources)
			}
		} catch {
		} finally {
			setGeneratingSuggestions(false)
		}
	}

	function updateAnswer(key: string, value: string) {
		setScreeningAnswers((prev) => ({ ...prev, [key]: value }))
		setAutoFillSources((prev) => {
			const n = { ...prev }
			delete n[key]
			return n
		})
		if (errors[key])
			setErrors((prev) => {
				const n = { ...prev }
				delete n[key]
				return n
			})
	}

	function sourceLabel(source: string) {
		if (source === 'previous_application') return 'From previous application'
		if (source === 'similar_question') return 'From similar question'
		if (source === 'profile') return 'From your profile'
		if (source.startsWith('ai_')) return '✨ AI suggestion'
		return null
	}

	function renderScreeningInput(q: ScreeningQuestion, index: number) {
		const key = q.id || `q${index}`
		const value = screeningAnswers[key] || ''
		const error = errors[key]
		const source = autoFillSources[key]
		const type = q.type || 'text'

		return (
			<div className='space-y-1'>
				{source && (
					<Badge variant='outline' className='text-xs mb-1 gap-1'>
						{source.startsWith('ai_') ? (
							<Sparkles className='h-3 w-3' />
						) : (
							<Zap className='h-3 w-3' />
						)}
						{sourceLabel(source)}
					</Badge>
				)}
				{type === 'yes_no' ? (
					<div className='flex gap-2 mt-1'>
						<Button
							type='button'
							variant={value === 'Yes' ? 'default' : 'outline'}
							size='sm'
							onClick={() => updateAnswer(key, 'Yes')}
							className='flex-1'
						>
							Yes
						</Button>
						<Button
							type='button'
							variant={value === 'No' ? 'default' : 'outline'}
							size='sm'
							onClick={() => updateAnswer(key, 'No')}
							className='flex-1'
						>
							No
						</Button>
					</div>
				) : type === 'select' && q.options?.length ? (
					<Select
						value={value}
						onChange={(e) => updateAnswer(key, e.target.value)}
						className='mt-1'
					>
						<option value=''>Select an option...</option>
						{q.options.map((opt) => (
							<option key={opt} value={opt}>
								{opt}
							</option>
						))}
					</Select>
				) : (
					<Input
						value={value}
						onChange={(e) => updateAnswer(key, e.target.value)}
						className='mt-1'
						placeholder={q.placeholder || 'Your answer...'}
					/>
				)}
				{error && (
					<p className='text-xs text-destructive flex items-center gap-1'>
						<AlertCircle className='h-3 w-3' />
						{error}
					</p>
				)}
			</div>
		)
	}

	function timeAgo(dateStr: string) {
		const diff = Date.now() - new Date(dateStr).getTime()
		const days = Math.floor(diff / 86400000)
		if (days === 0) return 'Today'
		if (days === 1) return '1 day ago'
		if (days < 30) return `${days} days ago`
		return `${Math.floor(days / 30)} months ago`
	}

	const score = matchBreakdown?.overall_score ? Math.round(matchBreakdown.overall_score) : null
	const canOneClick = profileCompleteness >= 80
	const skillsRequired = job?.skills_required || []
	const matchingSkills = matchBreakdown?.dimensions?.skills?.matching || []
	const missingSkills = matchBreakdown?.dimensions?.skills?.missing || []

	if (loading)
		return (
			<div className='space-y-6'>
				<div className='flex items-center gap-2'>
					<div className='h-8 w-8 rounded bg-muted animate-pulse' />
					<div className='h-6 w-40 rounded bg-muted animate-pulse' />
				</div>
				<Skeleton variant='card' />
				<Skeleton variant='card' />
			</div>
		)
	if (!job)
		return (
			<div className='py-16 text-center'>
				<Briefcase className='mx-auto mb-3 h-10 w-10 opacity-30' />
				<p className='text-muted-foreground'>Job not found</p>
				<Button variant='ghost' className='mt-4' onClick={() => navigate('/candidate/jobs')}>
					Back to jobs
				</Button>
			</div>
		)

	return (
		<div className='space-y-6 max-w-3xl mx-auto px-2 sm:px-0'>
			{audioUrl && (
				<audio
					ref={audioRef}
					src={audioUrl}
					onEnded={handleAudioEnded}
					onPause={() => setIsPlaying(false)}
					onPlay={() => setIsPlaying(true)}
					className='hidden'
				/>
			)}
			<Button
				variant='ghost'
				size='sm'
				onClick={() => navigate('/candidate/jobs')}
				className='gap-1 min-h-[44px]'
			>
				<ArrowLeft className='h-4 w-4' /> Back to jobs
			</Button>

			{/* Job header */}
			<Card>
				<CardContent className='p-4 sm:p-6'>
					<div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
						<div className='flex items-start gap-4'>
							<Avatar
								src={job.company_logo}
								fallback={(job.company || job.poster_company || 'C').charAt(0)}
								size='lg'
								className='h-14 w-14'
							/>
							<div>
								<h1 className='font-heading text-xl sm:text-2xl font-bold mb-2 break-words'>
									{job.title}
								</h1>
								<div className='flex flex-wrap items-center gap-3 text-sm text-muted-foreground'>
									<span className='flex items-center gap-1 min-w-0'>
										<Building2 className='h-4 w-4 shrink-0' />
										<span className='break-words'>
											{job.company || job.poster_company || 'Company'}
										</span>
									</span>
									{job.location && (
										<span className='flex items-center gap-1 min-w-0'>
											<MapPin className='h-4 w-4 shrink-0' />
											<span className='break-words'>{job.location}</span>
										</span>
									)}
									{job.salary_range && (
										<span className='flex items-center gap-1 min-w-0'>
											<DollarSign className='h-4 w-4 shrink-0' />
											<span className='break-words'>{job.salary_range}</span>
										</span>
									)}
									{job.job_type && <Badge variant='secondary'>{job.job_type}</Badge>}
									{job.remote_type && (
										<Badge variant='outline'>
											<Globe className='h-3 w-3 mr-0.5' />
											{job.remote_type}
										</Badge>
									)}
									<span className='flex items-center gap-1 text-xs'>
										<Clock className='h-3 w-3' />
										Posted {timeAgo(job.created_at)}
									</span>
									{job.applicants_count != null && (
										<span className='flex items-center gap-1 text-xs'>
											<Eye className='h-3 w-3' />
											{job.applicants_count} applicants
										</span>
									)}
								</div>
							</div>
						</div>
						<div className='flex flex-wrap items-center gap-2 shrink-0'>
							<button
								onClick={toggleSave}
								className='p-2 rounded-lg hover:bg-muted transition-colors min-h-[44px] min-w-[44px] inline-flex items-center justify-center'
								aria-label={saved ? 'Unsave' : 'Save'}
							>
								{saved ? (
									<Bookmark className='h-5 w-5 text-amber-500 fill-amber-500' />
								) : (
									<BookmarkPlus className='h-5 w-5 text-muted-foreground' />
								)}
							</button>
							<Button
								variant='outline'
								size='sm'
								onClick={handleListen}
								disabled={audioLoading}
								className='gap-1.5 min-h-[44px]'
								aria-label={isPlaying ? 'Pause narration' : 'Listen to job description'}
							>
								{audioLoading ? (
									<Loader2 className='h-4 w-4 animate-spin' />
								) : isPlaying ? (
									<Volume2 className='h-4 w-4 text-primary' />
								) : (
									<Volume2 className='h-4 w-4' />
								)}
								{audioLoading ? 'Generating...' : isPlaying ? 'Playing...' : 'Listen'}
							</Button>
							{applied ? (
								<Badge variant='success' className='gap-1 text-sm py-1.5 px-3'>
									<CheckCircle className='h-3.5 w-3.5' /> Applied
								</Badge>
							) : user ? (
								<Button
									onClick={() => setShowApplyForm(!showApplyForm)}
									className='gap-2 min-h-[44px]'
								>
									<Send className='h-4 w-4' /> Apply Now
								</Button>
							) : (
								<Button onClick={() => navigate('/login')} className='gap-2 min-h-[44px]'>
									Sign in to Apply
								</Button>
							)}
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Profile completeness banner for new users */}
			{user && !applied && profileCompleteness < 80 && (
				<Card className='border-amber-200 bg-amber-50/50'>
					<CardContent className='p-4'>
						<div className='flex items-start gap-3'>
							<AlertCircle className='h-5 w-5 text-amber-600 mt-0.5 shrink-0' />
							<div className='flex-1'>
								<p className='font-semibold text-sm text-amber-900'>
									Complete your profile for better matches
								</p>
								<p className='text-sm text-amber-700 mt-0.5'>
									Your profile is {profileCompleteness}% complete. A complete profile boosts your
									match score by up to 30%.
								</p>
								<div className='mt-2'>
									<Progress value={profileCompleteness} className='h-2' />
								</div>
								<Button
									variant='outline'
									size='sm'
									className='mt-2 gap-1 min-h-[44px]'
									onClick={() => navigate('/candidate/profile')}
								>
									<Pencil className='h-3 w-3' /> Complete Profile
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Job Assessment */}
			{jobAssessment && applied && (
				<Card className='border-violet-200 bg-gradient-to-r from-violet-50/50 to-indigo-50/50'>
					<CardContent className='py-4 flex flex-col sm:flex-row sm:items-center gap-4'>
						<div className='w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center shrink-0'>
							<GraduationCap className='h-5 w-5 text-violet-600' />
						</div>
						<div className='flex-1 min-w-0'>
							<p className='font-medium text-sm'>{jobAssessment.title}</p>
							<p className='text-xs text-muted-foreground'>
								{jobAssessment.question_count} questions · AI-scored · Adaptive difficulty
							</p>
						</div>
						<Button
							onClick={() => navigate(`/candidate/job-assessment/${jobAssessment.id}`)}
							className='gap-1.5 shrink-0 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white min-h-[44px]'
							size='sm'
						>
							<Sparkles className='h-3.5 w-3.5' /> Take Assessment
						</Button>
					</CardContent>
				</Card>
			)}

			{/* Match Breakdown */}
			{user && matchBreakdown && score != null && score > 0 && (
				<Card className='border-primary/20'>
					<CardHeader className='pb-3'>
						<CardTitle className='flex flex-wrap items-center gap-2 text-base'>
							<BarChart3 className='h-5 w-5 text-primary' /> Why This Job Matches You
							<Badge
								variant={score >= 80 ? 'default' : score >= 60 ? 'secondary' : 'outline'}
								className='text-sm shrink-0'
							>
								{score}% Match
							</Badge>
						</CardTitle>
					</CardHeader>
					<CardContent className='space-y-4'>
						<div className='space-y-3'>
							{Object.entries(matchBreakdown.dimensions || {}).map(([key, dim]: [string, any]) => {
								if (dim.available === false && !dim.score) return null
								const s = dim.score || 0
								const barColor =
									s >= 80
										? 'bg-green-500'
										: s >= 60
											? 'bg-amber-500'
											: s >= 40
												? 'bg-orange-400'
												: 'bg-red-400'
								const icon =
									key === 'skills' ? (
										<Briefcase className='h-3.5 w-3.5' />
									) : key === 'experience' ? (
										<TrendingUp className='h-3.5 w-3.5' />
									) : key === 'education' ? (
										<GraduationCap className='h-3.5 w-3.5' />
									) : key === 'salary_fit' ? (
										<DollarSign className='h-3.5 w-3.5' />
									) : key === 'location' ? (
										<MapPin className='h-3.5 w-3.5' />
									) : key === 'interview_performance' ? (
										<Brain className='h-3.5 w-3.5' />
									) : (
										<Shield className='h-3.5 w-3.5' />
									)
								return (
									<div key={key}>
										<div className='flex items-center justify-between mb-1'>
											<span className='text-sm font-medium flex items-center gap-1.5 min-w-0'>
												<span className='shrink-0'>{icon}</span>
												<span className='break-words'>{dim.label}</span>
											</span>
											<span className='text-sm font-bold shrink-0'>{s}%</span>
										</div>
										<div className='h-2 rounded-full bg-muted overflow-hidden'>
											<div
												className={`h-full rounded-full transition-all ${barColor}`}
												style={{ width: `${Math.min(100, s)}%` }}
											/>
										</div>
										{dim.detail && (
											<p className='text-[11px] text-muted-foreground mt-0.5'>{dim.detail}</p>
										)}
									</div>
								)
							})}
						</div>
						{matchingSkills.length > 0 && (
							<div className='pt-3 border-t space-y-2'>
								<div className='flex flex-wrap items-center gap-1'>
									<CheckCircle className='h-3 w-3 text-green-500 shrink-0' />
									<span className='text-xs text-muted-foreground mr-1'>Matching skills:</span>
									{matchingSkills.map((s: string) => (
										<span
											key={s}
											className='text-[10px] bg-green-50 text-green-700 rounded px-1.5 py-0.5 border border-green-100'
										>
											{s}
										</span>
									))}
								</div>
								{missingSkills.length > 0 && (
									<div className='flex flex-wrap items-center gap-1'>
										<AlertCircle className='h-3 w-3 text-amber-500 shrink-0' />
										<span className='text-xs text-muted-foreground mr-1'>To improve:</span>
										{missingSkills.slice(0, 5).map((s: string) => (
											<span
												key={s}
												className='text-[10px] bg-amber-50 text-amber-700 rounded px-1.5 py-0.5 border border-amber-100'
											>
												{s}
											</span>
										))}
									</div>
								)}
							</div>
						)}
						{matchBreakdown.improvement_tips?.length > 0 && (
							<div className='pt-3 border-t'>
								<p className='text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1'>
									<Sparkles className='h-3 w-3' /> Improve your match
								</p>
								<div className='space-y-1'>
									{matchBreakdown.improvement_tips.slice(0, 3).map((tip: any, i: number) => (
										<p key={s} className='text-xs text-muted-foreground'>
											• {tip.tip}
										</p>
									))}
								</div>
							</div>
						)}
					</CardContent>
				</Card>
			)}

			{user && loadingMatch && (
				<Card className='border-primary/20'>
					<CardContent className='py-8 text-center'>
						<div className='h-6 w-6 mx-auto animate-spin rounded-full border-2 border-primary border-t-transparent mb-2' />
						<p className='text-xs text-muted-foreground'>Analyzing match...</p>
					</CardContent>
				</Card>
			)}

			{/* One-Click Apply Modal */}
			{showOneClickModal && !applied && (
				<div className='fixed inset-0 z-50 flex items-end sm:items-center justify-center'>
					<div className='fixed inset-0 bg-black/50' onClick={() => setShowOneClickModal(false)} />
					<div className='relative z-50 w-full max-w-2xl max-h-[90vh] overflow-y-auto border bg-background p-4 sm:p-6 shadow-lg rounded-t-2xl sm:rounded-lg'>
						<button
							onClick={() => setShowOneClickModal(false)}
							className='absolute right-4 top-4 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md p-2 hover:bg-muted transition-colors'
						>
							<X className='h-4 w-4' />
						</button>
						<div className='space-y-5'>
							<div className='flex items-center gap-3'>
								<div className='h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center'>
									<Zap className='h-5 w-5 text-primary' />
								</div>
								<div className='min-w-0'>
									<h2 className='text-lg font-bold break-words'>One-Click Apply</h2>
									<p className='text-sm text-muted-foreground break-words'>
										AI-tailored application for <span className='break-words'>{job.title}</span>
									</p>
								</div>
							</div>

							{generatingDocs ? (
								<div className='text-center py-8'>
									<div className='h-8 w-8 mx-auto animate-spin rounded-full border-2 border-primary border-t-transparent mb-3' />
									<p className='text-sm text-muted-foreground'>
										AI is generating your tailored application...
									</p>
									<p className='text-xs text-muted-foreground mt-1'>
										Creating custom resume and cover letter based on your profile
									</p>
								</div>
							) : tailoredDocs ? (
								<div className='space-y-4'>
									{/* AI Match Summary */}
									<div className='rounded-lg bg-green-50 border border-green-200 p-4'>
										<div className='flex items-center gap-2 mb-2'>
											<Target className='h-4 w-4 text-green-600' />
											<span className='font-semibold text-sm text-green-800'>
												AI Match Analysis
											</span>
										</div>
										<p className='text-sm text-green-700'>{tailoredDocs.match_summary}</p>
										<div className='flex flex-wrap gap-1.5 mt-2'>
											{tailoredDocs.key_strengths.map((s, i) => (
												<Badge
													key={s}
													variant='outline'
													className='text-[10px] bg-white border-green-200 text-green-700'
												>
													{s}
												</Badge>
											))}
										</div>
									</div>

									{/* Why you're a good fit */}
									<div>
										<p className='font-semibold text-sm mb-2'>Why You're a Great Fit</p>
										<p className='text-sm text-muted-foreground'>{tailoredDocs.why_fit}</p>
									</div>

									{/* Document previews toggle */}
									<div className='flex items-center gap-2'>
										<Button
											variant='outline'
											size='sm'
											className='gap-1 min-h-[44px]'
											onClick={() => setShowDocs(!showDocs)}
										>
											<FileText className='h-3.5 w-3.5' /> {showDocs ? 'Hide' : 'Preview'} Tailored
											Documents
										</Button>
									</div>

									{showDocs && (
										<div className='space-y-3'>
											<div className='rounded-lg border p-3'>
												<p className='text-xs font-semibold text-muted-foreground mb-1'>
													Tailored Resume Preview
												</p>
												<div className='text-sm text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto'>
													{tailoredDocs.resume}
												</div>
											</div>
											<div className='rounded-lg border p-3'>
												<p className='text-xs font-semibold text-muted-foreground mb-1'>
													Tailored Cover Letter Preview
												</p>
												<div className='text-sm text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto'>
													{tailoredDocs.cover_letter}
												</div>
											</div>
										</div>
									)}

									{/* Screening questions if any */}
									{screeningQuestions.length > 0 && (
										<div className='space-y-3'>
											<p className='font-semibold text-sm'>Pre-screening Questions</p>
											{screeningQuestions.map((q, i) => (
												<div key={q.id || i} className='rounded-lg border p-3 space-y-1'>
													<Label className='text-sm font-medium'>
														{q.question || ''}
														{q.required && <span className='text-destructive ml-1'>*</span>}
													</Label>
													{renderScreeningInput(q, i)}
												</div>
											))}
										</div>
									)}

									<div className='flex flex-col sm:flex-row gap-2 pt-2'>
										<Button
											onClick={handleApply}
											disabled={applying}
											className='flex-1 gap-2 min-h-[44px]'
										>
											{applying ? (
												<div className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
											) : (
												<Send className='h-4 w-4' />
											)}
											Submit with AI-Tailored Documents
										</Button>
										<Button
											variant='outline'
											onClick={() => setShowOneClickModal(false)}
											className='min-h-[44px]'
										>
											Review Later
										</Button>
									</div>
								</div>
							) : (
								<div className='text-center py-4'>
									<p className='text-sm text-muted-foreground'>
										Could not generate tailored documents. You can still apply manually.
									</p>
									<Button className='mt-2 min-h-[44px]' onClick={() => setShowApplyForm(true)}>
										Apply Manually
									</Button>
								</div>
							)}
						</div>
					</div>
				</div>
			)}

			{/* Standard Apply Form */}
			{showApplyForm && !applied && !showOneClickModal && (
				<Card className='border-primary/30 shadow-lg'>
					<CardHeader>
						<CardTitle className='flex flex-wrap items-center gap-2'>
							<Send className='h-5 w-5 shrink-0' />
							Apply for <span className='break-words'>{job.title}</span>
						</CardTitle>
					</CardHeader>
					<CardContent className='space-y-5'>
						{autoFill && Object.keys(autoFillSources).length > 0 && (
							<div className='rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800 flex items-start gap-2'>
								<Zap className='h-4 w-4 shrink-0' />
								Some fields were auto-filled from your profile and past applications. Review and
								update as needed.
							</div>
						)}
						<div>
							<div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-1'>
								<Label>
									Cover Letter <span className='text-muted-foreground text-xs'>(optional)</span>
								</Label>
								<Button
									variant='outline'
									size='sm'
									onClick={generateCoverLetter}
									disabled={generatingCL}
									className='gap-1 text-xs min-h-[44px]'
								>
									{generatingCL ? (
										<Loader2 className='h-3 w-3 animate-spin' />
									) : (
										<Sparkles className='h-3 w-3' />
									)}
									{generatingCL ? 'Generating...' : '✨ Generate with AI'}
								</Button>
							</div>
							<Textarea
								placeholder="Tell the employer why you're a great fit..."
								value={coverLetter}
								onChange={(e) => setCoverLetter(e.target.value)}
								rows={6}
								className='mt-1'
							/>
							{coverLetter && autoFill?.cover_letter && coverLetter === autoFill.cover_letter && (
								<p className='text-xs text-muted-foreground mt-1 flex items-center gap-1'>
									<Zap className='h-3 w-3' /> From your last application — personalize it for this
									role
								</p>
							)}
						</div>
						{screeningQuestions.length > 0 && (
							<div className='space-y-4'>
								<div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2'>
									<div className='flex items-center gap-2'>
										<ListChecks className='h-4 w-4 text-primary' />
										<h4 className='font-medium text-sm'>Pre-screening Questions</h4>
									</div>
									<Button
										variant='outline'
										size='sm'
										onClick={getSuggestions}
										disabled={generatingSuggestions}
										className='gap-1 text-xs min-h-[44px]'
									>
										{generatingSuggestions ? (
											<Loader2 className='h-3 w-3 animate-spin' />
										) : (
											<Wand2 className='h-3 w-3' />
										)}
										{generatingSuggestions ? 'Suggesting...' : '✨ AI Suggest Answers'}
									</Button>
								</div>
								{screeningQuestions.map((q, i) => (
									<div key={q.id || i} className='rounded-lg border p-3 sm:p-4 space-y-1'>
										<Label className='text-sm font-medium'>
											{q.question || ''}
											{q.required && <span className='text-destructive ml-1'>*</span>}
										</Label>
										{q.category && (
											<p className='text-xs text-muted-foreground capitalize'>
												{q.category.replace(/_/g, ' ')}
											</p>
										)}
										{renderScreeningInput(q, i)}
									</div>
								))}
							</div>
						)}
						{reviewResult && (
							<div
								className={`rounded-lg border p-4 space-y-3 ${reviewResult.ready_to_submit ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}
							>
								<div className='flex flex-wrap items-center gap-2'>
									{reviewResult.ready_to_submit ? (
										<CheckCircle className='h-4 w-4 text-green-600 shrink-0' />
									) : (
										<AlertCircle className='h-4 w-4 text-amber-600 shrink-0' />
									)}
									<span className='font-medium text-sm break-words'>
										{reviewResult.ready_to_submit
											? 'Application looks great!'
											: 'Some improvements suggested'}
									</span>
									<Badge variant='outline' className='shrink-0'>
										{reviewResult.completeness_score || 0}% complete
									</Badge>
								</div>
								{reviewResult.strengths?.length > 0 && (
									<div className='space-y-0.5'>
										{reviewResult.strengths.slice(0, 2).map((s: string, i: number) => (
											<p key={s} className='text-xs text-green-700 flex items-center gap-1'>
												<CheckCircle className='h-3 w-3 shrink-0' />
												{s}
											</p>
										))}
									</div>
								)}
								{reviewResult.issues?.filter(
									(i: any) => i.severity === 'critical' || i.severity === 'warning',
								).length > 0 && (
									<div className='space-y-0.5'>
										{reviewResult.issues
											.filter((i: any) => i.severity !== 'tip')
											.slice(0, 3)
											.map((issue: any, i: number) => (
												<p key={s} className='text-xs text-amber-700 flex items-center gap-1'>
													<AlertCircle className='h-3 w-3 shrink-0' />
													{issue.message}
													{issue.fix && <span className='text-amber-600'> — {issue.fix}</span>}
												</p>
											))}
									</div>
								)}
							</div>
						)}
						<div className='flex flex-col sm:flex-row gap-2 pt-2 border-t'>
							<Button onClick={handleApply} disabled={applying} className='gap-2 min-h-[44px]'>
								{applying ? (
									<div className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
								) : (
									<Send className='h-4 w-4' />
								)}
								Submit Application
							</Button>
							{canOneClick && (
								<Button
									variant='outline'
									onClick={handleOneClickApply}
									className='gap-2 border-primary/30 text-primary min-h-[44px]'
								>
									<Zap className='h-4 w-4' /> One-Click Apply
								</Button>
							)}
							<Button
								variant='outline'
								onClick={async () => {
									if (!job) return
									setReviewing(true)
									try {
										const data = await apiCall<{ success: boolean; review: any }>(
											'/candidate/ai/application-review',
											{
												method: 'POST',
												body: {
													job_id: job.id,
													cover_letter: coverLetter,
													screening_answers: screeningAnswers,
												},
											},
										)
										if (data.review) setReviewResult(data.review)
									} catch {
									} finally {
										setReviewing(false)
									}
								}}
								disabled={reviewing}
								className='gap-1.5 min-h-[44px]'
							>
								{reviewing ? (
									<Loader2 className='h-4 w-4 animate-spin' />
								) : (
									<Sparkles className='h-4 w-4' />
								)}
								{reviewing ? 'Reviewing...' : 'AI Review'}
							</Button>
							<Button
								variant='outline'
								onClick={() => setShowApplyForm(false)}
								className='min-h-[44px]'
							>
								Cancel
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Description */}
			<Card>
				<CardHeader>
					<CardTitle className='flex items-center gap-2'>
						<Briefcase className='h-5 w-5' /> Job Description
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className='prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed break-words overflow-x-hidden px-1'>
						{job.description || 'No description provided.'}
					</div>
				</CardContent>
			</Card>

			{/* Requirements */}
			{job.requirements && (
				<Card>
					<CardHeader>
						<CardTitle className='flex items-center gap-2'>
							<FileText className='h-5 w-5' /> Requirements
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className='prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed break-words overflow-x-hidden px-1'>
							{job.requirements}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Skills Required */}
			{skillsRequired.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className='flex items-center gap-2'>
							<BookOpen className='h-5 w-5' /> Required Skills
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className='flex flex-wrap gap-1.5'>
							{skillsRequired.map((skill) => (
								<Badge
									key={skill}
									variant={matchingSkills.includes(skill) ? 'default' : 'outline'}
									className={
										matchingSkills.includes(skill)
											? 'bg-green-100 text-green-700 border-green-200'
											: ''
									}
								>
									{matchingSkills.includes(skill) && <CheckCircle className='h-3 w-3 mr-1' />}
									{skill}
								</Badge>
							))}
						</div>
					</CardContent>
				</Card>
			)}

			{screeningQuestions.length > 0 && !showApplyForm && !applied && (
				<div className='rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground flex items-center gap-2'>
					<ListChecks className='h-4 w-4 shrink-0' />
					This job has {screeningQuestions.length} pre-screening question
					{screeningQuestions.length > 1 ? 's' : ''} you'll need to answer when applying.
				</div>
			)}
		</div>
	)
}
