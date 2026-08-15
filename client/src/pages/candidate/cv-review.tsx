import { useCallback, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { apiCall } from '@/lib/api'
import { FileText, Upload, CheckCircle, AlertCircle, ArrowUpRight, Lightbulb, Layout, Target } from 'lucide-react'

interface CVStrength {
	title: string
	description: string
}

interface CVImprovement {
	title: string
	description: string
	priority: 'high' | 'medium' | 'low'
}

interface ATSCompatibility {
	score: number
	notes: string
}

interface CVAnalysisResult {
	score: number
	scoreLabel: string
	strengths: CVStrength[]
	improvements: CVImprovement[]
	summary: string
	formattingTips: string[]
	keywordOptimization: string[]
	atsCompatibility: ATSCompatibility
}

export function CVReviewPage() {
	const [file, setFile] = useState<File | null>(null)
	const [dragActive, setDragActive] = useState(false)
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState<CVAnalysisResult | null>(null)
	const [error, setError] = useState<string | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)

	const handleDrag = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (e.type === 'dragenter' || e.type === 'dragover') {
			setDragActive(true)
		} else if (e.type === 'dragleave') {
			setDragActive(false)
		}
	}, [])

	const handleDrop = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setDragActive(false)
		if (e.dataTransfer.files && e.dataTransfer.files[0]) {
			const droppedFile = e.dataTransfer.files[0]
			if (isValidFile(droppedFile)) {
				setFile(droppedFile)
				setError(null)
			} else {
				setError('Please upload a PDF or Word document.')
			}
		}
	}, [])

	const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files[0]) {
			const selectedFile = e.target.files[0]
			if (isValidFile(selectedFile)) {
				setFile(selectedFile)
				setError(null)
			} else {
				setError('Please upload a PDF or Word document.')
			}
		}
	}, [])

	const handleAnalyze = useCallback(async () => {
		if (!file) return
		setLoading(true)
		setError(null)
		setResult(null)

		try {
			const formData = new FormData()
			formData.append('cv', file)

			const res = await apiCall<CVAnalysisResult & { success: boolean; error?: string }>(
				'/profile-enhancement/cv-analyze',
				{
					method: 'POST',
					body: formData,
				},
			)

			if (res.success) {
				setResult(res)
			} else {
				setError(res.error || 'Analysis failed. Please try again.')
			}
		} catch (err: any) {
			console.error('CV analyze error:', err)
			setError(err?.message || 'Failed to analyze CV. Please try again.')
		} finally {
			setLoading(false)
		}
	}, [file])

	const handleReset = useCallback(() => {
		setFile(null)
		setResult(null)
		setError(null)
		if (fileInputRef.current) {
			fileInputRef.current.value = ''
		}
	}, [])

	const scoreColor = (score: number) => {
		if (score >= 80) return 'text-emerald-600'
		if (score >= 60) return 'text-amber-600'
		if (score >= 40) return 'text-orange-600'
		return 'text-red-600'
	}

	const scoreBg = (score: number) => {
		if (score >= 80) return 'bg-emerald-50 border-emerald-200'
		if (score >= 60) return 'bg-amber-50 border-amber-200'
		if (score >= 40) return 'bg-orange-50 border-orange-200'
		return 'bg-red-50 border-red-200'
	}

	const priorityColor = (priority: string) => {
		switch (priority) {
			case 'high':
				return 'bg-red-100 text-red-700'
			case 'medium':
				return 'bg-amber-100 text-amber-700'
			default:
				return 'bg-blue-100 text-blue-700'
		}
	}

	return (
		<div className='space-y-6 px-4 sm:px-6'>
			{/* Header */}
			<div className='flex items-center gap-3'>
				<div className='p-2 rounded-lg bg-primary/10'>
					<FileText className='h-5 w-5 text-primary' />
				</div>
				<div>
					<h1 className='text-2xl font-heading font-bold'>CV Review</h1>
					<p className='text-muted-foreground text-sm'>
						Upload your CV and get AI-powered feedback on strengths, improvements, and ATS compatibility
					</p>
				</div>
			</div>

			{/* Upload Area */}
			{!result && (
				<Card>
					<CardContent className='p-6'>
						<div
							className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors ${
								dragActive
									? 'border-primary bg-primary/5'
									: 'border-muted-foreground/25 hover:border-muted-foreground/50'
							}`}
							onDragEnter={handleDrag}
							onDragLeave={handleDrag}
							onDragOver={handleDrag}
							onDrop={handleDrop}
						>
							<input
								ref={fileInputRef}
								type='file'
								accept='.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
								onChange={handleFileChange}
								className='absolute inset-0 w-full h-full opacity-0 cursor-pointer'
							/>
							<Upload className='h-10 w-10 text-muted-foreground mb-3' />
							<p className='text-sm font-medium text-foreground'>
								{file ? file.name : 'Click to upload or drag and drop'}
							</p>
							<p className='text-xs text-muted-foreground mt-1'>
								PDF or Word documents up to 10MB
							</p>
						</div>

						{error && (
							<div className='mt-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700'>
								<AlertCircle className='h-4 w-4 shrink-0' />
								{error}
							</div>
						)}

						{file && (
							<div className='mt-4 flex items-center justify-between rounded-lg bg-muted p-3'>
								<div className='flex items-center gap-2'>
									<FileText className='h-4 w-4 text-primary' />
									<span className='text-sm font-medium'>{file.name}</span>
									<span className='text-xs text-muted-foreground'>
										{(file.size / 1024).toFixed(0)} KB
									</span>
								</div>
								<Button
									onClick={handleAnalyze}
									disabled={loading}
									className='gap-2'
								>
									{loading ? (
										<>
											<div className='animate-spin rounded-full h-4 w-4 border-b-2 border-current' />
											Analyzing...
										</>
									) : (
										<>
											<ArrowUpRight className='h-4 w-4' />
											Analyze CV
										</>
									)}
								</Button>
							</div>
						)}
					</CardContent>
				</Card>
			)}

			{/* Results */}
			{result && (
				<div className='space-y-6'>
					{/* Score Card */}
					<Card className={`border-2 ${scoreBg(result.score)}`}>
						<CardContent className='p-6'>
							<div className='flex flex-col sm:flex-row items-center gap-6'>
								<div className='flex flex-col items-center'>
									<div
										className={`text-5xl font-bold ${scoreColor(result.score)}`}
									>
										{result.score}
									</div>
									<div className='text-sm font-medium text-muted-foreground mt-1'>
										out of 100
									</div>
								</div>
								<div className='flex-1 text-center sm:text-left'>
									<h2 className={`text-xl font-bold ${scoreColor(result.score)}`}>
										{result.scoreLabel}
									</h2>
									<p className='text-sm text-muted-foreground mt-1'>
										{result.summary}
									</p>
								</div>
								<div className='flex items-center gap-2'>
									<Button variant='outline' onClick={handleReset}>
										Analyze Another CV
									</Button>
								</div>
							</div>
						</CardContent>
					</Card>

					<div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
						{/* Strengths */}
						<Card>
							<CardHeader className='pb-3'>
								<CardTitle className='flex items-center gap-2 text-base'>
									<CheckCircle className='h-5 w-5 text-emerald-600' />
									Strengths
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-3'>
								{result.strengths.map((s, i) => (
									<div key={i} className='rounded-lg bg-emerald-50/50 p-3'>
										<p className='text-sm font-medium text-emerald-900'>{s.title}</p>
										<p className='text-xs text-emerald-700 mt-0.5'>{s.description}</p>
									</div>
								))}
								{result.strengths.length === 0 && (
									<p className='text-sm text-muted-foreground'>No strengths identified.</p>
								)}
							</CardContent>
						</Card>

						{/* Improvements */}
						<Card>
							<CardHeader className='pb-3'>
								<CardTitle className='flex items-center gap-2 text-base'>
									<AlertCircle className='h-5 w-5 text-amber-600' />
									Areas for Improvement
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-3'>
								{result.improvements.map((imp, i) => (
									<div key={i} className='rounded-lg bg-muted p-3'>
										<div className='flex items-center gap-2'>
											<span
												className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${priorityColor(imp.priority)}`}
											>
												{imp.priority.toUpperCase()}
											</span>
											<p className='text-sm font-medium'>{imp.title}</p>
										</div>
										<p className='text-xs text-muted-foreground mt-1'>{imp.description}</p>
									</div>
								))}
								{result.improvements.length === 0 && (
									<p className='text-sm text-muted-foreground'>No improvements needed — great CV!</p>
								)}
							</CardContent>
						</Card>
					</div>

					{/* ATS Compatibility */}
					<Card>
						<CardHeader className='pb-3'>
							<CardTitle className='flex items-center gap-2 text-base'>
								<Target className='h-5 w-5 text-primary' />
								ATS Compatibility
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className='flex items-center gap-4 mb-3'>
								<div className='text-3xl font-bold'>{result.atsCompatibility.score}/100</div>
								<p className='text-sm text-muted-foreground'>{result.atsCompatibility.notes}</p>
							</div>
						</CardContent>
					</Card>

					<div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
						{/* Formatting Tips */}
						<Card>
							<CardHeader className='pb-3'>
								<CardTitle className='flex items-center gap-2 text-base'>
									<Layout className='h-5 w-5 text-primary' />
									Formatting Tips
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-2'>
								{result.formattingTips.map((tip, i) => (
									<div key={i} className='flex items-start gap-2 text-sm'>
										<Lightbulb className='h-4 w-4 text-amber-500 shrink-0 mt-0.5' />
										<span>{tip}</span>
									</div>
								))}
								{result.formattingTips.length === 0 && (
									<p className='text-sm text-muted-foreground'>No formatting tips.</p>
								)}
							</CardContent>
						</Card>

						{/* Keyword Optimization */}
						<Card>
							<CardHeader className='pb-3'>
								<CardTitle className='flex items-center gap-2 text-base'>
									<ArrowUpRight className='h-5 w-5 text-primary' />
									Keyword Optimization
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-2'>
								{result.keywordOptimization.map((kw, i) => (
									<div key={i} className='flex items-start gap-2 text-sm'>
										<Target className='h-4 w-4 text-primary shrink-0 mt-0.5' />
										<span>{kw}</span>
									</div>
								))}
								{result.keywordOptimization.length === 0 && (
									<p className='text-sm text-muted-foreground'>No keyword suggestions.</p>
								)}
							</CardContent>
						</Card>
					</div>
				</div>
			)}
		</div>
	)
}

function isValidFile(file: File) {
	const allowedTypes = [
		'application/pdf',
		'application/msword',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	]
	return allowedTypes.includes(file.type)
}

export default CVReviewPage
