import {
	ArrowLeft,
	Building2,
	CheckCircle2,
	Edit3,
	Globe,
	Linkedin,
	Mail,
	MapPin,
	Phone,
	Save,
	Star,
	Twitter,
	Users,
	X,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface CompanyProfile {
	name: string
	description: string
	website: string
	location: string
	size: string
	industry: string
	founded: string
	email: string
	phone: string
	linkedin: string
	twitter: string
	logo: string
	verified: boolean
	rating: number
	reviewCount: number
	activeJobs: number
	totalHires: number
}

export function RecruiterProfilePage() {
	const [isEditing, setIsEditing] = useState(false)
	const [profile, setProfile] = useState<CompanyProfile>({
		name: 'TechCorp Solutions',
		description:
			'Leading technology solutions provider specializing in cloud infrastructure, AI/ML platforms, and enterprise software development. We build products that power the next generation of digital experiences.',
		website: 'https://techcorp.example.com',
		location: 'San Francisco, CA',
		size: '250-500 employees',
		industry: 'Technology',
		founded: '2018',
		email: 'hiring@techcorp.example.com',
		phone: '+1 (555) 123-4567',
		linkedin: 'https://linkedin.com/company/techcorp',
		twitter: '@techcorp',
		logo: '',
		verified: true,
		rating: 4.8,
		reviewCount: 127,
		activeJobs: 12,
		totalHires: 89,
	})

	const [editForm, setEditForm] = useState(profile)

	const handleSave = () => {
		setProfile(editForm)
		setIsEditing(false)
	}

	const handleCancel = () => {
		setEditForm(profile)
		setIsEditing(false)
	}

	const StatCard = ({
		icon: Icon,
		label,
		value,
		color,
	}: {
		icon: any
		label: string
		value: string
		color: string
	}) => (
		<Card className='bg-white/10 backdrop-blur-lg border-white/20'>
			<CardContent className='pt-6'>
				<div className='flex items-center gap-3'>
					<div className={`w-10 h-10 ${color} rounded-lg flex items-center justify-center`}>
						<Icon className='w-5 h-5 text-white' />
					</div>
					<div>
						<p className='text-2xl font-bold text-white'>{value}</p>
						<p className='text-sm text-gray-400'>{label}</p>
					</div>
				</div>
			</CardContent>
		</Card>
	)

	return (
		<div className='min-h-screen bg-gradient-to-br from-gray-900 via-indigo-950 to-gray-900'>
			<div className='container mx-auto px-4 py-8 max-w-5xl'>
				<div className='mb-6'>
					<Link
						to='/recruiter'
						className='text-gray-400 hover:text-white flex items-center gap-2 mb-4'
					>
						<ArrowLeft className='w-4 h-4' />
						Back to Dashboard
					</Link>
				</div>

				<div className='grid grid-cols-1 md:grid-cols-3 gap-6 mb-8'>
					<StatCard
						icon={Star}
						label='Rating'
						value={profile.rating.toString()}
						color='bg-yellow-500/20'
					/>
					<StatCard
						icon={Users}
						label='Total Hires'
						value={profile.totalHires.toString()}
						color='bg-green-500/20'
					/>
					<StatCard
						icon={Building2}
						label='Active Jobs'
						value={profile.activeJobs.toString()}
						color='bg-blue-500/20'
					/>
				</div>

				<Card className='bg-white/10 backdrop-blur-lg border-white/20 mb-6'>
					<CardHeader>
						<div className='flex items-center justify-between'>
							<div className='flex items-center gap-4'>
								<div className='w-20 h-20 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center text-2xl font-bold text-white'>
									{profile.name.charAt(0)}
								</div>
								<div>
									<div className='flex items-center gap-2'>
										<CardTitle className='text-white text-2xl'>{profile.name}</CardTitle>
										{profile.verified && (
											<Badge className='bg-blue-500/20 text-blue-400 border-blue-500/30'>
												<CheckCircle2 className='w-3 h-3 mr-1' />
												Verified
											</Badge>
										)}
									</div>
									<p className='text-gray-400 mt-1'>
										{profile.industry} • {profile.size}
									</p>
								</div>
							</div>
							<Button
								variant='outline'
								onClick={() => (isEditing ? handleCancel() : setIsEditing(true))}
								className='border-white/20 text-white hover:bg-white/10'
							>
								{isEditing ? (
									<>
										<X className='w-4 h-4 mr-2' />
										Cancel
									</>
								) : (
									<>
										<Edit3 className='w-4 h-4 mr-2' />
										Edit Profile
									</>
								)}
							</Button>
						</div>
					</CardHeader>
					<CardContent className='space-y-6'>
						{isEditing ? (
							<div className='space-y-4'>
								<div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
									<div>
										<Label className='text-gray-300'>Company Name</Label>
										<Input
											value={editForm.name}
											onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
											className='bg-white/5 border-white/20 text-white mt-2'
										/>
									</div>
									<div>
										<Label className='text-gray-300'>Website</Label>
										<Input
											value={editForm.website}
											onChange={(e) =>
												setEditForm((prev) => ({ ...prev, website: e.target.value }))
											}
											className='bg-white/5 border-white/20 text-white mt-2'
										/>
									</div>
									<div>
										<Label className='text-gray-300'>Location</Label>
										<Input
											value={editForm.location}
											onChange={(e) =>
												setEditForm((prev) => ({ ...prev, location: e.target.value }))
											}
											className='bg-white/5 border-white/20 text-white mt-2'
										/>
									</div>
									<div>
										<Label className='text-gray-300'>Company Size</Label>
										<Input
											value={editForm.size}
											onChange={(e) => setEditForm((prev) => ({ ...prev, size: e.target.value }))}
											className='bg-white/5 border-white/20 text-white mt-2'
										/>
									</div>
									<div>
										<Label className='text-gray-300'>Industry</Label>
										<Input
											value={editForm.industry}
											onChange={(e) =>
												setEditForm((prev) => ({ ...prev, industry: e.target.value }))
											}
											className='bg-white/5 border-white/20 text-white mt-2'
										/>
									</div>
									<div>
										<Label className='text-gray-300'>Founded Year</Label>
										<Input
											value={editForm.founded}
											onChange={(e) =>
												setEditForm((prev) => ({ ...prev, founded: e.target.value }))
											}
											className='bg-white/5 border-white/20 text-white mt-2'
										/>
									</div>
								</div>
								<div>
									<Label className='text-gray-300'>Description</Label>
									<Textarea
										value={editForm.description}
										onChange={(e) =>
											setEditForm((prev) => ({ ...prev, description: e.target.value }))
										}
										className='bg-white/5 border-white/20 text-white mt-2'
										rows={4}
									/>
								</div>
								<div className='flex gap-3'>
									<Button onClick={handleSave} className='bg-green-600 hover:bg-green-700'>
										<Save className='w-4 h-4 mr-2' />
										Save Changes
									</Button>
									<Button
										variant='outline'
										onClick={handleCancel}
										className='border-white/20 text-white hover:bg-white/10'
									>
										Cancel
									</Button>
								</div>
							</div>
						) : (
							<>
								<p className='text-gray-300 leading-relaxed'>{profile.description}</p>

								<div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
									<div className='flex items-center gap-3 text-gray-300'>
										<Globe className='w-5 h-5 text-purple-400' />
										<a
											href={profile.website}
											target='_blank'
											rel='noopener noreferrer'
											className='hover:text-white transition'
										>
											{profile.website}
										</a>
									</div>
									<div className='flex items-center gap-3 text-gray-300'>
										<MapPin className='w-5 h-5 text-purple-400' />
										{profile.location}
									</div>
									<div className='flex items-center gap-3 text-gray-300'>
										<Mail className='w-5 h-5 text-purple-400' />
										{profile.email}
									</div>
									<div className='flex items-center gap-3 text-gray-300'>
										<Phone className='w-5 h-5 text-purple-400' />
										{profile.phone}
									</div>
									<div className='flex items-center gap-3 text-gray-300'>
										<Linkedin className='w-5 h-5 text-purple-400' />
										<a
											href={profile.linkedin}
											target='_blank'
											rel='noopener noreferrer'
											className='hover:text-white transition'
										>
											LinkedIn
										</a>
									</div>
									<div className='flex items-center gap-3 text-gray-300'>
										<Twitter className='w-5 h-5 text-purple-400' />
										<a
											href={`https://twitter.com/${profile.twitter}`}
											target='_blank'
											rel='noopener noreferrer'
											className='hover:text-white transition'
										>
											{profile.twitter}
										</a>
									</div>
								</div>
							</>
						)}
					</CardContent>
				</Card>

				<div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
					<Card className='bg-white/10 backdrop-blur-lg border-white/20'>
						<CardHeader>
							<CardTitle className='text-white'>Company Stats</CardTitle>
						</CardHeader>
						<CardContent className='space-y-3'>
							<div className='flex justify-between text-gray-300'>
								<span>Founded</span>
								<span className='text-white font-medium'>{profile.founded}</span>
							</div>
							<div className='flex justify-between text-gray-300'>
								<span>Company Size</span>
								<span className='text-white font-medium'>{profile.size}</span>
							</div>
							<div className='flex justify-between text-gray-300'>
								<span>Industry</span>
								<span className='text-white font-medium'>{profile.industry}</span>
							</div>
							<div className='flex justify-between text-gray-300'>
								<span>Reviews</span>
								<span className='text-white font-medium'>{profile.reviewCount}</span>
							</div>
						</CardContent>
					</Card>

					<Card className='bg-white/10 backdrop-blur-lg border-white/20'>
						<CardHeader>
							<CardTitle className='text-white'>Hiring Activity</CardTitle>
						</CardHeader>
						<CardContent className='space-y-3'>
							<div className='flex justify-between text-gray-300'>
								<span>Active Jobs</span>
								<span className='text-white font-medium'>{profile.activeJobs}</span>
							</div>
							<div className='flex justify-between text-gray-300'>
								<span>Total Hires</span>
								<span className='text-white font-medium'>{profile.totalHires}</span>
							</div>
							<div className='flex justify-between text-gray-300'>
								<span>Hire Rate</span>
								<span className='text-white font-medium'>87%</span>
							</div>
							<div className='flex justify-between text-gray-300'>
								<span>Avg. Time to Hire</span>
								<span className='text-white font-medium'>18 days</span>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	)
}
