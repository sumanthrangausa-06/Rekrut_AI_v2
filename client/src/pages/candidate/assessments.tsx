import { AlertTriangle, CheckCircle, Clock, Play, Shield, Trophy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/domain/empty-state';
import { Skeleton } from '@/components/domain/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiCall } from '@/lib/api';
import {
	AssessmentConfigureFlow,
	type CatalogSubject,
	type CatalogTopic,
} from './assessment-configure';

interface SkillCatalog {
	catalog_name: string;
	category: string;
	icon: string;
	description: string;
	difficulty: string;
	skill_id: number | null;
	is_verified: boolean;
	verified_score: number | null;
	assessment_count: number;
	best_score: number | null;
	last_attempted: string | null;
}

interface AssessmentResult {
	id: number;
	score: number | null;
	max_score: number | null;
	passed: boolean;
	anti_cheat_score: number | null;
	duration_seconds: number;
	completed_at: string;
	title: string;
	skill_name: string;
	category: string;
	max_difficulty_reached: number;
	tab_switches: number;
	copy_paste_attempts: number;
	// #1688: session snapshot fields from GET /results (snake_case, the
	// payload's own convention) — null on legacy topic-less attempts.
	topic_id: number | null;
	topic_name: string | null;
	format: string | null;
	difficulty_band: string | null;
	behavioral_flags?:
		| { partial?: boolean; answers_given?: number; total_questions?: number; correct_count?: number | null }
		| string
		| null;
}

interface AssignedAttempt {
	attempt_id: number;
	assessment_id: number;
	application_id: number;
	status: string;
	created_at: string;
	assessment_title: string;
	job_id: number;
	job_title: string;
}

export function CandidateAssessmentsPage() {
	const navigate = useNavigate();
	const [tab, setTab] = useState('available');
	const [skills, setSkills] = useState<SkillCatalog[]>([]);
	// #1654 (C2): the catalogue (subjects → topics, C1 API) is the primary
	// Available surface. null = not loaded / failed → the legacy
	// /available list below remains the fallback (dual-read, design §6.3).
	const [catalog, setCatalog] = useState<CatalogSubject[] | null>(null);
	const [configuring, setConfiguring] = useState<{
		subject: CatalogSubject;
		topic: CatalogTopic;
	} | null>(null);
	const [results, setResults] = useState<AssessmentResult[]>([]);
	const [assigned, setAssigned] = useState<AssignedAttempt[]>([]);
	const [loading, setLoading] = useState(true);
	const [starting, setStarting] = useState<string | null>(null);
	// #1606 (FR-A7): a failed start is shown inline with its reason and the
	// honest next action — never a bare alert. When the server saved a
	// resumable session, sessionId carries it and the action is Resume.
	const [startError, setStartError] = useState<{ message: string; sessionId?: number } | null>(null);

	const loadData = useCallback(async () => {
		try {
			const [skillsRes, resultsRes, assignedRes, catalogRes] = await Promise.allSettled([
				apiCall<{ skills: SkillCatalog[] }>('/assessments/available'),
				apiCall<{ results: AssessmentResult[] }>('/assessments/results'),
				apiCall<{ attempts: AssignedAttempt[] }>('/assessments/assigned'),
				apiCall<{ subjects: CatalogSubject[] }>('/assessments/catalog'),
			]);
			if (skillsRes.status === 'fulfilled') setSkills(skillsRes.value.skills || []);
			if (catalogRes.status === 'fulfilled') setCatalog(catalogRes.value.subjects || []);
			if (resultsRes.status === 'fulfilled') setResults(resultsRes.value.results || []);
			if (assignedRes.status === 'fulfilled') setAssigned(assignedRes.value.attempts || []);
		} catch {
			// silent
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadData();
	}, [loadData]);

	async function startAssessment(skill: SkillCatalog) {
		setStarting(skill.catalog_name);
		setStartError(null);
		try {
			const data = await apiCall<{ sessionId: number; skillName: string; question: unknown }>(
				'/assessments/start',
				{
					method: 'POST',
					timeoutMs: 30000,
					body: {
						skillName: skill.catalog_name,
						category: skill.category,
						skillId: skill.skill_id,
					},
				},
			);
			// Store the first question in sessionStorage so assessment-take can pick it up
			sessionStorage.setItem(
				`assessment_${data.sessionId}`,
				JSON.stringify({
					question: data.question,
					skillName: data.skillName || skill.catalog_name,
				}),
			);
			navigate(`/candidate/assessments/${data.sessionId}/take`);
		} catch (err) {
			const apiErr = err as Error & { code?: string; sessionId?: number };
			setStartError({
				message: apiErr.message || 'Failed to start assessment. Please try again.',
				sessionId: apiErr.sessionId,
			});
		} finally {
			setStarting(null);
		}
	}

	const categoryGroups = skills.reduce(
		(acc, s) => {
			const cat = s.category || 'other';
			if (!acc[cat]) acc[cat] = [];
			acc[cat].push(s);
			return acc;
		},
		{} as Record<string, SkillCatalog[]>,
	);

	const categoryLabels: Record<string, string> = {
		technical: 'Technical Skills',
		analytical: 'Analytical Skills',
		soft_skill: 'Soft Skills',
		other: 'Other',
	};

	// #1688: format/band display strings reuse the shipped configure/take
	// vocabulary verbatim (UX spec §0.2) — never a third vocabulary.
	const resultFormatLabels: Record<string, string> = {
		mixed: 'Mixed — multiple choice and written answers',
		mcq: 'Multiple choice',
		short_answer: 'Written answers',
		coding: 'Coding',
	};
	const resultBandLabels: Record<string, string> = {
		easy: 'Easy',
		medium: 'Medium',
		hard: 'Hard',
	};
	const resultConfigLabel = (r: AssessmentResult): string | null => {
		const parts: string[] = [];
		if (r.format && resultFormatLabels[r.format]) parts.push(resultFormatLabels[r.format]);
		if (r.difficulty_band && resultBandLabels[r.difficulty_band])
			parts.push(resultBandLabels[r.difficulty_band]);
		return parts.length ? parts.join(' · ') : null;
	};

	// #1688 (design §4.5): group the already-DESC-ordered results by
	// topic. Group order = first appearance in the payload (most
	// recently attempted topic first); cards keep server order within a
	// group. Topic-less attempts collect in ONE trailing legacy group —
	// no inferred topic, no fabricated label.
	const resultGroups: { key: string; heading: string; items: AssessmentResult[] }[] = [];
	const groupsByTopicId = new Map<number, (typeof resultGroups)[number]>();
	const legacyResults: AssessmentResult[] = [];
	for (const r of results) {
		if (r.topic_id != null) {
			let group = groupsByTopicId.get(r.topic_id);
			if (!group) {
				group = {
					key: `topic-${r.topic_id}`,
					heading: r.topic_name
						? `${r.skill_name || r.title} · ${r.topic_name}`
						: `${r.skill_name || r.title}`,
					items: [],
				};
				groupsByTopicId.set(r.topic_id, group);
				resultGroups.push(group);
			}
			group.items.push(r);
		} else {
			legacyResults.push(r);
		}
	}
	if (legacyResults.length) {
		resultGroups.push({
			key: 'legacy-no-topic',
			heading: 'Earlier assessments — topic not recorded',
			items: legacyResults,
		});
	}

	return (
		<div className="space-y-6 px-4 sm:px-6">
			<div>
				<h1 className="font-heading text-2xl font-bold">Skill Assessments</h1>
				<p className="text-muted-foreground">Verify your skills with AI-powered assessments</p>
			</div>

			{startError && (
				<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
					<span>{startError.message}</span>
					{startError.sessionId && (
						<Button
							variant="outline"
							className="min-h-[44px]"
							onClick={() => navigate(`/candidate/assessments/${startError.sessionId}/take`)}
						>
							Resume attempt
						</Button>
					)}
				</div>
			)}

			{/* Stats */}
			<div className="grid gap-3 sm:grid-cols-3">
				<Card>
					<CardContent className="p-4 text-center">
						<p className="text-2xl font-bold">{results.length}</p>
						<p className="text-xs text-muted-foreground">Tests Taken</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4 text-center">
						<p className="text-2xl font-bold text-emerald-600">
							{results.filter((r) => r.passed).length}
						</p>
						<p className="text-xs text-muted-foreground">Passed</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4 text-center">
						<p className="text-2xl font-bold text-blue-600">
							{skills.filter((s) => s.is_verified).length}
						</p>
						<p className="text-xs text-muted-foreground">Verified Skills</p>
					</CardContent>
				</Card>
			</div>

			<Tabs value={tab} onValueChange={setTab}>
				<TabsList>
					<TabsTrigger value="available">Available Tests</TabsTrigger>
					<TabsTrigger value="assigned">
						Assigned to You
						{assigned.length > 0 && (
							<Badge variant="default" className="ml-1.5 text-[10px] px-1.5">
								{assigned.length}
							</Badge>
						)}
					</TabsTrigger>
					<TabsTrigger value="results">My Results</TabsTrigger>
				</TabsList>

				<TabsContent value="assigned">
					{loading ? (
						<div className="space-y-4 mt-4">
							<Skeleton variant="card" count={2} />
						</div>
					) : assigned.length === 0 ? (
						<EmptyState
							icon={Clock}
							title="No assigned assessments"
							description="When a recruiter assigns you an assessment for a job you've applied to, it will appear here."
							className="mt-4"
						/>
					) : (
						<div className="space-y-3 mt-4">
							{assigned.map((a) => (
								<Card key={a.attempt_id}>
									<CardContent className="p-4">
										<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
											<div>
												<h4 className="font-medium">{a.assessment_title}</h4>
												<p className="text-xs text-muted-foreground mt-0.5">
													{a.job_title} · Assigned{' '}
													{new Date(a.created_at).toLocaleDateString()}
												</p>
											</div>
											<Button
												size="sm"
												className="gap-1 min-h-[44px]"
												onClick={() => navigate(`/candidate/job-assessment/${a.assessment_id}`)}
											>
												<Play className="h-3 w-3" /> Start Test
											</Button>
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					)}
				</TabsContent>

				<TabsContent value="available">
					{loading ? (
						<div className="space-y-4 mt-4">
							<Skeleton variant="card" count={3} />
						</div>
					) : configuring ? (
						<div className="mt-4">
							<AssessmentConfigureFlow
								subjectName={configuring.subject.name}
								topic={configuring.topic}
								onClose={() => setConfiguring(null)}
							/>
						</div>
					) : catalog !== null ? (
						catalog.length === 0 ? (
							<EmptyState
								icon={Clock}
								title="No assessments are available yet"
								description="No assessment topics have servable questions yet. Please check back later."
								className="mt-4"
							/>
						) : (
							<div className="space-y-6 mt-4">
								{catalog.map((subject) => (
									<div key={subject.id}>
										<h3 className="font-medium text-sm text-muted-foreground mb-3">
											{subject.name}
										</h3>
										{subject.topics.length === 0 ? (
											<p className="text-sm text-muted-foreground">
												No topics are available for this subject yet.
											</p>
										) : (
											<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
												{subject.topics.map((topic) => (
													<Card key={topic.id} className="relative">
														<CardContent className="p-4">
															<h4 className="font-medium text-sm">{topic.name}</h4>
															{topic.description && (
																<p className="text-xs text-muted-foreground mb-3 mt-1">
																	{topic.description}
																</p>
															)}
															{/* #1679 item 6 / spec T9: a null bestScore
															    renders NOTHING for the score — never a
															    fabricated "Best: /100". The real attempt
															    count still shows on its own. */}
															{topic.progress &&
																(topic.progress.bestScore != null ||
																	topic.progress.attempts > 0) && (
																	<p className="text-xs mb-2">
																		{topic.progress.bestScore != null && (
																			<>
																				Best:{' '}
																				<span className="font-medium">
																					{topic.progress.bestScore}/100
																				</span>
																			</>
																		)}
																		{/* #1656 (C3, §3.7): the last attempt's
																		    score, same honesty rule — null
																		    renders nothing. */}
																		{topic.progress.lastScore != null && (
																			<>
																				{' '}
																				Last:{' '}
																				<span className="font-medium">
																					{topic.progress.lastScore}/100
																				</span>
																			</>
																		)}
																		<span className="text-muted-foreground ml-1">
																			({topic.progress.attempts} attempt
																			{topic.progress.attempts !== 1 ? 's' : ''})
																		</span>
																	</p>
																)}
															{/* #1656: the server's canRetake is the /start
															    gate's own answer — when false, the lockout
															    is stated plainly instead of Start failing
															    later with no warning. */}
															{topic.progress && topic.progress.canRetake === false && (
																<p className="text-xs text-muted-foreground mb-2">
																	Retake available 30 days after your last completed
																	attempt.
																</p>
															)}
															{topic.resumable ? (
																<>
																	{/* #1824: Save & Exit promised resume
																	    from this page — a saved in-progress
																	    session gets the Resume door INSTEAD
																	    of Configure & Start (a new start
																	    would abandon the saved session). */}
																	<p className="text-xs text-muted-foreground mb-2">
																		Test in progress — resume where you left off.
																	</p>
																	<Button
																		size="sm"
																		className="w-full gap-1 min-h-[44px]"
																		onClick={() =>
																			topic.resumable &&
																			navigate(
																				`/candidate/assessments/${topic.resumable.sessionId}/take`,
																			)
																		}
																	>
																		<Play className="h-3 w-3" /> Resume
																	</Button>
																</>
															) : topic.availability.available ? (
																<>
																	<p className="text-xs text-muted-foreground mb-2">
																		Up to {topic.availability.maxCount} questions
																		available
																	</p>
																	<Button
																		size="sm"
																		className="w-full gap-1 min-h-[44px]"
																		onClick={() =>
																			setConfiguring({ subject, topic })
																		}
																	>
																		<Play className="h-3 w-3" /> Configure &amp; Start
																	</Button>
																</>
															) : (
																<p className="text-xs text-amber-700">
																	No questions available for this topic yet
																	{topic.availability.maxCount > 0
																		? ` — only ${topic.availability.maxCount} approved so far, not enough for a test yet.`
																		: '.'}
																</p>
															)}
														</CardContent>
													</Card>
												))}
											</div>
										)}
									</div>
								))}
							</div>
						)
					) : (
						<div className="space-y-6 mt-4">
							{Object.entries(categoryGroups).map(([cat, catSkills]) => (
								<div key={cat}>
									<h3 className="font-medium text-sm text-muted-foreground mb-3">
										{categoryLabels[cat] || cat}
									</h3>
									<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
										{catSkills.map((skill) => (
											<Card key={skill.catalog_name} className="relative">
												<CardContent className="p-4">
													<div className="flex items-start justify-between mb-2">
														<div className="flex items-center gap-2">
															<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary font-mono font-bold text-xs">
																{skill.icon}
															</div>
															<div>
																<h4 className="font-medium text-sm">{skill.catalog_name}</h4>
																{/* #1679 item 7: skill.difficulty is NOT
																    rendered — every /available builder in
																    routes/assessments.js hardcodes it to
																    "Adaptive", but a NEW legacy start now
																    snapshots mixed / medium / 10 (start
																    difficulty 3, clamped to levels 2–4), so
																    "Adaptive" is a false label for the test
																    this card starts. State the real default. */}
																<p className="text-xs text-muted-foreground">
																	Mixed · Medium (levels 2–4)
																</p>
															</div>
														</div>
														{skill.is_verified && (
															<Badge variant="success" className="text-[10px]">
																<Shield className="h-3 w-3 mr-0.5" /> Verified
															</Badge>
														)}
													</div>
													<p className="text-xs text-muted-foreground mb-3">{skill.description}</p>
													{skill.best_score !== null && (
														<p className="text-xs mb-2">
															Best: <span className="font-medium">{skill.best_score}/100</span>
															<span className="text-muted-foreground ml-1">
																({skill.assessment_count} attempt
																{skill.assessment_count !== 1 ? 's' : ''})
															</span>
														</p>
													)}
													<Button
														size="sm"
														variant={skill.is_verified ? 'outline' : 'default'}
														className="w-full gap-1 min-h-[44px]"
														onClick={() => startAssessment(skill)}
														disabled={starting === skill.catalog_name}
													>
														{starting === skill.catalog_name ? (
															<div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
														) : (
															<Play className="h-3 w-3" />
														)}
														{skill.is_verified
															? 'Retake'
															: skill.assessment_count > 0
																? 'Try Again'
																: 'Start Test'}
													</Button>
												</CardContent>
											</Card>
										))}
									</div>
								</div>
							))}
						</div>
					)}
				</TabsContent>

				<TabsContent value="results">
					{results.length === 0 ? (
						<EmptyState
							icon={Trophy}
							title="No assessment results yet"
							description="Take a skill test to see your results and verify your abilities."
							action={{ label: 'Take a Test', onClick: () => setTab('available') }}
							className="mt-4"
						/>
					) : (
						<div className="space-y-4 mt-4">
							{resultGroups.map((group) => (
								<div key={group.key} className="space-y-3">
									<h3 className="font-medium text-sm text-muted-foreground">{group.heading}</h3>
									{group.items.map((r) => {
								const rf =
									typeof r.behavioral_flags === 'string'
										? JSON.parse(r.behavioral_flags)
										: r.behavioral_flags || {};
								const rPartial = rf.partial === true;
								const configLabel = resultConfigLabel(r);
								return (
								<Card key={r.id}>
									<CardContent className="p-4">
										<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
											<div>
												<div className="flex items-center gap-2 mb-1">
													<h4 className="font-medium">{r.skill_name || r.title}</h4>
													{rPartial ? (
														<Badge variant="secondary" className="gap-1">
															Partial — answered {rf.answers_given} of {rf.total_questions}
														</Badge>
													) : r.passed ? (
														<Badge variant="success" className="gap-1">
															<CheckCircle className="h-3 w-3" /> Passed
														</Badge>
													) : (
														<Badge variant="destructive" className="gap-1">
															<AlertTriangle className="h-3 w-3" /> Failed
														</Badge>
													)}
												</div>
												<div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
													<span>
														{rPartial
															? rf.answers_given === 0
																? 'No score — no questions answered'
																: `${rf.correct_count ?? 0} of ${rf.answers_given} answered correct`
															: `Score: ${r.score}/${r.max_score || 100}`}
													</span>
													{configLabel && <span>{configLabel}</span>}
													<span className="flex items-center gap-1">
														<Clock className="h-3 w-3" />
														{Math.round((r.duration_seconds || 0) / 60)} min
													</span>
													<span>Max difficulty: {r.max_difficulty_reached}/5</span>
													<span>{new Date(r.completed_at).toLocaleDateString()}</span>
												</div>
											</div>
											<div className="text-right">
												{!rPartial && <div className="text-2xl font-bold">{r.score}%</div>}
												{r.anti_cheat_score != null && r.anti_cheat_score < 80 && (
													<span className="text-xs text-amber-600">
														Integrity: {r.anti_cheat_score}%
													</span>
												)}
											</div>
										</div>
									</CardContent>
								</Card>
								);
									})}
								</div>
							))}
						</div>
					)}
				</TabsContent>
			</Tabs>
		</div>
	);
}
