import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth, getDashboardPath } from '@/contexts/auth-context'
import { ErrorBoundary } from '@/components/error-boundary'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { LandingPage } from '@/pages/landing'
import { LoginPage } from '@/pages/login'
import { RegisterPage } from '@/pages/register'
import { CandidateDashboard } from '@/pages/candidate/dashboard'
import { RecruiterDashboard } from '@/pages/recruiter/dashboard'
import { PlaceholderPage } from '@/pages/placeholder'

// Jobs
import { CandidateJobsPage } from '@/pages/candidate/jobs'
import { CandidateJobDetailPage } from '@/pages/candidate/job-detail'
import { RecruiterJobsPage } from '@/pages/recruiter/jobs'
import { RecruiterJobFormPage } from '@/pages/recruiter/job-form'
import { RecruiterJobApplicantsPage } from '@/pages/recruiter/job-applicants'

// Applications
import { CandidateApplicationsPage } from '@/pages/candidate/applications'
import { RecruiterApplicationsPage } from '@/pages/recruiter/applications'

// Assessments
import { CandidateAssessmentsPage } from '@/pages/candidate/assessments'
import { AssessmentTakePage } from '@/pages/candidate/assessment-take'

// Offers
import { CandidateOffersPage } from '@/pages/candidate/offers'
import { RecruiterOffersPage } from '@/pages/recruiter/offers'

// Recruiter Assessments
import { RecruiterAssessmentsPage } from '@/pages/recruiter/assessments'

// Profiles
import { CandidateProfilePage } from '@/pages/candidate/profile'
import { RecruiterCompanyPage } from '@/pages/recruiter/company'

// Interviews
import { CandidateInterviewsPage } from '@/pages/candidate/interviews'
import { RecruiterInterviewsPage } from '@/pages/recruiter/interviews'

// Onboarding
import { CandidateOnboardingPage } from '@/pages/candidate/onboarding'
import { RecruiterOnboardingPage } from '@/pages/recruiter/onboarding'

// Payroll
import { CandidatePayrollPage } from '@/pages/candidate/payroll'
import { RecruiterPayrollPage } from '@/pages/recruiter/payroll'

// AI Coaching
import { AiCoachingPage } from '@/pages/candidate/ai-coaching'

// OmniScore (Two-Sided Scoring)
import { CandidateOmniScorePage } from '@/pages/candidate/omniscore'
import { RecruiterOmniScorePage } from '@/pages/recruiter/omniscore'

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
        <Route path="jobs" element={<CandidateJobsPage />} />
        <Route path="jobs/:id" element={<CandidateJobDetailPage />} />
        <Route path="applications" element={<CandidateApplicationsPage />} />
        <Route path="profile" element={<CandidateProfilePage />} />
        <Route path="assessments" element={<CandidateAssessmentsPage />} />
        <Route path="assessments/:id/take" element={<AssessmentTakePage />} />
        <Route path="interviews" element={<CandidateInterviewsPage />} />
        <Route path="ai-coaching" element={<AiCoachingPage />} />
        <Route path="omniscore" element={<CandidateOmniScorePage />} />
        <Route path="documents" element={<PlaceholderPage />} />
        <Route path="offers" element={<CandidateOffersPage />} />
        <Route path="onboarding" element={<CandidateOnboardingPage />} />
        <Route path="payroll" element={<CandidatePayrollPage />} />
      </Route>

      {/* Recruiter routes */}
      <Route path="/recruiter" element={<DashboardLayout />}>
        <Route index element={<RecruiterDashboard />} />
        <Route path="jobs" element={<RecruiterJobsPage />} />
        <Route path="jobs/new" element={<RecruiterJobFormPage />} />
        <Route path="jobs/:id/applicants" element={<RecruiterJobApplicantsPage />} />
        <Route path="jobs/:id/edit" element={<RecruiterJobFormPage />} />
        <Route path="jobs/:id" element={<RecruiterJobApplicantsPage />} />
        <Route path="applications" element={<RecruiterApplicationsPage />} />
        <Route path="assessments" element={<RecruiterAssessmentsPage />} />
        <Route path="candidates" element={<PlaceholderPage />} />
        <Route path="interviews" element={<RecruiterInterviewsPage />} />
        <Route path="offers" element={<RecruiterOffersPage />} />
        <Route path="onboarding" element={<RecruiterOnboardingPage />} />
        <Route path="analytics" element={<PlaceholderPage />} />
        <Route path="company" element={<RecruiterCompanyPage />} />
        <Route path="payroll" element={<RecruiterPayrollPage />} />
        <Route path="omniscore" element={<RecruiterOmniScorePage />} />
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
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
