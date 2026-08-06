import {
	AlertTriangle,
	ArrowLeft,
	Building2,
	Calendar,
	CheckCircle,
	Globe,
	Linkedin,
	Loader2,
	MapPin,
	Save,
	Shield,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { apiCall } from '@/lib/api'

interface CompanyProfile {
	id: number
	name: string
	description: string
	industry: string
	company_size: string
	headquarters: string
	founded_year: number | null
	website: string
	linkedin_url: string
	logo_url: string
	is_verified: boolean
	email_domain: string | null
}

export function CompanyProfilePage() {
	const navigate = useNavigate()
	const [company, setCompany] = useState<CompanyProfile | null>(null)
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
	const [formData, setFormData] = useState<Partial<CompanyProfile>>({})

	useEffect(() => {
		async function loadProfile() {
			try {
				const data = await apiCall<{ company: CompanyProfile }>('/company/profile')
				if (data.company) {
					setCompany(data.company)
					setFormData(data.company)
				}
			} catch (err) {
				console.error('Failed to load company profile:', err)
			} finally {
				setLoading(false)
			}
		}
		loadProfile()
	}, [])

	const completenessFields = [
		'name',
		'description',
		'industry',
		'company_size',
		'headquarters',
		'website',
		'logo_url',
		'linkedin_url',
	] as const

	const completeness = company
		? Math.round(
				(completenessFields.filter((f) => company[f] && String(company[f]).length > 0).length /
					completenessFields.length) *
					100,
			)
		: 0

	async function saveProfile() {
		setSaving(true)
		setMessage(null)
		try {
			const res = await apiCall<{ success: boolean; message: string; company: CompanyProfile }>(
				'/company/profile',
				{
					method: 'PUT',
					body: {
						name: formData.name,
						description: formData.description,
						industry: formData.industry,
						company_size: formData.company_size,
						headquarters: formData.headquarters,
						founded_year: formData.founded_year
							? parseInt(String(formData.founded_year), 10)
							: null,
						website: formData.website,
						linkedin_url: formData.linkedin_url,
						logo_url: formData.logo_url,
					},
				},
			)
			if (res.success) {
				setCompany(res.company)
				setMessage({ type: 'success', text: res.message || 'Profile updated successfully!' })
			} else {
				throw new Error(res.message || 'Failed to update profile')
			}
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Failed to update profile' })
		} finally {
			setSaving(false)
			setTimeout(() => setMessage(null), 3000)
		}
	}

	function updateField<K extends keyof CompanyProfile>(field: K, value: CompanyProfile[K]) {
		setFormData((prev) => ({ ...prev, [field]: value }))
	}

	if (loading) {
		return (
			<div className='flex items-center justify-center min-h-[60vh]'>
				<div className='text-center'>
					<Loader2 className='h-12 w-12 animate-spin text-primary mx-auto mb-4' />
					<p className='text-muted-foreground'>Loading company profile...</p>
				</div>
			</div>
		)
	}

	return (
		<div className='space-y-6'>
			<div className='flex items-center gap-2'>
				<Button
					variant='ghost'
					onClick={() => navigate('/candidate')}
					className='min-h-[44px] min-w-[44px]'
				>
					<ArrowLeft className='h-4 w-4 mr-2' />
					Back to Dashboard
				</Button>
			</div>

			<div>
				<h1 className='text-2xl sm:text-3xl font-bold tracking-tight'>Company Profile</h1>
				<p className='text-muted-foreground'>
					Manage your company information - visible to candidates
				</p>
			</div>

			{/* Profile Completeness */}
			<Card>
				<CardContent className='p-6'>
					<div className='flex items-center justify-between mb-4'>
						<div>
							<h3 className='font-semibold'>Profile Completeness</h3>
							<p className='text-sm text-muted-foreground'>
								Complete profiles get more applications and higher TrustScores
							</p>
						</div>
						<div className='text-2xl font-bold'>{completeness}%</div>
					</div>
					<Progress value={completeness} className='h-2' />
				</CardContent>
			</Card>

			{/* Verification Status */}
			<Card>
				<CardContent className='p-6'>
					<div className='flex items-center gap-4'>
						<div className='bg-primary/10 p-3 rounded-full'>
							{company?.is_verified ? (
								<CheckCircle className='h-6 w-6 text-emerald-500' />
							) : company?.email_domain ? (
								<Shield className='h-6 w-6 text-amber-500' />
							) : (
								<AlertTriangle className='h-6 w-6 text-red-500' />
							)}
						</div>
						<div className='flex-1'>
							<h3 className='font-semibold'>
								{company?.is_verified
									? 'Verified Company'
									: company?.email_domain
										? 'Pending Verification'
										: 'Not Verified'}
							</h3>
							<p className='text-sm text-muted-foreground'>
								{company?.is_verified
									? 'Your company has been verified. Candidates see a verified badge on your jobs.'
									: company?.email_domain
										? 'Your work email domain has been registered. Add LinkedIn to complete verification.'
										: 'Use a company email address to verify your company automatically.'}
							</p>
						</div>
						{!company?.is_verified && !company?.linkedin_url && (
							<Button variant='outline' size='sm' className='min-h-[44px] min-w-[44px]'>
								Request Verification
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Profile Form */}
			<Card>
				<CardHeader>
					<CardTitle className='flex items-center gap-2'>
						<Building2 className='h-5 w-5' />
						Company Information
					</CardTitle>
				</CardHeader>
				<CardContent className='space-y-6'>
					{message && (
						<div
							className={`p-4 rounded-lg ${
								message.type === 'success'
									? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
									: 'bg-red-50 text-red-900 border border-red-200'
							}`}
						>
							{message.text}
						</div>
					)}

					<div className='space-y-4'>
						<div>
							<Label htmlFor='name'>Company Name *</Label>
							<Input
								id='name'
								value={formData.name || ''}
								onChange={(e) => updateField('name', e.target.value)}
								placeholder='Your company name'
							/>
						</div>

						<div>
							<Label htmlFor='description'>Company Description</Label>
							<Textarea
								id='description'
								value={formData.description || ''}
								onChange={(e) => updateField('description', e.target.value)}
								placeholder='Tell candidates about your company culture, mission, and values...'
								rows={4}
							/>
						</div>

						<div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
							<div>
								<Label htmlFor='industry'>Industry</Label>
								<select
									id='industry'
									className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
									value={formData.industry || ''}
									onChange={(e) => updateField('industry', e.target.value)}
								>
									<option value=''>Select industry</option>
									<option value='technology'>Technology</option>
									<option value='finance'>Finance</option>
									<option value='healthcare'>Healthcare</option>
									<option value='retail'>Retail</option>
									<option value='manufacturing'>Manufacturing</option>
									<option value='education'>Education</option>
									<option value='consulting'>Consulting</option>
									<option value='media'>Media & Entertainment</option>
									<option value='other'>Other</option>
								</select>
							</div>
							<div>
								<Label htmlFor='company_size'>Company Size</Label>
								<select
									id='company_size'
									className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
									value={formData.company_size || ''}
									onChange={(e) => updateField('company_size', e.target.value)}
								>
									<option value=''>Select size</option>
									<option value='1-10'>1-10 employees</option>
									<option value='11-50'>11-50 employees</option>
									<option value='51-200'>51-200 employees</option>
									<option value='201-500'>201-500 employees</option>
									<option value='501-1000'>501-1000 employees</option>
									<option value='1000+'>1000+ employees</option>
								</select>
							</div>
						</div>
					</div>

					<Separator />

					<div className='space-y-4'>
						<h3 className='font-semibold flex items-center gap-2'>
							<MapPin className='h-4 w-4' />
							Location & Contact
						</h3>

						<div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
							<div>
								<Label htmlFor='headquarters'>Headquarters</Label>
								<div className='relative'>
									<MapPin className='absolute left-3 top-2.5 h-4 w-4 text-muted-foreground' />
									<Input
										id='headquarters'
										className='pl-8'
										value={formData.headquarters || ''}
										onChange={(e) => updateField('headquarters', e.target.value)}
										placeholder='San Francisco, CA'
									/>
								</div>
							</div>
							<div>
								<Label htmlFor='founded_year'>Founded Year</Label>
								<div className='relative'>
									<Calendar className='absolute left-3 top-2.5 h-4 w-4 text-muted-foreground' />
									<Input
										id='founded_year'
										type='number'
										min='1900'
										max='2030'
										className='pl-8'
										value={formData.founded_year || ''}
										onChange={(e) =>
											updateField(
												'founded_year',
												e.target.value ? parseInt(e.target.value, 10) : null,
											)
										}
										placeholder='2020'
									/>
								</div>
							</div>
						</div>

						<div>
							<Label htmlFor='website'>Website</Label>
							<div className='relative'>
								<Globe className='absolute left-3 top-2.5 h-4 w-4 text-muted-foreground' />
								<Input
									id='website'
									className='pl-8'
									value={formData.website || ''}
									onChange={(e) => updateField('website', e.target.value)}
									placeholder='https://company.com'
								/>
							</div>
						</div>

						<div>
							<Label htmlFor='linkedin_url'>LinkedIn Page</Label>
							<div className='relative'>
								<Linkedin className='absolute left-3 top-2.5 h-4 w-4 text-muted-foreground' />
								<Input
									id='linkedin_url'
									className='pl-8'
									value={formData.linkedin_url || ''}
									onChange={(e) => updateField('linkedin_url', e.target.value)}
									placeholder='https://linkedin.com/company/...'
								/>
							</div>
							<p className='text-xs text-muted-foreground mt-1'>
								Adding LinkedIn helps verify your company (+30 TrustScore points)
							</p>
						</div>
					</div>

					<Separator />

					<div className='space-y-4'>
						<h3 className='font-semibold flex items-center gap-2'>
							<Building2 className='h-4 w-4' />
							Branding
						</h3>

						<div>
							<Label htmlFor='logo_url'>Logo URL</Label>
							<Input
								id='logo_url'
								value={formData.logo_url || ''}
								onChange={(e) => updateField('logo_url', e.target.value)}
								placeholder='https://...'
							/>
							<p className='text-xs text-muted-foreground mt-1'>Square image, at least 200x200px</p>
						</div>

						{formData.logo_url && (
							<div className='border rounded-lg p-4 inline-block'>
								<img
									src={formData.logo_url}
									alt='Company logo preview'
									className='w-24 h-24 object-contain'
									onError={(e) => {
										;(e.target as HTMLImageElement).style.display = 'none'
									}}
								/>
							</div>
						)}
					</div>

					<div className='flex items-center gap-4'>
						<Button onClick={saveProfile} disabled={saving} className='min-h-[44px] min-w-[44px]'>
							{saving ? (
								<Loader2 className='h-4 w-4 animate-spin mr-2' />
							) : (
								<Save className='h-4 w-4 mr-2' />
							)}
							Save Changes
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Account Section */}
			<Card>
				<CardHeader>
					<CardTitle>Account</CardTitle>
				</CardHeader>
				<CardContent>
					<p className='text-sm text-muted-foreground mb-4'>Manage your account and session</p>
					<Button variant='outline' onClick={() => {}} className='min-h-[44px] min-w-[44px]'>
						Sign Out
					</Button>
				</CardContent>
			</Card>
		</div>
	)
}
