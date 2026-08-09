import { useCallback, useEffect, useState } from 'react'
import {
	FileSignature,
	PenTool,
	Type,
	Upload,
	CheckCircle,
	XCircle,
	AlertCircle,
	FileText,
	Shield,
	Loader2,
	Clock,
	User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SignatureCanvas } from './SignatureCanvas'
import { TypedSignature } from './TypedSignature'
import { SignatureUploader } from './SignatureUploader'
import { useSignature } from '@/hooks/useSignature'
import { cn } from '@/lib/utils'

export type SignatureMethod = 'draw' | 'type' | 'upload'

interface SigningCeremonyProps {
	documentId: number
	requestId: number
}

type CeremonyState = 'loading' | 'ready' | 'submitting' | 'success' | 'error' | 'declined'

export function SigningCeremony({ documentId, requestId }: SigningCeremonyProps) {
	const { getDocument, recordView, sign, decline, loading: apiLoading, error: apiError, clearError } =
		useSignature()
	const [state, setState] = useState<CeremonyState>('loading')
	const [document, setDocument] = useState<ReturnType<typeof getDocument> extends Promise<infer T> ? T : never>(null)
	const [method, setMethod] = useState<SignatureMethod>('draw')
	const [signatureValue, setSignatureValue] = useState<string | null>(null)
	const [agreed, setAgreed] = useState(false)
	const [declineReason, setDeclineReason] = useState('')
	const [showDeclineForm, setShowDeclineForm] = useState(false)

	// Load document and record view on mount
	useEffect(() => {
		async function init() {
			const doc = await getDocument(documentId)
			if (!doc) {
				setState('error')
				return
			}
			setDocument(doc)
			setState('ready')
			// Record view in background
			recordView(requestId)
		}
		init()
	}, [documentId, requestId, getDocument, recordView])

	const handleSignatureChange = useCallback((value: string | null) => {
		setSignatureValue(value)
	}, [])

	const handleSign = useCallback(async () => {
		if (!signatureValue || !agreed) return
		setState('submitting')
		clearError()

		const result = await sign(requestId, method, signatureValue, {
			device_fingerprint: `${navigator.userAgent}|${screen.width}x${screen.height}`,
		})

		if (result?.success) {
			setState('success')
		} else {
			setState('error')
		}
	}, [signatureValue, agreed, requestId, method, sign, clearError])

	const handleDecline = useCallback(async () => {
		if (!declineReason.trim()) return
		setState('submitting')
		const result = await decline(requestId, declineReason)
		if (result?.success) {
			setState('declined')
		} else {
			setState('error')
		}
	}, [declineReason, requestId, decline])

	const isSignDisabled = !signatureValue || !agreed || state === 'submitting'

	if (state === 'loading' || (state === 'ready' && !document)) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<div className="flex flex-col items-center gap-3">
					<Loader2 className="h-8 w-8 animate-spin text-primary" />
					<p className="text-sm text-muted-foreground">Loading document...</p>
				</div>
			</div>
		)
	}

	if (state === 'success') {
		return (
			<div className="flex min-h-[60vh] items-center justify-center px-4">
				<Card className="max-w-md w-full">
					<CardHeader className="text-center">
						<div className="mx-auto h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-3">
							<CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
						</div>
						<CardTitle className="text-xl">Document Signed Successfully</CardTitle>
						<CardDescription>
							Your signature has been securely recorded with a cryptographic hash.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="rounded-lg bg-muted p-4 space-y-2">
							<div className="flex items-center gap-2 text-sm">
								<FileText className="h-4 w-4 text-muted-foreground" />
								<span className="font-medium">{document?.title}</span>
							</div>
							<div className="flex items-center gap-2 text-sm">
								<Clock className="h-4 w-4 text-muted-foreground" />
								<span>{new Date().toLocaleString()}</span>
							</div>
							<div className="flex items-center gap-2 text-sm">
								<Shield className="h-4 w-4 text-muted-foreground" />
								<span className="text-xs text-muted-foreground">
									Signature protected by tamper-evident audit trail
								</span>
							</div>
						</div>
						<Button
							className="w-full"
							onClick={() => (window.location.href = '/candidate/documents')}
						>
							Go to Documents
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	if (state === 'declined') {
		return (
			<div className="flex min-h-[60vh] items-center justify-center px-4">
				<Card className="max-w-md w-full">
					<CardHeader className="text-center">
						<div className="mx-auto h-16 w-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-3">
							<XCircle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
						</div>
						<CardTitle className="text-xl">Signature Declined</CardTitle>
						<CardDescription>
							You have declined to sign this document. The sender has been notified.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button
							className="w-full"
							onClick={() => (window.location.href = '/candidate/documents')}
						>
							Go to Documents
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	const myRequest = document?.signers?.find((s) => s.id === requestId)
	const alreadySigned = myRequest?.status === 'signed'
	const alreadyDeclined = myRequest?.status === 'declined'

	if (alreadySigned) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center px-4">
				<Card className="max-w-md w-full">
					<CardHeader className="text-center">
						<div className="mx-auto h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-3">
							<CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
						</div>
						<CardTitle className="text-xl">Already Signed</CardTitle>
						<CardDescription>
							You have already signed this document on{' '}
							{myRequest?.signed_at ? new Date(myRequest.signed_at).toLocaleString() : 'N/A'}.
						</CardDescription>
					</CardHeader>
				</Card>
			</div>
		)
	}

	if (alreadyDeclined) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center px-4">
				<Card className="max-w-md w-full">
					<CardHeader className="text-center">
						<div className="mx-auto h-16 w-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-3">
							<XCircle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
						</div>
						<CardTitle className="text-xl">Already Declined</CardTitle>
						<CardDescription>
							You previously declined to sign this document.
						</CardDescription>
					</CardHeader>
				</Card>
			</div>
		)
	}

	return (
		<div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
			{/* Document Header */}
			<div className="text-center space-y-2">
				<div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
					<FileSignature className="h-6 w-6 text-primary" />
				</div>
				<h1 className="font-heading text-2xl font-bold">Electronic Signature Required</h1>
				<p className="text-muted-foreground text-sm">
					Please review and sign the document below
				</p>
			</div>

			{/* Document Info */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg flex items-center gap-2">
						<FileText className="h-5 w-5 text-primary" />
						{document?.title || 'Untitled Document'}
					</CardTitle>
					{document?.description && (
						<CardDescription>{document.description}</CardDescription>
					)}
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="flex flex-wrap gap-4 text-sm">
						<div className="flex items-center gap-1.5">
							<User className="h-4 w-4 text-muted-foreground" />
							<span className="text-muted-foreground">From:</span>
							<span className="font-medium">
								{document?.signers?.find((s) => s.party_role === 'creator')?.full_name || 'Document Sender'}
							</span>
						</div>
						<div className="flex items-center gap-1.5">
							<Shield className="h-4 w-4 text-muted-foreground" />
							<span className="text-muted-foreground">Jurisdiction:</span>
							<span className="font-medium">{document?.legal_jurisdiction || 'US'}</span>
						</div>
						{document?.expires_at && (
							<div className="flex items-center gap-1.5">
								<Clock className="h-4 w-4 text-muted-foreground" />
								<span className="text-muted-foreground">Expires:</span>
								<span className="font-medium">
									{new Date(document.expires_at).toLocaleDateString()}
								</span>
							</div>
						)}
					</div>

					{/* Signers list */}
					<div className="rounded-lg bg-muted/50 p-3 space-y-2">
						<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
							Signing Parties
						</p>
						<div className="space-y-1.5">
							{document?.signers?.map((signer) => (
								<div
									key={signer.id}
									className="flex items-center justify-between text-sm"
								>
									<div className="flex items-center gap-2">
										<User className="h-3.5 w-3.5 text-muted-foreground" />
										<span>{signer.full_name}</span>
										{signer.id === requestId && (
											<span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
												You
											</span>
										)}
									</div>
									<StatusBadge status={signer.status} />
								</div>
							))}
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Error state */}
			{(state === 'error' || apiError) && (
				<div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 p-4 flex items-start gap-3">
					<AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
					<div className="flex-1">
						<p className="text-sm font-medium text-red-800 dark:text-red-200">
							Something went wrong
						</p>
						<p className="text-sm text-red-700 dark:text-red-300 mt-0.5">
							{apiError || 'Unable to process your request. Please try again.'}
						</p>
						<Button
							variant="ghost"
							size="sm"
							className="mt-2 h-8 text-red-700"
							onClick={() => {
								setState('ready')
								clearError()
							}}
						>
							Try Again
						</Button>
					</div>
				</div>
			)}

			{/* Signature Capture */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Create Your Signature</CardTitle>
					<CardDescription>
						Choose how you would like to sign this document
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Tabs value={method} onValueChange={(v) => setMethod(v as SignatureMethod)}>
						<TabsList className="grid w-full grid-cols-3">
							<TabsTrigger value="draw" className="gap-1.5">
								<PenTool className="h-4 w-4" />
								<span className="hidden sm:inline">Draw</span>
							</TabsTrigger>
							<TabsTrigger value="type" className="gap-1.5">
								<Type className="h-4 w-4" />
								<span className="hidden sm:inline">Type</span>
							</TabsTrigger>
							<TabsTrigger value="upload" className="gap-1.5">
								<Upload className="h-4 w-4" />
								<span className="hidden sm:inline">Upload</span>
							</TabsTrigger>
						</TabsList>

						<TabsContent value="draw" className="mt-4">
							<SignatureCanvas onChange={handleSignatureChange} />
						</TabsContent>

						<TabsContent value="type" className="mt-4">
							<TypedSignature onChange={handleSignatureChange} />
						</TabsContent>

						<TabsContent value="upload" className="mt-4">
							<SignatureUploader onChange={handleSignatureChange} />
						</TabsContent>
					</Tabs>
				</CardContent>
			</Card>

			{/* Intent to Sign */}
			<Card>
				<CardContent className="pt-6 space-y-4">
					<div className="flex items-start gap-3">
						<Checkbox
							id="intent-to-sign"
							checked={agreed}
							onCheckedChange={(checked) => setAgreed(!!checked)}
						/>
						<div className="space-y-1">
							<Label htmlFor="intent-to-sign" className="text-sm font-medium cursor-pointer">
								I agree to sign this document electronically
							</Label>
							<p className="text-xs text-muted-foreground leading-relaxed">
								By checking this box, I understand that my electronic signature is legally binding
								and has the same legal validity as a handwritten signature. I consent to using
								electronic records and signatures in connection with this document.
							</p>
						</div>
					</div>

					<div className="flex flex-col sm:flex-row gap-3 pt-2">
						<Button
							size="lg"
							className="flex-1 gap-2 min-h-[48px]"
							onClick={handleSign}
							disabled={isSignDisabled}
						>
							{state === 'submitting' ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<FileSignature className="h-4 w-4" />
							)}
							{state === 'submitting' ? 'Submitting...' : 'Sign Document'}
						</Button>
						<Button
							size="lg"
							variant="outline"
							className="flex-1 min-h-[48px]"
							onClick={() => setShowDeclineForm(true)}
							disabled={state === 'submitting'}
						>
							Decline to Sign
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Decline Form */}
			{showDeclineForm && (
				<Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-900/10">
					<CardHeader>
						<CardTitle className="text-lg flex items-center gap-2">
							<AlertCircle className="h-5 w-5 text-amber-600" />
							Decline to Sign
						</CardTitle>
						<CardDescription>
							Please provide a reason for declining. This will be shared with the document sender.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						<textarea
							value={declineReason}
							onChange={(e) => setDeclineReason(e.target.value)}
							placeholder="e.g. I need more time to review, or I disagree with the terms..."
							className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
						/>
						<div className="flex gap-2">
							<Button
								variant="default"
								size="sm"
								onClick={handleDecline}
								disabled={!declineReason.trim() || state === 'submitting'}
							>
								{state === 'submitting' ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									'Confirm Decline'
								)}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									setShowDeclineForm(false)
									setDeclineReason('')
								}}
							>
								Cancel
							</Button>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}

function StatusBadge({ status }: { status: string }) {
	const config: Record<string, { label: string; className: string }> = {
		signed: {
			label: 'Signed',
			className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
		},
		declined: {
			label: 'Declined',
			className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
		},
		pending: {
			label: 'Pending',
			className: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400',
		},
		sent: {
			label: 'Sent',
			className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
		},
		viewed: {
			label: 'Viewed',
			className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
		},
		signing: {
			label: 'Signing',
			className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
		},
	}

	const { label, className } = config[status] || config.pending

	return (
		<span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', className)}>
			{label}
		</span>
	)
}
