import {
	Bookmark,
	BookmarkCheck,
	Building2,
	Clock,
	DollarSign,
	MapPin,
	RotateCcw,
	Star,
	ThumbsUp,
	X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { trackEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { ScoreRing } from './score-ring';

export type JobCardProps = {
	id: string;
	title: string;
	company: string;
	companyLogo?: string;
	location: string;
	locationType: 'remote' | 'hybrid' | 'onsite' | 'flexible';
	jobType: 'full-time' | 'part-time' | 'contract' | 'internship' | 'freelance';
	salaryMin?: number;
	salaryMax?: number;
	salaryCurrency?: string;
	salaryPeriod?: 'year' | 'month' | 'hour';
	postedAt: string;
	tags: string[];
	matchScore?: number | null;
	isSaved?: boolean;
	onSave?: (id: string) => void;
	onApply?: (id: string) => void;
	isLiked?: boolean;
	isDisliked?: boolean;
	onLike?: (id: string) => void;
	onDislike?: (id: string) => void;
	mode?: 'default' | 'trash'; // trash mode shows restore instead of dismiss
	className?: string;
};

function formatSalary(min?: number, max?: number, currency = 'USD', period = 'year'): string {
	if (!min && !max) return 'Competitive';
	const fmt = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency,
		maximumFractionDigits: 0,
	});
	const periodLabel = period === 'year' ? '/yr' : period === 'month' ? '/mo' : '/hr';
	if (min && max) return `${fmt.format(min)} – ${fmt.format(max)}${periodLabel}`;
	if (min) return `${fmt.format(min)}+${periodLabel}`;
	return `Up to ${fmt.format(max ?? 0)}${periodLabel}`;
}

function locationLabel(type: string): string {
	switch (type) {
		case 'remote':
			return 'Remote';
		case 'hybrid':
			return 'Hybrid';
		case 'onsite':
			return 'On-site';
		case 'flexible':
			return 'Flexible';
		default:
			return type;
	}
}

function locationBadgeVariant(type: string): 'default' | 'secondary' | 'outline' | 'destructive' {
	switch (type) {
		case 'remote':
			return 'default';
		case 'hybrid':
			return 'secondary';
		case 'onsite':
			return 'outline';
		default:
			return 'outline';
	}
}

export function JobCard({
	id,
	title,
	company,
	companyLogo,
	location,
	locationType,
	jobType,
	salaryMin,
	salaryMax,
	salaryCurrency,
	salaryPeriod,
	postedAt,
	tags,
	matchScore,
	isSaved = false,
	onSave,
	onApply,
	isLiked = false,
	isDisliked = false,
	onLike,
	onDislike,
	mode = 'default',
	className,
}: JobCardProps) {
	const handleSave = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		trackEvent('job_card_save_click', { job_id: id, saved: !isSaved });
		onSave?.(id);
	};

	const handleApply = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		trackEvent('job_card_apply_click', { job_id: id });
		onApply?.(id);
	};

	const handleLike = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		trackEvent('job_card_like_click', { job_id: id, liked: !isLiked });
		onLike?.(id);
	};

	const handleDislike = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		trackEvent('job_card_dismiss_click', { job_id: id, dismissed: mode !== 'trash' });
		onDislike?.(id);
	};

	const daysAgo = Math.max(0, Math.floor((Date.now() - new Date(postedAt).getTime()) / 86400000));
	const postedText = daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`;

	return (
		<Card
			className={cn(
				'group relative overflow-hidden transition-all duration-200',
				'hover:shadow-lg hover:border-indigo-300/60 dark:hover:border-indigo-700/40',
				'focus-within:ring-2 focus-within:ring-indigo-500/30',
				className,
			)}
		>
			<Link
				to={`/candidate/jobs/${id}`}
				className="absolute inset-0 z-0"
				aria-label={`View details for ${title} at ${company}`}
			/>

			<CardContent className="relative z-10 p-4 sm:p-5">
				{/* F-pattern main row: logo (left) → content (center) → score + actions (right) */}
				<div className="flex flex-col sm:flex-row gap-4 items-start">
					{/* Left: Company Logo */}
					<div className="shrink-0">
						<Avatar className="h-14 w-14 sm:h-16 sm:w-16 border shadow-sm rounded-xl">
							<AvatarImage src={companyLogo} alt={company} />
							<AvatarFallback className="bg-indigo-50 text-indigo-600 text-base font-bold dark:bg-indigo-950/50 dark:text-indigo-300">
								{company.slice(0, 2).toUpperCase()}
							</AvatarFallback>
						</Avatar>
					</div>

					{/* Center: Title, Company, Meta */}
					<div className="flex-1 min-w-0 space-y-2.5">
						{/* Title + Company */}
						<div>
							<h3 className="font-semibold text-base sm:text-[17px] leading-tight truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors duration-200">
								{title}
							</h3>
							<p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
								<Building2 className="h-3.5 w-3.5 shrink-0" />
								<span className="break-words">{company}</span>
							</p>
						</div>

						{/* Meta row — cleaner with icons */}
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
							<span className="flex items-center gap-1 min-w-0">
								<MapPin className="h-3.5 w-3.5 shrink-0" />
								<span className="break-words">{location}</span>
							</span>
							<Badge
								variant={locationBadgeVariant(locationType)}
								className="text-xs px-1.5 py-0 h-5 font-normal"
							>
								{locationLabel(locationType)}
							</Badge>
							<span className="flex items-center gap-1 min-w-0">
								<Clock className="h-3.5 w-3.5 shrink-0" />
								<span className="break-words capitalize">{jobType.replace('-', ' ')}</span>
							</span>
							<span className="flex items-center gap-1 min-w-0">
								<DollarSign className="h-3.5 w-3.5 shrink-0" />
								<span className="break-words font-medium text-foreground/70">
									{formatSalary(salaryMin, salaryMax, salaryCurrency, salaryPeriod)}
								</span>
							</span>
						</div>

						{/* Skills — prominent pill tags */}
						{tags.length > 0 && (
							<div className="flex flex-wrap gap-1.5 pt-0.5">
								{tags.slice(0, 5).map((tag) => (
									<Badge
										key={tag}
										variant="secondary"
										className="text-xs font-normal px-2.5 py-0.5 rounded-full bg-indigo-50/70 text-indigo-700 border-indigo-100 hover:bg-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-800/40 transition-colors"
									>
										{tag}
									</Badge>
								))}
								{tags.length > 5 && (
									<Badge variant="outline" className="text-xs font-normal px-2 py-0.5 rounded-full">
										+{tags.length - 5}
									</Badge>
								)}
							</div>
						)}

						{/* Posted time */}
						<p className="text-xs text-muted-foreground pt-0.5">Posted {postedText}</p>
					</div>

					{/* Right: Score Ring + Action Rail */}
					<div className="shrink-0 flex flex-row sm:flex-col items-center gap-3 sm:gap-2 w-full sm:w-auto justify-between sm:justify-start sm:pt-1">
						{/* Score Ring — prominently displayed */}
						{matchScore != null && (
							<div className="flex flex-col items-center">
								<ScoreRing score={matchScore} size="md" />
								{matchScore >= 80 && (
									<Badge
										variant="outline"
										className="text-[10px] mt-1 border-green-200 text-green-700 dark:border-green-800 dark:text-green-400 px-1 py-0"
									>
										<Star className="h-2.5 w-2.5 mr-0.5" />
										Top
									</Badge>
								)}
							</div>
						)}

						{/* Action Rail — vertical on desktop, horizontal on mobile */}
						<div className="flex sm:flex-col gap-1">
							<button
								type="button"
								onClick={handleLike}
								className={cn(
									'relative z-20 rounded-lg transition-all duration-150 min-h-[36px] min-w-[36px] inline-flex items-center justify-center',
									isLiked
										? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 shadow-sm'
										: 'text-muted-foreground hover:bg-muted hover:text-emerald-600',
								)}
								aria-label={isLiked ? 'Unlike job' : 'Like job'}
							>
								<ThumbsUp className="h-4 w-4" />
							</button>

							<button
								type="button"
								onClick={handleSave}
								className={cn(
									'relative z-20 rounded-lg transition-all duration-150 min-h-[36px] min-w-[36px] inline-flex items-center justify-center',
									isSaved
										? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-400 shadow-sm'
										: 'text-muted-foreground hover:bg-muted hover:text-indigo-600',
								)}
								aria-label={isSaved ? 'Remove bookmark' : 'Save job'}
							>
								{isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
							</button>

							<button
								type="button"
								onClick={handleDislike}
								className={cn(
									'relative z-20 rounded-lg transition-all duration-150 min-h-[36px] min-w-[36px] inline-flex items-center justify-center',
									isDisliked
										? 'text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 shadow-sm'
										: mode === 'trash'
											? 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700'
											: 'text-muted-foreground hover:bg-muted hover:text-red-600',
								)}
								aria-label={mode === 'trash' ? 'Restore job' : 'Dismiss job'}
							>
								{mode === 'trash' ? <RotateCcw className="h-4 w-4" /> : <X className="h-4 w-4" />}
							</button>

							<Button
								size="sm"
								className="relative z-20 min-h-[36px] px-3.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
								onClick={handleApply}
							>
								Apply
							</Button>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
