import {
	AlertCircle,
	ArrowLeft,
	ArrowRight,
	Brain,
	CheckCircle,
	CheckCircle2,
	Clock,
	Loader2,
	Save,
	Shield,
	Sparkles,
	XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { apiCall } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────────

interface Question {
	id: number;
	question_text: string;
	question_type: 'single_choice' | 'multiple_choice' | 'short_text' | 'yes_no' | 'numeric';
	options: string[] | null;
	is_knockout: boolean;
	order_index: number;
	required: boolean;
}

interface Questionnaire {
	id: number;
	job_id: number;
	pass_threshold: number;
	questions: Question[];
}

interface QuestionnaireResponse {
	success: boolean;
	questionnaire: Questionnaire;
	ai_disclosure: string;
	existing_response: {
		id: number;
		status: string;
		answers: Record<string, string | string[] | number>;
	} | null;
}

interface StartResponse {
	success: boolean;
	response_id: number;
	message: string;
}

interface SaveResponse {
	success: boolean;
	message: string;
	answers: Record<string, string | string[] | number>;
}

interface SubmitResponse {
	success: boolean;
	message: string;
	status: 'evaluated' | 'rejected' | 'completed';
	overall_score?: number;
	ai_explanation?: string;
	knockout_triggered?: boolean;
	knockout_reason?: string;
}

interface ResultResponse {
	success: boolean;
	response: {
		id: number;
		status: string;
		overall_score: number | null;
		ai_explanation: string | null;
		knockout_triggered: boolean;
		knockout_reason: string | null;
		answers: Record<string, string | string[] | number>;
	};
	evaluations: Array<{
		question_id: number;
		question_text: string;
		question_type: string;
		score: number;
		explanation: string;
	}>;
}

// ─── Component ───────────────────────────────────────────────────────────

export function ScreeningQuestionnairePage() {
	const { jobId } = useParams<{ jobId: string }>();
	const navigate = useNavigate();

	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
	const [responseId, setResponseId] = useState<number | null>(null);
	const [answers, setAnswers] = useState<Record<string, string | string[] | number>>({});
	const [currentIndex, setCurrentIndex] = useState(0);
	const [saving, setSaving] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const [submitResult, setSubmitResult] = useState<SubmitResponse | null>(null);
	const [resultDetail, setResultDetail] = useState<ResultResponse | null>(null);
	const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
	const [started, setStarted] = useState(false);

	const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const questions = questionnaire?.questions || [];
	const currentQuestion = questions[currentIndex];

	// ─── Load questionnaire ──────────────────────────────────────────────

	const loadQuestionnaire = useCallback(async () => {
		if (!jobId) return;
		setLoading(true);
		setError('');
		try {
			const data = await apiCall<QuestionnaireResponse>(`/api/questionnaire/candidate/${jobId}`);
			setQuestionnaire(data.questionnaire);

			// If there's an existing response with answers, restore them
			if (data.existing_response?.answers) {
				setAnswers(data.existing_response.answers);
				setResponseId(data.existing_response.id);
				if (data.existing_response.status === 'in_progress') {
					setStarted(true);
				} else if (
					data.existing_response.status === 'evaluated' ||
					data.existing_response.status === 'rejected' ||
					data.existing_response.status === 'completed'
				) {
					setSubmitted(true);
					await loadResults(data.existing_response.id);
					return;
				}
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Failed to load questionnaire';
			setError(msg);
		} finally {
			setLoading(false);
		}
	}, [jobId]);

	const loadResults = useCallback(async (rid: number) => {
		try {
			const data = await apiCall<ResultResponse>(`/api/questionnaire/result/${rid}`);
			setResultDetail(data);
		} catch {
			// ignore
		}
	}, []);

	useEffect(() => {
		loadQuestionnaire();
	}, [loadQuestionnaire]);

	// ─── Auto-save every 30s ─────────────────────────────────────────────

	useEffect(() => {
		if (!started || !responseId || submitted) return;

		autoSaveRef.current = setInterval(() => {
			handleAutoSave();
		}, 30000);

		return () => {
			if (autoSaveRef.current) clearInterval(autoSaveRef.current);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [started, responseId, submitted, answers]);

	const handleAutoSave = async () => {
		if (!responseId || submitted) return;
		const currentAnswers = getCurrentAnswersForSave();
		if (Object.keys(currentAnswers).length === 0) return;
		setSaving(true);
		try {
			await apiCall<SaveResponse>('/api/questionnaire/save', {
				method: 'POST',
				body: { response_id: responseId, answers: currentAnswers },
			});
			setLastSavedAt(new Date());
		} catch {
			// silent fail on auto-save
		} finally {
			setSaving(false);
		}
	};

	// Get answers that have been touched for the current question + any already saved
	const getCurrentAnswersForSave = (): Record<string, string | string[] | number> => {
		const toSave: Record<string, string | string[] | number> = {};
		for (const q of questions) {
			if (answers[q.id] !== undefined && answers[q.id] !== '' && answers[q.id] !== null) {
				toSave[q.id] = answers[q.id];
			}
		}
		return toSave;
	};

	// ─── Start session ───────────────────────────────────────────────────

	async function handleStart() {
		if (!jobId) return;
		setLoading(true);
		try {
			const data = await apiCall<StartResponse>('/api/questionnaire/start', {
				method: 'POST',
				body: { job_id: jobId },
			});
			setResponseId(data.response_id);
			setStarted(true);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Failed to start screening';
			setError(msg);
		} finally {
			setLoading(false);
		}
	}

	// ─── Answer helpers ──────────────────────────────────────────────────

	function setAnswer(qid: number, value: string | string[] | number) {
		setAnswers((prev) => ({ ...prev, [qid]: value }));
	}

	function toggleMultipleChoice(qid: number, option: string) {
		setAnswers((prev) => {
			const current = (prev[qid] as string[]) || [];
			if (current.includes(option)) {
				return { ...prev, [qid]: current.filter((o) => o !== option) };
			}
			return { ...prev, [qid]: [...current, option] };
		});
	}

	function isAnswered(q: Question): boolean {
		const val = answers[q.id];
		if (val === undefined || val === null || val === '') return false;
		if (Array.isArray(val) && val.length === 0) return false;
		return true;
	}

	const answeredCount = questions.filter(isAnswered).length;
	const allAnswered = answeredCount === questions.length;

	// ─── Navigation ──────────────────────────────────────────────────────

	function goNext() {
		if (currentIndex < questions.length - 1) {
			setCurrentIndex((prev) => prev + 1);
		}
	}

	function goPrev() {
		if (currentIndex > 0) {
			setCurrentIndex((prev) => prev - 1);
		}
	}

	function goToQuestion(index: number) {
		if (index >= 0 && index < questions.length) {
			setCurrentIndex(index);
		}
	}

	// ─── Submit ──────────────────────────────────────────────────────────

	async function handleSubmit() {
		if (!responseId) return;
		setSubmitting(true);
		try {
			const toSave = getCurrentAnswersForSave();
			const data = await apiCall<SubmitResponse>('/api/questionnaire/submit', {
				method: 'POST',
				body: { response_id: responseId, answers: toSave },
			});
			setSubmitResult(data);
			setSubmitted(true);
			await loadResults(responseId);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Failed to submit';
			setError(msg);
		} finally {
			setSubmitting(false);
		}
	}

	// ─── Render question input ───────────────────────────────────────────

	function renderQuestionInput(q: Question) {
		const val = answers[q.id];

		switch (q.question_type) {
			case 'single_choice':
				return (
					<div className="space-y-2.5">
						{(q.options || []).map((opt) => (
							<label
								key={opt}
								className={`flex items-center gap-3 rounded-lg border p-3.5 cursor-pointer transition-all min-h-[44px] ${
									val === opt
										? 'border-primary bg-primary/5 ring-1 ring-primary'
										: 'hover:bg-muted/50'
								}`}
							>
								<input
									type="radio"
									name={`q-${q.id}`}
									value={opt}
									checked={val === opt}
									onChange={() => setAnswer(q.id, opt)}
									className="h-4 w-4 text-primary"
								/>
								<span className="text-sm">{opt}</span>
							</label>
						))}
					</div>
				);

			case 'multiple_choice':
				return (
					<div className="space-y-2.5">
						{(q.options || []).map((opt) => {
							const selected = Array.isArray(val) && val.includes(opt);
							return (
								<label
									key={opt}
									className={`flex items-center gap-3 rounded-lg border p-3.5 cursor-pointer transition-all min-h-[44px] ${
										selected
											? 'border-primary bg-primary/5 ring-1 ring-primary'
											: 'hover:bg-muted/50'
									}`}
								>
									<Checkbox
										checked={selected}
										onCheckedChange={() => toggleMultipleChoice(q.id, opt)}
									/>
									<span className="text-sm">{opt}</span>
								</label>
							);
						})}
					</div>
				);

			case 'yes_no':
				return (
					<div className="flex gap-3">
						{['Yes', 'No'].map((opt) => (
							<Button
								key={opt}
								type="button"
								variant={val === opt ? 'default' : 'outline'}
								className="flex-1 min-h-[44px]"
								onClick={() => setAnswer(q.id, opt)}
							>
								{opt}
							</Button>
						))}
					</div>
				);

			case 'numeric':
				return (
					<Input
						type="number"
						value={val !== undefined ? String(val) : ''}
						onChange={(e) => {
							const num = e.target.value === '' ? '' : Number(e.target.value);
							setAnswer(q.id, num);
						}}
						placeholder="Enter a number..."
						className="min-h-[44px]"
					/>
				);

			case 'short_text':
				return (
					<Textarea
						value={val !== undefined ? String(val) : ''}
						onChange={(e) => setAnswer(q.id, e.target.value)}
						placeholder="Type your answer here..."
						rows={5}
						className="min-h-[44px] resize-y"
					/>
				);

			default:
				return (
					<Input
						value={val !== undefined ? String(val) : ''}
						onChange={(e) => setAnswer(q.id, e.target.value)}
						placeholder="Your answer..."
						className="min-h-[44px]"
					/>
				);
		}
	}

	// ─── Loading state ───────────────────────────────────────────────────

	if (loading && !started) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[80vh] gap-4 px-4">
				<div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
				<div className="font-heading text-xl font-semibold text-center">
					Loading Screening Questionnaire
				</div>
				<p className="text-muted-foreground text-sm text-center">
					Preparing your personalized screening questions...
				</p>
			</div>
		);
	}

	// ─── Error state ─────────────────────────────────────────────────────

	if (error && !questionnaire) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[80vh] gap-4 px-4">
				<AlertCircle className="h-12 w-12 text-destructive" />
				<h2 className="text-xl font-semibold">Unable to Load Screening</h2>
				<p className="text-muted-foreground text-sm text-center max-w-md">{error}</p>
				<Button
					variant="outline"
					className="mt-4 min-h-[44px]"
					onClick={() => navigate('/candidate/jobs')}
				>
					<ArrowLeft className="h-4 w-4 mr-1" /> Back to Jobs
				</Button>
			</div>
		);
	}

	// ─── Not started yet ─────────────────────────────────────────────────

	if (!started && questionnaire) {
		return (
			<div className="max-w-lg mx-auto py-8 px-4 sm:px-6 space-y-6">
				<Card>
					<CardContent className="p-6 sm:p-8 text-center space-y-5">
						<div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
							<Brain className="h-8 w-8 text-primary" />
						</div>
						<div>
							<h2 className="text-2xl font-bold">Screening Questionnaire</h2>
							<p className="text-muted-foreground mt-1">
								{questions.length} question{questions.length !== 1 ? 's' : ''} · AI-evaluated
							</p>
						</div>

						{/* AI Disclosure */}
						<div className="rounded-lg bg-blue-50 border border-blue-100 p-4 text-left space-y-2">
							<div className="flex items-start gap-2">
								<Sparkles className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
								<p className="text-sm text-blue-800">
									Your answers will be evaluated by AI. This helps us review applications faster.
									You can pause and resume at any time.
								</p>
							</div>
						</div>

						<div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-left space-y-2">
							<p className="text-sm font-medium text-amber-800">Before you start:</p>
							<ul className="text-sm text-amber-700 space-y-1 ml-4 list-disc">
								<li>Answer each question carefully — quality matters</li>
								<li>Your progress auto-saves every 30 seconds</li>
								<li>You can navigate between questions freely</li>
								<li>Some questions may be knockout questions</li>
							</ul>
						</div>

						<Button onClick={handleStart} className="w-full min-h-[44px] gap-2" size="lg">
							Start Screening
							<ArrowRight className="h-4 w-4" />
						</Button>

						<div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
							<Shield className="h-3 w-3" />
							Powered by Rekrut AI
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	// ─── Submitted / Results ─────────────────────────────────────────────

	if (submitted && submitResult) {
		const isPassed = submitResult.status === 'evaluated' || submitResult.status === 'completed';
		const score = submitResult.overall_score ?? resultDetail?.response?.overall_score ?? 0;

		return (
			<div className="max-w-lg mx-auto py-8 px-4 sm:px-6 space-y-6">
				<Card>
					<CardContent className="p-6 sm:p-8 text-center space-y-5">
						{isPassed ? (
							<CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500 mb-2" />
						) : (
							<XCircle className="mx-auto h-16 w-16 text-destructive mb-2" />
						)}

						<h2 className="text-2xl font-bold">
							{isPassed ? 'Screening Passed!' : 'Screening Complete'}
						</h2>

						<p className="text-muted-foreground">
							{isPassed
								? 'Great job! Your application will be reviewed by the hiring team.'
								: submitResult.knockout_triggered
									? 'A knockout question was triggered.'
									: 'Your score was below the passing threshold.'}
						</p>

						{score > 0 && (
							<div className="text-5xl font-bold py-2">
								<span className={isPassed ? 'text-emerald-600' : 'text-destructive'}>{score}</span>
								<span className="text-muted-foreground text-lg">/100</span>
							</div>
						)}

						<Badge variant={isPassed ? 'success' : 'destructive'} className="text-sm px-3 py-1">
							{isPassed ? 'PASSED' : 'NOT PASSED'}
							{questionnaire?.pass_threshold ? ` (threshold: ${questionnaire.pass_threshold})` : ''}
						</Badge>

						{/* AI Explanation */}
						{(submitResult.ai_explanation || resultDetail?.response?.ai_explanation) && (
							<div className="rounded-lg bg-blue-50 border border-blue-100 p-4 text-left">
								<p className="text-sm font-medium text-blue-900 mb-1 flex items-center gap-1.5">
									<Brain className="h-4 w-4" /> AI Evaluation
								</p>
								<p className="text-sm text-blue-800">
									{submitResult.ai_explanation || resultDetail?.response?.ai_explanation}
								</p>
							</div>
						)}

						{/* Knockout reason */}
						{(submitResult.knockout_reason || resultDetail?.response?.knockout_reason) && (
							<div className="rounded-lg bg-red-50 border border-red-100 p-4 text-left">
								<p className="text-sm font-medium text-red-900 mb-1 flex items-center gap-1.5">
									<AlertCircle className="h-4 w-4" /> Knockout Triggered
								</p>
								<p className="text-sm text-red-800">
									{submitResult.knockout_reason || resultDetail?.response?.knockout_reason}
								</p>
							</div>
						)}

						{/* Per-question evaluations */}
						{resultDetail && resultDetail.evaluations.length > 0 && (
							<div className="text-left space-y-3 pt-2">
								<p className="text-sm font-medium">Question Evaluations</p>
								{resultDetail.evaluations.map((ev) => (
									<div key={ev.question_id} className="rounded-lg bg-muted/50 p-3 space-y-1">
										<div className="flex items-center justify-between">
											<span className="text-sm font-medium">{ev.question_text}</span>
											<Badge
												variant={
													ev.score >= 70 ? 'success' : ev.score >= 50 ? 'secondary' : 'destructive'
												}
												className="text-xs"
											>
												{ev.score}/100
											</Badge>
										</div>
										<p className="text-xs text-muted-foreground">{ev.explanation}</p>
									</div>
								))}
							</div>
						)}

						<Button onClick={() => navigate('/candidate/applications')} className="min-h-[44px]">
							View My Applications
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	// ─── Active questionnaire ────────────────────────────────────────────

	if (!questionnaire || questions.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[80vh] gap-4 px-4">
				<p className="text-muted-foreground">No questions available</p>
				<Button
					variant="outline"
					className="min-h-[44px]"
					onClick={() => navigate('/candidate/jobs')}
				>
					Back to Jobs
				</Button>
			</div>
		);
	}

	const progressPercent =
		((currentIndex + (isAnswered(currentQuestion) ? 1 : 0)) / questions.length) * 100;

	return (
		<div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">
			{/* Header */}
			<div className="flex items-center justify-between">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => navigate('/candidate/jobs')}
					className="gap-1 min-h-[44px]"
				>
					<ArrowLeft className="h-4 w-4" /> Exit
				</Button>
				<div className="flex items-center gap-2">
					{saving && (
						<Badge variant="outline" className="text-xs gap-1">
							<Save className="h-3 w-3" /> Saving...
						</Badge>
					)}
					{lastSavedAt && !saving && (
						<Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
							<Clock className="h-3 w-3" /> Auto-saved
						</Badge>
					)}
					<Badge variant="secondary" className="text-xs">
						{answeredCount}/{questions.length} answered
					</Badge>
				</div>
			</div>

			{/* Progress bar */}
			<div>
				<Progress value={progressPercent} className="h-2" />
				<p className="text-xs text-muted-foreground mt-1 text-center">
					Question {currentIndex + 1} of {questions.length}
				</p>
			</div>

			{/* Question pills */}
			<div className="flex gap-1.5 flex-wrap">
				{questions.map((q, i) => (
					<button
						key={q.id}
						onClick={() => goToQuestion(i)}
						className={`w-8 h-8 rounded-full text-xs font-medium transition-all min-h-[32px] ${
							i === currentIndex
								? 'bg-primary text-white shadow-md'
								: isAnswered(q)
									? 'bg-green-100 text-green-700 border border-green-300'
									: 'bg-muted text-muted-foreground border border-border hover:border-primary/50'
						}`}
					>
						{i + 1}
					</button>
				))}
			</div>

			{/* Current question card */}
			{currentQuestion && (
				<Card>
					<CardHeader className="pb-3">
						<div className="flex items-start justify-between gap-3">
							<CardTitle className="text-base leading-relaxed">
								{currentQuestion.question_text}
								{currentQuestion.required && <span className="text-destructive ml-1">*</span>}
							</CardTitle>
							{currentQuestion.is_knockout && (
								<Badge variant="destructive" className="shrink-0 text-xs">
									Knockout
								</Badge>
							)}
						</div>
						{currentQuestion.is_knockout && (
							<p className="text-xs text-destructive mt-1">
								⚠️ This is a knockout question. Answering incorrectly may result in automatic
								rejection.
							</p>
						)}
					</CardHeader>
					<CardContent className="space-y-4">
						{renderQuestionInput(currentQuestion)}

						{/* Navigation */}
						<div className="flex items-center justify-between pt-2">
							<Button
								variant="outline"
								onClick={goPrev}
								disabled={currentIndex === 0}
								className="gap-1 min-h-[44px]"
							>
								<ArrowLeft className="h-4 w-4" /> Previous
							</Button>

							{currentIndex < questions.length - 1 ? (
								<Button onClick={goNext} className="gap-1 min-h-[44px]">
									Next <ArrowRight className="h-4 w-4" />
								</Button>
							) : (
								<Button
									onClick={handleSubmit}
									disabled={submitting || !allAnswered}
									className="gap-1 min-h-[44px] bg-emerald-600 hover:bg-emerald-700"
								>
									{submitting ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<CheckCircle className="h-4 w-4" />
									)}
									{submitting ? 'Submitting...' : 'Submit Screening'}
								</Button>
							)}
						</div>
					</CardContent>
				</Card>
			)}

			{/* All answered banner */}
			{allAnswered && (
				<Card className="border-emerald-200 bg-emerald-50/50">
					<CardContent className="p-4 flex items-center gap-3">
						<CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
						<p className="text-sm text-emerald-800">
							All questions answered! Review your answers and submit when ready.
						</p>
					</CardContent>
				</Card>
			)}

			{/* Tips */}
			<div className="rounded-lg bg-muted/40 p-4 space-y-2">
				<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tips</p>
				<ul className="text-xs text-muted-foreground space-y-1">
					<li>• Be honest and specific in your answers</li>
					<li>• For text questions, 2-4 sentences is usually enough</li>
					<li>• Your progress saves automatically every 30 seconds</li>
				</ul>
			</div>
		</div>
	);
}

export default ScreeningQuestionnairePage;
