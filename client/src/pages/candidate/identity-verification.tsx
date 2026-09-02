import {
	AlertTriangle,
	CheckCircle,
	Clock,
	FileText,
	Fingerprint,
	Shield,
	XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/domain/empty-state';
import { Skeleton } from '@/components/domain/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import { trackEvent } from '@/lib/analytics';
import { apiCall } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────

type VerificationStatus = 'pending' | 'otp_sent' | 'verified' | 'failed';

interface VerificationRecord {
	type: 'aadhaar' | 'pan';
	status: VerificationStatus;
	masked_value: string | null;
	verified_at: string | null;
	consent_given: boolean;
}

interface StatusResponse {
	success: boolean;
	verifications: VerificationRecord[];
}

// ─── Verhoeff Checksum (client-side Aadhaar validation) ───────────────────

const VERHOEFF_D = [
	[0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	[1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
	[2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
	[3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
	[4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
	[5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
	[6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
	[7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
	[8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
	[9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P = [
	[0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	[1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
	[5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
	[8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
	[9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
	[4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
	[2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
	[7, 0, 4, 6, 9, 1, 3, 5, 2, 8],
];

function validateAadhaarChecksum(aadhaarNumber: string): boolean {
	const clean = aadhaarNumber.replace(/\s/g, '');
	if (!/^\d{12}$/.test(clean)) return false;
	let c = 0;
	const digits = clean.split('').reverse().map(Number);
	for (let i = 0; i < digits.length; i++) {
		c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]];
	}
	return c === 0;
}

function maskAadhaar(aadhaarNumber: string): string {
	const clean = aadhaarNumber.replace(/\s/g, '');
	return `XXXX-XXXX-${clean.slice(-4)}`;
}

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

// ─── Status helpers ───────────────────────────────────────────────────────

const statusConfig: Record<
	VerificationStatus,
	{ icon: React.ReactNode; color: string; label: string }
> = {
	pending: {
		icon: <Clock className="h-4 w-4" />,
		color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
		label: 'Pending',
	},
	otp_sent: {
		icon: <Clock className="h-4 w-4" />,
		color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
		label: 'OTP Sent',
	},
	verified: {
		icon: <CheckCircle className="h-4 w-4" />,
		color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
		label: 'Verified',
	},
	failed: {
		icon: <XCircle className="h-4 w-4" />,
		color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
		label: 'Failed',
	},
};

// ─── Component ────────────────────────────────────────────────────────────

export function CandidateIdentityVerificationPage() {
	const { user } = useAuth();

	// ── Global state ──
	const [verifications, setVerifications] = useState<VerificationRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState('aadhaar');
	const [toastMessage, setToastMessage] = useState<string | null>(null);

	// ── Aadhaar state ──
	const [aadhaarNumber, setAadhaarNumber] = useState('');
	const [aadhaarValid, setAadhaarValid] = useState<boolean | null>(null);
	const [aadhaarMasked, setAadhaarMasked] = useState<string | null>(null);
	const [aadhaarConsent, setAadhaarConsent] = useState(false);
	const [aadhaarHash, setAadhaarHash] = useState<string | null>(null);
	const [otp, setOtp] = useState('');
	const [otpSent, setOtpSent] = useState(false);
	const [aadhaarSubmitting, setAadhaarSubmitting] = useState(false);
	const [aadhaarOtpSubmitting, setAadhaarOtpSubmitting] = useState(false);

	// ── Offline XML state ──
	const [xmlData, setXmlData] = useState('');
	const [xmlSubmitting, setXmlSubmitting] = useState(false);

	// ── PAN state ──
	const [panNumber, setPanNumber] = useState('');
	const [panValid, setPanValid] = useState<boolean | null>(null);
	const [panConsent, setPanConsent] = useState(false);
	const [panSubmitting, setPanSubmitting] = useState(false);

	const showToast = useCallback((msg: string) => {
		setToastMessage(msg);
		setTimeout(() => setToastMessage(null), 4000);
	}, []);

	// ── Load status ──
	async function loadStatus() {
		setLoading(true);
		setError(null);
		try {
			const data = await apiCall<StatusResponse>('/identity-verification/status');
			setVerifications(data.verifications || []);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Failed to load verification status';
			setError(msg);
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		loadStatus();
	}, []);

	// ── Aadhaar validation ──
	function handleAadhaarChange(value: string) {
		// Only allow digits and spaces
		const cleaned = value.replace(/[^\d\s]/g, '');
		setAadhaarNumber(cleaned);
		if (cleaned.replace(/\s/g, '').length === 12) {
			const valid = validateAadhaarChecksum(cleaned);
			setAadhaarValid(valid);
			setAadhaarMasked(valid ? maskAadhaar(cleaned) : null);
		} else {
			setAadhaarValid(null);
			setAadhaarMasked(null);
		}
	}

	async function validateAadhaarServer() {
		const clean = aadhaarNumber.replace(/\s/g, '');
		if (clean.length !== 12) return;
		try {
			const data = await apiCall<{ valid: boolean; masked: string | null }>(
				'/identity-verification/aadhaar/validate',
				{
					method: 'POST',
					body: { aadhaarNumber: clean },
				},
			);
			setAadhaarValid(data.valid);
			setAadhaarMasked(data.masked);
		} catch (err) {
			console.error('Aadhaar validation failed:', err);
		}
	}

	async function initiateOtp() {
		if (!aadhaarValid || !aadhaarConsent || !aadhaarMasked) return;
		setAadhaarSubmitting(true);
		try {
			const data = await apiCall<{ success: boolean; message: string }>(
				'/identity-verification/aadhaar/initiate-otp',
				{
					method: 'POST',
					body: { aadhaarNumber: aadhaarNumber.replace(/\s/g, ''), consent: true },
				},
			);
			setOtpSent(true);
			// Use masked value as a simple hash identifier for the demo
			setAadhaarHash(aadhaarMasked);
			showToast(data.message || 'OTP sent to registered mobile');
			trackEvent('identity_aadhaar_otp_initiated');
		} catch (err: unknown) {
			handleApiError(err, 'Failed to send OTP');
		} finally {
			setAadhaarSubmitting(false);
		}
	}

	async function verifyOtp() {
		if (!aadhaarHash || otp.length !== 6) return;
		setAadhaarOtpSubmitting(true);
		try {
			const data = await apiCall<{ success: boolean; verified: boolean }>(
				'/identity-verification/aadhaar/verify-otp',
				{
					method: 'POST',
					body: { aadhaarHash, otp },
				},
			);
			if (data.verified) {
				showToast('Aadhaar verified successfully');
				trackEvent('identity_aadhaar_verified');
				setOtpSent(false);
				setOtp('');
				setAadhaarNumber('');
				setAadhaarValid(null);
				setAadhaarConsent(false);
			} else {
				showToast('Invalid OTP. Please try again.');
			}
			await loadStatus();
		} catch (err: unknown) {
			handleApiError(err, 'Failed to verify OTP');
		} finally {
			setAadhaarOtpSubmitting(false);
		}
	}

	async function verifyXml() {
		if (!xmlData.trim() || !aadhaarConsent) return;
		setXmlSubmitting(true);
		try {
			const data = await apiCall<{
				success: boolean;
				details: { name: string; maskedAadhaar: string };
			}>('/identity-verification/aadhaar/offline-xml', {
				method: 'POST',
				body: { xmlData: xmlData.trim(), consent: true },
			});
			showToast(`Offline XML verified for ${data.details.name || 'Aadhaar'}`);
			trackEvent('identity_aadhaar_xml_verified');
			setXmlData('');
			await loadStatus();
		} catch (err: unknown) {
			handleApiError(err, 'Failed to verify XML');
		} finally {
			setXmlSubmitting(false);
		}
	}

	// ── PAN ──
	function handlePanChange(value: string) {
		const upper = value.toUpperCase().trim();
		setPanNumber(upper);
		if (upper.length === 10) {
			setPanValid(PAN_REGEX.test(upper));
		} else {
			setPanValid(null);
		}
	}

	async function verifyPan() {
		if (!panValid || !panConsent) return;
		setPanSubmitting(true);
		try {
			const data = await apiCall<{ success: boolean; message: string }>(
				'/identity-verification/pan/verify',
				{
					method: 'POST',
					body: { panNumber: panNumber, consent: true },
				},
			);
			showToast(data.message || 'PAN verified successfully');
			trackEvent('identity_pan_verified');
			setPanNumber('');
			setPanValid(null);
			setPanConsent(false);
			await loadStatus();
		} catch (err: unknown) {
			handleApiError(err, 'Failed to verify PAN');
		} finally {
			setPanSubmitting(false);
		}
	}

	// ── Error handling ──
	function handleApiError(err: unknown, fallback: string) {
		const msg = err instanceof Error ? err.message : fallback;
		const code = (err as Error & { code?: string }).code;

		if (code === 'RATE_LIMIT' || msg.includes('429') || msg.includes('Rate limit')) {
			const retryMatch = msg.match(/(\d+)/);
			const minutes = retryMatch ? Math.ceil(parseInt(retryMatch[1], 10) / 60) : 60;
			showToast(`Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
		} else if (code === 'CONSENT_REQUIRED') {
			showToast('Consent is required before verification.');
		} else if (code === 'INVALID_AADHAAR') {
			showToast('Invalid Aadhaar number.');
		} else if (code === 'INVALID_PAN') {
			showToast('Invalid PAN format. Expected: ABCDE1234F');
		} else if (code === 'ALREADY_VERIFIED') {
			showToast('Already verified.');
		} else if (code === 'NOT_FOUND') {
			showToast('Verification record not found.');
		} else if (code === 'INVALID_STATE') {
			showToast('Invalid verification state. Please start over.');
		} else {
			showToast(msg);
		}
		console.error(fallback, err);
	}

	// ── Derived state ──
	const aadhaarRecord = verifications.find((v) => v.type === 'aadhaar');
	const panRecord = verifications.find((v) => v.type === 'pan');
	const aadhaarVerified = aadhaarRecord?.status === 'verified';
	const panVerified = panRecord?.status === 'verified';

	return (
		<div className="space-y-6 px-4 sm:px-6">
			{/* Header */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-heading text-2xl font-bold">Identity Verification</h1>
					<p className="text-muted-foreground">
						Verify your government-issued identity for trusted hiring in India
					</p>
				</div>
			</div>

			{/* Legal note */}
			<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
				<AlertTriangle className="inline h-4 w-4 mr-1 -mt-0.5" />
				Aadhaar verification is voluntary and not mandatory for private employment as per Indian
				law.
			</div>

			{/* Status Cards */}
			<div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
				<Card>
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<div className="h-10 w-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 dark:bg-indigo-900/30 dark:text-indigo-400">
									<Fingerprint className="h-5 w-5" />
								</div>
								<div>
									<p className="text-sm font-medium">Aadhaar</p>
									{aadhaarRecord?.masked_value ? (
										<p className="text-xs text-muted-foreground">{aadhaarRecord.masked_value}</p>
									) : (
										<p className="text-xs text-muted-foreground">Not verified</p>
									)}
								</div>
							</div>
							{aadhaarRecord ? (
								<Badge className={`text-xs ${statusConfig[aadhaarRecord.status].color}`}>
									{statusConfig[aadhaarRecord.status].icon}
									<span className="ml-1">{statusConfig[aadhaarRecord.status].label}</span>
								</Badge>
							) : (
								<Badge variant="outline" className="text-xs">
									Not started
								</Badge>
							)}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<div className="h-10 w-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 dark:bg-indigo-900/30 dark:text-indigo-400">
									<Shield className="h-5 w-5" />
								</div>
								<div>
									<p className="text-sm font-medium">PAN</p>
									{panRecord?.masked_value ? (
										<p className="text-xs text-muted-foreground">{panRecord.masked_value}</p>
									) : (
										<p className="text-xs text-muted-foreground">Not verified</p>
									)}
								</div>
							</div>
							{panRecord ? (
								<Badge className={`text-xs ${statusConfig[panRecord.status].color}`}>
									{statusConfig[panRecord.status].icon}
									<span className="ml-1">{statusConfig[panRecord.status].label}</span>
								</Badge>
							) : (
								<Badge variant="outline" className="text-xs">
									Not started
								</Badge>
							)}
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Error */}
			{error && (
				<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
					{error}
				</div>
			)}

			{/* Tabs */}
			<Tabs value={activeTab} onValueChange={setActiveTab}>
				<TabsList className="flex-wrap h-auto">
					<TabsTrigger value="aadhaar">
						<Fingerprint className="h-4 w-4 mr-1.5" />
						Aadhaar
						{aadhaarVerified && <CheckCircle className="h-3.5 w-3.5 ml-1 text-green-500" />}
					</TabsTrigger>
					<TabsTrigger value="pan">
						<Shield className="h-4 w-4 mr-1.5" />
						PAN
						{panVerified && <CheckCircle className="h-3.5 w-3.5 ml-1 text-green-500" />}
					</TabsTrigger>
				</TabsList>

				{/* ── Aadhaar Tab ── */}
				<TabsContent value="aadhaar" className="mt-4 space-y-4">
					{loading ? (
						<Skeleton count={2} variant="card" />
					) : aadhaarVerified ? (
						<EmptyState
							icon={CheckCircle}
							title="Aadhaar verified"
							description={`Your Aadhaar (${aadhaarRecord?.masked_value}) has been successfully verified.`}
						/>
					) : (
						<>
							{/* Consent Banner */}
							<Card>
								<CardContent className="p-4">
									<div className="flex items-start gap-3">
										<input
											type="checkbox"
											id="aadhaar-consent"
											checked={aadhaarConsent}
											onChange={(e) => setAadhaarConsent(e.target.checked)}
											className="mt-1 h-4 w-4 shrink-0"
										/>
										<Label
											htmlFor="aadhaar-consent"
											className="text-sm font-normal cursor-pointer leading-relaxed"
										>
											I consent to Rekrut AI verifying my Aadhaar number for the purpose of identity
											verification during job applications. I understand this is voluntary and not
											mandatory for employment.
										</Label>
									</div>
								</CardContent>
							</Card>

							{/* Aadhaar Number Input */}
							<Card>
								<CardContent className="p-4 space-y-4">
									<div className="space-y-1">
										<Label htmlFor="aadhaar-number">Aadhaar Number</Label>
										<Input
											id="aadhaar-number"
											placeholder="12-digit Aadhaar number"
											value={aadhaarNumber}
											onChange={(e) => handleAadhaarChange(e.target.value)}
											onBlur={validateAadhaarServer}
											maxLength={14}
											disabled={otpSent}
										/>
										{aadhaarValid === true && (
											<p className="text-xs text-green-600 flex items-center gap-1 mt-1">
												<CheckCircle className="h-3 w-3" />
												Valid Aadhaar
											</p>
										)}
										{aadhaarValid === false && (
											<p className="text-xs text-red-600 flex items-center gap-1 mt-1">
												<XCircle className="h-3 w-3" />
												Invalid Aadhaar number
											</p>
										)}
									</div>

									{!otpSent && (
										<Button
											onClick={initiateOtp}
											disabled={!aadhaarValid || !aadhaarConsent || aadhaarSubmitting}
											className="min-h-[44px]"
										>
											{aadhaarSubmitting ? 'Sending...' : 'Send OTP'}
										</Button>
									)}

									{otpSent && (
										<div className="space-y-3 p-3 rounded-lg bg-muted/50">
											<p className="text-sm text-muted-foreground">
												OTP sent to registered mobile for <strong>{aadhaarMasked}</strong>
											</p>
											<p className="text-xs text-muted-foreground">
												Demo hint: enter <strong>123456</strong>
											</p>
											<div className="space-y-1">
												<Label htmlFor="aadhaar-otp">Enter OTP</Label>
												<Input
													id="aadhaar-otp"
													placeholder="6-digit OTP"
													value={otp}
													onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
													maxLength={6}
												/>
											</div>
											<div className="flex gap-2">
												<Button
													onClick={verifyOtp}
													disabled={otp.length !== 6 || aadhaarOtpSubmitting}
													className="min-h-[44px]"
												>
													{aadhaarOtpSubmitting ? 'Verifying...' : 'Verify OTP'}
												</Button>
												<Button
													variant="ghost"
													onClick={() => {
														setOtpSent(false);
														setOtp('');
													}}
													className="min-h-[44px]"
												>
													Cancel
												</Button>
											</div>
										</div>
									)}
								</CardContent>
							</Card>

							{/* Offline XML Alternative */}
							<Card>
								<CardContent className="p-4 space-y-4">
									<div className="flex items-center gap-2">
										<FileText className="h-4 w-4 text-muted-foreground" />
										<h3 className="text-sm font-semibold">Offline XML Alternative</h3>
									</div>
									<p className="text-xs text-muted-foreground">
										Paste your Aadhaar offline XML (downloaded from UIDAI) to verify without OTP.
									</p>
									<div className="space-y-1">
										<Label htmlFor="aadhaar-xml">Aadhaar XML</Label>
										<Textarea
											id="aadhaar-xml"
											placeholder="Paste XML here..."
											value={xmlData}
											onChange={(e) => setXmlData(e.target.value)}
											rows={6}
										/>
									</div>
									<Button
										onClick={verifyXml}
										disabled={!xmlData.trim() || !aadhaarConsent || xmlSubmitting}
										className="min-h-[44px]"
									>
										{xmlSubmitting ? 'Verifying...' : 'Verify XML'}
									</Button>
								</CardContent>
							</Card>
						</>
					)}
				</TabsContent>

				{/* ── PAN Tab ── */}
				<TabsContent value="pan" className="mt-4 space-y-4">
					{loading ? (
						<Skeleton count={2} variant="card" />
					) : panVerified ? (
						<EmptyState
							icon={CheckCircle}
							title="PAN verified"
							description={`Your PAN (${panRecord?.masked_value}) has been successfully verified.`}
						/>
					) : (
						<>
							{/* Consent Banner */}
							<Card>
								<CardContent className="p-4">
									<div className="flex items-start gap-3">
										<input
											type="checkbox"
											id="pan-consent"
											checked={panConsent}
											onChange={(e) => setPanConsent(e.target.checked)}
											className="mt-1 h-4 w-4 shrink-0"
										/>
										<Label
											htmlFor="pan-consent"
											className="text-sm font-normal cursor-pointer leading-relaxed"
										>
											I consent to Rekrut AI verifying my PAN for the purpose of identity
											verification during job applications. I understand this is voluntary and not
											mandatory for employment.
										</Label>
									</div>
								</CardContent>
							</Card>

							{/* PAN Input */}
							<Card>
								<CardContent className="p-4 space-y-4">
									<div className="space-y-1">
										<Label htmlFor="pan-number">PAN Number</Label>
										<Input
											id="pan-number"
											placeholder="ABCDE1234F"
											value={panNumber}
											onChange={(e) => handlePanChange(e.target.value)}
											maxLength={10}
										/>
										{panValid === true && (
											<p className="text-xs text-green-600 flex items-center gap-1 mt-1">
												<CheckCircle className="h-3 w-3" />
												Valid PAN format
											</p>
										)}
										{panValid === false && (
											<p className="text-xs text-red-600 flex items-center gap-1 mt-1">
												<XCircle className="h-3 w-3" />
												Invalid PAN format. Expected: ABCDE1234F
											</p>
										)}
									</div>
									<Button
										onClick={verifyPan}
										disabled={!panValid || !panConsent || panSubmitting}
										className="min-h-[44px]"
									>
										{panSubmitting ? 'Verifying...' : 'Verify PAN'}
									</Button>
								</CardContent>
							</Card>
						</>
					)}
				</TabsContent>
			</Tabs>

			{/* Toast */}
			{toastMessage && (
				<div className="fixed bottom-4 right-4 z-50 rounded-lg bg-foreground px-4 py-3 text-sm font-medium text-background shadow-lg animate-in fade-in slide-in-from-bottom-4">
					{toastMessage}
				</div>
			)}
		</div>
	);
}
