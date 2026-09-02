import {
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	Clock,
	Github,
	Instagram,
	Linkedin,
	Mail,
	MapPin,
	Phone,
	Send,
	Twitter,
	Youtube,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SEO } from '@/components/SEO';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/ui/logo';
import { Textarea } from '@/components/ui/textarea';
import { trackEvent } from '@/lib/analytics';

function Header() {
	return (
		<header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
			<div className="mx-auto flex min-h-16 max-w-7xl flex-col gap-3 px-4 py-4 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0">
				<Link
					to="/"
					className="flex items-center gap-2"
					onClick={() => trackEvent('contact_nav_logo_click')}
				>
					<Logo size="md" />
					<span className="font-heading text-xl font-bold">Rekrut AI</span>
				</Link>
				<Link to="/" onClick={() => trackEvent('contact_back_click')}>
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
						to="/privacy"
						className="hover:text-primary transition-colors"
						onClick={() => trackEvent('contact_footer_privacy_click')}
					>
						Privacy
					</Link>
					<Link
						to="/terms"
						className="hover:text-primary transition-colors"
						onClick={() => trackEvent('contact_footer_terms_click')}
					>
						Terms
					</Link>
					<Link
						to="/about"
						className="hover:text-primary transition-colors"
						onClick={() => trackEvent('contact_footer_about_click')}
					>
						About
					</Link>
				</div>
			</div>
		</footer>
	);
}

export function ContactPage() {
	const [submitted, setSubmitted] = useState(false);
	const [formData, setFormData] = useState({
		name: '',
		email: '',
		company: '',
		subject: '',
		message: '',
	});
	const [_errors, setErrors] = useState<Record<string, string>>({});
	const [touched, setTouched] = useState<Record<string, boolean>>({});

	function validateField(field: string, value: string): string {
		switch (field) {
			case 'name':
				return value.trim().length < 2 ? 'Name must be at least 2 characters' : '';
			case 'email':
				return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : 'Please enter a valid email';
			case 'subject':
				return value.trim().length < 3 ? 'Subject must be at least 3 characters' : '';
			case 'message':
				return value.trim().length < 10 ? 'Message must be at least 10 characters' : '';
			default:
				return '';
		}
	}

	function validateAll(): boolean {
		const newErrors: Record<string, string> = {};
		let hasError = false;
		['name', 'email', 'subject', 'message'].forEach((field) => {
			const error = validateField(field, formData[field as keyof typeof formData]);
			if (error) {
				newErrors[field] = error;
				hasError = true;
			}
		});
		setErrors(newErrors);
		return !hasError;
	}

	useEffect(() => {
		trackEvent('page_view_contact');
	}, []);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setTouched({ name: true, email: true, subject: true, message: true });
		if (!validateAll()) return;
		trackEvent('contact_form_submit', { subject: formData.subject });
		setSubmitted(true);
	};

	const handleChange = (field: string, value: string) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
		if (touched[field]) {
			setErrors((prev) => ({ ...prev, [field]: validateField(field, value) }));
		}
	};

	const _handleBlur = (field: string) => {
		setTouched((prev) => ({ ...prev, [field]: true }));
		setErrors((prev) => ({
			...prev,
			[field]: validateField(field, formData[field as keyof typeof formData]),
		}));
	};

	return (
		<div className="min-h-dvh-safe bg-background">
			<SEO
				title="Contact Us — We Would Love to Hear From You"
				description="Reach out to Rekrut AI for support, partnerships, press inquiries, or general questions. Email us at hello@rekrutai.co or use our contact form."
				canonical="/contact"
			/>
			<Header />

			<main>
				{/* Hero */}
				<section className="relative overflow-hidden">
					<div className="absolute inset-0 pointer-events-none">
						<div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
						<div className="absolute top-20 -left-20 h-72 w-72 rounded-full bg-purple-500/10 blur-3xl" />
					</div>
					<div className="relative mx-auto max-w-7xl px-4 py-16 sm:py-24">
						<div className="mx-auto max-w-3xl text-center">
							<Badge variant="outline" className="mb-4">
								Contact
							</Badge>
							<h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">
								Let us talk
							</h1>
							<p className="mt-6 text-lg text-muted-foreground">
								Whether you are a recruiter looking to transform your hiring process, a candidate
								with feedback, or a journalist interested in our story — we would love to hear from
								you.
							</p>
						</div>
					</div>
				</section>

				{/* Contact info cards */}
				<section className="border-y bg-muted/30 py-12">
					<div className="mx-auto max-w-7xl px-4">
						<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
							<Card className="border-0 bg-card shadow-sm">
								<CardContent className="p-6">
									<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
										<Mail className="h-5 w-5 text-primary" />
									</div>
									<h3 className="mt-4 font-heading font-semibold">Email</h3>
									<a
										href="mailto:hello@rekrutai.co"
										className="mt-2 text-sm text-primary hover:underline"
										onClick={() => trackEvent('contact_email_click')}
									>
										hello@rekrutai.co
									</a>
									<p className="mt-1 text-xs text-muted-foreground">For general inquiries</p>
								</CardContent>
							</Card>
							<Card className="border-0 bg-card shadow-sm">
								<CardContent className="p-6">
									<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
										<Phone className="h-5 w-5 text-primary" />
									</div>
									<h3 className="mt-4 font-heading font-semibold">Phone</h3>
									<p className="mt-2 text-sm">+91 80 1234 5678</p>
									<p className="mt-1 text-xs text-muted-foreground">India HQ</p>
								</CardContent>
							</Card>
							<Card className="border-0 bg-card shadow-sm">
								<CardContent className="p-6">
									<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
										<MapPin className="h-5 w-5 text-primary" />
									</div>
									<h3 className="mt-4 font-heading font-semibold">Office</h3>
									<p className="mt-2 text-sm">Bangalore, India</p>
									<p className="mt-1 text-xs text-muted-foreground">Remote-first, global team</p>
								</CardContent>
							</Card>
							<Card className="border-0 bg-card shadow-sm">
								<CardContent className="p-6">
									<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
										<Clock className="h-5 w-5 text-primary" />
									</div>
									<h3 className="mt-4 font-heading font-semibold">Support Hours</h3>
									<p className="mt-2 text-sm">Mon – Fri, 9AM – 6PM IST</p>
									<p className="mt-1 text-xs text-muted-foreground">Pro plans get priority</p>
								</CardContent>
							</Card>
						</div>
					</div>
				</section>

				{/* Form + Social */}
				<section className="py-20 sm:py-24">
					<div className="mx-auto max-w-7xl px-4">
						<div className="grid gap-12 lg:grid-cols-5">
							{/* Form */}
							<div className="lg:col-span-3">
								<Card className="border-0 bg-card shadow-sm">
									<CardContent className="p-8">
										{submitted ? (
											<div className="text-center py-8">
												<div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
													<CheckCircle2 className="h-8 w-8 text-green-600" />
												</div>
												<h3 className="mt-6 font-heading text-xl font-semibold">Message sent</h3>
												<p className="mt-2 text-muted-foreground">
													Thank you for reaching out. We typically respond within 24 hours.
												</p>
												<Button
													variant="outline"
													className="mt-6"
													onClick={() => {
														setSubmitted(false);
														setFormData({
															name: '',
															email: '',
															company: '',
															subject: '',
															message: '',
														});
													}}
												>
													Send another message
												</Button>
											</div>
										) : (
											<form onSubmit={handleSubmit} className="space-y-6">
												<h3 className="font-heading text-xl font-semibold">Send us a message</h3>
												<div className="grid gap-6 sm:grid-cols-2">
													<div className="space-y-2">
														<Label htmlFor="name">Name</Label>
														<Input
															id="name"
															placeholder="Your name"
															required
															value={formData.name}
															onChange={(e) => handleChange('name', e.target.value)}
														/>
													</div>
													<div className="space-y-2">
														<Label htmlFor="email">Email</Label>
														<Input
															id="email"
															type="email"
															placeholder="you@company.com"
															required
															value={formData.email}
															onChange={(e) => handleChange('email', e.target.value)}
														/>
													</div>
												</div>
												<div className="space-y-2">
													<Label htmlFor="company">Company (optional)</Label>
													<Input
														id="company"
														placeholder="Your company name"
														value={formData.company}
														onChange={(e) => handleChange('company', e.target.value)}
													/>
												</div>
												<div className="space-y-2">
													<Label htmlFor="subject">Subject</Label>
													<Input
														id="subject"
														placeholder="What is this about?"
														required
														value={formData.subject}
														onChange={(e) => handleChange('subject', e.target.value)}
													/>
												</div>
												<div className="space-y-2">
													<Label htmlFor="message">Message</Label>
													<Textarea
														id="message"
														placeholder="Tell us how we can help..."
														rows={5}
														required
														value={formData.message}
														onChange={(e) => handleChange('message', e.target.value)}
													/>
												</div>
												<Button type="submit" className="w-full gap-2">
													<Send className="h-4 w-4" />
													Send message
												</Button>
											</form>
										)}
									</CardContent>
								</Card>
							</div>

							{/* Sidebar */}
							<div className="lg:col-span-2 space-y-6">
								<Card className="border-0 bg-card shadow-sm">
									<CardContent className="p-6">
										<h4 className="font-heading font-semibold">Follow us</h4>
										<p className="mt-2 text-sm text-muted-foreground">
											Stay updated on product releases, hiring tips, and company news.
										</p>
										<div className="mt-4 flex flex-wrap gap-2">
											{[
												{
													icon: Twitter,
													label: 'Twitter',
													href: 'https://twitter.com/rekrutai',
													event: 'contact_social_twitter',
												},
												{
													icon: Linkedin,
													label: 'LinkedIn',
													href: 'https://linkedin.com/company/rekrutai',
													event: 'contact_social_linkedin',
												},
												{
													icon: Github,
													label: 'GitHub',
													href: 'https://github.com/rekrutai',
													event: 'contact_social_github',
												},
												{
													icon: Instagram,
													label: 'Instagram',
													href: 'https://instagram.com/rekrutai',
													event: 'contact_social_instagram',
												},
												{
													icon: Youtube,
													label: 'YouTube',
													href: 'https://youtube.com/@rekrutai',
													event: 'contact_social_youtube',
												},
											].map((social) => (
												<a
													key={social.label}
													href={social.href}
													target="_blank"
													rel="noopener noreferrer"
													className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted"
													onClick={() => trackEvent(social.event)}
												>
													<social.icon className="h-4 w-4" />
													{social.label}
												</a>
											))}
										</div>
									</CardContent>
								</Card>

								<Card className="border-0 bg-card shadow-sm">
									<CardContent className="p-6">
										<h4 className="font-heading font-semibold">Quick links</h4>
										<ul className="mt-4 space-y-2">
											<li>
												<Link
													to="/pricing"
													className="text-sm text-primary hover:underline"
													onClick={() => trackEvent('contact_link_pricing')}
												>
													View pricing
												</Link>
											</li>
											<li>
												<Link
													to="/about"
													className="text-sm text-primary hover:underline"
													onClick={() => trackEvent('contact_link_about')}
												>
													About our company
												</Link>
											</li>
											<li>
												<Link
													to="/blog"
													className="text-sm text-primary hover:underline"
													onClick={() => trackEvent('contact_link_blog')}
												>
													Read the blog
												</Link>
											</li>
											<li>
												<Link
													to="/register"
													className="text-sm text-primary hover:underline"
													onClick={() => trackEvent('contact_link_register')}
												>
													Create an account
												</Link>
											</li>
										</ul>
									</CardContent>
								</Card>

								<Card className="border-0 bg-card shadow-sm">
									<CardContent className="p-6">
										<div className="flex items-start gap-3">
											<AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
											<div>
												<h4 className="font-heading font-semibold">Need urgent help?</h4>
												<p className="mt-2 text-sm text-muted-foreground">
													Pro and Enterprise customers get priority support. Free users can expect a
													response within 48 hours.
												</p>
											</div>
										</div>
									</CardContent>
								</Card>
							</div>
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	);
}
