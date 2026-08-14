import {
	AlertTriangle,
	Bell,
	CheckCircle,
	CreditCard,
	Download,
	Eye,
	EyeOff,
	Globe,
	Link,
	Link2Off,
	Linkedin,
	Loader2,
	Lock,
	Monitor,
	Moon,
	Palette,
	Shield,
	Sun,
	Trash2,
	Upload,
	User,
	X,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/contexts/auth-context'
import { useTheme } from '@/contexts/theme-context'
import { trackEvent } from '@/lib/analytics'
import { apiCall } from '@/lib/api'

interface NotificationSettings {
	email_jobs: boolean
	email_applications: boolean
	email_messages: boolean
	email_marketing: boolean
	push_jobs: boolean
	push_messages: boolean
	push_reminders: boolean
}

interface PrivacySettings {
	profile_visible: boolean
	allow_messages: boolean
	share_analytics: boolean
}

export function SettingsPage() {
	const { user, logout } = useAuth()
	const { theme, setTheme } = useTheme()
	const [activeTab, setActiveTab] = useState('profile')
	const [saving, setSaving] = useState(false)
	const [saved, setSaved] = useState(false)
	const [error, setError] = useState('')

	// Clear error when switching tabs
	useEffect(() => {
		setError('')
	}, [])
	const [name, setName] = useState(user?.name || '')
	const [email, setEmail] = useState(user?.email || '')
	const [bio, setBio] = useState('')
	const [location, setLocation] = useState('')
	const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '')

	// Password state
	const [currentPassword, setCurrentPassword] = useState('')
	const [newPassword, setNewPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [showPassword, setShowPassword] = useState(false)

	// Notification state
	const [notifications, setNotifications] = useState<NotificationSettings>({
		email_jobs: true,
		email_applications: true,
		email_messages: true,
		email_marketing: false,
		push_jobs: true,
		push_messages: true,
		push_reminders: true,
	})

	// Privacy state
	const [privacy, setPrivacy] = useState<PrivacySettings>({
		profile_visible: true,
		allow_messages: true,
		share_analytics: false,
	})

	// Delete account state
	const [deleteConfirm, setDeleteConfirm] = useState('')
	const [showDeleteDialog, setShowDeleteDialog] = useState(false)

	// ── Account Connections (Issue #161) ──
	const [searchParams, setSearchParams] = useSearchParams()
	const [connections, setConnections] = useState<Array<{ provider: string; connected_at: string; email?: string; last_sync?: string }>>([])
	const [connectionsLoading, setConnectionsLoading] = useState(false)
	const [connectionsError, setConnectionsError] = useState<string | null>(null)
	const [hasPassword, setHasPassword] = useState(true)
	const [disconnectingProvider, setDisconnectingProvider] = useState<string | null>(null)
	const [confirmDisconnectProvider, setConfirmDisconnectProvider] = useState<string | null>(null)

	type ToastType = 'success' | 'error' | 'info'
	interface Toast {
		id: string
		message: string
		type: ToastType
	}
	const [toasts, setToasts] = useState<Toast[]>([])

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

	const loadConnections = useCallback(async () => {
		setConnectionsLoading(true)
		setConnectionsError(null)
		try {
			const data = await apiCall<{
				success: boolean
				connections: Array<{ provider: string; connected_at: string; email?: string; last_sync?: string }>
				has_password: boolean
			}>('/auth/oauth/connections')
			setConnections(data.connections || [])
			setHasPassword(data.has_password ?? true)
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Failed to load connections'
			setConnectionsError(msg)
		} finally {
			setConnectionsLoading(false)
		}
	}, [])

	// Handle OAuth redirect params
	useEffect(() => {
		const connected = searchParams.get('oauth_connected')
		const oauthError = searchParams.get('oauth_error')
		if (connected) {
			showToast(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully`, 'success')
			setSearchParams({}, { replace: true })
			loadConnections()
		}
		if (oauthError) {
			let message = 'Connection failed'
			if (oauthError === 'email_mismatch') {
				message = 'The OAuth account email does not match your account email.'
			} else if (oauthError === 'google_account_already_linked') {
				message = 'This Google account is already linked to another user.'
			} else if (oauthError === 'linkedin_account_already_linked') {
				message = 'This LinkedIn account is already linked to another user.'
			} else {
				message = `Connection failed: ${decodeURIComponent(oauthError)}`
			}
			showToast(message, 'error')
			setSearchParams({}, { replace: true })
		}
	}, [searchParams, setSearchParams, showToast, loadConnections])

	useEffect(() => {
		if (activeTab === 'account') {
			loadConnections()
		}
	}, [activeTab, loadConnections])

	async function handleConnectProvider(provider: string) {
		try {
			const data = await apiCall<{ url: string; configured: boolean }>(`/auth/oauth/connect/${provider}`)
			if (data.url) {
				window.location.href = data.url
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : `Failed to connect ${provider}`
			showToast(msg, 'error')
		}
	}

	async function handleDisconnectProvider(provider: string) {
		setDisconnectingProvider(provider)
		try {
			await apiCall('/auth/oauth/disconnect', {
				method: 'POST',
				body: { provider },
			})
			showToast(`${provider.charAt(0).toUpperCase() + provider.slice(1)} disconnected successfully`, 'success')
			await loadConnections()
		} catch (err: any) {
			const msg = err?.message || `Failed to disconnect ${provider}`
			if (err?.code === 'LAST_AUTH_METHOD') {
				showToast('Cannot disconnect your only sign-in method. Please set a password first.', 'error')
			} else {
				showToast(msg, 'error')
			}
		} finally {
			setDisconnectingProvider(null)
			setConfirmDisconnectProvider(null)
		}
	}

	function formatDate(dateStr?: string) {
		if (!dateStr) return null
		try {
			return new Date(dateStr).toLocaleString()
		} catch {
			return dateStr
		}
	}

	// Billing state
	const [subscription, setSubscription] = useState<{
		isPaid: boolean
		subscriptionId: string | null
		plan: string | null
		status: string
	} | null>(null)
	const [billingLoading, setBillingLoading] = useState(false)
	const [billingError, setBillingError] = useState<string | null>(null)
	const [cancelLoading, setCancelLoading] = useState(false)

	const loadSettings = useCallback(async () => {
		try {
			const data = await apiCall<{
				profile?: { bio?: string; location?: string }
				notifications?: NotificationSettings
				privacy?: PrivacySettings
			}>('/settings')
			if (data.profile) {
				setBio(data.profile.bio || '')
				setLocation(data.profile.location || '')
			}
			if (data.notifications) setNotifications(data.notifications)
			if (data.privacy) setPrivacy(data.privacy)
		} catch (_err) {
			// Use defaults if API fails
		}
	}, [])

	const loadBilling = useCallback(async () => {
		setBillingLoading(true)
		setBillingError(null)
		try {
			const data = await apiCall<{
				isPaid: boolean
				subscriptionId: string | null
				plan: string | null
				status: string
			}>('/billing/subscription-status')
			setSubscription(data)
		} catch (err) {
			setBillingError(err instanceof Error ? err.message : 'Failed to load subscription status.')
		} finally {
			setBillingLoading(false)
		}
	}, [])

	useEffect(() => {
		trackEvent('page_view_settings')
		loadSettings()
		loadBilling()
	}, [loadSettings, loadBilling])

	async function handleCancelSubscription() {
		if (
			!confirm(
				'Cancel your subscription? You will keep access until the end of the current billing period.',
			)
		)
			return
		setCancelLoading(true)
		setBillingError(null)
		try {
			const data = await apiCall<{
				cancelled: boolean
				subscriptionId: string
				status: string
				cancelAtPeriodEnd: boolean
			}>('/billing/cancel-subscription', { method: 'POST' })
			if (data.cancelled) {
				setSubscription((prev) => (prev ? { ...prev, status: 'cancelled' } : prev))
				showSaved()
			}
		} catch (err) {
			setBillingError(err instanceof Error ? err.message : 'Failed to cancel subscription.')
		} finally {
			setCancelLoading(false)
		}
	}

	function showSaved() {
		setSaved(true)
		setTimeout(() => setSaved(false), 2000)
	}

	async function handleProfileUpdate(e: FormEvent) {
		e.preventDefault()
		setSaving(true)
		setError('')
		try {
			await apiCall('/settings/profile', {
				method: 'PATCH',
				body: { name, email, bio, location },
			})
			showSaved()
			trackEvent('settings_profile_update')
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Update failed')
		} finally {
			setSaving(false)
		}
	}

	async function handlePasswordChange(e: FormEvent) {
		e.preventDefault()
		setError('')
		if (newPassword !== confirmPassword) {
			setError("Passwords don't match")
			return
		}
		if (newPassword.length < 6) {
			setError('Password must be at least 6 characters')
			return
		}
		setSaving(true)
		try {
			await apiCall('/auth/password', {
				method: 'POST',
				body: { currentPassword, newPassword },
			})
			setCurrentPassword('')
			setNewPassword('')
			setConfirmPassword('')
			showSaved()
			trackEvent('settings_password_change')
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Password change failed')
		} finally {
			setSaving(false)
		}
	}

	async function handleNotificationsUpdate() {
		setSaving(true)
		try {
			await apiCall('/settings/notifications', {
				method: 'PATCH',
				body: notifications,
			})
			showSaved()
			trackEvent('settings_notifications_update')
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Update failed')
		} finally {
			setSaving(false)
		}
	}

	async function handlePrivacyUpdate() {
		setSaving(true)
		try {
			await apiCall('/settings/privacy', {
				method: 'PATCH',
				body: privacy,
			})
			showSaved()
			trackEvent('settings_privacy_update')
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Update failed')
		} finally {
			setSaving(false)
		}
	}

	async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0]
		if (!file) return

		const formData = new FormData()
		formData.append('avatar', file)

		try {
			const data = await apiCall<{ avatar_url: string }>('/settings/avatar', {
				method: 'POST',
				body: formData as unknown as Record<string, unknown>,
				isFormData: true,
			})
			setAvatarUrl(data.avatar_url)
			showSaved()
			trackEvent('settings_avatar_upload')
		} catch (_err) {
			setError('Failed to upload avatar')
		}
	}

	async function handleDeleteAccount() {
		if (deleteConfirm !== 'DELETE') {
			setError('Type DELETE to confirm')
			return
		}
		try {
			await apiCall('/auth/delete-account', { method: 'DELETE' })
			logout()
		} catch (_err) {
			setError('Account deletion failed. Contact support.')
		}
	}

	const toggleNotification = (key: keyof NotificationSettings) => {
		setNotifications((prev) => ({ ...prev, [key]: !prev[key] }))
	}

	const togglePrivacy = (key: keyof PrivacySettings) => {
		setPrivacy((prev) => ({ ...prev, [key]: !prev[key] }))
	}

	return (
		<div className='space-y-6'>
			{/* Toast Container */}
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
							<AlertTriangle className='h-5 w-5 shrink-0 mt-0.5 text-red-600' />
						) : (
							<Globe className='h-5 w-5 shrink-0 mt-0.5 text-blue-600' />
						)}
						<p className='text-sm flex-1'>{toast.message}</p>
						<button
							onClick={() => dismissToast(toast.id)}
							className='shrink-0 text-muted-foreground hover:text-foreground min-h-[28px] min-w-[28px] flex items-center justify-center rounded'
						>
							<X className='h-4 w-4' />
						</button>
					</div>
				))}
			</div>

			{/* Header */}
			<div>
				<h1 className='font-heading text-2xl font-bold'>Settings</h1>
				<p className='text-muted-foreground'>Manage your profile, account, and preferences</p>
			</div>

			{error && (
				<div className='flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
					<AlertTriangle className='h-4 w-4 shrink-0' />
					{error}
				</div>
			)}

			{saved && (
				<div className='flex items-center gap-2 rounded-lg bg-green-100 p-3 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-400'>
					<CheckCircle className='h-4 w-4 shrink-0' />
					Changes saved successfully
				</div>
			)}

			<Tabs value={activeTab} onValueChange={setActiveTab} className='space-y-6'>
				<TabsList className='flex-wrap h-auto'>
					<TabsTrigger value='profile' className='gap-1'>
						<User className='h-4 w-4' />
						Profile
					</TabsTrigger>
					<TabsTrigger value='account' className='gap-1'>
						<Lock className='h-4 w-4' />
						Account
					</TabsTrigger>
					<TabsTrigger value='notifications' className='gap-1'>
						<Bell className='h-4 w-4' />
						Notifications
					</TabsTrigger>
					<TabsTrigger value='privacy' className='gap-1'>
						<Shield className='h-4 w-4' />
						Privacy
					</TabsTrigger>
					<TabsTrigger value='appearance' className='gap-1'>
						<Palette className='h-4 w-4' />
						Appearance
					</TabsTrigger>
					<TabsTrigger value='billing' className='gap-1'>
						<CreditCard className='h-4 w-4' />
						Billing
					</TabsTrigger>
				</TabsList>

				{/* Profile Tab */}
				<TabsContent value='profile' className='space-y-6'>
					<Card>
						<CardHeader>
							<CardTitle>Profile Information</CardTitle>
							<CardDescription>Update your public profile and personal details</CardDescription>
						</CardHeader>
						<CardContent>
							<form onSubmit={handleProfileUpdate} className='space-y-6'>
								{/* Avatar */}
								<div className='flex items-center gap-4'>
									<Avatar className='h-20 w-20'>
										<AvatarImage src={avatarUrl} alt={name} />
										<AvatarFallback className='text-2xl'>{name?.charAt(0) || '?'}</AvatarFallback>
									</Avatar>
									<div className='space-y-2'>
										<Label htmlFor='avatar-upload' className='cursor-pointer'>
											<Button type='button' variant='outline' size='sm' className='gap-1' asChild>
												<span>
													<Upload className='h-4 w-4' />
													Change Avatar
												</span>
											</Button>
										</Label>
										<input
											id='avatar-upload'
											type='file'
											accept='image/*'
											className='hidden'
											onChange={handleAvatarUpload}
										/>
										<p className='text-xs text-muted-foreground'>JPG, PNG or GIF. Max 2MB.</p>
									</div>
								</div>

								<div className='grid gap-4 sm:grid-cols-2'>
									<div className='space-y-2'>
										<Label htmlFor='name'>Full Name</Label>
										<Input
											id='name'
											value={name}
											onChange={(e) => setName(e.target.value)}
											placeholder='Your name'
										/>
									</div>
									<div className='space-y-2'>
										<Label htmlFor='email'>Email</Label>
										<Input
											id='email'
											type='email'
											value={email}
											onChange={(e) => setEmail(e.target.value)}
											placeholder='you@example.com'
										/>
									</div>
								</div>

								<div className='space-y-2'>
									<Label htmlFor='location'>Location</Label>
									<Input
										id='location'
										value={location}
										onChange={(e) => setLocation(e.target.value)}
										placeholder='City, Country'
									/>
								</div>

								<div className='space-y-2'>
									<Label htmlFor='bio'>Bio</Label>
									<textarea
										id='bio'
										value={bio}
										onChange={(e) => setBio(e.target.value)}
										placeholder='Tell us about yourself...'
										rows={4}
										className='flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
									/>
								</div>

								<div className='flex items-center justify-between'>
									<div className='flex items-center gap-2'>
										<Badge variant='outline' className='capitalize'>
											{user?.role}
										</Badge>
										<span className='text-sm text-muted-foreground'>ID: {user?.id}</span>
									</div>
									<Button type='submit' disabled={saving}>
										{saving ? 'Saving...' : 'Save Profile'}
									</Button>
								</div>
							</form>
						</CardContent>
					</Card>
				</TabsContent>

				{/* Account Tab */}
				<TabsContent value='account' className='space-y-6'>
					<Card>
						<CardHeader>
							<CardTitle>Change Password</CardTitle>
							<CardDescription>Update your password to keep your account secure</CardDescription>
						</CardHeader>
						<CardContent>
							<form onSubmit={handlePasswordChange} className='space-y-4'>
								<div className='space-y-2'>
									<Label htmlFor='current-password'>Current Password</Label>
									<div className='relative'>
										<Input
											id='current-password'
											type={showPassword ? 'text' : 'password'}
											value={currentPassword}
											onChange={(e) => setCurrentPassword(e.target.value)}
											placeholder='Enter current password'
										/>
										<Button
											type='button'
											variant='ghost'
											size='sm'
											className='absolute right-0 top-0 h-full px-3'
											onClick={() => setShowPassword(!showPassword)}
										>
											{showPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
										</Button>
									</div>
								</div>
								<div className='space-y-2'>
									<Label htmlFor='new-password'>New Password</Label>
									<Input
										id='new-password'
										type='password'
										value={newPassword}
										onChange={(e) => setNewPassword(e.target.value)}
										placeholder='Min 6 characters'
										minLength={6}
									/>
								</div>
								<div className='space-y-2'>
									<Label htmlFor='confirm-password'>Confirm New Password</Label>
									<Input
										id='confirm-password'
										type='password'
										value={confirmPassword}
										onChange={(e) => setConfirmPassword(e.target.value)}
										placeholder='Re-enter new password'
									/>
								</div>
								<Button type='submit' disabled={saving}>
									{saving ? 'Updating...' : 'Update Password'}
								</Button>
							</form>
						</CardContent>
					</Card>

					{/* Account Connections */}
					<Card>
						<CardHeader>
							<CardTitle className='flex items-center gap-2'>
								<Link className='h-5 w-5' />
								Account Connections
							</CardTitle>
							<CardDescription>
								Connect or disconnect social accounts for sign-in
							</CardDescription>
						</CardHeader>
						<CardContent className='space-y-4'>
							{connectionsLoading ? (
								<div className='flex items-center gap-2 text-muted-foreground'>
									<Loader2 className='h-4 w-4 animate-spin' />
									Loading connections...
								</div>
							) : connectionsError ? (
								<div className='flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700'>
									<AlertTriangle className='h-4 w-4 shrink-0' />
									{connectionsError}
									<Button variant='outline' size='sm' onClick={loadConnections} className='ml-auto'>
										Retry
									</Button>
								</div>
							) : (
								<div className='space-y-3'>
									{/* Google */}
									<div className='flex items-center justify-between rounded-lg border p-4'>
										<div className='flex items-center gap-3'>
											<div className='h-10 w-10 rounded-lg bg-white border flex items-center justify-center shrink-0'>
												<svg className='h-5 w-5' viewBox='0 0 24 24'>
													<path
														fill='#4285F4'
														d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z'
													/>
													<path
														fill='#34A853'
														d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
													/>
													<path
														fill='#FBBC05'
														d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'
													/>
													<path
														fill='#EA4335'
														d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'
													/>
												</svg>
											</div>
											<div>
												<p className='font-medium'>Google</p>
												{connections.find((c) => c.provider === 'google') ? (
													<div className='text-xs text-muted-foreground space-y-0.5'>
														<p className='flex items-center gap-1 text-emerald-600'>
															<CheckCircle className='h-3 w-3' />
															Connected
														</p>
														{connections.find((c) => c.provider === 'google')?.email && (
															<p>{connections.find((c) => c.provider === 'google')?.email}</p>
														)}
													</div>
												) : (
													<p className='text-xs text-muted-foreground'>Not connected</p>
												)}
											</div>
										</div>
										{connections.find((c) => c.provider === 'google') ? (
											<Button
												variant='outline'
												size='sm'
												onClick={() => setConfirmDisconnectProvider('google')}
												disabled={disconnectingProvider === 'google'}
												className='gap-1 shrink-0'
											>
												{disconnectingProvider === 'google' ? (
													<Loader2 className='h-3.5 w-3.5 animate-spin' />
												) : (
													<Link2Off className='h-3.5 w-3.5' />
												)}
												Disconnect
											</Button>
										) : (
											<Button
												size='sm'
												onClick={() => handleConnectProvider('google')}
												className='gap-1 bg-indigo-600 hover:bg-indigo-700 shrink-0'
											>
												<Link className='h-3.5 w-3.5' />
												Connect
											</Button>
										)}
									</div>

									{/* LinkedIn */}
									<div className='flex items-center justify-between rounded-lg border p-4'>
										<div className='flex items-center gap-3'>
											<div className='h-10 w-10 rounded-lg bg-[#0A66C2] flex items-center justify-center shrink-0'>
												<Linkedin className='h-5 w-5 text-white' />
											</div>
											<div>
												<p className='font-medium'>LinkedIn</p>
												{connections.find((c) => c.provider === 'linkedin') ? (
													<div className='text-xs text-muted-foreground space-y-0.5'>
														<p className='flex items-center gap-1 text-emerald-600'>
															<CheckCircle className='h-3 w-3' />
															Connected
														</p>
														{connections.find((c) => c.provider === 'linkedin')?.email && (
															<p>{connections.find((c) => c.provider === 'linkedin')?.email}</p>
														)}
														{connections.find((c) => c.provider === 'linkedin')?.last_sync && (
															<p>
																Last sync:{' '}
																{formatDate(connections.find((c) => c.provider === 'linkedin')?.last_sync)}
															</p>
														)}
													</div>
												) : (
													<p className='text-xs text-muted-foreground'>Not connected</p>
												)}
											</div>
										</div>
										{connections.find((c) => c.provider === 'linkedin') ? (
											<Button
												variant='outline'
												size='sm'
												onClick={() => setConfirmDisconnectProvider('linkedin')}
												disabled={disconnectingProvider === 'linkedin'}
												className='gap-1 shrink-0'
											>
												{disconnectingProvider === 'linkedin' ? (
													<Loader2 className='h-3.5 w-3.5 animate-spin' />
												) : (
													<Link2Off className='h-3.5 w-3.5' />
												)}
												Disconnect
											</Button>
										) : (
											<Button
												size='sm'
												onClick={() => handleConnectProvider('linkedin')}
												className='gap-1 bg-indigo-600 hover:bg-indigo-700 shrink-0'
											>
												<Link className='h-3.5 w-3.5' />
												Connect
											</Button>
										)}
									</div>

									{!hasPassword && connections.length > 0 && (
										<div className='rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2 text-sm text-amber-800'>
											<AlertTriangle className='h-4 w-4 shrink-0 mt-0.5 text-amber-600' />
											<p>
												You have not set a password. If you disconnect all social accounts, you will
												lose access to your account.
											</p>
										</div>
									)}
								</div>
							)}

							{/* Disconnect Confirmation Dialog */}
							<Dialog
								open={!!confirmDisconnectProvider}
								onOpenChange={(open) => !open && setConfirmDisconnectProvider(null)}
							>
								<DialogContent>
									<DialogHeader>
										<DialogTitle className='flex items-center gap-2'>
											<Link2Off className='h-5 w-5 text-red-600' />
											Disconnect {confirmDisconnectProvider?.charAt(0).toUpperCase()}
											{confirmDisconnectProvider?.slice(1)}
										</DialogTitle>
										<DialogDescription>
											Are you sure you want to disconnect your{' '}
											{confirmDisconnectProvider} account? You will no longer be able to sign in
											with it.
											{!hasPassword && connections.length === 1 && (
												<span className='block mt-1 text-red-600 font-medium'>
													Warning: This is your only sign-in method. Please set a password first
													or you will be locked out.
												</span>
											)}
										</DialogDescription>
									</DialogHeader>
									<DialogFooter>
										<Button
											variant='outline'
											onClick={() => setConfirmDisconnectProvider(null)}
											disabled={!!disconnectingProvider}
										>
											Cancel
										</Button>
										<Button
											variant='destructive'
											onClick={() =>
												confirmDisconnectProvider && handleDisconnectProvider(confirmDisconnectProvider)
											}
											disabled={!!disconnectingProvider}
										>
											{disconnectingProvider === confirmDisconnectProvider ? (
												<>
													<Loader2 className='h-4 w-4 animate-spin' />
													Disconnecting...
												</>
											) : (
												<>
													<Link2Off className='h-4 w-4' />
													Disconnect
												</>
											)}
										</Button>
									</DialogFooter>
								</DialogContent>
							</Dialog>
						</CardContent>
					</Card>

					<Card className='border-destructive/50'>
						<CardHeader>
							<CardTitle className='text-destructive'>Danger Zone</CardTitle>
							<CardDescription>Irreversible actions for your account</CardDescription>
						</CardHeader>
						<CardContent className='space-y-4'>
							<div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
								<div className='space-y-1'>
									<p className='font-medium'>Delete Account</p>
									<p className='text-sm text-muted-foreground'>
										Permanently delete your account and all data. This cannot be undone.
									</p>
								</div>
								<Button variant='destructive' size='sm' onClick={() => setShowDeleteDialog(true)}>
									<Trash2 className='h-4 w-4 mr-1' />
									Delete
								</Button>
							</div>

							{showDeleteDialog && (
								<div className='rounded-lg border border-destructive/50 p-4 space-y-4'>
									<div className='flex items-center gap-2 text-destructive'>
										<AlertTriangle className='h-5 w-5' />
										<p className='font-medium'>This action is permanent</p>
									</div>
									<p className='text-sm text-muted-foreground'>
										Type <strong>DELETE</strong> to confirm account deletion.
									</p>
									<Input
										value={deleteConfirm}
										onChange={(e) => setDeleteConfirm(e.target.value)}
										placeholder='Type DELETE'
									/>
									<div className='flex gap-2'>
										<Button variant='outline' size='sm' onClick={() => setShowDeleteDialog(false)}>
											Cancel
										</Button>
										<Button variant='destructive' size='sm' onClick={handleDeleteAccount}>
											<Trash2 className='h-4 w-4 mr-1' />
											Permanently Delete
										</Button>
									</div>
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				{/* Notifications Tab */}
				<TabsContent value='notifications' className='space-y-6'>
					<Card>
						<CardHeader>
							<CardTitle>Email Notifications</CardTitle>
							<CardDescription>Choose what you want to be notified about via email</CardDescription>
						</CardHeader>
						<CardContent className='space-y-4'>
							{[
								{
									key: 'email_jobs' as const,
									label: 'New job matches',
									desc: 'When new jobs matching your profile are posted',
								},
								{
									key: 'email_applications' as const,
									label: 'Application updates',
									desc: 'When your application status changes',
								},
								{
									key: 'email_messages' as const,
									label: 'Messages',
									desc: 'When you receive a new message from a recruiter',
								},
								{
									key: 'email_marketing' as const,
									label: 'Marketing & tips',
									desc: 'Career tips, product updates, and promotions',
								},
							].map((item) => (
								<div key={item.key} className='flex items-center justify-between'>
									<div className='space-y-0.5'>
										<p className='font-medium'>{item.label}</p>
										<p className='text-sm text-muted-foreground'>{item.desc}</p>
									</div>
									<button
										type='button'
										onClick={() => toggleNotification(item.key)}
										className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
											notifications[item.key] ? 'bg-primary' : 'bg-muted-foreground/30'
										}`}
									>
										<span
											className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
												notifications[item.key] ? 'translate-x-6' : 'translate-x-1'
											}`}
										/>
									</button>
								</div>
							))}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Push Notifications</CardTitle>
							<CardDescription>Real-time alerts in your browser</CardDescription>
						</CardHeader>
						<CardContent className='space-y-4'>
							{[
								{
									key: 'push_jobs' as const,
									label: 'Job alerts',
									desc: 'Instant alerts for new job matches',
								},
								{
									key: 'push_messages' as const,
									label: 'Messages',
									desc: 'When someone messages you',
								},
								{
									key: 'push_reminders' as const,
									label: 'Reminders',
									desc: 'Interview and deadline reminders',
								},
							].map((item) => (
								<div key={item.key} className='flex items-center justify-between'>
									<div className='space-y-0.5'>
										<p className='font-medium'>{item.label}</p>
										<p className='text-sm text-muted-foreground'>{item.desc}</p>
									</div>
									<button
										type='button'
										onClick={() => toggleNotification(item.key)}
										className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
											notifications[item.key] ? 'bg-primary' : 'bg-muted-foreground/30'
										}`}
									>
										<span
											className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
												notifications[item.key] ? 'translate-x-6' : 'translate-x-1'
											}`}
										/>
									</button>
								</div>
							))}
						</CardContent>
					</Card>

					<Button onClick={handleNotificationsUpdate} disabled={saving}>
						{saving ? 'Saving...' : 'Save Notification Preferences'}
					</Button>
				</TabsContent>

				{/* Privacy Tab */}
				<TabsContent value='privacy' className='space-y-6'>
					<Card>
						<CardHeader>
							<CardTitle>Privacy Settings</CardTitle>
							<CardDescription>
								Control who can see your information and how it's used
							</CardDescription>
						</CardHeader>
						<CardContent className='space-y-4'>
							{[
								{
									key: 'profile_visible' as const,
									label: 'Public profile',
									desc: 'Allow recruiters to view your profile and contact you',
								},
								{
									key: 'allow_messages' as const,
									label: 'Receive messages',
									desc: 'Allow recruiters to send you direct messages',
								},
								{
									key: 'share_analytics' as const,
									label: 'Share usage data',
									desc: 'Help us improve by sharing anonymous usage data',
								},
							].map((item) => (
								<div key={item.key} className='flex items-center justify-between'>
									<div className='space-y-0.5'>
										<p className='font-medium'>{item.label}</p>
										<p className='text-sm text-muted-foreground'>{item.desc}</p>
									</div>
									<button
										type='button'
										onClick={() => togglePrivacy(item.key)}
										className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
											privacy[item.key] ? 'bg-primary' : 'bg-muted-foreground/30'
										}`}
									>
										<span
											className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
												privacy[item.key] ? 'translate-x-6' : 'translate-x-1'
											}`}
										/>
									</button>
								</div>
							))}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Data Export</CardTitle>
							<CardDescription>Download a copy of your data</CardDescription>
						</CardHeader>
						<CardContent>
							<p className='text-sm text-muted-foreground mb-4'>
								Get a complete copy of your profile, applications, messages, and documents in a
								portable format.
							</p>
							<Button variant='outline' className='gap-1'>
								<Download className='h-4 w-4' />
								Export My Data (JSON)
							</Button>
						</CardContent>
					</Card>

					<Button onClick={handlePrivacyUpdate} disabled={saving}>
						{saving ? 'Saving...' : 'Save Privacy Settings'}
					</Button>
				</TabsContent>

				{/* Appearance Tab */}
				<TabsContent value='appearance' className='space-y-6'>
					<Card>
						<CardHeader>
							<CardTitle>Theme</CardTitle>
							<CardDescription>Choose your preferred appearance</CardDescription>
						</CardHeader>
						<CardContent>
							<div className='grid grid-cols-1 sm:grid-cols-3 gap-4'>
								<button
									type='button'
									onClick={() => setTheme('light')}
									className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
										theme === 'light'
											? 'border-primary bg-primary/5'
											: 'border-border hover:bg-muted'
									}`}
								>
									<Sun className='h-8 w-8' />
									<span className='font-medium'>Light</span>
								</button>
								<button
									type='button'
									onClick={() => setTheme('dark')}
									className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
										theme === 'dark'
											? 'border-primary bg-primary/5'
											: 'border-border hover:bg-muted'
									}`}
								>
									<Moon className='h-8 w-8' />
									<span className='font-medium'>Dark</span>
								</button>
								<button
									type='button'
									onClick={() => {
										const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
											? 'dark'
											: 'light'
										setTheme(systemTheme)
									}}
									className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
										theme ===
										(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
											? 'border-border hover:bg-muted'
											: 'border-border hover:bg-muted'
									}`}
								>
									<Monitor className='h-8 w-8' />
									<span className='font-medium'>System</span>
								</button>
							</div>
						</CardContent>
					</Card>
				</TabsContent>

				{/* Billing Tab */}
				<TabsContent value='billing' className='space-y-6'>
					<Card>
						<CardHeader>
							<CardTitle>Subscription</CardTitle>
							<CardDescription>Manage your Rekrut AI plan and billing</CardDescription>
						</CardHeader>
						<CardContent className='space-y-4'>
							{billingLoading ? (
								<div className='flex items-center gap-2 text-muted-foreground'>
									<Loader2 className='h-4 w-4 animate-spin' />
									Loading subscription...
								</div>
							) : billingError ? (
								<div className='flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
									<AlertTriangle className='h-4 w-4 shrink-0' />
									{billingError}
								</div>
							) : subscription?.isPaid ? (
								<div className='space-y-4'>
									<div className='grid gap-2 sm:grid-cols-2'>
										<div className='space-y-1'>
											<p className='text-sm text-muted-foreground'>Plan</p>
											<p className='font-medium capitalize'>{subscription.plan || 'Custom'}</p>
										</div>
										<div className='space-y-1'>
											<p className='text-sm text-muted-foreground'>Status</p>
											<Badge variant={subscription.status === 'active' ? 'default' : 'secondary'}>
												{subscription.status}
											</Badge>
										</div>
										<div className='space-y-1'>
											<p className='text-sm text-muted-foreground'>Subscription ID</p>
											<p className='font-mono text-xs'>{subscription.subscriptionId}</p>
										</div>
									</div>
									<div className='flex items-center gap-2'>
										<Button variant='outline' onClick={loadBilling} disabled={billingLoading}>
											Refresh
										</Button>
										<Button
											variant='destructive'
											onClick={handleCancelSubscription}
											disabled={cancelLoading || subscription.status === 'cancelled'}
										>
											{cancelLoading ? (
												<>
													<Loader2 className='h-4 w-4 mr-1 animate-spin' />
													Cancelling...
												</>
											) : subscription.status === 'cancelled' ? (
												'Cancelled'
											) : (
												'Cancel Subscription'
											)}
										</Button>
									</div>
								</div>
							) : (
								<div className='space-y-4'>
									<p className='text-sm text-muted-foreground'>
										You are on the free plan. Upgrade to unlock premium features.
									</p>
									<Button asChild>
										<a href='/pricing'>View Plans</a>
									</Button>
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	)
}
