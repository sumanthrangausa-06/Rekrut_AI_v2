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
import { AboutPage } from '@/pages/about'
import { ContactPage } from '@/pages/contact'
import { PrivacyPage } from '@/pages/privacy'
import { TermsPage } from '@/pages/terms'

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
import { AssessmentResultsPage } from '@/pages/candidate/assessment-results'

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
import { AdminAnalyticsPage } from '@/pages/admin/analytics'
import { AdminDashboardPage } from '@/pages/admin/dashboard'
import { AdminAuthGuard } from '@/components/admin-auth-guard'
import { AiHealthPage } from '@/pages/admin/ai-health'
import { RevenuePage } from '@/pages/admin/revenue'
import { AdminAgentsDashboardPage } from '@/pages/admin/agents'
import { AgentDashboardPage } from '@/pages/admin/agent-dashboard'
import { AdminCompliancePage } from '@/pages/admin/compliance'

// Blog
import { BlogPage, BlogPostPage } from '@/pages/blog'

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

// New migrated pages
import { PaymentSuccessPage } from '@/pages/payment-success'
import { RecruiterRegisterPage } from '@/pages/recruiter-register'
import { RecruiterJobCreatePage } from '@/pages/recruiter/job-create'
import { RecruiterPayrollDashboardPage } from '@/pages/recruiter/payroll-dashboard'
import { RecruiterPayrollRunPage } from '@/pages/recruiter/payroll-run'
import { EmployeePayrollPage } from '@/pages/employee-payroll'

import { RecruiterCommunicationsPage } from '@/pages/recruiter/communications'
import { RecruiterTrustscorePage } from '@/pages/recruiter/trustscore'
import { RecruiterProfilePage } from '@/pages/recruiter-profile'
import { RecruiterOnboardingAiPage } from '@/pages/recruiter/onboarding-ai'
import { RecruiterOnboardingDocsPage } from '@/pages/recruiter/onboarding-docs'
import { RecruiterPostHireFeedbackPage } from '@/pages/post-hire-feedback'
import { ComplianceDashboardPage } from '@/pages/compliance-dashboard'

import { InterviewPracticePage } from '@/pages/candidate/interview-practice'
import { VideoInterviewPage } from '@/pages/candidate/video-interview'
import { InterviewAnalysisPage } from '@/pages/candidate/interview-analysis'
import { HistoryPage } from '@/pages/candidate/history'
import { PostHireFeedbackPage } from '@/pages/candidate/post-hire-feedback'
import { OfferManagementPage } from '@/pages/candidate/offer-management'
import { CompanyProfilePage } from '@/pages/candidate/company-profile'
import { InterviewPage } from '@/pages/candidate/interview'

// Helper: wrap a page element with RouteErrorBoundary
function Safe({ children }: { children: React.ReactNode }) {
  return <RouteErrorBoundary>{children}</RouteErrorBoundary>
}

// Auth guard: shows loading state while auth initializes, redirects if not authenticated
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-dvh-safe items-center justify-center bg-background">
        <div className="animate-pulse flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-primary/20" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

// Combined wrapper: error boundary + auth guard for protected routes
function Protected({ children }: { children: React.ReactNode }) {
  return (
    <Safe>
      <RequireAuth>{children}</RequireAuth>
    </Safe>
  )
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
      <Route path="/payment-success" element={<PaymentSuccessPage />} />
      <Route path="/screening/:token" element={<CandidateScreeningPage />} />
      <Route path="/blog" element={<BlogPage />} />
      <Route path="/blog/:slug" element={<BlogPostPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />

      {/* Public company profile */}
      <Route path="/company/:slug" element={<Safe><PublicCompanyPage /></Safe>} />
      <Route path="/careers/:company" element={<Safe><RecruiterCareerPage /></Safe>} />

      <Route path="/recruiter-register" element={<RecruiterRegisterPage />} />
      <Route path="/employee-payroll" element={<EmployeePayrollPage />} />

      {/* Auto-redirect based on role */}
      <Route path="/dashboard" element={<RoleRedirect />} />

      {/* Candidate routes */}
      <Route path="/candidate" element={<DashboardLayout />}>
        <Route index element={<Protected><CandidateDashboard /></Protected>} />
        <Route path="jobs" element={<Protected><CandidateJobsPage /></Protected>} />
        <Route path="jobs/:id" element={<Protected><CandidateJobDetailPage /></Protected>} />
        <Route path="applications" element={<Protected><CandidateApplicationsPage /></Protected>} />
        <Route path="profile" element={<Protected><CandidateProfilePage /></Protected>} />
        <Route path="assessments" element={<Protected><CandidateAssessmentsPage /></Protected>} />
        <Route path="assessments/:id/take" element={<Protected><AssessmentTakePage /></Protected>} />
        <Route path="assessment-results" element={<Protected><AssessmentResultsPage /></Protected>} />
        <Route path="job-assessment/:id" element={<Protected><JobAssessmentTakePage /></Protected>} />
        <Route path="interviews" element={<Protected><CandidateInterviewsPage /></Protected>} />
        <Route path="ai-coaching" element={<Protected><AiCoachingPage /></Protected>} />
        <Route path="omniscore" element={<Protected><CandidateOmniScorePage /></Protected>} />
        <Route path="documents" element={<Protected><CandidateDocumentsPage /></Protected>} />
        <Route path="assessments/:id/results" element={<Protected><AssessmentResultsPage /></Protected>} />
        <Route path="interview-practice" element={<Protected><InterviewPracticePage /></Protected>} />
        <Route path="video-interview" element={<Protected><VideoInterviewPage /></Protected>} />
        <Route path="interview-analysis" element={<Protected><InterviewAnalysisPage /></Protected>} />
        <Route path="history" element={<Protected><HistoryPage /></Protected>} />
        <Route path="feedback" element={<Protected><PostHireFeedbackPage /></Protected>} />
        <Route path="offers/manage" element={<Protected><OfferManagementPage /></Protected>} />
        <Route path="company-profile" element={<Protected><CompanyProfilePage /></Protected>} />
        <Route path="interview" element={<Protected><InterviewPage /></Protected>} />
        <Route path="chat" element={<Protected><CandidateChatPage /></Protected>} />
        <Route path="offers" element={<Protected><CandidateOffersPage /></Protected>} />
        <Route path="onboarding" element={<Protected><CandidateOnboardingPage /></Protected>} />
        <Route path="payroll" element={<Protected><CandidatePayrollPage /></Protected>} />
      </Route>

      {/* Recruiter routes */}
      <Route path="/recruiter" element={<DashboardLayout />}>
        <Route index element={<Protected><RecruiterDashboard /></Protected>} />
        <Route path="jobs" element={<Protected><RecruiterJobsPage /></Protected>} />
        <Route path="jobs/new" element={<Protected><RecruiterJobFormPage /></Protected>} />
        <Route path="jobs/:id/applicants" element={<Protected><RecruiterJobApplicantsPage /></Protected>} />
        <Route path="jobs/:id/edit" element={<Protected><RecruiterJobFormPage /></Protected>} />
        <Route path="jobs/:id" element={<Protected><RecruiterJobApplicantsPage /></Protected>} />
        <Route path="jobs/:id/assessment" element={<Protected><RecruiterJobAssessmentPage /></Protected>} />
        <Route path="applications" element={<Protected><RecruiterApplicationsPage /></Protected>} />
        <Route path="assessments" element={<Protected><RecruiterAssessmentsPage /></Protected>} />
        <Route path="candidates" element={<Protected><RecruiterCandidatesPage /></Protected>} />
        <Route path="screening" element={<Protected><RecruiterScreeningPage /></Protected>} />
        <Route path="chat" element={<Protected><RecruiterChatPage /></Protected>} />
        <Route path="career-page" element={<Protected><RecruiterCareerPage /></Protected>} />
        <Route path="interviews" element={<Protected><RecruiterInterviewsPage /></Protected>} />
        <Route path="offers" element={<Protected><RecruiterOffersPage /></Protected>} />
        <Route path="onboarding" element={<Protected><RecruiterOnboardingPage /></Protected>} />
        <Route path="analytics" element={<Protected><RecruiterAnalyticsPage /></Protected>} />
        <Route path="communications" element={<Protected><RecruiterCommunicationsPage /></Protected>} />
        <Route path="trustscore" element={<Protected><RecruiterTrustscorePage /></Protected>} />
        <Route path="onboarding-ai" element={<Protected><RecruiterOnboardingAiPage /></Protected>} />
        <Route path="onboarding-docs" element={<Protected><RecruiterOnboardingDocsPage /></Protected>} />
        <Route path="company" element={<Protected><RecruiterCompanyPage /></Protected>} />
        <Route path="profile" element={<Protected><RecruiterProfilePage /></Protected>} />
        <Route path="payroll" element={<Protected><RecruiterPayrollPage /></Protected>} />
        <Route path="payroll-dashboard" element={<Protected><RecruiterPayrollDashboardPage /></Protected>} />
        <Route path="payroll-run/:id" element={<Protected><RecruiterPayrollRunPage /></Protected>} />
        <Route path="job-create" element={<Protected><RecruiterJobCreatePage /></Protected>} />
        <Route path="omniscore" element={<Protected><RecruiterOmniScorePage /></Protected>} />
        <Route path="post-hire-feedback" element={<Protected><RecruiterPostHireFeedbackPage /></Protected>} />
        <Route path="compliance" element={<Protected><ComplianceDashboardPage /></Protected>} />
      </Route>

      {/* Settings */}
      <Route path="/settings" element={<DashboardLayout />}>
        <Route index element={<Protected><SettingsPage /></Protected>} />
      </Route>

      {/* Debug routes */}
      <Route path="/debug/mock-interview" element={<Protected><MockInterviewDebugPage /></Protected>} />

      {/* Admin routes — login is public, everything else requires auth */}
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin" element={<AdminAuthGuard><AdminDashboardPage /></AdminAuthGuard>} />
      <Route path="/admin/dashboard" element={<AdminAuthGuard><AdminDashboardPage /></AdminAuthGuard>} />
      <Route path="/admin/revenue" element={<AdminAuthGuard><RevenuePage /></AdminAuthGuard>} />
      <Route path="/admin/ai-health" element={<AdminAuthGuard><AiHealthPage /></AdminAuthGuard>} />
      <Route path="/admin/agents" element={<AdminAuthGuard><AdminAgentsDashboardPage /></AdminAuthGuard>} />
      <Route path="/admin/compliance" element={<AdminAuthGuard><AdminCompliancePage /></AdminAuthGuard>} />
      <Route path="/admin/agent-dashboard" element={<AdminAuthGuard><AgentDashboardPage /></AdminAuthGuard>} />
      <Route path="/admin/analytics" element={<AdminAuthGuard><AdminAnalyticsPage /></AdminAuthGuard>} />

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
