import {
	ArrowLeft,
	Database,
	Eye,
	FileText,
	Lock,
	Scale,
	Trash2,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { SEO } from '@/components/SEO';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/ui/logo';
import { trackEvent } from '@/lib/analytics';

function Header() {
	return (
		<header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
			<div className="mx-auto flex min-h-16 max-w-7xl flex-col gap-3 px-4 py-4 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0">
				<Link
					to="/"
					className="flex items-center gap-2"
					onClick={() => trackEvent('biometric_policy_nav_logo_click')}
				>
					<Logo size="md" />
					<span className="font-heading text-xl font-bold">Rekrut AI</span>
				</Link>
				<Link to="/privacy" onClick={() => trackEvent('biometric_policy_back_click')}>
					<Button variant="ghost" size="sm" className="gap-2">
						<ArrowLeft className="h-4 w-4" />
						Back to Privacy Policy
					</Button>
				</Link>
			</div>
		</header>
	);
}

const sections = [
	{
		icon: Eye,
		title: '1. What We Collect',
		content: `When you participate in a video interview or AI screening on Rekrut AI, we may collect the following biometric data — but only after you give explicit written consent:

Face data: Facial geometry measurements (landmark positions) extracted from your video feed. We do NOT store raw video frames for biometric purposes beyond the session recording retention described below.

Voice data: Acoustic measurements extracted from your audio — pitch range, speech rate, pause patterns, and voice energy. We do NOT label emotions or infer emotional states.

Behavioral measurements: Gaze direction, blink rate, and head pose — used to detect integrity signals such as reading from a screen or the presence of multiple people. These are measurements, not judgments.`,
	},
	{
		icon: FileText,
		title: '2. Why We Collect It',
		content: `We collect biometric data for these specific purposes only:

• Identity verification: Confirming you are the person who applied (face match + liveness check).
• Interview integrity: Detecting deepfakes, AI-generated answers, and proxy test-takers through multi-signal behavioral analysis.
• Fairness calibration: A 60-second warm-up measures your personal baseline so integrity signals are compared against YOUR normal patterns, not a universal standard.

We never use biometric data for advertising, profiling unrelated to hiring, or any purpose not listed here.`,
	},
	{
		icon: Database,
		title: '3. Retention Periods',
		content: `We retain biometric data only as long as necessary, and never longer than the law requires:

• Raw video/audio recordings: Deleted 90 days after the hiring decision is finalized.
• Government ID images: Deleted within 24 hours of identity verification.
• Face/voice embeddings (mathematical templates): Deleted when the associated recording is deleted (90 days post-decision).
• Per-turn behavioral measurements: Deleted with the video recording.
• Aggregated assessment results (scores, not raw biometrics): Retained per our data retention schedule.
• Biometric consent receipts: Retained for 5 years as proof of consent (required by Illinois BIPA).

If you withdraw consent mid-process, collection stops immediately and already-collected data enters the deletion pipeline.`,
	},
	{
		icon: Trash2,
		title: '4. Destruction Method',
		content: `When biometric data reaches the end of its retention period (or you request deletion), we destroy it as follows:

• Database records: Permanently deleted (hard delete, not soft delete).
• Encrypted templates: Cryptographic shredding — the per-candidate encryption key is destroyed, rendering all encrypted biometric data permanently unreadable.
• File storage (recordings): Deleted from object storage; lifecycle rules provide a backstop in case of application failure.
• Backups: Encrypted backups age out on a 30-day cycle; deleted data is not restored from backups.

Deletion is verified by automated jobs and logged in an append-only audit trail.`,
	},
	{
		icon: Scale,
		title: '5. Your Rights',
		content: `You have the right to:

• Know what biometric data we hold about you.
• Request a complete copy of your biometric data (data export).
• Request deletion of your biometric data at any time.
• Withdraw consent — collection stops immediately.
• Opt for a human interview instead of AI screening/interview if you decline biometric consent.

To exercise these rights, email privacy@rekrutai.co or use the data controls in your account settings. We respond to deletion requests within 30 days (GDPR) or 45 days (CCPA), and to breach notifications immediately where required by law (India DPDP Act).

For users in Illinois: You have specific rights under the Biometric Information Privacy Act (BIPA), including the right to sue for violations. For users in the EU: You have the right to lodge a complaint with your data protection authority.`,
	},
	{
		icon: Lock,
		title: '6. Security',
		content: `Biometric data is protected by:

• AES-256 encryption at rest with per-candidate encryption keys.
• TLS 1.3 in transit (no fallback to older protocols for biometric routes).
• Biometric tables are segregated from general user data with separate access controls.
• Every access to biometric data is logged in an append-only audit trail.
• No single employee can access raw biometric data without a logged business reason.`,
	},
];

export function BiometricPolicyPage() {
	useEffect(() => {
		trackEvent('page_view_biometric_policy');
	}, []);

	return (
		<div className="min-h-dvh-safe bg-background">
			<SEO
				title="Biometric Privacy Policy — How We Handle Your Biometric Data"
				description="Rekrut AI's biometric data policy: what we collect, why, how long we keep it, how we destroy it, and your rights."
				canonical="/privacy/biometric-policy"
				noindex={true}
			/>
			<Header />

			<main>
				<section className="relative overflow-hidden">
					<div className="absolute inset-0 pointer-events-none">
						<div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
					</div>
					<div className="relative mx-auto max-w-4xl px-4 py-16 sm:py-24">
						<div className="text-center">
							<Badge variant="outline" className="mb-4">
								Legal
							</Badge>
							<h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">
								Biometric Privacy Policy
							</h1>
							<p className="mt-4 text-muted-foreground">
								Last updated:{' '}
								{new Date().toLocaleDateString('en-US', {
									year: 'numeric',
									month: 'long',
									day: 'numeric',
								})}
							</p>
							<div className="mx-auto mt-6 max-w-2xl rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
								<p className="text-sm text-amber-700 dark:text-amber-300">
									<strong>DRAFT</strong> — This policy is pending legal counsel review
									before it takes effect. Content may change.
								</p>
							</div>
						</div>

						<div className="mt-12 space-y-6">
							{sections.map((section) => (
								<Card key={section.title} className="border-0 bg-card shadow-sm">
									<CardContent className="p-6 sm:p-8">
										<div className="flex items-center gap-3 mb-4">
											<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
												<section.icon className="h-5 w-5 text-primary" />
											</div>
											<h2 className="font-heading text-lg font-semibold">{section.title}</h2>
										</div>
										<div className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
											{section.content}
										</div>
									</CardContent>
								</Card>
							))}
						</div>

						<div className="mt-12 text-center">
							<p className="text-sm text-muted-foreground">
								Questions about biometric data?{' '}
								<Link
									to="/privacy"
									className="text-primary underline underline-offset-4 hover:text-primary/80"
									onClick={() => trackEvent('biometric_policy_privacy_click')}
								>
									Read our full Privacy Policy
								</Link>
							</p>
						</div>
					</div>
				</section>
			</main>
		</div>
	);
}
