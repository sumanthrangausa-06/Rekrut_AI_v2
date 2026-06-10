import {
	AlertTriangle,
	ArrowLeft,
	CheckCircle2,
	Clock,
	Shield,
	Star,
	TrendingDown,
	TrendingUp,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

interface TrustScoreData {
	overallScore: number
	previousScore: number
	components: {
		name: string
		score: number
		weight: number
		trend: 'up' | 'down' | 'stable'
	}[]
	verificationStatus: {
		identity: boolean
		financial: boolean
		legal: boolean
		operational: boolean
	}
	reviews: {
		id: number
		candidate: string
		rating: number
		comment: string
		date: string
	}[]
	incidents: {
		id: number
		type: string
		severity: 'low' | 'medium' | 'high'
		date: string
		resolved: boolean
	}[]
}

export function RecruiterTrustscorePage() {
	const [trustData, _setTrustData] = useState<TrustScoreData>({
		overallScore: 87,
		previousScore: 82,
		components: [
			{ name: 'Identity Verification', score: 95, weight: 25, trend: 'stable' },
			{ name: 'Financial Stability', score: 82, weight: 20, trend: 'up' },
			{ name: 'Hiring History', score: 90, weight: 25, trend: 'up' },
			{ name: 'Candidate Satisfaction', score: 78, weight: 20, trend: 'down' },
			{ name: 'Compliance Score', score: 88, weight: 10, trend: 'stable' },
		],
		verificationStatus: {
			identity: true,
			financial: true,
			legal: true,
			operational: false,
		},
		reviews: [
			{
				id: 1,
				candidate: 'Alex Johnson',
				rating: 5,
				comment: 'Great communication throughout the hiring process. Very professional.',
				date: '2026-05-15',
			},
			{
				id: 2,
				candidate: 'Sarah Chen',
				rating: 4,
				comment: 'Good experience, but the interview process took longer than expected.',
				date: '2026-04-22',
			},
		],
		incidents: [
			{
				id: 1,
				type: 'Delayed Response',
				severity: 'low',
				date: '2026-05-10',
				resolved: true,
			},
		],
	})

	const scoreChange = trustData.overallScore - trustData.previousScore
	const scoreColor =
		trustData.overallScore >= 80
			? 'text-green-500'
			: trustData.overallScore >= 60
				? 'text-yellow-500'
				: 'text-red-500'
	const scoreBg =
		trustData.overallScore >= 80
			? 'bg-green-500'
			: trustData.overallScore >= 60
				? 'bg-yellow-500'
				: 'bg-red-500'

	return (
		<div className='min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900'>
			<div className='container mx-auto px-4 py-8 max-w-6xl'>
				<div className='mb-6'>
					<Link
						to='/recruiter/dashboard'
						className='text-gray-400 hover:text-white flex items-center gap-2 mb-4'
					>
						<ArrowLeft className='w-4 h-4' />
						Back to Dashboard
					</Link>
				</div>

				{/* Overall Score Card */}
				<Card className='bg-white/10 backdrop-blur-lg border-white/20 mb-8'>
					<CardContent className='pt-6'>
						<div className='flex items-center justify-between'>
							<div className='flex items-center gap-6'>
								<div className='relative'>
									<div
										className={`w-24 h-24 rounded-full ${scoreBg} bg-opacity-20 flex items-center justify-center`}
									>
										<span className={`text-4xl font-bold ${scoreColor}`}>
											{trustData.overallScore}
										</span>
									</div>
									<div className='absolute -bottom-1 -right-1 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg'>
										{scoreChange > 0 ? (
											<TrendingUp className='w-5 h-5 text-green-500' />
										) : scoreChange < 0 ? (
											<TrendingDown className='w-5 h-5 text-red-500' />
										) : (
											<div className='w-2 h-2 bg-gray-400 rounded-full' />
										)}
									</div>
								</div>
								<div>
									<h1 className='text-3xl font-bold text-white mb-1'>TrustScore</h1>
									<p className='text-gray-400'>
										{scoreChange > 0 ? '+' : ''}
										{scoreChange} from last month
									</p>
									<div className='flex items-center gap-2 mt-2'>
										<Badge className='bg-green-500/20 text-green-400 border-green-500/30'>
											<CheckCircle2 className='w-3 h-3 mr-1' />
											Verified
										</Badge>
										<span className='text-sm text-gray-500'>Updated daily</span>
									</div>
								</div>
							</div>
							<div className='text-right'>
								<p className='text-sm text-gray-400 mb-1'>Percentile</p>
								<p className='text-2xl font-bold text-white'>Top 15%</p>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Score Components */}
				<div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8'>
					{trustData.components.map((component) => (
						<Card key={component.name} className='bg-white/10 backdrop-blur-lg border-white/20'>
							<CardContent className='pt-6'>
								<div className='flex items-center justify-between mb-3'>
									<span className='text-gray-300 font-medium'>{component.name}</span>
									<div className='flex items-center gap-1'>
										{component.trend === 'up' && <TrendingUp className='w-4 h-4 text-green-400' />}
										{component.trend === 'down' && (
											<TrendingDown className='w-4 h-4 text-red-400' />
										)}
										{component.trend === 'stable' && (
											<div className='w-2 h-2 bg-gray-400 rounded-full' />
										)}
										<span
											className={`text-lg font-bold ${
												component.score >= 80
													? 'text-green-400'
													: component.score >= 60
														? 'text-yellow-400'
														: 'text-red-400'
											}`}
										>
											{component.score}
										</span>
									</div>
								</div>
								<Progress value={component.score} className='h-2 mb-2' />
								<p className='text-xs text-gray-500'>Weight: {component.weight}%</p>
							</CardContent>
						</Card>
					))}
				</div>

				{/* Verification Status */}
				<div className='grid grid-cols-1 md:grid-cols-2 gap-6 mb-8'>
					<Card className='bg-white/10 backdrop-blur-lg border-white/20'>
						<CardHeader>
							<CardTitle className='text-white flex items-center gap-2'>
								<Shield className='w-5 h-5 text-purple-400' />
								Verification Status
							</CardTitle>
						</CardHeader>
						<CardContent className='space-y-4'>
							<div className='flex items-center justify-between'>
								<div className='flex items-center gap-3'>
									<div className='w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center'>
										<CheckCircle2 className='w-4 h-4 text-green-400' />
									</div>
									<span className='text-gray-300'>Identity Verification</span>
								</div>
								<Badge className='bg-green-500/20 text-green-400'>Complete</Badge>
							</div>
							<div className='flex items-center justify-between'>
								<div className='flex items-center gap-3'>
									<div className='w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center'>
										<CheckCircle2 className='w-4 h-4 text-green-400' />
									</div>
									<span className='text-gray-300'>Financial Verification</span>
								</div>
								<Badge className='bg-green-500/20 text-green-400'>Complete</Badge>
							</div>
							<div className='flex items-center justify-between'>
								<div className='flex items-center gap-3'>
									<div className='w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center'>
										<CheckCircle2 className='w-4 h-4 text-green-400' />
									</div>
									<span className='text-gray-300'>Legal Compliance</span>
								</div>
								<Badge className='bg-green-500/20 text-green-400'>Complete</Badge>
							</div>
							<div className='flex items-center justify-between'>
								<div className='flex items-center gap-3'>
									<div className='w-8 h-8 bg-yellow-500/20 rounded-lg flex items-center justify-center'>
										<Clock className='w-4 h-4 text-yellow-400' />
									</div>
									<span className='text-gray-300'>Operational Audit</span>
								</div>
								<Badge className='bg-yellow-500/20 text-yellow-400'>Pending</Badge>
							</div>
						</CardContent>
					</Card>

					<Card className='bg-white/10 backdrop-blur-lg border-white/20'>
						<CardHeader>
							<CardTitle className='text-white flex items-center gap-2'>
								<AlertTriangle className='w-5 h-5 text-yellow-400' />
								Incidents & Alerts
							</CardTitle>
						</CardHeader>
						<CardContent>
							{trustData.incidents.length === 0 ? (
								<p className='text-gray-400 text-center py-4'>No incidents reported</p>
							) : (
								<div className='space-y-3'>
									{trustData.incidents.map((incident) => (
										<div
											key={incident.id}
											className='flex items-center justify-between p-3 bg-white/5 rounded-lg'
										>
											<div>
												<p className='text-gray-300 font-medium'>{incident.type}</p>
												<p className='text-sm text-gray-500'>{incident.date}</p>
											</div>
											<div className='flex items-center gap-2'>
												<Badge
													className={
														incident.severity === 'high'
															? 'bg-red-500/20 text-red-400'
															: incident.severity === 'medium'
																? 'bg-yellow-500/20 text-yellow-400'
																: 'bg-blue-500/20 text-blue-400'
													}
												>
													{incident.severity}
												</Badge>
												{incident.resolved ? (
													<Badge className='bg-green-500/20 text-green-400'>
														<CheckCircle2 className='w-3 h-3 mr-1' />
														Resolved
													</Badge>
												) : (
													<Badge className='bg-yellow-500/20 text-yellow-400'>Open</Badge>
												)}
											</div>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</div>

				{/* Reviews */}
				<Card className='bg-white/10 backdrop-blur-lg border-white/20'>
					<CardHeader>
						<CardTitle className='text-white flex items-center gap-2'>
							<Star className='w-5 h-5 text-yellow-400' />
							Candidate Reviews
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className='space-y-4'>
							{trustData.reviews.map((review) => (
								<div key={review.id} className='p-4 bg-white/5 rounded-lg'>
									<div className='flex items-center justify-between mb-2'>
										<div className='flex items-center gap-3'>
											<div className='w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold'>
												{review.candidate.charAt(0)}
											</div>
											<div>
												<p className='text-white font-medium'>{review.candidate}</p>
												<p className='text-sm text-gray-500'>{review.date}</p>
											</div>
										</div>
										<div className='flex items-center gap-1'>
											{[1, 2, 3, 4, 5].map((star) => (
												<Star
													key={star}
													className={`w-4 h-4 ${star <= review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`}
												/>
											))}
										</div>
									</div>
									<p className='text-gray-300'>{review.comment}</p>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
