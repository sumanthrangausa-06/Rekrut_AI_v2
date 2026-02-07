import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import {
  apiCall,
  setTokens,
  clearTokens,
  getToken,
  getDashboardPath,
  isRecruiterRole,
  type User,
  type UserRole,
} from '@/lib/api'

interface AuthContextType {
  user: User | null
  loading: boolean
  isAuthenticated: boolean
  isRecruiter: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterData) => Promise<void>
  logout: () => void
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
  const [loading, setLoading] = useState(true)

  const checkAuth = useCallback(async () => {
    const token = getToken()
    if (!token) {
      setLoading(false)
      return
    }

    try {
      const data = await apiCall<{ user: User }>('/auth/me')
      setUser(data.user)
    } catch {
      clearTokens()
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

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
    })

    setTokens(data.accessToken || data.token, data.refreshToken)
    setUser(data.user)
  }

  const register = async (registerData: RegisterData) => {
    const data = await apiCall<{
      success: boolean
      user: User
      accessToken: string
      refreshToken: string
      token: string
    }>('/auth/register', {
      method: 'POST',
      body: registerData,
    })

    setTokens(data.accessToken || data.token, data.refreshToken)
    setUser(data.user)
  }

  const logout = () => {
    clearTokens()
    setUser(null)
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        isRecruiter: user ? isRecruiterRole(user.role) : false,
        login,
        register,
        logout,
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
