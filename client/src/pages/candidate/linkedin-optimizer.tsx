import {
	ArrowRight,
	Briefcase,
	Calendar,
	CheckCircle,
	FileText,
	Lightbulb,
	Link2,
	Link2Off,
	Linkedin,
	RefreshCw,
	Sparkles,
	User,
	Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiCall } from '@/lib/api';

interface LinkedInTip {
	category: string;
	title: string;
	description: string;
	priority: 'high' | 'medium' | 'low';
	actionable: string;
}

interface WeeklyAction {
	day: string;
	action: string;
}

interface ProfileStatus {
	connected: boolean;
	completenessScore: number;
	missingSections: string[];
	linkedinUrl: string | null;
}

interface LinkedInTipsResult {
	profileStatus: ProfileStatus;
	tips: LinkedInTip[];
	headlineSuggestions: string[];
	aboutSectionTemplate: string;
	weeklyActionPlan: WeeklyAction[];
	summary: string;
}

export function LinkedInOptimizerPage() {
	const [loading, setLoading] = useState(true);
	const [result, setResult] = useState<LinkedInTipsResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState('tips');

	const loadTips = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiCall<LinkedInTipsResult & { success: boolean; error?: string }>(
				'/profile-enhancement/linkedin-tips',
			);
			if (res.success) {
				setResult(res);
			} else {
				setError(res.error || 'Failed to load LinkedIn tips.');
			}
		} catch (err: any) {
			setError(err?.message || 'Failed to load LinkedIn tips.');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadTips();
	}, [loadTips]);

	if (loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
			</div>
		);
	}

	if (error) {
		return (
			<div className="px-4 sm:px-6 space-y-4">
				<div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
				<Button onClick={loadTips} variant="outline" className="gap-2">
					<RefreshCw className="h-4 w-4" />
					Retry
				</Button>
			</div>
		);
	}

	if (!result) return null;

	const categoryIcon = (category: string) => {
		switch (category) {
			case 'headline':
				return <FileText className="h-4 w-4" />;
			case 'about':
				return <User className="h-4 w-4" />;
			case 'experience':
				return <Briefcase className="h-4 w-4" />;
			case 'skills':
				return <Sparkles className="h-4 w-4" />;
			case 'networking':
				return <Users className="h-4 w-4" />;
			case 'content':
				return <Lightbulb className="h-4 w-4" />;
			default:
				return <Linkedin className="h-4 w-4" />;
		}
	};

	const categoryLabel = (category: string) => {
		return category.charAt(0).toUpperCase() + category.slice(1);
	};

	const priorityBadge = (priority: string) => {
		switch (priority) {
			case 'high':
				return 'bg-red-100 text-red-700';
			case 'medium':
				return 'bg-amber-100 text-amber-700';
			default:
				return 'bg-blue-100 text-blue-700';
		}
	};

	const completenessColor = (score: number) => {
		if (score >= 80) return 'text-emerald-600';
		if (score >= 60) return 'text-amber-600';
		if (score >= 40) return 'text-orange-600';
		return 'text-red-600';
	};

	const completenessBg = (score: number) => {
		if (score >= 80) return 'bg-emerald-600';
		if (score >= 60) return 'bg-amber-500';
		if (score >= 40) return 'bg-orange-500';
		return 'bg-red-500';
	};

	return (
		<div className="space-y-6 px-4 sm:px-6">
			{/* Header */}
			<div className="flex items-center gap-3">
				<div className="p-2 rounded-lg bg-primary/10">
					<Linkedin className="h-5 w-5 text-primary" />
				</div>
				<div>
					<h1 className="text-2xl font-heading font-bold">LinkedIn Optimizer</h1>
					<p className="text-muted-foreground text-sm">
						AI-generated tips to optimize your LinkedIn profile and grow your professional network
					</p>
				</div>
			</div>

			{/* Profile Status */}
			<Card>
				<CardContent className="p-6">
					<div className="flex flex-col sm:flex-row items-center gap-6">
						<div className="flex flex-col items-center">
							{result.profileStatus.connected ? (
								<div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
									<Link2 className="h-7 w-7 text-emerald-600" />
								</div>
							) : (
								<div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
									<Link2Off className="h-7 w-7 text-red-600" />
								</div>
							)}
							<p className="text-xs font-medium mt-2">
								{result.profileStatus.connected ? 'Connected' : 'Not Connected'}
							</p>
						</div>

						<div className="flex-1 w-full">
							<div className="flex items-center justify-between mb-2">
								<span className="text-sm font-medium">Profile Completeness</span>
								<span
									className={`text-sm font-bold ${completenessColor(result.profileStatus.completenessScore)}`}
								>
									{result.profileStatus.completenessScore}%
								</span>
							</div>
							<div className="h-2 w-full rounded-full bg-muted overflow-hidden">
								<div
									className={`h-full rounded-full transition-all ${completenessBg(result.profileStatus.completenessScore)}`}
									style={{ width: `${result.profileStatus.completenessScore}%` }}
								/>
							</div>
							{result.profileStatus.missingSections.length > 0 && (
								<p className="text-xs text-muted-foreground mt-2">
									Missing: {result.profileStatus.missingSections.join(', ')}
								</p>
							)}
						</div>

						{result.profileStatus.linkedinUrl && (
							<a
								href={result.profileStatus.linkedinUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
							>
								View Profile
								<ArrowRight className="h-3.5 w-3.5" />
							</a>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Summary */}
			<Card className="bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-100 dark:border-indigo-900">
				<CardContent className="p-4">
					<div className="flex items-start gap-3">
						<Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
						<p className="text-sm text-indigo-900 dark:text-indigo-100">{result.summary}</p>
					</div>
				</CardContent>
			</Card>

			{/* Tabs */}
			<Tabs value={activeTab} onValueChange={setActiveTab}>
				<TabsList>
					<TabsTrigger value="tips">
						<Lightbulb className="h-4 w-4 mr-1.5" />
						Optimization Tips
					</TabsTrigger>
					<TabsTrigger value="headlines">
						<FileText className="h-4 w-4 mr-1.5" />
						Headlines
					</TabsTrigger>
					<TabsTrigger value="about">
						<User className="h-4 w-4 mr-1.5" />
						About Section
					</TabsTrigger>
					<TabsTrigger value="plan">
						<Calendar className="h-4 w-4 mr-1.5" />
						Weekly Plan
					</TabsTrigger>
				</TabsList>

				<TabsContent value="tips" className="space-y-4 mt-4">
					{result.tips.map((tip, i) => (
						<Card key={i}>
							<CardContent className="p-4">
								<div className="flex items-start gap-3">
									<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
										{categoryIcon(tip.category)}
									</div>
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2 flex-wrap">
											<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
												{categoryLabel(tip.category)}
											</span>
											<span
												className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${priorityBadge(tip.priority)}`}
											>
												{tip.priority.toUpperCase()}
											</span>
										</div>
										<h3 className="text-sm font-medium mt-1">{tip.title}</h3>
										<p className="text-xs text-muted-foreground mt-0.5">{tip.description}</p>
										<div className="mt-2 flex items-start gap-1.5 rounded bg-muted p-2">
											<CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
											<p className="text-xs font-medium">{tip.actionable}</p>
										</div>
									</div>
								</div>
							</CardContent>
						</Card>
					))}
					{result.tips.length === 0 && (
						<p className="text-sm text-muted-foreground">No tips available.</p>
					)}
				</TabsContent>

				<TabsContent value="headlines" className="mt-4">
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="flex items-center gap-2 text-base">
								<Sparkles className="h-5 w-5 text-primary" />
								AI-Generated Headline Suggestions
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							{result.headlineSuggestions.map((headline, i) => (
								<div key={i} className="flex items-center justify-between rounded-lg bg-muted p-3">
									<p className="text-sm font-medium">"{headline}"</p>
									<Button
										variant="ghost"
										size="sm"
										className="shrink-0"
										onClick={() => {
											navigator.clipboard.writeText(headline);
										}}
									>
										Copy
									</Button>
								</div>
							))}
							{result.headlineSuggestions.length === 0 && (
								<p className="text-sm text-muted-foreground">No headline suggestions available.</p>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="about" className="mt-4">
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="flex items-center gap-2 text-base">
								<FileText className="h-5 w-5 text-primary" />
								About Section Template
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="rounded-lg bg-muted p-4">
								<p className="text-sm whitespace-pre-line leading-relaxed">
									{result.aboutSectionTemplate || 'No template available.'}
								</p>
							</div>
							<Button
								variant="outline"
								className="mt-3 gap-2"
								onClick={() => {
									if (result.aboutSectionTemplate) {
										navigator.clipboard.writeText(result.aboutSectionTemplate);
									}
								}}
								disabled={!result.aboutSectionTemplate}
							>
								Copy Template
							</Button>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="plan" className="mt-4">
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="flex items-center gap-2 text-base">
								<Calendar className="h-5 w-5 text-primary" />
								Weekly Action Plan
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							{result.weeklyActionPlan.map((item, i) => (
								<div key={i} className="flex items-start gap-3 rounded-lg bg-muted p-3">
									<div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 shrink-0">
										<span className="text-[10px] font-bold text-primary">{item.day.charAt(0)}</span>
									</div>
									<div>
										<p className="text-xs font-medium text-muted-foreground">{item.day}</p>
										<p className="text-sm mt-0.5">{item.action}</p>
									</div>
								</div>
							))}
							{result.weeklyActionPlan.length === 0 && (
								<p className="text-sm text-muted-foreground">No action plan available.</p>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	);
}

export default LinkedInOptimizerPage;
