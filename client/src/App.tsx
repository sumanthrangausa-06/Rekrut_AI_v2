import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AdminAuthGuard } from '@/components/admin-auth-guard'
import { ErrorBoundary, RouteErrorBoundary } from '@/components/error-boundary'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { AuthProvider, getDashboardPath, useAuth } from '@/contexts/auth-context'

// ─── Lazy page imports ───────────────────────────────────────────────────

// Public
const LandingPage = lazy(() => import('@/pages/landing').then((m) => ({ default: m.LandingPage })))
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
const CandidateOmniScorePage = lazy(() =>
	import('@/pages/candidate/omniscore').then((m) => ({ default: m.CandidateOmniScorePage })),
)
const CandidateDocumentsPage = lazy(() =>
	import('@/pages/candidate/documents').then((m) => ({ default: m.CandidateDocumentsPage })),
)
const CandidateScreeningPage = lazy(() =>
	import('@/pages/candidate/screening').then((m) => ({ default: m.CandidateScreeningPage })),
)
const CandidateChatPage = lazy(() =>
	import('@/pages/candidate/chat').then((m) => ({ default: m.CandidateChatPage })),
)
const InterviewPracticePage = lazy(() =>
	import('@/pages/candidate/interview-practice').then((m) => ({
		default: m.InterviewPracticePage,
	})),
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
const CompanyProfilePage = lazy(() =>
	import('@/pages/candidate/company-profile').then((m) => ({ default: m.CompanyProfilePage })),
)
const InterviewPage = lazy(() =>
	import('@/pages/candidate/interview').then((m) => ({ default: m.InterviewPage })),
)

// Recruiter pages
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
const RecruiterInterviewsPage = lazy(() =>
	import('@/pages/recruiter/interviews').then((m) => ({ default: m.RecruiterInterviewsPage })),
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
const RecruiterOnboardingAiPage = lazy(() =>
	import('@/pages/recruiter/onboarding-ai').then((m) => ({ default: m.RecruiterOnboardingAiPage })),
)
const RecruiterOnboardingDocsPage = lazy(() =>
	import('@/pages/recruiter/onboarding-docs').then((m) => ({
		default: m.RecruiterOnboardingDocsPage,
	})),
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

// Admin pages
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
	return <Navigate to={getDashboardPath(user.role)} replace />
}

function AppRoutes() {
	return (
		<Routes>
			{/* Public routes */}
			<Route path='/' element={<LandingPage />} />
			<Route path='/login' element={<LoginPage />} />
			<Route path='/register' element={<RegisterPage />} />
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
					path='ai-coaching'
					element={
						<Protected>
							<AiCoachingPage />
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
					path='offers/manage'
					element={
						<Protected>
							<OfferManagementPage />
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
			</Route>

			{/* Recruiter routes */}
			<Route path='/recruiter' element={<DashboardLayout />}>
				<Route
					index
					element={
						<Protected>
							<RecruiterDashboard />
						</Protected>
					}
				/>
				<Route
					path='jobs'
					element={
						<Protected>
							<RecruiterJobsPage />
						</Protected>
					}
				/>
				<Route
					path='jobs/new'
					element={
						<Protected>
							<RecruiterJobFormPage />
						</Protected>
					}
				/>
				<Route
					path='jobs/:id/applicants'
					element={
						<Protected>
							<RecruiterJobApplicantsPage />
						</Protected>
					}
				/>
				<Route
					path='jobs/:id/edit'
					element={
						<Protected>
							<RecruiterJobFormPage />
						</Protected>
					}
				/>
				<Route
					path='jobs/:id'
					element={
						<Protected>
							<RecruiterJobApplicantsPage />
						</Protected>
					}
				/>
				<Route
					path='jobs/:id/assessment'
					element={
						<Protected>
							<RecruiterJobAssessmentPage />
						</Protected>
					}
				/>
				<Route
					path='applications'
					element={
						<Protected>
							<RecruiterApplicationsPage />
						</Protected>
					}
				/>
				<Route
					path='assessments'
					element={
						<Protected>
							<RecruiterAssessmentsPage />
						</Protected>
					}
				/>
				<Route
					path='candidates'
					element={
						<Protected>
							<RecruiterCandidatesPage />
						</Protected>
					}
				/>
				<Route
					path='screening'
					element={
						<Protected>
							<RecruiterScreeningPage />
						</Protected>
					}
				/>
				<Route
					path='chat'
					element={
						<Protected>
							<RecruiterChatPage />
						</Protected>
					}
				/>
				<Route
					path='career-page'
					element={
						<Protected>
							<RecruiterCareerPage />
						</Protected>
					}
				/>
				<Route
					path='interviews'
					element={
						<Protected>
							<RecruiterInterviewsPage />
						</Protected>
					}
				/>
				<Route
					path='offers'
					element={
						<Protected>
							<RecruiterOffersPage />
						</Protected>
					}
				/>
				<Route
					path='onboarding'
					element={
						<Protected>
							<RecruiterOnboardingPage />
						</Protected>
					}
				/>
				<Route
					path='analytics'
					element={
						<Protected>
							<RecruiterAnalyticsPage />
						</Protected>
					}
				/>
				<Route
					path='communications'
					element={
						<Protected>
							<RecruiterCommunicationsPage />
						</Protected>
					}
				/>
				<Route
					path='trustscore'
					element={
						<Protected>
							<RecruiterTrustscorePage />
						</Protected>
					}
				/>
				<Route
					path='onboarding-ai'
					element={
						<Protected>
							<RecruiterOnboardingAiPage />
						</Protected>
					}
				/>
				<Route
					path='onboarding-docs'
					element={
						<Protected>
							<RecruiterOnboardingDocsPage />
						</Protected>
					}
				/>
				<Route
					path='company'
					element={
						<Protected>
							<RecruiterCompanyPage />
						</Protected>
					}
				/>
				<Route
					path='profile'
					element={
						<Protected>
							<RecruiterProfilePage />
						</Protected>
					}
				/>
				<Route
					path='payroll'
					element={
						<Protected>
							<RecruiterPayrollPage />
						</Protected>
					}
				/>
				<Route
					path='payroll-dashboard'
					element={
						<Protected>
							<RecruiterPayrollDashboardPage />
						</Protected>
					}
				/>
				<Route
					path='payroll-run/:id'
					element={
						<Protected>
							<RecruiterPayrollRunPage />
						</Protected>
					}
				/>
				<Route
					path='job-create'
					element={
						<Protected>
							<RecruiterJobCreatePage />
						</Protected>
					}
				/>
				<Route
					path='omniscore'
					element={
						<Protected>
							<RecruiterOmniScorePage />
						</Protected>
					}
				/>
				<Route
					path='post-hire-feedback'
					element={
						<Protected>
							<RecruiterPostHireFeedbackPage />
						</Protected>
					}
				/>
				<Route
					path='compliance'
					element={
						<Protected>
							<RecruiterCompliancePage />
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

			{/* Redirect /candidate/settings to /settings for backwards compatibility */}
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
