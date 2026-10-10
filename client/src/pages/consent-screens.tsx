import { ArrowLeft, ArrowRight, CheckCircle2, FileText, Fingerprint, IdCard, ShieldAlert, Video } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SEO } from '@/components/SEO';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/ui/logo';
import { trackEvent } from '@/lib/analytics';

// S-010 (#568): Three separate consent screens + AI disclosure.
// NEVER bundled — each consent type gets its own screen with independent
// Accept/Decline (BIPA requires specific, unbundled biometric consent).

type ConsentType = 'recording' | 'biometric' | 'id_verification';
type WizardStep = ConsentType | 'ai_disclosure' | 'complete';
type DeclineState = 'recording_blocked' | 'biometric_offer' | 'id_blocked' | null;

const STEP_ORDER: ConsentType[] = ['recording', 'biometric', 'id_verification'];

const STEP_META: Record<
	ConsentType,
	{ title: string; icon: typeof Video; description: string }
> = {
	recording: {
		title: 'Interview Recording',
		icon: Video,
		description: 'We record your interview so recruiters can review it later.',
	},
	biometric: {
		title: 'Biometric Analysis',
		icon: Fingerprint,
		description: 'We analyze behavioral signals to verify identity and detect fraud.',
	},
	id_verification: {
		title: 'ID Verification',
		icon: IdCard,
		description: 'We verify your government ID to confirm you are who you say you are.',
	},
};

interface ConsentText {
	consent_type: string;
	version: string;
	text_en: string;
	text_hi: string;
	effective_from: string;
}

/** Split the consent copy into its three informational sections. Falls back to full text. */
function parseSections(text: string): { what: string; howLong: string; howDelete: string } | null {
	const what = text.match(/1\.\s*what we collect:?\s*([\s\S]*?)(?=2\.\s*how long|$)/i);
	const howLong = text.match(/2\.\s*how long[^:]*:?\s*([\s\S]*?)(?=3\.\s*how to delete|$)/i);
	const howDelete = text.match(/3\.\s*how to delete:?\s*([\s\S]*?)$/i);
	if (what?.[1] && howLong?.[1] && howDelete?.[1]) {
		return { what: what[1].trim(), howLong: howLong[1].trim(), howDelete: howDelete[1].trim() };
	}
	return null;
}

function Header({ locale, onLocaleChange }: { locale: 'en' | 'hi'; onLocaleChange: (l: 'en' | 'hi') => void }) {
	return (
		<header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
			<div className="mx-auto flex min-h-16 max-w-3xl flex-col gap-3 px-4 py-4 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0">
				<Link to="/" className="flex items-center gap-2" onClick={() => trackEvent('consent_nav_logo_click')}>
					<Logo size="md" />
					<span className="font-heading text-xl font-bold">Rekrut AI</span>
				</Link>
				<div className="flex items-center gap-2" role="group" aria-label="Language">
					<Button
						variant={locale === 'en' ? 'default' : 'ghost'}
						size="sm"
						onClick={() => onLocaleChange('en')}
					>
						English
					</Button>
					<Button
						variant={locale === 'hi' ? 'default' : 'ghost'}
						size="sm"
						onClick={() => onLocaleChange('hi')}
					>
						हिन्दी
					</Button>
				</div>
			</div>
		</header>
	);
}

export function ConsentScreensPage() {
	const [searchParams] = useSearchParams();
	const sessionId = searchParams.get('sessionId');
	const initialLocale = searchParams.get('locale') === 'hi' ? 'hi' : 'en';
	// ?reason=stale — consent text was updated since the candidate last consented
	const isStaleReconsent = searchParams.get('reason') === 'stale';

	const [step, setStep] = useState<WizardStep>('recording');
	const [locale, setLocale] = useState<'en' | 'hi'>(initialLocale);
	const [texts, setTexts] = useState<Partial<Record<ConsentType, ConsentText>>>({});
	const [loading, setLoading] = useState(true);
	const [declineState, setDeclineState] = useState<DeclineState>(null);
	const [decisions, setDecisions] = useState<Partial<Record<ConsentType, boolean>>>({});

	// Fetch all three consent texts up front (versioned, server-side resolved).
	useEffect(() => {
		let cancelled = false;
		async function fetchTexts() {
			try {
				const results = await Promise.all(
					STEP_ORDER.map(async (type) => {
						const res = await fetch(`/api/consent/texts/${type}`);
						if (!res.ok) throw new Error(`Failed to load ${type} consent text`);
						const data = (await res.json()) as ConsentText;
						return [type, data] as const;
					}),
				);
				if (!cancelled) {
					setTexts(Object.fromEntries(results));
					setLoading(false);
				}
			} catch {
				if (!cancelled) setLoading(false);
			}
		}
		fetchTexts();
		return () => {
			cancelled = true;
		};
	}, []);

	const recordDecision = useCallback(
		async (type: ConsentType, accepted: boolean) => {
			trackEvent('consent_decision', { type, accepted, locale });
			// Best-effort: record the receipt server-side. The UI flow does not
			// block on this — S-011's middleware is the enforcement point.
			try {
				await fetch('/api/consent/record', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						sessionId: sessionId ? Number(sessionId) : undefined,
						type,
						accepted,
						locale,
					}),
				});
			} catch {
				// Non-blocking: receipt recording retries are handled by S-011's gate.
			}
		},
		[locale, sessionId],
	);

	const handleAccept = async (type: ConsentType) => {
		await recordDecision(type, true);
		setDecisions((d) => ({ ...d, [type]: true }));
		const idx = STEP_ORDER.indexOf(type);
		if (idx < STEP_ORDER.length - 1) {
			setStep(STEP_ORDER[idx + 1]);
		} else {
			setStep('ai_disclosure');
		}
	};

	const handleDecline = async (type: ConsentType) => {
		await recordDecision(type, false);
		setDecisions((d) => ({ ...d, [type]: false }));
		// AC-3: no recording consent → session cannot start.
		if (type === 'recording') setDeclineState('recording_blocked');
		// AC-4: biometric decline → offer the human-interview alternative.
		// (The full decline → notification → approval flow is S-012's scope.)
		else if (type === 'biometric') setDeclineState('biometric_offer');
		// ID verification is required to confirm identity.
		else setDeclineState('id_blocked');
	};

	// --- Decline terminal states ---
	if (declineState === 'recording_blocked') {
		return (
			<div className="min-h-dvh-safe bg-background">
				<SEO
					title="Consent Required | Rekrut AI"
					description="Interview consent is required to proceed."
					canonical="/interview/consent"
					noindex={true}
				/>
				<Header locale={locale} onLocaleChange={setLocale} />
				<main className="mx-auto max-w-3xl px-4 py-12">
					<Card>
						<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
							<ShieldAlert className="h-12 w-12 text-destructive" />
							<h1 className="font-heading text-2xl font-bold">Session cannot start</h1>
							<p className="text-muted-foreground">
								Interview recording is required to conduct the interview. Without your consent to
								record, we cannot proceed with this session.
							</p>
							<Button onClick={() => setDeclineState(null)} className="gap-2">
								<ArrowLeft className="h-4 w-4" /> Go back and review
							</Button>
						</CardContent>
					</Card>
				</main>
			</div>
		);
	}

	if (declineState === 'biometric_offer') {
		return (
			<div className="min-h-dvh-safe bg-background">
				<SEO
					title="Human Interview Option | Rekrut AI"
					description="Request a human-led interview instead of AI analysis."
					canonical="/interview/consent"
					noindex={true}
				/>
				<Header locale={locale} onLocaleChange={setLocale} />
				<main className="mx-auto max-w-3xl px-4 py-12">
					<Card>
						<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
							<CheckCircle2 className="h-12 w-12 text-primary" />
							<h1 className="font-heading text-2xl font-bold">Human interview available</h1>
							<p className="text-muted-foreground">
								You declined biometric analysis. That&apos;s completely fine — it will not affect
								your candidacy. You can request a human-led interview instead, where a recruiter
								conducts the session without AI biometric analysis.
							</p>
							<div className="flex flex-col gap-2 sm:flex-row">
								<Button
									onClick={() => {
										trackEvent('consent_human_interview_requested');
										setStep('id_verification');
										setDeclineState(null);
									}}
								>
									Request human interview
								</Button>
								<Button variant="outline" onClick={() => setDeclineState(null)} className="gap-2">
									<ArrowLeft className="h-4 w-4" /> Go back and review
								</Button>
							</div>
							<p className="text-xs text-muted-foreground">
								A recruiter will be notified of your request. (Full approval flow: S-012.)
							</p>
						</CardContent>
					</Card>
				</main>
			</div>
		);
	}

	if (declineState === 'id_blocked') {
		return (
			<div className="min-h-dvh-safe bg-background">
				<SEO
					title="ID Verification Required | Rekrut AI"
					description="ID verification is required before the interview."
					canonical="/interview/consent"
					noindex={true}
				/>
				<Header locale={locale} onLocaleChange={setLocale} />
				<main className="mx-auto max-w-3xl px-4 py-12">
					<Card>
						<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
							<ShieldAlert className="h-12 w-12 text-destructive" />
							<h1 className="font-heading text-2xl font-bold">ID verification is required</h1>
							<p className="text-muted-foreground">
								We need to verify your identity before the interview can proceed. Your ID image is
								deleted within 24 hours of verification.
							</p>
							<Button onClick={() => setDeclineState(null)} className="gap-2">
								<ArrowLeft className="h-4 w-4" /> Go back and review
							</Button>
						</CardContent>
					</Card>
				</main>
			</div>
		);
	}

	// --- AI disclosure (AC-6: separate step, not a consent) ---
	if (step === 'ai_disclosure') {
		return (
			<div className="min-h-dvh-safe bg-background">
				<SEO
					title="AI Use Disclosure | Rekrut AI"
					description="How AI is used in your interview."
					canonical="/interview/consent"
					noindex={true}
				/>
				<Header locale={locale} onLocaleChange={setLocale} />
				<main className="mx-auto max-w-3xl px-4 py-12">
					<div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
						<span className="font-medium">Step 4 of 4</span>
						<span aria-hidden>·</span>
						<span>AI Disclosure</span>
					</div>
					<Card>
						<CardContent className="flex flex-col gap-6 p-8">
							<div className="flex items-center gap-3">
								<FileText className="h-8 w-8 text-primary" />
								<h1 className="font-heading text-2xl font-bold">How AI is used in this interview</h1>
							</div>
							<Badge variant="outline" className="w-fit">
								DRAFT — pending legal counsel review
							</Badge>
							<div className="prose prose-sm dark:prose-invert max-w-none">
								<p>
									This interview uses AI to analyze your responses and score your answers. A human
									recruiter reviews all AI outputs before making any hiring decisions. No hiring
									decision is made by AI alone.
								</p>
								<p className="text-muted-foreground">
									Required disclosure under Illinois HB 3773 and NYC Local Law 144.
								</p>
							</div>
							<Button
								onClick={() => {
									trackEvent('consent_ai_disclosure_acknowledged');
									setStep('complete');
								}}
								className="gap-2 self-start"
							>
								I understand — continue <ArrowRight className="h-4 w-4" />
							</Button>
						</CardContent>
					</Card>
				</main>
			</div>
		);
	}

	if (step === 'complete') {
		return (
			<div className="min-h-dvh-safe bg-background">
				<SEO
					title="Consent Complete | Rekrut AI"
					description="Your consent choices have been recorded."
					canonical="/interview/consent"
					noindex={true}
				/>
				<Header locale={locale} onLocaleChange={setLocale} />
				<main className="mx-auto max-w-3xl px-4 py-12">
					<Card>
						<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
							<CheckCircle2 className="h-12 w-12 text-green-600" />
							<h1 className="font-heading text-2xl font-bold">You&apos;re all set</h1>
							<p className="text-muted-foreground">
								Your consent choices have been recorded. You can withdraw any consent at any time
								from your interview dashboard.
							</p>
							<p className="text-xs text-muted-foreground">
								Decisions:{' '}
								{STEP_ORDER.map((t) => `${t}: ${decisions[t] ? 'accepted' : 'pending'}`).join(' · ')}
							</p>
						</CardContent>
					</Card>
				</main>
			</div>
		);
	}

	// --- Consent steps (AC-1: never bundled) ---
	const currentType = step as ConsentType;
	const meta = STEP_META[currentType];
	const consentText = texts[currentType];
	const rawText = consentText ? (locale === 'hi' ? consentText.text_hi : consentText.text_en) : null;
	const sections = rawText ? parseSections(rawText) : null;
	const Icon = meta.icon;
	const stepNumber = STEP_ORDER.indexOf(currentType) + 1;

	return (
		<div className="min-h-dvh-safe bg-background">
			<SEO
				title={`${meta.title} Consent | Rekrut AI`}
					description={`${meta.description}`}
					canonical="/interview/consent"
					noindex={true}
				/>
			<Header locale={locale} onLocaleChange={setLocale} />
			<main className="mx-auto max-w-3xl px-4 py-12">
				{isStaleReconsent && (
					<div
						role="alert"
						className="mb-6 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm"
					>
						<p className="font-semibold text-amber-700 dark:text-amber-300">
							The consent policy has been updated since you last reviewed it.
						</p>
						<p className="mt-1 text-muted-foreground">
							Please read the updated terms below and confirm your consent to continue.
						</p>
					</div>
				)}
				<div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
					<span className="font-medium">Step {stepNumber} of 4</span>
					<span aria-hidden>·</span>
					<span>{meta.title}</span>
				</div>
				{/* Progress dots */}
				<div className="mb-6 flex gap-2" aria-hidden>
					{[...STEP_ORDER, 'ai_disclosure' as const].map((s, i) => (
						<div
							key={s}
							className={`h-1.5 flex-1 rounded-full ${i < stepNumber ? 'bg-primary' : 'bg-muted'}`}
						/>
					))}
				</div>
				<Card>
					<CardContent className="flex flex-col gap-6 p-6 sm:p-8">
						<div className="flex items-center gap-3">
							<Icon className="h-8 w-8 text-primary" />
							<div>
								<h1 className="font-heading text-2xl font-bold">{meta.title}</h1>
								<p className="text-sm text-muted-foreground">{meta.description}</p>
							</div>
						</div>
						<Badge variant="outline" className="w-fit">
							DRAFT — pending legal counsel review
						</Badge>

						{loading ? (
							<p className="text-muted-foreground">Loading consent details…</p>
						) : (
							<div className="flex flex-col gap-5">
								{/* AC-2: What we collect / How long we keep it / How to delete */}
								<section>
									<h2 className="mb-2 font-heading text-lg font-semibold">What we collect</h2>
									<p className="whitespace-pre-line text-sm text-muted-foreground">
										{sections ? sections.what : rawText}
									</p>
								</section>
								<section>
									<h2 className="mb-2 font-heading text-lg font-semibold">How long we keep it</h2>
									<p className="whitespace-pre-line text-sm text-muted-foreground">
										{sections ? sections.howLong : 'See details above.'}
									</p>
								</section>
								<section>
									<h2 className="mb-2 font-heading text-lg font-semibold">How to delete</h2>
									<p className="whitespace-pre-line text-sm text-muted-foreground">
										{sections ? sections.howDelete : 'Email privacy@rekrutai.co.'}
									</p>
								</section>
								{consentText && (
									<p className="text-xs text-muted-foreground">
										Consent text version {consentText.version}
									</p>
								)}
							</div>
						)}

						{/* AC-2: independent Accept/Decline per screen */}
						<div className="flex flex-col gap-3 sm:flex-row">
							<Button onClick={() => handleAccept(currentType)} className="gap-2" disabled={loading}>
								I accept <ArrowRight className="h-4 w-4" />
							</Button>
							<Button variant="outline" onClick={() => handleDecline(currentType)} disabled={loading}>
								Decline
							</Button>
						</div>
					</CardContent>
				</Card>
			</main>
		</div>
	);
}
