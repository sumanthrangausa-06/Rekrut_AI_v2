import { useState } from 'react';
import { Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiCall } from '@/lib/api';

interface JoinInterviewButtonProps {
	/** Human-interview id (scheduled_interviews or interview_events). */
	interviewId: number | string;
	size?: 'sm' | 'default' | 'lg';
	buttonClassName?: string;
	label?: string;
	iconClassName?: string;
}

/**
 * Join button that resolves the meeting link through
 * GET /api/interviews/:id/join first, so expired links (24h after the
 * scheduled end) show "This interview link has expired." instead of
 * opening a dead room.
 *
 * Opens the room in a new tab. The tab is opened synchronously inside the
 * click handler (then navigated after the API call) so iOS/mobile popup
 * blockers don't swallow it; falls back to same-tab navigation if the
 * popup was blocked.
 */
export function JoinInterviewButton({
	interviewId,
	size = 'sm',
	buttonClassName = 'w-full min-h-[44px]',
	label = 'Join Call',
	iconClassName = 'h-3.5 w-3.5 mr-1',
}: JoinInterviewButtonProps) {
	const [joining, setJoining] = useState(false);
	const [expired, setExpired] = useState(false);
	const [error, setError] = useState('');

	const handleJoin = async () => {
		if (joining || expired) return;
		setJoining(true);
		setError('');
		// Open synchronously so mobile popup blockers allow it.
		const newTab = window.open('', '_blank');
		try {
			const data = await apiCall<{ success: boolean; meeting_link: string }>(
				`/interviews/${interviewId}/join`,
			);
			if (newTab) {
				newTab.location.href = data.meeting_link;
			} else {
				window.location.href = data.meeting_link;
			}
		} catch (err) {
			if (newTab) newTab.close();
			const code = (err as Error & { code?: string }).code;
			if (code === 'LINK_EXPIRED') {
				setExpired(true);
			} else {
				setError(
					err instanceof Error ? err.message : 'Could not join the interview. Please try again.',
				);
			}
		} finally {
			setJoining(false);
		}
	};

	if (expired) {
		return <p className="text-sm font-medium text-amber-600">This interview link has expired.</p>;
	}

	return (
		<span className="inline-block">
			<Button size={size} className={buttonClassName} onClick={handleJoin} disabled={joining}>
				<Video className={iconClassName} />
				{joining ? 'Joining…' : label}
			</Button>
			{error && <p className="mt-1 text-xs text-destructive">{error}</p>}
		</span>
	);
}
