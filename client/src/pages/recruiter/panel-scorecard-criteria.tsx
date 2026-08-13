import {
	AlertCircle,
	CheckCircle,
	ChevronLeft,
	GripVertical,
	Plus,
	Save,
	Trash2,
	Weight,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '@/components/domain/empty-state'
import { Skeleton } from '@/components/domain/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { apiCall } from '@/lib/api'

interface Criterion {
	id?: number
	criterion_name: string
	description: string
	weight: number
	required: boolean
	sort_order: number
	isNew?: boolean
}

export function RecruiterPanelScorecardCriteriaPage() {
	const { jobId } = useParams<{ jobId: string }>()
	const navigate = useNavigate()
	const jobIdNum = Number(jobId)

	const [criteria, setCriteria] = useState<Criterion[]>([])
	const [jobTitle, setJobTitle] = useState('')
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
	const [showDelete, setShowDelete] = useState<Criterion | null>(null)
	const [deleting, setDeleting] = useState(false)

	useEffect(() => {
		if (message) {
			const t = setTimeout(() => setMessage(null), 4000)
			return () => clearTimeout(t)
		}
	}, [message])

	const loadData = useCallback(async () => {
		setLoading(true)
		try {
			const [criteriaRes, jobRes] = await Promise.all([
				apiCall<{ criteria: Criterion[] }>(`/panels/criteria/${jobIdNum}`),
				apiCall<{ job: { title: string } }>(`/recruiter/jobs/${jobIdNum}`).catch(() => ({ job: null })),
			])
			setCriteria(criteriaRes.criteria || [])
			if (jobRes.job) setJobTitle(jobRes.job.title)
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Failed to load criteria' })
		} finally {
			setLoading(false)
		}
	}, [jobIdNum])

	useEffect(() => {
		loadData()
	}, [loadData])

	function addCriterion() {
		const newCriterion: Criterion = {
			criterion_name: '',
			description: '',
			weight: 1,
			required: true,
			sort_order: criteria.length,
			isNew: true,
		}
		setCriteria((prev) => [...prev, newCriterion])
	}

	function updateCriterion(index: number, updates: Partial<Criterion>) {
		setCriteria((prev) =>
			prev.map((c, i) => (i === index ? { ...c, ...updates } : c)),
		)
	}

	function removeCriterion(index: number) {
		setCriteria((prev) => prev.filter((_, i) => i !== index))
	}

	async function saveCriteria() {
		// Validate
		const invalid = criteria.filter((c) => !c.criterion_name.trim())
		if (invalid.length > 0) {
			setMessage({ type: 'error', text: 'All criteria must have a name' })
			return
		}

		setSaving(true)
		try {
			const payload = criteria.map((c, i) => ({
				criterion_name: c.criterion_name.trim(),
				description: c.description.trim() || null,
				weight: Math.max(1, Math.min(5, c.weight || 1)),
				required: c.required,
				sort_order: i,
			}))

			await apiCall(`/panels/criteria/${jobIdNum}`, {
				method: 'POST',
				body: { criteria: payload },
			})

			setMessage({ type: 'success', text: 'Criteria saved successfully' })
			await loadData()
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Failed to save criteria' })
		} finally {
			setSaving(false)
		}
	}

	async function deleteCriterion() {
		if (!showDelete?.id) return
		setDeleting(true)
		try {
			await apiCall(`/panels/criteria/${jobIdNum}/${showDelete.id}`, { method: 'DELETE' })
			setShowDelete(null)
			setMessage({ type: 'success', text: 'Criterion deleted' })
			await loadData()
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Failed to delete criterion' })
		} finally {
			setDeleting(false)
		}
	}

	function moveCriterion(index: number, direction: 'up' | 'down') {
		if (direction === 'up' && index === 0) return
		if (direction === 'down' && index === criteria.length - 1) return

		setCriteria((prev) => {
			const newCriteria = [...prev]
			const targetIndex = direction === 'up' ? index - 1 : index + 1
			;[newCriteria[index], newCriteria[targetIndex]] = [
				newCriteria[targetIndex],
				newCriteria[index],
			]
			return newCriteria
		})
	}

	return (
		<div className='space-y-6 px-4 sm:px-6'>
			{/* Toast */}
			{message && (
				<div
					className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
						message.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-destructive text-white'
					}`}
				>
					{message.type === 'success' ? (
						<CheckCircle className='h-4 w-4' />
					) : (
						<AlertCircle className='h-4 w-4' />
					)}
					{message.text}
				</div>
			)}

			{/* Header */}
			<div className='flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4'>
				<div className='flex items-center gap-3'>
					<Button
						variant='ghost'
						size='sm'
						onClick={() => navigate(-1)}
						className='min-h-[44px] min-w-[44px] p-2'
					>
						<ChevronLeft className='h-5 w-5' />
					</Button>
					<div>
						<h1 className='text-2xl font-heading font-bold'>Scorecard Criteria</h1>
						<p className='text-muted-foreground text-sm'>
							{jobTitle ? jobTitle : 'Configure evaluation criteria for panel interviews'}
						</p>
					</div>
				</div>
				<div className='flex gap-2 flex-wrap'>
					<Button
						variant='outline'
						onClick={addCriterion}
						className='min-h-[44px]'
					>
						<Plus className='h-4 w-4 mr-2' /> Add Criterion
					</Button>
					<Button onClick={saveCriteria} disabled={saving} className='min-h-[44px]'>
						<Save className='h-4 w-4 mr-2' />
						{saving ? 'Saving...' : 'Save Criteria'}
					</Button>
				</div>
			</div>

			{/* Info card */}
			<div className='p-3 bg-indigo-50 border border-indigo-200 rounded-lg flex items-start gap-2 text-indigo-800'>
				<Weight className='h-4 w-4 shrink-0 mt-0.5' />
				<div className='text-sm'>
					<p className='font-medium'>How criteria work</p>
					<p className='text-indigo-700/80'>
						Each criterion is rated 1-5 by every panelist. Weights (1-5) affect the aggregate
						calculation. Required criteria must be rated before submitting.
					</p>
				</div>
			</div>

			{/* Criteria list */}
			{loading ? (
				<div className='space-y-3'>
					<Skeleton variant='card' />
					<Skeleton variant='card' />
					<Skeleton variant='card' />
				</div>
			) : criteria.length === 0 ? (
				<EmptyState
					icon={Weight}
					title='No criteria defined'
					description='Add criteria to define how candidates are evaluated in panel interviews for this job.'
					action={{ label: 'Add Criterion', onClick: addCriterion }}
				/>
			) : (
				<div className='space-y-3'>
					{criteria.map((criterion, index) => (
						<Card key={criterion.id || `new-${index}`}>
							<CardContent className='p-4 space-y-3'>
								<div className='flex items-start gap-2'>
									<div className='flex flex-col gap-1 pt-1'>
										<button
											onClick={() => moveCriterion(index, 'up')}
											disabled={index === 0}
											className='p-1 rounded hover:bg-muted disabled:opacity-30 min-h-[28px]'
											aria-label='Move up'
										>
											<GripVertical className='h-4 w-4 rotate-90' />
										</button>
										<button
											onClick={() => moveCriterion(index, 'down')}
											disabled={index === criteria.length - 1}
											className='p-1 rounded hover:bg-muted disabled:opacity-30 min-h-[28px]'
											aria-label='Move down'
										>
											<GripVertical className='h-4 w-4 -rotate-90' />
										</button>
									</div>

									<div className='flex-1 space-y-3'>
										<div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
											<div>
												<Label className='text-xs'>Criterion Name</Label>
												<Input
													value={criterion.criterion_name}
													onChange={(e) =>
														updateCriterion(index, { criterion_name: e.target.value })
													}
													placeholder='e.g., Technical Skills'
													className='min-h-[44px]'
												/>
											</div>
											<div className='flex gap-3'>
												<div className='flex-1'>
													<Label className='text-xs'>Weight (1-5)</Label>
													<Input
														type='number'
														min={1}
														max={5}
														value={criterion.weight}
														onChange={(e) =>
															updateCriterion(index, {
																weight: parseInt(e.target.value, 10) || 1,
															})
														}
														className='min-h-[44px]'
													/>
												</div>
												<div className='flex items-end pb-2 gap-2'>
													<label className='flex items-center gap-1.5 text-sm cursor-pointer min-h-[44px]'>
														<input
															type='checkbox'
															checked={criterion.required}
															onChange={(e) =>
																updateCriterion(index, { required: e.target.checked })
															}
														/>
														Required
													</label>
												</div>
											</div>
										</div>

										<div>
											<Label className='text-xs'>Description</Label>
											<Textarea
												value={criterion.description}
												onChange={(e) =>
													updateCriterion(index, { description: e.target.value })
												}
												placeholder='What should panelists evaluate?'
												rows={2}
											/>
										</div>
									</div>

									<div className='flex flex-col items-center gap-1 pt-1'>
										{criterion.id && !criterion.isNew && (
											<button
												onClick={() => setShowDelete(criterion)}
												className='p-2 rounded hover:bg-red-50 text-destructive min-h-[44px]'
												aria-label='Delete criterion'
											>
												<Trash2 className='h-4 w-4' />
											</button>
										)}
										{(!criterion.id || criterion.isNew) && (
											<button
												onClick={() => removeCriterion(index)}
												className='p-2 rounded hover:bg-red-50 text-destructive min-h-[44px]'
												aria-label='Remove criterion'
											>
												<Trash2 className='h-4 w-4' />
											</button>
										)}
									</div>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			{/* Bottom actions */}
			{criteria.length > 0 && (
				<div className='flex gap-2 justify-end pt-2'>
					<Button
						variant='outline'
						onClick={addCriterion}
						className='min-h-[44px]'
					>
						<Plus className='h-4 w-4 mr-2' /> Add Criterion
					</Button>
					<Button onClick={saveCriteria} disabled={saving} className='min-h-[44px]'>
						<Save className='h-4 w-4 mr-2' />
						{saving ? 'Saving...' : 'Save Criteria'}
					</Button>
				</div>
			)}

			{/* Delete confirmation */}
			<Dialog open={!!showDelete} onClose={() => setShowDelete(null)}>
				<DialogHeader>
					<DialogTitle>Delete Criterion</DialogTitle>
					<DialogDescription>
						Are you sure you want to delete &quot;{showDelete?.criterion_name}&quot;? This will
						remove it from all scorecards for this job.
					</DialogDescription>
				</DialogHeader>
				<div className='flex gap-2 justify-end mt-4'>
					<Button
						variant='outline'
						onClick={() => setShowDelete(null)}
						className='min-h-[44px]'
					>
						Cancel
					</Button>
					<Button
						variant='destructive'
						onClick={deleteCriterion}
						disabled={deleting}
						className='min-h-[44px]'
					>
						{deleting ? 'Deleting...' : 'Delete'}
					</Button>
				</div>
			</Dialog>
		</div>
	)
}
