import { AlertCircle, Calendar, CheckCircle, Clock, Loader2, MapPin, Video } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { trackEvent } from '@/lib/analytics';
import { apiCall } from '@/lib/api';

interface ProposedSlot {
	id: number;
	interview_event_id: number;
	slot_start: string;
	slot_end: string;
	timezone: string;
	status: string;
	slot_start_local: string;
	slot_end_local: string;
}

interface InterviewDetail {
	id: number;
	job_application_id: number;
	recruiter_id: number;
	candidate_id: number;
	panel_member_ids: number[];
	scheduled_at: string | null;
	duration_minutes: number;
	timezone: string;
	status: string;
	calendar_event_ids: Record<string, string> | null;
	livekit_room_url: string | null;
	meeting_link: string | null;
	notes: string | null;
	created_at: string;
	updated_at: string;
	candidate_name: string;
	candidate_email: string;
	recruiter_name: string;
	recruiter_email: string;
	job_title: string;
	proposed_slots: ProposedSlot[];
	scheduled_at_local: string | null;
}

function formatDateTime(iso: string, timezone?: string) {
	const d = new Date(iso);
	return d.toLocaleDateString('en-US', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: timezone || undefined,
	});
}

function formatTimeRange(startIso: string, endIso: string, timezone?: string) {
	const start = new Date(startIso);
	const end = new Date(endIso);
	const dateStr = start.toLocaleDateString('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
	});
	const startTime = start.toLocaleTimeString('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: timezone || undefined,
	});
	const endTime = end.toLocaleTimeString('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: timezone || undefined,
	});
	return `${dateStr} · ${startTime} – ${endTime}`;
}

export function BookInterviewPage() {
	const { interviewId } = useParams<{ interviewId: string }>();
	const navigate = useNavigate();
	const [interview, setInterview] = useState<InterviewDetail | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
	const [confirming, setConfirming] = useState(false);
	const [confirmed, setConfirmed] = useState(false);

	const loadInterview = useCallback(async () => {
		if (!interviewId) return;
		setLoading(true);
		setError('');
		try {
			const res = await apiCall<{ success: boolean; interview: InterviewDetail }>(
				`/interviews/${interviewId}`,
			);
			setInterview(res.interview);
			trackEvent('candidate_book_interview_view', { interviewId: Number(interviewId) });
		} catch (err: any) {
			setError(err.message || 'Failed to load interview details');
		} finally {
			setLoading(false);
		}
	}, [interviewId]);

	useEffect(() => {
		loadInterview();
	}, [loadInterview]);

	async function handleConfirm() {
		if (!interview || !selectedSlotId) return;
		setConfirming(true);
		try {
			const res = await apiCall<{
				success: boolean;
				message: string;
				interview: InterviewDetail;
			}>(`/interviews/${interview.id}/book`, {
				method: 'POST',
				body: { slot_id: selectedSlotId },
			});
			setInterview(res.interview);
			setConfirmed(true);
			trackEvent('candidate_book_interview_confirmed', {
				interviewId: interview.id,
				slotId: selectedSlotId,
			});
		} catch (err: any) {
			setError(err.message || 'Failed to confirm interview');
		} finally {
			setConfirming(false);
		}
	}

	if (loading) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center px-4">
				<div className="flex flex-col items-center gap-3">
					<Loader2 className="h-8 w-8 animate-spin text-primary" />
					<p className="text-sm text-muted-foreground">Loading interview details...</p>
				</div>
			</div>
		);
	}

	if (error && !interview) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center px-4">
				<Card className="w-full max-w-md">
					<CardContent className="p-6 text-center">
						<AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
						<h2 className="text-lg font-semibold mb-1">Something went wrong</h2>
						<p className="text-sm text-muted-foreground mb-4">{error}</p>
						<Button onClick={loadInterview} className="min-h-[44px]">
							Try Again
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (!interview) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center px-4">
				<Card className="w-full max-w-md">
					<CardContent className="p-6 text-center">
						<AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
						<h2 className="text-lg font-semibold mb-1">Interview not found</h2>
						<p className="text-sm text-muted-foreground mb-4">
							This interview may have been cancelled or removed.
						</p>
						<Button onClick={() => navigate('/candidate/interviews')} className="min-h-[44px]">
							Back to Interviews
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	const offeredSlots = interview.proposed_slots?.filter((s) => s.status === 'offered') || [];

	// Already confirmed or not proposed
	if (interview.status !== 'proposed' || confirmed) {
		return (
			<div className="max-w-xl mx-auto px-4 py-8 space-y-6">
				<Card className="border-emerald-200 bg-emerald-50/50">
					<CardContent className="p-6 text-center">
						<div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
							<CheckCircle className="h-8 w-8 text-emerald-600" />
						</div>
						<h2 className="text-xl font-bold mb-1">Interview Confirmed!</h2>
						<p className="text-sm text-muted-foreground mb-4">
							Your interview for <strong>{interview.job_title}</strong> has been scheduled.
						</p>

						{interview.scheduled_at && (
							<div className="bg-white rounded-lg border p-4 mb-4 text-left">
								<div className="flex items-center gap-2 mb-2">
									<Calendar className="h-4 w-4 text-primary" />
									<span className="font-medium">Date & Time</span>
								</div>
								<p className="text-sm text-muted-foreground">
									{formatDateTime(interview.scheduled_at, interview.timezone)}
								</p>
								<p className="text-xs text-muted-foreground mt-1">
									Duration: {interview.duration_minutes} minutes
								</p>
							</div>
						)}

						<div className="flex flex-col gap-3">
							{interview.livekit_room_url && (
								<a href={interview.livekit_room_url} target="_blank" rel="noopener noreferrer">
									<Button className="w-full min-h-[44px]">
										<Video className="h-4 w-4 mr-2" />
										Join Interview Room
									</Button>
								</a>
							)}
							{interview.meeting_link && !interview.livekit_room_url && (
								<a href={interview.meeting_link} target="_blank" rel="noopener noreferrer">
									<Button className="w-full min-h-[44px]">
										<MapPin className="h-4 w-4 mr-2" />
										Join Meeting
									</Button>
								</a>
							)}
							<Button
								variant="outline"
								onClick={() => navigate('/candidate/interviews')}
								className="w-full min-h-[44px]"
							>
								Back to My Interviews
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
			{/* Header */}
			<div className="text-center space-y-2">
				<h1 className="text-2xl font-heading font-bold">Select an Interview Time</h1>
				<p className="text-muted-foreground text-sm">
					{interview.recruiter_name} has proposed the following time slots for your{' '}
					<strong>{interview.job_title}</strong> interview.
				</p>
			</div>

			{/* Error */}
			{error && (
				<div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
					<AlertCircle className="h-4 w-4 shrink-0" />
					{error}
				</div>
			)}

			{/* Interview info card */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-base">
						<Calendar className="h-5 w-5 text-primary" />
						Interview Details
					</CardTitle>
					<CardDescription>
						{interview.duration_minutes} minutes · Timezone: {interview.timezone}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2">
					<div className="flex items-center gap-2 text-sm">
						<Badge variant="secondary">{interview.status}</Badge>
						<span className="text-muted-foreground">
							with {interview.recruiter_name || 'Recruiter'}
						</span>
					</div>
					{interview.notes && (
						<p className="text-sm text-muted-foreground bg-muted p-2 rounded">{interview.notes}</p>
					)}
				</CardContent>
			</Card>

			{/* Slot selection */}
			<div className="space-y-3">
				<h2 className="text-lg font-semibold flex items-center gap-2">
					<Clock className="h-5 w-5 text-primary" />
					Proposed Time Slots
					<Badge variant="secondary" className="text-xs">
						{offeredSlots.length} available
					</Badge>
				</h2>

				{offeredSlots.length === 0 ? (
					<Card className="bg-muted/50 border-dashed">
						<CardContent className="p-6 text-center">
							<AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
							<p className="text-sm text-muted-foreground">
								No available time slots. Please contact your recruiter.
							</p>
						</CardContent>
					</Card>
				) : (
					<div className="grid grid-cols-1 gap-3">
						{offeredSlots.map((slot) => {
							const isSelected = selectedSlotId === slot.id;
							return (
								<button type="button"
									key={slot.id}
									onClick={() => setSelectedSlotId(slot.id)}
									className={`text-left p-4 rounded-xl border-2 transition-all ${
										isSelected
											? 'border-primary bg-primary/5'
											: 'border-border hover:border-primary/50 hover:bg-muted/50'
									}`}
								>
									<div className="flex items-center justify-between">
										<div>
											<p className="font-medium">
												{formatTimeRange(slot.slot_start, slot.slot_end, slot.timezone)}
											</p>
											<p className="text-xs text-muted-foreground mt-1">
												Timezone: {slot.timezone}
											</p>
										</div>
										{isSelected && (
											<div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center shrink-0">
												<CheckCircle className="h-4 w-4 text-primary-foreground" />
											</div>
										)}
									</div>
								</button>
							);
						})}
					</div>
				)}
			</div>

			{/* Confirm button */}
			{offeredSlots.length > 0 && (
				<div className="pt-2">
					<Button
						onClick={handleConfirm}
						disabled={!selectedSlotId || confirming}
						className="w-full min-h-[48px] text-base"
					>
						{confirming ? (
							<span className="flex items-center gap-2">
								<Loader2 className="h-5 w-5 animate-spin" />
								Confirming...
							</span>
						) : selectedSlotId ? (
							'Confirm This Time Slot'
						) : (
							'Select a time slot above'
						)}
					</Button>
					<p className="text-xs text-center text-muted-foreground mt-2">
						Once confirmed, the interview will be added to your calendar if connected.
					</p>
				</div>
			)}
		</div>
	);
}
