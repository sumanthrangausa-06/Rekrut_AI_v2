// Quick Practice — question list. Selecting a question navigates to the
// dedicated session page (/candidate/quick-practice/:questionId) instead of
// opening a dialog overlay (reliable scrolling on mobile).

import { ArrowRight, Video } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import type { PracticeQuestion } from './coaching-types';
import { categoryConfig, difficultyColors } from './coaching-utils';

interface QuickPracticeProps {
	questions: PracticeQuestion[];
	categoryFilter: string;
	setCategoryFilter: (filter: string) => void;
}

export function QuickPractice({ questions, categoryFilter, setCategoryFilter }: QuickPracticeProps) {
	const navigate = useNavigate();

	const filteredQuestions =
		categoryFilter === 'all' ? questions : questions.filter((q) => q.category === categoryFilter);

	const categoryCounts = questions.reduce<Record<string, number>>((acc, q) => {
		acc[q.category] = (acc[q.category] || 0) + 1;
		return acc;
	}, {});

	return (
		<>
			{/* Category filter */}
			<div className="flex flex-wrap gap-2 mb-4">
				<Button
					size="sm"
					variant={categoryFilter === 'all' ? 'default' : 'outline'}
					onClick={() => setCategoryFilter('all')}
				>
					All ({questions.length})
				</Button>
				{Object.entries(categoryConfig).map(([key, cfg]) => {
					const Icon = cfg.icon;
					return (
						<Button
							key={key}
							size="sm"
							variant={categoryFilter === key ? 'default' : 'outline'}
							onClick={() => setCategoryFilter(key)}
						>
							<Icon className="h-3.5 w-3.5 mr-1" /> {cfg.label} ({categoryCounts[key] || 0})
						</Button>
					);
				})}
			</div>

			{/* Question list — navigates to the dedicated session page */}
			<div className="grid gap-3">
				{filteredQuestions.map((q) => {
					const catCfg = categoryConfig[q.category] || categoryConfig.behavioral;
					const CatIcon = catCfg.icon;
					return (
						<Card
							key={q.id}
							className="cursor-pointer hover:border-primary/50 transition-colors"
							onClick={() => navigate(`/candidate/quick-practice/${q.id}`)}
						>
							<CardContent className="p-4">
								<div className="flex items-start gap-4">
									<div className={`p-2 rounded-lg ${catCfg.bg} shrink-0`}>
										<CatIcon className={`h-4 w-4 ${catCfg.color}`} />
									</div>
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2 mb-1 flex-wrap">
											<Badge
												variant="secondary"
												className={`${catCfg.bg} ${catCfg.color} border-0`}
											>
												{catCfg.label}
											</Badge>
											<Badge
												variant="secondary"
												className={`${difficultyColors[q.difficulty]} border-0`}
											>
												{q.difficulty}
											</Badge>
											{q.times_practiced > 0 && (
												<Badge variant="outline" className="text-xs">
													Practiced {q.times_practiced}x
												</Badge>
											)}
											{q.last_score != null && (
												<Badge variant="outline" className="text-xs">
													Best: {q.last_score}/10
												</Badge>
											)}
										</div>
										<p className="font-medium text-sm">{q.question}</p>
										<div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
											<span>Key topics: {q.key_points.join(', ')}</span>
										</div>
									</div>
									<div className="flex items-center gap-1 shrink-0">
										<Video className="h-4 w-4 text-muted-foreground" />
										<ArrowRight className="h-4 w-4 text-muted-foreground" />
									</div>
								</div>
							</CardContent>
						</Card>
					);
				})}
			</div>
		</>
	);
}
