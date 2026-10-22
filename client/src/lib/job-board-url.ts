// #1634: pure helpers for the Job Board's URL filter protocol (#1600),
// extracted from header.tsx / jobs.tsx so the state machine's transitions
// are unit-testable at behaviour level (the #1634 addendum flagged the
// #1600 tests for pinning vocabulary instead of behaviour).

export interface HeaderFilterDraftLike {
	search: string;
	location: string;
	type: string;
	remote_type: string;
	experience_level: string;
	salary_min: string;
	salary_max: string;
}

const FILTER_DRAFT_KEYS = [
	'search',
	'location',
	'type',
	'remote_type',
	'experience_level',
	'salary_min',
	'salary_max',
] as const;

/**
 * Build the params a header Filters Apply navigates with.
 * Preserves the board's open-job param (`job`) only. `skill` is
 * deliberately NOT preserved (#1634 Finding 6): jobs.tsx's skill effect
 * re-runs when the adopted header keyword changes `filters.search`, and
 * a preserved stale `?skill=` reset the search back to the skill value,
 * silently clobbering the header-applied keyword.
 */
export function buildHeaderApplyParams(
	draft: HeaderFilterDraftLike,
	current: URLSearchParams | null,
): URLSearchParams {
	const params = new URLSearchParams();
	const hasAnyFilter = FILTER_DRAFT_KEYS.some((k) => draft[k]);
	// Marker: marks this URL as header-applied filter intent (#1600 B1).
	if (hasAnyFilter) params.set('filters', 'hdr1');
	for (const k of FILTER_DRAFT_KEYS) {
		if (draft[k]) params.set(k, draft[k]);
	}
	if (current) {
		const job = current.get('job');
		if (job) params.set('job', job);
	}
	return params;
}

/**
 * Adoption signature for a complete header filter state.
 * JSON.stringify, never a `|`-join (#1634 delta Finding 5): values
 * containing `|` collided across field splits under join('|') and
 * skipped a legitimate adoption.
 */
export function urlFilterSignature(values: HeaderFilterDraftLike): string {
	return JSON.stringify(FILTER_DRAFT_KEYS.map((k) => values[k]));
}

/**
 * Tracks which header filter signature has been adopted, so a signal
 * cannot re-fire while it is still in the URL — and, once the signal
 * has been consumed/stripped, the SAME values can be adopted again
 * (#1634 delta Finding 2: after a strip, re-entering identical values
 * following in-page divergence hit the stale guard and never re-synced).
 */
export function createUrlFilterAdoptionTracker() {
	let adopted: string | null = null;
	return {
		shouldAdopt(sig: string): boolean {
			return sig !== adopted;
		},
		record(sig: string): void {
			adopted = sig;
		},
		consume(): void {
			adopted = null;
		},
	};
}

export type UrlFilterAdoptionTracker = ReturnType<typeof createUrlFilterAdoptionTracker>;
