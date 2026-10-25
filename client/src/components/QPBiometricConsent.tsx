/**
 * QPBiometricConsent — S-073 (#733): Quick Practice biometric consent step.
 *
 * Shown after mode select, before video recording. Text mode is exempt
 * (no frames = no consent needed) — this component only renders in the
 * video path.
 *
 * Flow:
 *   1. Fetch QP-specific consent text (GET /api/consent/texts/biometric_practice)
 *   2. Accept → POST /api/consent/record {sessionId, type, accepted: true} → onAccepted()
 *   3. Decline → record {accepted: false} best-effort (audit trail) → onDeclined()
 *      with respectful, non-punitive messaging (UX architect bar from S-060/S-064).
 *
 * Copy notes (UX architect review 2026-10-11):
 *   - Never promise "no biometric data collected" — video may still record.
 *     Promise only what this consent covers: AI analysis of practice video.
 *   - Decline path is neutral, never punitive. Text mode remains fully available.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiCall } from '@/lib/api';

interface ConsentText {
	consent_type: string;
	version: number;
	text_en: string;
	text_hi: string;
	effective_from: string;
}

interface QPBiometricConsentProps {
	sessionId: number;
	onAccepted: () => void;
	onDeclined: () => void;
	onBack: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';
type SubmitState = 'idle' | 'submitting';

export function QPBiometricConsent({ sessionId, onAccepted, onDeclined, onBack }: QPBiometricConsentProps) {
	const [loadState, setLoadState] = useState<LoadState>('loading');
	const [text, setText] = useState<ConsentText | null>(null);
	const [submitState, setSubmitState] = useState<SubmitState>('idle');
	const [submitError, setSubmitError] = useState<string | null>(null);

	const loadText = useCallback(async () => {
		setLoadState('loading');
		// M2: bound the fetch — a hung request must not strand the user.
		// MEDIUM-2: use apiCall for consistency (auth header, error normalization).
		// apiCall passes `signal` through to fetch (see submitVideoResponse usage).
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15000);
		try {
			const data = await apiCall<ConsentText>('/consent/texts/biometric_practice', {
				signal: controller.signal,
			});
			setText(data);
			setLoadState('ready');
		} catch {
			setLoadState('error');
		} finally {
			clearTimeout(timeout);
		}
	}, []);

	useEffect(() => {
		loadText();
	}, [loadText]);

	const handleAccept = useCallback(async () => {
		setSubmitState('submitting');
		setSubmitError(null);
		try {
			await apiCall('/consent/record', {
				method: 'POST',
				body: { sessionId, type: 'biometric_practice', accepted: true },
			});
			onAccepted();
		} catch {
			setSubmitError('Something went wrong recording your consent. Please try again.');
			setSubmitState('idle');
		}
	}, [sessionId, onAccepted]);

	const handleDecline = useCallback(() => {
		// LOW-5: fire-and-forget. The comment previously said "does not block"
		// but the code awaited — awaiting a hung endpoint makes decline feel
		// broken, which risks nudging the user toward accept (dark-pattern-adjacent).
		apiCall('/consent/record', {
			method: 'POST',
			body: { sessionId, type: 'biometric_practice', accepted: false },
		}).catch(() => {
			// Fire-and-forget (LOW-5): the user's decline stands regardless, and
			// blocking on a failed write would nudge toward accept. A failed
			// receipt write is an audit gap — it is NOT silently acceptable in
			// aggregate; it is covered by #1306's end-to-end closure gate,
			// which reads the decline receipt row back on dev.
		});
		// No local declined UI: the parent renders the declined panel on
		// onDeclined(). (H1: a component-local declined block would be dead
		// code in the current wiring and could carry promises about
		// backend enforcement this component cannot verify.)
		onDeclined();
	}, [sessionId, onDeclined]);

	if (loadState === 'loading') {
		return (
			<div className="mt-5 rounded-xl border p-6 text-center space-y-3">
				<p className="text-sm text-muted-foreground">Loading consent information…</p>
				<button
					type="button"
					onClick={onBack}
					className="text-sm font-medium text-primary hover:underline"
				>
					Back to mode selection
				</button>
			</div>
		);
	}

	if (loadState === 'error') {
		return (
			<div className="mt-5 rounded-xl border p-6 text-center space-y-3">
				<p className="text-sm text-muted-foreground">
					Could not load the consent information. Please try again — if it keeps failing,
					check your connection.
				</p>
				<div className="flex flex-col sm:flex-row gap-3 justify-center">
					<button
						type="button"
						onClick={loadText}
						className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
					>
						Try again
					</button>
					{/* MEDIUM-3: never strand the user — always offer a way back. */}
					<button
						type="button"
						onClick={onBack}
						className="text-sm font-medium text-primary hover:underline"
					>
						Back to mode selection
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="mt-5 rounded-xl border p-6 space-y-4">
			<div>
				<h3 className="font-semibold text-base">Video analysis consent</h3>
				<p className="text-xs text-muted-foreground mt-1">
					This step is optional — you can practice with a text response instead.
				</p>
			</div>

			{text && (
				<div
					role="region"
					aria-label="Biometric consent text"
					className="max-h-64 overflow-y-auto rounded-lg bg-muted/50 p-4"
				>
					<p className="text-sm whitespace-pre-wrap text-muted-foreground">{text.text_en}</p>
					<p className="text-xs text-muted-foreground/70 mt-3">
						Consent v{text.version} · effective{' '}
						{new Date(text.effective_from).toLocaleDateString()}
					</p>
				</div>
			)}

			{submitError && (
				<p role="alert" className="text-sm text-destructive">
					{submitError}
				</p>
			)}

			<div className="flex flex-col sm:flex-row gap-3">
				<button
					type="button"
					onClick={handleAccept}
					disabled={submitState === 'submitting'}
					className="flex-1 rounded-lg border-2 border-primary px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
				>
					{submitState === 'submitting' ? 'Recording consent…' : 'I consent to video analysis'}
				</button>
				<button
					type="button"
					onClick={handleDecline}
					disabled={submitState === 'submitting'}
					className="flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
				>
					Decline and use text mode
				</button>
			</div>

			<p className="text-xs text-muted-foreground">
				Your decision is respected. Declining does not affect your account or access to
				practice features.
			</p>
		</div>
	);
}
