import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AdminAuthGuard } from '@/components/admin-auth-guard'
import { ErrorBoundary, RouteErrorBoundary } from '@/components/error-boundary'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { AuthProvider, getDashboardPath, useAuth } from '@/contexts/auth-context'

// ─── Lazy page imports ───────────────────────────────────────────────────

// Public
const LandingPage = lazy(() => import('@/pages/landing').then((m) => ({ default: m.LandingPage })))
const ReferralLandingPage = lazy(() => import('@/pages/referral-landing').then((m) => ({ default: m.ReferralLandingPage })))
const LoginPage = lazy(() => import('@/pages/login').then((m) => ({ default: m.LoginPage })))
const RegisterPage = lazy(() =>
	import('@/pages/register').then((m) => ({ default: m.RegisterPage })),
)
const ForgotPasswordPage = lazy(() =>
	import('@/pages/forgot-password').then((m) => ({ default: m.ForgotPasswordPage })),
)
const ResetPasswordPage = lazy(() =>
	import('@/pages/reset-password').then((m) => ({ default: m.ResetPasswordPage })),
)
const NotFoundPage = lazy(() =>
	import('@/pages/not-found').then((m) => ({ default: m.NotFoundPage })),
)
const PricingPage = lazy(() => import('@/pages/pricing').then((m) => ({ default: m.PricingPage })))
const AboutPage = lazy(() => import('@/pages/about').then((m) => ({ default: m.AboutPage })))
const ContactPage = lazy(() => import('@/pages/contact').then((m) => ({ default: m.ContactPage })))
const PrivacyPage = lazy(() => import('@/pages/privacy').then((m) => ({ default: m.PrivacyPage })))
const TermsPage = lazy(() => import('@/pages/terms').then((m) => ({ default: m.TermsPage })))
const PaymentSuccessPage = lazy(() =>
	import('@/pages/payment-success').then((m) => ({ default: m.PaymentSuccessPage })),
)
const RecruiterRegisterPage = lazy(() =>
	import('@/pages/recruiter-register').then((m) => ({ default: m.RecruiterRegisterPage })),
)
const EmployeePayrollPage = lazy(() =>
	import('@/pages/employee-payroll').then((m) => ({ default: m.EmployeePayrollPage })),
)
const _PlaceholderPage = lazy(() =>
	import('@/pages/placeholder').then((m) => ({ default: m.PlaceholderPage })),
)
const SettingsPage = lazy(() =>
	import('@/pages/settings').then((m) => ({ default: m.SettingsPage })),
)
const TestCameraPage = lazy(() =>
	import('@/pages/test-camera').then((m) => ({ default: m.TestCameraPage })),
)
const _PostHireFeedbackPage = lazy(() =>
	import('@/pages/post-hire-feedback').then((m) => ({ default: m.RecruiterPostHireFeedbackPage })),
)
const RecruiterProfilePage = lazy(() =>
	import('@/pages/recruiter-profile').then((m) => ({ default: m.RecruiterProfilePage })),
)
const RecruiterTrustscorePage = lazy(() =>
	import('@/pages/recruiter-trustscore').then((m) => ({ default: m.RecruiterTrustscorePage })),
)
const RecruiterCommunicationsPage = lazy(() =>
	import('@/pages/recruiter-communications').then((m) => ({
		default: m.RecruiterCommunicationsPage,
	})),
)

const LeaderboardPage = lazy(() =>
	import('@/pages/candidate/leaderboard').then((m) => ({ default: m.LeaderboardPage })),
)
const CompanyComparePage = lazy(() =>
	import('@/pages/candidate/company-compare').then((m) => ({ default: m.CompanyComparePage })),
)

// Blog
const BlogPage = lazy(() => import('@/pages/blog').then((m) => ({ default: m.BlogPage })))
const BlogPostPage = lazy(() => import('@/pages/blog').then((m) => ({ default: m.BlogPostPage })))

// Public company / career
const PublicCompanyPage = lazy(() =>
	import('@/pages/recruiter/public-company').then((m) => ({ default: m.PublicCompanyPage })),
)
const RecruiterCareerPage = lazy(() =>
	import('@/pages/recruiter/career-page').then((m) => ({ default: m.RecruiterCareerPage })),
)

// Candidate pages
const CandidateDashboard = lazy(() =>
	import('@/pages/candidate/dashboard').then((m) => ({ default: m.CandidateDashboard })),
)
const CandidateJobsPage = lazy(() =>
	import('@/pages/candidate/jobs').then((m) => ({ default: m.CandidateJobsPage })),
)
const CandidateJobDetailPage = lazy(() =>
	import('@/pages/candidate/job-detail').then((m) => ({ default: m.CandidateJobDetailPage })),
)
const CandidateApplicationsPage = lazy(() =>
	import('@/pages/candidate/applications').then((m) => ({ default: m.CandidateApplicationsPage })),
)
const CandidateAssessmentsPage = lazy(() =>
	import('@/pages/candidate/assessments').then((m) => ({ default: m.CandidateAssessmentsPage })),
)
const AssessmentTakePage = lazy(() =>
	import('@/pages/candidate/assessment-take').then((m) => ({ default: m.AssessmentTakePage })),
)
const JobAssessmentTakePage = lazy(() =>
	import('@/pages/candidate/job-assessment-take').then((m) => ({
		default: m.JobAssessmentTakePage,
	})),
)
const AssessmentResultsPage = lazy(() =>
	import('@/pages/candidate/assessment-results').then((m) => ({
		default: m.AssessmentResultsPage,
	})),
)
const CandidateOffersPage = lazy(() =>
	import('@/pages/candidate/offers').then((m) => ({ default: m.CandidateOffersPage })),
)
const CandidateProfilePage = lazy(() =>
	import('@/pages/candidate/profile').then((m) => ({ default: m.CandidateProfilePage })),
)
const CandidateInterviewsPage = lazy(() =>
	import('@/pages/candidate/interviews').then((m) => ({ default: m.CandidateInterviewsPage })),
)
const CandidateOnboardingPage = lazy(() =>
	import('@/pages/candidate/onboarding').then((m) => ({ default: m.CandidateOnboardingPage })),
)
const CandidatePayrollPage = lazy(() =>
	import('@/pages/candidate/payroll').then((m) => ({ default: m.CandidatePayrollPage })),
)
const AiCoachingPage = lazy(() =>
	import('@/pages/candidate/ai-coaching').then((m) => ({ default: m.AiCoachingPage })),
)
const CareerCoachPage = lazy(() =>
	import('@/pages/candidate/career-coach').then((m) => ({ default: m.CareerCoachPage })),
)
const CandidateTopMatchesPage = lazy(() =>
	import('@/pages/candidate/top-matches').then((m) => ({ default: m.CandidateTopMatchesPage })),
)

const CompanyMatchesPage = lazy(() =>
	import('@/pages/candidate/company-matches').then((m) => ({ default: m.CompanyMatchesPage })),
)

const CandidateDocumentsPage = lazy(() =>
	import('@/pages/candidate/documents').then((m) => ({ default: m.CandidateDocumentsPage })),
)
const CandidateIdentityVerificationPage = lazy(() =>
	import('@/pages/candidate/identity-verification').then((m) => ({ default: m.CandidateIdentityVerificationPage })),
)
const CandidateBackgroundCheckPage = lazy(() =>
	import('@/pages/candidate/background-check').then((m) => ({ default: m.CandidateBackgroundCheckPage })),
)
const CandidateScreeningPage = lazy(() =>
	import('@/pages/candidate/screening').then((m) => ({ default: m.CandidateScreeningPage })),
)
const CandidateScreeningQuestionnairePage = lazy(() =>
	import('@/pages/candidate/screening-questionnaire').then((m) => ({
		default: m.ScreeningQuestionnairePage,
	})),
)

const CandidateChatPage = lazy(() =>
	import('@/pages/candidate/chat').then((m) => ({ default: m.CandidateChatPage })),
)
const InterviewPracticePage = lazy(() =>
	import('@/pages/candidate/interview-practice').then((m) => ({
		default: m.InterviewPracticePage,
	})),
)
const LiveKitRoomPage = lazy(() =>
	import('@/pages/candidate/livekit-room').then((m) => ({ default: m.LiveKitRoomPage })),
)
const VideoInterviewPage = lazy(() =>
	import('@/pages/candidate/video-interview').then((m) => ({ default: m.VideoInterviewPage })),
)
const InterviewAnalysisPage = lazy(() =>
	import('@/pages/candidate/interview-analysis').then((m) => ({
		default: m.InterviewAnalysisPage,
	})),
)
const HistoryPage = lazy(() =>
	import('@/pages/candidate/history').then((m) => ({ default: m.HistoryPage })),
)
const CandidatePostHireFeedbackPage = lazy(() =>
	import('@/pages/candidate/post-hire-feedback').then((m) => ({ default: m.PostHireFeedbackPage })),
)
const OfferManagementPage = lazy(() =>
	import('@/pages/candidate/offer-management').then((m) => ({ default: m.OfferManagementPage })),
)
const ReferralsPage = lazy(() =>
	import('@/pages/candidate/referrals').then((m) => ({ default: m.ReferralsPage })),
)
const CVReviewPage = lazy(() =>
	import('@/pages/candidate/cv-review').then((m) => ({ default: m.CVReviewPage })),
)
const LinkedInOptimizerPage = lazy(() =>
	import('@/pages/candidate/linkedin-optimizer').then((m) => ({ default: m.LinkedInOptimizerPage })),
)
const CareerDiagnosisPage = lazy(() =>
	import('@/pages/candidate/career-diagnosis').then((m) => ({ default: m.CareerDiagnosisPage })),
)
const CompanyProfilePage = lazy(() =>
	import('@/pages/candidate/company-profile').then((m) => ({ default: m.CompanyProfilePage })),
)
const InterviewPage = lazy(() =>
	import('@/pages/candidate/interview').then((m) => ({ default: m.InterviewPage })),
)
const BookInterviewPage = lazy(() =>
	import('@/pages/candidate/book-interview').then((m) => ({ default: m.BookInterviewPage })),
)

const CandidateAiScreeningPage = lazy(() =>
	import('@/pages/candidate/ai-screening').then((m) => ({ default: m.CandidateAiScreeningPage })),
)
const CandidateAptitudeTestsPage = lazy(() =>
	import('@/pages/candidate/aptitude-tests').then((m) => ({ default: m.CandidateAptitudeTestsPage })),
)
const CandidateAptitudeTestTakePage = lazy(() =>
	import('@/pages/candidate/aptitude-test-take').then((m) => ({ default: m.CandidateAptitudeTestTakePage })),
)
const CandidateAptitudeTestResultsPage = lazy(() =>
	import('@/pages/candidate/aptitude-test-results').then((m) => ({ default: m.CandidateAptitudeTestResultsPage })),
)

const CandidateProctoringConsentPage = lazy(() =>
	import('@/pages/candidate/proctoring-consent').then((m) => ({
		default: m.CandidateProctoringConsentPage,
	})),
)
const CandidateProctoringSessionPage = lazy(() =>
	import('@/pages/candidate/proctoring-session').then((m) => ({
		default: m.CandidateProctoringSessionPage,
	})),
)

// Recruiter pages
const RecruiterProctoringFlagsPage = lazy(() =>
	import('@/pages/recruiter/proctoring-flags').then((m) => ({
		default: m.RecruiterProctoringFlagsPage,
	})),
)
const RecruiterProctoringFlagDetailPage = lazy(() =>
	import('@/pages/recruiter/proctoring-flag-detail').then((m) => ({
		default: m.RecruiterProctoringFlagDetailPage,
	})),
)

const RecruiterAptitudeTestsPage = lazy(() =>
	import('@/pages/recruiter/aptitude-tests').then((m) => ({ default: m.RecruiterAptitudeTestsPage })),
)
const RecruiterAptitudeTestCreatePage = lazy(() =>
	import('@/pages/recruiter/aptitude-test-create').then((m) => ({ default: m.RecruiterAptitudeTestCreatePage })),
)
const RecruiterAptitudeTestResultsPage = lazy(() =>
	import('@/pages/recruiter/aptitude-test-results').then((m) => ({ default: m.RecruiterAptitudeTestResultsPage })),
)
const RecruiterDashboard = lazy(() =>
	import('@/pages/recruiter/dashboard').then((m) => ({ default: m.RecruiterDashboard })),
)
const RecruiterJobsPage = lazy(() =>
	import('@/pages/recruiter/jobs').then((m) => ({ default: m.RecruiterJobsPage })),
)
const RecruiterJobFormPage = lazy(() =>
	import('@/pages/recruiter/job-form').then((m) => ({ default: m.RecruiterJobFormPage })),
)
const RecruiterJobApplicantsPage = lazy(() =>
	import('@/pages/recruiter/job-applicants').then((m) => ({
		default: m.RecruiterJobApplicantsPage,
	})),
)
const RecruiterApplicationsPage = lazy(() =>
	import('@/pages/recruiter/applications').then((m) => ({ default: m.RecruiterApplicationsPage })),
)
const RecruiterAssessmentsPage = lazy(() =>
	import('@/pages/recruiter/assessments').then((m) => ({ default: m.RecruiterAssessmentsPage })),
)
const RecruiterJobAssessmentPage = lazy(() =>
	import('@/pages/recruiter/job-assessment').then((m) => ({
		default: m.RecruiterJobAssessmentPage,
	})),
)
const RecruiterOffersPage = lazy(() =>
	import('@/pages/recruiter/offers').then((m) => ({ default: m.RecruiterOffersPage })),
)
const RecruiterRecordingsPage = lazy(() =>
	import('@/pages/recruiter/recordings').then((m) => ({ default: m.RecruiterRecordingsPage })),
)
const RecordingPlaybackPage = lazy(() =>
	import('@/pages/recruiter/recording-playback').then((m) => ({ default: m.RecordingPlaybackPage })),
)

const RecruiterPanelsPage = lazy(() =>
	import('@/pages/recruiter/panels').then((m) => ({ default: m.RecruiterPanelsPage })),
)
const RecruiterPanelRoomPage = lazy(() =>
	import('@/pages/recruiter/panel-room').then((m) => ({ default: m.RecruiterPanelRoomPage })),
)
const RecruiterPanelScorecardCriteriaPage = lazy(() =>
	import('@/pages/recruiter/panel-scorecard-criteria').then((m) => ({ default: m.RecruiterPanelScorecardCriteriaPage })),
)
const CalendarSettingsPage = lazy(() =>
	import('@/pages/recruiter/calendar-settings').then((m) => ({ default: m.CalendarSettingsPage })),
)
const RecruiterOnboardingPage = lazy(() =>
	import('@/pages/recruiter/onboarding').then((m) => ({ default: m.RecruiterOnboardingPage })),
)
const RecruiterPayrollPage = lazy(() =>
	import('@/pages/recruiter/payroll').then((m) => ({ default: m.RecruiterPayrollPage })),
)
const RecruiterAnalyticsPage = lazy(() =>
	import('@/pages/recruiter/analytics').then((m) => ({ default: m.RecruiterAnalyticsPage })),
)
const RecruiterCandidatesPage = lazy(() =>
	import('@/pages/recruiter/candidates').then((m) => ({ default: m.RecruiterCandidatesPage })),
)
const RecruiterScreeningPage = lazy(() =>
	import('@/pages/recruiter/screening').then((m) => ({ default: m.RecruiterScreeningPage })),
)
const RecruiterChatPage = lazy(() =>
	import('@/pages/recruiter/chat').then((m) => ({ default: m.RecruiterChatPage })),
)
const RecruiterJobCreatePage = lazy(() =>
	import('@/pages/recruiter/job-create').then((m) => ({ default: m.RecruiterJobCreatePage })),
)
const RecruiterPayrollDashboardPage = lazy(() =>
	import('@/pages/recruiter/payroll-dashboard').then((m) => ({
		default: m.RecruiterPayrollDashboardPage,
	})),
)
const RecruiterPayrollRunPage = lazy(() =>
	import('@/pages/recruiter/payroll-run').then((m) => ({ default: m.RecruiterPayrollRunPage })),
)
const RecruiterCompanyPage = lazy(() =>
	import('@/pages/recruiter/company').then((m) => ({ default: m.RecruiterCompanyPage })),
)
const RecruiterJoinRequestsPage = lazy(() =>
	import('@/pages/recruiter/join-requests').then((m) => ({ default: m.RecruiterJoinRequestsPage })),
)
const RecruiterTeamPage = lazy(() =>
	import('@/pages/recruiter/team').then((m) => ({ default: m.RecruiterTeamPage })),
)
const RecruiterOnboardingAiPage = lazy(() =>
	import('@/pages/recruiter/onboarding-ai').then((m) => ({ default: m.RecruiterOnboardingAiPage })),
)
const RecruiterOnboardingDocsPage = lazy(() =>
	import('@/pages/recruiter/onboarding-docs').then((m) => ({
		default: m.RecruiterOnboardingDocsPage,
	})),
)
const CandidateOmniScorePage = lazy(() =>
	import('@/pages/candidate/omniscore').then((m) => ({ default: m.CandidateOmniScorePage })),
)
const RecruiterInterviewsPage = lazy(() =>
	import('@/pages/recruiter/interviews').then((m) => ({ default: m.RecruiterInterviewsPage })),
)
const RecruiterOmniScorePage = lazy(() =>
	import('@/pages/recruiter/omniscore').then((m) => ({ default: m.RecruiterOmniScorePage })),
)
const RecruiterPostHireFeedbackPage = lazy(() =>
	import('@/pages/post-hire-feedback').then((m) => ({ default: m.RecruiterPostHireFeedbackPage })),
)
const RecruiterCompliancePage = lazy(() =>
	import('@/pages/recruiter/compliance').then((m) => ({ default: m.RecruiterCompliancePage })),
)
const RecruiterBackgroundCheckPage = lazy(() =>
	import('@/pages/recruiter/background-check').then((m) => ({ default: m.RecruiterBackgroundCheckPage })),
)

const RecruiterPendingApprovalPage = lazy(() =>
	import('@/pages/recruiter/pending-approval').then((m) => ({ default: m.RecruiterPendingApprovalPage })),
)
const AdminLoginPage = lazy(() =>
	import('@/pages/admin/login').then((m) => ({ default: m.AdminLoginPage })),
)
const AdminAnalyticsPage = lazy(() =>
	import('@/pages/admin/analytics').then((m) => ({ default: m.AdminAnalyticsPage })),
)
const AdminDashboardPage = lazy(() =>
	import('@/pages/admin/dashboard').then((m) => ({ default: m.AdminDashboardPage })),
)
const AiHealthPage = lazy(() =>
	import('@/pages/admin/ai-health').then((m) => ({ default: m.AiHealthPage })),
)
const RevenuePage = lazy(() =>
	import('@/pages/admin/revenue').then((m) => ({ default: m.RevenuePage })),
)
const AdminAgentsDashboardPage = lazy(() =>
	import('@/pages/admin/agents').then((m) => ({ default: m.AdminAgentsDashboardPage })),
)
const AgentDashboardPage = lazy(() =>
	import('@/pages/admin/agent-dashboard').then((m) => ({ default: m.AgentDashboardPage })),
)
const AdminCompliancePage = lazy(() =>
	import('@/pages/admin/compliance').then((m) => ({ default: m.AdminCompliancePage })),
)
const EUAIActDashboard = lazy(() =>
	import('@/pages/admin/compliance/EUAIActDashboard').then((m) => ({
		default: m.EUAIActDashboard,
	})),
)
const AdminEmailQueuePage = lazy(() =>
	import('@/pages/admin/email-queue').then((m) => ({
		default: m.AdminEmailQueuePage,
	})),
)

const SignDocumentPage = lazy(() =>
	import('@/pages/signature/SignDocument').then((m) => ({ default: m.SignDocumentPage })),
)

// Debug pages
const MockInterviewDebugPage = lazy(() =>
	import('@/pages/debug/mock-interview').then((m) => ({ default: m.MockInterviewDebugPage })),
)

// ─── Loading fallback ────────────────────────────────────────────────────

function PageLoading() {
	return (
		<div className='flex min-h-dvh-safe items-center justify-center bg-background'>
			<div className='animate-pulse flex flex-col items-center gap-3'>
				<div className='h-8 w-8 rounded-full bg-primary/20' />
				<p className='text-sm text-muted-foreground'>Loading...</p>
			</div>
		</div>
	)
}

// Helper: wrap a page element with RouteErrorBoundary
function Safe({ children }: { children: React.ReactNode }) {
	return <RouteErrorBoundary>{children}</RouteErrorBoundary>
}

// Auth guard: shows loading state while auth initializes, redirects if not authenticated
function RequireAuth({ children }: { children: React.ReactNode }) {
	const { isAuthenticated, loading } = useAuth()

	if (loading) {
		return (
			<div className='flex min-h-dvh-safe items-center justify-center bg-background'>
				<div className='animate-pulse flex flex-col items-center gap-3'>
					<div className='h-8 w-8 rounded-full bg-primary/20' />
					<p className='text-sm text-muted-foreground'>Loading...</p>
				</div>
			</div>
		)
	}

	if (!isAuthenticated) {
		return <Navigate to='/login' replace />
	}

	return <>{children}</>
}

// Recruiter route guard: redirects pending-approval recruiters to the holding screen
function RecruiterGuard({ children }: { children: React.ReactNode }) {
	const { user, isPendingApproval, loading } = useAuth()

	if (loading) {
		return (
			<div className='flex min-h-dvh-safe items-center justify-center bg-background'>
				<div className='animate-pulse flex flex-col items-center gap-3'>
					<div className='h-8 w-8 rounded-full bg-primary/20' />
					<p className='text-sm text-muted-foreground'>Loading...</p>
				</div>
			</div>
		)
	}

	if (!user) {
		return <Navigate to='/login' replace />
	}

	if (isPendingApproval) {
		return <Navigate to='/recruiter/pending-approval' replace />
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
	if (!user) return <Navigate to='/login' replace />
	return <Navigate to={getDashboardPath(user)} replace />
}

function AppRoutes() {
	return (
		<Routes>
			{/* Public routes */}
			<Route path='/' element={<LandingPage />} />
			<Route path='/login' element={<LoginPage />} />
			<Route path='/register' element={<RegisterPage />} />
			<Route path='/ref' element={<ReferralLandingPage />} />
			<Route path='/forgot-password' element={<ForgotPasswordPage />} />
			<Route path='/reset-password' element={<ResetPasswordPage />} />
			<Route path='/test-camera' element={<TestCameraPage />} />
			<Route path='/pricing' element={<PricingPage />} />
			<Route path='/payment-success' element={<PaymentSuccessPage />} />
			<Route path='/screening/:token' element={<CandidateScreeningPage />} />
			<Route path='/blog' element={<BlogPage />} />
			<Route path='/blog/:slug' element={<BlogPostPage />} />
			<Route path='/about' element={<AboutPage />} />
			<Route path='/contact' element={<ContactPage />} />
			<Route path='/privacy' element={<PrivacyPage />} />
			<Route path='/terms' element={<TermsPage />} />

			<Route path='/leaderboard' element={<LeaderboardPage />} />
			<Route path='/compare' element={<CompanyComparePage />} />

			{/* Public company profile */}
			<Route
				path='/company/:slug'
				element={
					<Safe>
						<PublicCompanyPage />
					</Safe>
				}
			/>
			<Route
				path='/careers/:company'
				element={
					<Safe>
						<RecruiterCareerPage />
					</Safe>
				}
			/>

			<Route path='/recruiter-register' element={<RecruiterRegisterPage />} />
			<Route path='/employee-payroll' element={<EmployeePayrollPage />} />

			{/* Auto-redirect based on role */}
			<Route path='/dashboard' element={<RoleRedirect />} />

			{/* Candidate routes */}
			<Route path='/candidate' element={<DashboardLayout />}>
				<Route
					index
					element={
						<Protected>
							<CandidateDashboard />
						</Protected>
					}
				/>
				<Route
					path='jobs'
					element={
						<Protected>
							<CandidateJobsPage />
						</Protected>
					}
				/>
				<Route
					path='jobs/:id'
					element={
						<Protected>
							<CandidateJobDetailPage />
						</Protected>
					}
				/>
				<Route
					path='applications'
					element={
						<Protected>
							<CandidateApplicationsPage />
						</Protected>
					}
				/>
				<Route
					path='profile'
					element={
						<Protected>
							<CandidateProfilePage />
						</Protected>
					}
				/>
				<Route
					path='assessments'
					element={
						<Protected>
							<CandidateAssessmentsPage />
						</Protected>
					}
				/>
				<Route
					path='assessments/:id/take'
					element={
						<Protected>
							<AssessmentTakePage />
						</Protected>
					}
				/>
				<Route
					path='assessment-results'
					element={
						<Protected>
							<AssessmentResultsPage />
						</Protected>
					}
				/>
				<Route
					path='job-assessment/:id'
					element={
						<Protected>
							<JobAssessmentTakePage />
						</Protected>
					}
				/>
				<Route
					path='interviews'
					element={
						<Protected>
							<CandidateInterviewsPage />
						</Protected>
					}
				/>
				<Route
					path='interviews/:id/book'
					element={
						<Protected>
							<BookInterviewPage />
						</Protected>
					}
				/>
				<Route
					path='ai-coaching'
					element={
						<Protected>
							<AiCoachingPage />
						</Protected>
					}
				/>
				<Route
					path='career-coach'
					element={
						<Protected>
							<CareerCoachPage />
						</Protected>
					}
				/>
				<Route
					path='omniscore'
					element={
						<Protected>
							<CandidateOmniScorePage />
						</Protected>
					}
				/>
				<Route
					path='documents'
					element={
						<Protected>
							<CandidateDocumentsPage />
						</Protected>
					}
				/>
				<Route
					path='identity-verification'
					element={
						<Protected>
							<CandidateIdentityVerificationPage />
						</Protected>
					}
				/>
				<Route
					path='background-check'
					element={
						<Protected>
							<CandidateBackgroundCheckPage />
						</Protected>
					}
				/>
				<Route
					path='assessments/:id/results'
					element={
						<Protected>
							<AssessmentResultsPage />
						</Protected>
					}
				/>
				<Route
					path='interview-practice'
					element={
						<Protected>
							<InterviewPracticePage />
						</Protected>
					}
				/>
				<Route
					path='livekit-room'
					element={
						<Protected>
							<LiveKitRoomPage />
						</Protected>
					}
				/>
				<Route
					path='video-interview'
					element={
						<Protected>
							<VideoInterviewPage />
						</Protected>
					}
				/>
				<Route
					path='interview-analysis'
					element={
						<Protected>
							<InterviewAnalysisPage />
						</Protected>
					}
				/>
				<Route
					path='history'
					element={
						<Protected>
							<HistoryPage />
						</Protected>
					}
				/>
				<Route
					path='feedback'
					element={
						<Protected>
							<CandidatePostHireFeedbackPage />
						</Protected>
					}
				/>
				<Route
					path='saved-jobs'
					element={
						<Protected>
							<_PlaceholderPage />
						</Protected>
					}
				/>
				<Route
					path='top-matches'
					element={
						<Protected>
							<CandidateTopMatchesPage />
						</Protected>
					}
				/>
				<Route
					path='company-matches'
					element={
						<Protected>
							<CompanyMatchesPage />
						</Protected>
					}
				/>
				<Route
					path='ai-search'
					element={
						<Protected>
							<_PlaceholderPage />
						</Protected>
					}
				/>
				<Route
					path='cv-review'
					element={
						<Protected>
							<CVReviewPage />
						</Protected>
					}
				/>
				<Route
					path='linkedin-optimizer'
					element={
						<Protected>
							<LinkedInOptimizerPage />
						</Protected>
					}
				/>
				<Route
					path='career-diagnosis'
					element={
						<Protected>
							<CareerDiagnosisPage />
						</Protected>
					}
				/>
				<Route
					path='offers/manage'
					element={
						<Protected>
							<CandidateOffersPage />
						</Protected>
					}
				/>
				<Route
					path='company-profile'
					element={
						<Protected>
							<CompanyProfilePage />
						</Protected>
					}
				/>
				<Route
					path='interview'
					element={
						<Protected>
							<InterviewPage />
						</Protected>
					}
				/>
				<Route
					path='ai-screening'
					element={
						<Protected>
							<CandidateAiScreeningPage />
						</Protected>
					}
				/>
				<Route
					path='screening/:jobId'
					element={
						<Protected>
							<CandidateScreeningQuestionnairePage />
						</Protected>
					}
				/>
				<Route
					path='proctoring/:sessionId/consent'
					element={
						<Protected>
							<CandidateProctoringConsentPage />
						</Protected>
					}
				/>
				<Route
					path='proctoring/:sessionId'
					element={
						<Protected>
							<CandidateProctoringSessionPage />
						</Protected>
					}
				/>
				<Route
					path='chat'
					element={
						<Protected>
							<CandidateChatPage />
						</Protected>
					}
				/>
				<Route
					path='offers'
					element={
						<Protected>
							<CandidateOffersPage />
						</Protected>
					}
				/>
				<Route
					path='onboarding'
					element={
						<Protected>
							<CandidateOnboardingPage />
						</Protected>
					}
				/>
				<Route
					path='payroll'
					element={
						<Protected>
							<CandidatePayrollPage />
						</Protected>
					}
				/>
				<Route
					path='settings'
					element={
						<Protected>
							<SettingsPage />
						</Protected>
					}
				/>
				<Route
					path='referrals'
					element={
						<Protected>
							<ReferralsPage />
						</Protected>
					}
				/>
			</Route>

			{/* Aptitude Tests — candidate (standalone routes, outside /candidate prefix) */}
			<Route
				path='/aptitude-tests'
				element={
					<Protected>
						<CandidateAptitudeTestsPage />
					</Protected>
				}
			/>
			<Route
				path='/aptitude-tests/:id/take'
				element={
					<Protected>
						<CandidateAptitudeTestTakePage />
					</Protected>
				}
			/>
			<Route
				path='/aptitude-test-results/:id'
				element={
					<Protected>
						<CandidateAptitudeTestResultsPage />
					</Protected>
				}
			/>

			{/* Recruiter pending approval — standalone route (no DashboardLayout sidebar) */}
			<Route
				path='/recruiter/pending-approval'
				element={
					<Safe>
						<RequireAuth>
							<RecruiterPendingApprovalPage />
						</RequireAuth>
					</Safe>
				}
			/>

			{/* Recruiter routes */}
			<Route path='/recruiter' element={<DashboardLayout />}>
				<Route
					index
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterDashboard />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='jobs'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterJobsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='jobs/new'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterJobFormPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='jobs/:id/applicants'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterJobApplicantsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='jobs/:id/edit'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterJobFormPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='jobs/:id'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterJobApplicantsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='jobs/:id/assessment'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterJobAssessmentPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='applications'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterApplicationsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='aptitude-tests'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterAptitudeTestsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='aptitude-tests/create'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterAptitudeTestCreatePage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='aptitude-tests/:id/edit'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterAptitudeTestCreatePage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='aptitude-tests/:id/results'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterAptitudeTestResultsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='assessments'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterAssessmentsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='candidates'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterCandidatesPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='screening'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterScreeningPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='chat'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterChatPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='career-page'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterCareerPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='interviews'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterInterviewsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='recordings'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterRecordingsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='recordings/:id/playback'
					element={
						<Protected>
							<RecruiterGuard>
								<RecordingPlaybackPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='calendar'
					element={
						<Protected>
							<RecruiterGuard>
								<CalendarSettingsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='panels'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterPanelsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='panels/:id'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterPanelRoomPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='offers'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterOffersPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='onboarding'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterOnboardingPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='analytics'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterAnalyticsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='communications'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterCommunicationsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='trustscore'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterTrustscorePage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='onboarding-ai'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterOnboardingAiPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='onboarding-docs'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterOnboardingDocsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='company'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterCompanyPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='team'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterTeamPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='team/join-requests'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterJoinRequestsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='profile'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterProfilePage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='payroll'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterPayrollPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='payroll-dashboard'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterPayrollDashboardPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='payroll-run/:id'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterPayrollRunPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='job-create'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterJobCreatePage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='omniscore'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterOmniScorePage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='post-hire-feedback'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterPostHireFeedbackPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='proctoring'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterProctoringFlagsPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='proctoring/:flagId'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterProctoringFlagDetailPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='compliance'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterCompliancePage />
							</RecruiterGuard>
						</Protected>
					}
				/>
				<Route
					path='background-check'
					element={
						<Protected>
							<RecruiterGuard>
								<RecruiterBackgroundCheckPage />
							</RecruiterGuard>
						</Protected>
					}
				/>
			</Route>

			{/* Settings */}
			<Route path='/settings' element={<DashboardLayout />}>
				<Route
					index
					element={
						<Protected>
							<SettingsPage />
						</Protected>
					}
				/>
			</Route>

			{/* E-signature signing ceremony */}
			<Route
				path='/signature/:documentId/:requestId'
				element={
					<Protected>
						<SignDocumentPage />
					</Protected>
				}
			/>

			{/* Debug routes */}
			<Route
				path='/debug/mock-interview'
				element={
					<Protected>
						<MockInterviewDebugPage />
					</Protected>
				}
			/>

			{/* Admin routes — login is public, everything else requires auth */}
			<Route path='/admin/login' element={<AdminLoginPage />} />
			{/* Backwards compatibility: redirect old /admin-login to /admin/login */}
			<Route path='/admin-login' element={<Navigate to='/admin/login' replace />} />
			<Route
				path='/admin'
				element={
					<AdminAuthGuard>
						<AdminDashboardPage />
					</AdminAuthGuard>
				}
			/>
			<Route
				path='/admin/dashboard'
				element={
					<AdminAuthGuard>
						<AdminDashboardPage />
					</AdminAuthGuard>
				}
			/>
			<Route
				path='/admin/revenue'
				element={
					<AdminAuthGuard>
						<RevenuePage />
					</AdminAuthGuard>
				}
			/>
			<Route
				path='/admin/ai-health'
				element={
					<AdminAuthGuard>
						<AiHealthPage />
					</AdminAuthGuard>
				}
			/>
			<Route
				path='/admin/agents'
				element={
					<AdminAuthGuard>
						<AdminAgentsDashboardPage />
					</AdminAuthGuard>
				}
			/>
			<Route
				path='/admin/compliance'
				element={
					<AdminAuthGuard>
						<AdminCompliancePage />
					</AdminAuthGuard>
				}
			/>
			<Route
				path='/admin/eu-ai-act'
				element={
					<AdminAuthGuard>
						<EUAIActDashboard />
					</AdminAuthGuard>
				}
			/>
			<Route
				path='/admin/agent-dashboard'
				element={
					<AdminAuthGuard>
						<AgentDashboardPage />
					</AdminAuthGuard>
				}
			/>
			<Route
				path='/admin/analytics'
				element={
					<AdminAuthGuard>
						<AdminAnalyticsPage />
					</AdminAuthGuard>
				}
			/>
			<Route
				path='/admin/email-queue'
				element={
					<AdminAuthGuard>
						<AdminEmailQueuePage />
					</AdminAuthGuard>
				}
			/>

			<Route
				path='/recruiter/jobs/:jobId/panel-criteria'
				element={
					<Protected>
						<RecruiterGuard>
							<RecruiterPanelScorecardCriteriaPage />
						</RecruiterGuard>
					</Protected>
				}
			/>
			<Route path='/candidate/settings' element={<Navigate to='/settings' />} />

			{/* 404 Not Found */}
			<Route path='*' element={<NotFoundPage />} />
		</Routes>
	)
}

export default function App() {
	return (
		<ErrorBoundary>
			<BrowserRouter>
				<AuthProvider>
					<Suspense fallback={<PageLoading />}>
						<AppRoutes />
					</Suspense>
				</AuthProvider>
			</BrowserRouter>
		</ErrorBoundary>
	)
}
