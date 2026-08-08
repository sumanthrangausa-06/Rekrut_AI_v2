import { SEO } from '@/components/SEO'
import {
	AlertTriangle,
	ArrowLeft,
	CreditCard,
	FileText,
	Gavel,
	Globe,
	MessageSquare,
	Scale,
	User,
} from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Logo } from '@/components/ui/logo'
import { trackEvent } from '@/lib/analytics'

function Header() {
	return (
		<header className='border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80'>
			<div className='mx-auto flex min-h-16 max-w-7xl flex-col gap-3 px-4 py-4 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0'>
				<Link
					to='/'
					className='flex items-center gap-2'
					onClick={() => trackEvent('terms_nav_logo_click')}
				>
					<Logo size='md' />
					<span className='font-heading text-xl font-bold'>Rekrut AI</span>
				</Link>
				<Link to='/' onClick={() => trackEvent('terms_back_click')}>
					<Button variant='ghost' size='sm' className='gap-2'>
						<ArrowLeft className='h-4 w-4' />
						Back to home
					</Button>
				</Link>
			</div>
		</header>
	)
}

function Footer() {
	return (
		<footer className='border-t bg-muted/30'>
			<div className='mx-auto max-w-7xl px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground'>
				<p>© {new Date().getFullYear()} Rekrut AI. All rights reserved.</p>
				<div className='flex items-center gap-4'>
					<Link
						to='/privacy'
						className='hover:text-primary transition-colors'
						onClick={() => trackEvent('terms_footer_privacy_click')}
					>
						Privacy
					</Link>
					<Link
						to='/about'
						className='hover:text-primary transition-colors'
						onClick={() => trackEvent('terms_footer_about_click')}
					>
						About
					</Link>
					<Link
						to='/contact'
						className='hover:text-primary transition-colors'
						onClick={() => trackEvent('terms_footer_contact_click')}
					>
						Contact
					</Link>
				</div>
			</div>
		</footer>
	)
}

const sections = [
	{
		icon: FileText,
		title: '1. Acceptance of Terms',
		content: `By accessing or using the Rekrut AI platform and services (the "Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not use the Service.

These Terms constitute a legally binding agreement between you and Rekrut AI ("we", "our", or "us"). We reserve the right to modify these Terms at any time. We will notify you of material changes via email or through the platform. Continued use of the Service after changes constitutes acceptance.`,
	},
	{
		icon: User,
		title: '2. Eligibility & Accounts',
		content: `You must be at least 18 years old (or the age of legal majority in your jurisdiction) to use the Service. By creating an account, you represent that:

• You meet the eligibility requirements.
• The information you provide is accurate, complete, and current.
• You are responsible for maintaining the confidentiality of your account credentials.
• You are responsible for all activity that occurs under your account.

We reserve the right to suspend or terminate accounts that violate these Terms or that we reasonably suspect are fraudulent, inactive, or used for unauthorized purposes.`,
	},
	{
		icon: Gavel,
		title: '3. Use of the Service',
		content: `Rekrut AI grants you a limited, non-exclusive, non-transferable, revocable license to use the Service for its intended purpose: recruitment, hiring, and career development.

You agree NOT to:
• Use the Service for any illegal purpose or in violation of any laws.
• Post false, misleading, or fraudulent job listings, profiles, or applications.
• Harass, discriminate against, or abuse other users.
• Scrape, crawl, or otherwise extract data from the platform without authorization.
• Reverse engineer, decompile, or attempt to discover the source code of the Service.
• Interfere with the security or operation of the platform.
• Impersonate any person or entity.

Violation of these rules may result in immediate suspension, termination, or legal action.`,
	},
	{
		icon: FileText,
		title: '4. Content & Intellectual Property',
		content: `User Content: You retain ownership of content you upload (resumes, job descriptions, messages, etc.). By uploading content, you grant Rekrut AI a worldwide, royalty-free license to use, display, and process that content solely to operate and improve the Service. This includes using your data to train and improve our AI matching algorithms.

Platform Content: All software, design, text, graphics, logos, and other content provided by Rekrut AI is owned by us or our licensors and is protected by copyright, trademark, and other intellectual property laws. You may not copy, modify, or distribute our platform content without written permission.

Feedback: Any feedback, suggestions, or ideas you provide may be used by us without compensation or attribution.`,
	},
	{
		icon: CreditCard,
		title: '5. Payments & Subscriptions',
		content: `Rekrut AI offers both free and paid plans. By subscribing to a paid plan, you agree to:

• Pay all fees associated with your chosen plan.
• Provide accurate and complete billing information.
• Authorize us to charge your payment method for recurring subscriptions.
• Understand that fees are non-refundable except where required by law or as explicitly stated in our refund policy.

Billing Cycle: Subscriptions automatically renew unless canceled before the renewal date. You may cancel at any time through your account settings. Access continues until the end of the current billing period.

Price Changes: We may adjust pricing with 30 days notice. Your continued use after the effective date constitutes acceptance of the new pricing.`,
	},
	{
		icon: Scale,
		title: '6. AI & Automated Decision-Making',
		content: `Rekrut AI uses artificial intelligence for candidate matching, scoring (OmniScore), and screening recommendations. You acknowledge and agree that:

• AI recommendations are probabilistic and not deterministic. They are intended to assist, not replace, human judgment.
• Final hiring decisions should always involve human review.
• We continuously improve our AI models but do not guarantee 100% accuracy or fairness in every individual case.
• You may contest or request human review of any automated decision by contacting us.

We are committed to responsible AI use and regularly audit our models for bias and fairness.`,
	},
	{
		icon: AlertTriangle,
		title: '7. Disclaimers & Limitations',
		content: `THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.

We do not guarantee that:
• The Service will be uninterrupted, timely, secure, or error-free.
• Any job listing, candidate profile, or hiring outcome will be accurate or successful.
• The platform will be free from viruses or other harmful components.

TO THE MAXIMUM EXTENT PERMITTED BY LAW, REKRUT AI SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS, DATA LOSS, OR BUSINESS INTERRUPTION, ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE.

Our total liability to you for any claim arising from these Terms or the Service shall not exceed the amount you paid us in the 12 months preceding the claim, or $100 USD if you used only the free tier.`,
	},
	{
		icon: Globe,
		title: '8. Indemnification',
		content: `You agree to indemnify, defend, and hold harmless Rekrut AI, its officers, directors, employees, and agents from any claims, liabilities, damages, losses, and expenses (including reasonable attorneys fees) arising out of or in connection with:

• Your use of the Service.
• Any content you upload or transmit through the platform.
• Your violation of these Terms or any applicable law.
• Your interactions with other users, including disputes between employers and candidates.`,
	},
	{
		icon: FileText,
		title: '9. Termination',
		content: `You may terminate your account at any time by following the account deletion process in your settings or by contacting us.

We may suspend or terminate your access to the Service at any time, with or without notice, for:
• Violations of these Terms.
• Fraudulent, abusive, or illegal activity.
• Extended periods of inactivity.
• Non-payment of fees (for paid accounts).

Upon termination, your right to use the Service ceases immediately. Certain provisions of these Terms (including intellectual property, disclaimers, and limitations of liability) survive termination.`,
	},
	{
		icon: Gavel,
		title: '10. Governing Law & Dispute Resolution',
		content: `These Terms are governed by the laws of India, without regard to its conflict of law provisions.

Any dispute arising from these Terms or the Service shall first be attempted to be resolved through good-faith negotiation. If unresolved within 30 days, disputes shall be resolved through binding arbitration in Bangalore, India, under the rules of the Indian Arbitration and Conciliation Act, 1996.

You waive any right to participate in class actions or class-wide arbitration. Each party bears its own costs of arbitration.`,
	},
	{
		icon: MessageSquare,
		title: '11. Contact Information',
		content: `If you have questions about these Terms, please contact us:

Email: legal@rekrutai.co
Address: Rekrut AI, Bangalore, India

We aim to respond to all legal inquiries within 48 business hours.

For EU users, you may also contact our designated EU representative at: eu-representative@rekrutai.co`,
	},
]

export function TermsPage() {
	useEffect(() => {
		trackEvent('page_view_terms')
	}, [])

	return (
		<div className='min-h-dvh-safe bg-background'>
			<SEO
				title='Terms of Service — Rekrut AI'
				description='Read the Terms of Service for Rekrut AI. By accessing or using our platform, you agree to be bound by these terms.'
				canonical='/terms'
				noindex={true}
			/>
			<Header />

			<main>
				<section className='relative overflow-hidden'>
					<div className='absolute inset-0 pointer-events-none'>
						<div className='absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/10 blur-3xl' />
					</div>
					<div className='relative mx-auto max-w-4xl px-4 py-16 sm:py-24'>
						<div className='text-center'>
							<Badge variant='outline' className='mb-4'>
								Legal
							</Badge>
							<h1 className='font-heading text-4xl font-bold tracking-tight sm:text-5xl'>
								Terms of Service
							</h1>
							<p className='mt-4 text-muted-foreground'>
								Last updated:{' '}
								{new Date().toLocaleDateString('en-US', {
									year: 'numeric',
									month: 'long',
									day: 'numeric',
								})}
							</p>
						</div>

						<div className='mt-12 space-y-6'>
							{sections.map((section) => (
								<Card key={section.title} className='border-0 bg-card shadow-sm'>
									<CardContent className='p-6 sm:p-8'>
										<div className='flex items-center gap-3 mb-4'>
											<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10'>
												<section.icon className='h-5 w-5 text-primary' />
											</div>
											<h2 className='font-heading text-lg font-semibold'>{section.title}</h2>
										</div>
										<div className='text-sm leading-relaxed text-muted-foreground whitespace-pre-line'>
											{section.content}
										</div>
									</CardContent>
								</Card>
							))}
						</div>

						<div className='mt-12 text-center'>
							<p className='text-sm text-muted-foreground'>
								By using Rekrut AI, you agree to these Terms and our{' '}
								<Link
									to='/privacy'
									className='text-primary underline underline-offset-4 hover:text-primary/80'
									onClick={() => trackEvent('terms_privacy_link_click')}
								>
									Privacy Policy
								</Link>
								.
							</p>
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	)
}
