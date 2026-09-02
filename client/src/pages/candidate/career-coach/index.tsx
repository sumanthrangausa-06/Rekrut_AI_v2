import {
	ArrowLeft,
	Building2,
	DollarSign,
	FileText,
	History,
	Lock,
	Map,
	Sparkles,
	TrendingUp,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/auth-context';
import { ApplicationOptimizerTab } from './application-optimizer-tab';
import { CareerPathsTab } from './career-paths-tab';
import { CompanyResearchTab } from './company-research-tab';
import { HistoryTab } from './history-tab';
import { SalaryPracticeTab } from './salary-practice-tab';
import { SkillGapsTab } from './skill-gaps-tab';

export function CareerCoachPage() {
	const { user } = useAuth();
	const [activeTab, setActiveTab] = useState('career-paths');
	const [accessData, setAccessData] = useState<{
		access: { allowed: boolean; remaining: number | null; tier: string };
		loading: boolean;
	}>({ access: { allowed: true, remaining: null, tier: 'free' }, loading: true });

	useState(() => {
		fetch('/api/career-coach/status')
			.then((r) => r.json())
			.then((data) => {
				setAccessData({
					access: data.access || { allowed: true, remaining: null, tier: 'free' },
					loading: false,
				});
			})
			.catch(() => setAccessData((p) => ({ ...p, loading: false })));
	});

	const isPro = accessData.access.tier === 'pro';
	const remaining = accessData.access.remaining;
	const showUpgradeBanner = !isPro && remaining !== null && remaining <= 2;

	return (
		<div className="min-h-[calc(100dvh-4rem)] bg-background">
			{/* Header */}
			<div className="border-b bg-card">
				<div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<Button variant="ghost" size="icon" asChild className="mr-1">
								<Link to="/candidate/ai-coaching">
									<ArrowLeft className="h-5 w-5" />
								</Link>
							</Button>
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10">
								<Sparkles className="h-5 w-5 text-indigo-500" />
							</div>
							<div>
								<h1 className="text-2xl font-bold tracking-tight">AI Career Coach</h1>
								<p className="text-sm text-muted-foreground">
									Personalized career guidance powered by real market data
								</p>
							</div>
						</div>
						<div className="flex items-center gap-3">
							{accessData.loading ? (
								<Skeleton className="h-6 w-24" />
							) : (
								<Badge variant={isPro ? 'default' : 'secondary'} className="gap-1">
									{isPro ? (
										<>
											<Sparkles className="h-3 w-3" /> Pro
										</>
									) : (
										<>
											<Lock className="h-3 w-3" /> Free
											{remaining !== null && <span className="ml-1">({remaining} left today)</span>}
										</>
									)}
								</Badge>
							)}
						</div>
					</div>
				</div>
			</div>

			{showUpgradeBanner && (
				<div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
					<Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
						<CardContent className="flex items-center justify-between py-3">
							<p className="text-sm text-amber-800 dark:text-amber-200">
								You're almost out of free AI coaching sessions. Upgrade to Pro for unlimited access.
							</p>
							<Button size="sm" variant="outline" asChild className="border-amber-300">
								<Link to="/pricing">Upgrade</Link>
							</Button>
						</CardContent>
					</Card>
				</div>
			)}

			{/* Tabs */}
			<div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
				<Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
					<TabsList className="grid w-full grid-cols-3 sm:grid-cols-6">
						<TabsTrigger value="career-paths" className="gap-1.5">
							<Map className="h-4 w-4" />
							<span className="hidden sm:inline">Career Paths</span>
						</TabsTrigger>
						<TabsTrigger value="skill-gaps" className="gap-1.5">
							<TrendingUp className="h-4 w-4" />
							<span className="hidden sm:inline">Skill Gaps</span>
						</TabsTrigger>
						<TabsTrigger value="company-research" className="gap-1.5">
							<Building2 className="h-4 w-4" />
							<span className="hidden sm:inline">Companies</span>
						</TabsTrigger>
						<TabsTrigger value="application-optimizer" className="gap-1.5">
							<FileText className="h-4 w-4" />
							<span className="hidden sm:inline">Applications</span>
						</TabsTrigger>
						<TabsTrigger value="salary-practice" className="gap-1.5">
							<DollarSign className="h-4 w-4" />
							<span className="hidden sm:inline">Salary</span>
						</TabsTrigger>
						<TabsTrigger value="history" className="gap-1.5">
							<History className="h-4 w-4" />
							<span className="hidden sm:inline">History</span>
						</TabsTrigger>
					</TabsList>

					<TabsContent value="career-paths">
						<CareerPathsTab />
					</TabsContent>
					<TabsContent value="skill-gaps">
						<SkillGapsTab />
					</TabsContent>
					<TabsContent value="company-research">
						<CompanyResearchTab />
					</TabsContent>
					<TabsContent value="application-optimizer">
						<ApplicationOptimizerTab />
					</TabsContent>
					<TabsContent value="salary-practice">
						<SalaryPracticeTab />
					</TabsContent>
					<TabsContent value="history">
						<HistoryTab />
					</TabsContent>
				</Tabs>
			</div>

			<Separator />

			{/* Footer info */}
			<div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
				<p className="text-xs text-muted-foreground text-center">
					AI Career Coach recommendations are grounded in real platform data — actual job postings,
					verified company profiles, and your OmniScore factors. Results may vary based on market
					conditions.
				</p>
			</div>
		</div>
	);
}
