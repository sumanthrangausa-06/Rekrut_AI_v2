import { CheckCircle2, Lock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export interface BenefitCard {
	title: string
	description: string
}

export interface ValuePropositionProps {
	/** Section title displayed next to the checkmark icon */
	title: string
	/** Array of benefit cards to display in the 2x2 grid */
	cards: BenefitCard[]
	/** Locked section teaser text */
	lockedTeaser: string
	/** Optional additional text below the locked teaser */
	lockedSubtext?: string
}

export function ValueProposition({
	title,
	cards,
	lockedTeaser,
	lockedSubtext,
}: ValuePropositionProps) {
	return (
		<div className='space-y-6'>
			{/* Section Header */}
			<div className='flex items-center gap-2.5'>
				<CheckCircle2 className='h-5 w-5 text-indigo-600 dark:text-indigo-400 shrink-0' />
				<h2 className='text-lg font-semibold text-foreground'>{title}</h2>
			</div>

			{/* Benefit Cards Grid */}
			<div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
				{cards.map((card, i) => (
					<Card
						key={i}
						className='border-indigo-100 dark:border-indigo-900/40 bg-white dark:bg-slate-900/50 hover:border-indigo-200 dark:hover:border-indigo-800 transition-colors'
					>
						<CardContent className='p-4 sm:p-5 space-y-2.5'>
							<div className='flex items-center gap-2.5'>
								<CheckCircle2 className='h-5 w-5 text-emerald-500 shrink-0' />
								<h3 className='font-bold text-sm text-foreground'>
									{card.title}
								</h3>
							</div>
							<p className='text-sm text-muted-foreground leading-relaxed pl-7.5'>
								{card.description}
							</p>
						</CardContent>
					</Card>
				))}
			</div>

			{/* Locked Premium Section */}
			<Card className='border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30'>
				<CardContent className='p-5 sm:p-6 flex items-start gap-4'>
					<div className='shrink-0 p-2 rounded-lg bg-slate-100 dark:bg-slate-800'>
						<Lock className='h-5 w-5 text-slate-500 dark:text-slate-400' />
					</div>
					<div className='space-y-1'>
						<p className='text-sm font-medium text-foreground'>{lockedTeaser}</p>
						{lockedSubtext && (
							<p className='text-sm text-muted-foreground'>{lockedSubtext}</p>
						)}
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
