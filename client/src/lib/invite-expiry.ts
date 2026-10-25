/**
 * Shared invite-expiry formatting for candidate interview invitation cards.
 * Used by the Interviews page (AISessionCard) and the AI Screening page.
 */

export type ExpiryLabel = { text: string; urgent: boolean } | null;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns a human-friendly expiry label for an invite_expires_at value.
 * - null when there is no expiry (or it is invalid) → caller renders nothing.
 * - urgent=true when expired or expiring within 7 days → caller can highlight.
 */
export function expiryLabel(expiresAt: string | null | undefined): ExpiryLabel {
	if (!expiresAt) return null;
	const d = new Date(expiresAt);
	if (Number.isNaN(d.getTime())) return null;
	const dateStr = d.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
	const days = Math.ceil((d.getTime() - Date.now()) / DAY_MS);
	if (days < 0) return { text: `Expired ${dateStr}`, urgent: true };
	if (days === 0) return { text: 'Expires today', urgent: true };
	if (days === 1) return { text: `Expires tomorrow (${dateStr})`, urgent: true };
	if (days <= 7) return { text: `Expires in ${days} days (${dateStr})`, urgent: true };
	return { text: `Expires ${dateStr}`, urgent: false };
}
