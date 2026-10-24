import { AlertTriangle, ArrowRight, CheckCircle, Clock, Trophy, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
	ExitDialog,
	FullscreenWarning,
	TimerStatusAnnouncer,
	useFullscreenPolicy,
	type ExitAction,
} from '@/components/assessments/exit-fullscreen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { apiCall } from '@/lib/api';

interface Question {
	id: number;
	text: string;
	type: string;
	options?: string[];
	timeLimit: number;
	questionNumber: number;
	totalQuestions: number;
}

interface AnswerResult {
	completed: boolean;
	feedback: string;
	explanation: string;
	aiFeedback?: string;
	score?: number;
	// Phase A (#1602): /answer records the answer and acknowledges it; the
	// next question is fetched separately via /session/:id/current, so a
	// next-question failure can never lose or re-present a recorded answer.
	answerRecorded?: boolean;
	nextQuestion?: Question;
}

type ApiError = Error & { code?: string; status?: number; answerRecorded?: boolean };

interface SessionCurrentResponse {
	status: string;
	skillName: string;
	question?: Question;
	score?: number | null;
	passed?: boolean;
	antiCheatScore?: number | null;
	durationSeconds?: number;
	maxDifficultyReached?: number;
	// Phase B read-backs (§7.3)
	currentDraft?: { questionId: number; answer: string } | null;
	fullscreenExitsUsed?: number;
	partial?: boolean;
	answersGiven?: number;
	totalQuestions?: number;
	correctCount?: number | null;
	autoSubmittedFullscreen?: boolean;
	// #1654 (C2): the session configuration snapshot fields the server
	// sends on both /current branches (null on legacy NULL-config
	// sessions). GAP-3 keys the instructions block off their presence;
	// GAP-4 reads verifiedEligible defensively — no merged server
	// response sends it today, so it stays undefined and the Verified
	// label never renders until the server actually says so.
	format?: string | null;
	difficultyBand?: string | null;
	verifiedEligible?: boolean;
}

interface CompletionInfo {
	partial: boolean;
	answersGiven: number;
	totalQuestions: number;
	correctCount: number | null;
	autoSubmittedFullscreen: boolean;
	// GAP-4: true ONLY when a response field said so — never derived.
	verifiedEligible: boolean;
}

interface SessionConfig {
	format: string;
	difficultyBand: string | null;
	totalQuestions: number;
}

const FORMAT_LABELS: Record<string, string> = {
	// Candidate labels per UX spec §0.2 — identical strings to
	// assessment-configure.tsx FORMATS (#1679 / #1689).
	mcq: 'Multiple choice',
	short_answer: 'Written answers',
	mixed: 'Mixed — multiple choice and written answers',
	coding: 'Coding',
};

const BAND_COPY: Record<string, { label: string; range: string }> = {
	easy: { label: 'Easy', range: 'levels 1–2' },
	medium: { label: 'Medium', range: 'levels 2–4' },
	hard: { label: 'Hard', range: 'levels 4–5' },
};

export function AssessmentTakePage() {
	const { id: sessionId } = useParams();
	const navigate = useNavigate();
	const [question, setQuestion] = useState<Question | null>(null);
	const [selectedAnswer, setSelectedAnswer] = useState('');
	const [shortAnswer, setShortAnswer] = useState('');
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	// #1602 (FR-A1/A2): submission outcomes are inline and honest — never a
	// bare alert, never a spinner that never resolves. submitError: the
	// answer could not be confirmed saved; it stays on screen for retry.
	// navNotice: the answer WAS saved; only loading the next step failed.
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [navNotice, setNavNotice] = useState<string | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [completed, setCompleted] = useState(false);
	const [finalScore, setFinalScore] = useState(0);
	const [passed, setPassed] = useState(false);
	const [timeLeft, setTimeLeft] = useState(0);
	const [skillName, setSkillName] = useState('');
	// S-111 (#836): null until the server returns a computed value — absent
	// means "not computed", never a default 100.
	const [antiCheatScore, setAntiCheatScore] = useState<number | null>(null);
	const [durationSeconds, setDurationSeconds] = useState(0);
	const [maxDifficulty, setMaxDifficulty] = useState(0);
	const startTimeRef = useRef(Date.now());

	// Phase B state: instructions gate, exit dialog, end states.
	const [begun, setBegun] = useState(false);
	// GAP-3: the session's configuration snapshot, when one exists.
	const [sessionConfig, setSessionConfig] = useState<SessionConfig | null>(null);
	const [exitOpen, setExitOpen] = useState(false);
	const [exitBusy, setExitBusy] = useState(false);
	const [exitError, setExitError] = useState<string | null>(null);
	const [exited, setExited] = useState(false);
	const [completionInfo, setCompletionInfo] = useState<CompletionInfo | null>(null);
	const [autoSubmitFailed, setAutoSubmitFailed] = useState(false);
	const [timerAnnouncement, setTimerAnnouncement] = useState('');
	const exitBtnRef = useRef<HTMLButtonElement>(null);
	const dialogFromWarningRef = useRef(false);
	const exitsRestoreRef = useRef<number>(0);
	const interactionRef = useRef<() => void>(() => {});

	const logEvent = useCallback(
		(eventType: string, eventData?: Record<string, unknown>) => {
			if (!sessionId) return;
			apiCall('/assessments/event', {
				method: 'POST',
				body: { sessionId: Number(sessionId), eventType, eventData: eventData || {} },
			}).catch(() => {});
		},
		[sessionId],
	);

	const applyCurrent = useCallback(
		(result: SessionCurrentResponse) => {
			if (result.status === 'completed') {
				setCompleted(true);
				setFinalScore(result.score || 0);
				setPassed(result.passed || false);
				setSkillName(result.skillName || '');
				setAntiCheatScore(result.antiCheatScore ?? null);
				setDurationSeconds(result.durationSeconds || 0);
				setMaxDifficulty(result.maxDifficultyReached || 0);
				setCompletionInfo({
					partial: result.partial === true,
					answersGiven: result.answersGiven ?? 0,
					totalQuestions: result.totalQuestions ?? 10,
					correctCount: result.correctCount ?? null,
					autoSubmittedFullscreen: result.autoSubmittedFullscreen === true,
					verifiedEligible: result.verifiedEligible === true,
				});
				return 'completed';
			}
			if (result.status === 'in_progress' && result.question) {
				if (result.format) {
					setSessionConfig({
						format: result.format,
						difficultyBand: result.difficultyBand ?? null,
						totalQuestions: result.question.totalQuestions,
					});
				}
				setQuestion(result.question);
				setSkillName(result.skillName || '');
				setTimeLeft(result.question.timeLimit || 120);
				startTimeRef.current = Date.now();
				if (typeof result.fullscreenExitsUsed === 'number') {
					exitsRestoreRef.current = result.fullscreenExitsUsed;
				}
				// Phase B (§8.2): a stored draft is restored onto its question,
				// still unanswered — it is submitted only by pressing Next.
				if (result.currentDraft && result.currentDraft.questionId === result.question.id) {
					if (result.question.type === 'multiple_choice') setSelectedAnswer(result.currentDraft.answer);
					else setShortAnswer(result.currentDraft.answer);
				}
				return 'question';
			}
			return 'other';
		},
		[],
	);

	const loadSession = useCallback(async () => {
		setLoadError(null);
		try {
			// Try sessionStorage first (set by assessments page when starting)
			const stored = sessionStorage.getItem(`assessment_${sessionId}`);
			if (stored) {
				const data = JSON.parse(stored);
				if (data.config?.format) setSessionConfig(data.config as SessionConfig);
				setQuestion(data.question);
				setSkillName(data.skillName || '');
				sessionStorage.removeItem(`assessment_${sessionId}`);
				setTimeLeft(data.question.timeLimit || 120);
				startTimeRef.current = Date.now();
				setLoading(false);
				return;
			}

			// Fallback: fetch current session state from API (handles page refresh)
			const result = await apiCall<SessionCurrentResponse>(
				`/assessments/session/${sessionId}/current`,
				{ timeoutMs: 30000 },
			);

			if (applyCurrent(result) === 'other') {
				// Session abandoned or not found
				navigate('/candidate/assessments');
			}
		} catch (err) {
			const apiErr = err as ApiError;
			if (apiErr.status === 404) {
				navigate('/candidate/assessments');
			} else {
				// #1606: the session may be perfectly fine — only the question
				// supply failed. Stay here with the reason and a Retry instead
				// of bouncing the candidate back to the list.
				setLoadError(
					apiErr.message ||
						'Your progress is saved, but this assessment could not be loaded. Please retry.',
				);
			}
		} finally {
			setLoading(false);
		}
	}, [sessionId, navigate, applyCurrent]);

	useEffect(() => {
		loadSession();
	}, [loadSession]);

	const showCompleted = useCallback(
		async (fallbackScore?: number) => {
			// Fetch full results from API for accurate display
			try {
				const fullResult = await apiCall<SessionCurrentResponse>(
					`/assessments/session/${sessionId}/current`,
					{ timeoutMs: 30000 },
				);
				setFinalScore(fullResult.score || fallbackScore || 0);
				// GAP-4: pass/fail is the SERVER's passed field — never
				// reconstructed from the score on any path.
				setPassed(fullResult.passed === true);
				setAntiCheatScore(fullResult.antiCheatScore ?? null);
				setDurationSeconds(fullResult.durationSeconds || 0);
				setMaxDifficulty(fullResult.maxDifficultyReached || 0);
				setCompletionInfo({
					partial: fullResult.partial === true,
					answersGiven: fullResult.answersGiven ?? 0,
					totalQuestions: fullResult.totalQuestions ?? 10,
					correctCount: fullResult.correctCount ?? null,
					autoSubmittedFullscreen: fullResult.autoSubmittedFullscreen === true,
					verifiedEligible: fullResult.verifiedEligible === true,
				});
			} catch {
				setFinalScore(fallbackScore || 0);
				// The result could not be read back — do not guess a pass
				// from the score; the block renders "Not passed" with no
				// score text (GAP-4 fail labelling).
				setPassed(false);
			}
			setCompleted(true);
			// Redirect to results page after a short delay
			setTimeout(() => {
				navigate(`/candidate/assessment-results?session=${sessionId}`);
			}, 2000);
		},
		[sessionId, navigate],
	);

	// After an answer is recorded, load what comes next. A failure here is a
	// NAVIGATION outcome (FR-A5): the answer is already saved, so the
	// candidate gets a retry affordance — never an error as the result of
	// their submission, and never a lost answer.
	const advanceToNext = useCallback(
		async (timedOut = false) => {
			try {
				const current = await apiCall<SessionCurrentResponse>(
					`/assessments/session/${sessionId}/current`,
					{ timeoutMs: 30000 },
				);
				if (current.status === 'completed') {
					await showCompleted(current.score ?? undefined);
					return;
				}
				if (current.status === 'in_progress' && current.question) {
					setNavNotice(null);
					setQuestion(current.question);
					setSelectedAnswer('');
					setShortAnswer('');
					setTimeLeft(current.question.timeLimit || 120);
					startTimeRef.current = Date.now();
					return;
				}
				setNavNotice(
					'Your answer was saved. We could not load the next step — please retry.',
				);
			} catch {
				setNavNotice(
					timedOut
						? 'Time expired and your answer was saved. We could not load the next question — please retry.'
						: 'Your answer was saved. We could not load the next question — please retry.',
				);
			}
		},
		[sessionId, showCompleted],
	);

	const handleSubmit = useCallback(
		async (timedOut = false) => {
			if (!question || submitting) return;
			interactionRef.current();
			setSubmitting(true);
			setSubmitError(null);
			setNavNotice(null);
			const timeTaken = Math.round((Date.now() - startTimeRef.current) / 1000);
			const answer = question.type === 'multiple_choice' ? selectedAnswer : shortAnswer;

			if (!answer && !timedOut) {
				setSubmitting(false);
				return;
			}

			try {
				// FR-A2: bounded at 30s — the spinner always resolves.
				const result = await apiCall<AnswerResult>('/assessments/answer', {
					method: 'POST',
					timeoutMs: 30000,
					body: {
						sessionId: Number(sessionId),
						questionId: question.id,
						answer: answer || '(no answer)',
						timeTaken,
					},
				});

				if (result.completed) {
					await showCompleted(result.score);
				} else if (result.nextQuestion) {
					// Backwards-compatible shape (older server): advance inline.
					setQuestion(result.nextQuestion);
					setSelectedAnswer('');
					setShortAnswer('');
					setTimeLeft(result.nextQuestion.timeLimit || 120);
					startTimeRef.current = Date.now();
				} else {
					await advanceToNext(timedOut);
				}
			} catch (err) {
				const apiErr = err as ApiError;
				if (apiErr.answerRecorded) {
					// The answer reached the server; only the follow-up failed.
					await advanceToNext(timedOut);
				} else if (apiErr.code === 'TIMEOUT') {
					setSubmitError(
						'This took too long, so we could not confirm whether your answer was saved. Your answer is still on this screen — press Next to retry. It will not be counted twice.',
					);
				} else {
					setSubmitError(
						`${apiErr.message || 'Failed to submit answer.'} Your answer is still on this screen — press Next to retry.`,
					);
				}
			} finally {
				setSubmitting(false);
			}
		},
		[question, selectedAnswer, shortAnswer, sessionId, submitting, showCompleted, advanceToNext],
	);
	// ---------- Phase B: full-screen policy + the unified Exit dialog ----------
	const answersGivenCount = question ? Math.max(0, question.questionNumber - 1) : 0;
	const totalQuestionsCount = question?.totalQuestions || 10;

	const runExit = useCallback(
		async (action: ExitAction, reason?: string): Promise<boolean> => {
			if (!question) return false;
			const draftAnswer = question.type === 'multiple_choice' ? selectedAnswer : shortAnswer;
			try {
				const result = await apiCall<{
					status: string;
					answersGiven: number;
					totalQuestions: number;
					partial?: boolean;
					score?: number | null;
					correctCount?: number | null;
					fullscreenAutoSubmit?: boolean;
				}>(`/assessments/session/${sessionId}/exit`, {
					method: 'POST',
					timeoutMs: 30000,
					body: {
						action,
						reason,
						draft:
							action === 'save' && draftAnswer
								? { questionId: question.id, answer: draftAnswer }
								: undefined,
					},
				});
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
				// submit
				fsRef.current.setLeavingIntentionally();
				setCompletionInfo({
					partial: result.partial === true,
					answersGiven: result.answersGiven,
					totalQuestions: result.totalQuestions,
					correctCount: result.correctCount ?? null,
					autoSubmittedFullscreen: result.fullscreenAutoSubmit === true,
					verifiedEligible: false,
				});
				await showCompleted(result.score ?? undefined);
				return true;
			} catch (err) {
				const apiErr = err as ApiError;
				if (apiErr.code === 'ALREADY_FINISHED' || apiErr.status === 409) {
					// A racing terminal action already finished the attempt —
					// follow the server's resulting state, not our intention.
					fsRef.current.setLeavingIntentionally();
					const current = await apiCall<SessionCurrentResponse>(
						`/assessments/session/${sessionId}/current`,
						{ timeoutMs: 30000 },
					).catch(() => null);
					if (current?.status === 'completed') await showCompleted(current.score ?? undefined);
					else if (current?.status === 'abandoned') setExited(true);
					else navigate('/candidate/assessments');
					return true;
				}
				return false;
			}
		},
		[question, selectedAnswer, shortAnswer, sessionId, navigate, showCompleted],
	);

	const fs = useFullscreenPolicy({
		log: logEvent,
		modalOpen: exitOpen,
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

	// Restore the exits-used count from the server read-back (refresh-safe).
	useEffect(() => {
		if (exitsRestoreRef.current > 0) fs.restoreExitsUsed(exitsRestoreRef.current);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [question?.id]);

	const paused = exitOpen || fs.warningOpen || autoSubmitFailed;
	const pausedRef = useRef(false);
	useEffect(() => {
		if (paused && !pausedRef.current) {
			setTimerAnnouncement('Timer paused.');
			logEvent('timer_pause_start', { answersGiven: answersGivenCount });
		} else if (!paused && pausedRef.current) {
			setTimerAnnouncement('Timer resumed.');
			logEvent('timer_pause_end', { answersGiven: answersGivenCount });
		}
		pausedRef.current = paused;
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
		// From the warning, Continue returns to the warning (still out of
		// full-screen) — never silently back into the test (CX condition).
		if (dialogFromWarningRef.current) {
			dialogFromWarningRef.current = false;
			fsRef.current.reopenWarning();
		} else {
			// Focus returns to the control that opened the dialog.
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
				// §6.1: no navigation, no pretend terminal state — stay in the
				// test with the draft intact and a plain retryable error.
				setExitError(
					"We couldn't do that right now — check your connection and try again. Your answers so far are already saved.",
				);
			}
		},
		[runExit],
	);

	// Timer countdown — Phase B (§5.3): the interval is the only auto-submit
	// driver, and it stops while the Exit dialog, the full-screen warning,
	// or the auto-submit failure notice is open. timeLeft is preserved, so
	// a pause never gifts or burns question time.
	useEffect(() => {
		if (!question || completed || timeLeft <= 0 || !begun || paused) return;
		const timer = setInterval(() => {
			setTimeLeft((prev) => {
				if (prev <= 1) {
					clearInterval(timer);
					handleSubmit(true);
					return 0;
				}
				return prev - 1;
			});
		}, 1000);
		return () => clearInterval(timer);
	}, [question, completed, timeLeft, handleSubmit, begun, paused]);

	// Track tab switches
	useEffect(() => {
		function handleVisibility() {
			if (document.hidden && sessionId) {
				apiCall('/assessments/event', {
					method: 'POST',
					body: {
						sessionId: Number(sessionId),
						eventType: 'tab_switch',
						eventData: { timestamp: new Date() },
					},
				}).catch(() => {});
			}
		}
		document.addEventListener('visibilitychange', handleVisibility);
		return () => document.removeEventListener('visibilitychange', handleVisibility);
	}, [sessionId]);

	// Track copy-paste
	useEffect(() => {
		function handleCopy() {
			if (sessionId) {
				apiCall('/assessments/event', {
					method: 'POST',
					body: {
						sessionId: Number(sessionId),
						eventType: 'copy_paste',
						eventData: { timestamp: new Date() },
					},
				}).catch(() => {});
			}
		}
		document.addEventListener('copy', handleCopy);
		document.addEventListener('paste', handleCopy);
		return () => {
			document.removeEventListener('copy', handleCopy);
			document.removeEventListener('paste', handleCopy);
		};
	}, [sessionId]);

	if (loading) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[80vh] gap-4">
				<div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
				<div className="font-heading text-xl font-semibold">Preparing Your Assessment</div>
				<div className="text-muted-foreground">AI is generating personalized questions...</div>
			</div>
		);
	}

	// Completed view with detailed results
	if (completed) {
		// GAP-4: isPassed is the server's passed field only (set in
		// applyCurrent/showCompleted) — never score-derived.
		const isPassed = passed;
		const mins = Math.floor((durationSeconds || 0) / 60);
		const info = completionInfo;
		const isPartial = info?.partial === true;
		return (
			<div className="max-w-lg mx-auto py-8 px-4 sm:px-6">
				<Card>
					<CardContent className="p-8 text-center">
						{isPartial ? (
							<CheckCircle className="mx-auto h-16 w-16 text-primary mb-4" />
						) : isPassed ? (
							<Trophy className="mx-auto h-16 w-16 text-emerald-500 mb-4" />
						) : (
							<XCircle className="mx-auto h-16 w-16 text-destructive mb-4" />
						)}
						<h2 className="font-heading text-2xl font-bold mb-2">
							{isPartial ? 'Partial result' : isPassed ? 'Assessment Passed!' : 'Assessment Complete'}
						</h2>
						{info?.autoSubmittedFullscreen && (
							<p className="text-muted-foreground mb-2">
								Submitted automatically after leaving full-screen twice. {info.answersGiven} of{' '}
								{info.totalQuestions} questions answered.
							</p>
						)}
						{isPartial ? (
							<>
								{info.answersGiven === 0 ? (
									<p className="text-muted-foreground mb-6">
										You submitted with no questions answered, so there is no score.
									</p>
								) : (
									<>
										<p className="text-muted-foreground mb-4">
											You answered {info.answersGiven} of {info.totalQuestions} questions. Your
											result is based only on those {info.answersGiven} answered questions:{' '}
											{info.correctCount ?? 0} of {info.answersGiven} correct. The other{' '}
											{info.totalQuestions - info.answersGiven} questions were not counted.
											Because this result is partial, it is not a pass, it does not earn
											Verified, and it does not count toward your OmniScore.
										</p>
										<div className="text-3xl font-bold mb-6">
											{info.correctCount ?? 0} of {info.answersGiven} answered correct
										</div>
									</>
								)}
								<Badge variant="secondary" className="text-sm mb-6">
									Partial — answered {info.answersGiven} of {info.totalQuestions}
								</Badge>
							</>
						) : isPassed ? (
							<>
								<p className="text-muted-foreground mb-6">
									{skillName && `${skillName} - `}
									{info?.verifiedEligible
										? 'Great job! Your skill has been verified.'
										: 'You passed this assessment.'}
								</p>
								<div className="text-5xl font-bold mb-6">
									<span className="text-emerald-600">{finalScore}</span>
									<span className="text-muted-foreground text-lg">/100</span>
								</div>
								{/* GAP-4: the Verified string appears ONLY when a
								    response field said verifiedEligible === true. */}
								<Badge variant="success" className="text-sm mb-6">
									{info?.verifiedEligible ? 'Passed · Verified ✓' : 'Passed'}
								</Badge>
							</>
						) : (
							<>
								{/* GAP-4: a failed attempt shows NO raw score text. */}
								<p className="text-muted-foreground mb-6">
									{skillName && `${skillName} - `}Keep practicing and try again.
								</p>
								<Badge variant="destructive" className="text-sm mb-6">
									Not passed
								</Badge>
							</>
						)}

						{/* Detailed stats */}
						<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6 text-sm">
							{durationSeconds > 0 && (
								<div className="rounded-lg bg-muted/50 p-3">
									<p className="font-medium">
										{mins}m {Math.round((durationSeconds || 0) % 60)}s
									</p>
									<p className="text-xs text-muted-foreground">Duration</p>
								</div>
							)}
							{maxDifficulty > 0 && (
								<div className="rounded-lg bg-muted/50 p-3">
									<p className="font-medium">{maxDifficulty}/5</p>
									<p className="text-xs text-muted-foreground">Max Difficulty</p>
								</div>
							)}
							{antiCheatScore !== null && (
							<div className="rounded-lg bg-muted/50 p-3">
								<p
									className={`font-medium ${antiCheatScore >= 80 ? 'text-emerald-600' : antiCheatScore >= 50 ? 'text-amber-600' : 'text-destructive'}`}
								>
									{antiCheatScore}%
								</p>
								<p className="text-xs text-muted-foreground">Integrity</p>
							</div>
						)}
						</div>

						<div className="flex gap-2 justify-center">
							<Button onClick={() => navigate('/candidate/assessments')} className="min-h-[44px]">
								Back to Assessments
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	// Phase B: Exit Exam end state — honest, scoreless, everywhere.
	if (exited) {
		return (
			<div className="max-w-lg mx-auto py-8 px-4 sm:px-6">
				<Card>
					<CardContent className="p-8 text-center">
						<h2 className="font-heading text-2xl font-bold mb-2">Exited — not scored</h2>
						<p className="text-muted-foreground mb-6">
							{skillName ? `${skillName} — ` : ''}You exited this test. Your answers were not
							marked and there is no score for this attempt. You can start a fresh attempt
							whenever you are ready — there is no waiting period.
						</p>
						<Button onClick={() => navigate('/candidate/assessments')} className="min-h-[44px]">
							Back to Assessments
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (!question && loadError) {
		return (
			<div className="py-16 text-center px-4 sm:px-6 max-w-lg mx-auto">
				<AlertTriangle className="mx-auto h-10 w-10 text-amber-500 mb-4" />
				<p className="font-medium mb-2">This assessment could not be loaded</p>
				<p className="text-muted-foreground text-sm">{loadError}</p>
				<div className="flex gap-2 justify-center mt-4">
					<Button className="min-h-[44px]" onClick={() => { setLoading(true); loadSession(); }}>
						Retry
					</Button>
					<Button variant="outline" className="min-h-[44px]" onClick={() => navigate('/candidate/assessments')}>
						Back to Assessments
					</Button>
				</div>
			</div>
		);
	}

	if (!question) {
		return (
			<div className="py-16 text-center px-4 sm:px-6">
				<p className="text-muted-foreground">Assessment session not found</p>
				<Button className="mt-4 min-h-[44px]" onClick={() => navigate('/candidate/assessments')}>
					Back to Assessments
				</Button>
			</div>
		);
	}

	// GAP-3 (#1654 addendum): exactly ONE instructions block renders in
	// every state. A session WITH a configuration snapshot renders the
	// snapshot block below (the configuration the candidate chose, in
	// plain language, plus the same rule disclosures); a session WITHOUT
	// one (legacy start, NULL-config in-flight) renders the Phase B gate
	// after it. Never both, never neither.
	if (!begun && sessionConfig) {
		const bandCopy = sessionConfig.difficultyBand ? BAND_COPY[sessionConfig.difficultyBand] : null;
		return (
			<div className="max-w-2xl mx-auto py-8 px-4 sm:px-6">
				<Card>
					<CardContent className="p-6 space-y-4">
						<h2 className="font-heading text-xl font-bold">Before you start</h2>
						<p className="text-sm">
							Your configuration: <strong>{skillName}</strong> ·{' '}
							<strong>{FORMAT_LABELS[sessionConfig.format] || sessionConfig.format}</strong> ·{' '}
							<strong>{sessionConfig.totalQuestions} questions</strong>
							{bandCopy && (
								<>
									{' '}
									· <strong>{bandCopy.label}</strong> — questions adapt within the{' '}
									{bandCopy.label} band only ({bandCopy.range}), based on your answers.
								</>
							)}
						</p>
						<ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
							<li>
								You have <strong>{question.timeLimit || 120} seconds per question</strong>.
								When a question's time runs out, that question is submitted with the answer
								you have chosen — or recorded as unanswered — and the test moves on.
							</li>
							<li>
								<strong>An answer is saved when you press Next.</strong> An answer you have
								chosen or typed but not submitted with Next is a draft, not a saved answer.
							</li>
							<li>
								<strong>This test runs in full-screen.</strong> Leaving full-screen once shows
								a warning and pauses your timer.{' '}
								<strong>Leaving a second time submits your test immediately</strong>, using
								only the answers you have already saved.
							</li>
							<li>
								<strong>You can leave at any time with the Exit button.</strong> You can save
								and resume later, submit the answers you have saved so far, or exit the exam
								without a score. Nothing about leaving is hidden — each option explains itself
								before you choose it.
							</li>
							{/* #1689: the AI-scoring disclosure applies ONLY when the
							    chosen format includes written answers — an MCQ-only test
							    must not claim it (same gate as configure, #1679 item 3). */}
							{(sessionConfig.format === 'mixed' || sessionConfig.format === 'short_answer') && (
								<li>Short answers are scored by AI and reviewed by a human.</li>
							)}
						</ul>
						<div className="flex flex-col gap-2">
							<Button
								className="min-h-[44px]"
								onClick={async () => {
									await fs.enterFullscreen();
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

	// Phase B instructions gate (§9.1): every rule is disclosed BEFORE the
	// first question — nothing enforced mid-test is absent from this screen.
	// The Start click is the browser gesture full-screen requires; the
	// explicit opt-out (a11y Block 3) is unpenalised and equivalent.
	if (!begun) {
		return (
			<div className="max-w-2xl mx-auto py-8 px-4 sm:px-6">
				<Card>
					<CardContent className="p-6 space-y-4">
						<h2 className="font-heading text-xl font-bold">Before you start</h2>
						<ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
							<li>
								This test has <strong>{question.totalQuestions} questions</strong>. You have{' '}
								<strong>{question.timeLimit || 120} seconds per question</strong>. When a
								question's time runs out, that question is submitted with the answer you have
								chosen — or recorded as unanswered — and the test moves on.
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
							<li>If your test includes written answers, they are scored by AI and reviewed by a human.</li>
						</ul>
						<div className="flex flex-col gap-2">
							<Button
								className="min-h-[44px]"
								onClick={async () => {
									await fs.enterFullscreen();
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

	return (
		<div className="max-w-2xl mx-auto space-y-4 px-4 sm:px-6">
			<TimerStatusAnnouncer message={timerAnnouncement} />
			{/* Progress header */}
			<div className="flex items-center justify-between">
				<div>
					<span className="text-sm font-medium">
						Question {question.questionNumber} of {question.totalQuestions}
					</span>
					{skillName && <span className="text-sm text-muted-foreground ml-2">- {skillName}</span>}
				</div>
				<div className="flex items-center gap-2">
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
					<Badge variant={isLowTime ? 'destructive' : 'secondary'} className="gap-1 font-mono">
						<Clock className="h-3 w-3" />
						{minutes}:{seconds.toString().padStart(2, '0')}
					</Badge>
				</div>
			</div>

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

			{/* AI disclosure (#343 task 5) — #1707: claim AI scoring only when the
			    format includes written answers; legacy (null config) sessions get
			    the conditional wording; MCQ/coding sessions render nothing. */}
			{sessionConfig === null ? (
				<div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
					<AlertTriangle className="h-4 w-4 shrink-0" />
					<span>If your test includes written answers, they are scored by AI and reviewed by a human.</span>
				</div>
			) : sessionConfig.format === 'mixed' || sessionConfig.format === 'short_answer' ? (
				<div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
					<AlertTriangle className="h-4 w-4 shrink-0" />
					<span>This assessment is scored by AI and reviewed by a human.</span>
				</div>
			) : null}

			{/* Progress bar */}
			<div className="h-2 rounded-full bg-muted overflow-hidden">
				<div
					className="h-full bg-primary transition-all duration-300 rounded-full"
					style={{ width: `${(question.questionNumber / question.totalQuestions) * 100}%` }}
				/>
			</div>

			{/* Question */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base leading-relaxed">{question.text}</CardTitle>
				</CardHeader>
				<CardContent>
					{question.type === 'multiple_choice' && question.options ? (
						<div className="space-y-2">
							{question.options.map((option, i) => (
								<button type="button"
									key={option}
									onClick={() => {
										interactionRef.current();
										setSelectedAnswer(option);
									}}
									className={`w-full text-left rounded-lg border p-3 text-sm transition-colors min-h-[44px] ${
										selectedAnswer === option
											? 'border-primary bg-primary/5 ring-1 ring-primary'
											: 'hover:bg-muted'
									}`}
								>
									<span className="font-medium text-muted-foreground mr-2">
										{String.fromCharCode(65 + i)}.
									</span>
									{option}
								</button>
							))}
						</div>
					) : (
						<Textarea
							value={shortAnswer}
							onChange={(e) => {
								interactionRef.current();
								setShortAnswer(e.target.value);
							}}
							placeholder="Type your answer here..."
							rows={6}
							className="font-mono text-sm min-h-[44px]"
						/>
					)}
				</CardContent>
			</Card>

			{/* Submission outcomes (#1602): inline, honest, always with a next action */}
			{submitError && (
				<div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
					<AlertTriangle className="h-4 w-4 shrink-0" />
					<span>{submitError}</span>
				</div>
			)}
			{navNotice ? (
				<div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
					<span className="flex items-center gap-2">
						<AlertTriangle className="h-4 w-4 shrink-0" />
						{navNotice}
					</span>
					<Button
						variant="outline"
						className="min-h-[44px] shrink-0"
						disabled={submitting}
						onClick={async () => {
							setSubmitting(true);
							await advanceToNext(false);
							setSubmitting(false);
						}}
					>
						{submitting ? 'Loading…' : 'Retry'}
					</Button>
				</div>
			) : (
				/* Submit */
				<div className="flex justify-end">
					<Button
						onClick={() => handleSubmit(false)}
						disabled={submitting || (!selectedAnswer && !shortAnswer)}
						className="gap-2 min-h-[44px]"
					>
						{submitting ? (
							<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
						) : question.questionNumber === question.totalQuestions ? (
							<CheckCircle className="h-4 w-4" />
						) : (
							<ArrowRight className="h-4 w-4" />
						)}
						{question.questionNumber === question.totalQuestions ? 'Finish' : 'Next'}
					</Button>
				</div>
			)}

			{isLowTime && (
				<div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
					<AlertTriangle className="h-4 w-4 shrink-0" />
					Time is running out! Answer will be auto-submitted when time expires.
				</div>
			)}
		</div>
	);
}
