import {
	ArrowLeft,
	Bell,
	Eye,
	FileText,
	Globe,
	Lock,
	Server,
	Shield,
	Trash2,
	UserCheck,
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
					onClick={() => trackEvent('privacy_nav_logo_click')}
				>
					<Logo size="md" />
					<span className="font-heading text-xl font-bold">Rekrut AI</span>
				</Link>
				<Link to="/" onClick={() => trackEvent('privacy_back_click')}>
					<Button variant="ghost" size="sm" className="gap-2">
						<ArrowLeft className="h-4 w-4" />
						Back to home
					</Button>
				</Link>
			</div>
		</header>
	);
}

function Footer() {
	return (
		<footer className="border-t bg-muted/30">
			<div className="mx-auto max-w-7xl px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
				<p>© {new Date().getFullYear()} Rekrut AI. All rights reserved.</p>
				<div className="flex items-center gap-4">
					<Link
						to="/terms"
						className="hover:text-primary transition-colors"
						onClick={() => trackEvent('privacy_footer_terms_click')}
					>
						Terms
					</Link>
					<Link
						to="/about"
						className="hover:text-primary transition-colors"
						onClick={() => trackEvent('privacy_footer_about_click')}
					>
						About
					</Link>
					<Link
						to="/contact"
						className="hover:text-primary transition-colors"
						onClick={() => trackEvent('privacy_footer_contact_click')}
					>
						Contact
					</Link>
				</div>
			</div>
		</footer>
	);
}

const sections = [
	{
		icon: FileText,
		title: '1. Introduction',
		content: `Rekrut AI ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our AI-native recruitment platform and related services (collectively, the "Service").

We operate globally with our primary operations in India. By using the Service, you consent to the practices described in this policy. If you do not agree, please do not use the Service.`,
	},
	{
		icon: UserCheck,
		title: '2. Information We Collect',
		content: `We collect information necessary to provide and improve our recruitment services:

Personal Information: Name, email address, phone number, location, and professional profile data (resume, skills, experience, education) when you create an account or apply for jobs.

Recruitment Data: Job applications, interview notes, assessment results, OmniScore ratings, TrustScore feedback, and hiring pipeline activity.

Usage Data: How you interact with the platform — pages visited, features used, clicks, searches, and engagement patterns.

Device & Log Data: IP address, browser type, operating system, device identifiers, and crash logs for debugging and security.`,
	},
	{
		icon: Eye,
		title: '3. How We Use Your Information',
		content: `We use your information to:

• Power AI matching algorithms that connect candidates with relevant roles and recruiters with suitable candidates.
• Generate OmniScore and TrustScore ratings to improve hiring quality and transparency.
• Provide video interview, contract generation, and onboarding automation features.
• Send transactional notifications (application updates, interview invites, offer letters) and optional marketing communications.
• Improve our AI models, detect fraud, and ensure platform security.
• Comply with legal obligations and respond to lawful requests.`,
	},
	{
		icon: Lock,
		title: '4. Data Sharing & Disclosure',
		content: `We do not sell your personal data. We may share information in these limited circumstances:

With Employers: When you apply to a job or participate in a screening, the hiring company receives your profile and application data as necessary for the recruitment process.

With Service Providers: We use trusted third-party vendors for cloud hosting, video calls, payment processing, email delivery, and analytics. All vendors are bound by strict confidentiality and security obligations.

For Legal Reasons: We may disclose information if required by law, court order, or to protect our rights, safety, or the safety of others.

Business Transfers: If Rekrut AI is involved in a merger, acquisition, or asset sale, your data may be transferred as part of that transaction.`,
	},
	{
		icon: Server,
		title: '5. Data Security',
		content: `We implement industry-standard security measures to protect your data:

• Encryption at rest (AES-256) and in transit (TLS 1.3) for all sensitive data.
• Role-based access controls and regular security audits.
• SOC 2 Type II compliant infrastructure providers.
• Regular vulnerability scanning and penetration testing.
• Incident response plan and 24/7 monitoring.

While we take these precautions, no system is completely secure. We encourage you to use strong passwords and enable two-factor authentication where available.`,
	},
	{
		icon: Globe,
		title: '6. International Data Transfers',
		content: `Rekrut AI is headquartered in India with users worldwide. Your data may be processed and stored in India, the United States, the European Union, and other jurisdictions where our service providers operate.

We ensure appropriate safeguards are in place for international transfers, including Standard Contractual Clauses (SCCs) and adequacy decisions where required by law.`,
	},
	{
		icon: UserCheck,
		title: '7. Your Rights',
		content: `Depending on your location, you may have the following rights regarding your personal data:

• Access: Request a copy of the data we hold about you.
• Correction: Update or correct inaccurate information.
• Deletion: Request deletion of your account and associated data (subject to legal retention requirements).
• Portability: Export your data in a machine-readable format.
• Objection: Opt out of certain processing activities, including marketing communications.
• Restriction: Request that we limit how we use your data.

To exercise these rights, contact us at privacy@rekrutai.co or use the data controls in your account settings.`,
	},
	{
		icon: Trash2,
		title: '8. Data Retention',
		content: `We retain your data only as long as necessary for the purposes outlined in this policy:

• Active accounts: Data is retained while your account is active.
• Deleted accounts: Most personal data is deleted within 90 days of account closure. Some data may be retained longer for legal, financial, or security purposes (e.g., transaction records, audit logs).
• Job applications: Application data may be retained by the employer even after you delete your account, as they are the data controller for their hiring process.`,
	},
	{
		icon: Bell,
		title: '9. Cookies & Tracking',
		content: `We use cookies and similar technologies to:

• Authenticate users and maintain sessions.
• Remember preferences and settings.
• Analyze usage patterns and improve the platform.
• Deliver relevant content and measure marketing effectiveness.

You can manage cookie preferences through your browser settings. Note that disabling certain cookies may affect Service functionality.`,
	},
	{
		icon: Shield,
		title: "10. Children's Privacy",
		content: `The Service is not intended for individuals under 18 years of age (or the age of majority in your jurisdiction). We do not knowingly collect data from children. If you believe we have collected data from a minor, contact us immediately and we will delete it.`,
	},
	{
		icon: FileText,
		title: '11. Changes to This Policy',
		content: `We may update this Privacy Policy from time to time. We will notify you of significant changes via email or through the platform. The "Last Updated" date at the top of this page reflects the most recent revision.

Continued use of the Service after changes constitutes acceptance of the updated policy.`,
	},
	{
		icon: Globe,
		title: '12. Contact Us',
		content: `If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:

Email: privacy@rekrutai.co
Address: Rekrut AI, Bangalore, India
Response time: We aim to respond to all privacy inquiries within 48 hours.

For users in the European Union, you also have the right to lodge a complaint with your local data protection authority.`,
	},
];

export function PrivacyPage() {
	useEffect(() => {
		trackEvent('page_view_privacy');
	}, []);

	return (
		<div className="min-h-dvh-safe bg-background">
			<SEO
				title="Privacy Policy — How We Protect Your Data"
				description="Rekrut AI is committed to protecting your privacy. Learn how we collect, use, disclose, and safeguard your information."
				canonical="/privacy"
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
								Privacy Policy
							</h1>
							<p className="mt-4 text-muted-foreground">
								Last updated:{' '}
								{new Date().toLocaleDateString('en-US', {
									year: 'numeric',
									month: 'long',
									day: 'numeric',
								})}
							</p>
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
								Questions about privacy?{' '}
								<Link
									to="/contact"
									className="text-primary underline underline-offset-4 hover:text-primary/80"
									onClick={() => trackEvent('privacy_contact_click')}
								>
									Contact our privacy team
								</Link>
							</p>
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	);
}
