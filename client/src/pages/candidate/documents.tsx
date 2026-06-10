import {
	AlertCircle,
	AlertTriangle,
	CheckCircle,
	Clock,
	Download,
	Eye,
	File,
	FileImage,
	FileSpreadsheet,
	FileText,
	Search,
	Shield,
	Star,
	Trash2,
	Upload,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '@/components/domain/empty-state'
import { Skeleton } from '@/components/domain/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { trackEvent } from '@/lib/analytics'
import { apiCall } from '@/lib/api'

export type Document = {
	id: string
	name: string
	type: 'resume' | 'certificate' | 'portfolio' | 'transcript' | 'id' | 'other'
	url: string
	size: number
	uploadedAt: string
	status: 'pending' | 'processing' | 'verified' | 'rejected' | 'expired'
	fraudScore?: number
	ocrText?: string
	ocrConfidence?: number
	documentScore?: number
	verificationDetails?: {
		issuer?: string
		issueDate?: string
		expiryDate?: string
		documentId?: string
		verifiedBy?: string
	}
}

const typeIcons: Record<string, React.ReactNode> = {
	resume: <FileText className='h-5 w-5' />,
	certificate: <FileSpreadsheet className='h-5 w-5' />,
	portfolio: <FileImage className='h-5 w-5' />,
	transcript: <FileSpreadsheet className='h-5 w-5' />,
	id: <Shield className='h-5 w-5' />,
	other: <File className='h-5 w-5' />,
}

const typeColors: Record<string, string> = {
	resume: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
	certificate: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
	portfolio: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
	transcript: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
	id: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
	other: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400',
}

const statusConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
	pending: {
		icon: <Clock className='h-3.5 w-3.5' />,
		color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
		label: 'Pending',
	},
	processing: {
		icon: <Clock className='h-3.5 w-3.5 animate-spin' />,
		color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
		label: 'Processing',
	},
	verified: {
		icon: <CheckCircle className='h-3.5 w-3.5' />,
		color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
		label: 'Verified',
	},
	rejected: {
		icon: <AlertTriangle className='h-3.5 w-3.5' />,
		color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
		label: 'Rejected',
	},
	expired: {
		icon: <AlertCircle className='h-3.5 w-3.5' />,
		color: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400',
		label: 'Expired',
	},
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B'
	const k = 1024
	const sizes = ['B', 'KB', 'MB', 'GB']
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

export function CandidateDocumentsPage() {
	const _navigate = useNavigate()
	const [documents, setDocuments] = useState<Document[]>([])
	const [loading, setLoading] = useState(true)
	const [uploading, setUploading] = useState(false)
	const [selectedTab, setSelectedTab] = useState('all')
	const [_previewDoc, setPreviewDoc] = useState<Document | null>(null)

	useEffect(() => {
		async function loadDocuments() {
			setLoading(true)
			try {
				const data = await apiCall<{ documents: Document[] }>('/candidate/documents')
				setDocuments(data.documents || [])
			} catch (err) {
				console.error('Failed to load documents:', err)
			} finally {
				setLoading(false)
			}
		}
		loadDocuments()
	}, [])

	const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) return

		setUploading(true)
		trackEvent('document_upload', { file_type: file.type, file_size: file.size })

		try {
			const formData = new FormData()
			formData.append('file', file)
			formData.append('type', 'other')

			const data = await apiCall<{ document: Document }>('/candidate/documents/upload', {
				method: 'POST',
				body: formData,
			})
			setDocuments((prev) => [data.document, ...prev])
		} catch (err) {
			console.error('Upload failed:', err)
		} finally {
			setUploading(false)
		}
	}

	const handleDelete = async (id: string) => {
		if (!confirm('Delete this document?')) return
		try {
			await apiCall(`/candidate/documents/${id}`, { method: 'DELETE' })
			setDocuments((prev) => prev.filter((d) => d.id !== id))
			trackEvent('document_delete', { document_id: id })
		} catch (err) {
			console.error('Delete failed:', err)
		}
	}

	const filteredDocs = documents.filter((d) => {
		if (selectedTab === 'all') return true
		return d.status === selectedTab
	})

	const totalScore =
		documents.reduce((sum, d) => sum + (d.documentScore || 0), 0) / (documents.length || 1)
	const verifiedCount = documents.filter((d) => d.status === 'verified').length
	const fraudRiskCount = documents.filter((d) => (d.fraudScore || 0) > 0.7).length

	const tabCounts = {
		all: documents.length,
		pending: documents.filter((d) => d.status === 'pending').length,
		processing: documents.filter((d) => d.status === 'processing').length,
		verified: documents.filter((d) => d.status === 'verified').length,
		rejected: documents.filter((d) => d.status === 'rejected').length,
	}

	return (
		<div className='space-y-6'>
			{/* Header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='font-heading text-2xl font-bold'>Documents</h1>
					<p className='text-muted-foreground'>
						Upload and verify your documents for better job matching
					</p>
				</div>
				<div className='flex gap-2'>
					<label htmlFor='doc-upload'>
						<Button size='sm' className='gap-1' asChild disabled={uploading}>
							<span>
								{uploading ? (
									<Clock className='h-4 w-4 animate-spin' />
								) : (
									<Upload className='h-4 w-4' />
								)}
								Upload
							</span>
						</Button>
					</label>
					<input
						id='doc-upload'
						type='file'
						className='hidden'
						onChange={handleUpload}
						accept='.pdf,.doc,.docx,.png,.jpg,.jpeg'
					/>
				</div>
			</div>

			{/* Stats */}
			<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold'>{documents.length}</p>
								<p className='text-xs text-muted-foreground'>Total Documents</p>
							</div>
							<FileText className='h-8 w-8 text-muted-foreground/50' />
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold text-green-600'>{verifiedCount}</p>
								<p className='text-xs text-muted-foreground'>Verified</p>
							</div>
							<CheckCircle className='h-8 w-8 text-green-500/50' />
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold'>{Math.round(totalScore)}</p>
								<p className='text-xs text-muted-foreground'>Document Score</p>
							</div>
							<Star className='h-8 w-8 text-amber-500/50' />
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold text-red-600'>{fraudRiskCount}</p>
								<p className='text-xs text-muted-foreground'>Fraud Risk</p>
							</div>
							<AlertTriangle className='h-8 w-8 text-red-500/50' />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Tabs */}
			<Tabs value={selectedTab} onValueChange={setSelectedTab}>
				<TabsList className='flex-wrap h-auto'>
					<TabsTrigger value='all'>
						All{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.all}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='verified'>
						Verified{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.verified}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='pending'>
						Pending{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.pending}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='processing'>
						Processing{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.processing}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='rejected'>
						Rejected{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.rejected}
						</Badge>
					</TabsTrigger>
				</TabsList>

				<TabsContent value={selectedTab} className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='card' />
					) : filteredDocs.length === 0 ? (
						<EmptyState
							icon={FileText}
							title='No documents yet'
							description='Upload your resume, certificates, and ID documents to improve your profile and job matching'
							action={{
								label: 'Upload your first document',
								onClick: () => document.getElementById('doc-upload')?.click(),
							}}
						/>
					) : (
						<div className='grid gap-4'>
							{filteredDocs.map((doc) => {
								const status = statusConfig[doc.status]
								const typeColor = typeColors[doc.type] || typeColors.other
								const typeIcon = typeIcons[doc.type] || typeIcons.other

								return (
									<Card key={doc.id} className='overflow-hidden'>
										<CardContent className='p-4'>
											<div className='flex items-start gap-4'>
												{/* Type icon */}
												<div
													className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${typeColor}`}
												>
													{typeIcon}
												</div>

												{/* Info */}
												<div className='flex-1 min-w-0 space-y-1'>
													<div className='flex items-center gap-2 flex-wrap'>
														<h3 className='font-semibold truncate'>{doc.name}</h3>
														<Badge className={`text-xs ${status.color}`}>
															{status.icon}
															<span className='ml-1'>{status.label}</span>
														</Badge>
														{doc.fraudScore != null && doc.fraudScore > 0.7 && (
															<Badge variant='destructive' className='text-xs'>
																<AlertTriangle className='h-3 w-3 mr-0.5' />
																Fraud Risk
															</Badge>
														)}
													</div>
													<div className='flex items-center gap-3 text-xs text-muted-foreground'>
														<span>{formatBytes(doc.size)}</span>
														<span>•</span>
														<span>{new Date(doc.uploadedAt).toLocaleDateString()}</span>
														{doc.verificationDetails?.issuer && (
															<>
																<span>•</span>
																<span>Issuer: {doc.verificationDetails.issuer}</span>
															</>
														)}
													</div>

													{/* Document score */}
													{doc.documentScore != null && (
														<div className='flex items-center gap-2 pt-1'>
															<span className='text-xs text-muted-foreground'>Score impact:</span>
															<div className='flex-1 max-w-[200px]'>
																<Progress value={doc.documentScore} className='h-2' />
															</div>
															<span className='text-xs font-medium'>{doc.documentScore}/100</span>
														</div>
													)}

													{/* OCR preview */}
													{doc.ocrText && doc.ocrConfidence != null && (
														<div className='mt-2 p-2 rounded bg-muted/50 text-xs text-muted-foreground'>
															<div className='flex items-center gap-1 mb-1'>
																<Search className='h-3 w-3' />
																<span className='font-medium'>OCR Preview</span>
																<span className='ml-auto'>
																	Confidence: {Math.round(doc.ocrConfidence * 100)}%
																</span>
															</div>
															<p className='line-clamp-2'>{doc.ocrText}</p>
														</div>
													)}
												</div>

												{/* Actions */}
												<div className='flex items-center gap-1 shrink-0'>
													<Button
														variant='ghost'
														size='sm'
														className='h-8 w-8 p-0'
														onClick={() => setPreviewDoc(doc)}
														aria-label='Preview'
													>
														<Eye className='h-4 w-4' />
													</Button>
													<Button
														variant='ghost'
														size='sm'
														className='h-8 w-8 p-0'
														onClick={() => window.open(doc.url, '_blank')}
														aria-label='Download'
													>
														<Download className='h-4 w-4' />
													</Button>
													<Button
														variant='ghost'
														size='sm'
														className='h-8 w-8 p-0 text-destructive hover:text-destructive'
														onClick={() => handleDelete(doc.id)}
														aria-label='Delete'
													>
														<Trash2 className='h-4 w-4' />
													</Button>
												</div>
											</div>
										</CardContent>
									</Card>
								)
							})}
						</div>
					)}
				</TabsContent>
			</Tabs>
		</div>
	)
}
