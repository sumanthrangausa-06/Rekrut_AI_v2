/**
 * Public referral assessment page — issue #349.
 *
 * A recruiter shares /r/:token with a candidate by email. The candidate sees
 * what the assessment involves (job, company TrustScore, dimensions, due date),
 * then signs up / logs in and lands directly in a pre-assigned attempt.
 *
 * Phases mirror CandidateInterviewSessionPage: loading → invalid | expired →
 * preview (auth-dependent CTA). No answer material is ever exposed here — the
 * preview API returns metadata only.
 */
import {
	AlertTriangle,
	Briefcase,
	Building2,
	CalendarClock,
	CheckCircle2,
	Clock,
	HelpCircle,
	Link2,
	ListChecks,
	Loader2,
	ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { apiCall } from '@/lib/api';

type Phase = 'loading' | 'invalid' | 'expired' | 'preview';

interface ReferralPreview {
	job_title: string;
	company_name: string | null;
	company_trustscore: { score: number; tier: string } | null;
	assessment_title: string;
	assessment_description: string | null;
	dimensions: string[];
	question_count: number;
	time_limit_minutes: number | null;
	due_date: string | null;
}

const tierStyles: Record<string, string> = {
	exceptional: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/30',
	excellent: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
	trusted: 'bg-green-500/10 text-green-700 border-green-500/30',
	good: 'bg-blue-500/10 text-blue-700 border-blue-500/30',
	building: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
	new: 'bg-slate-500/10 text-slate-500 border-slate-500/30',
};

function formatDueDate(iso: string | null): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ReferralAssessmentPage() {
	const { token } = useParams<{ token: string }>();
	const navigate = useNavigate();
	const { isAuthenticated, loading: authLoading, user } = useAuth();
	const [phase, setPhase] = useState<Phase>('loading');
	const [preview, setPreview] = useState<ReferralPreview | null>(null);
	const [claiming, setClaiming] = useState(false);
	const [claimError, setClaimError] = useState<string | null>(null);

	useEffect(() => {
		if (!token) {
			setPhase('invalid');
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const data = await apiCall<ReferralPreview>(
					`/assessments/refer/${encodeURIComponent(token)}/preview`,
					{ skipAuthCheck: true },
				);
				if (!cancelled) {
					setPreview(data);
					setPhase('preview');
				}
			} catch (err: any) {
				if (cancelled) return;
				// apiCall throws Error(message) with an optional .code.
				// 410s: 'Referral expired' (code REFERRAL_EXPIRED) or
				// 'Assessment is no longer available'. 404: 'Referral not found'.
				const msg = String(err?.message || '');
				const code = (err as Error & { code?: string })?.code;
				const expired =
					code === 'REFERRAL_EXPIRED' ||
					msg.toLowerCase().includes('expired') ||
					msg.toLowerCase().includes('no longer available');
				setPhase(expired ? 'expired' : 'invalid');
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [token]);

	async function handleClaim() {
		if (!token || claiming) return;
		setClaiming(true);
		setClaimError(null);
		try {
			const res = await apiCall<{ redirect_url: string; status: string }>(
				'/assessments/refer/claim',
				{ method: 'POST', body: { token } },
			);
			navigate(res.redirect_url || '/candidate/assessments', { replace: true });
		} catch (err: any) {
			setClaimError(err?.message || 'Could not start the assessment. Please try again.');
		} finally {
			setClaiming(false);
		}
	}

	if (phase === 'loading' || authLoading) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-primary" />
			</div>
		);
	}

	if (phase === 'invalid' || phase === 'expired') {
		return (
			<div className="flex min-h-screen items-center justify-center px-4">
				<Card className="w-full max-w-md text-center">
					<CardContent className="pt-8 pb-8 space-y-4">
						<div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
							{phase === 'expired' ? (
								<CalendarClock className="h-7 w-7 text-amber-600" />
							) : (
								<Link2 className="h-7 w-7 text-amber-600" />
							)}
						</div>
						<h1 className="font-heading text-xl font-bold">
							{phase === 'expired' ? 'This link has expired' : 'Invalid referral link'}
						</h1>
						<p className="text-sm text-muted-foreground">
							{phase === 'expired'
								? 'The deadline for this assessment has passed. Please contact the recruiter for a new link.'
								: 'This referral link is not valid. Please check the URL or ask the recruiter to resend it.'}
						</p>
						<Button asChild variant="outline">
							<Link to="/">Back to home</Link>
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (!preview) return null;

	const returnTo = `/r/${token}`;
	// Email-match is enforced server-side by the claim endpoint (403); the page
	// surfaces that error cleanly instead of pre-checking (the preview API
	// deliberately does not expose the referral's target email).
	const dueDate = formatDueDate(preview.due_date);

	return (
		<div className="min-h-screen bg-gradient-to-b from-violet-50/60 to-background px-4 py-8 sm:py-12">
			<div className="mx-auto w-full max-w-2xl space-y-6">
				{/* Header card */}
				<Card>
					<CardHeader>
						<div className="flex items-start gap-3">
							<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-100">
								<Briefcase className="h-6 w-6 text-violet-600" />
							</div>
							<div className="min-w-0">
								<CardTitle className="font-heading text-xl sm:text-2xl">
									{preview.assessment_title}
								</CardTitle>
								<CardDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
									<span className="inline-flex items-center gap-1">
										<Building2 className="h-3.5 w-3.5" />
										{preview.company_name ?? 'Company'} · {preview.job_title}
									</span>
									{preview.company_trustscore && (
										<Badge
											variant="outline"
											className={
												tierStyles[preview.company_trustscore.tier] ?? tierStyles.new
											}
										>
											<ShieldCheck className="mr-1 h-3 w-3" />
											TrustScore {preview.company_trustscore.score}
										</Badge>
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent className="space-y-5">
						{preview.assessment_description && (
							<p className="text-sm text-muted-foreground">{preview.assessment_description}</p>
						)}

						{/* What will be evaluated */}
						<div>
							<h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
								<ListChecks className="h-4 w-4 text-violet-600" />
								What will be evaluated
							</h2>
							<div className="flex flex-wrap gap-2">
								{preview.dimensions.map((d) => (
									<Badge key={d} variant="secondary" className="capitalize">
										{d.replace(/_/g, ' ')}
									</Badge>
								))}
							</div>
						</div>

						{/* Facts */}
						<div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
							<div className="flex items-center gap-2 rounded-lg border p-3">
								<HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
								<span>
									<span className="font-semibold">{preview.question_count}</span> questions
								</span>
							</div>
							{preview.time_limit_minutes != null && (
								<div className="flex items-center gap-2 rounded-lg border p-3">
									<Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
									<span>
										<span className="font-semibold">{preview.time_limit_minutes}</span> min
									</span>
								</div>
							)}
							{dueDate && (
								<div className="flex items-center gap-2 rounded-lg border p-3">
									<CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
									<span>
										Due <span className="font-semibold">{dueDate}</span>
									</span>
								</div>
							)}
						</div>

						{/* AI disclosure */}
						<div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
							<AlertTriangle className="h-4 w-4 shrink-0" />
							<span>This assessment is scored by AI and reviewed by a human.</span>
						</div>

						{/* Auth-dependent CTA */}
						{!isAuthenticated ? (
							<div className="space-y-3 rounded-xl border bg-muted/40 p-4">
								<p className="text-sm font-medium">
									Create a free account to take this assessment. Your results stay on your
									profile.
								</p>
								<div className="flex flex-col gap-2 sm:flex-row">
									<Button asChild className="flex-1">
										<Link to={`/register?returnTo=${encodeURIComponent(returnTo)}`}>
											Create account to start
										</Link>
									</Button>
									<Button asChild variant="outline" className="flex-1">
										<Link to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Log in</Link>
									</Button>
								</div>
							</div>
						) : (
							<div className="space-y-3">
								{claimError && (
									<div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
										<AlertTriangle className="h-4 w-4 shrink-0" />
										<span>{claimError}</span>
									</div>
								)}
								<Button onClick={handleClaim} disabled={claiming} className="w-full" size="lg">
									{claiming ? (
										<Loader2 className="h-5 w-5 animate-spin" />
									) : (
										<CheckCircle2 className="h-5 w-5" />
									)}
									{claiming ? 'Starting…' : 'Start assessment'}
								</Button>
								<p className="text-center text-xs text-muted-foreground">
									Signed in as {user?.email}. This link was issued to a specific email —
									if it doesn't match, you'll see an error here.
								</p>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
