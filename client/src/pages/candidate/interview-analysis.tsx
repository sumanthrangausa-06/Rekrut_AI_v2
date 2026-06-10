import {
	Activity,
	AlertTriangle,
	ArrowLeft,
	CheckCircle,
	Eye,
	Lightbulb,
	Loader2,
	Smile,
	Target,
	TrendingUp,
	User,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { apiCall } from '@/lib/api'

interface InterviewAnalysis {
	id: number
	question_index: number
	presentation_score: number
	eye_contact_score: number
	expression_score: number
	body_language_score: number
	analysis_data: Record<string, any>
}

interface InterviewData {
	id: number
	questions: { question: string }[]
	status: string
}

export function InterviewAnalysisPage() {
	const navigate = useNavigate()
	const [searchParams] = useSearchParams()
	const interviewId = searchParams.get('interview_id')

	const [interview, setInterview] = useState<InterviewData | null>(null)
	const [analysis, setAnalysis] = useState<InterviewAnalysis[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		async function loadAnalysis() {
			try {
				if (!interviewId) {
					setError('No interview ID provided')
					setLoading(false)
					return
				}
				const data = await apiCall<{
					success: boolean
					interview: InterviewData
					analysis: InterviewAnalysis[]
				}>(`/interviews/${interviewId}/analysis`)
				if (!data.success || !data.analysis || data.analysis.length === 0) {
					setError('No analysis data available for this interview')
					return
				}
				setInterview(data.interview)
				setAnalysis(data.analysis)
			} catch (err) {
				console.error('Failed to load analysis:', err)
				setError('Failed to load analysis data')
			} finally {
				setLoading(false)
			}
		}
		loadAnalysis()
	}, [interviewId])

	const avgScores = {
		presentation: Math.round(
			analysis.reduce((sum, a) => sum + (a.presentation_score || 0), 0) / (analysis.length || 1),
		),
		eyeContact: Math.round(
			analysis.reduce((sum, a) => sum + (a.eye_contact_score || 0), 0) / (analysis.length || 1),
		),
		expression: Math.round(
			analysis.reduce((sum, a) => sum + (a.expression_score || 0), 0) / (analysis.length || 1),
		),
		bodyLanguage: Math.round(
			analysis.reduce((sum, a) => sum + (a.body_language_score || 0), 0) / (analysis.length || 1),
		),
	}

	function _getScoreColor(score: number) {
		if (score >= 80) return 'text-emerald-500'
		if (score >= 60) return 'text-blue-500'
		if (score >= 40) return 'text-amber-500'
		return 'text-red-500'
	}

	function _getScoreBg(score: number) {
		if (score >= 80) return 'bg-emerald-100'
		if (score >= 60) return 'bg-blue-100'
		if (score >= 40) return 'bg-amber-100'
		return 'bg-red-100'
	}

	function getInsights() {
		const insights: {
			icon: React.ReactNode
			text: React.ReactNode
			type: 'positive' | 'neutral' | 'improvement' | 'tip'
		}[] = []

		if (avgScores.presentation >= 80) {
			insights.push({
				icon: <Star className='h-5 w-5 text-amber-500' />,
				text: (
					<>
						<strong>Outstanding Presentation:</strong> Your overall video presence is excellent. You
						project confidence and professionalism.
					</>
				),
				type: 'positive',
			})
		} else if (avgScores.presentation >= 60) {
			insights.push({
				icon: <TrendingUp className='h-5 w-5 text-blue-500' />,
				text: (
					<>
						<strong>Good Presentation:</strong> Your video presence is solid. Focus on specific
						improvements mentioned above to reach the next level.
					</>
				),
				type: 'neutral',
			})
		} else {
			insights.push({
				icon: <Activity className='h-5 w-5 text-red-500' />,
				text: (
					<>
						<strong>Room for Growth:</strong> Practice video interviews regularly. Record yourself
						and review the footage to identify areas for improvement.
					</>
				),
				type: 'improvement',
			})
		}

		if (avgScores.eyeContact >= 75) {
			insights.push({
				icon: <Eye className='h-5 w-5 text-blue-500' />,
				text: (
					<>
						<strong>Strong Eye Contact:</strong> You maintain good eye contact with the camera,
						which helps build connection with interviewers.
					</>
				),
				type: 'positive',
			})
		} else {
			insights.push({
				icon: <Target className='h-5 w-5 text-amber-500' />,
				text: (
					<>
						<strong>Eye Contact Tip:</strong> Place a sticky note near your camera lens to remind
						you to look directly at it, not at your own video.
					</>
				),
				type: 'tip',
			})
		}

		if (avgScores.bodyLanguage >= 75) {
			insights.push({
				icon: <User className='h-5 w-5 text-emerald-500' />,
				text: (
					<>
						<strong>Excellent Posture:</strong> You maintain steady head position and good body
						language throughout the interview.
					</>
				),
				type: 'positive',
			})
		} else {
			insights.push({
				icon: <Lightbulb className='h-5 w-5 text-amber-500' />,
				text: (
					<>
						<strong>Posture Tip:</strong> Sit up straight with both feet on the floor. Imagine a
						string pulling the top of your head toward the ceiling.
					</>
				),
				type: 'tip',
			})
		}

		return insights
	}

	if (loading) {
		return (
			<div className='flex items-center justify-center min-h-[60vh]'>
				<div className='text-center'>
					<Loader2 className='h-12 w-12 animate-spin text-primary mx-auto mb-4' />
					<p className='text-muted-foreground'>Analyzing your interview...</p>
				</div>
			</div>
		)
	}

	if (error) {
		return (
			<div className='space-y-6'>
				<Button variant='ghost' onClick={() => navigate('/candidate')}>
					<ArrowLeft className='h-4 w-4 mr-2' />
					Back to Dashboard
				</Button>
				<Card>
					<CardContent className='flex flex-col items-center justify-center py-12 text-center'>
						<AlertTriangle className='h-12 w-12 text-muted-foreground mb-4' />
						<h2 className='text-xl font-semibold mb-2'>No Analysis Available</h2>
						<p className='text-muted-foreground'>{error}</p>
						<Button className='mt-4' onClick={() => navigate('/candidate')}>
							Return to Dashboard
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	const insights = getInsights()

	return (
		<div className='space-y-6'>
			<div className='flex items-center gap-2'>
				<Button variant='ghost' onClick={() => navigate('/candidate')}>
					<ArrowLeft className='h-4 w-4 mr-2' />
					Back to Dashboard
				</Button>
			</div>

			<div>
				<h1 className='text-3xl font-bold tracking-tight'>Interview Analysis Report</h1>
				<p className='text-muted-foreground'>AI-powered video analysis and feedback</p>
			</div>

			{/* Score Overview */}
			<Card>
				<CardHeader>
					<CardTitle className='flex items-center gap-2'>
						<Activity className='h-5 w-5' />
						Overall Presentation Score
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
						<ScoreCard
							score={avgScores.presentation}
							label='Presentation Score'
							icon={<Target className='h-6 w-6' />}
							primary
						/>
						<ScoreCard
							score={avgScores.eyeContact}
							label='Eye Contact'
							icon={<Eye className='h-6 w-6' />}
						/>
						<ScoreCard
							score={avgScores.expression}
							label='Facial Expression'
							icon={<Smile className='h-6 w-6' />}
						/>
						<ScoreCard
							score={avgScores.bodyLanguage}
							label='Body Language'
							icon={<User className='h-6 w-6' />}
						/>
					</div>
				</CardContent>
			</Card>

			{/* Question-by-Question Analysis */}
			<Card>
				<CardHeader>
					<CardTitle className='flex items-center gap-2'>
						<Eye className='h-5 w-5' />
						Question Analysis
					</CardTitle>
				</CardHeader>
				<CardContent className='space-y-6'>
					{analysis.map((item, index) => {
						const question = interview?.questions?.[item.question_index]
						const suggestions = []

						if (item.eye_contact_score < 70) {
							suggestions.push('Maintain more consistent eye contact with the camera')
						}
						if (item.expression_score < 70) {
							suggestions.push('Show more confident facial expressions and smile naturally')
						}
						if (item.body_language_score < 70) {
							suggestions.push('Keep your head steady and maintain good posture')
						}
						if (item.presentation_score < 60) {
							suggestions.push('Practice in front of a mirror to improve overall presence')
						}

						return (
							<div key={item.id} className='space-y-4'>
								<h3 className='font-semibold text-lg'>
									Question {item.question_index + 1}: {question?.question || 'Interview Question'}
								</h3>

								<div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
									<MetricBadge score={item.eye_contact_score} label='Eye Contact' />
									<MetricBadge score={item.expression_score} label='Expression' />
									<MetricBadge score={item.body_language_score} label='Body Language' />
									<MetricBadge score={item.presentation_score} label='Overall' />
								</div>

								{suggestions.length > 0 ? (
									<div className='bg-amber-50 border-l-4 border-amber-400 rounded-lg p-4'>
										<h4 className='font-semibold text-amber-900 mb-2 flex items-center gap-2'>
											<Lightbulb className='h-4 w-4' />
											Improvement Suggestions
										</h4>
										<ul className='space-y-1'>
											{suggestions.map((s, i) => (
												<li key={i} className='text-sm text-amber-800'>
													• {s}
												</li>
											))}
										</ul>
									</div>
								) : (
									<div className='flex items-center gap-2 text-emerald-600'>
										<CheckCircle className='h-5 w-5' />
										<span className='font-semibold'>Excellent performance on this question!</span>
									</div>
								)}

								{index < analysis.length - 1 && <Separator />}
							</div>
						)
					})}
				</CardContent>
			</Card>

			{/* Key Insights */}
			<Card>
				<CardHeader>
					<CardTitle className='flex items-center gap-2'>
						<Lightbulb className='h-5 w-5' />
						Key Insights & Recommendations
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className='space-y-4'>
						{insights.map((insight, index) => (
							<div
								key={index}
								className={`flex items-start gap-3 p-4 rounded-lg ${
									insight.type === 'positive'
										? 'bg-emerald-50'
										: insight.type === 'improvement'
											? 'bg-red-50'
											: 'bg-blue-50'
								}`}
							>
								<div className='mt-0.5'>{insight.icon}</div>
								<div className='text-sm'>{insight.text}</div>
							</div>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	)
}

function ScoreCard({
	score,
	label,
	icon,
	primary,
}: {
	score: number
	label: string
	icon: React.ReactNode
	primary?: boolean
}) {
	const color =
		score >= 80
			? 'text-emerald-500'
			: score >= 60
				? 'text-blue-500'
				: score >= 40
					? 'text-amber-500'
					: 'text-red-500'

	return (
		<div
			className={`flex flex-col items-center text-center p-4 rounded-lg ${primary ? 'bg-primary/5 border-2 border-primary/20' : 'bg-muted'}`}
		>
			<div className={`text-4xl font-bold mb-1 ${color}`}>{score}%</div>
			<div className='text-sm text-muted-foreground mb-2'>{label}</div>
			<div className='text-muted-foreground'>{icon}</div>
		</div>
	)
}

function MetricBadge({ score, label }: { score: number; label: string }) {
	const color =
		score >= 80
			? 'text-emerald-700 bg-emerald-100'
			: score >= 60
				? 'text-blue-700 bg-blue-100'
				: score >= 40
					? 'text-amber-700 bg-amber-100'
					: 'text-red-700 bg-red-100'

	return (
		<div className={`flex flex-col items-center text-center p-3 rounded-lg ${color}`}>
			<div className='text-2xl font-bold'>{Math.round(score)}%</div>
			<div className='text-xs font-medium'>{label}</div>
		</div>
	)
}

function Star({ className }: { className?: string }) {
	return (
		<svg className={className} fill='currentColor' viewBox='0 0 20 20'>
			<path d='M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z' />
		</svg>
	)
}
