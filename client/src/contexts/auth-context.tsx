import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import {
	apiCall,
	clearTokens,
	getDashboardPath,
	getToken,
	isRecruiterRole,
	setTokens,
	startAuthRefresh,
	type User,
	type UserRole,
} from '@/lib/api'

interface AuthContextType {
	user: User | null
	loading: boolean
	isAuthenticated: boolean
	isRecruiter: boolean
	isPendingApproval: boolean
	login: (email: string, password: string) => Promise<void>
	register: (data: RegisterData) => Promise<void>
	logout: () => void
	refreshSubscription: () => Promise<void>
	refreshUser: () => Promise<void>
}

interface RegisterData {
	email: string
	password: string
	name: string
	role: UserRole
	company_name?: string
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null)
	const [loading, setLoading] = useState(true) // Start with true for initial auth check

	// Check auth on initial load — verify token if it exists in localStorage
	useEffect(() => {
		const token = getToken()
		if (!token) {
			setLoading(false)
			return
		}

		// Verify token by fetching current user
		apiCall<{ user: User }>('/auth/me', { skipAuthCheck: false })
			.then((data) => {
				const user = data.user
				// Set user immediately with default tier so auth state resolves fast.
				// Billing tier is fetched in the background and patched in when ready.
				// Root cause (#105): awaiting /billing/tier sequentially before setUser blocked
				// the redirect by 500-2000ms on every login and app load.
				user.subscriptionTier = 'free'
				setUser(user)
				startAuthRefresh()

				// Fetch subscription tier in the background — non-blocking
				apiCall<{ tier: 'free' | 'pro' }>('/billing/tier', { skipAuthCheck: false })
					.then((tierData) => {
						setUser((prev) => (prev ? { ...prev, subscriptionTier: tierData.tier } : prev))
					})
					.catch(() => {
						// Tier endpoint may fail if billing is not configured — default already set
					})
			})
			.catch(() => {
				// Token invalid or expired — clear it
				clearTokens()
			})
			.finally(() => {
				setLoading(false)
			})
	}, [])

	const isPendingApproval = (u: User | null): boolean => {
		return u ? isRecruiterRole(u.role) && !u.company_id : false
	}

	const refreshUser = async () => {
		try {
			const data = await apiCall<{ user: User }>('/auth/me', { skipAuthCheck: false })
			const refreshedUser = data.user
			refreshedUser.subscriptionTier = user?.subscriptionTier || 'free'
			setUser(refreshedUser)
		} catch {
			// Silently ignore — user may have been logged out
		}
	}

	const login = async (email: string, password: string) => {
		const data = await apiCall<{
			success: boolean
			user: User
			accessToken: string
			refreshToken: string
			token: string
		}>('/auth/login', {
			method: 'POST',
			body: { email, password },
			skipAuthCheck: true,
		})

		const user = data.user
		// Set tokens and user immediately so the redirect is not blocked by
		// a secondary API call. Default tier to 'free'; background fetch
		// patches the real tier when it arrives.
		// Root cause (#105): awaiting /billing/tier before setTokens/setUser
		// added 500-2000ms of blocking latency to every login.
		user.subscriptionTier = 'free'
		setTokens(data.accessToken || data.token, data.refreshToken)
		setUser(user)

		// Fetch subscription tier in the background — non-blocking
		apiCall<{ tier: 'free' | 'pro' }>('/billing/tier', { skipAuthCheck: false })
			.then((tierData) => {
				setUser((prev) => (prev ? { ...prev, subscriptionTier: tierData.tier } : prev))
			})
			.catch(() => {
				// Tier endpoint may fail if billing is not configured — default already set
			})
	}

	const register = async (registerData: RegisterData) => {
		const data = await apiCall<{
			success: boolean
			user: User
			accessToken: string
			refreshToken: string
			token: string
			pending_approval?: boolean
			message?: string
			company?: { id: number; name: string; slug: string }
		}>('/auth/register', {
			method: 'POST',
			body: registerData,
			skipAuthCheck: true,
		})

		// Handle pending approval workflow (Issue #103)
		if (data.pending_approval) {
			// Still store tokens so user can log in and see pending status
			setTokens(data.accessToken || data.token, data.refreshToken)
			const user = data.user
			user.subscriptionTier = 'free'
			setUser(user)
			// Throw with a clear message so UI can show pending approval state
			const err = new Error(
				data.message || 'Your registration is pending approval from the company administrator.',
			)
			;(err as Error & { code?: string; pendingApproval?: boolean }).code = 'PENDING_APPROVAL'
			;(err as Error & { code?: string; pendingApproval?: boolean }).pendingApproval = true
			throw err
		}

		const user = data.user
		// Set tokens and user immediately so the redirect is not blocked by
		// a secondary API call. Default tier to 'free'; background fetch
		// patches the real tier when it arrives.
		// Root cause (#105): awaiting /billing/tier before setTokens/setUser
		// added 500-2000ms of blocking latency to every signup.
		user.subscriptionTier = 'free'
		setTokens(data.accessToken || data.token, data.refreshToken)
		setUser(user)

		// Fetch subscription tier in the background — non-blocking
		apiCall<{ tier: 'free' | 'pro' }>('/billing/tier', { skipAuthCheck: false })
			.then((tierData) => {
				setUser((prev) => (prev ? { ...prev, subscriptionTier: tierData.tier } : prev))
			})
			.catch(() => {
				// Tier endpoint may fail if billing is not configured — default already set
			})
	}

	const logout = () => {
		clearTokens()
		setUser(null)
		window.location.href = '/login'
	}

	const refreshSubscription = async () => {
		if (!user) return
		try {
			const tierData = await apiCall<{ tier: 'free' | 'pro' }>('/billing/tier', { skipAuthCheck: false })
			setUser({ ...user, subscriptionTier: tierData.tier })
		} catch {
			setUser({ ...user, subscriptionTier: 'free' })
		}
	}

	return (
		<AuthContext.Provider
			value={{
				user,
				loading,
				isAuthenticated: !!user,
				isRecruiter: user ? isRecruiterRole(user.role) : false,
				isPendingApproval: isPendingApproval(user),
				login,
				register,
				logout,
				refreshSubscription,
				refreshUser,
			}}
		>
			{children}
		</AuthContext.Provider>
	)
}

export function useAuth() {
	const context = useContext(AuthContext)
	if (!context) {
		throw new Error('useAuth must be used within AuthProvider')
	}
	return context
}

export { getDashboardPath }
