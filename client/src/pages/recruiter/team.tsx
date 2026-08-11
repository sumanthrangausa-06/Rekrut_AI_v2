import {
	AlertCircle,
	AlertTriangle,
	CheckCircle,
	Crown,
	Loader2,
	Mail,
	PauseCircle,
	PlayCircle,
	Plus,
	ShieldAlert,
	UserPlus,
	Users,
	X,
	XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '@/components/domain/empty-state'
import { Skeleton } from '@/components/domain/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/auth-context'
import { apiCall } from '@/lib/api'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
	id: string
	message: string
	type: ToastType
}

interface TeamMember {
	id: number
	name: string
	email: string
	role: string
	created_at: string
	suspended_at?: string | null
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

const roleLabels: Record<string, string> = {
	recruiter: 'Recruiter',
	hiring_manager: 'Hiring Manager',
	employer: 'Admin',
	admin: 'Super Admin',
}

export function RecruiterTeamPage() {
	const { user, loading: authLoading } = useAuth()
	const navigate = useNavigate()

	const [members, setMembers] = useState<TeamMember[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [toasts, setToasts] = useState<Toast[]>([])

	// Suspend/Reinstate state
	const [suspendingId, setSuspendingId] = useState<number | null>(null)
	const [reinstatingId, setReinstatingId] = useState<number | null>(null)
	const [confirmSuspendId, setConfirmSuspendId] = useState<number | null>(null)

	// Invite state
	const [showInvite, setShowInvite] = useState(false)
	const [inviteEmail, setInviteEmail] = useState('')
	const [inviteName, setInviteName] = useState('')
	const [inviteRole, setInviteRole] = useState('recruiter')
	const [inviting, setInviting] = useState(false)

	// Redirect non-owners after auth loads
	useEffect(() => {
		if (authLoading) return
		if (!user) {
			navigate('/login', { replace: true })
			return
		}
		if (user.is_company_owner === false) {
			navigate('/recruiter/company', { replace: true })
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

	const loadMembers = useCallback(async () => {
		try {
			setError(null)
			const data = await apiCall<{ members: TeamMember[] }>('/company/team/members')
			setMembers(data.members || [])
		} catch (err: any) {
			setError(err.message || 'Failed to load team members')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		if (authLoading || user?.is_company_owner !== true) return
		loadMembers()
	}, [authLoading, user, loadMembers])

	const handleSuspend = useCallback(
		async (id: number) => {
			setSuspendingId(id)
			try {
				await apiCall(`/company/team/members/${id}/suspend`, { method: 'POST' })
				setMembers((prev) =>
					prev.map((m) => (m.id === id ? { ...m, suspended_at: new Date().toISOString() } : m)),
				)
				showToast('Team member suspended', 'success')
			} catch (err: any) {
				showToast(err.message || 'Failed to suspend team member', 'error')
			} finally {
				setSuspendingId(null)
				setConfirmSuspendId(null)
			}
		},
		[showToast],
	)

	const handleReinstate = useCallback(
		async (id: number) => {
			setReinstatingId(id)
			try {
				await apiCall(`/company/team/members/${id}/reinstate`, { method: 'POST' })
				setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, suspended_at: null } : m)))
				showToast('Team member reinstated', 'success')
			} catch (err: any) {
				showToast(err.message || 'Failed to reinstate team member', 'error')
			} finally {
				setReinstatingId(null)
			}
		},
		[showToast],
	)

	const handleInvite = useCallback(async () => {
		if (!inviteEmail.trim()) return
		setInviting(true)
		try {
			const data = await apiCall<{ success: boolean; member: TeamMember; temp_password: string }>(
				'/company/team/invite',
				{
					method: 'POST',
					body: { email: inviteEmail, name: inviteName, role: inviteRole },
				},
			)
			setMembers((prev) => [...prev, data.member])
			setShowInvite(false)
			setInviteEmail('')
			setInviteName('')
			showToast(`${data.member.name || data.member.email} invited successfully`, 'success')
		} catch (err: any) {
			showToast(err.message || 'Failed to invite team member', 'error')
		} finally {
			setInviting(false)
		}
	}, [inviteEmail, inviteName, inviteRole, showToast])

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

	const activeCount = members.filter((m) => !m.suspended_at).length
	const suspendedCount = members.filter((m) => m.suspended_at).length

	return (
		<div className='space-y-6'>
			<ToastContainer toasts={toasts} onDismiss={dismissToast} />

			{/* Header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='font-heading text-2xl font-bold'>Team Management</h1>
					<p className='text-muted-foreground'>
						Manage your company's recruiting team — {activeCount} active
						{suspendedCount > 0 && `, ${suspendedCount} suspended`}
					</p>
				</div>
				<Button size='sm' onClick={() => setShowInvite(true)} className='gap-1.5'>
					<UserPlus className='h-4 w-4' /> Invite Member
				</Button>
			</div>

			{/* Error State */}
			{error && (
				<div className='rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3'>
					<ShieldAlert className='h-5 w-5 shrink-0 text-red-600 mt-0.5' />
					<div className='flex-1'>
						<p className='text-sm font-medium text-red-800'>Failed to load team</p>
						<p className='text-sm text-red-700'>{error}</p>
					</div>
					<Button variant='outline' size='sm' onClick={loadMembers} className='shrink-0 min-h-[40px]'>
						Retry
					</Button>
				</div>
			)}

			{/* Loading State */}
			{loading ? (
				<div className='space-y-3'>
					<Skeleton variant='card' />
					<Skeleton variant='card' />
					<Skeleton variant='card' />
				</div>
			) : members.length === 0 && !error ? (
				<EmptyState
					icon={Users}
					title='No team members yet'
					description='Invite colleagues to join your company and collaborate on hiring.'
					action={{
						label: 'Invite team member',
						onClick: () => setShowInvite(true),
					}}
				/>
			) : (
				<div className='space-y-3'>
					{/* Active members */}
					{members
						.filter((m) => !m.suspended_at)
						.map((member) => (
							<MemberCard
								key={member.id}
								member={member}
								isOwner={user?.is_company_owner === true}
								isSelf={member.id === user?.id}
								onSuspend={setConfirmSuspendId}
								isProcessing={suspendingId === member.id}
							/>
						))}

					{/* Suspended members section */}
					{suspendedCount > 0 && (
						<>
							<div className='pt-4 pb-1'>
								<h3 className='text-sm font-semibold text-muted-foreground flex items-center gap-1.5'>
									<PauseCircle className='h-4 w-4' />
									Suspended Members ({suspendedCount})
								</h3>
							</div>
							{members
								.filter((m) => m.suspended_at)
								.map((member) => (
									<SuspendedMemberCard
										key={member.id}
										member={member}
										isOwner={user?.is_company_owner === true}
										onReinstate={handleReinstate}
										isProcessing={reinstatingId === member.id}
									/>
								))}
						</>
						)}
				</div>
			)}

			{/* Suspend Confirmation Dialog */}
			<Dialog open={!!confirmSuspendId} onOpenChange={(open) => !open && setConfirmSuspendId(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className='flex items-center gap-2'>
							<AlertCircle className='h-5 w-5 text-amber-600' />
							Suspend Team Member
						</DialogTitle>
						<DialogDescription>
							Are you sure you want to suspend this team member? They will immediately lose access to
							company data and recruiting functions. They will receive an email notification.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant='outline' onClick={() => setConfirmSuspendId(null)} disabled={!!suspendingId}>
							Cancel
						</Button>
						<Button
							variant='destructive'
							onClick={() => confirmSuspendId && handleSuspend(confirmSuspendId)}
							disabled={!!suspendingId}
						>
							{suspendingId === confirmSuspendId ? (
								<>
									<Loader2 className='h-4 w-4 animate-spin' />
									Suspending...
								</>
							) : (
								<>
									<PauseCircle className='h-4 w-4' />
									Suspend
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Invite Dialog */}
			<Dialog open={showInvite} onOpenChange={setShowInvite}>
				<DialogContent className='sm:max-w-md'>
					<DialogHeader>
						<DialogTitle className='flex items-center gap-2'>
							<UserPlus className='h-5 w-5' />
							Invite Team Member
						</DialogTitle>
						<DialogDescription>
							Send an invitation to a colleague to join your company's recruiting team.
						</DialogDescription>
					</DialogHeader>
					<div className='space-y-4 py-2'>
						<div>
							<Label>Email *</Label>
							<Input
								value={inviteEmail}
								onChange={(e) => setInviteEmail(e.target.value)}
								placeholder='colleague@company.com'
								type='email'
							/>
						</div>
						<div>
							<Label>Name</Label>
							<Input
								value={inviteName}
								onChange={(e) => setInviteName(e.target.value)}
								placeholder='John Smith'
							/>
						</div>
						<div>
							<Label>Role</Label>
							<select
								value={inviteRole}
								onChange={(e) => setInviteRole(e.target.value)}
								className='flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
							>
								<option value='recruiter'>Recruiter</option>
								<option value='hiring_manager'>Hiring Manager</option>
								<option value='employer'>Admin</option>
							</select>
						</div>
					</div>
					<DialogFooter>
						<Button variant='outline' onClick={() => setShowInvite(false)} disabled={inviting}>
							Cancel
						</Button>
						<Button
							onClick={handleInvite}
							disabled={!inviteEmail.trim() || inviting}
							className='gap-1'
						>
							{inviting ? (
								<Loader2 className='h-4 w-4 animate-spin' />
							) : (
								<Mail className='h-4 w-4' />
							)}
							Send Invite
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}

// ============= Active Member Card =============

function MemberCard({
	member,
	isOwner,
	isSelf,
	onSuspend,
	isProcessing,
}: {
	member: TeamMember
	isOwner: boolean
	isSelf: boolean
	onSuspend: (id: number) => void
	isProcessing: boolean
}) {
	return (
		<Card>
			<CardContent className='p-4'>
				<div className='flex items-center gap-3'>
					<div className='h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0'>
						<span className='text-sm font-bold text-primary'>
							{(member.name || member.email)[0]?.toUpperCase()}
						</span>
					</div>
					<div className='flex-1 min-w-0'>
						<div className='flex items-center gap-2 flex-wrap'>
							<p className='font-medium truncate'>{member.name || 'Unnamed'}</p>
							{isSelf && (
								<Badge variant='secondary' className='gap-0.5 text-[10px]'>
									<Crown className='h-2.5 w-2.5' /> You
								</Badge>
							)}
							{member.role === 'employer' && (
								<Badge variant='outline' className='text-[10px] gap-0.5 border-amber-200 text-amber-700 bg-amber-50'>
									<Crown className='h-2.5 w-2.5' /> Owner
								</Badge>
							)}
						</div>
						<p className='text-sm text-muted-foreground flex items-center gap-1'>
							<Mail className='h-3 w-3' /> {member.email}
						</p>
					</div>
					<Badge variant='outline' className='shrink-0'>
						{roleLabels[member.role] || member.role}
					</Badge>
					<p className='text-xs text-muted-foreground hidden sm:block shrink-0'>
						Joined {new Date(member.created_at).toLocaleDateString()}
					</p>
					{isOwner && !isSelf && (
						<Button
							variant='ghost'
							size='sm'
							className='text-amber-600 hover:text-amber-700 hover:bg-amber-50 shrink-0 gap-1'
							onClick={() => onSuspend(member.id)}
							disabled={isProcessing}
						>
							{isProcessing ? (
								<Loader2 className='h-3.5 w-3.5 animate-spin' />
							) : (
								<>
									<PauseCircle className='h-3.5 w-3.5' />
									<span className='hidden sm:inline'>Suspend</span>
								</>
							)}
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	)
}

// ============= Suspended Member Card =============

function SuspendedMemberCard({
	member,
	isOwner,
	onReinstate,
	isProcessing,
}: {
	member: TeamMember
	isOwner: boolean
	onReinstate: (id: number) => void
	isProcessing: boolean
}) {
	return (
		<Card className='border-red-200 bg-red-50/30'>
			<CardContent className='p-4'>
				<div className='flex items-center gap-3'>
					<div className='h-10 w-10 rounded-full bg-red-100 flex items-center justify-center shrink-0'>
						<span className='text-sm font-bold text-red-600'>
							{(member.name || member.email)[0]?.toUpperCase()}
						</span>
					</div>
					<div className='flex-1 min-w-0'>
						<div className='flex items-center gap-2 flex-wrap'>
							<p className='font-medium truncate text-muted-foreground'>
								{member.name || 'Unnamed'}
							</p>
							<Badge
								variant='outline'
								className='text-[10px] gap-0.5 border-red-200 text-red-700 bg-red-50'
							>
								<PauseCircle className='h-2.5 w-2.5' /> Suspended
							</Badge>
						</div>
						<p className='text-sm text-muted-foreground flex items-center gap-1'>
							<Mail className='h-3 w-3' /> {member.email}
						</p>
					</div>
					<Badge variant='outline' className='shrink-0 text-muted-foreground'>
						{roleLabels[member.role] || member.role}
					</Badge>
					<p className='text-xs text-muted-foreground hidden sm:block shrink-0'>
						Joined {new Date(member.created_at).toLocaleDateString()}
					</p>
					{isOwner && (
						<Button
							variant='ghost'
							size='sm'
							className='text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 shrink-0 gap-1'
							onClick={() => onReinstate(member.id)}
							disabled={isProcessing}
						>
							{isProcessing ? (
								<Loader2 className='h-3.5 w-3.5 animate-spin' />
							) : (
								<>
									<PlayCircle className='h-3.5 w-3.5' />
									<span className='hidden sm:inline'>Reinstate</span>
								</>
							)}
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
