/**
 * WithdrawnConsentRecovery — S-064 (#714).
 *
 * Inline recovery UI shown when a biometric-gated API call fails with
 * 403 CONSENT_WITHDRAWN. Per the consentErrorHandler design, withdrawn
 * consent does NOT redirect — the withdrawal was deliberate, so we show
 * an inline message with recovery paths instead of yanking the candidate
 * to a different page.
 *
 * Copy: UX architect review, approve-with-changes (findings 1-7 addressed).
 * - No blanket collection promises (scoped to withdrawn type only)
 * - Neutral informational styling (not warning/error)
 * - Equal-weight actions; "continue without" is primary (session can proceed)
 * - Exit honesty: states the session is abandoned, no overpromising
 */

interface WithdrawnConsentRecoveryProps {
	/** Which consent was withdrawn: 'biometric' | 'recording' | 'id_verification' */
	consentType: string;
	/** Interview session id, if known (for the re-consent link) */
	sessionId: number | null;
	/** Continue the interview without the withdrawn data type */
	onContinue: () => void;
	/** Called when the candidate chooses to end the session */
	onExit: () => void;
}

const CONSENT_LABELS: Record<string, string> = {
	biometric: 'biometric',
	recording: 'recording',
	id_verification: 'identity verification',
};

export function WithdrawnConsentRecovery({
	consentType,
	sessionId,
	onContinue,
	onExit,
}: WithdrawnConsentRecoveryProps) {
	const label = CONSENT_LABELS[consentType] ?? 'biometric';

	const params = new URLSearchParams();
	if (sessionId !== null) {
		params.set('sessionId', String(sessionId));
	}
	params.set('reason', 'withdrawn');
	const reconsentHref = `/interview/consent?${params.toString()}`;

	return (
		<div
			role="status"
			className="rounded-lg border border-slate-300 bg-slate-50 p-6 dark:border-slate-700 dark:bg-slate-900"
		>
			<h2 className="text-lg font-semibold">Consent withdrawn</h2>
			<p className="mt-2 text-sm text-muted-foreground">
				You&apos;ve withdrawn your consent for {label} collection. AI
				analysis of this data is now off for this session. Your decision
				is respected.
			</p>
			<p className="mt-2 text-sm text-muted-foreground">
				You can continue the interview without {label} collection —
				only the steps that need it will be skipped.
			</p>
			<div className="mt-4 flex flex-col gap-2 sm:flex-row">
				<button
					type="button"
					onClick={onContinue}
					className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					Continue without {label} collection
				</button>
				<a
					href={reconsentHref}
					className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
				>
					Review consent again
				</a>
				<button
					type="button"
					onClick={onExit}
					className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
				>
					End session
				</button>
			</div>
			<p className="mt-3 text-xs text-muted-foreground">
				Ending the session abandons this interview here.
			</p>
		</div>
	);
}
