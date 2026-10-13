/**
 * S-039 (#686) — AI Observer Analysis column, built strictly against the
 * S-082 spike §4 projection contract (as amended by the S-039 panel):
 *
 * - Branch ONLY on per-section `state` (present | missing | declined).
 *   No other field is read before `state` is checked.
 * - Metric fields are optional and are NEVER defaulted: an absent metric
 *   renders "Insufficient data", never a coerced 0 (a rendered
 *   "0 gaze-away events" is a fabricated measurement).
 * - An unknown `integrity_summary.version` renders as `missing` rather
 *   than guessing the shape. Version 1 rows are never migrated.
 * - Integrity events are listed individually, in observational language,
 *   from the `events[]` array — the array wins over the stored counts.
 *   No aggregate integrity score is computed or rendered, ever.
 * - `conversation.transcript_available` absent/false ⇒ NO transcript
 *   affordance.
 * - Audience split (panel ruling): candidate-side non-consent states are
 *   never named on this surface. If every biometric section resolved
 *   `declined`, the column renders the ONE canonical neutral sentence —
 *   supplied by the server via `neutralCopy` (lib/observerReportStates.js
 *   is the single source; this component forks no copy of its own). In
 *   the S-039 report page the collapse is enforced one level up — the
 *   column is not mounted at all in neutral cases and the metadata strip
 *   carries the sentence — so this branch is the component's defensive
 *   contract for direct consumers, exercised by its component tests.
 *
 * Data sources: section states arrive server-resolved from the gated
 * observer/status channel (S-087). The §4.3 report payload (`report`)
 * has no read path until S-049b's GET lands (Decision D1) — the page
 * passes null today; the `present` branches are fixture-tested against
 * the §4.3 shapes and begin receiving data with no structural change.
 */
import { MessageSquare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface ObserverSectionData {
	state?: string;
	[key: string]: unknown;
}

export interface ObserverIntegrityEvent {
	event_type: string;
	severity?: string;
	count?: number;
	confidence?: number;
	review_status?: string;
}

export interface ObserverReportPayload {
	analysis?: {
		vocal?: ObserverSectionData;
		visual?: ObserverSectionData;
		conversation?: { state?: string; transcript_available?: boolean };
	};
	integrity_summary?: {
		version?: number;
		state?: string;
		events?: ObserverIntegrityEvent[];
		[key: string]: unknown;
	};
}

export interface ObserverSectionState {
	state: string;
	label?: string;
	explanation?: string;
}

/** The only integrity projection version this renderer understands (§4.4). */
const KNOWN_INTEGRITY_VERSION = 1;

/** §4.1: a `missing` section renders "Insufficient data / N/A". */
export const INSUFFICIENT_DATA_COPY = 'Insufficient data';
export const NO_INTEGRITY_EVENTS_COPY = 'No integrity events recorded.';
export const TRANSCRIPT_AVAILABLE_COPY = 'Observer transcript available';

const SECTION_TITLES: Record<string, string> = {
	vocal: 'Vocal',
	visual: 'Visual',
	conversation: 'Conversation',
	integrity: 'Integrity',
};

function humanize(key: string): string {
	const words = key.replace(/_/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Scalar observational metrics of a present section, exactly as stored —
 *  absent keys are skipped, never defaulted. */
function sectionMetrics(section: ObserverSectionData): { label: string; value: string }[] {
	return Object.entries(section)
		.filter(([k, v]) => k !== 'state' && (typeof v === 'number' || typeof v === 'string'))
		.map(([k, v]) => ({ label: humanize(k), value: String(v) }));
}

function SectionShell({
	sectionKey,
	children,
}: {
	sectionKey: string;
	children: React.ReactNode;
}) {
	return (
		<div data-testid={`observer-section-${sectionKey}`} className="min-w-0">
			<h4 className="text-sm font-medium mb-1">{SECTION_TITLES[sectionKey] ?? humanize(sectionKey)}</h4>
			{children}
		</div>
	);
}

function InsufficientData() {
	return <p className="text-sm text-muted-foreground">{INSUFFICIENT_DATA_COPY}</p>;
}

export function ObserverAnalysis({
	sectionStates,
	report,
	neutralCopy,
}: {
	sectionStates?: Record<string, ObserverSectionState> | null;
	report?: ObserverReportPayload | null;
	neutralCopy?: string;
}) {
	const biometricKeys = ['vocal', 'visual', 'integrity'] as const;

	const stateOf = (key: string): string => {
		// Consent vetoes payload (privacy S-2): a server-resolved declined
		// state wins over anything a (stale) payload carries — consent
		// resolves before presence at render time too.
		if (sectionStates?.[key]?.state === 'declined') {
			return 'declined';
		}
		if (key === 'integrity' && report?.integrity_summary) {
			const summary = report.integrity_summary;
			// §4.4: an unknown version renders as missing — never guess.
			if (summary.version != null && summary.version !== KNOWN_INTEGRITY_VERSION) {
				return 'missing';
			}
			return summary.state ?? sectionStates?.integrity?.state ?? 'missing';
		}
		return report?.analysis?.[key as 'vocal' | 'visual']?.state ?? sectionStates?.[key]?.state ?? 'missing';
	};

	const states = Object.fromEntries(biometricKeys.map((k) => [k, stateOf(k)]));
	const anyPresent = biometricKeys.some((k) => states[k] === 'present');
	const allDeclined = biometricKeys.every((k) => states[k] === 'declined');

	// Audience split: a fully non-consented report collapses to the one
	// canonical neutral sentence — the reason is never named here.
	if (!anyPresent && allDeclined && neutralCopy) {
		return (
			<Card data-testid="observer-analysis-column" className="min-w-0">
				<CardHeader>
					<CardTitle className="text-base">AI Observer Analysis</CardTitle>
				</CardHeader>
				<CardContent>
					<p role="status" className="text-sm text-muted-foreground">
						{neutralCopy}
					</p>
				</CardContent>
			</Card>
		);
	}

	const conversation = report?.analysis?.conversation;
	const integrityEvents: ObserverIntegrityEvent[] =
		states.integrity === 'present' && Array.isArray(report?.integrity_summary?.events)
			? report.integrity_summary.events
			: [];

	return (
		<Card data-testid="observer-analysis-column" className="min-w-0">
			<CardHeader>
				<CardTitle className="text-base">AI Observer Analysis</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					{biometricKeys.map((key) => (
						<SectionShell key={key} sectionKey={key}>
							{states[key] === 'present' ? (
								key === 'integrity' ? (
									integrityEvents.length > 0 ? (
										<ul className="space-y-1">
											{integrityEvents.map((event, i) => (
												// biome-ignore lint/suspicious/noArrayIndexKey: events are positional projections with no stable IDs
												<li key={`${event.event_type}-${i}`} className="text-sm break-words">
													{humanize(event.event_type)}
													{event.severity ? (
														<span className="text-muted-foreground"> · {event.severity}</span>
													) : null}
													{typeof event.count === 'number' ? (
														<span className="text-muted-foreground">
															{' '}
															· recorded {event.count} time{event.count === 1 ? '' : 's'}
														</span>
													) : null}
												</li>
											))}
										</ul>
									) : (
										<p className="text-sm text-muted-foreground">{NO_INTEGRITY_EVENTS_COPY}</p>
									)
								) : (
									(() => {
										const section = report?.analysis?.[key as 'vocal' | 'visual'];
										const metrics = section ? sectionMetrics(section) : [];
										return metrics.length > 0 ? (
											<dl className="space-y-1.5">
												{metrics.map((m) => (
													<div key={m.label} className="flex items-baseline justify-between gap-3">
														<dt className="text-sm text-muted-foreground break-words min-w-0">
															{m.label}
														</dt>
														<dd className="text-sm font-medium break-words text-right tabular-nums">{m.value}</dd>
													</div>
												))}
											</dl>
										) : (
											<InsufficientData />
										);
									})()
								)
							) : (
								<InsufficientData />
							)}
						</SectionShell>
					))}

					{conversation && (
						<SectionShell sectionKey="conversation">
							{conversation.state === 'present' ? (
								conversation.transcript_available === true ? (
									<p
										data-testid="observer-transcript-affordance"
										className="text-sm flex items-center gap-1.5"
									>
										<MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> {TRANSCRIPT_AVAILABLE_COPY}
									</p>
								) : (
									<InsufficientData />
								)
							) : (
								<InsufficientData />
							)}
						</SectionShell>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
