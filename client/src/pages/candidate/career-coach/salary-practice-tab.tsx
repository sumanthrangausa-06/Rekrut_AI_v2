import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DollarSign, Send, RotateCcw, Trophy, AlertCircle, MessageSquare } from 'lucide-react'

interface ChatMessage {
	role: 'user' | 'ai'
	text: string
	timestamp: string
	feedback?: {
		score: number
		what_worked: string[]
		what_to_improve: string[]
	}
	negotiationHealth?: string
}

export function SalaryPracticeTab() {
	const [jobId, setJobId] = useState('')
	const [offeredSalary, setOfferedSalary] = useState('')
	const [targetSalary, setTargetSalary] = useState('')
	const [sessionId, setSessionId] = useState<number | null>(null)
	const [messages, setMessages] = useState<ChatMessage[]>([])
	const [input, setInput] = useState('')
	const [loading, setLoading] = useState(false)
	const [phase, setPhase] = useState<'setup' | 'chat' | 'done'>('setup')
	const [finalResult, setFinalResult] = useState<any>(null)
	const [error, setError] = useState('')
	const scrollRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight
		}
	}, [messages])

	async function handleStart() {
		if (!jobId || !offeredSalary || !targetSalary) return
		setLoading(true)
		setError('')
		try {
			const res = await fetch('/api/career-coach/salary-practice/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jobId: Number(jobId),
					offeredSalary: Number(offeredSalary),
					targetSalary: Number(targetSalary),
				}),
			})
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Failed to start practice')
			setSessionId(data.sessionId)
			setMessages([
				{
					role: 'ai',
					text: data.aiMessage,
					timestamp: new Date().toISOString(),
				},
			])
			setPhase('chat')
		} catch (err: any) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	async function handleSend() {
		if (!input.trim() || !sessionId) return
		const userMsg: ChatMessage = {
			role: 'user',
			text: input.trim(),
			timestamp: new Date().toISOString(),
		}
		setMessages((prev) => [...prev, userMsg])
		setInput('')
		setLoading(true)
		setError('')

		try {
			const res = await fetch('/api/career-coach/salary-practice/continue', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sessionId,
					userMessage: userMsg.text,
					jobId: Number(jobId),
					offeredSalary: Number(offeredSalary),
					targetSalary: Number(targetSalary),
					conversationHistory: messages.map((m) => ({ role: m.role, text: m.text, timestamp: m.timestamp })),
				}),
			})
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Failed to continue')

			const aiMsg: ChatMessage = {
				role: 'ai',
				text: data.aiMessage,
				timestamp: new Date().toISOString(),
				feedback: data.coachingFeedback?.this_move,
				negotiationHealth: data.coachingFeedback?.negotiation_health,
			}
			setMessages((prev) => [...prev, aiMsg])

			if (data.conversationShouldEnd) {
				await handleFinalize()
			}
		} catch (err: any) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	async function handleFinalize() {
		if (!sessionId) return
		setLoading(true)
		try {
			const res = await fetch('/api/career-coach/salary-practice/finalize', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sessionId,
					conversationHistory: messages.map((m) => ({ role: m.role, text: m.text, timestamp: m.timestamp })),
				}),
			})
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Failed to finalize')
			setFinalResult(data)
			setPhase('done')
		} catch (err: any) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	function reset() {
		setPhase('setup')
		setSessionId(null)
		setMessages([])
		setFinalResult(null)
		setError('')
		setInput('')
	}

	return (
		<div className='space-y-6'>
			{phase === 'setup' && (
				<Card>
					<CardHeader>
						<CardTitle className='flex items-center gap-2'>
							<DollarSign className='h-5 w-5 text-indigo-500' />
							Salary Negotiation Practice
						</CardTitle>
						<CardDescription>
							Practice negotiating salary with an AI recruiter. Get real-time coaching feedback
							on every move.
						</CardDescription>
					</CardHeader>
					<CardContent className='space-y-4'>
						<div className='grid gap-4 sm:grid-cols-3'>
							<div className='space-y-2'>
								<Label htmlFor='sp-job-id'>Job ID</Label>
								<Input
									id='sp-job-id'
									type='number'
									placeholder='Job ID'
									value={jobId}
									onChange={(e) => setJobId(e.target.value)}
								/>
							</div>
							<div className='space-y-2'>
								<Label htmlFor='sp-offered'>Offered Salary ($)</Label>
								<Input
									id='sp-offered'
									type='number'
									placeholder='80000'
									value={offeredSalary}
									onChange={(e) => setOfferedSalary(e.target.value)}
								/>
							</div>
							<div className='space-y-2'>
								<Label htmlFor='sp-target'>Target Salary ($)</Label>
								<Input
									id='sp-target'
									type='number'
									placeholder='95000'
									value={targetSalary}
									onChange={(e) => setTargetSalary(e.target.value)}
								/>
							</div>
						</div>
						<Button onClick={handleStart} disabled={loading} className='bg-indigo-500 hover:bg-indigo-600'>
							{loading ? 'Starting...' : 'Start Practice'}
						</Button>
						{error && (
							<div className='flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300'>
								<AlertCircle className='h-4 w-4 shrink-0' />
								{error}
							</div>
						)}
					</CardContent>
				</Card>
			)}

			{phase === 'chat' && (
				<Card className='flex flex-col h-[600px]'>
					<CardHeader className='pb-3 flex-shrink-0'>
						<div className='flex items-center justify-between'>
							<CardTitle className='text-base flex items-center gap-2'>
								<MessageSquare className='h-4 w-4 text-indigo-500' />
								Negotiation Practice
							</CardTitle>
							<div className='flex items-center gap-2'>
								<Button variant='ghost' size='sm' onClick={handleFinalize}>
									End & Debrief
								</Button>
								<Button variant='ghost' size='sm' onClick={reset}>
									<RotateCcw className='h-4 w-4' />
								</Button>
							</div>
						</div>
					</CardHeader>
					<CardContent className='flex-1 flex flex-col overflow-hidden px-4 pb-4'>
						<ScrollArea className='flex-1 pr-2' ref={scrollRef}>
							<div className='space-y-4'>
								{messages.map((msg, i) => (
									<div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
										<div
											className={`max-w-[80%] rounded-lg p-3 text-sm ${
												msg.role === 'user'
													? 'bg-indigo-500 text-white'
													: 'bg-muted'
											}`}
										>
											<p>{msg.text}</p>
											{msg.feedback && (
												<div className='mt-2 rounded bg-black/10 p-2 text-xs'>
													<p className='font-medium'>Move score: {msg.feedback.score}/100</p>
													{msg.feedback.what_worked.length > 0 && (
														<p className='text-green-200'>
															✓ {msg.feedback.what_worked.join(', ')}
														</p>
													)}
													{msg.feedback.what_to_improve.length > 0 && (
														<p className='text-red-200'>
															! {msg.feedback.what_to_improve.join(', ')}
														</p>
													)}
												</div>
											)}
											{msg.negotiationHealth && (
												<Badge
													variant='outline'
													className={`mt-2 text-xs ${
														msg.negotiationHealth === 'strong'
															? 'border-green-500 text-green-600'
															: msg.negotiationHealth === 'weak' || msg.negotiationHealth === 'collapsing'
																? 'border-red-500 text-red-600'
																: 'border-amber-500 text-amber-600'
													}`}
												>
													Health: {msg.negotiationHealth}
												</Badge>
											)}
										</div>
									</div>
								))}
								{loading && (
									<div className='flex justify-start'>
										<div className='rounded-lg bg-muted p-3 text-sm'>
											<div className='flex gap-1'>
												<div className='h-2 w-2 animate-bounce rounded-full bg-indigo-500' />
												<div className='h-2 w-2 animate-bounce rounded-full bg-indigo-500 [animation-delay:0.1s]' />
												<div className='h-2 w-2 animate-bounce rounded-full bg-indigo-500 [animation-delay:0.2s]' />
											</div>
										</div>
									</div>
								)}
							</div>
						</ScrollArea>

						<div className='mt-3 flex gap-2'>
							<Input
								placeholder='Type your response...'
								value={input}
								onChange={(e) => setInput(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && handleSend()}
								disabled={loading}
							/>
							<Button onClick={handleSend} disabled={loading || !input.trim()} className='bg-indigo-500 hover:bg-indigo-600'>
								<Send className='h-4 w-4' />
							</Button>
						</div>
						{error && (
							<div className='mt-2 flex items-center gap-2 rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300'>
								<AlertCircle className='h-3 w-3 shrink-0' />
								{error}
							</div>
						)}
					</CardContent>
				</Card>
			)}

			{phase === 'done' && finalResult && (
				<div className='space-y-6'>
					<Card className='border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/20'>
						<CardContent className='py-6 text-center'>
							<Trophy className='mx-auto h-10 w-10 text-indigo-500 mb-3' />
							<h2 className='text-2xl font-bold'>
								Grade: {finalResult.grade} ({finalResult.overallScore}/100)
							</h2>
							<p className='mt-2 text-sm text-muted-foreground'>{finalResult.summary}</p>
						</CardContent>
					</Card>

					<div className='grid gap-4 md:grid-cols-2'>
						<Card>
							<CardHeader>
								<CardTitle className='text-base'>Strengths</CardTitle>
							</CardHeader>
							<CardContent>
								<ul className='space-y-1'>
									{finalResult.strengths.map((s: string, i: number) => (
										<li key={i} className='text-sm flex items-start gap-2'>
											<span className='text-green-500'>+</span> {s}
										</li>
									))}
								</ul>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle className='text-base'>Missed Opportunities</CardTitle>
							</CardHeader>
							<CardContent>
								<ul className='space-y-1'>
									{finalResult.missedOpportunities.map((s: string, i: number) => (
										<li key={i} className='text-sm flex items-start gap-2'>
											<span className='text-red-500'>-</span> {s}
										</li>
									))}
								</ul>
							</CardContent>
						</Card>
					</div>

					{finalResult.specificImprovements.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className='text-base'>Specific Improvements</CardTitle>
							</CardHeader>
							<CardContent>
								<ul className='space-y-1'>
									{finalResult.specificImprovements.map((s: string, i: number) => (
										<li key={i} className='text-sm'>
											• {s}
										</li>
									))}
								</ul>
							</CardContent>
						</Card>
					)}

					<Button onClick={reset} className='bg-indigo-500 hover:bg-indigo-600'>
						<RotateCcw className='h-4 w-4 mr-2' /> Practice Again
					</Button>
				</div>
			)}
		</div>
	)
}
