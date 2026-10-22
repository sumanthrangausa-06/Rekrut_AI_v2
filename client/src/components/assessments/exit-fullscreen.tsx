import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/* Phase B (#1604/#1605): the unified assessment Exit dialog + full-screen
 * policy, shared verbatim by the skill runner and the assigned job runner
 * (design: design-assessment-exit-fullscreen.md §3/§5/§9, as amended by the
 * STOP 1 Candidate Experience + accessibility reviews).
 *
 * Accessibility contract (a11y conditions, binding):
 * - Both modals are role="alertdialog" aria-modal with labelledby/describedby,
 *   a real focus trap, and render inside the runner's root element (which is
 *   inside the full-screen subtree — a portal outside it would be invisible
 *   in full-screen).
 * - Exit dialog: initial focus on Continue Test (never the destructive
 *   option); Esc = Continue Test, stated in visible text. The 30s
 *   auto-resume NEVER fires while the dialog has focus or is interacted
 *   with — any interaction resets the countdown (WCAG 2.2.1).
 * - Warning: initial focus on the heading; Esc does NOTHING there (the
 *   browser reserves Esc for full-screen exit, so an Esc there is the exit
 *   itself, never a dismissal and never a second exit).
 * - Full-screen exits are counted ONLY from the in-test state, and the
 *   counter cannot advance to auto-submit until the candidate has
 *   interacted with a question again after re-entry — an exit before that
 *   interaction re-shows the warning with the count unchanged.
 * - Timer pause/resume is announced through a visually-hidden polite
 *   status region; the ticking countdown is never live-announced.
 */

export type ExitAction = 'save' | 'submit' | 'abandon';

interface ExitDialogProps {
	open: boolean;
	answersGiven: number;
	totalQuestions: number;
	/** Job runner only: Save & Exit is refused after the assignment due date. */
	dueDateNote?: boolean;
	busy: boolean;
	error: string | null;
	onContinue: () => void;
	onExit: (action: ExitAction) => void;
}

export function ExitDialog({
	open,
	answersGiven,
	totalQuestions,
	dueDateNote,
	busy,
	error,
	onContinue,
	onExit,
}: ExitDialogProps) {
	const [confirmingAbandon, setConfirmingAbandon] = useState(false);
	const [secondsLeft, setSecondsLeft] = useState(30);
	// Mirror of secondsLeft for the tick decision — the countdown's fire
	// decision is made OUTSIDE any state updater (fix round F6: side
	// effects inside an updater can double-fire under StrictMode).
	const secondsRef = useRef(30);
	const rootRef = useRef<HTMLDivElement>(null);
	const continueRef = useRef<HTMLButtonElement>(null);
	const confirmHeadingRef = useRef<HTMLHeadingElement>(null);

	// Reset per opening.
	useEffect(() => {
		if (open) {
			setConfirmingAbandon(false);
			secondsRef.current = 30;
			setSecondsLeft(30);
			// Initial focus: Continue Test — the safe outcome, never Exit Exam.
			setTimeout(() => continueRef.current?.focus(), 0);
		}
	}, [open ]);

	// Step swap: focus follows the confirmation heading.
	useEffect(() => {
		if (confirmingAbandon) confirmHeadingRef.current?.focus();
	}, [confirmingAbandon]);

	// 30s auto-resume (D6) with the WCAG 2.2.1 amendment: any interaction
	// resets the countdown, and it never fires while focus is inside.
	// The tick reads/writes secondsRef and decides here — never inside a
	// setState updater (fix round F6).
	useEffect(() => {
		if (!open) return;
		let fired = false;
		const id = setInterval(() => {
			if (fired) return;
			if (secondsRef.current <= 1) {
				const root = rootRef.current;
				if (root && root.contains(document.activeElement)) {
					secondsRef.current = 30;
					setSecondsLeft(30);
					return;
				}
				fired = true;
				clearInterval(id);
				onContinue();
				return;
			}
			secondsRef.current -= 1;
			setSecondsLeft(secondsRef.current);
		}, 1000);
		return () => clearInterval(id);
	}, [open, onContinue]);

	// Focus trap + Esc (= Continue) + interaction resets the countdown.
	useEffect(() => {
		if (!open) return;
		const root = rootRef.current;
		if (!root) return;
		const reset = () => {
			secondsRef.current = 30;
			setSecondsLeft(30);
		};
		const onKey = (e: KeyboardEvent) => {
			reset();
			if (e.key === 'Escape') {
				e.preventDefault();
				onContinue();
				return;
			}
			if (e.key !== 'Tab') return;
			const focusables = root.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled])',
			);
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};
		root.addEventListener('keydown', onKey);
		root.addEventListener('pointerdown', reset);
		return () => {
			root.removeEventListener('keydown', onKey);
			root.removeEventListener('pointerdown', reset);
		};
	}, [open, onContinue, confirmingAbandon]);

	if (!open) return null;

	return (
		<div
			ref={rootRef}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="exit-dialog-heading"
			aria-describedby="exit-dialog-desc"
		>
			<div className="w-full max-w-md rounded-xl bg-background p-6 shadow-xl max-h-[90vh] overflow-y-auto">
				{!confirmingAbandon ? (
					<>
						<h2 id="exit-dialog-heading" className="font-heading text-xl font-bold mb-1">
							Leave this test?
						</h2>
						<div id="exit-dialog-desc" className="text-sm text-muted-foreground space-y-1 mb-4">
							<p>Your timer is paused while you decide.</p>
							<p>
								If you don't choose, this closes in{' '}
								<span aria-hidden="true">{secondsLeft} seconds</span>
								<span className="sr-only">30 seconds</span> and your test continues.
							</p>
							<p>Press Esc to go back to your test.</p>
						</div>
						<div className="space-y-3">
							<div>
								<Button
									ref={continueRef}
									className="w-full min-h-[44px]"
									disabled={busy}
									onClick={onContinue}
								>
									Continue Test
								</Button>
								<p className="text-xs text-muted-foreground mt-1">Go back to your test. Nothing changes.</p>
							</div>
							<div>
								<Button variant="outline" className="w-full min-h-[44px]" disabled={busy} onClick={() => onExit('save')}>
									Save &amp; Exit
								</Button>
								<p className="text-xs text-muted-foreground mt-1">
									Your saved answers are kept, and the answer you have chosen on this question is
									saved as a draft — it is not scored until you resume and press Next. You can
									resume this test later from the Assessments page
									{dueDateNote ? ', before its due date' : ''}.
								</p>
							</div>
							<div>
								<Button variant="outline" className="w-full min-h-[44px]" disabled={busy} onClick={() => onExit('submit')}>
									Submit &amp; Exit
								</Button>
								<p className="text-xs text-muted-foreground mt-1">
									{answersGiven < totalQuestions ? (
										<>
											End the test now. Only your answered questions are scored — a question
											counts only after you press Next.{' '}
											<strong>
												Partial result — answered {answersGiven} of {totalQuestions}:
											</strong>{' '}
											this cannot pass or earn Verified, and it does not count toward your
											OmniScore. You cannot resume after submitting.
										</>
									) : (
										<>
											End the test now and score the answers you have saved so far. You cannot
											resume after submitting.
										</>
									)}
								</p>
							</div>
							<div className="border-t pt-3">
								<Button
									variant="destructive"
									className="w-full min-h-[44px]"
									disabled={busy}
									onClick={() => setConfirmingAbandon(true)}
								>
									Exit Exam
								</Button>
								<p className="text-xs text-muted-foreground mt-1">
									End this test WITHOUT a score. It will show as &lsquo;Exited — not scored&rsquo;.
									Your answers are kept only as a record of this attempt and are never marked.
									This does not block you from starting a fresh attempt.
								</p>
							</div>
						</div>
					</>
				) : (
					<>
						<h2
							id="exit-dialog-heading"
							ref={confirmHeadingRef}
							tabIndex={-1}
							className="font-heading text-xl font-bold mb-2 outline-none"
						>
							Exit this exam without a score?
						</h2>
						<p id="exit-dialog-desc" className="text-sm text-muted-foreground mb-4">
							Your answers will not be marked. You can start a fresh attempt — there is no
							waiting period.
						</p>
						<div className="flex gap-2">
							<Button
								variant="destructive"
								className="flex-1 min-h-[44px]"
								disabled={busy}
								onClick={() => onExit('abandon')}
							>
								Exit Exam
							</Button>
							<Button
								variant="outline"
								className="flex-1 min-h-[44px]"
								disabled={busy}
								onClick={() => setConfirmingAbandon(false)}
							>
								Go back
							</Button>
						</div>
					</>
				)}
				{error && (
					<div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive mt-4">
						<AlertTriangle className="h-4 w-4 shrink-0" />
						<span>{error}</span>
					</div>
				)}
				{busy && <p className="text-sm text-muted-foreground mt-3">Working…</p>}
			</div>
		</div>
	);
}

interface FullscreenWarningProps {
	open: boolean;
	answersGiven: number;
	totalQuestions: number;
	onReturn: () => void;
	onReviewOptions: () => void;
	onContinueWithoutFullscreen: () => void;
}

export function FullscreenWarning({
	open,
	answersGiven,
	totalQuestions,
	onReturn,
	onReviewOptions,
	onContinueWithoutFullscreen,
}: FullscreenWarningProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);

	useEffect(() => {
		if (open) setTimeout(() => headingRef.current?.focus(), 0);
	}, [open ]);

	// Esc does NOTHING here (a11y Block 1): the browser reserves Esc for
	// full-screen exit — the Esc that produced this warning must not also
	// dismiss it, and no key may turn this episode into a second exit.
	useEffect(() => {
		if (!open) return;
		const root = rootRef.current;
		if (!root) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
			if (e.key !== 'Tab') return;
			const focusables = root.querySelectorAll<HTMLElement>('button:not([disabled])');
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};
		root.addEventListener('keydown', onKey);
		return () => root.removeEventListener('keydown', onKey);
	}, [open ]);

	if (!open) return null;

	return (
		<div
			ref={rootRef}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="fs-warning-heading"
			aria-describedby="fs-warning-desc"
		>
			<div className="w-full max-w-md rounded-xl bg-background p-6 shadow-xl">
				<h2
					id="fs-warning-heading"
					ref={headingRef}
					tabIndex={-1}
					className="font-heading text-xl font-bold mb-2 outline-none"
				>
					You left full-screen.
				</h2>
				<p id="fs-warning-desc" className="text-sm text-muted-foreground mb-4">
					Your timer is paused. Return to full-screen to continue. If you leave full-screen
					again, your test will be submitted with the answers saved so far — {answersGiven} of{' '}
					{totalQuestions} questions answered.
				</p>
				<div className="space-y-2">
					<Button className="w-full min-h-[44px]" onClick={onReturn}>
						Return to Full-Screen
					</Button>
					<Button variant="outline" className="w-full min-h-[44px]" onClick={onReviewOptions}>
						Review your options
					</Button>
					<Button variant="ghost" className="w-full min-h-[44px]" onClick={onContinueWithoutFullscreen}>
						Continue without full-screen
					</Button>
				</div>
			</div>
		</div>
	);
}

/** Visually-hidden polite announcements (timer paused/resumed). */
export function TimerStatusAnnouncer({ message }: { message: string }) {
	return (
		<div role="status" aria-live="polite" className="sr-only">
			{message}
		</div>
	);
}

export type FsMode = 'off' | 'in' | 'warning' | 'nofs';

interface UseFullscreenPolicy {
	mode: FsMode;
	exitsUsed: number;
	warningOpen: boolean;
	/** Call from the Start / Resume gesture. Resolves true if full-screen was granted. */
	enterFullscreen: () => Promise<boolean>;
	/** Candidate chose to run without full-screen (instructions or warning). */
	continueWithoutFullscreen: () => void;
	/** Warning's Return action. */
	returnToFullscreen: () => Promise<void>;
	/** Warning's Review-options action closes the warning without counting an exit. */
	closeWarningForDialog: () => void;
	/** Reopen the warning when the dialog is closed from it (Continue). */
	reopenWarning: () => void;
	/** Mark that the candidate interacted with a question since entering. */
	markInteraction: () => void;
	/** Set before any intentional full-screen exit (terminal navigation). */
	setLeavingIntentionally: () => void;
	/** Restore the exits-used count on resume (server read-back). */
	restoreExitsUsed: (n: number) => void;
}

/**
 * The §5.1 state machine, with the a11y Block 1 amendment: an exit counts
 * only from the in-test state with no modal open, and the move to
 * auto-submit additionally requires a question interaction since the last
 * granted entry. A raw exit that fails those checks is logged as
 * fullscreen_exit_repeat and simply re-shows the warning.
 */
export function useFullscreenPolicy(opts: {
	log: (eventType: string, eventData?: Record<string, unknown>) => void;
	onSecondExit: () => void;
	/**
	 * True while the Exit dialog is open (fix round F2 — a11y BLOCK 1
	 * applies to that modal too): a full-screen exit arriving in that
	 * state (the obvious case: Esc, which the dialog itself invites and
	 * which the browser also uses to leave full-screen) is NEVER counted
	 * and NEVER auto-submits — it is logged as fullscreen_exit_repeat
	 * and counting stays suspended until the dialog closes.
	 */
	modalOpen?: boolean;
}): UseFullscreenPolicy {
	const [mode, setMode] = useState<FsMode>('off');
	const [exitsUsed, setExitsUsed] = useState(0);
	const modeRef = useRef<FsMode>('off');
	const exitsRef = useRef(0);
	const interactedRef = useRef(false);
	const leavingRef = useRef(false);
	const optsRef = useRef(opts);
	optsRef.current = opts;

	const setModeBoth = useCallback((m: FsMode) => {
		modeRef.current = m;
		setMode(m);
	}, []);
	const setExitsBoth = useCallback((n: number) => {
		exitsRef.current = n;
		setExitsUsed(n);
	}, []);

	const enterFullscreen = useCallback(async () => {
		try {
			if (!document.fullscreenEnabled) throw new Error('unsupported');
			await document.documentElement.requestFullscreen();
			interactedRef.current = false;
			setModeBoth('in');
			optsRef.current.log('fullscreen_entered');
			return true;
		} catch {
			setModeBoth('nofs');
			optsRef.current.log('fullscreen_unavailable');
			return false;
		}
	}, [setModeBoth]);

	const continueWithoutFullscreen = useCallback(() => {
		setModeBoth('nofs');
		optsRef.current.log('fullscreen_opt_out');
	}, [setModeBoth]);

	const returnToFullscreen = useCallback(async () => {
		try {
			await document.documentElement.requestFullscreen();
			interactedRef.current = false;
			setModeBoth('in');
			optsRef.current.log('fullscreen_entered');
		} catch {
			setModeBoth('nofs');
			optsRef.current.log('fullscreen_unavailable');
		}
	}, [setModeBoth]);

	useEffect(() => {
		const onChange = () => {
			if (document.fullscreenElement) return; // an entry, not an exit
			if (leavingRef.current) return; // our own terminal navigation
			if (optsRef.current.modalOpen) {
				// Exit dialog open (BLOCK 1, fix round F2): never counted,
				// never an auto-submit — same repeat treatment as an exit
				// before any question interaction since re-entry.
				optsRef.current.log('fullscreen_exit_repeat');
				return;
			}
			if (modeRef.current !== 'in') return; // warning modal open / not in test
			if (exitsRef.current === 0) {
				setExitsBoth(1);
				setModeBoth('warning');
				optsRef.current.log('fullscreen_exit_first');
				return;
			}
			if (interactedRef.current) {
				optsRef.current.log('fullscreen_exit_second');
				setModeBoth('off');
				optsRef.current.onSecondExit();
				return;
			}
			// Same exit episode (no question interaction since re-entry):
			// NOT a second exit — warn again, count unchanged.
			optsRef.current.log('fullscreen_exit_repeat');
			setModeBoth('warning');
		};
		document.addEventListener('fullscreenchange', onChange);
		return () => document.removeEventListener('fullscreenchange', onChange);
	}, [setExitsBoth, setModeBoth]);

	return {
		mode,
		exitsUsed,
		warningOpen: mode === 'warning',
		enterFullscreen,
		continueWithoutFullscreen,
		returnToFullscreen,
		closeWarningForDialog: useCallback(() => setModeBoth('off'), [setModeBoth]),
		reopenWarning: useCallback(() => {
			if (modeRef.current === 'off' && exitsRef.current > 0) setModeBoth('warning');
		}, [setModeBoth]),
		markInteraction: useCallback(() => {
			interactedRef.current = true;
		}, []),
		setLeavingIntentionally: useCallback(() => {
			leavingRef.current = true;
		}, []),
		restoreExitsUsed: useCallback(
			(n: number) => {
				if (n > 0) setExitsBoth(n);
			},
			[setExitsBoth],
		),
	};
}
