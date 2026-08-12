import {
	BarChart3,
	Brain,
	Clock,
	Eye,
	ListChecks,
	Pencil,
	Plus,
	Search,
	ToggleLeft,
	ToggleRight,
	Trash2,
	Users,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '@/components/domain/empty-state'
import { Skeleton } from '@/components/domain/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { apiCall } from '@/lib/api'

interface AptitudeTest {
	id: number
	title: string
	description: string | null
	duration_minutes: number
	question_count: number
	pass_score: number
	retake_lockout_days: number
	is_active: boolean
	created_at: string
	question_count_actual: number
	total_attempts: number
	avg_score: number | null
}

export function RecruiterAptitudeTestsPage() {
	const navigate = useNavigate()
	const [tests, setTests] = useState<AptitudeTest[]>([])
	const [loading, setLoading] = useState(true)
	const [searchQuery, setSearchQuery] = useState('')
	const [deleting, setDeleting] = useState<number | null>(null)
	const [toggling, setToggling] = useState<number | null>(null)

	const loadData = useCallback(async () => {
		try {
			const data = await apiCall<{ tests: AptitudeTest[] }>('/recruiter/aptitude-tests')
			setTests(data.tests || [])
		} catch {
			// silent
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadData()
	}, [loadData])

	async function toggleActive(testId: number, current: boolean) {
		setToggling(testId)
		try {
			await apiCall(`/recruiter/aptitude-tests/${testId}`, {
				method: 'PUT',
				body: { is_active: !current },
			})
			setTests((prev) =>
				prev.map((t) => (t.id === testId ? { ...t, is_active: !current } : t)),
			)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Failed to update test'
			alert(msg)
		} finally {
			setToggling(null)
		}
	}

	async function deleteTest(testId: number) {
		if (!confirm('Are you sure you want to delete this test? This cannot be undone.')) return
		setDeleting(testId)
		try {
			await apiCall(`/recruiter/aptitude-tests/${testId}`, { method: 'DELETE' })
			setTests((prev) => prev.filter((t) => t.id !== testId))
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Failed to delete test'
			alert(msg)
		} finally {
			setDeleting(null)
		}
	}

	const filtered = tests.filter((t) => {
		if (!searchQuery) return true
		const q = searchQuery.toLowerCase()
		return (t.title || '').toLowerCase().includes(q)
	})

	const activeCount = tests.filter((t) => t.is_active).length
	const totalAttempts = tests.reduce((sum, t) => sum + (t.total_attempts || 0), 0)

	return (
		<div className='space-y-6'>
			<div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
				<div>
					<h1 className='font-heading text-2xl font-bold'>Aptitude Tests</h1>
					<p className='text-muted-foreground'>Manage cognitive assessment tests</p>
				</div>
				<Button onClick={() => navigate('/recruiter/aptitude-tests/create')} className='gap-1 min-h-[44px]'>
					<Plus className='h-4 w-4' /> Create Test
				</Button>
			</div>

			{/* Stats */}
			<div className='grid gap-3 sm:grid-cols-3'>
				<Card>
					<CardContent className='p-4 text-center'>
						<Brain className='mx-auto h-5 w-5 text-muted-foreground mb-1' />
						<p className='text-2xl font-bold'>{tests.length}</p>
						<p className='text-xs text-muted-foreground'>Total Tests</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4 text-center'>
						<ListChecks className='mx-auto h-5 w-5 text-emerald-500 mb-1' />
						<p className='text-2xl font-bold text-emerald-600'>{activeCount}</p>
						<p className='text-xs text-muted-foreground'>Active</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4 text-center'>
						<Users className='mx-auto h-5 w-5 text-blue-500 mb-1' />
						<p className='text-2xl font-bold text-blue-600'>{totalAttempts}</p>
						<p className='text-xs text-muted-foreground'>Total Attempts</p>
					</CardContent>
				</Card>
			</div>

			{/* Search */}
			<div className='relative max-w-md'>
				<Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
				<Input
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					placeholder='Search tests...'
					className='pl-9'
				/>
			</div>

			{/* Tests list */}
			{loading ? (
				<div className='space-y-4'>
					<Skeleton variant='card' count={3} />
				</div>
			) : filtered.length === 0 ? (
				<EmptyState
					icon={Brain}
					title='No aptitude tests yet'
					description='Create your first cognitive assessment test for candidates.'
					action={{
						label: 'Create Test',
						onClick: () => navigate('/recruiter/aptitude-tests/create'),
					}}
				/>
			) : (
				<div className='space-y-3'>
					{filtered.map((test) => (
						<Card key={test.id} className='hover:shadow-sm transition-shadow'>
							<CardContent className='p-4'>
								<div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
									<div className='flex-1 min-w-0'>
										<div className='flex items-center gap-2 mb-1'>
											<h4 className='font-medium'>{test.title}</h4>
											{test.is_active ? (
												<Badge variant='success' className='text-[10px]'>Active</Badge>
											) : (
												<Badge variant='secondary' className='text-[10px]'>Inactive</Badge>
											)}
										</div>
										<div className='flex flex-wrap items-center gap-3 text-xs text-muted-foreground'>
											<span className='flex items-center gap-1'>
												<Clock className='h-3 w-3' />
												{test.duration_minutes} min
											</span>
											<span className='flex items-center gap-1'>
												<ListChecks className='h-3 w-3' />
												{test.question_count_actual || test.question_count} questions
											</span>
											<span>Pass: {test.pass_score}%</span>
											<span>Retake: {test.retake_lockout_days}d lockout</span>
											{test.total_attempts > 0 && (
												<span className='flex items-center gap-1'>
													<Users className='h-3 w-3' />
													{test.total_attempts} attempts
												</span>
											)}
											{test.avg_score !== null && (
												<span className='flex items-center gap-1'>
													<BarChart3 className='h-3 w-3' />
													Avg: {test.avg_score}%
												</span>
											)}
										</div>
									</div>
									<div className='flex items-center gap-2'>
										<Button
											variant='outline'
											size='sm'
											className='gap-1'
											onClick={() => toggleActive(test.id, test.is_active)}
											disabled={toggling === test.id}
										>
											{toggling === test.id ? (
												<div className='h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent' />
											) : test.is_active ? (
												<ToggleRight className='h-4 w-4' />
											) : (
												<ToggleLeft className='h-4 w-4' />
											)}
										</Button>
										<Button
											variant='outline'
											size='sm'
											className='gap-1'
											onClick={() => navigate(`/recruiter/aptitude-tests/${test.id}/edit`)}
										>
											<Pencil className='h-3 w-3' /> Edit
										</Button>
										<Button
											variant='outline'
											size='sm'
											className='gap-1'
											onClick={() => navigate(`/recruiter/aptitude-tests/${test.id}/results`)}
										>
											<Eye className='h-3 w-3' /> Results
										</Button>
										<Button
											variant='ghost'
											size='sm'
											className='text-destructive hover:text-destructive gap-1'
											onClick={() => deleteTest(test.id)}
											disabled={deleting === test.id}
										>
											{deleting === test.id ? (
												<div className='h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent' />
											) : (
												<Trash2 className='h-3 w-3' />
											)}
										</Button>
									</div>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	)
}
