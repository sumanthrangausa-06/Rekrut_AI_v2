import { AlertTriangle, ArrowLeft, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiCall } from '@/lib/api';

/**
 * #1654 (#1603 Phase C, story C2 — CLIENT): configuration + pre-flight +
 * instructions flow for candidate skill assessments.
 *
 * Flow order (STOP 1 ruling on #1654): configure → pre-flight →
 * instructions → start. The Phase B post-start instructions gate in
 * assessment-take.tsx still runs after start and is NOT replaced by this
 * screen — this screen states the chosen configuration and the headline
 * rules before the candidate commits; the take-page gate discloses every
 * enforced rule again before the first question.
 *
 * Honesty rules (design §4.1/§7, JT-C4): the count a candidate starts is
 * the count they explicitly chose. When the bank cannot promise it, the
 * server's reason is shown verbatim and the smaller servable count is
 * offered ONLY as a labelled choice ("Use N questions instead") — never
 * silently substituted. Zero supply renders an honest empty state with
 * no start action.
 */

export interface CatalogTopicAvailability {
	formats: Record<string, Record<string, number>>;
	maxCount: number;
	available: boolean;
}

export interface CatalogTopic {
	id: number;
	slug: string;
	name: string;
	description: string | null;
	availability: CatalogTopicAvailability;
	progress: { attempts: number; bestScore: number | null; lastScore: number | null; lastAttempted: string | null } | null;
}

export interface CatalogSubject {
	id: number;
	slug: string;
	name: string;
	category: string;
	icon: string;
	description: string | null;
	topics: CatalogTopic[];
}

interface PreFlight {
	promised: number | null;
	servable: number;
	largestAvailable: number;
	reason: string | null;
}

const FORMATS = [
	// Candidate labels per UX spec §0.2 — never the server's raw values.
	{ value: 'mixed', label: 'Mixed — multiple choice and written answers' },
	{ value: 'mcq', label: 'Multiple choice' },
	{ value: 'short_answer', label: 'Written answers' },
	{ value: 'coding', label: 'Coding' },
] as const;

const BANDS = [
	{ value: 'easy', label: 'Easy', range: 'levels 1–2' },
	{ value: 'medium', label: 'Medium', range: 'levels 2–4' },
	{ value: 'hard', label: 'Hard', range: 'levels 4–5' },
] as const;

const COUNTS = [10, 25, 50, 100];

type FormatValue = (typeof FORMATS)[number]['value'];
type BandValue = (typeof BANDS)[number]['value'];

interface StartErrorState {
	message: string;
	sessionId?: number;
	largestAvailable?: number;
	// GAP-2: the 400 SETS_NOT_AVAILABLE branch — no session was created
	// (the server rolls back), so no resume/offer affordance may render.
	setsUnavailable?: boolean;
}

export function AssessmentConfigureFlow({
	subjectName,
	topic,
	onClose,
}: {
	subjectName: string;
	topic: CatalogTopic;
	onClose: () => void;
}) {
	const navigate = useNavigate();
	const [step, setStep] = useState<'configure' | 'instructions'>('configure');
	const [format, setFormat] = useState<FormatValue>('mixed');
	const [band, setBand] = useState<BandValue>('medium');
	const [count, setCount] = useState<number>(10);
	const [flight, setFlight] = useState<PreFlight | null>(null);
	const [flightLoading, setFlightLoading] = useState(true);
	const [flightError, setFlightError] = useState<string | null>(null);
	// #1679 item 4: bumping this re-runs the pre-flight effect for the
	// CURRENT configuration — the Retry control for a failed check.
	const [flightRetry, setFlightRetry] = useState(0);
	const [starting, setStarting] = useState(false);
	const [startError, setStartError] = useState<StartErrorState | null>(null);

	// Pre-flight (§4.1): advisory read of exactly what /start will serve
	// for this configuration. Re-runs whenever the choice changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: flightRetry is a deliberate re-run trigger (item 4 Retry), not a value the effect reads
	useEffect(() => {
		let cancelled = false;
		setFlight(null);
		setFlightLoading(true);
		setFlightError(null);
		apiCall<PreFlight>(
			`/assessments/catalog/${topic.id}/availability?format=${format}&band=${band}&count=${count}`,
		)
			.then((data) => {
				if (!cancelled) setFlight(data);
			})
			.catch(() => {
				if (!cancelled) {
					setFlight(null);
					setFlightError('We could not check question availability just now. Please try again.');
				}
			})
			.finally(() => {
				if (!cancelled) setFlightLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [topic.id, format, band, count, flightRetry]);

	const servable = flight?.servable ?? 0;
	const canServeChosen = !flightLoading && !!flight && servable >= count && servable > 0;
	// #1679 NIT hardening (#1680 review): the short/empty branches are
	// additionally inert while a re-check is in flight — the invariant
	// holds locally even apart from `flight` being nulled at effect start.
	const isShort = !flightLoading && !!flight && servable > 0 && servable < count;
	const isEmpty = !flightLoading && !!flight && servable === 0;

	const formatLabel = FORMATS.find((f) => f.value === format)?.label || format;
	const bandMeta = BANDS.find((b) => b.value === band);

	async function startAssessment() {
		setStarting(true);
		setStartError(null);
		try {
			const data = await apiCall<{ sessionId: number; skillName: string; question: unknown }>(
				'/assessments/start',
				{
					method: 'POST',
					timeoutMs: 30000,
					body: { topicId: topic.id, format, difficultyBand: band, totalQuestions: count },
				},
			);
			sessionStorage.setItem(
				`assessment_${data.sessionId}`,
				JSON.stringify({
					question: data.question,
					skillName: data.skillName || subjectName,
					// GAP-3: the configuration snapshot hand-off — the take
					// page renders its snapshot instructions block (not the
					// Phase B gate) when this is present.
					config: { format, difficultyBand: band, totalQuestions: count, topicName: topic.name },
				}),
			);
			navigate(`/candidate/assessments/${data.sessionId}/take`);
		} catch (err) {
			const apiErr = err as Error & {
				code?: string;
				sessionId?: number;
				largestAvailable?: number;
			};
			// GAP-2: branch explicitly on the 400 code — sets were rejected
			// before any session existed, so there is nothing to resume and
			// nothing stranded; say exactly that instead of a generic error.
			if (apiErr.code === 'SETS_NOT_AVAILABLE') {
				setStartError({
					message:
						'Assessment sets are not available yet, so this test could not be started as a set. No attempt was created — pick a configuration without a set, or try again later.',
					setsUnavailable: true,
				});
				return;
			}
			setStartError({
				message: apiErr.message || 'Failed to start assessment. Please try again.',
				sessionId: apiErr.sessionId,
				largestAvailable: apiErr.largestAvailable,
			});
		} finally {
			setStarting(false);
		}
	}

	function acceptSmallerCount(n: number) {
		setStartError(null);
		setStep('configure');
		setCount(n);
	}

	if (step === 'instructions') {
		return (
			<Card>
				<CardContent className="p-6 space-y-4">
					<h2 className="font-heading text-xl font-bold">Before you start</h2>
					<ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
						<li>
							Your test: <strong>{subjectName} · {topic.name}</strong> — {formatLabel},{' '}
							<strong>{count} questions</strong>.
						</li>
						<li>
							Difficulty:{' '}
							<strong>
								{bandMeta?.label} — questions adapt within the {bandMeta?.label} band only (
								{bandMeta?.range})
							</strong>
							, based on your answers. They never move into another band.
						</li>
						<li>
							Each question has its own timer, shown on the question. When a question's
							time runs out, it is submitted with the answer you have chosen — or recorded
							as unanswered — and the test moves on.
						</li>
						<li>
							This test runs in full-screen, and you can leave at any time with the Exit
							button. You will see the full exit and full-screen rules again on the next
							screen, before your first question — nothing is enforced that is not
							disclosed there.
						</li>
						{/* #1679 item 3 / spec T19: the AI-scoring disclosure
						    applies ONLY when the chosen format includes written
						    answers — an MCQ-only test must not claim it. */}
						{(format === 'mixed' || format === 'short_answer') && (
							<li>Short answers are scored by AI and reviewed by a human.</li>
						)}
					</ul>

					{startError && (
						<div className="space-y-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
							<p className="flex items-start gap-2">
								<AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
								<span>{startError.message}</span>
							</p>
							<div className="flex flex-wrap gap-2">
								{/* #1679 item 9: setsUnavailable is CONSUMED here —
								    a SETS 400 created no session, so neither the
								    Resume nor the smaller-count affordance may
								    render for it, even if a future error shape
								    carried those fields. */}
								{startError.sessionId && !startError.setsUnavailable && (
									<Button
										variant="outline"
										className="min-h-[44px]"
										onClick={() =>
											navigate(`/candidate/assessments/${startError.sessionId}/take`)
										}
									>
										Resume attempt
									</Button>
								)}
								{!startError.setsUnavailable &&
									startError.largestAvailable != null &&
									startError.largestAvailable > 0 &&
									startError.largestAvailable !== count && (
										<Button
											variant="outline"
											className="min-h-[44px]"
											onClick={() => acceptSmallerCount(startError.largestAvailable as number)}
										>
											Use {startError.largestAvailable} questions instead
										</Button>
									)}
							</div>
						</div>
					)}

					<div className="flex flex-col gap-2">
						<Button className="min-h-[44px] gap-1" onClick={startAssessment} disabled={starting}>
							{starting ? (
								<div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
							) : (
								<Play className="h-3 w-3" />
							)}
							Start Test
						</Button>
						<Button
							variant="ghost"
							className="min-h-[44px]"
							onClick={() => setStep('configure')}
							disabled={starting}
						>
							<ArrowLeft className="h-3 w-3 mr-1" /> Back to configuration
						</Button>
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardContent className="p-6 space-y-5">
				<div>
					<h2 className="font-heading text-lg font-bold">
						Configure your test — {subjectName} · {topic.name}
					</h2>
					{topic.description && (
						<p className="text-sm text-muted-foreground mt-1">{topic.description}</p>
					)}
				</div>

				<div className="space-y-2">
					<p className="text-sm font-medium">Question format</p>
					<div className="flex flex-wrap gap-2">
						{FORMATS.map((f) => (
							<Button
								key={f.value}
								variant={format === f.value ? 'default' : 'outline'}
								className="min-h-[44px]"
								onClick={() => setFormat(f.value)}
							>
								{f.label}
							</Button>
						))}
					</div>
				</div>

				<div className="space-y-2">
					<p className="text-sm font-medium">Difficulty</p>
					<div className="flex flex-wrap gap-2">
						{BANDS.map((b) => (
							<Button
								key={b.value}
								variant={band === b.value ? 'default' : 'outline'}
								className="min-h-[44px]"
								onClick={() => setBand(b.value)}
							>
								{b.label}
							</Button>
						))}
					</div>
				</div>

				<div className="space-y-2">
					<p className="text-sm font-medium">Number of questions</p>
					<div className="flex flex-wrap gap-2">
						{COUNTS.map((c) => (
							<Button
								key={c}
								variant={count === c ? 'default' : 'outline'}
								className="min-h-[44px]"
								onClick={() => setCount(c)}
							>
								{c}
							</Button>
						))}
						{!COUNTS.includes(count as (typeof COUNTS)[number]) && (
							// #1679 item 5: an accepted non-enum count is a
							// display of the current selection, not a control —
							// inert text, never a <Button> with no onClick.
							<span className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
								{count}
							</span>
						)}
					</div>
				</div>

				<div className="rounded-lg border p-3 text-sm space-y-2" aria-live="polite">
					{flightLoading ? (
						<p className="text-muted-foreground">Checking availability…</p>
					) : flightError ? (
						<>
							<p className="text-amber-700">{flightError}</p>
							{/* #1679 item 4: a load FAILURE (distinct from a
							    servable-0 answer, spec T15) gets a working
							    Retry for the current configuration. */}
							<Button
								variant="outline"
								className="min-h-[44px]"
								onClick={() => setFlightRetry((n) => n + 1)}
							>
								Retry
							</Button>
						</>
					) : isEmpty ? (
						<p className="text-amber-700">
							{flight?.reason ||
								'No approved questions are available for this topic, format and difficulty yet.'}
						</p>
					) : isShort ? (
						<>
							<p className="text-amber-700">{flight?.reason}</p>
							<Button
								variant="outline"
								className="min-h-[44px]"
								onClick={() => acceptSmallerCount(flight?.largestAvailable ?? servable)}
							>
								Use {flight?.largestAvailable ?? servable} questions instead
							</Button>
						</>
					) : canServeChosen ? (
						<p>
							We can serve exactly {count} questions for this configuration.
						</p>
					) : null}
				</div>

				<div className="flex flex-col gap-2 sm:flex-row">
					{canServeChosen && (
						<Button className="min-h-[44px]" onClick={() => setStep('instructions')}>
							Continue to instructions
						</Button>
					)}
					<Button variant="ghost" className="min-h-[44px]" onClick={onClose}>
						<ArrowLeft className="h-3 w-3 mr-1" /> Back to topics
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
