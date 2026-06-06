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
        <Route index element={<Safe><CandidateDashboard /></Safe>} />
        <Route path="jobs" element={<Safe><CandidateJobsPage /></Safe>} />
        <Route path="jobs/:id" element={<Safe><CandidateJobDetailPage /></Safe>} />
        <Route path="applications" element={<Safe><CandidateApplicationsPage /></Safe>} />
        <Route path="profile" element={<Safe><CandidateProfilePage /></Safe>} />
        <Route path="assessments" element={<Safe><CandidateAssessmentsPage /></Safe>} />
        <Route path="assessments/:id/take" element={<Safe><AssessmentTakePage /></Safe>} />
        <Route path="assessment-results" element={<Safe><AssessmentResultsPage /></Safe>} />
        <Route path="job-assessment/:id" element={<Safe><JobAssessmentTakePage /></Safe>} />
        <Route path="interviews" element={<Safe><CandidateInterviewsPage /></Safe>} />
        <Route path="ai-coaching" element={<Safe><AiCoachingPage /></Safe>} />
        <Route path="omniscore" element={<Safe><CandidateOmniScorePage /></Safe>} />
        <Route path="documents" element={<Safe><CandidateDocumentsPage /></Safe>} />
        <Route path="assessments/:id/results" element={<Safe><AssessmentResultsPage /></Safe>} />
        <Route path="interview-practice" element={<Safe><InterviewPracticePage /></Safe>} />
        <Route path="video-interview" element={<Safe><VideoInterviewPage /></Safe>} />
        <Route path="interview-analysis" element={<Safe><InterviewAnalysisPage /></Safe>} />
        <Route path="history" element={<Safe><HistoryPage /></Safe>} />
        <Route path="feedback" element={<Safe><PostHireFeedbackPage /></Safe>} />
        <Route path="offers/manage" element={<Safe><OfferManagementPage /></Safe>} />
        <Route path="company-profile" element={<Safe><CompanyProfilePage /></Safe>} />
        <Route path="interview" element={<Safe><InterviewPage /></Safe>} />
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
        <Route path="communications" element={<Safe><RecruiterCommunicationsPage /></Safe>} />
        <Route path="trustscore" element={<Safe><RecruiterTrustscorePage /></Safe>} />
        <Route path="onboarding-ai" element={<Safe><RecruiterOnboardingAiPage /></Safe>} />
        <Route path="onboarding-docs" element={<Safe><RecruiterOnboardingDocsPage /></Safe>} />
        <Route path="company" element={<Safe><RecruiterCompanyPage /></Safe>} />
        <Route path="profile" element={<Safe><RecruiterProfilePage /></Safe>} />
        <Route path="payroll" element={<Safe><RecruiterPayrollPage /></Safe>} />
        <Route path="payroll-dashboard" element={<Safe><RecruiterPayrollDashboardPage /></Safe>} />
        <Route path="payroll-run/:id" element={<Safe><RecruiterPayrollRunPage /></Safe>} />
        <Route path="job-create" element={<Safe><RecruiterJobCreatePage /></Safe>} />
        <Route path="omniscore" element={<Safe><RecruiterOmniScorePage /></Safe>} />
        <Route path="post-hire-feedback" element={<Safe><RecruiterPostHireFeedbackPage /></Safe>} />
        <Route path="compliance" element={<Safe><ComplianceDashboardPage /></Safe>} />
      </Route>

      {/* Settings */}
      <Route path="/settings" element={<DashboardLayout />}>
        <Route index element={<Safe><SettingsPage /></Safe>} />
      </Route>

      {/* Debug routes */}
      <Route path="/debug/mock-interview" element={<Safe><MockInterviewDebugPage /></Safe>} />

      {/* Admin routes — login is public, everything else requires auth */}
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin" element={<AdminAuthGuard><AdminDashboardPage /></AdminAuthGuard>} />
      <Route path="/admin/dashboard" element={<AdminAuthGuard><AdminDashboardPage /></AdminAuthGuard>} />
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
