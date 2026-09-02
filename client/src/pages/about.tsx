import {
	ArrowLeft,
	ArrowRight,
	Award,
	Globe,
	Handshake,
	Heart,
	Lightbulb,
	Linkedin,
	Rocket,
	Shield,
	Target,
	TrendingUp,
	Twitter,
	Users,
	Zap,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { SEO } from '@/components/SEO';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/ui/logo';
import { trackEvent } from '@/lib/analytics';
import { getDiceBearAvatar } from '@/lib/avatar';

const values = [
	{
		icon: Lightbulb,
		title: 'Innovation First',
		description:
			'We believe AI should augment human judgment, not replace it. Every feature we build is designed to make recruiters and candidates more effective, not obsolete.',
	},
	{
		icon: Shield,
		title: 'Radical Transparency',
		description:
			'TrustScore and OmniScore exist because hiring should not be a black box. We give both sides the data they need to make informed decisions.',
	},
	{
		icon: Handshake,
		title: 'Two-Sided Fairness',
		description:
			'Recruitment platforms usually serve only one side. We design for candidates and recruiters equally — because great hiring happens when both parties win.',
	},
	{
		icon: TrendingUp,
		title: 'Measurable Impact',
		description:
			'We measure success by outcomes: time-to-hire, candidate satisfaction, offer acceptance rates. If it does not move the needle, we do not ship it.',
	},
];

const founders = [
	{
		name: 'Ranga Sumanth',
		role: 'Co-Founder & CEO',
		bio: 'Previously led talent acquisition at two high-growth startups. Ranga built Rekrut AI after watching recruiters drown in spreadsheets and candidates ghosted by opaque ATS systems.',
		avatar: 'RS',
		social: 'linkedin',
	},
	{
		name: 'Suga',
		role: 'Co-Founder & CTO / AI Lead',
		bio: 'AI researcher and engineer with deep experience in NLP, recommendation systems, and multi-agent architectures. Suga architects the intelligence layer behind every Rekrut AI match.',
		avatar: 'SU',
		social: 'github',
	},
];

const milestones = [
	{ year: '2026', event: 'Rekrut AI founded in India as HireLoop', icon: Rocket },
	{ year: '2026', event: 'First AI matching engine deployed', icon: Zap },
	{ year: '2026', event: 'OmniScore & TrustScore launched', icon: Award },
	{ year: '2026', event: 'Global expansion with multi-region support', icon: Globe },
];

function Header() {
	return (
		<header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
			<div className="mx-auto flex min-h-16 max-w-7xl flex-col gap-3 px-4 py-4 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0">
				<Link
					to="/"
					className="flex items-center gap-2"
					onClick={() => trackEvent('about_nav_logo_click')}
				>
					<Logo size="md" />
					<span className="font-heading text-xl font-bold">Rekrut AI</span>
				</Link>
				<Link to="/" onClick={() => trackEvent('about_back_click')}>
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
						onClick={() => trackEvent('about_footer_privacy_click')}
					>
						Privacy
					</Link>
					<Link
						to="/terms"
						className="hover:text-primary transition-colors"
						onClick={() => trackEvent('about_footer_terms_click')}
					>
						Terms
					</Link>
					<Link
						to="/contact"
						className="hover:text-primary transition-colors"
						onClick={() => trackEvent('about_footer_contact_click')}
					>
						Contact
					</Link>
				</div>
			</div>
		</footer>
	);
}

export function AboutPage() {
	useEffect(() => {
		trackEvent('page_view_about');
	}, []);

	return (
		<div className="min-h-dvh-safe bg-background">
			<SEO
				title="About Us — Building the Future of Hiring"
				description="Rekrut AI (formerly HireLoop) was founded in 2026 to make hiring transparent, intelligent, and fair for everyone. Meet our founders and learn our mission."
				canonical="/about"
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
								About us
							</Badge>
							<h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">
								Building the future of hiring
							</h1>
							<p className="mt-6 text-lg text-muted-foreground">
								Rekrut AI (formerly HireLoop) was founded in 2026 with a simple belief: hiring
								should be transparent, intelligent, and fair for everyone involved. We are building
								the AI-native recruitment platform that both candidates and recruiters actually want
								to use.
							</p>
						</div>
					</div>
				</section>

				{/* Mission */}
				<section className="border-y bg-muted/30 py-20 sm:py-24">
					<div className="mx-auto max-w-7xl px-4">
						<div className="grid gap-12 lg:grid-cols-2 items-center">
							<div>
								<Badge variant="outline" className="mb-4">
									Our mission
								</Badge>
								<h2 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight sm:text-4xl">
									Make every hire a great match
								</h2>
								<p className="mt-4 text-lg text-muted-foreground">
									The average company takes 42 days to fill a role. Candidates send 100+
									applications and hear back from fewer than 10. We exist to fix both sides of this
									broken equation.
								</p>
								<p className="mt-4 text-lg text-muted-foreground">
									By combining AI matching, two-sided scoring, and a unified workflow from sourcing
									to onboarding, we help teams hire 40% faster while giving candidates the
									transparency they deserve.
								</p>
								<div className="mt-8 flex flex-wrap gap-3">
									<Link to="/register" onClick={() => trackEvent('about_mission_cta_click')}>
										<Button className="gap-2">
											Join the mission
											<ArrowRight className="h-4 w-4" />
										</Button>
									</Link>
									<Link to="/contact" onClick={() => trackEvent('about_mission_contact_click')}>
										<Button variant="outline">Contact us</Button>
									</Link>
								</div>
							</div>
							<div className="grid gap-4 sm:grid-cols-2">
								<Card className="border-0 bg-card shadow-sm">
									<CardContent className="p-6">
										<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
											<Target className="h-6 w-6 text-primary" />
										</div>
										<p className="mt-4 font-heading text-2xl sm:text-2xl sm:text-2xl sm:text-3xl font-bold text-primary">
											40%
										</p>
										<p className="mt-1 text-sm text-muted-foreground">Faster time-to-hire</p>
									</CardContent>
								</Card>
								<Card className="border-0 bg-card shadow-sm">
									<CardContent className="p-6">
										<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10">
											<Heart className="h-6 w-6 text-green-600" />
										</div>
										<p className="mt-4 font-heading text-2xl sm:text-3xl font-bold text-green-600">
											3x
										</p>
										<p className="mt-1 text-sm text-muted-foreground">Better candidate matches</p>
									</CardContent>
								</Card>
								<Card className="border-0 bg-card shadow-sm">
									<CardContent className="p-6">
										<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
											<Globe className="h-6 w-6 text-amber-600" />
										</div>
										<p className="mt-4 font-heading text-2xl sm:text-3xl font-bold text-amber-600">
											15+
										</p>
										<p className="mt-1 text-sm text-muted-foreground">Countries supported</p>
									</CardContent>
								</Card>
								<Card className="border-0 bg-card shadow-sm">
									<CardContent className="p-6">
										<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10">
											<Users className="h-6 w-6 text-purple-600" />
										</div>
										<p className="mt-4 font-heading text-2xl sm:text-3xl font-bold text-purple-600">
											50K+
										</p>
										<p className="mt-1 text-sm text-muted-foreground">Candidates matched</p>
									</CardContent>
								</Card>
							</div>
						</div>
					</div>
				</section>

				{/* Values */}
				<section className="py-20 sm:py-24">
					<div className="mx-auto max-w-7xl px-4">
						<div className="mx-auto max-w-2xl text-center">
							<Badge variant="outline" className="mb-4">
								Our values
							</Badge>
							<h2 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight sm:text-4xl">
								How we work
							</h2>
							<p className="mt-4 text-lg text-muted-foreground">
								These principles guide every product decision, every hire we make, and every
								partnership we build.
							</p>
						</div>
						<div className="mt-14 grid gap-6 sm:grid-cols-2">
							{values.map((value) => (
								<Card key={value.title} className="border-0 bg-card shadow-sm">
									<CardContent className="p-8">
										<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
											<value.icon className="h-6 w-6 text-primary" />
										</div>
										<h3 className="mt-6 font-heading text-xl font-semibold">{value.title}</h3>
										<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
											{value.description}
										</p>
									</CardContent>
								</Card>
							))}
						</div>
					</div>
				</section>

				{/* Founders */}
				<section className="border-y bg-muted/30 py-20 sm:py-24">
					<div className="mx-auto max-w-7xl px-4">
						<div className="mx-auto max-w-2xl text-center">
							<Badge variant="outline" className="mb-4">
								Leadership
							</Badge>
							<h2 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight sm:text-4xl">
								Meet the founders
							</h2>
							<p className="mt-4 text-lg text-muted-foreground">
								Rekrut AI was built by two people who experienced the broken hiring process from
								opposite sides.
							</p>
						</div>
						<div className="mt-14 grid gap-8 lg:grid-cols-2">
							{founders.map((founder) => (
								<Card key={founder.name} className="border-0 bg-card shadow-sm">
									<CardContent className="p-8">
										<div className="flex items-start gap-5">
											<img
												src={getDiceBearAvatar(founder.name, { backgroundColor: 'c0aede' })}
												alt={founder.name}
												className="h-16 w-16 rounded-2xl object-cover"
												loading="lazy"
											/>
											<div>
												<h3 className="font-heading text-xl font-semibold">{founder.name}</h3>
												<p className="text-sm text-primary font-medium">{founder.role}</p>
												<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
													{founder.bio}
												</p>
												<div className="mt-4 flex items-center gap-3">
													<a
														href={
															founder.social === 'linkedin'
																? 'https://linkedin.com'
																: 'https://github.com'
														}
														target="_blank"
														rel="noopener noreferrer"
														className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted transition-colors hover:bg-primary/10"
														onClick={() =>
															trackEvent('about_founder_social_click', { platform: founder.social })
														}
													>
														{founder.social === 'linkedin' ? (
															<Linkedin className="h-4 w-4 text-muted-foreground" />
														) : (
															<Twitter className="h-4 w-4 text-muted-foreground" />
														)}
													</a>
												</div>
											</div>
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					</div>
				</section>

				{/* Timeline */}
				<section className="py-20 sm:py-24">
					<div className="mx-auto max-w-7xl px-4">
						<div className="mx-auto max-w-2xl text-center">
							<Badge variant="outline" className="mb-4">
								Journey
							</Badge>
							<h2 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight sm:text-4xl">
								Our story so far
							</h2>
						</div>
						<div className="mt-14 max-w-2xl mx-auto">
							<div className="space-y-8">
								{milestones.map((m, i) => (
									<div key={m.event} className="flex gap-4">
										<div className="flex flex-col items-center">
											<div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
												<m.icon className="h-5 w-5 text-primary" />
											</div>
											{i < milestones.length - 1 && <div className="mt-2 h-full w-px bg-border" />}
										</div>
										<div className="pb-8">
											<p className="text-sm font-semibold text-primary">{m.year}</p>
											<p className="mt-1 text-sm text-muted-foreground">{m.event}</p>
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				</section>

				{/* CTA */}
				<section className="py-20 sm:py-24">
					<div className="mx-auto max-w-7xl px-4">
						<div className="relative overflow-hidden rounded-3xl bg-primary p-8 text-center text-primary-foreground sm:p-12 lg:p-16">
							<div className="absolute inset-0 pointer-events-none">
								<div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
								<div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
							</div>
							<div className="relative">
								<h2 className="font-heading text-2xl font-bold sm:text-3xl lg:text-4xl">
									Want to join the team?
								</h2>
								<p className="mx-auto mt-4 max-w-xl text-primary-foreground/80 lg:text-lg">
									We are always looking for exceptional people who care about building great
									products and making hiring better for everyone.
								</p>
								<div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
									<Link to="/contact" onClick={() => trackEvent('about_careers_click')}>
										<Button variant="secondary" size="lg" className="gap-2">
											View open roles
											<ArrowRight className="h-4 w-4" />
										</Button>
									</Link>
									<Link to="/contact" onClick={() => trackEvent('about_contact_click')}>
										<Button
											variant="outline"
											size="lg"
											className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
										>
											Get in touch
										</Button>
									</Link>
								</div>
							</div>
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	);
}
