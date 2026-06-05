import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth, getDashboardPath } from '@/contexts/auth-context'
import { ErrorBoundary, RouteErrorBoundary } from '@/components/error-boundary'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { LandingPage } from '@/pages/landing'
import { LoginPage } from '@/pages/login'
import { RegisterPage } from '@/pages/register'
import { ForgotPasswordPage } from '@/pages/forgot-password'
import { ResetPasswordPage } from '@/pages/reset-password'
import { NotFoundPage } from '@/pages/not-found'
import { CandidateDashboard } from '@/pages/candidate/dashboard'
import { RecruiterDashboard } from '@/pages/recruiter/dashboard'
import { PlaceholderPage } from '@/pages/placeholder'
import { RecruiterAnalyticsPage } from '@/pages/recruiter/analytics'
import { PricingPage } from '@/pages/pricing'

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
import { RevenuePage } from '@/pages/admin/revenue'
import { AdminAgentsDashboardPage } from '@/pages/admin/agents'
import { AgentDashboardPage } from '@/pages/admin/agent-dashboard'
import { AdminCompliancePage } from '@/pages/admin/compliance'

// Chat
import { CandidateChatPage } from '@/pages/candidate/chat'
import { RecruiterChatPage } from '@/pages/recruiter/chat'

// Public Company
import { PublicCompanyPage } from '@/pages/recruiter/public-company'

// Career Page
import { RecruiterCareerPage } from '@/pages/recruiter/career-page'

// Settings page
import { SettingsPage } from '@/pages/settings'

// New domain pages (replace placeholders)
import { CandidateDocumentsPage } from '@/pages/candidate/documents'
import { RecruiterCandidatesPage } from '@/pages/recruiter/candidates'
import { RecruiterScreeningPage } from '@/pages/recruiter/screening'

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
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/test-camera" element={<TestCameraPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/screening/:token" element={<CandidateScreeningPage />} />

      {/* Public company profile */}
      <Route path="/company/:slug" element={<Safe><PublicCompanyPage /></Safe>} />
      <Route path="/careers/:company" element={<Safe><RecruiterCareerPage /></Safe>} />

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
        <Route path="documents" element={<Safe><CandidateDocumentsPage /></Safe>} />
        <Route path="chat" element={<Safe><CandidateChatPage /></Safe>} />
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
        <Route path="candidates" element={<Safe><RecruiterCandidatesPage /></Safe>} />
        <Route path="screening" element={<Safe><RecruiterScreeningPage /></Safe>} />
        <Route path="chat" element={<Safe><RecruiterChatPage /></Safe>} />
        <Route path="career-page" element={<Safe><RecruiterCareerPage /></Safe>} />
        <Route path="interviews" element={<Safe><RecruiterInterviewsPage /></Safe>} />
        <Route path="offers" element={<Safe><RecruiterOffersPage /></Safe>} />
        <Route path="onboarding" element={<Safe><RecruiterOnboardingPage /></Safe>} />
        <Route path="analytics" element={<Safe><RecruiterAnalyticsPage /></Safe>} />
        <Route path="company" element={<Safe><RecruiterCompanyPage /></Safe>} />
        <Route path="payroll" element={<Safe><RecruiterPayrollPage /></Safe>} />
        <Route path="omniscore" element={<Safe><RecruiterOmniScorePage /></Safe>} />
      </Route>

      {/* Settings */}
      <Route path="/settings" element={<DashboardLayout />}>
        <Route index element={<Safe><SettingsPage /></Safe>} />
      </Route>

      {/* Debug routes */}
      <Route path="/debug/mock-interview" element={<Safe><MockInterviewDebugPage /></Safe>} />

      {/* Admin routes — login is public, everything else requires auth */}
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin/revenue" element={<AdminAuthGuard><RevenuePage /></AdminAuthGuard>} />
      <Route path="/admin/ai-health" element={<AdminAuthGuard><AiHealthPage /></AdminAuthGuard>} />
      <Route path="/admin/agents" element={<AdminAuthGuard><AdminAgentsDashboardPage /></AdminAuthGuard>} />
      <Route path="/admin/compliance" element={<AdminAuthGuard><AdminCompliancePage /></AdminAuthGuard>} />
      <Route path="/admin/agent-dashboard" element={<AdminAuthGuard><AgentDashboardPage /></AdminAuthGuard>} />

      {/* 404 Not Found */}
      <Route path="*" element={<NotFoundPage />} />
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
