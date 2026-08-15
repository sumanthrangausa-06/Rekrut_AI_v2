import { Building2, Sparkles } from 'lucide-react'
import { SEO } from '@/components/SEO'
import { ValueProposition } from '@/components/domain/value-proposition'

const BENEFIT_CARDS = [
	{
		title: 'Top 10 Remote Employers',
		description:
			'Get a curated list of the best remote-first companies actively hiring in your field, ranked by culture, compensation, and growth opportunities.',
	},
	{
		title: 'Personalized Value Hooks',
		description:
			'AI-crafted talking points that highlight your unique fit for each company — use them in cover letters, outreach, and interviews.',
	},
	{
		title: 'Decision Maker Contacts',
		description:
			'Access verified contact details for hiring managers and recruiters so you can skip the ATS and go straight to the source.',
	},
	{
		title: 'Outreach Playbooks',
		description:
			'Proven email and LinkedIn templates with step-by-step follow-up sequences designed to get responses, not ghosted.',
	},
]

export function CompanyMatchesPage() {
	return (
		<div className='min-h-[calc(100dvh-4rem)] flex flex-col'>
			<SEO
				title='Company Matches — Find Your Perfect Employer'
				description='Discover top remote employers, personalized value hooks, decision maker contacts, and outreach playbooks with Rekrut AI.'
				canonical='/candidate/company-matches'
			/>

			{/* Header */}
			<div className='shrink-0 bg-gradient-to-br from-indigo-600 via-indigo-500 to-purple-600 px-4 py-6 sm:py-8'>
				<div className='max-w-4xl mx-auto'>
					<h1 className='text-white text-xl sm:text-2xl font-bold flex items-center gap-2'>
						<Building2 className='h-5 w-5 shrink-0' />
						<span>Company Matches</span>
					</h1>
					<p className='text-indigo-100 text-sm mt-1'>
						Discover the best remote employers and how to reach them
					</p>
				</div>
			</div>

			{/* Content */}
			<div className='flex-1 px-3 sm:px-4 py-6 max-w-4xl mx-auto w-full'>
				<div className='space-y-8'>
					{/* Intro */}
					<div className='flex items-center gap-2 text-sm text-muted-foreground'>
						<Sparkles className='h-4 w-4 text-indigo-500' />
						<span>AI-curated company intelligence for your job search</span>
					</div>

					{/* Value Proposition Section */}
					<ValueProposition
						title='What You Will Receive'
						cards={BENEFIT_CARDS}
						lockedTeaser='Advanced company intelligence and outreach automation are available with Rekrut AI Pro.'
						lockedSubtext='Upgrade to unlock real-time company matching, automated outreach sequences, and priority contact access.'
					/>
				</div>
			</div>
		</div>
	)
}
