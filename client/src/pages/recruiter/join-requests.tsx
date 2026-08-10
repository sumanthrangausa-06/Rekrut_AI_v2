import {
	AlertTriangle,
	CheckCircle,
	Loader2,
	Mail,
	ShieldAlert,
	UserPlus,
	X,
	XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { JoinRequestCard } from '@/components/recruiter/join-request-card'
import { EmptyState } from '@/components/domain/empty-state'
import { Skeleton } from '@/components/domain/skeleton'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/auth-context'
import { apiCall } from '@/lib/api'
import type { JoinRequest } from '@/components/recruiter/join-request-card'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
	id: string
	message: string
	type: ToastType
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
	return (
		<div className='fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full px-4 sm:px-0'>
			{toasts.map((toast) => (
				<div
					key={toast.id}
					className={`flex items-start gap-3 rounded-lg border p-3 shadow-lg animate-in slide-in-from-right fade-in duration-200 ${
						toast.type === 'success'
							? 'bg-emerald-50 border-emerald-200 text-emerald-800'
							: toast.type === 'error'
								? 'bg-red-50 border-red-200 text-red-800'
								: 'bg-blue-50 border-blue-200 text-blue-800'
					}`}
				>
					{toast.type === 'success' ? (
						<CheckCircle className='h-5 w-5 shrink-0 mt-0.5 text-emerald-600' />
					) : toast.type === 'error' ? (
						<XCircle className='h-5 w-5 shrink-0 mt-0.5 text-red-600' />
					) : (
						<AlertTriangle className='h-5 w-5 shrink-0 mt-0.5 text-blue-600' />
					)}
					<p className='text-sm flex-1'>{toast.message}</p>
					<button
						onClick={() => onDismiss(toast.id)}
						className='shrink-0 text-muted-foreground hover:text-foreground min-h-[28px] min-w-[28px] flex items-center justify-center rounded'
					>
						<X className='h-4 w-4' />
					</button>
				</div>
			))}
		</div>
	)
}

export function RecruiterJoinRequestsPage() {
	const { user, loading: authLoading } = useAuth()
	const navigate = useNavigate()

	const [requests, setRequests] = useState<JoinRequest[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [toasts, setToasts] = useState<Toast[]>([])

	// Approve/Reject state
	const [processingId, setProcessingId] = useState<number | null>(null)
	const [confirmApproveId, setConfirmApproveId] = useState<number | null>(null)
	const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
	const [rejectRequestId, setRejectRequestId] = useState<number | null>(null)
	const [rejectReason, setRejectReason] = useState('')
	const [isRejecting, setIsRejecting] = useState(false)

	// Redirect non-owners after auth loads
	useEffect(() => {
		if (authLoading) return
		if (!user) {
			navigate('/login', { replace: true })
			return
		}
		if (user.is_company_owner === false) {
			navigate('/recruiter', { replace: true })
			return
		}
	}, [authLoading, user, navigate])

	const showToast = useCallback((message: string, type: ToastType = 'info') => {
		const id = `${Date.now()}-${Math.random()}`
		setToasts((prev) => [...prev, { id, message, type }])
		setTimeout(() => {
			setToasts((prev) => prev.filter((t) => t.id !== id))
		}, 5000)
	}, [])

	const dismissToast = useCallback((id: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== id))
	}, [])

	const loadRequests = useCallback(async () => {
		try {
			setError(null)
			const data = await apiCall<{ success: boolean; requests: JoinRequest[] }>(
				'/company/join-requests',
			)
			setRequests(data.requests || [])
		} catch (err: any) {
			setError(err.message || 'Failed to load join requests')
			console.error('Failed to load join requests:', err)
		} finally {
			setLoading(false)
		}
	}, [])

	// Initial load + polling every 30s
	useEffect(() => {
		if (authLoading || user?.is_company_owner !== true) return
		loadRequests()
		const interval = setInterval(loadRequests, 30000)
		return () => clearInterval(interval)
	}, [authLoading, user, loadRequests])

	const handleApprove = useCallback(
		async (id: number) => {
			setProcessingId(id)
			try {
				await apiCall<{ success: boolean; message: string }>(
					`/company/join-requests/${id}/approve`,
					{ method: 'POST' },
				)
				showToast('Recruiter approved and added to company', 'success')
				await loadRequests()
			} catch (err: any) {
				showToast(err.message || 'Failed to approve request', 'error')
			} finally {
				setProcessingId(null)
				setConfirmApproveId(null)
			}
		},
		[loadRequests, showToast],
	)

	const openRejectDialog = useCallback((id: number) => {
		setRejectRequestId(id)
		setRejectReason('')
		setRejectDialogOpen(true)
	}, [])

	const handleReject = useCallback(async () => {
		if (!rejectRequestId) return
		setIsRejecting(true)
		try {
			await apiCall<{ success: boolean; message: string }>(
				`/company/join-requests/${rejectRequestId}/reject`,
				{
					method: 'POST',
					body: { reason: rejectReason.trim() },
				},
			)
			showToast('Join request rejected', 'success')
			setRejectDialogOpen(false)
			setRejectRequestId(null)
			setRejectReason('')
			await loadRequests()
		} catch (err: any) {
			showToast(err.message || 'Failed to reject request', 'error')
		} finally {
			setIsRejecting(false)
		}
	}, [rejectRequestId, rejectReason, loadRequests, showToast])

	// Show loading while auth is initializing or ownership is being determined
	if (authLoading || (user && user.is_company_owner === undefined)) {
		return (
			<div className='flex min-h-[60vh] items-center justify-center'>
				<div className='animate-pulse flex flex-col items-center gap-3'>
					<div className='h-8 w-8 rounded-full bg-primary/20' />
					<p className='text-sm text-muted-foreground'>Loading...</p>
				</div>
			</div>
		)
	}

	return (
		<div className='space-y-6'>
			<ToastContainer toasts={toasts} onDismiss={dismissToast} />

			{/* Header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='font-heading text-2xl font-bold'>Pending Join Requests</h1>
					<p className='text-muted-foreground'>
						Review and approve new recruiters wanting to join your company
					</p>
				</div>
				{requests.length > 0 && !loading && (
					<div className='flex items-center gap-2 text-sm text-muted-foreground'>
						<Mail className='h-4 w-4' />
						<span>
							{requests.length} pending request{requests.length !== 1 ? 's' : ''}
						</span>
					</div>
				)}
			</div>

			{/* Error State */}
			{error && (
				<div className='rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3'>
					<ShieldAlert className='h-5 w-5 shrink-0 text-red-600 mt-0.5' />
					<div className='flex-1'>
						<p className='text-sm font-medium text-red-800'>Failed to load requests</p>
						<p className='text-sm text-red-700'>{error}</p>
					</div>
					<Button
						variant='outline'
						size='sm'
						onClick={loadRequests}
						className='shrink-0 min-h-[40px]'
					>
						Retry
					</Button>
				</div>
			)}

			{/* Loading State */}
			{loading ? (
				<Skeleton count={3} variant='card' />
			) : requests.length === 0 && !error ? (
				<EmptyState
					icon={UserPlus}
					title='No pending join requests'
					description='When recruiters register with your company email domain, their requests will appear here for approval.'
					action={{
						label: 'Invite team member',
						onClick: () => navigate('/recruiter/company'),
					}}
				/>
			) : (
				<div className='space-y-4'>
					{requests.map((request) => (
						<JoinRequestCard
							key={request.id}
							request={request}
							onApprove={(id) => setConfirmApproveId(id)}
							onReject={openRejectDialog}
							isProcessing={processingId === request.id}
						/>
					))}
				</div>
			)}

			{/* Approve Confirmation Dialog */}
			<Dialog open={!!confirmApproveId} onOpenChange={(open) => !open && setConfirmApproveId(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className='flex items-center gap-2'>
							<CheckCircle className='h-5 w-5 text-emerald-600' />
							Approve Join Request
						</DialogTitle>
						<DialogDescription>
							Are you sure you want to approve this recruiter? They will be added to your company
							immediately.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant='outline'
							onClick={() => setConfirmApproveId(null)}
							disabled={!!processingId}
						>
							Cancel
						</Button>
						<Button
							className='bg-indigo-600 hover:bg-indigo-700'
							onClick={() => confirmApproveId && handleApprove(confirmApproveId)}
							disabled={!!processingId}
						>
							{processingId === confirmApproveId ? (
								<>
									<Loader2 className='h-4 w-4 animate-spin' />
									Approving...
								</>
							) : (
								<>
									<CheckCircle className='h-4 w-4' />
									Approve
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Reject Dialog */}
			<Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className='flex items-center gap-2'>
							<XCircle className='h-5 w-5 text-red-600' />
							Reject Join Request
						</DialogTitle>
						<DialogDescription>
							Provide a reason for rejecting this request. The recruiter will not be notified
							directly, but the reason will be logged for your records.
						</DialogDescription>
					</DialogHeader>
					<div className='py-2'>
						<Textarea
							value={rejectReason}
							onChange={(e) => setRejectReason(e.target.value)}
							placeholder='e.g. Email domain mismatch, not a current employee...'
							rows={3}
						/>
					</div>
					<DialogFooter>
						<Button variant='outline' onClick={() => setRejectDialogOpen(false)} disabled={isRejecting}>
							Cancel
						</Button>
						<Button
							variant='destructive'
							onClick={handleReject}
							disabled={isRejecting || !rejectReason.trim()}
						>
							{isRejecting ? (
								<>
									<Loader2 className='h-4 w-4 animate-spin' />
									Rejecting...
								</>
							) : (
								<>
									<XCircle className='h-4 w-4' />
									Reject
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
