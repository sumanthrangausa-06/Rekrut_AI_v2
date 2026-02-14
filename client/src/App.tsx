import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth, getDashboardPath } from '@/contexts/auth-context'
import { ErrorBoundary, RouteErrorBoundary } from '@/components/error-boundary'
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
import { JobAssessmentTakePage } from '@/pages/candidate/job-assessment-take'

// Offers
import { CandidateOffersPage } from '@/pages/candidate/offers'
import { RecruiterOffersPage } from '@/pages/recruiter/offers'

// Recruiter Assessments
import { RecruiterAssessmentsPage } from '@/pages/recruiter/assessments'
import { RecruiterJobAssessmentPage } from '@/pages/recruiter/job-assessment'

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

// Camera Test (isolation debugging)
import { TestCameraPage } from '@/pages/test-camera'

// AI Screening (public - candidate completes via invite link)
import { CandidateScreeningPage } from '@/pages/candidate/screening'

// Debug Pages
import { MockInterviewDebugPage } from '@/pages/debug/mock-interview'

// Admin
import { AdminLoginPage } from '@/pages/admin/login'
import { AdminAuthGuard } from '@/components/admin-auth-guard'
import { AiHealthPage } from '@/pages/admin/ai-health'

// Helper: wrap a page element with RouteErrorBoundary
function Safe({ children }: { children: React.ReactNode }) {
  return <RouteErrorBoundary>{children}</RouteErrorBoundary>
}

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
      <Route path="/test-camera" element={<TestCameraPage />} />
      <Route path="/screening/:token" element={<CandidateScreeningPage />} />

      {/* Auto-redirect based on role */}
      <Route path="/dashboard" element={<RoleRedirect />} />

      {/* Candidate routes */}
      <Route path="/candidate" element={<DashboardLayout />}>
        <Route index element={<Safe><CandidateDashboard /></Safe>} />
        <Route path="jobs" element={<Safe><CandidateJobsPage /></Safe>} />
        <Route path="jobs/:id" element={<Safe><CandidateJobDetailPage /></Safe>} />
        <Route path="applications" element={<Safe><CandidateApplicationsPage /></Safe>} />
        <Route path="profile" element={<Safe><CandidateProfilePage /></Safe>} />
        <Route path="assessments" element={<Safe><CandidateAssessmentsPage /></Safe>} />
        <Route path="assessments/:id/take" element={<Safe><AssessmentTakePage /></Safe>} />
        <Route path="job-assessment/:id" element={<Safe><JobAssessmentTakePage /></Safe>} />
        <Route path="interviews" element={<Safe><CandidateInterviewsPage /></Safe>} />
        <Route path="ai-coaching" element={<Safe><AiCoachingPage /></Safe>} />
        <Route path="omniscore" element={<Safe><CandidateOmniScorePage /></Safe>} />
        <Route path="documents" element={<Safe><PlaceholderPage /></Safe>} />
        <Route path="offers" element={<Safe><CandidateOffersPage /></Safe>} />
        <Route path="onboarding" element={<Safe><CandidateOnboardingPage /></Safe>} />
        <Route path="payroll" element={<Safe><CandidatePayrollPage /></Safe>} />
      </Route>

      {/* Recruiter routes */}
      <Route path="/recruiter" element={<DashboardLayout />}>
        <Route index element={<Safe><RecruiterDashboard /></Safe>} />
        <Route path="jobs" element={<Safe><RecruiterJobsPage /></Safe>} />
        <Route path="jobs/new" element={<Safe><RecruiterJobFormPage /></Safe>} />
        <Route path="jobs/:id/applicants" element={<Safe><RecruiterJobApplicantsPage /></Safe>} />
        <Route path="jobs/:id/edit" element={<Safe><RecruiterJobFormPage /></Safe>} />
        <Route path="jobs/:id" element={<Safe><RecruiterJobApplicantsPage /></Safe>} />
        <Route path="jobs/:id/assessment" element={<Safe><RecruiterJobAssessmentPage /></Safe>} />
        <Route path="applications" element={<Safe><RecruiterApplicationsPage /></Safe>} />
        <Route path="assessments" element={<Safe><RecruiterAssessmentsPage /></Safe>} />
        <Route path="candidates" element={<Safe><PlaceholderPage /></Safe>} />
        <Route path="interviews" element={<Safe><RecruiterInterviewsPage /></Safe>} />
        <Route path="offers" element={<Safe><RecruiterOffersPage /></Safe>} />
        <Route path="onboarding" element={<Safe><RecruiterOnboardingPage /></Safe>} />
        <Route path="analytics" element={<Safe><PlaceholderPage /></Safe>} />
        <Route path="company" element={<Safe><RecruiterCompanyPage /></Safe>} />
        <Route path="payroll" element={<Safe><RecruiterPayrollPage /></Safe>} />
        <Route path="omniscore" element={<Safe><RecruiterOmniScorePage /></Safe>} />
      </Route>

      {/* Settings */}
      <Route path="/settings" element={<DashboardLayout />}>
        <Route index element={<Safe><PlaceholderPage /></Safe>} />
      </Route>

      {/* Debug routes */}
      <Route path="/debug/mock-interview" element={<Safe><MockInterviewDebugPage /></Safe>} />

      {/* Admin routes — login is public, everything else requires auth */}
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin/ai-health" element={<AdminAuthGuard><AiHealthPage /></AdminAuthGuard>} />

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
