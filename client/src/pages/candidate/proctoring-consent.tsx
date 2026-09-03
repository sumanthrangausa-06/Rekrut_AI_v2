import {
	AlertCircle,
	CheckCircle,
	Eye,
	Loader2,
	Shield,
	ShieldCheck,
	UserCheck,
	Video,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiCall } from '@/lib/api';

interface ProctoringSession {
	id: number;
	application_id: number;
	status: string;
	consent_given: boolean;
	started_at: string | null;
	ended_at: string | null;
	created_at: string;
	updated_at: string;
}

export function CandidateProctoringConsentPage() {
	const { sessionId } = useParams<{ sessionId: string }>();
	const navigate = useNavigate();
	const [session, setSession] = useState<ProctoringSession | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [consenting, setConsenting] = useState(false);

	const loadSession = useCallback(async () => {
		try {
			setLoading(true);
			const data = await apiCall<{ success: boolean; session: ProctoringSession }>(
				`/proctoring/session/${sessionId}`,
			);
			setSession(data.session);
			if (data.session.consent_given && data.session.status === 'in_progress') {
				// Already consented — redirect to session status
				navigate(`/candidate/proctoring/${sessionId}`);
			}
		} catch (err: any) {
			setError(err.message || 'Failed to load proctoring session');
		} finally {
			setLoading(false);
		}
	}, [sessionId, navigate]);

	useEffect(() => {
		loadSession();
	}, [loadSession]);

	async function giveConsent() {
		if (!session) return;
		setConsenting(true);
		try {
			await apiCall(`/proctoring/session/${sessionId}/consent`, {
				method: 'POST',
				body: { consent_given: true },
			});
			// Navigate to the session status/in-proctoring page
			navigate(`/candidate/proctoring/${sessionId}`);
		} catch (err: any) {
			setError(err.message || 'Failed to record consent');
		} finally {
			setConsenting(false);
		}
	}

	if (loading) {
		return (
			<div className="min-h-dvh-safe bg-gradient-to-br from-slate-50 to-indigo-50 flex items-center justify-center">
				<div className="text-center space-y-4">
					<Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto" />
					<p className="text-slate-600">Loading proctoring session...</p>
				</div>
			</div>
		);
	}

	if (error && !session) {
		return (
			<div className="min-h-dvh-safe bg-gradient-to-br from-slate-50 to-red-50 flex items-center justify-center p-4">
				<Card className="max-w-md w-full">
					<CardContent className="p-8 text-center space-y-4">
						<AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
						<h2 className="text-xl font-semibold text-slate-900">Unable to Load Session</h2>
						<p className="text-slate-600">{error}</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (!session) return null;

	// Already completed or reviewed
	if (['completed', 'flagged', 'reviewed'].includes(session.status)) {
		return (
			<div className="min-h-dvh-safe bg-gradient-to-br from-slate-50 to-green-50 flex items-center justify-center p-4">
				<Card className="max-w-lg w-full">
					<CardContent className="p-8 text-center space-y-6">
						<div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
							<CheckCircle className="w-8 h-8 text-green-600" />
						</div>
						<div>
							<h2 className="text-2xl font-bold text-slate-900 mb-2">Session Completed</h2>
							<p className="text-slate-600">This proctored session has already been completed.</p>
						</div>
						<Button onClick={() => navigate('/candidate/dashboard')} className="min-h-[44px]">
							Go to Dashboard
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="min-h-dvh-safe bg-gradient-to-br from-slate-50 to-indigo-50 flex items-center justify-center p-4">
			<div className="max-w-2xl w-full space-y-6">
				{/* Header */}
				<div className="text-center space-y-2">
					<div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto">
						<Shield className="w-8 h-8 text-indigo-600" />
					</div>
					<h1 className="text-2xl font-bold text-slate-900">Proctored Assessment</h1>
					<p className="text-slate-600">
						Before you begin, please review and consent to the proctoring terms.
					</p>
				</div>

				{error && (
					<div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-start gap-3">
						<AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
						{error}
					</div>
				)}

				{/* What we monitor */}
				<Card>
					<CardContent className="p-6 space-y-4">
						<h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
							<Eye className="w-5 h-5 text-indigo-600" />
							What We Monitor
						</h2>
						<p className="text-sm text-slate-600">
							To ensure assessment integrity, our automated proctoring system will monitor for:
						</p>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
							{[
								{ icon: <Video className="w-4 h-4" />, label: 'Face presence detection' },
								{ icon: <Eye className="w-4 h-4" />, label: 'Tab or window switching' },
								{ icon: <Shield className="w-4 h-4" />, label: 'Copy/paste attempts' },
								{ icon: <UserCheck className="w-4 h-4" />, label: 'Multiple faces detected' },
								{ icon: <AlertCircle className="w-4 h-4" />, label: 'Suspicious audio patterns' },
								{ icon: <CheckCircle className="w-4 h-4" />, label: 'Timing anomalies' },
							].map((item) => (
								<div
									key={item.label}
									className="flex items-center gap-3 bg-slate-50 rounded-lg p-3"
								>
									<div className="text-indigo-600">{item.icon}</div>
									<span className="text-sm text-slate-700">{item.label}</span>
								</div>
							))}
						</div>
					</CardContent>
				</Card>

				{/* Privacy & fairness */}
				<Card>
					<CardContent className="p-6 space-y-4">
						<h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
							<ShieldCheck className="w-5 h-5 text-indigo-600" />
							Privacy & Fairness
						</h2>
						<ul className="space-y-3 text-sm text-slate-600">
							<li className="flex items-start gap-2">
								<CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
								<span>
									We <strong>never auto-reject</strong> candidates based on automated flags. All
									flagged sessions are reviewed by a human recruiter.
								</span>
							</li>
							<li className="flex items-start gap-2">
								<CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
								<span>
									No video is recorded or stored. Only event metadata (e.g., "tab switched") is
									logged for integrity purposes.
								</span>
							</li>
							<li className="flex items-start gap-2">
								<CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
								<span>
									Your data is handled in accordance with our Privacy Policy and GDPR requirements.
								</span>
							</li>
							<li className="flex items-start gap-2">
								<CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
								<span>
									You may withdraw consent at any time by ending the session, though this may
									invalidate your assessment.
								</span>
							</li>
						</ul>
					</CardContent>
				</Card>

				{/* Consent action */}
				<Card className="border-indigo-200 bg-indigo-50/50">
					<CardContent className="p-6 space-y-4">
						<p className="text-sm text-slate-700">
							By clicking <strong>I Consent</strong>, you agree to the proctoring process described
							above and confirm that you will complete this assessment without unauthorized
							assistance.
						</p>
						<Button
							onClick={giveConsent}
							disabled={consenting}
							className="w-full min-h-[44px] bg-indigo-600 hover:bg-indigo-700"
							size="lg"
						>
							{consenting ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin mr-2" />
									Recording Consent...
								</>
							) : (
								<>
									<ShieldCheck className="w-4 h-4 mr-2" />I Consent to Proctoring
								</>
							)}
						</Button>
						<p className="text-xs text-center text-slate-500">
							Your IP address and timestamp will be recorded for audit purposes.
						</p>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
