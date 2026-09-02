import {
	AlertCircle,
	ArrowRight,
	Briefcase,
	CheckCircle,
	FileText,
	GraduationCap,
	Info,
	Linkedin,
	Loader2,
	Mail,
	MapPin,
	RefreshCw,
	User,
	Wrench,
	X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { apiCall } from '@/lib/api';

interface LinkedInImportData {
	name?: string;
	email?: string;
	photo?: string;
	linkedin_url?: string;
}

interface LinkedInImportModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onNavigateToSection: (section: string) => void;
}

type ImportState = 'idle' | 'loading' | 'success' | 'error';

interface MissingField {
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	section: string;
	description: string;
}

const missingFields: MissingField[] = [
	{
		label: 'Headline',
		icon: FileText,
		section: 'personal',
		description: 'Your professional title',
	},
	{
		label: 'Bio / Summary',
		icon: FileText,
		section: 'personal',
		description: 'Tell employers about yourself',
	},
	{
		label: 'Location',
		icon: MapPin,
		section: 'personal',
		description: 'Where you work or want to work',
	},
	{ label: 'Experience', icon: Briefcase, section: 'experience', description: 'Your work history' },
	{
		label: 'Education',
		icon: GraduationCap,
		section: 'education',
		description: 'Schools and degrees',
	},
	{ label: 'Skills', icon: Wrench, section: 'skills', description: 'Tools and technologies' },
];

export function LinkedInImportModal({
	open,
	onOpenChange,
	onNavigateToSection,
}: LinkedInImportModalProps) {
	const navigate = useNavigate();
	const [state, setState] = useState<ImportState>('idle');
	const [data, setData] = useState<LinkedInImportData | null>(null);
	const [errorMessage, setErrorMessage] = useState('');
	const [errorCode, setErrorCode] = useState<string | undefined>(undefined);

	useEffect(() => {
		if (!open) {
			// Reset state when modal closes
			setState('idle');
			setData(null);
			setErrorMessage('');
			setErrorCode(undefined);
			return;
		}

		async function fetchImport() {
			setState('loading');
			try {
				const result = await apiCall<LinkedInImportData>('/candidate/linkedin/import', {
					method: 'POST',
				});
				setData(result);
				setState('success');
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to import LinkedIn data';
				const code = (err as Error & { code?: string }).code;
				setState('error');
				setErrorMessage(message);
				setErrorCode(code);
			}
		}

		fetchImport();
	}, [open]);

	function handleNavigate(section: string) {
		onNavigateToSection(section);
		onOpenChange(false);
	}

	function handleReauth() {
		// Trigger LinkedIn OAuth re-authentication
		window.location.href = '/api/auth/linkedin/url';
	}

	function handleCompleteProfile() {
		onOpenChange(false);
		navigate('/candidate/profile');
	}

	const isNotConnected =
		errorCode === 'LINKEDIN_NOT_CONNECTED' || errorCode === 'LINKEDIN_TOKEN_MISSING';
	const isTokenExpired = errorCode === 'LINKEDIN_TOKEN_EXPIRED';
	const canReconnect =
		isTokenExpired ||
		isNotConnected ||
		errorCode === 'TOKEN_DECRYPTION_FAILED' ||
		errorCode === 'LINKEDIN_API_ERROR' ||
		errorCode === 'LINKEDIN_EMAIL_MISSING';

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogHeader>
				<div className="flex items-center gap-2 mb-1">
					<div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#0A66C2] to-[#0077B5] flex items-center justify-center shrink-0">
						<Linkedin className="h-4 w-4 text-white" />
					</div>
					<DialogTitle className="text-lg font-semibold">LinkedIn Profile Import</DialogTitle>
				</div>
				<DialogDescription className="text-sm text-muted-foreground">
					{state === 'success'
						? "We've imported what we can from your LinkedIn profile."
						: state === 'error'
							? 'We ran into an issue connecting to LinkedIn.'
							: "We're connecting to your LinkedIn profile to speed up your setup."}
				</DialogDescription>
			</DialogHeader>

			{state === 'loading' && (
				<div className="flex flex-col items-center justify-center py-10 space-y-3">
					<Loader2 className="h-8 w-8 animate-spin text-primary" />
					<p className="text-sm text-muted-foreground">Importing your LinkedIn profile...</p>
					<p className="text-xs text-muted-foreground max-w-xs text-center">
						This may take a few seconds. We only access your basic profile info.
					</p>
				</div>
			)}

			{state === 'error' && (
				<div className="space-y-4 py-2">
					{isNotConnected ? (
						<div className="flex flex-col items-center text-center py-4 space-y-4">
							<div className="h-14 w-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
								<Linkedin className="h-7 w-7 text-slate-400" />
							</div>
							<div className="space-y-1">
								<p className="text-sm font-medium">LinkedIn Not Connected</p>
								<p className="text-sm text-muted-foreground max-w-xs mx-auto">
									Connect your LinkedIn account to auto-fill your profile and speed up your setup.
								</p>
							</div>
							<Button onClick={handleReauth} className="gap-2 min-h-[44px]">
								<Linkedin className="h-4 w-4" />
								Connect LinkedIn
							</Button>
						</div>
					) : isTokenExpired ? (
						<div className="flex flex-col items-center text-center py-4 space-y-4">
							<div className="h-14 w-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
								<RefreshCw className="h-7 w-7 text-amber-600 dark:text-amber-400" />
							</div>
							<div className="space-y-1">
								<p className="text-sm font-medium">LinkedIn Connection Expired</p>
								<p className="text-sm text-muted-foreground max-w-xs mx-auto">
									Your LinkedIn access token has expired for security reasons. Please reconnect your
									account to continue.
								</p>
							</div>
							<Button onClick={handleReauth} className="gap-2 min-h-[44px]">
								<RefreshCw className="h-4 w-4" />
								Reconnect LinkedIn
							</Button>
						</div>
					) : (
						<div className="space-y-4">
							<div className="flex items-start gap-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-4">
								<AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
								<div className="space-y-1 min-w-0">
									<p className="text-sm font-medium text-red-900 dark:text-red-100">
										Import Failed
									</p>
									<p className="text-sm text-red-700 dark:text-red-200 break-words">
										{errorMessage}
									</p>
									{errorCode && <p className="text-xs text-red-500 font-mono">Code: {errorCode}</p>}
								</div>
							</div>
							{canReconnect && (
								<Button
									onClick={handleReauth}
									variant="outline"
									className="w-full gap-2 min-h-[44px]"
								>
									<RefreshCw className="h-4 w-4" />
									Try reconnecting LinkedIn
								</Button>
							)}
						</div>
					)}
				</div>
			)}

			{state === 'success' && data && (
				<div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
					{/* Imported fields */}
					<Card className="border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
						<CardContent className="p-4 space-y-3">
							<p className="text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-300 flex items-center gap-1.5">
								<CheckCircle className="h-3.5 w-3.5" />
								Successfully Imported from LinkedIn
							</p>

							<div className="space-y-2.5">
								{data.photo ? (
									<div className="flex items-center gap-3">
										<Avatar src={data.photo} alt={data.name || 'Profile'} size="md" />
										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium">Profile Photo</p>
											<p className="text-xs text-muted-foreground">Imported from LinkedIn</p>
										</div>
										<CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
									</div>
								) : null}

								{data.name ? (
									<div className="flex items-center gap-3">
										<div className="h-8 w-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
											<User className="h-4 w-4 text-green-600 dark:text-green-400" />
										</div>
										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium truncate">{data.name}</p>
											<p className="text-xs text-muted-foreground">Full Name</p>
										</div>
										<CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
									</div>
								) : null}

								{data.email ? (
									<div className="flex items-center gap-3">
										<div className="h-8 w-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
											<Mail className="h-4 w-4 text-green-600 dark:text-green-400" />
										</div>
										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium truncate">{data.email}</p>
											<p className="text-xs text-muted-foreground">Email Address</p>
										</div>
										<CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
									</div>
								) : null}

								{!data.name && !data.email && !data.photo && (
									<p className="text-sm text-muted-foreground">
										No basic profile data was returned. You may need to re-authenticate.
									</p>
								)}
							</div>
						</CardContent>
					</Card>

					{/* Missing fields */}
					<div className="space-y-2">
						<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
							Fields You'll Need to Add
						</p>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
							{missingFields.map((field) => {
								const Icon = field.icon;
								return (
									<button type="button"
										key={field.label}
										onClick={() => handleNavigate(field.section)}
										className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted/50 transition-colors text-left group focus:outline-none focus:ring-2 focus:ring-primary/50"
										type="button"
									>
										<div className="h-8 w-8 rounded-lg bg-indigo-100 dark:bg-indigo-950/30 flex items-center justify-center shrink-0">
											<Icon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
										</div>
										<div className="flex-1 min-w-0">
											<p className="text-sm font-medium">{field.label}</p>
											<p className="text-xs text-muted-foreground">{field.description}</p>
										</div>
										<ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
									</button>
								);
							})}
						</div>
					</div>

					{/* Info message about API limits */}
					<div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3.5">
						<div className="flex items-start gap-2.5">
							<Info className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
							<div className="space-y-1">
								<p className="text-xs font-medium text-amber-900 dark:text-amber-100">
									Why can't we import everything?
								</p>
								<p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
									LinkedIn limits what third-party apps can access for privacy and security. We can
									only import your basic profile info (name, email, photo). Experience, education,
									skills, and your summary must be added manually — but clicking any field above
									will take you right to the right section.
								</p>
							</div>
						</div>
					</div>
				</div>
			)}

			<DialogFooter className="flex-col sm:flex-row gap-2 mt-5">
				<Button
					variant="outline"
					onClick={() => onOpenChange(false)}
					className="w-full sm:w-auto gap-1 min-h-[44px]"
				>
					<X className="h-4 w-4" />
					Skip and fill later
				</Button>
				{state === 'success' && (
					<Button onClick={handleCompleteProfile} className="w-full sm:w-auto gap-1 min-h-[44px]">
						Complete Profile
						<ArrowRight className="h-4 w-4" />
					</Button>
				)}
				{state === 'error' && !canReconnect && (
					<Button
						onClick={() => onOpenChange(false)}
						variant="secondary"
						className="w-full sm:w-auto gap-1 min-h-[44px]"
					>
						Continue Anyway
						<ArrowRight className="h-4 w-4" />
					</Button>
				)}
			</DialogFooter>
		</Dialog>
	);
}
