// Polished post-interview results page
// Extracted from mock-interview.tsx for maintainability

import {
	AlertTriangle,
	Brain,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Clock,
	Eye,
	FileText,
	Lightbulb,
	MessageSquare,
	Mic,
	Monitor,
	Plus,
	Star,
	TrendingUp,
	Trophy,
	User,
	Volume2,
	Zap,
} from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

import type { MockSession, SessionFeedback } from './coaching-types'
import { scoreBg, scoreColor, scoreLabel, ScoreBar } from './coaching-utils'

interface InterviewResultsPageProps {
	mockSession: MockSession | null
	mockFeedback: SessionFeedback
	viewingHistorySession: boolean
	onBack: () => void
	onNewInterview: () => void
}

export function InterviewResultsPage({
	mockSession,
	mockFeedback,
	viewingHistorySession,
	onBack,
	onNewInterview,
}: InterviewResultsPageProps) {
	const [expandedSection, setExpandedSection] = useState<string | null>('overview')

	const toggleSection = (section: string) => {
		setExpandedSection((prev) => (prev === section ? null : section))
	}

	const overallScore = mockFeedback.overall_score
	const readiness = mockFeedback.interview_readiness

	return (
		<div className='space-y-6 max-w-4xl mx-auto pb-8'>
			{/* Header */}
			<div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3'>
				<div>
					<h2 className='text-xl font-bold flex items-center gap-2'>
						<Trophy className='h-6 w-6 text-amber-500' />
						{viewingHistorySession ? 'Past Interview Results' : 'Interview Complete'}
					</h2>
					<p className='text-sm text-muted-foreground mt-0.5'>
						{mockSession?.target_role || 'Mock Interview'}
						{mockSession?.started_at && (
							<span className='ml-2'>
								· {new Date(mockSession.started_at).toLocaleDateString()}
							</span>
						)}
					</p>
				</div>
				<div className='flex items-center gap-2'>
					{viewingHistorySession && (
						<Button variant='outline' size='sm' onClick={onBack}>
							← Back
						</Button>
					)}
					<Button size='sm' onClick={onNewInterview}>
						<Plus className='h-4 w-4 mr-1.5' /> New Interview
					</Button>
				</div>
			</div>

			{/* Hero Score Card */}
			<Card className={`border-2 overflow-hidden ${scoreBg(overallScore)}`}>
				<CardContent className='p-6 sm:p-8'>
					<div className='flex flex-col sm:flex-row items-center gap-6'>
						{/* Score Circle */}
						<div className='relative'>
							<svg className='h-32 w-32 -rotate-90' viewBox='0 0 100 100'>
								<circle
									cx='50'
									cy='50'
									r='42'
									fill='none'
									stroke='currentColor'
									strokeWidth='8'
									className='text-black/5'
								/>
								<circle
									cx='50'
									cy='50'
									r='42'
									fill='none'
									stroke='currentColor'
									strokeWidth='8'
									strokeLinecap='round'
									strokeDasharray={`${(overallScore / 10) * 264} 264`}
									className={
										overallScore >= 8
											? 'text-green-500'
											: overallScore >= 6
												? 'text-amber-500'
												: 'text-red-500'
									}
									style={{ transition: 'stroke-dasharray 1s ease' }}
								/>
							</svg>
							<div className='absolute inset-0 flex flex-col items-center justify-center'>
								<span className={`text-3xl font-bold ${scoreColor(overallScore)}`}>
									{overallScore}
								</span>
								<span className='text-xs text-muted-foreground'>/ 10</span>
							</div>
						</div>

						{/* Score Details */}
						<div className='flex-1 text-center sm:text-left'>
							<h3 className={`text-2xl font-bold ${scoreColor(overallScore)}`}>
								{scoreLabel(overallScore)}
							</h3>
							<p className='text-sm text-muted-foreground mt-1'>
								{(mockFeedback as any)._content_failed
									? 'Based on Communication & Presentation only'
									: 'Overall interview performance'}
							</p>
							<div className='flex items-center justify-center sm:justify-start gap-2 mt-3'>
								<Badge
									className={`${
										readiness === 'ready'
											? 'bg-green-100 text-green-700 hover:bg-green-100'
											: readiness === 'almost_ready'
												? 'bg-amber-100 text-amber-700 hover:bg-amber-100'
												: 'bg-red-100 text-red-700 hover:bg-red-100'
									} border-0 text-xs`}
								>
									{readiness === 'ready'
										? '✓ Interview Ready'
										: readiness === 'almost_ready'
											? '⟳ Almost Ready'
											: '⚠ Needs Practice'}
								</Badge>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Summary */}
			{mockFeedback.summary && (
				<Card>
					<CardContent className='p-5'>
						<p className='text-sm leading-relaxed text-foreground'>{mockFeedback.summary}</p>
					</CardContent>
				</Card>
			)}

			{/* Score Breakdown */}
			<SectionAccordion
				title='Score Breakdown'
				icon={TrendingUp}
				sectionKey='breakdown'
				expandedSection={expandedSection}
				toggleSection={toggleSection}
			>
				<div className='space-y-4 pt-2'>
					{(mockFeedback as any).content && (
						<ScoreBar
							score={(mockFeedback as any).content._failed ? null : (mockFeedback as any).content.score}
							label='Answer Content'
							icon={Brain}
						/>
					)}
					{(mockFeedback as any).communication && (
						<ScoreBar
							score={(mockFeedback as any).communication.score}
							label='Communication'
							icon={Volume2}
						/>
					)}
					{mockFeedback.presentation && (
						<ScoreBar
							score={mockFeedback.presentation.score}
							label='Presentation'
							icon={Eye}
						/>
					)}
					{mockFeedback.voice_analysis && (
						<ScoreBar
							score={mockFeedback.voice_analysis.overall_voice_score}
							label='Voice & Tone'
							icon={Mic}
						/>
					)}
				</div>
			</SectionAccordion>

			{/* Strengths & Weaknesses */}
			<div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
				{/* Strengths */}
				<Card className='border-green-200 bg-green-50/50'>
					<CardHeader className='pb-3'>
						<CardTitle className='text-sm flex items-center gap-2 text-green-800'>
							<CheckCircle2 className='h-4 w-4' /> Strengths
						</CardTitle>
					</CardHeader>
					<CardContent className='pt-0'>
						{mockFeedback.strengths.length > 0 ? (
							<ul className='space-y-2'>
								{mockFeedback.strengths.map((s, i) => (
									<li key={i} className='flex items-start gap-2 text-sm text-green-700'>
										<span className='mt-1 h-1.5 w-1.5 rounded-full bg-green-500 shrink-0' />
										{s}
									</li>
								))}
							</ul>
						) : (
							<p className='text-sm text-muted-foreground'>No strengths recorded.</p>
						)}
					</CardContent>
				</Card>

				{/* Improvements */}
				<Card className='border-amber-200 bg-amber-50/50'>
					<CardHeader className='pb-3'>
						<CardTitle className='text-sm flex items-center gap-2 text-amber-800'>
							<AlertTriangle className='h-4 w-4' /> Areas to Improve
						</CardTitle>
					</CardHeader>
					<CardContent className='pt-0'>
						{mockFeedback.improvements.length > 0 ? (
							<ul className='space-y-2'>
								{mockFeedback.improvements.map((s, i) => (
									<li key={i} className='flex items-start gap-2 text-sm text-amber-700'>
										<span className='mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0' />
										{s}
									</li>
								))}
							</ul>
						) : (
							<p className='text-sm text-muted-foreground'>No improvements noted.</p>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Detailed Feedback Sections */}
			{(mockFeedback as any).content && (
				<SectionAccordion
					title='Answer Content'
					icon={Brain}
					sectionKey='content'
					expandedSection={expandedSection}
					toggleSection={toggleSection}
					score={(mockFeedback as any).content._failed ? null : (mockFeedback as any).content.score}
				>
					<ContentDetail feedback={(mockFeedback as any).content} />
				</SectionAccordion>
			)}

			{(mockFeedback as any).communication && (
				<SectionAccordion
					title='Communication & Speech'
					icon={Volume2}
					sectionKey='communication'
					expandedSection={expandedSection}
					toggleSection={toggleSection}
					score={(mockFeedback as any).communication.score}
				>
					<CommunicationDetail feedback={(mockFeedback as any).communication} />
				</SectionAccordion>
			)}

			{mockFeedback.presentation && (
				<SectionAccordion
					title='Body Language & Presentation'
					icon={Eye}
					sectionKey='presentation'
					expandedSection={expandedSection}
					toggleSection={toggleSection}
					score={mockFeedback.presentation.score}
				>
					<PresentationDetail feedback={mockFeedback.presentation} />
				</SectionAccordion>
			)}

			{/* Question-by-question */}
			{mockFeedback.question_scores?.length > 0 && (
				<SectionAccordion
					title='Question Breakdown'
					icon={FileText}
					sectionKey='questions'
					expandedSection={expandedSection}
					toggleSection={toggleSection}
				>
					<div className='space-y-3 pt-2'>
						{mockFeedback.question_scores.map((qs, i) => (
							<div key={i} className='flex items-start gap-3 p-3 rounded-lg bg-muted/40'>
								<div
									className={`text-lg font-bold shrink-0 w-12 text-center ${scoreColor(qs.score)}`}
								>
									{qs.score}
								</div>
								<div className='flex-1 min-w-0'>
									<p className='text-sm font-medium'>{qs.question_summary}</p>
									<p className='text-xs text-muted-foreground mt-0.5'>{qs.feedback}</p>
								</div>
							</div>
						))}
					</div>
				</SectionAccordion>
			)}

			{/* Top Tip */}
			{mockFeedback.top_tip && (
				<Card className='border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50'>
					<CardContent className='p-5'>
						<h4 className='text-sm font-semibold flex items-center gap-2 text-indigo-800 mb-2'>
							<Lightbulb className='h-4 w-4' /> #1 Tip to Improve
						</h4>
						<p className='text-sm text-indigo-700'>{mockFeedback.top_tip}</p>
					</CardContent>
				</Card>
			)}

			{/* Interview Arc */}
			{(mockFeedback as any).interview_arc && (
				<Card>
					<CardContent className='p-5'>
						<h4 className='text-sm font-semibold flex items-center gap-2 mb-2'>
							<TrendingUp className='h-4 w-4 text-primary' /> Interview Arc
						</h4>
						<p className='text-sm text-muted-foreground leading-relaxed'>
							{(mockFeedback as any).interview_arc}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Transcript */}
			{mockSession?.conversation && mockSession.conversation.length > 0 && (
				<SectionAccordion
					title='Full Transcript'
					icon={FileText}
					sectionKey='transcript'
					expandedSection={expandedSection}
					toggleSection={toggleSection}
				>
					<div className='space-y-3 pt-2 max-h-[50vh] overflow-y-auto'>
						{mockSession.conversation.map((turn, i) => (
							<div key={turn.id || `turn-${i}`} className='flex gap-2.5'>
								<div
									className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
										turn.role === 'interviewer' ? 'bg-indigo-100' : 'bg-green-100'
									}`}
								>
									{turn.role === 'interviewer' ? (
										<Brain className='h-3.5 w-3.5 text-indigo-600' />
									) : (
										<User className='h-3.5 w-3.5 text-green-600' />
									)}
								</div>
								<div className='flex-1 min-w-0'>
									<p
										className={`text-[10px] font-semibold ${
											turn.role === 'interviewer' ? 'text-indigo-600' : 'text-green-600'
										}`}
									>
										{turn.role === 'interviewer' ? 'Alex' : 'You'}
									</p>
									<p className='text-xs leading-relaxed whitespace-pre-wrap'>{turn.text}</p>
								</div>
							</div>
						))}
					</div>
				</SectionAccordion>
			)}
		</div>
	)
}

// ===== SECTION ACCORDION =====
function SectionAccordion({
	title,
	icon: Icon,
	sectionKey,
	expandedSection,
	toggleSection,
	score,
	children,
}: {
	title: string
	icon: React.ElementType
	sectionKey: string
	expandedSection: string | null
	toggleSection: (key: string) => void
	score?: number | null
	children: React.ReactNode
}) {
	const isExpanded = expandedSection === sectionKey
	return (
		<Card className='overflow-hidden'>
			<button
				onClick={() => toggleSection(sectionKey)}
				className='w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors text-left'
			>
				<span className='flex items-center gap-2 font-semibold text-sm'>
					<Icon className='h-4 w-4 text-muted-foreground' />
					{title}
					{score !== undefined && score !== null && (
						<span className={`text-xs font-bold ml-1 ${scoreColor(score)}`}>{score}/10</span>
					)}
				</span>
				{isExpanded ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
			</button>
			{isExpanded && <div className='px-4 pb-4'>{children}</div>}
		</Card>
	)
}

// ===== CONTENT DETAIL =====
function ContentDetail({ feedback }: { feedback: any }) {
	return (
		<div className='space-y-4'>
			{feedback.detailed_feedback && (
				<p className='text-sm text-muted-foreground leading-relaxed'>{feedback.detailed_feedback}</p>
			)}

			{feedback.strengths?.length > 0 && (
				<div className='p-3 rounded-lg bg-green-50 border border-green-200'>
					<h5 className='text-xs font-semibold text-green-800 mb-1.5 flex items-center gap-1'>
						<CheckCircle2 className='h-3 w-3' /> Strengths
					</h5>
					<ul className='space-y-1'>
						{feedback.strengths.map((s: string, i: number) => (
							<li key={i} className='text-xs text-green-700'>{s}</li>
						))}
					</ul>
				</div>
			)}

			{feedback.improvements?.length > 0 && (
				<div className='p-3 rounded-lg bg-amber-50 border border-amber-200'>
					<h5 className='text-xs font-semibold text-amber-800 mb-1.5 flex items-center gap-1'>
						<AlertTriangle className='h-3 w-3' /> Improvements
					</h5>
					<ul className='space-y-1'>
						{feedback.improvements.map((s: string, i: number) => (
							<li key={i} className='text-xs text-amber-700'>{s}</li>
						))}
					</ul>
				</div>
			)}

			{feedback.specific_tips?.length > 0 && (
				<div className='p-3 rounded-lg bg-indigo-50 border border-indigo-200'>
					<h5 className='text-xs font-semibold text-indigo-800 mb-1.5 flex items-center gap-1'>
						<Lightbulb className='h-3 w-3' /> Tips
					</h5>
					<ul className='space-y-1'>
						{feedback.specific_tips.map((s: string, i: number) => (
							<li key={i} className='text-xs text-indigo-700'>{s}</li>
						))}
					</ul>
				</div>
			)}

			<div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
				{feedback.star_method_usage && (
					<MiniScoreCard
						label='STAR Method'
						score={feedback.star_method_usage.score}
						feedback={feedback.star_method_usage.feedback}
					/>
				)}
				{feedback.technical_depth && (
					<MiniScoreCard
						label='Technical Depth'
						score={feedback.technical_depth.score}
						feedback={feedback.technical_depth.feedback}
					/>
				)}
			</div>
		</div>
	)
}

// ===== COMMUNICATION DETAIL =====
function CommunicationDetail({ feedback }: { feedback: any }) {
	return (
		<div className='space-y-4'>
			{/* Stats grid */}
			<div className='grid grid-cols-2 sm:grid-cols-4 gap-2'>
				<StatCard label='Words/min' value={feedback.words_per_minute || '—'} />
				<StatCard label='Total Words' value={feedback.word_count || '—'} />
				<StatCard label='Filler Words' value={feedback.total_fillers || 0} />
				<StatCard
					label='Duration'
					value={
						feedback.duration_seconds
							? `${Math.floor(feedback.duration_seconds / 60)}:${String(feedback.duration_seconds % 60).padStart(2, '0')}`
							: '—'
					}
				/>
			</div>

			{feedback.pace && (
				<div
					className={`p-3 rounded-lg border ${
						feedback.pace.assessment === 'good'
							? 'bg-green-50 border-green-200'
							: feedback.pace.assessment?.includes('slight')
								? 'bg-amber-50 border-amber-200'
								: 'bg-red-50 border-red-200'
					}`}
				>
					<h5 className='text-xs font-semibold mb-1'>Speaking Pace</h5>
					<p className='text-xs'>{feedback.pace.feedback}</p>
				</div>
			)}

			{feedback.total_fillers > 0 && feedback.filler_words && (
				<div className='p-3 rounded-lg bg-amber-50 border border-amber-200'>
					<h5 className='text-xs font-semibold text-amber-800 mb-1.5'>
						Filler Words ({feedback.filler_rate || 0}%)
					</h5>
					<div className='flex flex-wrap gap-1.5'>
						{Object.entries(feedback.filler_words)
							.filter(([, count]) => (count as number) > 0)
							.map(([word, count]) => (
								<Badge key={word} variant='outline' className='text-[10px] bg-white'>
									"{word}" × {count as number}
								</Badge>
							))}
					</div>
				</div>
			)}

			{feedback.voice_analysis && (
				<div className='space-y-2 pt-1'>
					<h5 className='text-xs font-semibold flex items-center gap-1.5'>
						<Mic className='h-3.5 w-3.5 text-indigo-600' /> Voice & Tone Analysis
					</h5>
					<div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
						{[
							{ key: 'voice_confidence', label: 'Confidence', icon: Star },
							{ key: 'vocal_variety', label: 'Vocal Variety', icon: Volume2 },
							{ key: 'energy', label: 'Energy', icon: Zap },
							{ key: 'articulation', label: 'Articulation', icon: MessageSquare },
						].map((item) => {
							const data = feedback.voice_analysis[item.key]
							if (!data) return null
							const ItemIcon = item.icon
							return (
								<div key={item.key} className={`p-2.5 rounded-lg border ${scoreBg(data.score)}`}>
									<div className='flex items-center justify-between mb-1'>
										<span className='text-[10px] font-medium text-muted-foreground flex items-center gap-1'>
											<ItemIcon className='h-3 w-3' /> {item.label}
										</span>
										<span className={`text-sm font-bold ${scoreColor(data.score)}`}>
											{data.score}/10
										</span>
									</div>
									<p className='text-[10px] text-muted-foreground leading-relaxed'>
										{data.feedback}
									</p>
								</div>
							)
						})}
					</div>
					{feedback.voice_analysis.voice_summary && (
						<div className='p-3 rounded-lg bg-indigo-50 border border-indigo-200'>
							<p className='text-xs text-indigo-700'>{feedback.voice_analysis.voice_summary}</p>
						</div>
					)}
				</div>
			)}
		</div>
	)
}

// ===== PRESENTATION DETAIL =====
function PresentationDetail({ feedback }: { feedback: any }) {
	return (
		<div className='space-y-3'>
			<div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
				{[
					{ key: 'eye_contact', label: 'Eye Contact', icon: Eye },
					{ key: 'facial_expressions', label: 'Expressions', icon: User },
					{ key: 'body_language', label: 'Body Language', icon: Monitor },
					{ key: 'professional_appearance', label: 'Appearance', icon: Monitor },
				].map((item) => {
					const data = feedback[item.key]
					if (!data) return null
					const ItemIcon = item.icon
					return (
						<div key={item.key} className={`p-2.5 rounded-lg border ${scoreBg(data.score)}`}>
							<div className='flex items-center justify-between mb-1'>
								<span className='text-[10px] font-medium text-muted-foreground flex items-center gap-1'>
									<ItemIcon className='h-3 w-3' /> {item.label}
								</span>
								<span className={`text-sm font-bold ${scoreColor(data.score)}`}>
									{data.score}/10
								</span>
							</div>
							<p className='text-[10px] text-muted-foreground leading-relaxed'>{data.feedback}</p>
						</div>
					)
				})}
			</div>
			{feedback.summary && (
				<div className='p-3 rounded-lg bg-emerald-50 border border-emerald-200'>
					<p className='text-xs text-emerald-700'>{feedback.summary}</p>
				</div>
			)}
		</div>
	)
}

// ===== MINI SCORE CARD =====
function MiniScoreCard({ label, score, feedback }: { label: string; score: number; feedback: string }) {
	return (
		<div className={`p-3 rounded-lg border ${scoreBg(score)}`}>
			<div className='flex items-center justify-between mb-1'>
				<span className='text-[10px] font-medium text-muted-foreground'>{label}</span>
				<span className={`text-sm font-bold ${scoreColor(score)}`}>{score}/10</span>
			</div>
			<p className='text-[10px] text-muted-foreground leading-relaxed'>{feedback}</p>
		</div>
	)
}

// ===== STAT CARD =====
function StatCard({ label, value }: { label: string; value: string | number }) {
	return (
		<div className='p-2 rounded-lg bg-muted/50 text-center'>
			<div className='text-lg font-bold'>{value}</div>
			<div className='text-[10px] text-muted-foreground'>{label}</div>
		</div>
	)
}
