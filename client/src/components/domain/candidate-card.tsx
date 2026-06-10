import {
	Briefcase,
	ChevronRight,
	GraduationCap,
	Mail,
	MapPin,
	MessageSquare,
	Star,
	TrendingUp,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { trackEvent } from '@/lib/analytics'
import { getDiceBearAvatar } from '@/lib/avatar'
import { cn } from '@/lib/utils'

export type CandidateCardProps = {
	id: string
	name: string
	avatar?: string
	headline?: string
	location?: string
	experienceYears?: number
	education?: string
	skills: string[]
	matchScore?: number | null
	omniscore?: number | null
	trustscore?: number | null
	isTopCandidate?: boolean
	onMessage?: (id: string) => void
	onSchedule?: (id: string) => void
	onShortlist?: (id: string) => void
	className?: string
}

export function CandidateCard({
	id,
	name,
	avatar,
	headline,
	location,
	experienceYears,
	education,
	skills,
	matchScore,
	omniscore,
	trustscore,
	isTopCandidate,
	onMessage,
	onSchedule,
	onShortlist,
	className,
}: CandidateCardProps) {
	const initials = name
		.split(' ')
		.map((n) => n[0])
		.join('')
		.toUpperCase()
		.slice(0, 2)

	const handleMessage = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		trackEvent('candidate_card_message_click', { candidate_id: id })
		onMessage?.(id)
	}

	const handleSchedule = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		trackEvent('candidate_card_schedule_click', { candidate_id: id })
		onSchedule?.(id)
	}

	const handleShortlist = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		trackEvent('candidate_card_shortlist_click', { candidate_id: id })
		onShortlist?.(id)
	}

	return (
		<Card className={cn('group overflow-hidden transition-all hover:shadow-md', className)}>
			<CardHeader className='pb-2'>
				<div className='flex items-start justify-between gap-3'>
					<div className='flex items-center gap-3'>
						<Avatar className='h-12 w-12 border'>
							<AvatarImage src={avatar} alt={name} fallbackSrc={getDiceBearAvatar(id)} />
							<AvatarFallback className='bg-primary/10 text-primary font-semibold'>
								{initials}
							</AvatarFallback>
						</Avatar>
						<div className='min-w-0'>
							<div className='flex items-center gap-2'>
								<h3 className='font-semibold text-base leading-tight truncate group-hover:text-primary transition-colors'>
									{name}
								</h3>
								{isTopCandidate && (
									<Badge className='text-xs bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800'>
										<Star className='h-3 w-3 mr-0.5 fill-current' />
										Top
									</Badge>
								)}
							</div>
							{headline && <p className='text-sm text-muted-foreground truncate'>{headline}</p>}
						</div>
					</div>

					{/* Score badges */}
					<div className='flex flex-col items-end gap-1 shrink-0'>
						{matchScore != null && (
							<div
								className={cn(
									'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
									matchScore >= 80
										? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
										: matchScore >= 60
											? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
											: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
								)}
							>
								<TrendingUp className='h-3 w-3' />
								{matchScore}% match
							</div>
						)}
						{omniscore != null && (
							<div className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'>
								OmniScore {omniscore}
							</div>
						)}
						{trustscore != null && (
							<div className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'>
								Trust {trustscore}
							</div>
						)}
					</div>
				</div>
			</CardHeader>

			<CardContent className='pb-2 space-y-3'>
				{/* Meta row */}
				<div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground'>
					{location && (
						<span className='flex items-center gap-1'>
							<MapPin className='h-3.5 w-3.5' />
							{location}
						</span>
					)}
					{experienceYears != null && (
						<span className='flex items-center gap-1'>
							<Briefcase className='h-3.5 w-3.5' />
							{experienceYears} {experienceYears === 1 ? 'year' : 'years'}
						</span>
					)}
					{education && (
						<span className='flex items-center gap-1'>
							<GraduationCap className='h-3.5 w-3.5' />
							{education}
						</span>
					)}
				</div>

				{/* Skills */}
				{skills.length > 0 && (
					<div className='flex flex-wrap gap-1.5'>
						{skills.slice(0, 6).map((skill) => (
							<Badge key={skill} variant='secondary' className='text-xs font-normal'>
								{skill}
							</Badge>
						))}
						{skills.length > 6 && (
							<Badge variant='secondary' className='text-xs font-normal'>
								+{skills.length - 6}
							</Badge>
						)}
					</div>
				)}
			</CardContent>

			<CardFooter className='pt-0'>
				<div className='flex w-full gap-2'>
					<Button size='sm' variant='outline' className='flex-1 gap-1' onClick={handleMessage}>
						<MessageSquare className='h-3.5 w-3.5' />
						Message
					</Button>
					<Button size='sm' variant='outline' className='flex-1 gap-1' onClick={handleSchedule}>
						<Mail className='h-3.5 w-3.5' />
						Schedule
					</Button>
					<Button size='sm' className='flex-1 gap-1' onClick={handleShortlist}>
						<ChevronRight className='h-3.5 w-3.5' />
						Shortlist
					</Button>
				</div>
			</CardFooter>
		</Card>
	)
}
