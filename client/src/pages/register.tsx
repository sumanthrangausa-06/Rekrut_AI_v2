import {
	AlertCircle,
	Briefcase,
	Building2,
	CheckCircle,
	Clock,
	Eye,
	EyeOff,
	Globe,
	Lock,
	Moon,
	Shield,
	Sun,
	User,
	UserPlus,
	Users,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/ui/logo';
import { getDashboardPath, useAuth } from '@/contexts/auth-context';
import { useTheme } from '@/contexts/theme-context';
import { trackEvent } from '@/lib/analytics';
import type { UserRole } from '@/lib/api';
import { clearTokens } from '@/lib/api';

export function RegisterPage() {
	const { register, isAuthenticated, user } = useAuth();
	const { theme, toggleTheme } = useTheme();
	const [searchParams] = useSearchParams();
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [role, setRole] = useState<UserRole>('candidate');
	const [companyName, setCompanyName] = useState('');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [pendingApproval, setPendingApproval] = useState(false);
	const [_touched, setTouched] = useState<Record<string, boolean>>({});
	const [oauthStatus, setOauthStatus] = useState<{ google?: boolean; linkedin?: boolean }>({});
	const [oauthChecked, setOauthChecked] = useState(false);

	// Check OAuth availability from backend
	useEffect(() => {
		fetch('/api/auth/oauth/status')
			.then((r) => r.json())
			.then((data) => {
				const status: { google?: boolean; linkedin?: boolean } = {};
				if (data?.google?.configured) status.google = true;
				if (data?.linkedin?.configured) status.linkedin = true;
				setOauthStatus(status);
			})
			.catch(() => {
				setOauthStatus({ google: true, linkedin: true });
			})
			.finally(() => setOauthChecked(true));
	}, []);

	// Read ?role=recruiter from URL and pre-select employer role
	useEffect(() => {
		const urlRole = searchParams.get('role');
		if (urlRole === 'recruiter') {
			setRole('employer');
		}
	}, [searchParams]);

	function validateField(field: string, value: string): string {
		switch (field) {
			case 'name':
				return value.trim().length < 2 ? 'Full name must be at least 2 characters' : '';
			case 'email':
				return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : 'Please enter a valid email address';
			case 'password':
				if (value.length < 8) return 'Password must be at least 8 characters';
				if (!/[A-Z]/.test(value)) return 'Password must include at least one uppercase letter';
				if (!/[a-z]/.test(value)) return 'Password must include at least one lowercase letter';
				if (!/[0-9]/.test(value)) return 'Password must include at least one number';
				return '';
			case 'company':
				return role === 'employer' && value.trim().length < 2
					? 'Company name is required for employers'
					: '';
			default:
				return '';
		}
	}

	function validateAll(): boolean {
		const newErrors: Record<string, string> = {};
		let hasError = false;
		['name', 'email', 'password'].forEach((field) => {
			const error = validateField(
				field,
				field === 'name' ? name : field === 'email' ? email : password,
			);
			if (error) {
				newErrors[field] = error;
				hasError = true;
			}
		});
		if (role === 'employer') {
			const companyError = validateField('company', companyName);
			if (companyError) {
				newErrors.company = companyError;
				hasError = true;
			}
		}
		setErrors(newErrors);
		return !hasError;
	}

	useEffect(() => {
		trackEvent('page_view_signup');
	}, []);

	if (isAuthenticated && user) {
		return <Navigate to={getDashboardPath(user)} replace />;
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setTouched({ name: true, email: true, password: true, company: true });
		if (!validateAll()) return;
		setError('');
		setPendingApproval(false);
		setLoading(true);

		try {
			clearTokens();
			trackEvent('signup_submit_click', { role, has_company: role === 'employer' });
			await register({
				email,
				password,
				name,
				role,
				company_name: role === 'employer' ? companyName : undefined,
			});
			trackEvent('signup_complete', { role, has_company: role === 'employer' });
		} catch (err) {
			const errorCode = (err as Error & { code?: string }).code;
			if (errorCode === 'BLOCKED_EMAIL_DOMAIN') {
				setError(
					err instanceof Error
						? err.message
						: 'Free/disposable email providers are not allowed for recruiter registration. Please use your company email address.',
				);
			} else if (errorCode === 'PENDING_APPROVAL') {
				setPendingApproval(true);
				setError(
					err instanceof Error
						? err.message
						: 'Your registration is pending approval from the company administrator.',
				);
			} else {
				setError(err instanceof Error ? err.message : 'Registration failed');
			}
		} finally {
			setLoading(false);
		}
	}

	const handleBlur = (field: string) => {
		setTouched((prev) => ({ ...prev, [field]: true }));
		const value =
			field === 'name'
				? name
				: field === 'email'
					? email
					: field === 'password'
						? password
						: companyName;
		setErrors((prev) => ({ ...prev, [field]: validateField(field, value) }));
	};

	const isRecruiterRole = role === 'employer';
	const hasOAuth = oauthChecked && (oauthStatus.google || oauthStatus.linkedin);

	return (
		<div className="flex min-h-screen">
			{/* Left panel — Form */}
			<div className="flex w-full lg:w-1/2 flex-col">
				{/* Header */}
				<div className="flex items-center justify-between p-6 lg:p-8">
					<Link to="/" className="inline-flex items-center gap-2">
						<Logo size="lg" />
						<span className="font-heading text-xl font-bold">Rekrut AI</span>
					</Link>
					<div className="flex items-center gap-4">
						<p className="hidden sm:block text-sm text-muted-foreground">
							Already have an account?{' '}
							<Link to="/login" className="font-medium text-primary hover:underline">
								Sign in
							</Link>
						</p>
						<button
							type="button"
							onClick={toggleTheme}
							className="inline-flex h-10 w-10 items-center justify-center rounded-full border hover:bg-muted transition-colors"
							aria-label="Toggle theme"
						>
							{theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
						</button>
					</div>
				</div>

				<div className="flex flex-1 items-center justify-center px-6 py-8">
					<div className="w-full max-w-sm">
						<div className="mb-8">
							<h2 className="font-heading text-2xl font-bold">Create an account</h2>
							<p className="mt-1 text-sm text-muted-foreground">
								Join thousands of professionals finding their next opportunity
							</p>
						</div>

						<form onSubmit={handleSubmit} className="space-y-5">
							{error && (
								<div
									className={`flex items-center gap-2 rounded-lg p-3 text-sm ${pendingApproval ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-destructive/10 text-destructive'}`}
								>
									{pendingApproval ? (
										<Clock className="h-4 w-4 shrink-0" />
									) : (
										<AlertCircle className="h-4 w-4 shrink-0" />
									)}
									{error}
								</div>
							)}

							{/* Role selector — card-based toggle */}
							<div className="space-y-2">
								<Label>I am a</Label>
								<div className="grid grid-cols-2 gap-3">
									<button
										type="button"
										onClick={() => {
											setRole('candidate');
											trackEvent('signup_role_select', { role: 'candidate' });
										}}
										className={`relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all ${
											role === 'candidate'
												? 'border-[#4F46E5] bg-[#4F46E5]/5'
												: 'border-border hover:border-muted-foreground/30'
										}`}
									>
										{role === 'candidate' && (
											<div className="absolute top-2 right-2">
												<CheckCircle className="h-4 w-4 text-[#4F46E5]" />
											</div>
										)}
										<User
											className={`h-6 w-6 ${role === 'candidate' ? 'text-[#4F46E5]' : 'text-muted-foreground'}`}
										/>
										<div>
											<p
												className={`text-sm font-medium ${role === 'candidate' ? 'text-[#4F46E5]' : ''}`}
											>
												Job Seeker
											</p>
											<p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
												Find AI-matched jobs & practice interviews
											</p>
										</div>
									</button>
									<button
										type="button"
										onClick={() => {
											setRole('employer');
											trackEvent('signup_role_select', { role: 'employer' });
										}}
										className={`relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all ${
											role === 'employer'
												? 'border-[#4F46E5] bg-[#4F46E5]/5'
												: 'border-border hover:border-muted-foreground/30'
										}`}
									>
										{role === 'employer' && (
											<div className="absolute top-2 right-2">
												<CheckCircle className="h-4 w-4 text-[#4F46E5]" />
											</div>
										)}
										<Briefcase
											className={`h-6 w-6 ${role === 'employer' ? 'text-[#4F46E5]' : 'text-muted-foreground'}`}
										/>
										<div>
											<p
												className={`text-sm font-medium ${role === 'employer' ? 'text-[#4F46E5]' : ''}`}
											>
												Employer
											</p>
											<p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
												Post jobs, screen candidates & hire faster
											</p>
										</div>
									</button>
								</div>
							</div>

							<div className="space-y-2">
								<Label htmlFor="name">Full name</Label>
								<Input
									id="name"
									placeholder="John Doe"
									value={name}
									onChange={(e) => setName(e.target.value)}
									onBlur={() => handleBlur('name')}
									autoComplete="name"
									className={`h-11 ${errors.name ? 'border-red-500' : ''}`}
								/>
								{errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
							</div>

							<div className="space-y-2">
								<Label htmlFor="email">Email</Label>
								<Input
									id="email"
									type="email"
									placeholder="you@company.com"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									onBlur={() => handleBlur('email')}
									autoComplete="email"
									className={`h-11 ${errors.email ? 'border-red-500' : ''}`}
								/>
								{errors.email && <p className="text-xs text-red-500">{errors.email}</p>}
							</div>

							<div className="space-y-2">
								<Label htmlFor="password">Password</Label>
								<div className="relative">
									<Input
										id="password"
										type={showPassword ? 'text' : 'password'}
										placeholder="Enter at least 8+ characters"
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										onBlur={() => handleBlur('password')}
										autoComplete="new-password"
										className={`h-11 pr-10 ${errors.password ? 'border-red-500' : ''}`}
									/>
									<button
										type="button"
										onClick={() => setShowPassword(!showPassword)}
										className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
										aria-label={showPassword ? 'Hide password' : 'Show password'}
									>
										{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
									</button>
								</div>
								{errors.password && <p className="text-xs text-red-500">{errors.password}</p>}
							</div>

							{isRecruiterRole && (
								<div className="space-y-2">
									<Label htmlFor="company">Company name</Label>
									<Input
										id="company"
										placeholder="Your company"
										value={companyName}
										onChange={(e) => setCompanyName(e.target.value)}
										onBlur={() => handleBlur('company')}
										autoComplete="organization"
										className={`h-11 ${errors.company ? 'border-red-500' : ''}`}
									/>
									{errors.company && <p className="text-xs text-red-500">{errors.company}</p>}
								</div>
							)}

							<Button
								type="submit"
								className="w-full h-11 bg-[#4F46E5] hover:bg-[#4338ca] text-white"
								disabled={loading}
							>
								{loading ? (
									<div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
								) : (
									<UserPlus className="h-4 w-4" />
								)}
								{loading ? 'Creating account...' : 'Sign up'}
							</Button>

							{/* Divider */}
							{hasOAuth && (
								<>
									<div className="relative">
										<div className="absolute inset-0 flex items-center">
											<span className="w-full border-t" />
										</div>
										<div className="relative flex justify-center text-xs">
											<span className="bg-background px-2 text-muted-foreground">
												Or sign up with
											</span>
										</div>
									</div>

									<div className="grid grid-cols-2 gap-2">
										{oauthStatus.google && (
											<Button
												type="button"
												variant="outline"
												className="w-full h-11 gap-2"
												onClick={async () => {
													trackEvent('signup_social_click', { provider: 'google' });
													window.location.href = '/api/auth/google/url';
												}}
											>
												<svg className="h-4 w-4" viewBox="0 0 24 24">
													<path
														d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
														fill="#4285F4"
													/>
													<path
														d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.15-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
														fill="#34A853"
													/>
													<path
														d="M5.85 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
														fill="#FBBC05"
													/>
													<path
														d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.67 2.84c.86-2.6 3.3-4.53 6.15-4.53z"
														fill="#EA4335"
													/>
												</svg>
												Google
											</Button>
										)}
										{oauthStatus.linkedin && (
											<Button
												type="button"
												variant="outline"
												className="w-full h-11 gap-2"
												onClick={async () => {
													trackEvent('signup_social_click', { provider: 'linkedin' });
													window.location.href = '/api/auth/linkedin/url';
												}}
											>
												<svg className="h-4 w-4" fill="#0A66C2" viewBox="0 0 24 24">
													<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
												</svg>
												LinkedIn
											</Button>
										)}
									</div>
								</>
							)}

							{/* Trust indicators */}
							<div className="pt-4 border-t">
								<div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
									<div className="flex items-center gap-1.5">
										<Shield className="h-3.5 w-3.5 text-emerald-500" />
										<span>SSL Secured</span>
									</div>
									<div className="flex items-center gap-1.5">
										<Users className="h-3.5 w-3.5 text-emerald-500" />
										<span>Trusted by 2,000+ companies</span>
									</div>
								</div>
								<p className="mt-2 text-center text-[10px] text-muted-foreground/60">
									SOC 2 Type II compliant &middot; GDPR ready &middot; AES-256 encryption
								</p>
							</div>

							{/* Mobile footer link */}
							<p className="sm:hidden text-center text-sm text-muted-foreground">
								Already have an account?{' '}
								<Link to="/login" className="font-medium text-primary hover:underline">
									Sign in
								</Link>
							</p>
						</form>
					</div>
				</div>
			</div>

			{/* Right panel — Decorative / Branding */}
			<div className="hidden lg:flex lg:w-1/2 relative items-center justify-center overflow-hidden bg-[#4F46E5]">
				{/* Abstract background shapes */}
				<div className="absolute inset-0 pointer-events-none">
					<div className="absolute top-10 right-10 h-20 w-20 rounded-full bg-white/10" />
					<div className="absolute bottom-20 left-10 h-32 w-32 rounded-full bg-white/10" />
					<div className="absolute top-1/2 right-1/4 h-16 w-16 rounded-full bg-white/10" />
					<div className="absolute bottom-10 right-20 h-24 w-24 rounded-full bg-white/10" />
					<div className="absolute top-1/3 left-1/4 h-40 w-40 rounded-full bg-white/5" />
					<div className="absolute -bottom-8 -left-8 h-48 w-48 rounded-full bg-white/5" />
				</div>
				<div className="relative z-10 text-center text-white px-12 max-w-lg">
					<div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 mb-6">
						<svg
							className="h-8 w-8 text-white"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={2}
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
							/>
						</svg>
					</div>
					<h3 className="font-heading text-2xl sm:text-3xl font-bold mb-4">
						{isRecruiterRole ? 'Hire smarter, faster' : 'Your next chapter starts here'}
					</h3>
					<p className="text-white/80 text-lg max-w-sm mx-auto leading-relaxed">
						{isRecruiterRole
							? 'Join 2,000+ companies using AI to find, screen, and hire the best candidates in record time.'
							: 'Create your account to start matching with AI-recommended jobs, practice mock interviews, and build your OmniScore.'}
					</p>

					{/* Feature highlights */}
					<div className="mt-10 space-y-3 text-left">
						<div className="flex items-center gap-3">
							<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 shrink-0">
								{isRecruiterRole ? (
									<Building2 className="h-4 w-4" />
								) : (
									<Globe className="h-4 w-4" />
								)}
							</div>
							<div>
								<p className="font-medium text-sm">
									{isRecruiterRole ? 'AI-Powered Screening' : 'AI Job Matching'}
								</p>
								<p className="text-xs text-white/70">
									{isRecruiterRole
										? 'Automated candidate ranking & skill analysis'
										: 'Get matched to roles that fit your skills'}
								</p>
							</div>
						</div>
						<div className="flex items-center gap-3">
							<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 shrink-0">
								{isRecruiterRole ? <Users className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
							</div>
							<div>
								<p className="font-medium text-sm">
									{isRecruiterRole ? 'Collaborative Hiring' : 'Secure & Private'}
								</p>
								<p className="text-xs text-white/70">
									{isRecruiterRole
										? 'Team-based workflows & interview scheduling'
										: 'Your data is encrypted and never shared'}
								</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
