import {
	ArrowLeft,
	CheckCircle,
	Clock,
	Loader2,
	MessageSquare,
	Send,
	Star,
	ThumbsDown,
	ThumbsUp,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { apiCall } from '@/lib/api'

interface FeedbackRequest {
	id: number
	day_mark: number
	sent_at: string
	questions: string[]
	completed: boolean
}

interface CompletedFeedback {
	id: number
	day_mark: number
	submitted_at: string
	satisfaction_score: number
	would_recommend: boolean
	comments: string
}

export function PostHireFeedbackPage() {
	const navigate = useNavigate()
	const [pending, setPending] = useState<FeedbackRequest[]>([])
	const [completed, setCompleted] = useState<CompletedFeedback[]>([])
	const [loading, setLoading] = useState(true)
	const [activeFeedback, setActiveFeedback] = useState<FeedbackRequest | null>(null)
	const [answers, setAnswers] = useState<Record<string, string>>({})
	const [satisfaction, setSatisfaction] = useState(0)
	const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null)
	const [comments, setComments] = useState('')
	const [submitting, setSubmitting] = useState(false)

	useEffect(() => {
		async function loadData() {
			try {
				const [pendingRes, completedRes] = await Promise.all([
					apiCall<{ feedback: FeedbackRequest[] }>('/onboarding/feedback/pending'),
					apiCall<{ feedback: CompletedFeedback[] }>('/onboarding/feedback/completed'),
				])
				setPending(pendingRes.feedback || [])
				setCompleted(completedRes.feedback || [])
			} catch (err) {
				console.error('Failed to load feedback:', err)
			} finally {
				setLoading(false)
			}
		}
		loadData()
	}, [])

	async function submitFeedback() {
		if (!activeFeedback) return
		if (satisfaction === 0 || wouldRecommend === null) return

		setSubmitting(true)
		try {
			const responses: Record<string, string> = {}
			activeFeedback.questions.forEach((q) => {
				responses[q] = answers[q] || ''
			})

			await apiCall(`/onboarding/feedback/${activeFeedback.id}/submit`, {
				method: 'POST',
				body: {
					responses,
					satisfaction_score: satisfaction,
					would_recommend: wouldRecommend,
					comments,
				},
			})

			setPending((prev) => prev.filter((f) => f.id !== activeFeedback.id))
			setActiveFeedback(null)
			setAnswers({})
			setSatisfaction(0)
			setWouldRecommend(null)
			setComments('')
		} catch (err) {
			console.error('Failed to submit feedback:', err)
		} finally {
			setSubmitting(false)
		}
	}

	if (loading) {
		return (
			<div className='flex items-center justify-center min-h-[60vh]'>
				<div className='text-center'>
					<Loader2 className='h-12 w-12 animate-spin text-primary mx-auto mb-4' />
					<p className='text-muted-foreground'>Loading feedback requests...</p>
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
				<h1 className='text-2xl sm:text-3xl font-bold tracking-tight'>Post-Hire Check-ins</h1>
				<p className='text-muted-foreground'>Share your experience and help us improve</p>
			</div>

			{/* Pending Feedback */}
			<div className='space-y-4'>
				<h2 className='text-xl font-semibold flex items-center gap-2'>
					<Clock className='h-5 w-5' />
					Pending Feedback
				</h2>

				{pending.length === 0 ? (
					<Card className='bg-emerald-50 border-emerald-200'>
						<CardContent className='flex flex-col items-center justify-center py-12 text-center'>
							<CheckCircle className='h-12 w-12 text-emerald-500 mb-4' />
							<h3 className='text-lg font-semibold text-emerald-900 mb-2'>All Caught Up!</h3>
							<p className='text-emerald-700'>No pending feedback requests at the moment.</p>
						</CardContent>
					</Card>
				) : (
					pending.map((feedback) => (
						<Card key={feedback.id} className='hover:shadow-md transition-shadow'>
							<CardContent className='p-6'>
								<div className='flex items-center justify-between mb-4'>
									<div>
										<h3 className='text-lg font-semibold'>{feedback.day_mark}-Day Check-in</h3>
										<p className='text-sm text-muted-foreground'>
											Sent {new Date(feedback.sent_at).toLocaleDateString()}
										</p>
									</div>
									<Badge variant='outline' className='text-amber-600'>
										<Clock className='h-3 w-3 mr-1' />
										Pending
									</Badge>
								</div>
								<p className='text-muted-foreground mb-4'>
									We'd love to hear about your experience so far. This should take about 5 minutes.
								</p>
								<Button onClick={() => setActiveFeedback(feedback)}>
									<MessageSquare className='h-4 w-4 mr-2' />
									Complete Survey
								</Button>
							</CardContent>
						</Card>
					))
				)}
			</div>

			{/* Completed Feedback */}
			{completed.length > 0 && (
				<div className='space-y-4'>
					<h2 className='text-xl font-semibold flex items-center gap-2'>
						<CheckCircle className='h-5 w-5' />
						Completed Check-ins
					</h2>

					{completed.map((feedback) => (
						<Card key={feedback.id}>
							<CardContent className='p-6'>
								<div className='flex items-center justify-between mb-3'>
									<h3 className='font-semibold'>{feedback.day_mark}-Day Check-in</h3>
									<Badge variant='outline' className='text-emerald-600'>
										<CheckCircle className='h-3 w-3 mr-1' />
										Completed
									</Badge>
								</div>
								<div className='flex items-center gap-4 text-sm text-muted-foreground'>
									<div className='flex items-center gap-1'>
										<Star className='h-4 w-4 fill-amber-400 text-amber-400' />
										{feedback.satisfaction_score}/10
									</div>
									<div className='flex items-center gap-1'>
										{feedback.would_recommend ? (
											<>
												<ThumbsUp className='h-4 w-4 text-emerald-500' />
												Would recommend
											</>
										) : (
											<>
												<ThumbsDown className='h-4 w-4 text-red-500' />
												Would not recommend
											</>
										)}
									</div>
									<div>{new Date(feedback.submitted_at).toLocaleDateString()}</div>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			{/* Feedback Modal */}
			<Dialog open={!!activeFeedback} onOpenChange={(open) => !open && setActiveFeedback(null)}>
				<div className='p-6 space-y-6'>
					{/* Questions */}
					{activeFeedback?.questions.map((question, index) => (
						<div key={index}>
							<label className='block text-sm font-medium mb-2'>{question}</label>
							<Textarea
								value={answers[question] || ''}
								onChange={(e) => setAnswers((prev) => ({ ...prev, [question]: e.target.value }))}
								placeholder='Your answer...'
								rows={3}
							/>
						</div>
					))}

					{/* Satisfaction */}
					<div>
						<label className='block text-sm font-medium mb-2'>Overall Satisfaction (1-10)</label>
						<div className='flex gap-2'>
							{Array.from({ length: 10 }, (_, i) => i + 1).map((score) => (
								<Button
									key={score}
									variant={satisfaction >= score ? 'default' : 'outline'}
									size='sm'
									className='flex-1'
									onClick={() => setSatisfaction(score)}
								>
									{score}
								</Button>
							))}
						</div>
					</div>

					{/* Recommendation */}
					<div>
						<label className='block text-sm font-medium mb-2'>
							Would you recommend this company to a friend?
						</label>
						<div className='flex gap-3'>
							<Button
								variant={wouldRecommend === true ? 'default' : 'outline'}
								className='flex-1'
								onClick={() => setWouldRecommend(true)}
							>
								<ThumbsUp className='h-4 w-4 mr-2' />
								Yes
							</Button>
							<Button
								variant={wouldRecommend === false ? 'default' : 'outline'}
								className='flex-1'
								onClick={() => setWouldRecommend(false)}
							>
								<ThumbsDown className='h-4 w-4 mr-2' />
								No
							</Button>
						</div>
					</div>

					{/* Comments */}
					<div>
						<label className='block text-sm font-medium mb-2'>Additional Comments (Optional)</label>
						<Textarea
							value={comments}
							onChange={(e) => setComments(e.target.value)}
							placeholder='Share any additional thoughts...'
							rows={4}
						/>
					</div>

					<div className='flex gap-3'>
						<Button variant='outline' onClick={() => setActiveFeedback(null)}>
							Cancel
						</Button>
						<Button
							onClick={submitFeedback}
							disabled={submitting || satisfaction === 0 || wouldRecommend === null}
						>
							{submitting ? (
								<Loader2 className='h-4 w-4 animate-spin mr-2' />
							) : (
								<Send className='h-4 w-4 mr-2' />
							)}
							Submit Feedback
						</Button>
					</div>
				</div>
			</Dialog>
		</div>
	)
}
