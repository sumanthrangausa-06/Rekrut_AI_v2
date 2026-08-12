import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle, Clock, XCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiCall } from '@/lib/api'

interface Question {
	id: number
	text: string
	category: string
	difficulty: number
	options: string[]
	timeLimit: number
	questionNumber: number
	totalQuestions: number
}

interface CurrentState {
	status: string
	attemptId: number
	testTitle: string
	timeRemaining: number
	totalDurationSeconds: number
	currentQuestion: Question
}

interface AnswerResponse {
	completed: boolean
	isCorrect?: boolean
	feedback?: string
	timeRemaining?: number
	nextQuestion?: Question
	score?: number
	maxScore?: number
	percentile?: number
	antiCheatScore?: number
	passed?: boolean
}

export function CandidateAptitudeTestTakePage() {
	const { id: testId } = useParams()
	const [searchParams] = useSearchParams()
	const navigate = useNavigate()
	const attemptId = Number(searchParams.get('attempt'))

	const [question, setQuestion] = useState<Question | null>(null)
	const [testTitle, setTestTitle] = useState('')
	const [selectedAnswer, setSelectedAnswer] = useState('')
	const [loading, setLoading] = useState(true)
	const [submitting, setSubmitting] = useState(false)
	const [completed, setCompleted] = useState(false)
	const [finalScore, setFinalScore] = useState(0)
	const [maxScore, setMaxScore] = useState(0)
	const [percentile, setPercentile] = useState<number | null>(null)
	const [passed, setPassed] = useState(false)
	const [antiCheatScore, setAntiCheatScore] = useState(100)
	const [timeLeft, setTimeLeft] = useState(0)
	const [totalDuration, setTotalDuration] = useState(0)
	const [tabWarningCount, setTabWarningCount] = useState(0)
	const startTimeRef = useRef(Date.now())
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

	const loadSession = useCallback(async () => {
		if (!attemptId) {
			navigate('/aptitude-tests')
			return
		}

		try {
			// Try sessionStorage first (set by aptitude-tests page when starting)
			const stored = sessionStorage.getItem(`aptitude_${attemptId}`)
			if (stored) {
				const data = JSON.parse(stored)
				setQuestion(data.question)
				setTestTitle(data.test?.title || '')
				setMaxScore(data.maxScore || 0)
				// Total time is test duration; per-question time limit is from the question
				const totalSeconds = (data.test?.durationMinutes || 15) * 60
				setTotalDuration(totalSeconds)
				setTimeLeft(totalSeconds)
				startTimeRef.current = Date.now()
				sessionStorage.removeItem(`aptitude_${attemptId}`)
				setLoading(false)
				return
			}

			// Fallback: fetch current attempt state from API (handles page refresh)
			const result = await apiCall<CurrentState>(`/aptitude-tests/attempt/${attemptId}/current`)

			if (result.status === 'completed' || result.status === 'timed_out') {
				setCompleted(true)
				setFinalScore(result.currentQuestion?.totalQuestions || 0) // fallback
				setPassed(result.status === 'completed')
			} else if (result.status === 'in_progress' && result.currentQuestion) {
				setQuestion(result.currentQuestion)
				setTestTitle(result.testTitle || '')
				setTimeLeft(result.timeRemaining)
				setTotalDuration(result.totalDurationSeconds)
				startTimeRef.current = Date.now()
			} else if (result.status === 'abandoned') {
				navigate('/aptitude-tests')
			}
		} catch {
			navigate('/aptitude-tests')
		} finally {
			setLoading(false)
		}
	}, [attemptId, navigate])

	useEffect(() => {
		loadSession()
	}, [loadSession])

	const handleSubmit = useCallback(
		async (timedOut = false) => {
			if (!question || submitting || !attemptId) return
			setSubmitting(true)
			const timeTaken = Math.round((Date.now() - startTimeRef.current) / 1000)

			if (!selectedAnswer && !timedOut) {
				setSubmitting(false)
				return
			}

			try {
				const result = await apiCall<AnswerResponse>(`/aptitude-tests/attempt/${attemptId}/answer`, {
					method: 'POST',
					body: {
						answer: selectedAnswer || '(no answer)',
						timeTaken,
					},
				})

				if (result.completed) {
					setFinalScore(result.score || 0)
					setMaxScore(result.maxScore || 0)
					setPercentile(result.percentile ?? null)
					setAntiCheatScore(result.antiCheatScore || 100)
					setPassed(result.passed || false)
					setCompleted(true)
					// Redirect to results page after a short delay
					setTimeout(() => {
						navigate(`/aptitude-test-results/${attemptId}`)
					}, 2500)
				} else if (result.nextQuestion) {
					setQuestion(result.nextQuestion)
					setSelectedAnswer('')
					if (result.timeRemaining !== undefined) {
						setTimeLeft(result.timeRemaining)
					}
					startTimeRef.current = Date.now()
				}
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : 'Failed to submit answer'
				alert(msg)
			} finally {
				setSubmitting(false)
			}
		},
		[question, selectedAnswer, attemptId, submitting, navigate],
	)

	// Timer countdown (uses server-synced timeLeft)
	useEffect(() => {
		if (!question || completed || timeLeft <= 0) {
			if (timerRef.current) {
				clearInterval(timerRef.current)
				timerRef.current = null
			}
			return
		}

		timerRef.current = setInterval(() => {
			setTimeLeft((prev) => {
				if (prev <= 1) {
					if (timerRef.current) clearInterval(timerRef.current)
					handleSubmit(true)
					return 0
				}
				return prev - 1
			})
		}, 1000)

		return () => {
			if (timerRef.current) clearInterval(timerRef.current)
		}
	}, [question, completed, handleSubmit])

	// Track tab switches
	useEffect(() => {
		function handleVisibility() {
			if (document.hidden && attemptId) {
				setTabWarningCount((prev) => prev + 1)
				apiCall(`/aptitude-tests/attempt/${attemptId}/event`, {
					method: 'POST',
					body: { eventType: 'tab_switch', data: { timestamp: new Date().toISOString() } },
				}).catch(() => {})
			}
		}
		document.addEventListener('visibilitychange', handleVisibility)
		return () => document.removeEventListener('visibilitychange', handleVisibility)
	}, [attemptId])

	// Track copy-paste
	useEffect(() => {
		function handleCopyPaste(e: ClipboardEvent) {
			e.preventDefault()
			if (attemptId) {
				apiCall(`/aptitude-tests/attempt/${attemptId}/event`, {
					method: 'POST',
					body: { eventType: 'copy_paste', data: { timestamp: new Date().toISOString() } },
				}).catch(() => {})
			}
		}
		document.addEventListener('copy', handleCopyPaste)
		document.addEventListener('paste', handleCopyPaste)
		return () => {
			document.removeEventListener('copy', handleCopyPaste)
			document.removeEventListener('paste', handleCopyPaste)
		}
	}, [attemptId])

	if (loading) {
		return (
			<div className='flex flex-col items-center justify-center min-h-[80vh] gap-4'>
				<div className='h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent' />
				<div className='font-heading text-xl font-semibold'>Preparing Your Test</div>
				<div className='text-muted-foreground'>Loading questions...</div>
			</div>
		)
	}

	// Completed view
	if (completed) {
		const pct = maxScore > 0 ? Math.round((finalScore / maxScore) * 100) : 0
		return (
			<div className='max-w-lg mx-auto py-8 px-4 sm:px-6'>
				<Card>
					<CardContent className='p-8 text-center'>
						{passed ? (
							<CheckCircle className='mx-auto h-16 w-16 text-emerald-500 mb-4' />
						) : (
							<XCircle className='mx-auto h-16 w-16 text-destructive mb-4' />
						)}
						<h2 className='font-heading text-2xl font-bold mb-2'>
							{passed ? 'Test Passed!' : 'Test Complete'}
						</h2>
						<p className='text-muted-foreground mb-6'>
							{testTitle && `${testTitle} — `}
							{passed ? 'Well done! You demonstrated strong cognitive abilities.' : 'Keep practicing to improve your score.'}
						</p>
						<div className='text-5xl font-bold mb-2'>
							<span className={passed ? 'text-emerald-600' : 'text-destructive'}>
								{finalScore}
							</span>
							<span className='text-muted-foreground text-lg'>/{maxScore}</span>
						</div>
						<div className='text-2xl font-semibold mb-4'>
							<span className={passed ? 'text-emerald-600' : 'text-destructive'}>{pct}%</span>
						</div>
						<Badge variant={passed ? 'success' : 'destructive'} className='text-sm mb-6'>
							{passed ? 'PASSED' : 'NOT PASSED'}
						</Badge>

						{percentile !== null && (
							<p className='text-sm text-muted-foreground mb-4'>
								You scored higher than <strong>{percentile}%</strong> of candidates
							</p>
						)}

						<div className='grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6 text-sm'>
							<div className='rounded-lg bg-muted/50 p-3'>
								<p className='font-medium'>{finalScore}/{maxScore}</p>
								<p className='text-xs text-muted-foreground'>Score</p>
							</div>
							{percentile !== null && (
								<div className='rounded-lg bg-muted/50 p-3'>
									<p className='font-medium'>{percentile}%</p>
									<p className='text-xs text-muted-foreground'>Percentile</p>
								</div>
							)}
							<div className='rounded-lg bg-muted/50 p-3'>
								<p
									className={`font-medium ${antiCheatScore >= 80 ? 'text-emerald-600' : antiCheatScore >= 50 ? 'text-amber-600' : 'text-destructive'}`}
								>
									{antiCheatScore}%
								</p>
								<p className='text-xs text-muted-foreground'>Integrity</p>
							</div>
						</div>

						<div className='flex gap-2 justify-center'>
							<Button onClick={() => navigate('/aptitude-tests')} className='min-h-[44px]'>
								Back to Tests
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		)
	}

	if (!question) {
		return (
			<div className='py-16 text-center px-4 sm:px-6'>
				<p className='text-muted-foreground'>Test session not found</p>
				<Button className='mt-4 min-h-[44px]' onClick={() => navigate('/aptitude-tests')}>
					Back to Tests
				</Button>
			</div>
		)
	}

	const minutes = Math.floor(timeLeft / 60)
	const seconds = timeLeft % 60
	const isLowTime = timeLeft < 60
	const progress = question.totalQuestions > 0
		? ((question.questionNumber - 1) / question.totalQuestions) * 100
		: 0

	return (
		<div className='max-w-3xl mx-auto space-y-4 px-4 sm:px-6'>
			{/* Header */}
			<div className='flex items-center justify-between'>
				<div>
					<h1 className='font-heading text-lg font-semibold'>{testTitle || 'Aptitude Test'}</h1>
					<p className='text-sm text-muted-foreground'>
						Question {question.questionNumber} of {question.totalQuestions}
					</p>
				</div>
				<Badge
					variant={isLowTime ? 'destructive' : 'secondary'}
					className='gap-1 font-mono text-base px-3 py-1'
				>
					<Clock className='h-4 w-4' />
					{minutes}:{seconds.toString().padStart(2, '0')}
				</Badge>
			</div>

			{/* Progress bar */}
			<div className='h-2 rounded-full bg-muted overflow-hidden'>
				<div
					className='h-full bg-primary transition-all duration-300 rounded-full'
					style={{ width: `${progress}%` }}
				/>
			</div>

			{/* Tab switch warning */}
			{tabWarningCount > 0 && (
				<div className='flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700'>
					<AlertTriangle className='h-4 w-4 shrink-0' />
					<span>
						Tab switch detected ({tabWarningCount}). This affects your integrity score.
					</span>
				</div>
			)}

			{/* Question card */}
			<Card>
				<CardHeader>
					<div className='flex items-center gap-2 mb-1'>
						<Badge variant='outline' className='text-[10px] capitalize'>
							{question.category}
						</Badge>
						<Badge variant='outline' className='text-[10px]'>
							Difficulty {question.difficulty}/5
						</Badge>
					</div>
					<CardTitle className='text-base leading-relaxed'>{question.text}</CardTitle>
				</CardHeader>
				<CardContent>
					<div className='space-y-2'>
						{question.options.map((option, i) => (
							<button
								key={`${question.id}-${option}-${i}`}
								onClick={() => setSelectedAnswer(option)}
								className={`w-full text-left rounded-lg border p-3 text-sm transition-colors min-h-[44px] ${
									selectedAnswer === option
										? 'border-primary bg-primary/5 ring-1 ring-primary'
										: 'hover:bg-muted'
								}`}
							>
								<span className='font-medium text-muted-foreground mr-2'>
									{String.fromCharCode(65 + i)}.
								</span>
								{option}
							</button>
						))}
					</div>
				</CardContent>
			</Card>

			{/* Navigation */}
			<div className='flex justify-between items-center'>
				<Button
					variant='outline'
					size='sm'
					className='gap-1 min-h-[44px]'
					onClick={() => navigate('/aptitude-tests')}
					disabled={submitting}
				>
					<ArrowLeft className='h-4 w-4' /> Quit Test
				</Button>
				<Button
					onClick={() => handleSubmit(false)}
					disabled={submitting || !selectedAnswer}
					className='gap-2 min-h-[44px]'
				>
					{submitting ? (
						<div className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
					) : question.questionNumber === question.totalQuestions ? (
						<CheckCircle className='h-4 w-4' />
					) : (
						<ArrowRight className='h-4 w-4' />
					)}
					{question.questionNumber === question.totalQuestions ? 'Finish' : 'Next'}
				</Button>
			</div>

			{isLowTime && (
				<div className='flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
					<AlertTriangle className='h-4 w-4 shrink-0' />
					Time is running out! Answer will be auto-submitted when time expires.
				</div>
			)}
		</div>
	)
}
