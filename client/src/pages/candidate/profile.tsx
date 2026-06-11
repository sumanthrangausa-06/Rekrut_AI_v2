import {
	Activity,
	AlertCircle,
	Award,
	Bell,
	BookOpen,
	Briefcase,
	Building2,
	Calendar,
	CheckCircle,
	ChevronRight,
	Clock,
	Code2,
	Crown,
	Eye,
	FileText,
	Github,
	Globe,
	GraduationCap,
	Heart,
	Layers,
	Link2,
	Linkedin,
	Loader2,
	Lock,
	MapPin,
	MessageCircle,
	Pencil,
	Phone,
	Plus,
	Save,
	Send,
	Settings,
	Sparkles,
	Star,
	Target,
	ThumbsUp,
	Trash2,
	TrendingUp,
	Upload,
	User,
	Wrench,
	X,
	Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Skeleton } from '@/components/domain/skeleton'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/auth-context'
import { apiCall } from '@/lib/api'

interface Profile {
	user_id?: number
	name?: string
	email?: string
	avatar_url?: string
	headline?: string
	bio?: string
	location?: string
	phone?: string
	linkedin_url?: string
	github_url?: string
	portfolio_url?: string
	resume_url?: string
	availability?: string
	salary_min?: number
	salary_max?: number
	preferred_job_types?: string[]
	preferred_locations?: string[]
	remote_preference?: string
	years_experience?: number
	// New fields
	omni_score?: number
	profile_views?: number
	applications_count?: number
	interview_rate?: number
	one_click_apply?: boolean
	certifications?: Certification[]
	projects?: Project[]
}

interface Certification {
	id: number
	name: string
	issuer: string
	issue_date?: string
	expiry_date?: string
	credential_url?: string
}

interface Project {
	id: number
	name: string
	description?: string
	url?: string
	skills?: string[]
}

interface Experience {
	id: number
	company_name: string
	title: string
	location?: string
	start_date?: string
	end_date?: string
	is_current?: boolean
	description?: string
	achievements?: string[]
	skills_used?: string[]
	company_logo?: string
}

interface Education {
	id: number
	institution: string
	degree: string
	field_of_study?: string
	start_date?: string
	end_date?: string
	is_current?: boolean
	gpa?: string
	achievements?: string[]
	institution_logo?: string
}

interface Skill {
	id: number
	skill_name: string
	category: string
	level: number
	years_experience?: number
	is_verified?: boolean
	endorsements?: number
	endorsed_by?: string[]
}

interface ActivityItem {
	id: string
	type:
		| 'profile_view'
		| 'application_update'
		| 'interview_invite'
		| 'skill_endorsement'
		| 'job_alert'
	title: string
	description: string
	timestamp: string
	read: boolean
}

interface SuggestedConnection {
	id: number
	name: string
	title: string
	company: string
	mutual_connections: number
	avatar_url?: string
}

interface JobAlert {
	id: number
	keywords: string
	location: string
	frequency: 'daily' | 'weekly' | 'instant'
	active: boolean
	match_count: number
}

const levelLabels: Record<number, string> = {
	1: 'Beginner',
	2: 'Elementary',
	3: 'Intermediate',
	4: 'Advanced',
	5: 'Expert',
}

const availabilityColors: Record<string, string> = {
	open: 'bg-green-100 text-green-700 border-green-200',
	actively_looking: 'bg-amber-100 text-amber-700 border-amber-200',
	not_looking: 'bg-slate-100 text-slate-700 border-slate-200',
	available_soon: 'bg-blue-100 text-blue-700 border-blue-200',
}

const availabilityLabels: Record<string, string> = {
	open: 'Open to Opportunities',
	actively_looking: 'Actively Looking',
	not_looking: 'Not Looking',
	available_soon: 'Available Soon',
}

export function CandidateProfilePage() {
	const { user } = useAuth()
	const _navigate = useNavigate()
	const [tab, setTab] = useState('overview')
	const [profile, setProfile] = useState<Profile>({})
	const [experience, setExperience] = useState<Experience[]>([])
	const [education, setEducation] = useState<Education[]>([])
	const [skills, setSkills] = useState<Skill[]>([])
	const [certifications, setCertifications] = useState<Certification[]>([])
	const [projects, setProjects] = useState<Project[]>([])
	const [activities, setActivities] = useState<ActivityItem[]>([])
	const [suggestedConnections, setSuggestedConnections] = useState<SuggestedConnection[]>([])
	const [jobAlerts, setJobAlerts] = useState<JobAlert[]>([])
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
	const [aiOptimizing, setAiOptimizing] = useState(false)
	const [aiTips, setAiTips] = useState<string[] | null>(null)

	useEffect(() => {
		loadProfile()
	}, [loadProfile])
	useEffect(() => {
		if (message) {
			const t = setTimeout(() => setMessage(null), 3000)
			return () => clearTimeout(t)
		}
	}, [message])

	async function loadProfile() {
		try {
			const data = await apiCall<{
				success: boolean
				profile: Profile
				experience: Experience[]
				education: Education[]
				skills: Skill[]
				certifications?: Certification[]
				projects?: Project[]
				activities?: ActivityItem[]
				suggested_connections?: SuggestedConnection[]
				job_alerts?: JobAlert[]
			}>('/candidate/profile')
			setProfile({
				...data.profile,
				name: data.profile.name || user?.name,
				email: data.profile.email || user?.email,
			})
			setExperience(data.experience || [])
			setEducation(data.education || [])
			setSkills(data.skills || [])
			setCertifications(data.certifications || [])
			setProjects(data.projects || [])
			setActivities(data.activities || [])
			setSuggestedConnections(data.suggested_connections || [])
			setJobAlerts(data.job_alerts || [])
		} catch {
		} finally {
			setLoading(false)
		}
	}

	function showMessage(type: 'success' | 'error', text: string) {
		setMessage({ type, text })
	}

	async function handleAiOptimize() {
		setAiOptimizing(true)
		setAiTips(null)
		try {
			const data = await apiCall<{
				success: boolean
				suggestions: {
					summary: string
					improvements: string[]
					missing_sections: string[]
					keyword_suggestions: string[]
				}
			}>('/candidate/ai/resume-optimizer', { method: 'POST' })
			if (data.suggestions) {
				const tips: string[] = []
				if (data.suggestions.summary) tips.push(data.suggestions.summary)
				if (data.suggestions.improvements?.length) tips.push(...data.suggestions.improvements)
				if (data.suggestions.missing_sections?.length)
					tips.push(`Missing sections: ${data.suggestions.missing_sections.join(', ')}`)
				if (data.suggestions.keyword_suggestions?.length)
					tips.push(`Add keywords: ${data.suggestions.keyword_suggestions.join(', ')}`)
				setAiTips(tips.length > 0 ? tips : ['Your profile looks great! Keep it updated.'])
				showMessage('success', 'AI analysis complete')
			}
		} catch {
			showMessage('error', 'AI optimization failed — try again')
		} finally {
			setAiOptimizing(false)
		}
	}

	// Profile completeness
	const completenessFields = [
		profile.name,
		profile.headline,
		profile.bio,
		profile.location,
		profile.linkedin_url || profile.github_url,
		profile.resume_url,
		skills.length > 0,
		experience.length > 0,
		education.length > 0,
		profile.phone,
		profile.years_experience != null,
		profile.avatar_url,
	]
	const completeness = Math.round(
		(completenessFields.filter(Boolean).length / completenessFields.length) * 100,
	)
	const missingSections = [
		!profile.name && 'Name',
		!profile.headline && 'Headline',
		!profile.bio && 'Bio',
		!profile.location && 'Location',
		!(profile.linkedin_url || profile.github_url) && 'Social Links',
		!profile.resume_url && 'Resume',
		skills.length === 0 && 'Skills',
		experience.length === 0 && 'Experience',
		education.length === 0 && 'Education',
		!profile.phone && 'Phone',
		profile.years_experience == null && 'Years of Experience',
		!profile.avatar_url && 'Profile Photo',
	].filter(Boolean) as string[]

	if (loading) {
		return (
			<div className='max-w-7xl mx-auto space-y-6'>
				<div className='bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/20 rounded-2xl border p-6 sm:p-8'>
					<div className='flex flex-col lg:flex-row gap-6 items-start'>
						<div className='h-20 w-20 rounded-xl bg-muted animate-pulse shrink-0' />
						<div className='space-y-3 flex-1 min-w-0'>
							<div className='h-8 w-48 rounded bg-muted animate-pulse' />
							<div className='h-4 w-64 rounded bg-muted animate-pulse' />
							<div className='h-4 w-40 rounded bg-muted animate-pulse' />
						</div>
					</div>
				</div>
				<div className='grid gap-4 lg:grid-cols-3'>
					<div className='lg:col-span-2 space-y-4'>
						<Skeleton variant='card' />
						<Skeleton variant='card' />
					</div>
					<div className='space-y-4'>
						<Skeleton variant='card' />
						<Skeleton variant='card' />
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className='max-w-7xl mx-auto space-y-6'>
			{/* Toast message */}
			{message && (
				<div
					className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
						message.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-destructive text-white'
					}`}
				>
					{message.type === 'success' ? (
						<CheckCircle className='h-4 w-4' />
					) : (
						<AlertCircle className='h-4 w-4' />
					)}
					{message.text}
				</div>
			)}

			{/* === PROFILE HEADER === */}
			<div className='bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/20 rounded-2xl border p-6 sm:p-8'>
				<div className='flex flex-col lg:flex-row gap-6 items-start'>
					{/* Left: Avatar + Info */}
					<div className='flex items-start gap-4 sm:gap-6 flex-1 min-w-0'>
						<AvatarUpload
							profile={profile}
							onUploaded={(url) => setProfile((p) => ({ ...p, avatar_url: url }))}
							showMessage={showMessage}
						/>
						<div className='min-w-0 flex-1'>
							<div className='flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3'>
								<h2 className='text-2xl sm:text-3xl font-bold truncate'>
									{profile.name || 'Your Name'}
								</h2>
								{profile.availability && (
									<Badge className={`text-xs ${availabilityColors[profile.availability] || ''}`}>
										{availabilityLabels[profile.availability] || profile.availability}
									</Badge>
								)}
							</div>
							<p className='text-lg text-muted-foreground mt-1'>
								{profile.headline || 'Add a professional headline'}
							</p>

							<div className='flex flex-wrap items-center gap-3 mt-3 text-sm text-muted-foreground'>
								{profile.location && (
									<span className='flex items-center gap-1'>
										<MapPin className='h-3.5 w-3.5' /> {profile.location}
									</span>
								)}
								{profile.email && (
									<span className='flex items-center gap-1'>✉ {profile.email}</span>
								)}
								{profile.phone && (
									<span className='flex items-center gap-1'>
										<Phone className='h-3.5 w-3.5' /> {profile.phone}
									</span>
								)}
								{profile.years_experience != null && (
									<span className='flex items-center gap-1'>
										<Clock className='h-3.5 w-3.5' /> {profile.years_experience} years exp.
									</span>
								)}
							</div>

							{/* Social links */}
							<div className='flex flex-wrap items-center gap-2 mt-3'>
								{profile.linkedin_url && (
									<a href={profile.linkedin_url} target='_blank' rel='noopener noreferrer'>
										<Badge variant='outline' className='gap-1 cursor-pointer hover:bg-muted'>
											<Linkedin className='h-3 w-3' /> LinkedIn
										</Badge>
									</a>
								)}
								{profile.github_url && (
									<a href={profile.github_url} target='_blank' rel='noopener noreferrer'>
										<Badge variant='outline' className='gap-1 cursor-pointer hover:bg-muted'>
											<Github className='h-3 w-3' /> GitHub
										</Badge>
									</a>
								)}
								{profile.portfolio_url && (
									<a href={profile.portfolio_url} target='_blank' rel='noopener noreferrer'>
										<Badge variant='outline' className='gap-1 cursor-pointer hover:bg-muted'>
											<Globe className='h-3 w-3' /> Portfolio
										</Badge>
									</a>
								)}
								{profile.resume_url && (
									<a href={profile.resume_url} target='_blank' rel='noopener noreferrer'>
										<Badge variant='secondary' className='gap-1 cursor-pointer hover:bg-muted'>
											<FileText className='h-3 w-3' /> Resume
										</Badge>
									</a>
								)}
							</div>
						</div>
					</div>

					{/* Right: OmniScore Ring + Analytics */}
					<div className='flex flex-col sm:flex-row gap-4 lg:items-center shrink-0'>
						<OmniScoreRing score={profile.omni_score || 75} />
						<div className='grid grid-cols-2 gap-2 lg:grid-cols-1'>
							<AnalyticsStat icon={Eye} value={profile.profile_views || 0} label='Profile Views' />
							<AnalyticsStat
								icon={Send}
								value={profile.applications_count || 0}
								label='Applications'
							/>
							<AnalyticsStat
								icon={Target}
								value={profile.interview_rate || 0}
								label='Interview Rate'
								unit='%'
							/>
							<AnalyticsStat icon={Heart} value={completeness} label='Completeness' unit='%' />
						</div>
					</div>
				</div>
			</div>

			{/* === AI OPTIMIZATION TIPS === */}
			{aiTips && aiTips.length > 0 && (
				<Card className='border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20'>
					<CardContent className='p-4'>
						<div className='flex items-start gap-3'>
							<Sparkles className='h-5 w-5 text-blue-600 mt-0.5 shrink-0' />
							<div className='flex-1 space-y-2'>
								<div className='flex items-center justify-between'>
									<h4 className='font-semibold text-blue-900 dark:text-blue-100 text-sm'>
										AI Profile Optimization Tips
									</h4>
									<Button
										variant='ghost'
										size='sm'
										onClick={() => setAiTips(null)}
										className='h-6 w-6 min-h-[44px] min-w-[44px] p-0'
									>
										<X className='h-3 w-3' />
									</Button>
								</div>
								<ul className='space-y-1.5'>
									{aiTips.map((tip, i) => (
										<li
											key={i}
											className='text-sm text-blue-800 dark:text-blue-200 flex items-start gap-2'
										>
											<CheckCircle className='h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-500' />
											{tip}
										</li>
									))}
								</ul>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* === PROFILE COMPLETENESS BAR === */}
			<Card>
				<CardContent className='p-4'>
					<div className='flex items-center gap-4'>
						<div className='flex-1'>
							<div className='flex items-center justify-between mb-2'>
								<div className='flex items-center gap-2'>
									<Target className='h-4 w-4 text-primary' />
									<span className='font-semibold text-sm'>Profile Completeness</span>
								</div>
								<span
									className={`text-sm font-bold ${completeness >= 80 ? 'text-emerald-600' : completeness >= 50 ? 'text-amber-500' : 'text-red-500'}`}
								>
									{completeness}%
								</span>
							</div>
							<Progress value={completeness} className='h-2' />
						</div>
						<Button
							variant='outline'
							size='sm'
							onClick={handleAiOptimize}
							disabled={aiOptimizing}
							className='gap-1.5 border-primary/30 text-primary hover:bg-primary hover:text-white transition-colors shrink-0'
						>
							{aiOptimizing ? (
								<Loader2 className='h-3.5 w-3.5 animate-spin' />
							) : (
								<Sparkles className='h-3.5 w-3.5' />
							)}
							{aiOptimizing ? 'Analyzing...' : 'AI Tips'}
						</Button>
					</div>
					{missingSections.length > 0 && completeness < 100 && (
						<div className='mt-3 flex flex-wrap gap-1.5'>
							<span className='text-xs text-muted-foreground'>Missing:</span>
							{missingSections.slice(0, 5).map((section) => (
								<Badge
									key={section}
									variant='outline'
									className='text-[10px] h-5 cursor-pointer hover:bg-muted'
									onClick={() => {
										if (section === 'Skills') setTab('skills')
										else if (section === 'Experience') setTab('experience')
										else if (section === 'Education') setTab('education')
										else setTab('personal')
									}}
								>
									{section}
								</Badge>
							))}
							{missingSections.length > 5 && (
								<span className='text-xs text-muted-foreground'>
									+{missingSections.length - 5} more
								</span>
							)}
						</div>
					)}
				</CardContent>
			</Card>

			{/* === ONE-CLICK APPLY TOGGLE === */}
			<div className='flex items-center justify-between bg-muted/50 rounded-lg p-4'>
				<div className='flex items-center gap-3'>
					<div
						className={`h-10 w-10 rounded-lg flex items-center justify-center ${profile.one_click_apply ? 'bg-green-100' : 'bg-muted'}`}
					>
						{profile.one_click_apply ? (
							<Zap className='h-5 w-5 text-green-600' />
						) : (
							<Lock className='h-5 w-5 text-muted-foreground' />
						)}
					</div>
					<div>
						<p className='font-semibold text-sm'>One-Click Apply</p>
						<p className='text-xs text-muted-foreground'>
							{profile.one_click_apply
								? 'Active — AI will generate tailored resumes and apply instantly for matching jobs'
								: 'Disabled — You will need to review each application before submitting'}
						</p>
					</div>
				</div>
				<Switch
					checked={profile.one_click_apply || false}
					onCheckedChange={async (checked) => {
						try {
							await apiCall('/candidate/profile', {
								method: 'PUT',
								body: { one_click_apply: checked },
							})
							setProfile((p) => ({ ...p, one_click_apply: checked }))
							showMessage(
								'success',
								checked ? 'One-click apply enabled' : 'One-click apply disabled',
							)
						} catch {
							showMessage('error', 'Failed to update')
						}
					}}
				/>
			</div>

			{/* === TAB NAVIGATION === */}
			<div className='border-b'>
				<div className='flex gap-1 overflow-x-auto'>
					{[
						{ key: 'overview', label: 'Overview', icon: User },
						{ key: 'experience', label: 'Experience', icon: Briefcase },
						{ key: 'education', label: 'Education', icon: GraduationCap },
						{ key: 'skills', label: 'Skills', icon: Wrench },
						{ key: 'portfolio', label: 'Portfolio', icon: BookOpen },
						{ key: 'activity', label: 'Activity', icon: Activity },
						{ key: 'alerts', label: 'Job Alerts', icon: Bell },
						{ key: 'personal', label: 'Settings', icon: Settings },
					].map(({ key, label, icon: Icon }) => (
						<button
							key={key}
							onClick={() => setTab(key)}
							className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 whitespace-nowrap min-h-[44px] ${
								tab === key
									? 'border-primary text-primary'
									: 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
							}`}
						>
							<Icon className='h-4 w-4' />
							{label}
						</button>
					))}
				</div>
			</div>

			{/* === TAB CONTENT === */}
			<div className='min-h-[400px]'>
				{tab === 'overview' && (
					<OverviewTab
						profile={profile}
						experience={experience}
						education={education}
						skills={skills}
						certifications={certifications}
						projects={projects}
						suggestedConnections={suggestedConnections}
						completeness={completeness}
						missingSections={missingSections}
						setTab={setTab}
					/>
				)}
				{tab === 'personal' && (
					<PersonalInfoTab
						profile={profile}
						setProfile={setProfile}
						saving={saving}
						setSaving={setSaving}
						showMessage={showMessage}
					/>
				)}
				{tab === 'experience' && (
					<ExperienceTab
						experience={experience}
						setExperience={setExperience}
						showMessage={showMessage}
					/>
				)}
				{tab === 'education' && (
					<EducationTab
						education={education}
						setEducation={setEducation}
						showMessage={showMessage}
					/>
				)}
				{tab === 'skills' && (
					<SkillsTab skills={skills} setSkills={setSkills} showMessage={showMessage} />
				)}
				{tab === 'portfolio' && (
					<PortfolioTab
						certifications={certifications}
						setCertifications={setCertifications}
						projects={projects}
						setProjects={setProjects}
						showMessage={showMessage}
					/>
				)}
				{tab === 'activity' && <ActivityTab activities={activities} />}
				{tab === 'alerts' && (
					<JobAlertsTab
						jobAlerts={jobAlerts}
						setJobAlerts={setJobAlerts}
						showMessage={showMessage}
					/>
				)}
			</div>
		</div>
	)
}

// ====== OMNISCORE RING ======
function OmniScoreRing({ score }: { score: number }) {
	const radius = 36
	const circumference = 2 * Math.PI * radius
	const strokeDashoffset = circumference - (score / 100) * circumference
	const color = score >= 80 ? 'text-green-500' : score >= 60 ? 'text-amber-500' : 'text-red-400'

	return (
		<div className='relative flex flex-col items-center'>
			<div className='relative h-20 w-20'>
				<svg className='h-20 w-20 -rotate-90' viewBox='0 0 80 80'>
					<circle cx='40' cy='40' r={radius} className='stroke-muted fill-none' strokeWidth='6' />
					<circle
						cx='40'
						cy='40'
						r={radius}
						className={`fill-none ${color} transition-all duration-1000`}
						strokeWidth='6'
						strokeDasharray={circumference}
						strokeDashoffset={strokeDashoffset}
						strokeLinecap='round'
					/>
				</svg>
				<div className='absolute inset-0 flex flex-col items-center justify-center'>
					<span className='text-lg font-bold leading-none'>{score}</span>
					<span className='text-[9px] text-muted-foreground uppercase'>OmniScore</span>
				</div>
			</div>
		</div>
	)
}

function AnalyticsStat({
	icon: Icon,
	value,
	label,
	unit,
}: {
	icon: typeof Eye
	value: number
	label: string
	unit?: string
}) {
	return (
		<div className='flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2'>
			<Icon className='h-4 w-4 text-muted-foreground shrink-0' />
			<div>
				<p className='text-sm font-bold leading-tight'>
					{value}
					{unit || ''}
				</p>
				<p className='text-[10px] text-muted-foreground leading-tight'>{label}</p>
			</div>
		</div>
	)
}

// ====== OVERVIEW TAB ======
function OverviewTab({
	profile,
	experience,
	education,
	skills,
	certifications,
	projects,
	suggestedConnections,
	completeness,
	missingSections,
	setTab,
}: {
	profile: Profile
	experience: Experience[]
	education: Education[]
	skills: Skill[]
	certifications: Certification[]
	projects: Project[]
	suggestedConnections: SuggestedConnection[]
	completeness: number
	missingSections: string[]
	setTab: (tab: string) => void
}) {
	const topSkills = skills.slice(0, 6)
	const latestExperience = experience.slice(0, 3)
	const latestEducation = education.slice(0, 2)

	return (
		<div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
			{/* Left column: Bio + Experience + Education */}
			<div className='lg:col-span-2 space-y-6'>
				{/* Bio */}
				<Card>
					<CardContent className='p-5'>
						<h3 className='font-semibold text-sm mb-2 flex items-center gap-2'>
							<User className='h-4 w-4' /> About
						</h3>
						{profile.bio ? (
							<p className='text-sm text-muted-foreground whitespace-pre-wrap'>{profile.bio}</p>
						) : (
							<div className='text-sm text-muted-foreground'>
								<p>
									No bio added yet. Add a professional summary to help employers understand your
									background.
								</p>
								<Button
									variant='outline'
									size='sm'
									className='mt-2 gap-1'
									onClick={() => setTab('personal')}
								>
									<Pencil className='h-3 w-3' /> Add Bio
								</Button>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Experience Preview */}
				<Card>
					<CardContent className='p-5'>
						<div className='flex items-center justify-between mb-4'>
							<h3 className='font-semibold text-sm flex items-center gap-2'>
								<Briefcase className='h-4 w-4' /> Experience
							</h3>
							<Button
								variant='ghost'
								size='sm'
								className='gap-1 text-xs'
								onClick={() => setTab('experience')}
							>
								View All <ChevronRight className='h-3 w-3' />
							</Button>
						</div>
						{latestExperience.length === 0 ? (
							<p className='text-sm text-muted-foreground'>No work experience added yet.</p>
						) : (
							<div className='space-y-4'>
								{latestExperience.map((exp) => (
									<div key={exp.id} className='flex gap-3'>
										<div className='relative flex flex-col items-center'>
											<div className='h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0'>
												<Building2 className='h-4 w-4 text-primary' />
											</div>
											{latestExperience.length > 1 && (
												<div className='w-px flex-1 bg-border mt-1' />
											)}
										</div>
										<div className='pb-4'>
											<h4 className='font-semibold text-sm'>{exp.title}</h4>
											<p className='text-sm text-muted-foreground'>
												{exp.company_name}
												{exp.location && ` · ${exp.location}`}
											</p>
											<p className='text-xs text-muted-foreground mt-0.5'>
												{exp.start_date
													? new Date(exp.start_date).toLocaleDateString('en-US', {
															month: 'short',
															year: 'numeric',
														})
													: 'Start'}{' '}
												—{' '}
												{exp.is_current
													? 'Present'
													: exp.end_date
														? new Date(exp.end_date).toLocaleDateString('en-US', {
																month: 'short',
																year: 'numeric',
															})
														: 'End'}
											</p>
											{exp.description && (
												<p className='text-xs text-muted-foreground mt-1 line-clamp-2'>
													{exp.description}
												</p>
											)}
										</div>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Education Preview */}
				<Card>
					<CardContent className='p-5'>
						<div className='flex items-center justify-between mb-4'>
							<h3 className='font-semibold text-sm flex items-center gap-2'>
								<GraduationCap className='h-4 w-4' /> Education
							</h3>
							<Button
								variant='ghost'
								size='sm'
								className='gap-1 text-xs'
								onClick={() => setTab('education')}
							>
								View All <ChevronRight className='h-3 w-3' />
							</Button>
						</div>
						{latestEducation.length === 0 ? (
							<p className='text-sm text-muted-foreground'>No education added yet.</p>
						) : (
							<div className='space-y-3'>
								{latestEducation.map((edu) => (
									<div key={edu.id} className='flex items-start gap-3'>
										<div className='h-8 w-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0'>
											<GraduationCap className='h-4 w-4 text-indigo-600' />
										</div>
										<div>
											<h4 className='font-semibold text-sm'>
												{edu.degree}
												{edu.field_of_study ? ` in ${edu.field_of_study}` : ''}
											</h4>
											<p className='text-sm text-muted-foreground'>{edu.institution}</p>
											<p className='text-xs text-muted-foreground'>
												{edu.start_date ? new Date(edu.start_date).getFullYear() : 'Start'} —{' '}
												{edu.is_current
													? 'Present'
													: edu.end_date
														? new Date(edu.end_date).getFullYear()
														: 'End'}
												{edu.gpa && ` · GPA: ${edu.gpa}`}
											</p>
										</div>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Right column: Skills + Connections + Certifications */}
			<div className='space-y-6'>
				{/* Skills preview */}
				<Card>
					<CardContent className='p-5'>
						<div className='flex items-center justify-between mb-3'>
							<h3 className='font-semibold text-sm flex items-center gap-2'>
								<Wrench className='h-4 w-4' /> Top Skills ({skills.length})
							</h3>
							<Button
								variant='ghost'
								size='sm'
								className='gap-1 text-xs'
								onClick={() => setTab('skills')}
							>
								Manage <ChevronRight className='h-3 w-3' />
							</Button>
						</div>
						{topSkills.length === 0 ? (
							<p className='text-sm text-muted-foreground'>No skills added yet.</p>
						) : (
							<div className='flex flex-wrap gap-1.5'>
								{topSkills.map((skill) => (
									<Badge
										key={skill.id}
										variant={skill.is_verified ? 'default' : 'secondary'}
										className='text-xs h-6 gap-1'
									>
										{skill.is_verified && <Award className='h-3 w-3' />}
										{skill.skill_name}
										<span className='text-[10px] opacity-70'>{levelLabels[skill.level]}</span>
										{skill.endorsements && skill.endorsements > 0 && (
											<span className='text-[10px] flex items-center gap-0.5'>
												<ThumbsUp className='h-2.5 w-2.5' />
												{skill.endorsements}
											</span>
										)}
									</Badge>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Certifications preview */}
				<Card>
					<CardContent className='p-5'>
						<div className='flex items-center justify-between mb-3'>
							<h3 className='font-semibold text-sm flex items-center gap-2'>
								<Crown className='h-4 w-4' /> Certifications
							</h3>
							<Button
								variant='ghost'
								size='sm'
								className='gap-1 text-xs'
								onClick={() => setTab('portfolio')}
							>
								Manage <ChevronRight className='h-3 w-3' />
							</Button>
						</div>
						{certifications.length === 0 ? (
							<p className='text-sm text-muted-foreground'>No certifications added yet.</p>
						) : (
							<div className='space-y-2'>
								{certifications.slice(0, 3).map((cert) => (
									<div key={cert.id} className='flex items-center gap-2'>
										<Award className='h-4 w-4 text-amber-500 shrink-0' />
										<div className='min-w-0'>
											<p className='text-sm font-medium truncate'>{cert.name}</p>
											<p className='text-xs text-muted-foreground'>{cert.issuer}</p>
										</div>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Projects preview */}
				<Card>
					<CardContent className='p-5'>
						<div className='flex items-center justify-between mb-3'>
							<h3 className='font-semibold text-sm flex items-center gap-2'>
								<Code2 className='h-4 w-4' /> Projects
							</h3>
							<Button
								variant='ghost'
								size='sm'
								className='gap-1 text-xs'
								onClick={() => setTab('portfolio')}
							>
								Manage <ChevronRight className='h-3 w-3' />
							</Button>
						</div>
						{projects.length === 0 ? (
							<p className='text-sm text-muted-foreground'>No projects added yet.</p>
						) : (
							<div className='space-y-2'>
								{projects.slice(0, 3).map((proj) => (
									<div key={proj.id} className='flex items-center gap-2'>
										<Layers className='h-4 w-4 text-primary shrink-0' />
										<div className='min-w-0'>
											<p className='text-sm font-medium truncate'>{proj.name}</p>
											{proj.skills && proj.skills.length > 0 && (
												<p className='text-xs text-muted-foreground'>
													{proj.skills.slice(0, 3).join(', ')}
												</p>
											)}
										</div>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Suggested Connections */}
				{suggestedConnections.length > 0 && (
					<Card>
						<CardContent className='p-5'>
							<h3 className='font-semibold text-sm mb-3 flex items-center gap-2'>
								<MessageCircle className='h-4 w-4' /> People You May Know
							</h3>
							<div className='space-y-3'>
								{suggestedConnections.slice(0, 3).map((conn) => (
									<div key={conn.id} className='flex items-center gap-3'>
										<Avatar src={conn.avatar_url} fallback={conn.name.charAt(0)} size='sm' />
										<div className='min-w-0 flex-1'>
											<p className='text-sm font-medium truncate'>{conn.name}</p>
											<p className='text-xs text-muted-foreground truncate'>
												{conn.title} at {conn.company}
											</p>
											<p className='text-[10px] text-muted-foreground'>
												{conn.mutual_connections} mutual connections
											</p>
										</div>
										<Button variant='outline' size='sm' className='min-h-[44px] px-2 text-xs gap-1'>
											<Plus className='h-3 w-3' /> Connect
										</Button>
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	)
}

// ====== AVATAR UPLOAD ======
function AvatarUpload({
	profile,
	onUploaded,
	showMessage,
}: {
	profile: Profile
	onUploaded: (url: string) => void
	showMessage: (type: 'success' | 'error', text: string) => void
}) {
	const fileRef = useRef<HTMLInputElement>(null)
	const [uploading, setUploading] = useState(false)

	async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0]
		if (!file) return
		setUploading(true)
		try {
			const formData = new FormData()
			formData.append('photo', file)
			const data = await apiCall<{ success: boolean; photo_url: string }>(
				'/candidate/profile/photo',
				{
					method: 'POST',
					body: formData,
					isFormData: true,
				},
			)
			onUploaded(data.photo_url)
			showMessage('success', 'Photo updated')
		} catch {
			showMessage('error', 'Failed to upload photo')
		} finally {
			setUploading(false)
		}
	}

	return (
		<div className='relative group'>
			<div className='h-24 w-24 sm:h-28 sm:w-28 rounded-full bg-muted flex items-center justify-center overflow-hidden border-4 border-white shadow-lg'>
				{profile.avatar_url ? (
					<img src={profile.avatar_url} alt='Avatar' className='h-full w-full object-cover' />
				) : (
					<User className='h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground' />
				)}
			</div>
			<button
				onClick={() => fileRef.current?.click()}
				disabled={uploading}
				className='absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity'
			>
				{uploading ? (
					<div className='h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent' />
				) : (
					<Upload className='h-6 w-6 text-white' />
				)}
			</button>
			<input
				ref={fileRef}
				type='file'
				accept='image/*'
				className='hidden'
				onChange={handleUpload}
			/>
		</div>
	)
}

// ====== PERSONAL INFO TAB ======
function PersonalInfoTab({
	profile,
	setProfile,
	saving,
	setSaving,
	showMessage,
}: {
	profile: Profile
	setProfile: React.Dispatch<React.SetStateAction<Profile>>
	saving: boolean
	setSaving: React.Dispatch<React.SetStateAction<boolean>>
	showMessage: (type: 'success' | 'error', text: string) => void
}) {
	function updateField(key: string, value: string | number) {
		setProfile((p) => ({ ...p, [key]: value }))
	}

	async function handleSave() {
		setSaving(true)
		try {
			await apiCall('/candidate/profile', { method: 'PUT', body: profile })
			showMessage('success', 'Profile saved')
		} catch {
			showMessage('error', 'Failed to save profile')
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
			<div className='lg:col-span-2 space-y-6'>
				<Card>
					<CardContent className='p-6 space-y-6'>
						<h3 className='font-semibold flex items-center gap-2'>
							<User className='h-4 w-4' /> Personal Information
						</h3>
						<div className='grid gap-4 sm:grid-cols-2'>
							<div>
								<Label>Full Name</Label>
								<Input
									value={profile.name || ''}
									onChange={(e) => updateField('name', e.target.value)}
									placeholder='John Doe'
								/>
							</div>
							<div>
								<Label>Headline</Label>
								<Input
									value={profile.headline || ''}
									onChange={(e) => updateField('headline', e.target.value)}
									placeholder='Senior Software Engineer'
								/>
							</div>
							<div>
								<Label>Phone</Label>
								<Input
									value={profile.phone || ''}
									onChange={(e) => updateField('phone', e.target.value)}
									placeholder='+1 (555) 000-0000'
								/>
							</div>
							<div>
								<Label>Location</Label>
								<Input
									value={profile.location || ''}
									onChange={(e) => updateField('location', e.target.value)}
									placeholder='San Francisco, CA'
								/>
							</div>
						</div>
						<div>
							<Label>Bio / Summary</Label>
							<Textarea
								value={profile.bio || ''}
								onChange={(e) => updateField('bio', e.target.value)}
								placeholder='Brief professional summary...'
								rows={4}
							/>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardContent className='p-6 space-y-6'>
						<h3 className='font-semibold flex items-center gap-2'>
							<Link2 className='h-4 w-4' /> Social Links
						</h3>
						<div className='grid gap-4 sm:grid-cols-2'>
							<div>
								<Label className='flex items-center gap-1'>
									<Linkedin className='h-3 w-3' /> LinkedIn
								</Label>
								<Input
									value={profile.linkedin_url || ''}
									onChange={(e) => updateField('linkedin_url', e.target.value)}
									placeholder='https://linkedin.com/in/...'
								/>
							</div>
							<div>
								<Label className='flex items-center gap-1'>
									<Github className='h-3 w-3' /> GitHub
								</Label>
								<Input
									value={profile.github_url || ''}
									onChange={(e) => updateField('github_url', e.target.value)}
									placeholder='https://github.com/...'
								/>
							</div>
							<div>
								<Label className='flex items-center gap-1'>
									<Globe className='h-3 w-3' /> Portfolio
								</Label>
								<Input
									value={profile.portfolio_url || ''}
									onChange={(e) => updateField('portfolio_url', e.target.value)}
									placeholder='https://yoursite.com'
								/>
							</div>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardContent className='p-6 space-y-6'>
						<h3 className='font-semibold flex items-center gap-2'>
							<Briefcase className='h-4 w-4' /> Preferences
						</h3>
						<div className='grid gap-4 sm:grid-cols-2'>
							<div>
								<Label>Years of Experience</Label>
								<Input
									type='number'
									value={profile.years_experience ?? ''}
									onChange={(e) =>
										updateField('years_experience', parseInt(e.target.value, 10) || 0)
									}
									placeholder='5'
								/>
							</div>
							<div>
								<Label>Remote Preference</Label>
								<select
									value={profile.remote_preference || 'hybrid'}
									onChange={(e) => updateField('remote_preference', e.target.value)}
									className='flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm'
								>
									<option value='remote'>Remote Only</option>
									<option value='hybrid'>Hybrid</option>
									<option value='onsite'>On-site</option>
									<option value='flexible'>Flexible</option>
								</select>
							</div>
							<div>
								<Label>Availability</Label>
								<select
									value={profile.availability || 'open'}
									onChange={(e) => updateField('availability', e.target.value)}
									className='flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm'
								>
									<option value='open'>Open to Opportunities</option>
									<option value='actively_looking'>Actively Looking</option>
									<option value='not_looking'>Not Looking</option>
									<option value='available_soon'>Available Soon</option>
								</select>
							</div>
							<div>
								<Label>Minimum Salary ($)</Label>
								<Input
									type='number'
									value={profile.salary_min ?? ''}
									onChange={(e) => updateField('salary_min', parseInt(e.target.value, 10) || 0)}
									placeholder='80000'
								/>
							</div>
							<div>
								<Label>Maximum Salary ($)</Label>
								<Input
									type='number'
									value={profile.salary_max ?? ''}
									onChange={(e) => updateField('salary_max', parseInt(e.target.value, 10) || 0)}
									placeholder='150000'
								/>
							</div>
						</div>
					</CardContent>
				</Card>

				<div className='flex justify-end'>
					<Button onClick={handleSave} disabled={saving} className='gap-2'>
						{saving ? (
							<div className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
						) : (
							<Save className='h-4 w-4' />
						)}
						Save Changes
					</Button>
				</div>
			</div>

			{/* Right sidebar: tips */}
			<div className='space-y-4'>
				<Card className='bg-muted/50 border-dashed'>
					<CardContent className='p-4 space-y-3'>
						<h4 className='font-semibold text-sm flex items-center gap-2'>
							<Sparkles className='h-4 w-4 text-primary' /> Profile Tips
						</h4>
						<ul className='space-y-2 text-sm text-muted-foreground'>
							<li className='flex items-start gap-2'>
								<CheckCircle className='h-3.5 w-3.5 mt-0.5 shrink-0 text-green-500' /> Add a
								professional photo
							</li>
							<li className='flex items-start gap-2'>
								<CheckCircle className='h-3.5 w-3.5 mt-0.5 shrink-0 text-green-500' /> Write a
								compelling headline
							</li>
							<li className='flex items-start gap-2'>
								<CheckCircle className='h-3.5 w-3.5 mt-0.5 shrink-0 text-green-500' /> Include
								salary expectations
							</li>
							<li className='flex items-start gap-2'>
								<CheckCircle className='h-3.5 w-3.5 mt-0.5 shrink-0 text-green-500' /> Link your
								GitHub & LinkedIn
							</li>
							<li className='flex items-start gap-2'>
								<CheckCircle className='h-3.5 w-3.5 mt-0.5 shrink-0 text-green-500' /> Set your
								availability status
							</li>
						</ul>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}

// ====== EXPERIENCE TAB ======
function ExperienceTab({
	experience,
	setExperience,
	showMessage,
}: {
	experience: Experience[]
	setExperience: React.Dispatch<React.SetStateAction<Experience[]>>
	showMessage: (type: 'success' | 'error', text: string) => void
}) {
	const [editing, setEditing] = useState<Experience | null>(null)
	const [isNew, setIsNew] = useState(false)

	function openNew() {
		setEditing({ id: 0, company_name: '', title: '', is_current: false })
		setIsNew(true)
	}
	function openEdit(exp: Experience) {
		setEditing({ ...exp })
		setIsNew(false)
	}

	async function handleSave() {
		if (!editing) return
		try {
			if (isNew) {
				const data = await apiCall<{ success: boolean; experience: Experience }>(
					'/candidate/experience',
					{ method: 'POST', body: editing },
				)
				setExperience((prev) => [data.experience, ...prev])
			} else {
				const data = await apiCall<{ success: boolean; experience: Experience }>(
					`/candidate/experience/${editing.id}`,
					{ method: 'PUT', body: editing },
				)
				setExperience((prev) => prev.map((e) => (e.id === editing.id ? data.experience : e)))
			}
			setEditing(null)
			showMessage('success', isNew ? 'Experience added' : 'Experience updated')
		} catch {
			showMessage('error', 'Failed to save experience')
		}
	}

	async function handleDelete(id: number) {
		try {
			await apiCall(`/candidate/experience/${id}`, { method: 'DELETE' })
			setExperience((prev) => prev.filter((e) => e.id !== id))
			showMessage('success', 'Experience removed')
		} catch {
			showMessage('error', 'Failed to delete experience')
		}
	}

	return (
		<div className='space-y-6'>
			<div className='flex items-center justify-between'>
				<h3 className='font-semibold text-lg flex items-center gap-2'>
					<Briefcase className='h-5 w-5' /> Work Experience
				</h3>
				<Button size='sm' onClick={openNew} className='gap-1'>
					<Plus className='h-4 w-4' /> Add Experience
				</Button>
			</div>

			{experience.length === 0 ? (
				<Card>
					<CardContent className='py-16 text-center'>
						<Briefcase className='mx-auto mb-3 h-12 w-12 opacity-20' />
						<p className='text-muted-foreground mb-4'>No work experience added yet</p>
						<Button onClick={openNew} className='gap-1'>
							<Plus className='h-4 w-4' /> Add Experience
						</Button>
					</CardContent>
				</Card>
			) : (
				<div className='space-y-4'>
					{experience.map((exp, index) => (
						<Card key={exp.id} className='overflow-hidden'>
							<CardContent className='p-5'>
								<div className='flex items-start gap-4'>
									{/* Timeline visual */}
									<div className='flex flex-col items-center'>
										<div className='h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0'>
											<Building2 className='h-5 w-5 text-primary' />
										</div>
										{index < experience.length - 1 && (
											<div className='w-px flex-1 bg-border mt-2' />
										)}
									</div>
									<div className='flex-1 min-w-0'>
										<div className='flex items-start justify-between gap-2'>
											<div>
												<h4 className='font-semibold'>{exp.title}</h4>
												<p className='text-sm text-muted-foreground flex items-center gap-1.5'>
													<Building2 className='h-3.5 w-3.5' /> {exp.company_name}
													{exp.location && (
														<>
															<span>·</span>
															<MapPin className='h-3.5 w-3.5' /> {exp.location}
														</>
													)}
												</p>
												<p className='text-xs text-muted-foreground mt-1 flex items-center gap-1'>
													<Calendar className='h-3 w-3' />
													{exp.start_date
														? new Date(exp.start_date).toLocaleDateString('en-US', {
																month: 'short',
																year: 'numeric',
															})
														: 'Start'}{' '}
													—{' '}
													{exp.is_current
														? 'Present'
														: exp.end_date
															? new Date(exp.end_date).toLocaleDateString('en-US', {
																	month: 'short',
																	year: 'numeric',
																})
															: 'End'}
												</p>
												{exp.description && (
													<p className='text-sm mt-2 text-muted-foreground'>{exp.description}</p>
												)}
												{exp.achievements &&
													Array.isArray(exp.achievements) &&
													exp.achievements.length > 0 && (
														<ul className='mt-2 space-y-1'>
															{exp.achievements.map((a, i) => (
																<li
																	key={i}
																	className='text-xs text-muted-foreground flex items-start gap-1.5'
																>
																	<Star className='h-3 w-3 text-amber-400 mt-0.5 shrink-0' />
																	{a}
																</li>
															))}
														</ul>
													)}
												{exp.skills_used &&
													Array.isArray(exp.skills_used) &&
													exp.skills_used.length > 0 && (
														<div className='flex flex-wrap gap-1 mt-2'>
															{(typeof exp.skills_used === 'string'
																? JSON.parse(exp.skills_used)
																: exp.skills_used
															).map((s: string) => (
																<Badge key={s} variant='secondary' className='text-[10px]'>
																	{s}
																</Badge>
															))}
														</div>
													)}
											</div>
											<div className='flex items-center gap-1 shrink-0'>
												<Button variant='ghost' size='sm' onClick={() => openEdit(exp)}>
													<Pencil className='h-3.5 w-3.5' />
												</Button>
												<Button
													variant='ghost'
													size='sm'
													onClick={() => handleDelete(exp.id)}
													className='text-destructive hover:text-destructive'
												>
													<Trash2 className='h-3.5 w-3.5' />
												</Button>
											</div>
										</div>
									</div>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			{/* Edit dialog */}
			{editing && (
				<div className='fixed inset-0 z-50 flex items-end sm:items-center justify-center'>
					<div className='fixed inset-0 bg-black/50' onClick={() => setEditing(null)} />
					<div className='relative z-50 w-full max-w-lg max-h-[85vh] sm:max-h-[90vh] overflow-y-auto border bg-background p-4 sm:p-6 shadow-lg rounded-t-2xl sm:rounded-lg'>
						<button onClick={() => setEditing(null)} className='absolute right-3 top-3'>
							<X className='h-4 w-4' />
						</button>
						<h2 className='text-lg font-semibold mb-4'>
							{isNew ? 'Add Experience' : 'Edit Experience'}
						</h2>
						<div className='space-y-4'>
							<div className='grid gap-3 sm:grid-cols-2'>
								<div>
									<Label>Job Title *</Label>
									<Input
										value={editing.title}
										onChange={(e) => setEditing({ ...editing, title: e.target.value })}
										placeholder='Software Engineer'
									/>
								</div>
								<div>
									<Label>Company *</Label>
									<Input
										value={editing.company_name}
										onChange={(e) => setEditing({ ...editing, company_name: e.target.value })}
										placeholder='Acme Corp'
									/>
								</div>
								<div>
									<Label>Location</Label>
									<Input
										value={editing.location || ''}
										onChange={(e) => setEditing({ ...editing, location: e.target.value })}
										placeholder='San Francisco, CA'
									/>
								</div>
								<div className='flex items-end'>
									<label className='flex items-center gap-2 cursor-pointer'>
										<input
											type='checkbox'
											checked={editing.is_current || false}
											onChange={(e) =>
												setEditing({
													...editing,
													is_current: e.target.checked,
													end_date: e.target.checked ? undefined : editing.end_date,
												})
											}
											className='rounded'
										/>
										<span className='text-sm'>Current Position</span>
									</label>
								</div>
								<div>
									<Label>Start Date</Label>
									<Input
										type='date'
										value={editing.start_date?.split('T')[0] || ''}
										onChange={(e) => setEditing({ ...editing, start_date: e.target.value })}
									/>
								</div>
								{!editing.is_current && (
									<div>
										<Label>End Date</Label>
										<Input
											type='date'
											value={editing.end_date?.split('T')[0] || ''}
											onChange={(e) => setEditing({ ...editing, end_date: e.target.value })}
										/>
									</div>
								)}
							</div>
							<div>
								<Label>Description</Label>
								<Textarea
									value={editing.description || ''}
									onChange={(e) => setEditing({ ...editing, description: e.target.value })}
									placeholder='Describe your responsibilities and achievements...'
									rows={4}
								/>
							</div>
							<div className='flex justify-end gap-2 pt-2'>
								<Button variant='outline' onClick={() => setEditing(null)}>
									Cancel
								</Button>
								<Button
									onClick={handleSave}
									disabled={!editing.title || !editing.company_name}
									className='gap-1'
								>
									<Save className='h-4 w-4' /> {isNew ? 'Add' : 'Save'}
								</Button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

// ====== EDUCATION TAB ======
function EducationTab({
	education,
	setEducation,
	showMessage,
}: {
	education: Education[]
	setEducation: React.Dispatch<React.SetStateAction<Education[]>>
	showMessage: (type: 'success' | 'error', text: string) => void
}) {
	const [editing, setEditing] = useState<Education | null>(null)
	const [isNew, setIsNew] = useState(false)

	function openNew() {
		setEditing({ id: 0, institution: '', degree: '' })
		setIsNew(true)
	}
	function openEdit(edu: Education) {
		setEditing({ ...edu })
		setIsNew(false)
	}

	async function handleSave() {
		if (!editing) return
		try {
			if (isNew) {
				const data = await apiCall<{ success: boolean; education: Education }>(
					'/candidate/education',
					{ method: 'POST', body: editing },
				)
				setEducation((prev) => [data.education, ...prev])
			} else {
				const data = await apiCall<{ success: boolean; education: Education }>(
					`/candidate/education/${editing.id}`,
					{ method: 'PUT', body: editing },
				)
				setEducation((prev) => prev.map((e) => (e.id === editing.id ? data.education : e)))
			}
			setEditing(null)
			showMessage('success', isNew ? 'Education added' : 'Education updated')
		} catch {
			showMessage('error', 'Failed to save education')
		}
	}

	async function handleDelete(id: number) {
		try {
			await apiCall(`/candidate/education/${id}`, { method: 'DELETE' })
			setEducation((prev) => prev.filter((e) => e.id !== id))
			showMessage('success', 'Education removed')
		} catch {
			showMessage('error', 'Failed to delete education')
		}
	}

	return (
		<div className='space-y-6'>
			<div className='flex items-center justify-between'>
				<h3 className='font-semibold text-lg flex items-center gap-2'>
					<GraduationCap className='h-5 w-5' /> Education
				</h3>
				<Button size='sm' onClick={openNew} className='gap-1'>
					<Plus className='h-4 w-4' /> Add Education
				</Button>
			</div>

			{education.length === 0 ? (
				<Card>
					<CardContent className='py-16 text-center'>
						<GraduationCap className='mx-auto mb-3 h-12 w-12 opacity-20' />
						<p className='text-muted-foreground mb-4'>No education added yet</p>
						<Button onClick={openNew} className='gap-1'>
							<Plus className='h-4 w-4' /> Add Education
						</Button>
					</CardContent>
				</Card>
			) : (
				<div className='space-y-4'>
					{education.map((edu, index) => (
						<Card key={edu.id} className='overflow-hidden'>
							<CardContent className='p-5'>
								<div className='flex items-start gap-4'>
									<div className='flex flex-col items-center'>
										<div className='h-10 w-10 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0'>
											<GraduationCap className='h-5 w-5 text-indigo-600' />
										</div>
										{index < education.length - 1 && <div className='w-px flex-1 bg-border mt-2' />}
									</div>
									<div className='flex-1 min-w-0'>
										<div className='flex items-start justify-between gap-2'>
											<div>
												<h4 className='font-semibold'>
													{edu.degree}
													{edu.field_of_study ? ` in ${edu.field_of_study}` : ''}
												</h4>
												<p className='text-sm text-muted-foreground flex items-center gap-1.5'>
													<Building2 className='h-3.5 w-3.5' /> {edu.institution}
												</p>
												<p className='text-xs text-muted-foreground mt-1'>
													{edu.start_date ? new Date(edu.start_date).getFullYear() : 'Start'} —{' '}
													{edu.is_current
														? 'Present'
														: edu.end_date
															? new Date(edu.end_date).getFullYear()
															: 'End'}
													{edu.gpa && ` · GPA: ${edu.gpa}`}
												</p>
											</div>
											<div className='flex items-center gap-1 shrink-0'>
												<Button variant='ghost' size='sm' onClick={() => openEdit(edu)}>
													<Pencil className='h-3.5 w-3.5' />
												</Button>
												<Button
													variant='ghost'
													size='sm'
													onClick={() => handleDelete(edu.id)}
													className='text-destructive hover:text-destructive'
												>
													<Trash2 className='h-3.5 w-3.5' />
												</Button>
											</div>
										</div>
									</div>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			{/* Edit dialog */}
			{editing && (
				<div className='fixed inset-0 z-50 flex items-end sm:items-center justify-center'>
					<div className='fixed inset-0 bg-black/50' onClick={() => setEditing(null)} />
					<div className='relative z-50 w-full max-w-lg max-h-[85vh] sm:max-h-[90vh] overflow-y-auto border bg-background p-4 sm:p-6 shadow-lg rounded-t-2xl sm:rounded-lg'>
						<button onClick={() => setEditing(null)} className='absolute right-3 top-3'>
							<X className='h-4 w-4' />
						</button>
						<h2 className='text-lg font-semibold mb-4'>
							{isNew ? 'Add Education' : 'Edit Education'}
						</h2>
						<div className='space-y-4'>
							<div className='grid gap-3 sm:grid-cols-2'>
								<div>
									<Label>Institution *</Label>
									<Input
										value={editing.institution}
										onChange={(e) => setEditing({ ...editing, institution: e.target.value })}
										placeholder='MIT'
									/>
								</div>
								<div>
									<Label>Degree *</Label>
									<Input
										value={editing.degree}
										onChange={(e) => setEditing({ ...editing, degree: e.target.value })}
										placeholder='Bachelor of Science'
									/>
								</div>
								<div>
									<Label>Field of Study</Label>
									<Input
										value={editing.field_of_study || ''}
										onChange={(e) => setEditing({ ...editing, field_of_study: e.target.value })}
										placeholder='Computer Science'
									/>
								</div>
								<div>
									<Label>GPA</Label>
									<Input
										value={editing.gpa || ''}
										onChange={(e) => setEditing({ ...editing, gpa: e.target.value })}
										placeholder='3.8'
									/>
								</div>
								<div>
									<Label>Start Date</Label>
									<Input
										type='date'
										value={editing.start_date?.split('T')[0] || ''}
										onChange={(e) => setEditing({ ...editing, start_date: e.target.value })}
									/>
								</div>
								<div>
									<Label>End Date</Label>
									<Input
										type='date'
										value={editing.end_date?.split('T')[0] || ''}
										onChange={(e) => setEditing({ ...editing, end_date: e.target.value })}
									/>
								</div>
							</div>
							<div className='flex justify-end gap-2 pt-2'>
								<Button variant='outline' onClick={() => setEditing(null)}>
									Cancel
								</Button>
								<Button
									onClick={handleSave}
									disabled={!editing.institution || !editing.degree}
									className='gap-1'
								>
									<Save className='h-4 w-4' /> {isNew ? 'Add' : 'Save'}
								</Button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

// ====== SKILLS TAB ======
function SkillsTab({
	skills,
	setSkills,
	showMessage,
}: {
	skills: Skill[]
	setSkills: React.Dispatch<React.SetStateAction<Skill[]>>
	showMessage: (type: 'success' | 'error', text: string) => void
}) {
	const [newSkill, setNewSkill] = useState('')
	const [newCategory, setNewCategory] = useState('technical')
	const [newLevel, setNewLevel] = useState(3)
	const [adding, setAdding] = useState(false)
	const [endorsing, setEndorsing] = useState<number | null>(null)

	async function addSkill() {
		if (!newSkill.trim()) return
		setAdding(true)
		try {
			const data = await apiCall<{ success: boolean; skill: Skill }>('/candidate/skills', {
				method: 'POST',
				body: { skill_name: newSkill.trim(), category: newCategory, level: newLevel },
			})
			setSkills((prev) => [...prev, data.skill])
			setNewSkill('')
			setNewLevel(3)
			showMessage('success', 'Skill added')
		} catch {
			showMessage('error', 'Failed to add skill')
		} finally {
			setAdding(false)
		}
	}

	async function updateLevel(skill: Skill, level: number) {
		try {
			await apiCall(`/candidate/skills/${skill.id}`, { method: 'PUT', body: { level } })
			setSkills((prev) => prev.map((s) => (s.id === skill.id ? { ...s, level } : s)))
		} catch {
			showMessage('error', 'Failed to update skill')
		}
	}

	async function removeSkill(id: number) {
		try {
			await apiCall(`/candidate/skills/${id}`, { method: 'DELETE' })
			setSkills((prev) => prev.filter((s) => s.id !== id))
			showMessage('success', 'Skill removed')
		} catch {
			showMessage('error', 'Failed to delete skill')
		}
	}

	async function endorseSkill(skillId: number) {
		setEndorsing(skillId)
		try {
			await apiCall(`/candidate/skills/${skillId}/endorse`, { method: 'POST' })
			setSkills((prev) =>
				prev.map((s) => (s.id === skillId ? { ...s, endorsements: (s.endorsements || 0) + 1 } : s)),
			)
			showMessage('success', 'Skill endorsed!')
		} catch {
			showMessage('error', 'Failed to endorse')
		} finally {
			setEndorsing(null)
		}
	}

	const grouped = skills.reduce(
		(acc, s) => {
			const cat = s.category || 'other'
			if (!acc[cat]) acc[cat] = []
			acc[cat].push(s)
			return acc
		},
		{} as Record<string, Skill[]>,
	)

	const sortedCategories = Object.keys(grouped).sort()

	return (
		<div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
			<div className='lg:col-span-2 space-y-6'>
				<div className='flex items-center justify-between'>
					<h3 className='font-semibold text-lg flex items-center gap-2'>
						<Wrench className='h-5 w-5' /> Skills ({skills.length})
					</h3>
				</div>

				{/* Add skill form */}
				<Card>
					<CardContent className='p-4'>
						<p className='text-sm font-medium mb-3'>Add a New Skill</p>
						<div className='flex flex-col gap-3 sm:flex-row sm:items-end'>
							<div className='flex-1'>
								<Label>Skill Name</Label>
								<Input
									value={newSkill}
									onChange={(e) => setNewSkill(e.target.value)}
									placeholder='e.g. React, Python, Project Management'
									onKeyDown={(e) => e.key === 'Enter' && addSkill()}
								/>
							</div>
							<div className='w-36'>
								<Label>Category</Label>
								<select
									value={newCategory}
									onChange={(e) => setNewCategory(e.target.value)}
									className='flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm'
								>
									<option value='technical'>Technical</option>
									<option value='soft'>Soft Skills</option>
									<option value='language'>Language</option>
									<option value='tool'>Tools</option>
									<option value='other'>Other</option>
								</select>
							</div>
							<div className='w-36'>
								<Label>Level ({levelLabels[newLevel]})</Label>
								<Input
									type='range'
									min={1}
									max={5}
									value={newLevel}
									onChange={(e) => setNewLevel(parseInt(e.target.value, 10))}
								/>
							</div>
							<Button onClick={addSkill} disabled={!newSkill.trim() || adding} className='gap-1'>
								<Plus className='h-4 w-4' /> Add
							</Button>
						</div>
					</CardContent>
				</Card>

				{skills.length === 0 ? (
					<Card>
						<CardContent className='py-16 text-center'>
							<Wrench className='mx-auto mb-3 h-12 w-12 opacity-20' />
							<p className='text-muted-foreground'>No skills added yet. Add your skills above.</p>
						</CardContent>
					</Card>
				) : (
					sortedCategories.map((category) => (
						<div key={category}>
							<h4 className='text-sm font-semibold text-muted-foreground mb-3 capitalize flex items-center gap-2'>
								<Zap className='h-3.5 w-3.5' />
								{category} Skills
							</h4>
							<div className='grid gap-3 sm:grid-cols-2'>
								{grouped[category].map((skill) => (
									<Card key={skill.id} className='overflow-hidden'>
										<CardContent className='p-4'>
											<div className='flex items-start gap-3'>
												<div className='flex-1 min-w-0'>
													<div className='flex items-center gap-2'>
														<span className='font-medium text-sm truncate'>{skill.skill_name}</span>
														{skill.is_verified && (
															<Badge variant='default' className='gap-0.5 text-[10px] h-5'>
																<Award className='h-2.5 w-2.5' /> Verified
															</Badge>
														)}
													</div>
													<div className='flex items-center gap-1 mt-2'>
														{[1, 2, 3, 4, 5].map((level) => (
															<button
																key={level}
																onClick={() => updateLevel(skill, level)}
																className='focus:outline-none'
															>
																<Star
																	className={`h-4 w-4 transition-colors ${level <= skill.level ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`}
																/>
															</button>
														))}
														<span className='text-[10px] text-muted-foreground ml-1'>
															{levelLabels[skill.level]}
														</span>
													</div>
													{skill.years_experience && (
														<p className='text-[10px] text-muted-foreground mt-1'>
															{skill.years_experience} years of experience
														</p>
													)}
													{skill.endorsements && skill.endorsements > 0 && (
														<div className='flex items-center gap-1 mt-2'>
															<ThumbsUp className='h-3 w-3 text-green-500' />
															<span className='text-[10px] text-green-600'>
																{skill.endorsements} endorsement{skill.endorsements > 1 ? 's' : ''}
															</span>
															{skill.endorsed_by && skill.endorsed_by.length > 0 && (
																<span className='text-[10px] text-muted-foreground'>
																	by {skill.endorsed_by.slice(0, 2).join(', ')}
																	{skill.endorsed_by.length > 2 && '...'}
																</span>
															)}
														</div>
													)}
												</div>
												<div className='flex flex-col items-center gap-1 shrink-0'>
													<Button
														variant='ghost'
														size='sm'
														onClick={() => removeSkill(skill.id)}
														className='text-muted-foreground hover:text-destructive min-h-[44px] min-w-[44px] p-0'
													>
														<X className='h-3.5 w-3.5' />
													</Button>
													<Button
														variant='outline'
														size='sm'
														className='min-h-[44px] text-[10px] gap-1'
														onClick={() => endorseSkill(skill.id)}
														disabled={endorsing === skill.id}
													>
														{endorsing === skill.id ? (
															<Loader2 className='h-3 w-3 animate-spin' />
														) : (
															<ThumbsUp className='h-3 w-3' />
														)}
														Endorse
													</Button>
												</div>
											</div>
										</CardContent>
									</Card>
								))}
							</div>
						</div>
					))
				)}
			</div>

			{/* Right sidebar: Skill tips */}
			<div className='space-y-4'>
				<Card className='bg-muted/50 border-dashed'>
					<CardContent className='p-4 space-y-3'>
						<h4 className='font-semibold text-sm flex items-center gap-2'>
							<TrendingUp className='h-4 w-4 text-primary' /> Skill Insights
						</h4>
						<p className='text-sm text-muted-foreground'>
							Skills with endorsements and verification badges rank higher in AI matching.
						</p>
						<div className='space-y-2'>
							<div className='flex items-center gap-2 text-sm'>
								<Award className='h-4 w-4 text-amber-500' />
								<span>Verified skills get +20% match boost</span>
							</div>
							<div className='flex items-center gap-2 text-sm'>
								<ThumbsUp className='h-4 w-4 text-green-500' />
								<span>Each endorsement adds +5% weight</span>
							</div>
							<div className='flex items-center gap-2 text-sm'>
								<Star className='h-4 w-4 text-amber-400' />
								<span>Expert-level skills get priority</span>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}

// ====== PORTFOLIO TAB ======
function PortfolioTab({
	certifications,
	setCertifications,
	projects,
	setProjects,
	showMessage,
}: {
	certifications: Certification[]
	setCertifications: React.Dispatch<React.SetStateAction<Certification[]>>
	projects: Project[]
	setProjects: React.Dispatch<React.SetStateAction<Project[]>>
	showMessage: (type: 'success' | 'error', text: string) => void
}) {
	const [newCert, setNewCert] = useState<Partial<Certification>>({})
	const [newProj, setNewProj] = useState<Partial<Project>>({})
	const [showCertForm, setShowCertForm] = useState(false)
	const [showProjForm, setShowProjForm] = useState(false)

	async function addCertification() {
		if (!newCert.name || !newCert.issuer) return
		try {
			const data = await apiCall<{ success: boolean; certification: Certification }>(
				'/candidate/certifications',
				{
					method: 'POST',
					body: newCert,
				},
			)
			setCertifications((prev) => [data.certification, ...prev])
			setNewCert({})
			setShowCertForm(false)
			showMessage('success', 'Certification added')
		} catch {
			showMessage('error', 'Failed to add certification')
		}
	}

	async function addProject() {
		if (!newProj.name) return
		try {
			const data = await apiCall<{ success: boolean; project: Project }>('/candidate/projects', {
				method: 'POST',
				body: newProj,
			})
			setProjects((prev) => [data.project, ...prev])
			setNewProj({})
			setShowProjForm(false)
			showMessage('success', 'Project added')
		} catch {
			showMessage('error', 'Failed to add project')
		}
	}

	return (
		<div className='space-y-6'>
			{/* Certifications */}
			<div>
				<div className='flex items-center justify-between mb-4'>
					<h3 className='font-semibold text-lg flex items-center gap-2'>
						<Crown className='h-5 w-5' /> Certifications
					</h3>
					<Button size='sm' onClick={() => setShowCertForm(!showCertForm)} className='gap-1'>
						<Plus className='h-4 w-4' /> Add
					</Button>
				</div>
				{showCertForm && (
					<Card className='mb-4'>
						<CardContent className='p-4 space-y-3'>
							<div className='grid gap-3 sm:grid-cols-2'>
								<div>
									<Label>Certification Name</Label>
									<Input
										value={newCert.name || ''}
										onChange={(e) => setNewCert({ ...newCert, name: e.target.value })}
										placeholder='AWS Solutions Architect'
									/>
								</div>
								<div>
									<Label>Issuer</Label>
									<Input
										value={newCert.issuer || ''}
										onChange={(e) => setNewCert({ ...newCert, issuer: e.target.value })}
										placeholder='Amazon Web Services'
									/>
								</div>
								<div>
									<Label>Issue Date</Label>
									<Input
										type='date'
										value={newCert.issue_date || ''}
										onChange={(e) => setNewCert({ ...newCert, issue_date: e.target.value })}
									/>
								</div>
								<div>
									<Label>Expiry Date</Label>
									<Input
										type='date'
										value={newCert.expiry_date || ''}
										onChange={(e) => setNewCert({ ...newCert, expiry_date: e.target.value })}
									/>
								</div>
								<div className='sm:col-span-2'>
									<Label>Credential URL</Label>
									<Input
										value={newCert.credential_url || ''}
										onChange={(e) => setNewCert({ ...newCert, credential_url: e.target.value })}
										placeholder='https://verify.example.com/abc123'
									/>
								</div>
							</div>
							<div className='flex gap-2'>
								<Button onClick={addCertification} disabled={!newCert.name || !newCert.issuer}>
									<Save className='h-4 w-4' /> Save
								</Button>
								<Button variant='outline' onClick={() => setShowCertForm(false)}>
									Cancel
								</Button>
							</div>
						</CardContent>
					</Card>
				)}
				{certifications.length === 0 ? (
					<p className='text-sm text-muted-foreground'>No certifications added yet.</p>
				) : (
					<div className='grid gap-3 sm:grid-cols-2'>
						{certifications.map((cert) => (
							<Card key={cert.id}>
								<CardContent className='p-4'>
									<div className='flex items-start gap-3'>
										<Award className='h-5 w-5 text-amber-500 shrink-0 mt-0.5' />
										<div className='min-w-0'>
											<h4 className='font-semibold text-sm'>{cert.name}</h4>
											<p className='text-xs text-muted-foreground'>{cert.issuer}</p>
											<p className='text-[10px] text-muted-foreground mt-0.5'>
												{cert.issue_date &&
													new Date(cert.issue_date).toLocaleDateString('en-US', {
														month: 'short',
														year: 'numeric',
													})}
												{cert.expiry_date &&
													` — Exp: ${new Date(cert.expiry_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
											</p>
											{cert.credential_url && (
												<a
													href={cert.credential_url}
													target='_blank'
													rel='noopener noreferrer'
													className='text-xs text-primary hover:underline mt-1 inline-flex items-center gap-1'
												>
													<Globe className='h-3 w-3' /> Verify Credential
												</a>
											)}
										</div>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				)}
			</div>

			<Separator />

			{/* Projects */}
			<div>
				<div className='flex items-center justify-between mb-4'>
					<h3 className='font-semibold text-lg flex items-center gap-2'>
						<Code2 className='h-5 w-5' /> Projects
					</h3>
					<Button size='sm' onClick={() => setShowProjForm(!showProjForm)} className='gap-1'>
						<Plus className='h-4 w-4' /> Add
					</Button>
				</div>
				{showProjForm && (
					<Card className='mb-4'>
						<CardContent className='p-4 space-y-3'>
							<div className='grid gap-3 sm:grid-cols-2'>
								<div className='sm:col-span-2'>
									<Label>Project Name</Label>
									<Input
										value={newProj.name || ''}
										onChange={(e) => setNewProj({ ...newProj, name: e.target.value })}
										placeholder='AI Resume Parser'
									/>
								</div>
								<div className='sm:col-span-2'>
									<Label>Description</Label>
									<Textarea
										value={newProj.description || ''}
										onChange={(e) => setNewProj({ ...newProj, description: e.target.value })}
										placeholder='Describe the project...'
										rows={2}
									/>
								</div>
								<div className='sm:col-span-2'>
									<Label>Project URL</Label>
									<Input
										value={newProj.url || ''}
										onChange={(e) => setNewProj({ ...newProj, url: e.target.value })}
										placeholder='https://github.com/...'
									/>
								</div>
								<div className='sm:col-span-2'>
									<Label>Technologies Used (comma-separated)</Label>
									<Input
										value={newProj.skills?.join(', ') || ''}
										onChange={(e) =>
											setNewProj({
												...newProj,
												skills: e.target.value
													.split(',')
													.map((s) => s.trim())
													.filter(Boolean),
											})
										}
										placeholder='React, Python, TensorFlow'
									/>
								</div>
							</div>
							<div className='flex gap-2'>
								<Button onClick={addProject} disabled={!newProj.name}>
									<Save className='h-4 w-4' /> Save
								</Button>
								<Button variant='outline' onClick={() => setShowProjForm(false)}>
									Cancel
								</Button>
							</div>
						</CardContent>
					</Card>
				)}
				{projects.length === 0 ? (
					<p className='text-sm text-muted-foreground'>No projects added yet.</p>
				) : (
					<div className='grid gap-3 sm:grid-cols-2'>
						{projects.map((proj) => (
							<Card key={proj.id}>
								<CardContent className='p-4'>
									<div className='flex items-start gap-3'>
										<Layers className='h-5 w-5 text-primary shrink-0 mt-0.5' />
										<div className='min-w-0'>
											<h4 className='font-semibold text-sm'>{proj.name}</h4>
											{proj.description && (
												<p className='text-xs text-muted-foreground mt-0.5 line-clamp-2'>
													{proj.description}
												</p>
											)}
											{proj.url && (
												<a
													href={proj.url}
													target='_blank'
													rel='noopener noreferrer'
													className='text-xs text-primary hover:underline mt-1 inline-flex items-center gap-1'
												>
													<Github className='h-3 w-3' /> View Project
												</a>
											)}
											{proj.skills && proj.skills.length > 0 && (
												<div className='flex flex-wrap gap-1 mt-2'>
													{proj.skills.map((s) => (
														<Badge key={s} variant='secondary' className='text-[10px] h-5'>
															{s}
														</Badge>
													))}
												</div>
											)}
										</div>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

// ====== ACTIVITY TAB ======
function ActivityTab({ activities }: { activities: ActivityItem[] }) {
	const iconMap: Record<string, typeof Activity> = {
		profile_view: Eye,
		application_update: Send,
		interview_invite: Briefcase,
		skill_endorsement: ThumbsUp,
		job_alert: Bell,
	}

	const colorMap: Record<string, string> = {
		profile_view: 'text-blue-500 bg-blue-50',
		application_update: 'text-green-500 bg-green-50',
		interview_invite: 'text-purple-500 bg-purple-50',
		skill_endorsement: 'text-amber-500 bg-amber-50',
		job_alert: 'text-indigo-500 bg-indigo-50',
	}

	return (
		<div className='space-y-6'>
			<h3 className='font-semibold text-lg flex items-center gap-2'>
				<Activity className='h-5 w-5' /> Activity Feed
			</h3>
			{activities.length === 0 ? (
				<Card>
					<CardContent className='py-16 text-center'>
						<Activity className='mx-auto mb-3 h-12 w-12 opacity-20' />
						<p className='text-muted-foreground'>
							No recent activity. Your activity will appear here as you apply to jobs and receive
							updates.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className='space-y-3'>
					{activities.map((activity) => {
						const Icon = iconMap[activity.type] || Activity
						const colorClass = colorMap[activity.type] || 'text-muted-foreground bg-muted'
						return (
							<Card
								key={activity.id}
								className={activity.read ? '' : 'border-l-4 border-l-primary'}
							>
								<CardContent className='p-4'>
									<div className='flex items-start gap-3'>
										<div
											className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}
										>
											<Icon className='h-4 w-4' />
										</div>
										<div className='flex-1 min-w-0'>
											<h4 className='font-medium text-sm'>{activity.title}</h4>
											<p className='text-sm text-muted-foreground'>{activity.description}</p>
											<p className='text-xs text-muted-foreground mt-1'>
												{new Date(activity.timestamp).toLocaleDateString()}
											</p>
										</div>
										{!activity.read && <Badge className='shrink-0 text-[10px] h-5'>New</Badge>}
									</div>
								</CardContent>
							</Card>
						)
					})}
				</div>
			)}
		</div>
	)
}

// ====== JOB ALERTS TAB ======
function JobAlertsTab({
	jobAlerts,
	setJobAlerts,
	showMessage,
}: {
	jobAlerts: JobAlert[]
	setJobAlerts: React.Dispatch<React.SetStateAction<JobAlert[]>>
	showMessage: (type: 'success' | 'error', text: string) => void
}) {
	const [newAlert, setNewAlert] = useState<Partial<JobAlert>>({
		keywords: '',
		location: '',
		frequency: 'daily',
		active: true,
	})
	const [showForm, setShowForm] = useState(false)

	async function addAlert() {
		if (!newAlert.keywords) return
		try {
			const data = await apiCall<{ success: boolean; alert: JobAlert }>('/candidate/job-alerts', {
				method: 'POST',
				body: newAlert,
			})
			setJobAlerts((prev) => [data.alert, ...prev])
			setNewAlert({ keywords: '', location: '', frequency: 'daily', active: true })
			setShowForm(false)
			showMessage('success', 'Job alert created')
		} catch {
			showMessage('error', 'Failed to create alert')
		}
	}

	async function toggleAlert(id: number, active: boolean) {
		try {
			await apiCall(`/candidate/job-alerts/${id}`, { method: 'PUT', body: { active } })
			setJobAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, active } : a)))
			showMessage('success', active ? 'Alert activated' : 'Alert paused')
		} catch {
			showMessage('error', 'Failed to update alert')
		}
	}

	async function deleteAlert(id: number) {
		try {
			await apiCall(`/candidate/job-alerts/${id}`, { method: 'DELETE' })
			setJobAlerts((prev) => prev.filter((a) => a.id !== id))
			showMessage('success', 'Alert deleted')
		} catch {
			showMessage('error', 'Failed to delete alert')
		}
	}

	return (
		<div className='space-y-6'>
			<div className='flex items-center justify-between'>
				<h3 className='font-semibold text-lg flex items-center gap-2'>
					<Bell className='h-5 w-5' /> Job Alerts
				</h3>
				<Button size='sm' onClick={() => setShowForm(!showForm)} className='gap-1'>
					<Plus className='h-4 w-4' /> New Alert
				</Button>
			</div>
			{showForm && (
				<Card className='border-indigo-200 bg-indigo-50/50'>
					<CardContent className='p-4 space-y-3'>
						<p className='font-semibold text-sm text-indigo-900'>Create New Job Alert</p>
						<div className='grid gap-3 sm:grid-cols-2'>
							<div className='sm:col-span-2'>
								<Label>Keywords</Label>
								<Input
									value={newAlert.keywords || ''}
									onChange={(e) => setNewAlert({ ...newAlert, keywords: e.target.value })}
									placeholder='e.g. React, Full Stack, Product Manager'
								/>
							</div>
							<div>
								<Label>Location</Label>
								<Input
									value={newAlert.location || ''}
									onChange={(e) => setNewAlert({ ...newAlert, location: e.target.value })}
									placeholder='Remote, San Francisco, etc.'
								/>
							</div>
							<div>
								<Label>Frequency</Label>
								<select
									value={newAlert.frequency || 'daily'}
									onChange={(e) => setNewAlert({ ...newAlert, frequency: e.target.value as any })}
									className='flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm'
								>
									<option value='daily'>Daily</option>
									<option value='weekly'>Weekly</option>
									<option value='instant'>Instant</option>
								</select>
							</div>
						</div>
						<div className='flex gap-2'>
							<Button onClick={addAlert} disabled={!newAlert.keywords} className='gap-1'>
								<Bell className='h-4 w-4' /> Create Alert
							</Button>
							<Button variant='outline' onClick={() => setShowForm(false)}>
								Cancel
							</Button>
						</div>
					</CardContent>
				</Card>
			)}
			{jobAlerts.length === 0 ? (
				<Card>
					<CardContent className='py-16 text-center'>
						<Bell className='mx-auto mb-3 h-12 w-12 opacity-20' />
						<p className='text-muted-foreground'>
							No job alerts yet. Create one to get notified of new matches.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className='space-y-3'>
					{jobAlerts.map((alert) => (
						<Card key={alert.id}>
							<CardContent className='p-4'>
								<div className='flex items-center justify-between'>
									<div className='flex items-center gap-3'>
										<div
											className={`h-9 w-9 rounded-lg flex items-center justify-center ${alert.active ? 'bg-indigo-100' : 'bg-muted'}`}
										>
											<Bell
												className={`h-4 w-4 ${alert.active ? 'text-indigo-600' : 'text-muted-foreground'}`}
											/>
										</div>
										<div>
											<h4 className='font-medium text-sm'>{alert.keywords}</h4>
											<p className='text-xs text-muted-foreground'>
												{alert.location && `📍 ${alert.location} · `}
												<Badge variant='outline' className='text-[10px] h-5'>
													{alert.frequency}
												</Badge>
												{alert.match_count > 0 && (
													<span className='ml-1 text-green-600'>{alert.match_count} matches</span>
												)}
											</p>
										</div>
									</div>
									<div className='flex items-center gap-2'>
										<Switch
											checked={alert.active}
											onCheckedChange={(checked) => toggleAlert(alert.id, checked)}
										/>
										<Button
											variant='ghost'
											size='sm'
											onClick={() => deleteAlert(alert.id)}
											className='text-destructive hover:text-destructive h-8 w-8 min-h-[44px] min-w-[44px] p-0'
										>
											<Trash2 className='h-3.5 w-3.5' />
										</Button>
									</div>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	)
}
