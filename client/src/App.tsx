import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth, getDashboardPath } from '@/contexts/auth-context'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { LandingPage } from '@/pages/landing'
import { LoginPage } from '@/pages/login'
import { RegisterPage } from '@/pages/register'
import { CandidateDashboard } from '@/pages/candidate/dashboard'
import { RecruiterDashboard } from '@/pages/recruiter/dashboard'
import { PlaceholderPage } from '@/pages/placeholder'

function RoleRedirect() {
  const { user, loading } = useAuth()

  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={getDashboardPath(user.role)} replace />
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Auto-redirect based on role */}
      <Route path="/dashboard" element={<RoleRedirect />} />

      {/* Candidate routes */}
      <Route path="/candidate" element={<DashboardLayout />}>
        <Route index element={<CandidateDashboard />} />
        <Route path="jobs" element={<PlaceholderPage />} />
        <Route path="jobs/:id" element={<PlaceholderPage />} />
        <Route path="applications" element={<PlaceholderPage />} />
        <Route path="profile" element={<PlaceholderPage />} />
        <Route path="assessments" element={<PlaceholderPage />} />
        <Route path="interviews" element={<PlaceholderPage />} />
        <Route path="omniscore" element={<PlaceholderPage />} />
        <Route path="documents" element={<PlaceholderPage />} />
      </Route>

      {/* Recruiter routes */}
      <Route path="/recruiter" element={<DashboardLayout />}>
        <Route index element={<RecruiterDashboard />} />
        <Route path="jobs" element={<PlaceholderPage />} />
        <Route path="jobs/new" element={<PlaceholderPage />} />
        <Route path="jobs/:id" element={<PlaceholderPage />} />
        <Route path="applications" element={<PlaceholderPage />} />
        <Route path="applications/:id" element={<PlaceholderPage />} />
        <Route path="candidates" element={<PlaceholderPage />} />
        <Route path="interviews" element={<PlaceholderPage />} />
        <Route path="offers" element={<PlaceholderPage />} />
        <Route path="onboarding" element={<PlaceholderPage />} />
        <Route path="analytics" element={<PlaceholderPage />} />
        <Route path="company" element={<PlaceholderPage />} />
        <Route path="payroll" element={<PlaceholderPage />} />
      </Route>

      {/* Settings */}
      <Route path="/settings" element={<DashboardLayout />}>
        <Route index element={<PlaceholderPage />} />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
