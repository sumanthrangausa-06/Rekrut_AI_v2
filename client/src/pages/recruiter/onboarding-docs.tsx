import { SafeHtml } from '@/components/SafeHtml'
import { Download, Eye, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { apiCall } from '@/lib/api'

// ─── Types ──────────────────────────────────────────────────────────────

interface OnboardingCandidate {
	candidate_id: number
	candidate_name: string
	candidate_email: string
	job_title: string | null
	onboarding_status: string
	total_documents: string
	signed_documents: string
	due_date: string | null
}

interface CandidateDocument {
	id: number
	document_type: string
	status: string
	signed_at: string | null
	signer_ip: string | null
	created_at: string
	document_content: string | null
	document_url: string | null
	content_summary: string | null
}

const STATUS_CONFIG: Record<
	string,
	{ label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }
> = {
	pending: { label: 'Pending', variant: 'secondary' },
	in_progress: { label: 'In Progress', variant: 'warning' },
	completed: { label: 'Completed', variant: 'success' },
}

// ─── Component ────────────────────────────────────────────────────────────

export function RecruiterOnboardingDocsPage() {
	const [candidates, setCandidates] = useState<OnboardingCandidate[]>([])
	const [loading, setLoading] = useState(true)
	const [selectedCandidate, setSelectedCandidate] = useState<OnboardingCandidate | null>(null)
	const [documents, setDocuments] = useState<CandidateDocument[]>([])
	const [loadingDocs, setLoadingDocs] = useState(false)
	const [previewDoc, setPreviewDoc] = useState<CandidateDocument | null>(null)

	const loadCandidates = useCallback(async () => {
		try {
			setLoading(true)
			const data = await apiCall<OnboardingCandidate[]>('/onboarding/recruiter/summary')
			setCandidates(data || [])
		} catch (err) {
			console.error('Failed to load onboarding data:', err)
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadCandidates()
	}, [loadCandidates])


	async function viewCandidateDetails(candidate: OnboardingCandidate) {
		setSelectedCandidate(candidate)
		setLoadingDocs(true)
		try {
			const docs = await apiCall<CandidateDocument[]>(
				`/onboarding/recruiter/candidate/${candidate.candidate_id}/documents`,
			)
			setDocuments(docs || [])
		} catch (err) {
			console.error('Failed to load documents:', err)
		} finally {
			setLoadingDocs(false)
		}
	}

	function getDocumentStatus(doc: CandidateDocument) {
		if (doc.signed_at) return { label: 'Signed', variant: 'success' as const, color: '#10b981' }
		if (doc.document_content || doc.document_url)
			return { label: 'Generated', variant: 'secondary' as const, color: '#3b82f6' }
		return { label: 'Pending', variant: 'secondary' as const, color: '#e5e7eb' }
	}

	function formatDate(date: string | null) {
		if (!date) return '—'
		return new Date(date).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		})
	}

	function viewDocContent(doc: CandidateDocument) {
		setPreviewDoc(doc)
	}

	function downloadDoc(docId: number) {
		window.open(`/api/onboarding/recruiter/document/${docId}/download`, '_blank')
	}

	function downloadAllDocs() {
		documents.forEach((doc, i) => {
			if (doc.document_content) {
				setTimeout(() => downloadDoc(doc.id), i * 500)
			}
		})
	}

	return (
		<div className='space-y-6'>
			{/* Header */}
			<div>
				<h1 className='text-2xl font-bold tracking-tight'>Onboarding Documents</h1>
				<p className='text-sm text-muted-foreground'>
					Track candidate onboarding completion and document signatures
				</p>
			</div>

			{/* Candidates Grid */}
			{loading ? (
				<div className='flex justify-center py-12'>
					<Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
				</div>
			) : candidates.length === 0 ? (
				<Card>
					<CardContent className='p-8 text-center'>
						<div className='text-4xl mb-3'>📂</div>
						<h3 className='font-semibold text-lg mb-1'>No Candidates Yet</h3>
						<p className='text-sm text-muted-foreground'>
							Once candidates accept offers, their onboarding documents will appear here.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
					{candidates.map((candidate) => {
						const total = parseInt(candidate.total_documents, 10) || 0
						const signed = parseInt(candidate.signed_documents, 10) || 0
						const pct = total > 0 ? Math.round((signed / total) * 100) : 0
						const status = STATUS_CONFIG[candidate.onboarding_status] || STATUS_CONFIG.pending

						return (
							<Card
								key={candidate.candidate_id}
								className='cursor-pointer hover:border-primary/50 transition-colors'
								onClick={() => viewCandidateDetails(candidate)}
							>
								<CardContent className='p-5'>
									<div className='flex items-start justify-between gap-3'>
										<div className='min-w-0 flex-1'>
											<h3 className='font-semibold text-sm truncate'>{candidate.candidate_name}</h3>
											<p className='text-xs text-muted-foreground truncate'>
												{candidate.candidate_email}
											</p>
											{candidate.job_title && (
												<p className='text-xs text-muted-foreground mt-0.5 truncate'>
													{candidate.job_title}
												</p>
											)}
										</div>
										<Badge variant={status.variant} className='text-[10px] shrink-0'>
											{status.label}
										</Badge>
									</div>

									<div className='mt-4'>
										<div className='flex justify-between text-xs mb-1'>
											<span className='text-muted-foreground'>Document Progress</span>
											<span
												className='font-semibold'
												style={{ color: pct === 100 ? '#10b981' : pct > 0 ? '#f59e0b' : '#888' }}
											>
												{pct}%
											</span>
										</div>
										<Progress value={pct} className='h-1.5' />
									</div>

									<div className='grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pt-3 border-t text-xs'>
										<div className='flex items-center gap-1.5'>
											<strong>{signed}</strong>
											<span className='text-muted-foreground'>Signed</span>
										</div>
										<div className='flex items-center gap-1.5'>
											<strong>{total}</strong>
											<span className='text-muted-foreground'>Total Docs</span>
										</div>
									</div>

									{candidate.due_date && (
										<div className='mt-2 pt-2 border-t text-xs text-muted-foreground'>
											Due: {formatDate(candidate.due_date)}
										</div>
									)}

									<div className='mt-3 text-right'>
										<span className='text-xs text-primary font-medium'>View Details →</span>
									</div>
								</CardContent>
							</Card>
						)
					})}
				</div>
			)}

			{/* Candidate Details Dialog */}
			<Dialog open={!!selectedCandidate} onOpenChange={() => setSelectedCandidate(null)}>
				<DialogHeader>
					<DialogTitle>{selectedCandidate?.candidate_name}</DialogTitle>
					<DialogDescription>{selectedCandidate?.candidate_email}</DialogDescription>
				</DialogHeader>
				<div className='p-6 space-y-4'>
					{selectedCandidate && (
						<div className='grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm'>
							<div>
								<span className='text-muted-foreground'>Job Title</span>
								<p className='font-medium mt-0.5'>{selectedCandidate.job_title || '—'}</p>
							</div>
							<div>
								<span className='text-muted-foreground'>Start Date</span>
								<p className='font-medium mt-0.5'>{formatDate(selectedCandidate.due_date)}</p>
							</div>
						</div>
					)}

					<div className='flex items-center justify-between'>
						<h4 className='font-semibold text-sm'>Documents</h4>
						{documents.some((d) => d.document_content) && (
							<Button size='sm' variant='outline' onClick={downloadAllDocs}>
								<Download className='mr-1 h-3 w-3' />
								Download All
							</Button>
						)}
					</div>

					{loadingDocs ? (
						<div className='flex justify-center py-8'>
							<Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
						</div>
					) : documents.length === 0 ? (
						<p className='text-sm text-muted-foreground'>No documents yet</p>
					) : (
						<div className='space-y-3'>
							{documents.map((doc) => {
								const status = getDocumentStatus(doc)
								return (
									<div
										key={doc.id}
										className='p-4 rounded-lg border bg-accent/50'
										style={{ borderLeftWidth: 3, borderLeftColor: status.color }}
									>
										<div className='flex items-start justify-between gap-2'>
											<span className='font-medium text-sm'>{doc.document_type}</span>
											<span className='text-xs text-muted-foreground whitespace-nowrap'>
												{formatDate(doc.created_at)}
											</span>
										</div>
										<div className='flex items-center justify-between mt-2 flex-wrap gap-2'>
											<Badge variant={status.variant} className='text-[10px]'>
												{status.label}
												{doc.signed_at && ` ${formatDate(doc.signed_at)}`}
											</Badge>
											<div className='flex gap-2'>
												{doc.document_content && (
													<>
														<Button
															size='sm'
															variant='ghost'
															className='h-7 text-xs'
															onClick={() => viewDocContent(doc)}
														>
															<Eye className='mr-1 h-3 w-3' />
															View
														</Button>
														<Button
															size='sm'
															variant='ghost'
															className='h-7 text-xs'
															onClick={() => downloadDoc(doc.id)}
														>
															<Download className='mr-1 h-3 w-3' />
															Download
														</Button>
													</>
												)}
												{doc.document_url && (
													<a
														href={doc.document_url}
														target='_blank'
														rel='noopener noreferrer'
														className='text-xs text-primary hover:underline'
													>
														Open File
													</a>
												)}
											</div>
										</div>
										{doc.content_summary && (
											<p className='text-xs text-muted-foreground mt-2'>{doc.content_summary}</p>
										)}
										{doc.signer_ip && (
											<p className='text-[11px] text-muted-foreground mt-1'>
												Audit: IP {doc.signer_ip} | {formatDate(doc.signed_at)}
											</p>
										)}
									</div>
								)
							})}
						</div>
					)}
				</div>
			</Dialog>

			{/* Document Preview Dialog */}
			<Dialog open={!!previewDoc} onOpenChange={() => setPreviewDoc(null)}>
				<DialogHeader>
					<DialogTitle>{previewDoc?.document_type}</DialogTitle>
				</DialogHeader>
				<div className='p-6'>
					{previewDoc?.document_content &&
						(() => {
							try {
								const content =
									typeof previewDoc.document_content === 'string'
										? JSON.parse(previewDoc.document_content)
										: previewDoc.document_content

								let bodyHtml = ''
								if (content.form_type === 'I-9') {
									bodyHtml = `
                  <p><strong>Employment Eligibility Verification</strong></p>
                  <p><strong>Name:</strong> ${content.employee_name || ''}</p>
                  <p><strong>DOB:</strong> ${content.date_of_birth ? new Date(content.date_of_birth).toLocaleDateString() : ''}</p>
                  <p><strong>Address:</strong> ${content.address || ''}, ${content.city || ''}, ${content.state || ''} ${content.zip || ''}</p>
                  <p><strong>SSN:</strong> ${content.ssn_last_four || ''}</p>
                  <p><strong>Employer:</strong> ${content.company || ''}</p>
                `
								} else if (content.form_type === 'W-4') {
									bodyHtml = `
                  <p><strong>W-4 Tax Withholding</strong></p>
                  <p><strong>Name:</strong> ${content.employee_name || ''}</p>
                  <p><strong>Address:</strong> ${content.city_state_zip || ''}</p>
                  <p><strong>Filing Status:</strong> ${content.filing_status || 'Single'}</p>
                `
								} else if (content.form_type === 'Direct Deposit Authorization') {
									bodyHtml = `
                  <p><strong>Direct Deposit</strong></p>
                  <p><strong>Name:</strong> ${content.employee_name || ''}</p>
                  <p><strong>Bank:</strong> ${content.bank_name || ''}</p>
                  <p><strong>Account Type:</strong> ${content.account_type || ''}</p>
                `
								} else {
									bodyHtml = `<pre class="text-xs whitespace-pre-wrap">${JSON.stringify(content, null, 2)}</pre>`
								}

								return <SafeHtml html={bodyHtml} className='text-sm space-y-2 leading-relaxed' />
							} catch {
								return (
									<pre className='text-xs whitespace-pre-wrap'>{previewDoc.document_content}</pre>
								)
							}
						})()}
					{previewDoc?.signed_at && (
						<div className='mt-4 pt-4 border-t'>
							<p className='text-sm text-green-600 font-medium'>
								✓ Signed on {new Date(previewDoc.signed_at).toLocaleString()}
							</p>
							{previewDoc.signer_ip && (
								<p className='text-xs text-muted-foreground mt-1'>IP: {previewDoc.signer_ip}</p>
							)}
						</div>
					)}
				</div>
			</Dialog>
		</div>
	)
}
