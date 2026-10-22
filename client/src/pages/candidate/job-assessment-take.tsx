import {
	AlertTriangle,
	ArrowRight,
	BarChart3,
	CheckCircle,
	Clock,
	Loader2,
	MessageSquare,
	Send,
	Shield,
	Sparkles,
	Trophy,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
	ExitDialog,
	FullscreenWarning,
	TimerStatusAnnouncer,
	useFullscreenPolicy,
	type ExitAction,
} from '@/components/assessments/exit-fullscreen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { apiCall } from '@/lib/api';

interface Question {
	id: number;
	category: string;
	type: string;
	text: string;
	options?: string[];
	timeLimit: number;
	points: number;
	difficulty: number;
}

interface Progress {
	current: number;
	total: number;
}

interface ConversationMessage {
	role: 'candidate' | 'ai';
	text: string;
}

export function JobAssessmentTakePage() {
	const { id: assessmentId } = useParams();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();

	const [attemptId, setAttemptId] = useState<number | null>(null);
	const [question, setQuestion] = useState<Question | null>(null);
	const [progress, setProgress] = useState<Progress>({ current: 1, total: 15 });
	const [selectedAnswer, setSelectedAnswer] = useState('');
	const [textAnswer, setTextAnswer] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [loading, setLoading] = useState(true);
	const [completed, setCompleted] = useState(false);
	const [startError, setStartError] = useState<string | null>(null);
	const [feedback, setFeedback] = useState<string | null>(null);
	const [timeLeft, setTimeLeft] = useState(0);
	const [overallTimeLeft, setOverallTimeLeft] = useState<number | null>(null);
	const [expired, setExpired] = useState(false);
	const [scoring, setScoring] = useState(false);
	const [finalScore, setFinalScore] = useState<number | null>(null);
	const [finalResult, setFinalResult] = useState<'pass' | 'fail' | null>(null);

	// Phase B state: instructions gate, exit dialog, end states.
	const [begun, setBegun] = useState(false);
	const [exitOpen, setExitOpen] = useState(false);
	const [exitBusy, setExitBusy] = useState(false);
	const [exitError, setExitError] = useState<string | null>(null);
	const [exited, setExited] = useState(false);
	const [autoSubmitFailed, setAutoSubmitFailed] = useState(false);
	const [timerAnnouncement, setTimerAnnouncement] = useState('');
	const [scoreInfo, setScoreInfo] = useState<{
		partial: boolean;
		answersGiven: number | null;
		totalQuestions: number | null;
		autoSubmittedFullscreen: boolean;
	} | null>(null);
	const exitBtnRef = useRef<HTMLButtonElement>(null);
	const dialogFromWarningRef = useRef(false);
	const exitsRestoreRef = useRef(0);
	const interactionRef = useRef<() => void>(() => {});
	const attemptIdRef = useRef<number | null>(null);
	// The countdown effects are declared before the Phase B machinery in
	// this file, so they read pause/begun through refs synced by that block.
	const pausedRef = useRef(false);
	const begunRef = useRef(false);

	// Conversational mode
	const [conversationMode, setConversationMode] = useState(false);
	const [conversation, setConversation] = useState<ConversationMessage[]>([]);
	const [convoInput, setConvoInput] = useState('');
	const [convoLoading, setConvoLoading] = useState(false);
	const [convoQuestionId, setConvoQuestionId] = useState<number | null>(null);

	const startTimeRef = useRef(Date.now());

	const logEvent = useCallback(
		(eventType: string, eventData?: Record<string, unknown>) => {
			const aid = attemptIdRef.current;
			if (!aid) return;
			apiCall(`/assessments/job-assessment/${assessmentId}/event`, {
				method: 'POST',
				body: { attemptId: aid, eventType, eventData: eventData || {} },
			}).catch(() => {});
		},
		[assessmentId],
	);

	const startAssessment = useCallback(async () => {
		try {
			const applicationId = searchParams.get('applicationId');
			const data = await apiCall<{
				attemptId: number;
				resumed: boolean;
				progress: Progress;
				question: Question | null;
				timeLimitMinutes?: number;
				startedAt?: string;
				currentDraft?: { questionId: number; answer: string } | null;
				fullscreenExitsUsed?: number;
			}>(`/assessments/job-assessment/${assessmentId}/start`, {
				method: 'POST',
				body: { applicationId: applicationId ? Number(applicationId) : undefined },
			});

			setAttemptId(data.attemptId);
			attemptIdRef.current = data.attemptId;
			setProgress(data.progress);
			if (typeof data.fullscreenExitsUsed === 'number') {
				exitsRestoreRef.current = data.fullscreenExitsUsed;
			}
			if (data.question) {
				setQuestion(data.question);
				setTimeLeft(data.question.timeLimit || 120);
				startTimeRef.current = Date.now();
				// Phase B (§8.2): restore the stored draft onto its question,
				// still unanswered.
				if (data.currentDraft && data.currentDraft.questionId === data.question.id) {
					if (data.question.type === 'multiple_choice') setSelectedAnswer(data.currentDraft.answer);
					else setTextAnswer(data.currentDraft.answer);
				}
			}
			// Overall time limit (#343 task 3): countdown from startedAt + timeLimitMinutes.
			if (data.timeLimitMinutes && data.startedAt) {
				const elapsedSec = Math.floor((Date.now() - new Date(data.startedAt).getTime()) / 1000);
				const remaining = data.timeLimitMinutes * 60 - elapsedSec;
				if (remaining <= 0) {
					setExpired(true);
				} else {
					setOverallTimeLeft(remaining);
				}
			}
		} catch (e: any) {
			console.error('Failed to start assessment:', e);
			// Surface server errors (e.g. 403 when the candidate has no
			// assignment) instead of the generic "no questions" state below.
			setStartError(e?.message || 'Failed to start assessment');
		} finally {
			setLoading(false);
		}
	}, [assessmentId, searchParams]);

	useEffect(() => {
		startAssessment();
	}, [startAssessment]);

	// Timer

	// Overall countdown (#343 task 3): ticks once the attempt starts; the
	// server enforces the same limit on /answer, this is the visible clock.
	useEffect(() => {
		if (expired || completed) return;
		const id = setInterval(() => {
			// Phase B (§5.3): the whole-exam clock pauses while the Exit
			// dialog / full-screen warning is open (mirrored server-side by
			// pause credit), and does not run before the candidate begins.
			if (!begunRef.current || pausedRef.current) return;
			setOverallTimeLeft((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
		}, 1000);
		return () => clearInterval(id);
	}, [expired, completed]);

	useEffect(() => {
		if (overallTimeLeft === 0 && !expired) setExpired(true);
	}, [overallTimeLeft, expired]);

	// Poll for the score after a terminal submission (last answer, Submit &
	// Exit, or full-screen auto-submit). Phase B: the response carries the
	// partial label — a partial result is neither pass nor fail.
	const pollScore = useCallback(
		(aid: number, tries = 0) => {
			if (tries > 10) {
				setScoring(false);
				return;
			}
			setTimeout(
				async () => {
					try {
						const s = await apiCall<{
							composite_score: number | null;
							scored: boolean;
							result: 'pass' | 'fail' | null;
							partial?: boolean;
							answersGiven?: number | null;
							totalQuestions?: number | null;
							autoSubmittedFullscreen?: boolean;
						}>(`/assessments/attempt/${aid}/score`);
						setScoreInfo({
							partial: s.partial === true,
							answersGiven: s.answersGiven ?? null,
							totalQuestions: s.totalQuestions ?? null,
							autoSubmittedFullscreen: s.autoSubmittedFullscreen === true,
						});
						if (s.scored && s.composite_score != null) {
							setFinalScore(s.composite_score);
							setFinalResult(s.result);
							setScoring(false);
							return;
						}
						if (s.scored && s.partial) {
							// Scored with nothing to show numerically (e.g. zero
							// answered) — stop polling; the view explains it.
							setScoring(false);
							return;
						}
					} catch {
						/* keep polling */
					}
					pollScore(aid, tries + 1);
				},
				tries === 0 ? 3000 : 2000,
			);
		},
		[],
	);

	async function submitAnswer() {
		if (!attemptId || !question || expired) return;
		interactionRef.current();
		setSubmitting(true);
		setFeedback(null);

		const answer = question.type === 'multiple_choice' ? selectedAnswer : textAnswer;
		const timeTaken = Math.round((Date.now() - startTimeRef.current) / 1000);

		try {
			const data = await apiCall<{
				completed: boolean;
				feedback?: string;
				quickScore?: number;
				progress: Progress;
				nextQuestion?: Question;
			}>(`/assessments/job-assessment/${assessmentId}/answer`, {
				method: 'POST',
				body: { attemptId, questionId: question.id, answer, timeTaken },
			});

			if (data.feedback) setFeedback(data.feedback);

			if (data.completed) {
				setCompleted(true);
				setScoring(true);
				// Poll for the score — the server scores async after the last answer.
				// Transparency: show the candidate their own score, not just "recruiter will review".
				pollScore(attemptId);
				return;
			}

			// Show feedback briefly then move to next
			setTimeout(
				() => {
					setFeedback(null);
					setSelectedAnswer('');
					setTextAnswer('');
					setConversationMode(false);
					setConversation([]);
					setConvoQuestionId(null);

					if (data.nextQuestion) {
						setQuestion(data.nextQuestion);
						setProgress(data.progress);
						setTimeLeft(data.nextQuestion.timeLimit || 120);
						startTimeRef.current = Date.now();
					}
				},
				data.feedback ? 1500 : 0,
			);
		} catch (e: any) {
			console.error('Submit failed:', e);
		} finally {
			setSubmitting(false);
		}
	}

	// ---------- Phase B: full-screen policy + the unified Exit dialog ----------
	const answersGivenCount = Math.max(0, progress.current - 1);
	const totalQuestionsCount = progress.total || 0;

	const runExit = useCallback(
		async (action: ExitAction, reason?: string): Promise<boolean> => {
			if (!attemptId || !question) return false;
			const draftAnswer = question.type === 'multiple_choice' ? selectedAnswer : textAnswer;
			try {
				const result = await apiCall<{ status: string }>(
					`/assessments/job-assessment/${assessmentId}/exit`,
					{
						method: 'POST',
						body: {
							attemptId,
							action,
							reason,
							draft:
								action === 'save' && draftAnswer
									? { questionId: question.id, answer: draftAnswer }
									: undefined,
						},
					},
				);
				void result;
				if (action === 'save') {
					fsRef.current.setLeavingIntentionally();
					navigate('/candidate/assessments');
					return true;
				}
				if (action === 'abandon') {
					fsRef.current.setLeavingIntentionally();
					setExited(true);
					return true;
				}
				fsRef.current.setLeavingIntentionally();
				setCompleted(true);
				setScoring(true);
				pollScore(attemptId);
				return true;
			} catch (err) {
				const apiErr = err as Error & { status?: number; code?: string };
				if (apiErr.status === 409 || apiErr.code === 'ALREADY_FINISHED') {
					fsRef.current.setLeavingIntentionally();
					navigate('/candidate/assessments');
					return true;
				}
				return false;
			}
		},
		[attemptId, question, selectedAnswer, textAnswer, assessmentId, navigate, pollScore],
	);

	const fs = useFullscreenPolicy({
		log: logEvent,
		onSecondExit: () => {
			void (async () => {
				const ok = await runExit('submit', 'fullscreen_second_exit');
				if (!ok) setAutoSubmitFailed(true);
			})();
		},
	});
	const fsRef = useRef(fs);
	fsRef.current = fs;
	interactionRef.current = fs.markInteraction;

	useEffect(() => {
		if (exitsRestoreRef.current > 0) fs.restoreExitsUsed(exitsRestoreRef.current);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [question?.id]);

	const paused = exitOpen || fs.warningOpen || autoSubmitFailed;
	const pausedStateRef = useRef(false);
	useEffect(() => {
		pausedRef.current = paused;
		if (paused && !pausedStateRef.current) {
			setTimerAnnouncement('Timer paused.');
			logEvent('timer_pause_start', { answersGiven: answersGivenCount });
		} else if (!paused && pausedStateRef.current) {
			setTimerAnnouncement('Timer resumed.');
			logEvent('timer_pause_end', { answersGiven: answersGivenCount });
		}
		pausedStateRef.current = paused;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [paused]);

	const openExitDialog = useCallback(
		(fromWarning: boolean) => {
			if (submitting) return;
			dialogFromWarningRef.current = fromWarning;
			if (fromWarning) fsRef.current.closeWarningForDialog();
			setExitError(null);
			setExitOpen(true);
			logEvent('exit_dialog_opened', { answersGiven: answersGivenCount });
		},
		[submitting, logEvent, answersGivenCount],
	);

	const closeExitDialog = useCallback(() => {
		setExitOpen(false);
		if (dialogFromWarningRef.current) {
			dialogFromWarningRef.current = false;
			fsRef.current.reopenWarning();
		} else {
			setTimeout(() => exitBtnRef.current?.focus(), 0);
		}
	}, []);

	const handleExitAction = useCallback(
		async (action: ExitAction) => {
			setExitBusy(true);
			setExitError(null);
			const ok = await runExit(action);
			setExitBusy(false);
			if (ok) {
				setExitOpen(false);
			} else {
				setExitError(
					"We couldn't do that right now — check your connection and try again. Your answers so far are already saved.",
				);
			}
		},
		[runExit],
	);

	async function sendConvoMessage() {
		if (!convoInput.trim() || !attemptId || !convoQuestionId) return;
		setConvoLoading(true);
		const msg = convoInput.trim();
		setConvoInput('');
		setConversation((prev) => [...prev, { role: 'candidate', text: msg }]);

		try {
			const data = await apiCall<{ reply: string; done: boolean; followUpCount: number }>(
				`/assessments/job-assessment/${assessmentId}/converse`,
				{
					method: 'POST',
					body: { attemptId, questionId: convoQuestionId, message: msg },
				},
			);
			setConversation((prev) => [...prev, { role: 'ai', text: data.reply }]);
			if (data.done) {
				setTimeout(() => setConversationMode(false), 2000);
			}
		} catch {
			setConversation((prev) => [
				...prev,
				{
					role: 'ai',
					text: 'Sorry, I had trouble processing that. Please continue to the next question.',
				},
			]);
		} finally {
			setConvoLoading(false);
		}
	}

	function startConversation() {
		if (!question) return;
		setConversationMode(true);
		setConvoQuestionId(question.id);
		setConversation([
			{
				role: 'ai',
				text: `Let's discuss your answer in more depth. I'd like to understand your approach better. Can you elaborate on your response?`,
			},
		]);
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="text-center space-y-3 px-4">
					<Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
					<p className="text-muted-foreground">Loading assessment...</p>
				</div>
			</div>
		);
	}

	// Phase B: Exit Exam end state — honest, scoreless.
	if (exited) {
		return (
			<div className="max-w-2xl mx-auto space-y-6 py-8 px-4 sm:px-6">
				<Card>
					<CardContent className="pt-8 text-center space-y-4">
						<h2 className="text-2xl font-bold">Exited — not scored</h2>
						<p className="text-muted-foreground max-w-md mx-auto">
							You exited this assessment. Your answers were not marked and there is no score for
							this attempt.
						</p>
						<Button onClick={() => navigate('/candidate/applications')} className="gap-2">
							<ArrowRight className="h-4 w-4" /> Back to Applications
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (completed) {
		const isPartial = scoreInfo?.partial === true;
		return (
			<div className="max-w-2xl mx-auto space-y-6 py-8 px-4 sm:px-6">
				<Card className="border-2 border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
					<CardContent className="pt-8 text-center space-y-4">
						<div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
							<Trophy className="h-8 w-8 text-green-600" />
						</div>
						<h2 className="text-2xl font-bold">{isPartial ? 'Assessment Submitted' : 'Assessment Complete!'}</h2>
						{scoreInfo?.autoSubmittedFullscreen && (
							<p className="text-muted-foreground max-w-md mx-auto">
								Submitted automatically after leaving full-screen twice.{' '}
								{scoreInfo.answersGiven} of {scoreInfo.totalQuestions} questions answered.
							</p>
						)}
						{isPartial ? (
							scoreInfo?.answersGiven === 0 ? (
								<p className="text-muted-foreground max-w-md mx-auto">
									You submitted with no questions answered, so there is no score.
								</p>
							) : (
								<div className="space-y-2">
									<Badge variant="secondary">
										Partial — answered {scoreInfo?.answersGiven} of {scoreInfo?.totalQuestions}
									</Badge>
									<p className="text-muted-foreground max-w-md mx-auto">
										Partial submission — answered {scoreInfo?.answersGiven} of{' '}
										{scoreInfo?.totalQuestions} questions. Your score is based only on the
										questions you answered. This is not a pass or a fail, and it does not count
										toward your OmniScore.
									</p>
									{finalScore != null && (
										<p className="text-lg font-medium">
											Score over answered questions: {finalScore}
										</p>
									)}
									{scoring && finalScore == null && (
										<p className="text-muted-foreground">Your answered questions are being scored…</p>
									)}
								</div>
							)
						) : finalScore != null ? (
							<div className="space-y-2">
								<div className="text-5xl font-bold text-green-700">{finalScore}/100</div>
								<p className="text-muted-foreground max-w-md mx-auto">
									{finalResult === 'pass'
										? 'You passed this assessment. The hiring team will be in touch with next steps.'
										: 'Your assessment has been scored. Check your applications page for updates from the hiring team.'}
								</p>
							</div>
						) : (
							<p className="text-muted-foreground max-w-md mx-auto">
								{scoring
									? 'Your answers are being scored by AI. Results will be available shortly.'
									: 'Your assessment has been submitted and scored. The recruiter will review your results.'}
							</p>
						)}
						{scoring && finalScore == null && (
							<div className="flex items-center justify-center gap-2 text-violet-600">
								<Loader2 className="h-4 w-4 animate-spin" />
								<span className="text-sm font-medium">AI is scoring your answers...</span>
							</div>
						)}
						<div className="pt-4">
							<Button onClick={() => navigate('/candidate/applications')} className="gap-2">
								<ArrowRight className="h-4 w-4" /> Back to Applications
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (expired) {
		return (
			<div className="max-w-xl mx-auto py-12 text-center space-y-4 px-4 sm:px-6">
				<AlertTriangle className="h-10 w-10 text-red-500 mx-auto" />
				<h2 className="text-xl font-bold">Time Expired</h2>
				<p className="text-muted-foreground">
					The time limit for this assessment has elapsed. Your submitted answers have been
					saved.
				</p>
				<Button variant="outline" onClick={() => navigate(-1)}>
					Go Back
				</Button>
			</div>
		);
	}

	if (!question) {
		return (
			<div className="max-w-xl mx-auto py-12 text-center space-y-4 px-4 sm:px-6">
				<AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
				<h2 className="text-xl font-bold">
					{startError ? 'Cannot Start Assessment' : 'No Questions Available'}
				</h2>
				<p className="text-muted-foreground">
					{startError || "This assessment doesn't have any questions yet."}
				</p>
				<Button variant="outline" onClick={() => navigate(-1)}>
					Go Back
				</Button>
			</div>
		);
	}

	// Phase B instructions gate (§9.1): the rules are disclosed with the
	// real counts before the first question is answered. Start is the
	// full-screen gesture; the opt-out is unpenalised and equivalent.
	if (!begun) {
		return (
			<div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
				<Card>
					<CardContent className="pt-6 space-y-4">
						<h2 className="font-heading text-xl font-bold">Before you start</h2>
						<ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
							<li>
								This test has <strong>{progress.total} questions</strong>. You have{' '}
								<strong>{Math.round((overallTimeLeft ?? progress.total * 120) / 60) || 45} minutes</strong>{' '}
								in total, shown by the countdown at the top.
							</li>
							<li>
								<strong>An answer is saved when you press Next.</strong> An answer you have
								chosen or typed but not submitted with Next is a draft, not a saved answer.
							</li>
							<li>
								<strong>This test runs in full-screen.</strong> Leaving full-screen once shows a
								warning and pauses your timer. <strong>Leaving a second time submits your test immediately</strong>,
								using only the answers you have already saved.
							</li>
							<li>
								<strong>You can leave at any time with the Exit button.</strong> You can save and
								resume later, submit the answers you have saved so far, or exit the exam without
								a score. Nothing about leaving is hidden — each option explains itself before
								you choose it.
							</li>
							<li>Short answers are scored by AI and reviewed by a human.</li>
						</ul>
						<div className="flex flex-col gap-2">
							<Button
								className="min-h-[44px]"
								onClick={async () => {
									await fs.enterFullscreen();
									begunRef.current = true;
									setBegun(true);
								}}
							>
								Start Test
							</Button>
							<Button
								variant="ghost"
								className="min-h-[44px]"
								onClick={() => {
									fs.continueWithoutFullscreen();
									begunRef.current = true;
									setBegun(true);
								}}
							>
								Continue without full-screen
							</Button>
							{fs.mode === 'nofs' && (
								<p className="text-sm text-muted-foreground">
									Your browser could not enter full-screen. The test will continue normally.
								</p>
							)}
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	const minutes = Math.floor(timeLeft / 60);
	const seconds = timeLeft % 60;
	const isLowTime = timeLeft < 30;
	const isTextType = question.type !== 'multiple_choice';

	return (
		<div className="max-w-3xl mx-auto space-y-5 py-4 px-4 sm:px-6 lg:px-8">
			<TimerStatusAnnouncer message={timerAnnouncement} />
			{autoSubmitFailed && (
				<div className="flex items-center justify-between gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
					<span className="flex items-center gap-2">
						<AlertTriangle className="h-4 w-4 shrink-0" />
						<span>
							<strong>We couldn't submit your test — check your connection.</strong> Your saved
							answers are safe. Use Submit Now to finish.
						</span>
					</span>
					<Button
						variant="outline"
						className="min-h-[44px] shrink-0"
						onClick={async () => {
							const ok = await runExit('submit', 'fullscreen_second_exit');
							if (ok) setAutoSubmitFailed(false);
						}}
					>
						Submit Now
					</Button>
				</div>
			)}
			<ExitDialog
				open={exitOpen}
				answersGiven={answersGivenCount}
				totalQuestions={totalQuestionsCount}
				busy={exitBusy}
				error={exitError}
				onContinue={closeExitDialog}
				onExit={handleExitAction}
			/>
			<FullscreenWarning
				open={fs.warningOpen}
				answersGiven={answersGivenCount}
				totalQuestions={totalQuestionsCount}
				onReturn={async () => {
					await fs.returnToFullscreen();
				}}
				onReviewOptions={() => openExitDialog(true)}
				onContinueWithoutFullscreen={() => fs.continueWithoutFullscreen()}
			/>
			{/* Progress Bar */}
			<div className="space-y-2">
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm">
					<span className="font-medium">
						Question {progress.current} of {progress.total}
					</span>
					<div className="flex flex-wrap items-center gap-2 sm:gap-3">
						<Button
							ref={exitBtnRef}
							variant="outline"
							size="sm"
							className="min-h-[44px]"
							disabled={submitting || exitBusy}
							onClick={() => openExitDialog(false)}
						>
							Exit
						</Button>
						<Badge variant="secondary" className="capitalize">
							{question.category.replace('_', ' ')}
						</Badge>
						<span className="text-xs text-muted-foreground">
							{question.points} pts &middot; Difficulty {question.difficulty}/5
						</span>
						<span
							className={`flex items-center gap-1 font-mono text-sm ${isLowTime ? 'text-red-600 font-bold' : 'text-muted-foreground'}`}
						>
							<Clock className={`h-3.5 w-3.5 ${isLowTime ? 'animate-pulse' : ''}`} />
							{minutes}:{seconds.toString().padStart(2, '0')}
						</span>
						{overallTimeLeft !== null && (
							<span
								className={`flex items-center gap-1 font-mono text-sm ${overallTimeLeft < 300 ? 'text-red-600 font-bold' : 'text-muted-foreground'}`}
								title="Total time remaining for this assessment"
							>
								<Clock className={`h-3.5 w-3.5 ${overallTimeLeft < 300 ? 'animate-pulse' : ''}`} />
								{Math.floor(overallTimeLeft / 60)}:{(overallTimeLeft % 60).toString().padStart(2, '0')}
							</span>
						)}
					</div>
				</div>
				<div className="h-2 rounded-full bg-muted overflow-hidden">
					<div
						className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-300"
						style={{ width: `${(progress.current / progress.total) * 100}%` }}
					/>
				</div>
			</div>

			{/* AI disclosure (#343 task 5) */}
			<div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
				<AlertTriangle className="h-4 w-4 shrink-0" />
				<span>This assessment is scored by AI and reviewed by a human.</span>
			</div>

			{/* Question Card */}
			<Card className="border-2">
				<CardContent className="pt-6 space-y-5">
					{/* Feedback banner */}
					{feedback && (
						<div
							className={`rounded-lg p-3 text-sm ${feedback.startsWith('Correct') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}
						>
							{feedback}
						</div>
					)}

					<p className="text-base sm:text-lg font-medium leading-relaxed">{question.text}</p>

					{/* Multiple choice */}
					{question.type === 'multiple_choice' && question.options && (
						<div className="space-y-2">
							{question.options.map((opt, _i) => (
								<button type="button"
									key={opt}
									className={`w-full text-left rounded-lg border-2 p-3.5 min-h-[44px] transition-all ${
										selectedAnswer === opt
											? 'border-violet-500 bg-violet-50 ring-1 ring-violet-200'
											: 'border-border hover:border-violet-300 hover:bg-violet-50/50'
									}`}
									onClick={() => {
										interactionRef.current();
										setSelectedAnswer(opt);
									}}
									disabled={submitting}
								>
									<span className="text-sm">{opt}</span>
								</button>
							))}
						</div>
					)}

					{/* Free text / scenario / code challenge */}
					{isTextType && !conversationMode && (
						<Textarea
							placeholder={
								question.type === 'code_challenge'
									? 'Write your solution here...'
									: question.type === 'scenario_response'
										? 'Describe how you would handle this scenario...'
										: 'Type your answer here...'
							}
							value={textAnswer}
							onChange={(e) => {
								interactionRef.current();
								setTextAnswer(e.target.value);
							}}
							rows={question.type === 'code_challenge' ? 10 : 6}
							className={question.type === 'code_challenge' ? 'font-mono text-sm' : ''}
							disabled={submitting}
						/>
					)}

					{/* Conversational mode */}
					{conversationMode && (
						<div className="rounded-lg border bg-muted/30 p-4 space-y-3">
							<div className="flex items-center gap-2 text-sm font-medium text-violet-700">
								<MessageSquare className="h-4 w-4" />
								AI Follow-up Discussion
							</div>
							<div className="space-y-2 max-h-48 overflow-y-auto">
								{conversation.map((msg, i) => (
									<div
										key={i}
										className={`flex ${msg.role === 'candidate' ? 'justify-end' : 'justify-start'}`}
									>
										<div
											className={`rounded-lg px-3 py-2 max-w-[80%] text-sm ${
												msg.role === 'candidate'
													? 'bg-violet-100 text-violet-900'
													: 'bg-white border'
											}`}
										>
											{msg.text}
										</div>
									</div>
								))}
								{convoLoading && (
									<div className="flex justify-start">
										<div className="bg-white border rounded-lg px-3 py-2 text-sm text-muted-foreground flex items-center gap-1.5">
											<Loader2 className="h-3 w-3 animate-spin" /> Thinking...
										</div>
									</div>
								)}
							</div>
							<div className="flex gap-2">
								<input
									className="flex-1 rounded-lg border px-3 py-2 text-sm min-h-[44px]"
									placeholder="Type your response..."
									value={convoInput}
									onChange={(e) => setConvoInput(e.target.value)}
									onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendConvoMessage()}
									disabled={convoLoading}
								/>
								<Button
									size="sm"
									onClick={sendConvoMessage}
									disabled={convoLoading || !convoInput.trim()}
									className="min-h-[44px] min-w-[44px]"
								>
									<Send className="h-4 w-4" />
								</Button>
							</div>
						</div>
					)}

					{/* Actions */}
					<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
						<div className="flex gap-2">
							{isTextType && !conversationMode && textAnswer.length > 20 && (
								<Button
									variant="outline"
									size="sm"
									onClick={startConversation}
									className="gap-1.5 text-violet-600 min-h-[44px]"
								>
									<MessageSquare className="h-3.5 w-3.5" /> Discuss with AI
								</Button>
							)}
						</div>
						<Button
							onClick={submitAnswer}
							disabled={
								submitting ||
								(question.type === 'multiple_choice' && !selectedAnswer) ||
								(isTextType && !textAnswer.trim() && !conversationMode)
							}
							className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 min-h-[44px]"
						>
							{submitting ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin" /> Submitting...
								</>
							) : progress.current >= progress.total ? (
								<>
									<CheckCircle className="h-4 w-4" /> Finish Assessment
								</>
							) : (
								<>
									<ArrowRight className="h-4 w-4" /> Next Question
								</>
							)}
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Info footer */}
			<div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
				<span className="flex items-center gap-1">
					<Shield className="h-3 w-3" /> Anti-cheat monitored
				</span>
				<span className="flex items-center gap-1">
					<Sparkles className="h-3 w-3" /> AI-scored
				</span>
				<span className="flex items-center gap-1">
					<BarChart3 className="h-3 w-3" /> Adaptive difficulty
				</span>
			</div>
		</div>
	);
}
