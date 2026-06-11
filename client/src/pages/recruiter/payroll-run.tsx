import {
	AlertCircle,
	ArrowLeft,
	CheckCircle,
	Clock,
	DollarSign,
	Play,
	Receipt,
	Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { apiCall } from '@/lib/api'

// ── Types ──────────────────────────────────────────────────
interface PayrollRun {
	id: number
	pay_period_start: string
	pay_period_end: string
	pay_date: string
	status: string
	total_gross: number
	total_taxes: number
	total_net: number
	employee_count: number
	country_code: string | null
	currency_code: string | null
	created_at: string
	processed_at: string | null
}

interface Paycheck {
	id: number
	employee_id: number
	employee_name: string
	employee_number: string
	gross_pay: number
	federal_tax: number
	state_tax: number
	social_security: number
	medicare: number
	other_deductions: number
	net_pay: number
	hours_worked: number | null
	status: string
	pay_date: string
}

interface PayrollRunData {
	payrollRun: PayrollRun
	paychecks: Paycheck[]
}

// ── Helpers ────────────────────────────────────────────────
function fmtCurrency(n: number) {
	return (
		'$' +
		Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
	)
}

function formatDate(dateStr: string) {
	return new Date(dateStr).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	})
}

// ── Component ──────────────────────────────────────────────
export function RecruiterPayrollRunPage() {
	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const [loading, setLoading] = useState(true)
	const [data, setData] = useState<PayrollRunData | null>(null)
	const [error, setError] = useState('')
	const [processing, setProcessing] = useState(false)
	const [showConfirm, setShowConfirm] = useState(false)

	useEffect(() => {
		if (!id) {
			setError('Invalid payroll run ID')
			setLoading(false)
			return
		}
		loadPayrollRun()
	}, [id, loadPayrollRun])

	async function loadPayrollRun() {
		setLoading(true)
		setError('')
		try {
			const res = await apiCall<PayrollRunData>(`/payroll/runs/${id}`)
			setData(res)
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : 'Failed to load payroll run')
		} finally {
			setLoading(false)
		}
	}

	async function processPayroll() {
		if (!id) return
		setProcessing(true)
		try {
			await apiCall(`/payroll/runs/${id}/process`, { method: 'POST' })
			setShowConfirm(false)
			await loadPayrollRun()
		} catch (err: unknown) {
			alert(err instanceof Error ? err.message : 'Failed to process payroll')
		} finally {
			setProcessing(false)
		}
	}

	const payrollRun = data?.payrollRun
	const paychecks = data?.paychecks || []

	if (loading) {
		return (
			<div className='flex items-center justify-center py-20'>
				<div className='h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent' />
			</div>
		)
	}

	if (error || !payrollRun) {
		return (
			<div className='space-y-6'>
				<div className='mb-4'>
					<Button
						variant='outline'
						onClick={() => navigate('/recruiter/payroll')}
						className='gap-2'
					>
						<ArrowLeft className='h-4 w-4' /> Back to Payroll
					</Button>
				</div>
				<Card>
					<CardContent className='p-8 text-center'>
						<AlertCircle className='mx-auto mb-3 h-10 w-10 text-destructive opacity-60' />
						<p className='text-muted-foreground'>{error || 'Payroll run not found'}</p>
						<Button variant='outline' onClick={loadPayrollRun} className='mt-4'>
							Retry
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	const _ficaTotal = paychecks.reduce(
		(sum, pc) => sum + (pc.social_security || 0) + (pc.medicare || 0),
		0,
	)

	return (
		<div className='space-y-6'>
			{/* Back link */}
			<div className='mb-2'>
				<Button variant='outline' onClick={() => navigate('/recruiter/payroll')} className='gap-2'>
					<ArrowLeft className='h-4 w-4' /> Back to Payroll
				</Button>
			</div>

			{/* Header */}
			<div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
				<div>
					<h1 className='font-heading text-2xl font-bold flex items-center gap-2'>
						<Receipt className='h-6 w-6 text-primary' /> Payroll Run
					</h1>
					<p className='text-muted-foreground'>
						Pay Period: {formatDate(payrollRun.pay_period_start)} –{' '}
						{formatDate(payrollRun.pay_period_end)} · Pay Date: {formatDate(payrollRun.pay_date)}
					</p>
				</div>
				<div className='flex items-center gap-3'>
					<Badge
						variant={
							payrollRun.status === 'completed'
								? 'success'
								: payrollRun.status === 'draft'
									? 'warning'
									: 'default'
						}
						className='text-sm px-3 py-1'
					>
						{payrollRun.status === 'completed' ? (
							<CheckCircle className='h-3.5 w-3.5 mr-1' />
						) : (
							<Clock className='h-3.5 w-3.5 mr-1' />
						)}
						{payrollRun.status}
					</Badge>
					{payrollRun.status === 'draft' && (
						<Button onClick={() => setShowConfirm(true)} className='gap-2'>
							<Play className='h-4 w-4' /> Process Payroll
						</Button>
					)}
				</div>
			</div>

			{/* Stats */}
			<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center gap-3'>
							<div className='rounded-lg bg-emerald-100 p-2'>
								<DollarSign className='h-5 w-5 text-emerald-600' />
							</div>
							<div>
								<p className='text-2xl font-bold'>{fmtCurrency(payrollRun.total_gross)}</p>
								<p className='text-xs text-muted-foreground'>Total Gross Pay</p>
							</div>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center gap-3'>
							<div className='rounded-lg bg-amber-100 p-2'>
								<DollarSign className='h-5 w-5 text-amber-600' />
							</div>
							<div>
								<p className='text-2xl font-bold'>{fmtCurrency(payrollRun.total_taxes)}</p>
								<p className='text-xs text-muted-foreground'>Total Deductions</p>
							</div>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center gap-3'>
							<div className='rounded-lg bg-blue-100 p-2'>
								<DollarSign className='h-5 w-5 text-blue-600' />
							</div>
							<div>
								<p className='text-2xl font-bold'>{fmtCurrency(payrollRun.total_net)}</p>
								<p className='text-xs text-muted-foreground'>Total Net Pay</p>
							</div>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center gap-3'>
							<div className='rounded-lg bg-purple-100 p-2'>
								<Users className='h-5 w-5 text-purple-600' />
							</div>
							<div>
								<p className='text-2xl font-bold'>{paychecks.length}</p>
								<p className='text-xs text-muted-foreground'>Employees</p>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Paychecks Table */}
			<Card>
				<CardContent className='p-5'>
					<div className='flex items-center justify-between mb-4'>
						<h3 className='font-semibold flex items-center gap-2'>
							<Users className='h-4 w-4 text-blue-500' /> Paychecks
						</h3>
						<span className='text-sm text-muted-foreground'>{paychecks.length} paychecks</span>
					</div>

					{paychecks.length === 0 ? (
						<div className='text-center py-8'>
							<Receipt className='mx-auto mb-2 h-8 w-8 opacity-20' />
							<p className='text-sm text-muted-foreground'>
								No paychecks found for this payroll run.
							</p>
						</div>
					) : (
						<div className='overflow-x-auto'>
							<table className='w-full text-sm'>
								<thead>
									<tr className='border-b text-left text-muted-foreground'>
										<th className='pb-2 font-medium'>Employee</th>
										<th className='pb-2 font-medium hidden sm:table-cell'>Hours</th>
										<th className='pb-2 font-medium hidden sm:table-cell'>Gross Pay</th>
										<th className='pb-2 font-medium hidden sm:table-cell'>Federal Tax</th>
										<th className='pb-2 font-medium hidden sm:table-cell'>State Tax</th>
										<th className='pb-2 font-medium hidden sm:table-cell'>FICA</th>
										<th className='pb-2 font-medium'>Net Pay</th>
										<th className='pb-2 font-medium'>Status</th>
									</tr>
								</thead>
								<tbody>
									{paychecks.map((pc) => {
										const fica = (pc.social_security || 0) + (pc.medicare || 0)
										return (
											<tr key={pc.id} className='border-b last:border-0'>
												<td className='py-3'>
													<p className='font-medium'>{pc.employee_name}</p>
													<p className='text-xs text-muted-foreground'>#{pc.employee_number}</p>
												</td>
												<td className='py-3'>{pc.hours_worked ?? '—'}</td>
												<td className='py-3 hidden sm:table-cell'>{fmtCurrency(pc.gross_pay)}</td>
												<td className='py-3 hidden sm:table-cell'>{fmtCurrency(pc.federal_tax)}</td>
												<td className='py-3 hidden sm:table-cell'>{fmtCurrency(pc.state_tax)}</td>
												<td className='py-3 hidden sm:table-cell'>{fmtCurrency(fica)}</td>
												<td className='py-3 font-medium text-emerald-600'>
													{fmtCurrency(pc.net_pay)}
												</td>
												<td className='py-3'>
													<Badge variant={pc.status === 'paid' ? 'success' : 'warning'}>
														{pc.status}
													</Badge>
												</td>
											</tr>
										)
									})}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Process Confirmation Dialog */}
			<Dialog open={showConfirm} onOpenChange={setShowConfirm}>
				<DialogHeader>
					<DialogTitle className='flex items-center gap-2'>
						<Play className='h-5 w-5 text-primary' /> Process Payroll
					</DialogTitle>
					<DialogDescription>
						Are you sure you want to process this payroll run? This will mark all paychecks as paid
						and cannot be undone.
					</DialogDescription>
				</DialogHeader>

				<div className='rounded-lg bg-muted p-4 space-y-2'>
					<div className='flex justify-between text-sm'>
						<span>Total Net Pay:</span>
						<strong>{fmtCurrency(payrollRun.total_net)}</strong>
					</div>
					<div className='flex justify-between text-sm text-muted-foreground'>
						<span>Employees:</span>
						<span>{paychecks.length}</span>
					</div>
					<div className='flex justify-between text-sm text-muted-foreground'>
						<span>Pay Date:</span>
						<span>{formatDate(payrollRun.pay_date)}</span>
					</div>
				</div>

				<DialogFooter>
					<Button variant='outline' onClick={() => setShowConfirm(false)}>
						Cancel
					</Button>
					<Button onClick={processPayroll} disabled={processing} className='gap-2'>
						{processing ? (
							<div className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
						) : (
							<Play className='h-4 w-4' />
						)}
						Process Payroll
					</Button>
				</DialogFooter>
			</Dialog>
		</div>
	)
}
