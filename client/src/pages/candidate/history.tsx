import { ArrowLeft, CheckCircle, Clock, Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiCall } from '@/lib/api';

interface HistoryInterview {
	id: number;
	created_at: string;
	status: string;
	overall_score: number | null;
	job_title: string | null;
	interview_type: string;
	questions: any[];
}

export function HistoryPage() {
	const navigate = useNavigate();
	const [interviews, setInterviews] = useState<HistoryInterview[]>([]);
	const [loading, setLoading] = useState(true);
	const [tab, setTab] = useState('all');

	useEffect(() => {
		async function loadHistory() {
			try {
				const data = await apiCall<{ interviews: HistoryInterview[] }>(
					'/interviews/history?limit=50',
				);
				setInterviews(data.interviews || []);
			} catch (err) {
				console.error('Failed to load history:', err);
			} finally {
				setLoading(false);
			}
		}
		loadHistory();
	}, []);

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						onClick={() => navigate('/candidate')}
						className="min-h-[44px] min-w-[44px]"
					>
						<ArrowLeft className="h-4 w-4 mr-2" />
						Back to Dashboard
					</Button>
				</div>
				<Button
					onClick={() => navigate('/candidate/ai-coaching')}
					className="min-h-[44px] min-w-[44px]"
				>
					<Video className="h-4 w-4 mr-2" />
					New Interview
				</Button>
			</div>

			<div>
				<h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Interview History</h1>
				<p className="text-muted-foreground">Review your past mock interviews and track progress</p>
			</div>

			<Tabs value={tab} onValueChange={setTab}>
				<TabsList>
					<TabsTrigger value="all">All</TabsTrigger>
					<TabsTrigger value="completed">Completed</TabsTrigger>
					<TabsTrigger value="in-progress">In Progress</TabsTrigger>
				</TabsList>

				<TabsContent value="all" className="space-y-4">
					{loading ? (
						<Card>
							<CardContent className="flex items-center justify-center py-12">
								<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mr-3" />
								<p className="text-muted-foreground">Loading your interview history...</p>
							</CardContent>
						</Card>
					) : interviews.length === 0 ? (
						<Card>
							<CardContent className="flex flex-col items-center justify-center py-12 text-center">
								<Video className="h-12 w-12 text-muted-foreground mb-4" />
								<h3 className="text-lg font-semibold mb-2">No interviews yet</h3>
								<p className="text-muted-foreground mb-4">
									Start practicing to build your interview history
								</p>
								<Button
									onClick={() => navigate('/candidate/ai-coaching')}
									className="min-h-[44px] min-w-[44px]"
								>
									<Video className="h-4 w-4 mr-2" />
									Start Mock Interview
								</Button>
							</CardContent>
						</Card>
					) : (
						<div className="space-y-3">
							{interviews.map((interview) => (
								<HistoryItem key={interview.id} interview={interview} />
							))}
						</div>
					)}
				</TabsContent>

				<TabsContent value="completed" className="space-y-4">
					{interviews.filter((i) => i.status === 'completed').length === 0 ? (
						<Card>
							<CardContent className="flex flex-col items-center justify-center py-12 text-center">
								<CheckCircle className="h-12 w-12 text-muted-foreground mb-4" />
								<p className="text-muted-foreground">No completed interviews yet</p>
							</CardContent>
						</Card>
					) : (
						<div className="space-y-3">
							{interviews
								.filter((i) => i.status === 'completed')
								.map((interview) => (
									<HistoryItem key={interview.id} interview={interview} />
								))}
						</div>
					)}
				</TabsContent>

				<TabsContent value="in-progress" className="space-y-4">
					{interviews.filter((i) => i.status !== 'completed').length === 0 ? (
						<Card>
							<CardContent className="flex flex-col items-center justify-center py-12 text-center">
								<Clock className="h-12 w-12 text-muted-foreground mb-4" />
								<p className="text-muted-foreground">No in-progress interviews</p>
							</CardContent>
						</Card>
					) : (
						<div className="space-y-3">
							{interviews
								.filter((i) => i.status !== 'completed')
								.map((interview) => (
									<HistoryItem key={interview.id} interview={interview} />
								))}
						</div>
					)}
				</TabsContent>
			</Tabs>
		</div>
	);
}

function HistoryItem({ interview }: { interview: HistoryInterview }) {
	const navigate = useNavigate();
	const date = new Date(interview.created_at).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	});

	const isCompleted = interview.status === 'completed';

	return (
		<Card className="hover:shadow-md transition-shadow">
			<CardContent className="p-6">
				<div className="flex items-center gap-4">
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-3 mb-2">
							<Badge
								variant={isCompleted ? 'default' : 'secondary'}
								className={
									isCompleted
										? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
										: 'bg-amber-100 text-amber-700 hover:bg-amber-100'
								}
							>
								{isCompleted ? (
									<>
										<CheckCircle className="h-3 w-3 mr-1" />
										Completed
									</>
								) : (
									<>
										<Clock className="h-3 w-3 mr-1" />
										In Progress
									</>
								)}
							</Badge>
							<span className="text-sm text-muted-foreground">{date}</span>
						</div>

						<h3 className="font-semibold text-lg truncate">
							{interview.job_title || interview.interview_type} Interview
						</h3>

						<p className="text-sm text-muted-foreground">
							{Array.isArray(interview.questions) ? interview.questions.length : 0} questions
						</p>
					</div>

					<div className="text-center min-w-[80px] hidden sm:block">
						{interview.overall_score ? (
							<div className="text-2xl sm:text-2xl sm:text-3xl font-bold text-emerald-600">
								{interview.overall_score}
								<span className="text-lg text-muted-foreground">/10</span>
							</div>
						) : (
							<div className="text-2xl text-muted-foreground">--</div>
						)}
					</div>

					<Button
						variant="ghost"
						size="sm"
						className="min-h-[44px] min-w-[44px]"
						onClick={() =>
							navigate(
								isCompleted
									? `/candidate/interview-analysis?id=${interview.id}`
									: `/candidate/ai-coaching?session=${interview.id}`,
							)
						}
					>
						{isCompleted ? 'Review' : 'Continue'}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
