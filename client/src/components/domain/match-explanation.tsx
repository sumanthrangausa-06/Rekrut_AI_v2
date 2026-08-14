import { ChevronDown, ChevronUp, Sparkles, AlertTriangle, CheckCircle2, TrendingUp, Shield, User } from 'lucide-react'
import { useState, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface MatchExplanationData {
	why_matched: string
	skills_match: string
	company_quality: string
	your_strength: string
}

export interface MatchExplanationProps {
	matchLevel?: string
	weightedScore?: number
	skillMatchPct?: number
	matchingSkills?: string[]
	missingSkills?: string[]
	successPrediction?: string
	similarityScore?: number
	explanation?: MatchExplanationData | null
	hideHeader?: boolean
	defaultExpanded?: boolean
	onToggleExpand?: (expanded: boolean) => void
}

interface ScoreBreakdownItem {
	label: string
	value: number
	color: string
	icon: React.ReactNode
}

function deriveScoreBreakdown(props: MatchExplanationProps): ScoreBreakdownItem[] {
	const items: ScoreBreakdownItem[] = []

	// Semantic match: from similarity_score or derive from weighted_score
	const semanticMatch = props.similarityScore != null
		? Math.round(props.similarityScore * 100)
		: props.weightedScore != null
			? Math.round(props.weightedScore * 0.45)
			: 0
	if (semanticMatch > 0) {
		items.push({
			label: 'Semantic Match',
			value: semanticMatch,
			color: 'bg-blue-500',
			icon: <TrendingUp className="h-3.5 w-3.5" />,
		})
	}

	// Skills match
	const skillsMatch = props.skillMatchPct ?? 0
	if (skillsMatch > 0) {
		items.push({
			label: 'Skills Match',
			value: skillsMatch,
			color: 'bg-emerald-500',
			icon: <CheckCircle2 className="h-3.5 w-3.5" />,
		})
	}

	// Company quality: try to extract from explanation or use a default
	let companyQuality = 0
	if (props.explanation?.company_quality) {
		const trustScoreMatch = props.explanation.company_quality.match(/TrustScore\s+(\d+)/)
		if (trustScoreMatch) {
			companyQuality = Math.min(100, Math.round(parseInt(trustScoreMatch[1], 10) / 10))
		}
	}
	if (companyQuality > 0) {
		items.push({
			label: 'Company Quality',
			value: companyQuality,
			color: 'bg-purple-500',
			icon: <Shield className="h-3.5 w-3.5" />,
		})
	}

	// Profile strength: derive from explanation or weighted_score remainder
	let profileStrength = 0
	if (props.explanation?.your_strength) {
		const omniMatch = props.explanation.your_strength.match(/OmniScore\s+(\d+)/)
		if (omniMatch) {
			profileStrength = Math.min(100, Math.round(parseInt(omniMatch[1], 10) / 10))
		}
	}
	if (profileStrength === 0 && props.weightedScore != null) {
		profileStrength = Math.min(100, Math.round(props.weightedScore * 0.35))
	}
	if (profileStrength > 0) {
		items.push({
			label: 'Profile Strength',
			value: profileStrength,
			color: 'bg-amber-500',
			icon: <User className="h-3.5 w-3.5" />,
		})
	}

	return items
}

function generateWhyMatchReasons(props: MatchExplanationProps): string[] {
	const reasons: string[] = []
	const { matchingSkills, missingSkills, explanation, weightedScore, successPrediction } = props

	// Build specific reasons from available data
	if (explanation?.why_matched) {
		const pctMatch = explanation.why_matched.match(/(\d+)%/)
		if (pctMatch) {
			const pct = parseInt(pctMatch[1], 10)
			reasons.push(`Your profile aligns ${pct}% with this role's requirements based on semantic analysis of your experience, skills, and career trajectory.`)
		} else {
			reasons.push(explanation.why_matched)
		}
	}

	if (matchingSkills && matchingSkills.length > 0) {
		const topSkills = matchingSkills.slice(0, 3)
		reasons.push(`You have key skills that match: ${topSkills.join(', ')}${matchingSkills.length > 3 ? ` and ${matchingSkills.length - 3} more` : ''}.`)
	}

	if (explanation?.skills_match) {
		const skillsPct = explanation.skills_match.match(/(\d+)%/)
		if (skillsPct) {
			reasons.push(`${skillsPct[1]}% of required skills are present in your profile.`)
		}
	}

	if (explanation?.company_quality) {
		reasons.push(`The company has a strong reputation — ${explanation.company_quality}.`)
	}

	if (explanation?.your_strength) {
		reasons.push(explanation.your_strength)
	}

	if (successPrediction && weightedScore && weightedScore >= 75) {
		reasons.push(`AI predicts a ${successPrediction.toLowerCase()} probability of advancing to the interview stage.`)
	}

	// Fallback generic (should rarely trigger with real data)
	if (reasons.length === 0 && weightedScore != null) {
		reasons.push(`This role scores ${Math.round(weightedScore)}% overall match against your profile.`)
	}

	return reasons
}

function generateConcerns(props: MatchExplanationProps): string[] {
	const concerns: string[] = []
	const { missingSkills, weightedScore, matchLevel, skillMatchPct } = props

	if (missingSkills && missingSkills.length > 0) {
		const topMissing = missingSkills.slice(0, 3)
		concerns.push(`Missing skills: ${topMissing.join(', ')}${missingSkills.length > 3 ? ` and ${missingSkills.length - 3} more` : ''}. Consider adding these to your profile or taking relevant courses.`)
	}

	if (skillMatchPct != null && skillMatchPct < 60) {
		concerns.push(`Skills coverage is ${skillMatchPct}% — below the 60% threshold most recruiters look for.`)
	}

	if (weightedScore != null && weightedScore < 60) {
		concerns.push(`Overall match score is ${Math.round(weightedScore)}%, which is below the recommended threshold of 60%.`)
	}

	if (matchLevel === 'fair' || matchLevel === 'poor') {
		concerns.push(`This is rated as a "${matchLevel}" match — you may face strong competition from higher-scoring candidates.`)
	}

	return concerns
}

function MatchScoreBar({ label, value, color, icon }: ScoreBreakdownItem) {
	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between text-xs">
				<div className="flex items-center gap-1.5 text-muted-foreground">
					{icon}
					<span className="font-medium">{label}</span>
				</div>
				<span className="font-semibold tabular-nums">{value}%</span>
			</div>
			<div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
				<div
					className={cn('h-full transition-all duration-700 ease-out rounded-full', color)}
					style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
				/>
			</div>
		</div>
	)
}

export function MatchExplanation({
	matchLevel,
	weightedScore,
	skillMatchPct,
	matchingSkills,
	missingSkills,
	successPrediction,
	similarityScore,
	explanation,
	hideHeader = false,
	defaultExpanded,
	onToggleExpand,
}: MatchExplanationProps) {
	const score = weightedScore != null ? Math.round(weightedScore) : null
	const isHighMatch = score != null && score >= 70
	const resolvedExpanded = defaultExpanded !== undefined ? defaultExpanded : isHighMatch
	const [expanded, setExpanded] = useState(resolvedExpanded)

	const isExpanded = onToggleExpand ? resolvedExpanded : expanded

	const handleToggle = () => {
		const next = !isExpanded
		if (onToggleExpand) {
			onToggleExpand(next)
		} else {
			setExpanded(next)
		}
	}

	const whyMatchReasons = useMemo(() => generateWhyMatchReasons({
		matchLevel,
		weightedScore,
		skillMatchPct,
		matchingSkills,
		missingSkills,
		successPrediction,
		similarityScore,
		explanation,
	}), [matchLevel, weightedScore, skillMatchPct, matchingSkills, missingSkills, successPrediction, similarityScore, explanation])

	const concerns = useMemo(() => generateConcerns({
		matchLevel,
		weightedScore,
		skillMatchPct,
		matchingSkills,
		missingSkills,
		successPrediction,
		similarityScore,
		explanation,
	}), [matchLevel, weightedScore, skillMatchPct, matchingSkills, missingSkills, successPrediction, similarityScore, explanation])

	const scoreBreakdown = useMemo(() => deriveScoreBreakdown({
		matchLevel,
		weightedScore,
		skillMatchPct,
		matchingSkills,
		missingSkills,
		successPrediction,
		similarityScore,
		explanation,
	}), [matchLevel, weightedScore, skillMatchPct, matchingSkills, missingSkills, successPrediction, similarityScore, explanation])

	// If no match data at all, don't render
	if (score == null && !explanation && (!matchingSkills || matchingSkills.length === 0)) {
		return null
	}

	return (
		<div className={cn(
			'rounded-xl border border-emerald-200/60 overflow-hidden',
			'bg-emerald-50/70 dark:bg-emerald-950/20',
			'dark:border-emerald-800/40',
		)}>
			{/* Header */}
			{!hideHeader && (
				<button
					onClick={handleToggle}
					className={cn(
						'w-full flex items-center justify-between gap-3 px-4 py-3',
						'text-left transition-colors hover:bg-emerald-100/50 dark:hover:bg-emerald-900/20',
						'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40',
					)}
					aria-expanded={isExpanded}
				>
					<div className="flex items-center gap-2.5 min-w-0">
						<div className="shrink-0 p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/40">
							<Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
						</div>
						<div className="min-w-0">
							<p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 truncate">
								AI Match Analysis
							</p>
							{score != null && (
								<p className="text-xs text-emerald-600/80 dark:text-emerald-400/70">
									{score}% match · {matchLevel ? matchLevel.charAt(0).toUpperCase() + matchLevel.slice(1) : 'Unknown'} match
									{successPrediction && ` · ${successPrediction} success prediction`}
								</p>
							)}
						</div>
					</div>
					<div className="shrink-0 flex items-center gap-1.5">
						{isHighMatch && (
							<Badge
								variant="outline"
								className="text-[10px] border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400 px-1.5 py-0 h-5 hidden sm:inline-flex"
							>
								<Sparkles className="h-2.5 w-2.5 mr-0.5" />
								Strong Match
							</Badge>
						)}
						{isExpanded ? (
							<ChevronUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
						) : (
							<ChevronDown className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
						)}
					</div>
				</button>
			)}

			{/* Expanded Content */}
			{isExpanded && (
				<div className="px-4 pb-4 space-y-4">
					{/* WHY YOU'RE A STRONG MATCH */}
					{whyMatchReasons.length > 0 && (
						<div className="space-y-2.5">
							<h4 className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
								<CheckCircle2 className="h-3.5 w-3.5" />
								Why You&apos;re a Strong Match
							</h4>
							<ul className="space-y-2">
								{whyMatchReasons.map((reason, i) => (
									<li
										key={i}
										className="text-sm text-emerald-800 dark:text-emerald-200/90 leading-relaxed flex gap-2"
									>
										<span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-emerald-500" />
										<span>{reason}</span>
									</li>
								))}
							</ul>
						</div>
					)}

					{/* Skills Pills */}
					{(matchingSkills?.length || missingSkills?.length) ? (
						<div className="space-y-2">
							<h4 className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
								Skills Analysis
							</h4>
							{matchingSkills && matchingSkills.length > 0 && (
								<div className="space-y-1">
									<p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 font-medium">Matching</p>
									<div className="flex flex-wrap gap-1.5">
										{matchingSkills.map((skill) => (
											<Badge
												key={skill}
												variant="secondary"
												className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700"
											>
												<CheckCircle2 className="h-3 w-3 mr-0.5" />
												{skill}
											</Badge>
										))}
									</div>
								</div>
							)}
							{missingSkills && missingSkills.length > 0 && (
								<div className="space-y-1">
									<p className="text-xs text-amber-600/70 dark:text-amber-400/60 font-medium">Gaps</p>
									<div className="flex flex-wrap gap-1.5">
										{missingSkills.map((skill) => (
											<Badge
												key={skill}
												variant="outline"
												className="text-xs font-medium px-2.5 py-0.5 rounded-full border-amber-300 text-amber-700 bg-amber-50/60 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-700"
											>
												{skill}
											</Badge>
										))}
									</div>
								</div>
							)}
						</div>
					) : null}

					{/* Score Breakdown */}
					{scoreBreakdown.length > 0 && (
						<div className="space-y-2.5">
							<h4 className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
								<TrendingUp className="h-3.5 w-3.5" />
								Score Breakdown
							</h4>
							<div className="space-y-3">
								{scoreBreakdown.map((item) => (
									<MatchScoreBar key={item.label} {...item} />
								))}
							</div>
						</div>
					)}

					{/* CONCERNS */}
					{concerns.length > 0 && (
						<div className={cn(
							'space-y-2.5 rounded-lg border p-3',
							'bg-amber-50/60 border-amber-200/60',
							'dark:bg-amber-950/20 dark:border-amber-800/40',
						)}>
							<h4 className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
								<AlertTriangle className="h-3.5 w-3.5" />
								Concerns
							</h4>
							<ul className="space-y-2">
								{concerns.map((concern, i) => (
									<li
										key={i}
										className="text-sm text-amber-800 dark:text-amber-200/90 leading-relaxed flex gap-2"
									>
										<span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-amber-500" />
										<span>{concern}</span>
									</li>
								))}
							</ul>
						</div>
					)}

					{/* Success Prediction */}
					{successPrediction && (
						<div className="flex items-center gap-2 text-xs text-emerald-600/80 dark:text-emerald-400/70">
							<Sparkles className="h-3 w-3" />
							<span>
								AI predicts a <strong className="text-emerald-700 dark:text-emerald-300">{successPrediction}</strong> likelihood of interview success
							</span>
						</div>
					)}
				</div>
			)}
		</div>
	)
}
