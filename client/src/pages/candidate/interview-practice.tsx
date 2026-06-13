import {
	ArrowLeft,
	BookOpen,
	Brain,
	CheckCircle,
	ChevronRight,
	Flame,
	Lightbulb,
	Loader2,
	MessageSquare,
	Send,
	Star,
	Target,
	TrendingUp,
	Wrench,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { apiCall } from '@/lib/api'

interface PracticeQuestion {
	id: number
	category: string
	difficulty: string
	question: string
	sample_answer: string
}

interface PracticeStats {
	total_practiced: number
	average_score: number | null
	improvement: number | null
	streak_days: number
}

interface CategoryProgress {
	category: string
	count: number
	average_score: number
}

export function InterviewPracticePage() {
	const navigate = useNavigate()
	const [tab, setTab] = useState('library')
	const [questions, setQuestions] = useState<PracticeQuestion[]>([])
	const [stats, setStats] = useState<PracticeStats | null>(null)
	const [categoryProgress, setCategoryProgress] = useState<CategoryProgress[]>([])
	const [loading, setLoading] = useState(true)
	const [categoryFilter, setCategoryFilter] = useState('all')
	const [activeQuestion, setActiveQuestion] = useState<PracticeQuestion | null>(null)
	const [answer, setAnswer] = useState('')
	const [submitting, setSubmitting] = useState(false)
	const [feedback, setFeedback] = useState<any | null>(null)

	useEffect(() => {
		async function loadData() {
			try {
				const [questionsRes, statsRes, progressRes] = await Promise.all([
					apiCall<{ success: boolean; questions: PracticeQuestion[] }>(
						'/interviews/practice/library',
					),
					apiCall<{ success: boolean; stats: PracticeStats }>('/interviews/practice/stats'),
					apiCall<{ success: boolean; progress: { by_category: CategoryProgress[] } }>(
						'/interviews/practice/progress',
					),
				])

				if (questionsRes.success) setQuestions(questionsRes.questions)
				if (statsRes.success) setStats(statsRes.stats)
				if (progressRes.success) setCategoryProgress(progressRes.progress.by_category)
			} catch (err) {
				console.error('Failed to load practice data:', err)
			} finally {
				setLoading(false)
			}
		}
		loadData()
	}, [])

	const categories = ['all', 'behavioral', 'technical', 'situational']
	const categoryIcons: Record<string, React.ReactNode> = {
		behavioral: <Brain className='h-4 w-4' />,
		technical: <Wrench className='h-4 w-4' />,
		situational: <Lightbulb className='h-4 w-4' />,
	}

	const filteredQuestions =
		categoryFilter === 'all' ? questions : questions.filter((q) => q.category === categoryFilter)

	async function submitAnswer() {
		if (!activeQuestion || !answer.trim()) return
		setSubmitting(true)
		try {
			const res = await apiCall<{ success: boolean; feedback: any }>(
				'/interviews/practice/submit',
				{
					method: 'POST',
					body: {
						question_id: activeQuestion.id,
						answer: answer.trim(),
					},
				},
			)
			if (res.success) setFeedback(res.feedback)
		} catch (err) {
			console.error('Failed to submit answer:', err)
		} finally {
			setSubmitting(false)
		}
	}

	if (loading) {
		return (
			<div className='flex items-center justify-center min-h-[60vh]'>
				<div className='text-center'>
					<Loader2 className='h-12 w-12 animate-spin text-primary mx-auto mb-4' />
					<p className='text-muted-foreground'>Loading practice questions...</p>
				</div>
			</div>
		)
	}

	return (
		<div className='space-y-6'>
			<div className='flex items-center gap-2'>
				<Button variant='ghost' onClick={() => navigate('/candidate')}>
					<ArrowLeft className='h-4 w-4 mr-2' />
					Back to Dashboard
				</Button>
			</div>

			<div>
				<h1 className='text-2xl sm:text-3xl font-bold tracking-tight'>Interview Practice</h1>
				<p className='text-muted-foreground'>
					Practice with AI-powered feedback and track your progress
				</p>
			</div>

			{/* Stats */}
			{stats && (
				<div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
					<Card>
						<CardContent className='pt-6 text-center'>
							<MessageSquare className='h-8 w-8 text-primary mx-auto mb-2' />
							<div className='text-3xl font-bold'>{stats.total_practiced}</div>
							<div className='text-sm text-muted-foreground'>Questions Practiced</div>
						</CardContent>
					</Card>
					<Card>
						<CardContent className='pt-6 text-center'>
							<Star className='h-8 w-8 text-primary mx-auto mb-2' />
							<div className='text-3xl font-bold'>
								{stats.average_score ? stats.average_score.toFixed(1) : '—'}
							</div>
							<div className='text-sm text-muted-foreground'>Average Score</div>
						</CardContent>
					</Card>
					<Card>
						<CardContent className='pt-6 text-center'>
							<TrendingUp className='h-8 w-8 text-primary mx-auto mb-2' />
							<div className='text-3xl font-bold'>
								{stats.improvement ? `+${stats.improvement}%` : '—'}
							</div>
							<div className='text-sm text-muted-foreground'>Improvement</div>
						</CardContent>
					</Card>
					<Card>
						<CardContent className='pt-6 text-center'>
							<Flame className='h-8 w-8 text-primary mx-auto mb-2' />
							<div className='text-3xl font-bold'>{stats.streak_days}</div>
							<div className='text-sm text-muted-foreground'>Day Streak</div>
						</CardContent>
					</Card>
				</div>
			)}

			<Tabs value={tab} onValueChange={setTab}>
				<TabsList>
					<TabsTrigger value='library'>
						<BookOpen className='h-4 w-4 mr-2' />
						Question Library
					</TabsTrigger>
					<TabsTrigger value='progress'>
						<TrendingUp className='h-4 w-4 mr-2' />
						Progress
					</TabsTrigger>
				</TabsList>

				<TabsContent value='library' className='space-y-4'>
					{/* Category Filters */}
					<div className='flex flex-wrap gap-2'>
						{categories.map((cat) => (
							<Button
								key={cat}
								variant={categoryFilter === cat ? 'default' : 'outline'}
								size='sm'
								onClick={() => setCategoryFilter(cat)}
							>
								{cat !== 'all' && categoryIcons[cat]}
								{cat === 'all' ? 'All Questions' : cat.charAt(0).toUpperCase() + cat.slice(1)}
							</Button>
						))}
					</div>

					{/* Active Question */}
					{activeQuestion && (
						<Card className='border-primary'>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									<MessageSquare className='h-5 w-5' />
									Practice Question
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-4'>
								<div className='flex items-center gap-2'>
									<Badge variant='outline'>{activeQuestion.category}</Badge>
									<Badge variant='outline'>{activeQuestion.difficulty}</Badge>
								</div>
								<p className='text-lg font-medium'>{activeQuestion.question}</p>

								{!feedback ? (
									<>
										<Textarea
											value={answer}
											onChange={(e) => setAnswer(e.target.value)}
											placeholder='Type your answer here...'
											rows={6}
										/>
										<div className='flex gap-2'>
											<Button
												variant='outline'
												onClick={() => {
													setActiveQuestion(null)
													setAnswer('')
													setFeedback(null)
												}}
											>
												Cancel
											</Button>
											<Button onClick={submitAnswer} disabled={!answer.trim() || submitting}>
												{submitting ? (
													<Loader2 className='h-4 w-4 animate-spin mr-2' />
												) : (
													<Send className='h-4 w-4 mr-2' />
												)}
												Submit Answer
											</Button>
										</div>
									</>
								) : (
									<div className='space-y-4'>
										<div className='bg-emerald-50 border border-emerald-200 rounded-lg p-4'>
											<div className='flex items-center gap-2 mb-2'>
												<CheckCircle className='h-5 w-5 text-emerald-600' />
												<span className='font-semibold text-emerald-900'>
													Score: {feedback.score}/10
												</span>
											</div>
											<p className='text-sm text-emerald-800'>{feedback.feedback}</p>
										</div>
										<div className='bg-blue-50 border border-blue-200 rounded-lg p-4'>
											<h4 className='font-semibold text-blue-900 mb-2'>Sample Answer</h4>
											<p className='text-sm text-blue-800'>{activeQuestion.sample_answer}</p>
										</div>
										<Button
											onClick={() => {
												setActiveQuestion(null)
												setAnswer('')
												setFeedback(null)
											}}
										>
											Practice Another Question
										</Button>
									</div>
								)}
							</CardContent>
						</Card>
					)}

					{/* Question List */}
					<div className='grid gap-3'>
						{filteredQuestions.map((question) => (
							<Card
								key={question.id}
								className='cursor-pointer hover:shadow-md transition-shadow'
								onClick={() => {
									setActiveQuestion(question)
									setAnswer('')
									setFeedback(null)
								}}
							>
								<CardContent className='p-4'>
									<div className='flex items-center justify-between'>
										<div className='flex-1 min-w-0'>
											<div className='flex items-center gap-2 mb-1'>
												<Badge variant='outline' className='text-xs'>
													{categoryIcons[question.category]}
													<span className='ml-1'>{question.category}</span>
												</Badge>
												<Badge variant='outline' className='text-xs'>
													{question.difficulty}
												</Badge>
											</div>
											<p className='font-medium truncate'>{question.question}</p>
										</div>
										<ChevronRight className='h-5 w-5 text-muted-foreground flex-shrink-0 ml-2' />
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				</TabsContent>

				<TabsContent value='progress' className='space-y-4'>
					<Card>
						<CardHeader>
							<CardTitle className='flex items-center gap-2'>
								<Target className='h-5 w-5' />
								Category Progress
							</CardTitle>
						</CardHeader>
						<CardContent className='space-y-4'>
							{categoryProgress.length === 0 ? (
								<div className='text-center py-8 text-muted-foreground'>
									<BookOpen className='h-12 w-12 mx-auto mb-2' />
									<p>Start practicing to see your progress</p>
								</div>
							) : (
								categoryProgress.map((cat) => (
									<div key={cat.category}>
										<div className='flex items-center justify-between mb-2'>
											<div className='flex items-center gap-2'>
												{categoryIcons[cat.category]}
												<span className='font-medium capitalize'>{cat.category}</span>
											</div>
											<div className='text-sm text-muted-foreground'>
												{cat.count} questions • Avg {cat.average_score.toFixed(1)}/10
											</div>
										</div>
										<div className='h-2 bg-muted rounded-full overflow-hidden'>
											<div
												className='h-full bg-primary rounded-full transition-all'
												style={{ width: `${Math.min(cat.average_score * 10, 100)}%` }}
											/>
										</div>
									</div>
								))
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	)
}
