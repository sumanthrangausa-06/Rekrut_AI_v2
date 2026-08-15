import { useCallback, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { apiCall } from '@/lib/api'
import {
	Target,
	ArrowRight,
	CheckCircle,
	Sparkles,
	TrendingUp,
	Briefcase,
	Lightbulb,
	ArrowLeft,
	RotateCcw,
	Award,
	Star,
} from 'lucide-react'

interface QuizQuestion {
	id: number
	question: string
	options: string[]
}

interface CareerPath {
	path_name: string
	fit_score: number
	description: string
	time_to_achievable: string
	required_skills: string[]
	skills_to_develop: string[]
}

interface RecommendedRole {
	title: string
	why_fits: string
	salary_range: string
}

interface ActionPhase {
	phase: string
	actions: string[]
	timeline: string
}

interface CareerArchetype {
	name: string
	description: string
}

interface CareerDiagnosisResult {
	careerArchetype: CareerArchetype
	recommendedPaths: CareerPath[]
	strengths: string[]
	growthAreas: string[]
	recommendedRoles: RecommendedRole[]
	actionPlan: ActionPhase[]
	summary: string
}

const QUIZ_QUESTIONS: QuizQuestion[] = [
	{
		id: 1,
		question: 'How do you prefer to solve problems?',
		options: [
			'Analyze data and find patterns',
			'Collaborate with a team to brainstorm',
			'Build something tangible from scratch',
			'Teach or guide others through it',
		],
	},
	{
		id: 2,
		question: 'Which work environment excites you most?',
		options: [
			'A fast-paced startup with rapid changes',
			'A stable corporate with clear processes',
			'A creative studio with design freedom',
			'A research lab exploring new ideas',
		],
	},
	{
		id: 3,
		question: 'When facing a tight deadline, you typically:',
		options: [
			'Break it into tasks and delegate efficiently',
			'Dive deep and work intensely alone',
			'Prioritize the most impactful parts first',
			'Rally the team and motivate everyone',
		],
	},
	{
		id: 4,
		question: 'What motivates you most in your career?',
		options: [
			'Climbing the leadership ladder',
			'Mastering a specialized craft',
			'Making a positive social impact',
			'Building and owning something of my own',
		],
	},
	{
		id: 5,
		question: 'How do you handle ambiguity and uncertainty?',
		options: [
			'I create structure and define clear goals',
			'I explore multiple paths and experiment',
			'I seek advice from mentors and peers',
			'I trust my instincts and act decisively',
		],
	},
	{
		id: 6,
		question: 'Which skill would you most like to develop?',
		options: [
			'Strategic thinking and decision-making',
			'Deep technical or creative expertise',
			'Communication and public speaking',
			'Entrepreneurship and business acumen',
		],
	},
	{
		id: 7,
		question: 'In a group project, what role do you naturally take?',
		options: [
			'The project manager who keeps everything on track',
			'The specialist who delivers the core work',
			'The connector who brings people together',
			'The visionary who defines the direction',
		],
	},
	{
		id: 8,
		question: 'How do you prefer to measure your success?',
		options: [
			'By the results and outcomes I deliver',
			'By the quality and craftsmanship of my work',
			'By the relationships and trust I build',
			'By the growth and learning I achieve',
		],
	},
	{
		id: 9,
		question: 'What is your ideal work-life balance?',
		options: [
			'I am driven and do not mind long hours for big goals',
			'I value flexibility and remote work options',
			'I prefer a predictable 9-to-5 routine',
			'I want work that blends with my personal passions',
		],
	},
	{
		id: 10,
		question: 'If you could switch careers instantly, you would choose:',
		options: [
			'A C-suite executive or founder',
			'A renowned expert or master craftsman',
			'A community leader or educator',
			'A creative director or product visionary',
		],
	},
]

export function CareerDiagnosisPage() {
	const [step, setStep] = useState<'intro' | 'quiz' | 'result'>('intro')
	const [currentQ, setCurrentQ] = useState(0)
	const [answers, setAnswers] = useState<{ question: string; answer: string }[]>([])
	const [result, setResult] = useState<CareerDiagnosisResult | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const handleAnswer = useCallback(
		(answer: string) => {
			const newAnswers = [...answers, { question: QUIZ_QUESTIONS[currentQ].question, answer }]
			setAnswers(newAnswers)

			if (currentQ + 1 < QUIZ_QUESTIONS.length) {
				setCurrentQ(currentQ + 1)
			} else {
				// Submit
				setLoading(true)
				setError(null)
				apiCall<CareerDiagnosisResult & { success: boolean; error?: string }>(
					'/profile-enhancement/career-diagnosis',
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ answers: newAnswers }),
					},
				)
					.then((res) => {
						if (res.success) {
							setResult(res)
							setStep('result')
						} else {
							setError(res.error || 'Diagnosis failed. Please try again.')
						}
					})
					.catch((err: any) => {
						console.error('Career diagnosis error:', err)
						setError(err?.message || 'Failed to generate diagnosis.')
					})
					.finally(() => setLoading(false))
			}
		},
		[currentQ, answers],
	)

	const handleBack = useCallback(() => {
		if (currentQ > 0) {
			setCurrentQ(currentQ - 1)
			setAnswers(answers.slice(0, -1))
		}
	}, [currentQ, answers])

	const handleRestart = useCallback(() => {
		setStep('intro')
		setCurrentQ(0)
		setAnswers([])
		setResult(null)
		setError(null)
	}, [])

	const progress = ((currentQ) / QUIZ_QUESTIONS.length) * 100

	if (step === 'intro') {
		return (
			<div className='space-y-6 px-4 sm:px-6'>
				<div className='flex items-center gap-3'>
					<div className='p-2 rounded-lg bg-primary/10'>
						<Target className='h-5 w-5 text-primary' />
					</div>
					<div>
						<h1 className='text-2xl font-heading font-bold'>Career Diagnosis</h1>
						<p className='text-muted-foreground text-sm'>
							Answer 10 questions to discover your career archetype and personalized path
						</p>
					</div>
				</div>

				<Card>
					<CardContent className='p-6 space-y-4'>
						<div className='flex items-center gap-3'>
							<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100'>
								<Sparkles className='h-5 w-5 text-violet-600' />
							</div>
							<div>
								<h2 className='font-medium'>What to expect</h2>
								<p className='text-xs text-muted-foreground'>
									AI-generated career archetype, recommended paths, roles, and action plan
								</p>
							</div>
						</div>

						<div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
							<div className='flex items-center gap-2 rounded-lg bg-muted p-3'>
								<Award className='h-4 w-4 text-amber-600 shrink-0' />
								<div>
									<p className='text-xs font-medium'>Career Archetype</p>
									<p className='text-[10px] text-muted-foreground'>Discover your profile</p>
								</div>
							</div>
							<div className='flex items-center gap-2 rounded-lg bg-muted p-3'>
								<TrendingUp className='h-4 w-4 text-emerald-600 shrink-0' />
								<div>
									<p className='text-xs font-medium'>Recommended Paths</p>
									<p className='text-[10px] text-muted-foreground'>Tailored career options</p>
								</div>
							</div>
							<div className='flex items-center gap-2 rounded-lg bg-muted p-3'>
								<Lightbulb className='h-4 w-4 text-primary shrink-0' />
								<div>
									<p className='text-xs font-medium'>Action Plan</p>
									<p className='text-[10px] text-muted-foreground'>Step-by-step roadmap</p>
								</div>
							</div>
						</div>

						<Button onClick={() => setStep('quiz')} className='w-full gap-2'>
							Start Assessment
							<ArrowRight className='h-4 w-4' />
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	if (step === 'quiz') {
		const question = QUIZ_QUESTIONS[currentQ]
		return (
			<div className='space-y-6 px-4 sm:px-6 max-w-2xl mx-auto'>
				{/* Header */}
				<div className='flex items-center gap-3'>
					<div className='p-2 rounded-lg bg-primary/10'>
						<Target className='h-5 w-5 text-primary' />
					</div>
					<div>
						<h1 className='text-2xl font-heading font-bold'>Career Diagnosis</h1>
						<p className='text-muted-foreground text-sm'>
							Question {currentQ + 1} of {QUIZ_QUESTIONS.length}
						</p>
					</div>
				</div>

				{/* Progress */}
				<div className='space-y-1'>
					<div className='flex justify-between text-xs text-muted-foreground'>
						<span>Progress</span>
						<span>{Math.round(progress)}%</span>
					</div>
					<Progress value={progress} className='h-2' />
				</div>

				{/* Question Card */}
				<Card>
					<CardHeader className='pb-3'>
						<CardTitle className='text-base leading-relaxed'>
							{question.question}
						</CardTitle>
					</CardHeader>
					<CardContent className='space-y-2'>
						{question.options.map((option, i) => (
							<Button
								key={i}
								variant='outline'
								className='w-full justify-start text-left h-auto py-3 px-4 font-normal hover:bg-primary/5 hover:border-primary/30'
								onClick={() => handleAnswer(option)}
								disabled={loading}
							>
								<span className='inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium mr-3 shrink-0'>
									{String.fromCharCode(65 + i)}
								</span>
								<span className='text-sm'>{option}</span>
							</Button>
						))}
					</CardContent>
				</Card>

				{/* Back button */}
				{currentQ > 0 && (
					<Button variant='ghost' onClick={handleBack} className='gap-2' disabled={loading}>
						<ArrowLeft className='h-4 w-4' />
						Back
					</Button>
				)}

				{loading && (
					<div className='flex items-center justify-center py-8'>
						<div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary' />
						<span className='ml-3 text-sm text-muted-foreground'>Analyzing your answers...</span>
					</div>
				)}

				{error && (
					<div className='rounded-lg bg-red-50 p-4 text-sm text-red-700'>{error}</div>
				)}
			</div>
		)
	}

	if (step === 'result' && result) {
		return (
			<div className='space-y-6 px-4 sm:px-6'>
				{/* Header */}
				<div className='flex items-center justify-between flex-wrap gap-3'>
					<div className='flex items-center gap-3'>
						<div className='p-2 rounded-lg bg-primary/10'>
							<Target className='h-5 w-5 text-primary' />
						</div>
						<div>
							<h1 className='text-2xl font-heading font-bold'>Your Career Diagnosis</h1>
							<p className='text-muted-foreground text-sm'>Personalized career insights based on your answers</p>
						</div>
					</div>
					<Button variant='outline' onClick={handleRestart} className='gap-2'>
						<RotateCcw className='h-4 w-4' />
						Retake
					</Button>
				</div>

				{/* Archetype Card */}
				<Card className='bg-violet-50 dark:bg-violet-950/20 border-violet-100 dark:border-violet-900'>
					<CardContent className='p-6'>
						<div className='flex flex-col sm:flex-row items-center gap-4'>
							<div className='flex h-16 w-16 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900'>
								<Sparkles className='h-8 w-8 text-violet-600 dark:text-violet-400' />
							</div>
							<div className='text-center sm:text-left'>
								<p className='text-xs font-medium text-violet-600 dark:text-violet-400 uppercase tracking-wide'>
									Your Career Archetype
								</p>
								<h2 className='text-xl font-bold text-violet-900 dark:text-violet-100 mt-0.5'>
									{result.careerArchetype.name}
								</h2>
								<p className='text-sm text-violet-700 dark:text-violet-300 mt-1'>
									{result.careerArchetype.description}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Summary */}
				<Card>
					<CardContent className='p-4'>
						<p className='text-sm text-muted-foreground'>{result.summary}</p>
					</CardContent>
				</Card>

				{/* Recommended Paths */}
				<div className='space-y-3'>
					<h2 className='text-lg font-semibold flex items-center gap-2'>
						<TrendingUp className='h-5 w-5 text-primary' />
						Recommended Career Paths
					</h2>
					{result.recommendedPaths.map((path, i) => (
						<Card key={i}>
							<CardContent className='p-4'>
								<div className='flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2'>
									<h3 className='font-medium'>{path.path_name}</h3>
									<div className='flex items-center gap-2'>
										<div className='h-2 w-24 rounded-full bg-muted overflow-hidden'>
											<div
												className='h-full rounded-full bg-emerald-500'
												style={{ width: `${path.fit_score}%` }}
											/>
										</div>
										<span className='text-xs font-medium text-emerald-600'>
											{path.fit_score}% fit
										</span>
									</div>
								</div>
								<p className='text-sm text-muted-foreground'>{path.description}</p>
								<div className='mt-2 flex flex-wrap gap-1.5'>
									<span className='inline-flex rounded bg-muted px-2 py-0.5 text-[10px] font-medium'>
										{path.time_to_achievable}
									</span>
									{path.required_skills.slice(0, 3).map((skill, j) => (
										<span
											key={j}
											className='inline-flex rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary'
										>
											{skill}
										</span>
									))}
								</div>
							</CardContent>
						</Card>
					))}
				</div>

				<div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
					{/* Strengths */}
					<Card>
						<CardHeader className='pb-3'>
							<CardTitle className='flex items-center gap-2 text-base'>
								<CheckCircle className='h-5 w-5 text-emerald-600' />
								Your Strengths
							</CardTitle>
						</CardHeader>
						<CardContent className='space-y-2'>
							{result.strengths.map((s, i) => (
								<div key={i} className='flex items-start gap-2 text-sm'>
									<Star className='h-4 w-4 text-amber-500 shrink-0 mt-0.5' />
									<span>{s}</span>
								</div>
							))}
						</CardContent>
					</Card>

					{/* Growth Areas */}
					<Card>
						<CardHeader className='pb-3'>
							<CardTitle className='flex items-center gap-2 text-base'>
								<Lightbulb className='h-5 w-5 text-amber-600' />
								Growth Areas
							</CardTitle>
						</CardHeader>
						<CardContent className='space-y-2'>
							{result.growthAreas.map((area, i) => (
								<div key={i} className='flex items-start gap-2 text-sm'>
									<Target className='h-4 w-4 text-primary shrink-0 mt-0.5' />
									<span>{area}</span>
								</div>
							))}
						</CardContent>
					</Card>
				</div>

				{/* Recommended Roles */}
				<Card>
					<CardHeader className='pb-3'>
						<CardTitle className='flex items-center gap-2 text-base'>
							<Briefcase className='h-5 w-5 text-primary' />
							Recommended Roles
						</CardTitle>
					</CardHeader>
					<CardContent className='space-y-3'>
						{result.recommendedRoles.map((role, i) => (
							<div key={i} className='rounded-lg bg-muted p-3'>
								<div className='flex items-center justify-between'>
									<p className='text-sm font-medium'>{role.title}</p>
									<span className='text-xs text-muted-foreground'>{role.salary_range}</span>
								</div>
								<p className='text-xs text-muted-foreground mt-1'>{role.why_fits}</p>
							</div>
						))}
					</CardContent>
				</Card>

				{/* Action Plan */}
				<Card>
					<CardHeader className='pb-3'>
						<CardTitle className='flex items-center gap-2 text-base'>
							<ArrowRight className='h-5 w-5 text-primary' />
							Your Action Plan
						</CardTitle>
					</CardHeader>
					<CardContent className='space-y-4'>
						{result.actionPlan.map((phase, i) => (
							<div key={i} className='space-y-2'>
								<div className='flex items-center gap-2'>
									<div className='flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary'>
										{i + 1}
									</div>
									<h3 className='text-sm font-medium'>
										{phase.phase}
										<span className='text-xs text-muted-foreground font-normal ml-2'>
											{phase.timeline}
										</span>
									</h3>
								</div>
								<div className='ml-8 space-y-1'>
									{phase.actions.map((action, j) => (
										<div key={j} className='flex items-start gap-2 text-sm'>
											<CheckCircle className='h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5' />
											<span className='text-muted-foreground'>{action}</span>
										</div>
									))}
								</div>
							</div>
						))}
					</CardContent>
				</Card>
			</div>
		)
	}

	return null
}

export default CareerDiagnosisPage
