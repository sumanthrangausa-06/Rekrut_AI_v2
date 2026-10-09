import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Format a month-year date string (e.g. "Jan 2020").
 * Returns null when the input is missing/invalid.
 */
export function formatMonthYear(dateStr?: string | null): string | null {
	if (!dateStr) return null;
	const d = new Date(dateStr);
	if (Number.isNaN(d.getTime())) return null;
	return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Format an experience/education date range.
 * - is_current → "Jan 2020 — Present"
 * - end_date   → "Jan 2020 — Dec 2022"
 * - neither   → "Jan 2020" (no hardcoded "End" placeholder)
 * - no start  → "— Present" / "— Dec 2022" / "—"
 */
export function formatDateRange(
	start_date?: string | null,
	end_date?: string | null,
	is_current?: boolean,
): string {
	const start = formatMonthYear(start_date) ?? '';
	const end = is_current ? 'Present' : (formatMonthYear(end_date) ?? '');
	if (start && end) return `${start} — ${end}`;
	if (start) return start;
	if (end) return `— ${end}`;
	return '—';
}
