import { ArrowRight, Calendar, History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import type { SessionHistoryItem } from './types';

const TYPE_LABELS: Record<string, string> = {
	career_path: 'Career Path',
	skill_gap: 'Skill Gap Analysis',
	learning_path: 'Learning Path',
	company_research: 'Company Research',
	application_optimize: 'Application Optimizer',
	salary_practice: 'Salary Practice',
};

const TYPE_COLORS: Record<string, string> = {
	career_path: 'bg-blue-500',
	skill_gap: 'bg-orange-500',
	learning_path: 'bg-green-500',
	company_research: 'bg-purple-500',
	application_optimize: 'bg-pink-500',
	salary_practice: 'bg-emerald-500',
};

export function HistoryTab() {
	const [history, setHistory] = useState<SessionHistoryItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	useEffect(() => {
		fetch('/api/career-coach/history?limit=50')
			.then((r) => r.json())
			.then((data) => {
				if (data.success) setHistory(data.history);
				else setError(data.error || 'Failed to load history');
			})
			.catch(() => setError('Failed to load history'))
			.finally(() => setLoading(false));
	}, []);

	if (loading) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
			</div>
		);
	}

	if (error) {
		return (
			<Card>
				<CardContent className="py-8 text-center text-sm text-red-600">{error}</CardContent>
			</Card>
		);
	}

	if (history.length === 0) {
		return (
			<Card>
				<CardContent className="py-12 text-center">
					<History className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
					<p className="text-muted-foreground">
						No coaching sessions yet. Start exploring the tabs above!
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<History className="h-5 w-5 text-indigo-500" />
					Session History
				</CardTitle>
				<CardDescription>Your recent AI coaching sessions</CardDescription>
			</CardHeader>
			<CardContent>
				<ScrollArea className="h-[500px]">
					<div className="space-y-3">
						{history.map((item) => (
							<div
								key={item.id}
								className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/50 transition-colors"
							>
								<div className="flex items-center gap-3">
									<div
										className={`h-3 w-3 rounded-full ${TYPE_COLORS[item.type] || 'bg-gray-400'}`}
									/>
									<div>
										<div className="flex items-center gap-2">
											<p className="font-medium">{TYPE_LABELS[item.type] || item.type}</p>
											<Badge variant="outline" className="text-xs">
												{item.status}
											</Badge>
										</div>
										{item.resultSummary && (
											<p className="text-xs text-muted-foreground mt-0.5">{item.resultSummary}</p>
										)}
										<div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
											<Calendar className="h-3 w-3" />
											{new Date(item.createdAt).toLocaleDateString()} at{' '}
											{new Date(item.createdAt).toLocaleTimeString([], {
												hour: '2-digit',
												minute: '2-digit',
											})}
										</div>
									</div>
								</div>
								<ArrowRight className="h-4 w-4 text-muted-foreground" />
							</div>
						))}
					</div>
				</ScrollArea>
			</CardContent>
		</Card>
	);
}
