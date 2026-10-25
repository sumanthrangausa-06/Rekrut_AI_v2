/**
 * S-039 (#686) — Interviewer Assessment column (human side of the
 * side-by-side report).
 *
 * State taxonomy (panel Q3): `present` / `not_submitted` / `missing`.
 * Linkage-unresolved renders `missing`, NEVER `not_submitted` — claiming
 * an interviewer has not submitted when we cannot even see the scorecard
 * would be fabrication. Nothing serves scorecards today (schema-only,
 * migration 125; panels link to `scheduled_interviews`, not the unified
 * `interview_sessions`), so the report page passes `missing` until the
 * future scorecard-serving story lands. This component renders ONLY the
 * data it is given — AI/Track B output must never be substituted into
 * this column (that substitution is an integrity defect, panel Q3).
 *
 * Submit-and-lock (binding constraint, recorded on #686/#697): when the
 * serving story lands, a scorer must not view a session's AI/Observer
 * section until their own scorecard for that session is submitted and
 * locked. Not implemented here — there is no scorecard data to lock yet.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type InterviewerAssessmentState = 'present' | 'not_submitted' | 'missing';

export interface InterviewerAssessmentData {
	state: InterviewerAssessmentState;
	scores?: { label: string; value: string }[];
	notes?: string;
	recommendation?: string;
}

/** Copy constants — the single client source for this column's states.
 *  Vetted by the S-039 copy audit (condition precedent to merge). */
export const ASSESSMENT_NOT_SUBMITTED_COPY =
	'The interviewer has not submitted their assessment yet.';
export const ASSESSMENT_MISSING_COPY = 'No interviewer assessment is available for this session.';

export function InterviewerAssessment({
	assessment,
}: {
	assessment: InterviewerAssessmentData | null | undefined;
}) {
	const state = assessment?.state ?? 'missing';

	return (
		<Card data-testid="interviewer-assessment-column" className="min-w-0">
			<CardHeader>
				<CardTitle className="text-base">Interviewer Assessment</CardTitle>
			</CardHeader>
			<CardContent>
				{state === 'present' && assessment ? (
					<div className="space-y-3">
						{assessment.scores && assessment.scores.length > 0 && (
							<dl className="space-y-1.5">
								{assessment.scores.map((s) => (
									<div key={s.label} className="flex items-baseline justify-between gap-3">
										<dt className="text-sm text-muted-foreground break-words min-w-0">{s.label}</dt>
										<dd className="text-sm font-medium break-words text-right tabular-nums">{s.value}</dd>
									</div>
								))}
							</dl>
						)}
						{assessment.recommendation && (
							<p className="text-sm">
								<span className="text-muted-foreground">Recommendation: </span>
								<span className="font-medium break-words">{assessment.recommendation}</span>
							</p>
						)}
						{assessment.notes && (
							<p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
								{assessment.notes}
							</p>
						)}
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						{state === 'not_submitted' ? ASSESSMENT_NOT_SUBMITTED_COPY : ASSESSMENT_MISSING_COPY}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
