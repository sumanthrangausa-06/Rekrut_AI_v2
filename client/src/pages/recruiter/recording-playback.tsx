import {
	AlertCircle,
	CheckCircle,
	FileAudio,
	Highlighter,
	Loader2,
	Pause,
	Play,
	Search,
	Volume2,
	VolumeX,
	XCircle,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EmptyState } from '@/components/domain/empty-state';
import { Skeleton } from '@/components/domain/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import { apiCall } from '@/lib/api';

interface RecordingDetail {
	id: number;
	status: string;
	started_at: string;
	stopped_at: string | null;
	duration_seconds: number | null;
	file_size_bytes: number | null;
	file_format: string | null;
	created_at: string;
	transcript: {
		segment_count: number;
		last_transcript_at: string | null;
	};
	consent: Array<{
		user_id: number;
		name: string;
		email: string;
		consented_at: string;
		consent_type: string;
	}>;
	recruiter_notes?: {
		highlight_count: number;
	};
}

interface TranscriptSegment {
	id: number;
	speaker_identity: string;
	text: string;
	start_time_ms: number;
	end_time_ms: number;
	confidence: number | null;
	created_at: string;
	// S-D09 (#1911, §5.1): additive diarization fields — absent on
	// legacy (pre-feature) payloads, which render exactly as before.
	speaker_number?: number | null;
	diarization_covered?: boolean;
	highlights?: Array<{
		id: number;
		note: string;
		created_by: string;
		created_at: string;
	}>;
}

// S-D09 (#1911, §5.1): the top-level diarization block. Carries no
// share / count / confidence / percentage figure by design (FR-D13).
interface DiarizationBlock {
	status: 'complete' | 'processing' | 'pending' | 'unavailable' | null;
	mapping_state: 'proposed' | 'confirmed' | 'corrected' | null;
	corrected_by: string | null;
	corrected_at: string | null;
	speakers: Array<{
		speaker_number: number;
		label: string;
		assigned: boolean;
	}>;
}

// S-D10 (#1912, §5.2): the mapping-editor payload from
// GET /:id/speakers — correctors only; the page renders the read-only
// speaker list whenever this cannot be loaded.
interface SpeakerEditorData {
	speakers: Array<{
		speaker_number: number;
		participant_user_id: number | null;
		participant_role: 'candidate' | 'interviewer' | null;
		participant_name: string | null;
		state: 'proposed' | 'confirmed' | 'corrected';
		sample_turn: { text: string; start_time_ms: number } | null;
	}>;
	participants: Array<{
		user_id: number;
		role: 'candidate' | 'interviewer';
		name: string | null;
	}>;
	mapping_state: 'proposed' | 'confirmed' | 'corrected' | null;
	corrected_by: string | null;
	corrected_at: string | null;
}

interface PlaybackData {
	url: string;
	token: string;
	expires_in: number;
}

type ToastType = 'success' | 'error' | 'info';

interface Toast {
	id: string;
	message: string;
	type: ToastType;
}

function ToastContainer({
	toasts,
	onDismiss,
}: {
	toasts: Toast[];
	onDismiss: (id: string) => void;
}) {
	return (
		<div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full px-4 sm:px-0">
			{toasts.map((toast) => (
				<div
					key={toast.id}
					className={`flex items-start gap-3 rounded-lg border p-3 shadow-lg animate-in slide-in-from-right fade-in duration-200 ${
						toast.type === 'success'
							? 'bg-emerald-50 border-emerald-200 text-emerald-800'
							: toast.type === 'error'
								? 'bg-red-50 border-red-200 text-red-800'
								: 'bg-blue-50 border-blue-200 text-blue-800'
					}`}
				>
					{toast.type === 'success' ? (
						<CheckCircle className="h-5 w-5 shrink-0 mt-0.5 text-emerald-600" />
					) : toast.type === 'error' ? (
						<XCircle className="h-5 w-5 shrink-0 mt-0.5 text-red-600" />
					) : (
						<AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-blue-600" />
					)}
					<p className="text-sm flex-1">{toast.message}</p>
					<button type="button"
						onClick={() => onDismiss(toast.id)}
						className="shrink-0 text-muted-foreground hover:text-foreground min-h-[28px] min-w-[28px] flex items-center justify-center rounded"
					>
						<span className="sr-only">Dismiss</span>
						<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				</div>
			))}
		</div>
	);
}

function formatTimestamp(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const mins = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;
	return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatDuration(seconds: number | null): string {
	if (!seconds) return '—';
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	if (mins < 60) return `${mins}m ${secs}s`;
	const hrs = Math.floor(mins / 60);
	const remMins = mins % 60;
	return `${hrs}h ${remMins}m`;
}

// Color palette for speaker attribution
const speakerColors = [
	{
		bg: 'bg-indigo-100',
		text: 'text-indigo-800',
		border: 'border-indigo-200',
		dot: 'bg-indigo-500',
	},
	{
		bg: 'bg-emerald-100',
		text: 'text-emerald-800',
		border: 'border-emerald-200',
		dot: 'bg-emerald-500',
	},
	{ bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200', dot: 'bg-amber-500' },
	{ bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-200', dot: 'bg-rose-500' },
	{ bg: 'bg-cyan-100', text: 'text-cyan-800', border: 'border-cyan-200', dot: 'bg-cyan-500' },
	{
		bg: 'bg-violet-100',
		text: 'text-violet-800',
		border: 'border-violet-200',
		dot: 'bg-violet-500',
	},
];

function getSpeakerColor(index: number) {
	return speakerColors[index % speakerColors.length];
}

export function RecordingPlaybackPage() {
	const { id } = useParams<{ id: string }>();
	const recordingId = parseInt(id || '0', 10);
	const { user } = useAuth();
	const videoRef = useRef<HTMLVideoElement>(null);
	const transcriptRef = useRef<HTMLDivElement>(null);

	const [recording, setRecording] = useState<RecordingDetail | null>(null);
	const [playback, setPlayback] = useState<PlaybackData | null>(null);
	const [segments, setSegments] = useState<TranscriptSegment[]>([]);
	const [diarization, setDiarization] = useState<DiarizationBlock | null>(null);
	const [loading, setLoading] = useState(true);
	const [toasts, setToasts] = useState<Toast[]>([]);
	const [searchQuery, setSearchQuery] = useState('');
	const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [isMuted, setIsMuted] = useState(false);
	const [currentTimeMs, setCurrentTimeMs] = useState(0);

	// Highlight state
	const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null);
	const [highlightNote, setHighlightNote] = useState('');
	const [addingHighlight, setAddingHighlight] = useState(false);

	// Speaker color map
	const [speakerColorMap, setSpeakerColorMap] = useState<Record<string, number>>({});

	// S-D10 (#1912): mapping-editor state — selections keyed by
	// speaker_number, '' = leave unassigned.
	const [speakerEditor, setSpeakerEditor] = useState<SpeakerEditorData | null>(null);
	const [editorSelections, setEditorSelections] = useState<Record<number, string>>({});
	const [savingSpeakers, setSavingSpeakers] = useState(false);

	const showToast = useCallback((message: string, type: ToastType = 'info') => {
		const toastId = `${Date.now()}-${Math.random()}`;
		setToasts((prev) => [...prev, { id: toastId, message, type }]);
		setTimeout(() => {
			setToasts((prev) => prev.filter((t) => t.id !== toastId));
		}, 5000);
	}, []);

	const dismissToast = useCallback((toastId: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== toastId));
	}, []);

	const loadData = useCallback(async () => {
		if (!recordingId) return;
		setLoading(true);
		try {
			// Load recording details
			const detailRes = await apiCall<{ success: boolean; recording: RecordingDetail }>(
				`/interviews/recordings/${recordingId}`,
			);
			setRecording(detailRes.recording);

			// Load playback URL
			const playbackRes = await apiCall<{ success: boolean; playback: PlaybackData }>(
				`/interviews/recordings/${recordingId}/playback`,
			);
			setPlayback(playbackRes.playback);

			// Load transcript
			const transcriptRes = await apiCall<{
				success: boolean;
				transcript: { segments: TranscriptSegment[]; diarization?: DiarizationBlock | null };
			}>(`/interviews/recordings/${recordingId}/transcript`);
			const loadedSegments = transcriptRes.transcript?.segments || [];
			setSegments(loadedSegments);
			setDiarization(transcriptRes.transcript?.diarization ?? null);

			// Build speaker color map
			const speakers = [...new Set(loadedSegments.map((s) => s.speaker_identity))];
			const colorMap: Record<string, number> = {};
			speakers.forEach((speaker, idx) => {
				colorMap[speaker] = idx;
			});
			setSpeakerColorMap(colorMap);
		} catch (err: any) {
			showToast(err.message || 'Failed to load recording', 'error');
		} finally {
			setLoading(false);
		}
	}, [recordingId, showToast]);

	useEffect(() => {
		loadData();
	}, [loadData]);

	// S-D10 (#1912, §5.2): load the mapping editor for correctors once
	// labelling is complete. The endpoint is corrector-only (403 for
	// everyone else); any failure leaves the read-only speaker list.
	const loadSpeakerEditor = useCallback(async () => {
		if (!recordingId) return;
		try {
			const res = await apiCall<{ success: boolean } & SpeakerEditorData>(
				`/interviews/recordings/${recordingId}/speakers`,
			);
			if (!Array.isArray(res?.speakers) || !Array.isArray(res?.participants)) return;
			setSpeakerEditor(res);
			setEditorSelections(
				Object.fromEntries(
					res.speakers.map((s) => [
						s.speaker_number,
						s.participant_user_id != null ? String(s.participant_user_id) : '',
					]),
				),
			);
		} catch {
			setSpeakerEditor(null);
		}
	}, [recordingId]);

	const editorEligible =
		user?.role === 'recruiter' ||
		user?.role === 'hiring_manager' ||
		user?.role === 'employer' ||
		user?.role === 'admin';

	useEffect(() => {
		if (editorEligible && diarization?.status === 'complete') {
			loadSpeakerEditor();
		}
	}, [editorEligible, diarization?.status, loadSpeakerEditor]);

	const handleSaveSpeakers = useCallback(async () => {
		if (!speakerEditor) return;
		setSavingSpeakers(true);
		try {
			await apiCall(`/interviews/recordings/${recordingId}/speakers/mapping`, {
				method: 'PUT',
				body: {
					assignments: speakerEditor.speakers.map((s) => {
						const selected = editorSelections[s.speaker_number] ?? '';
						return {
							speaker_number: s.speaker_number,
							participant_user_id: selected === '' ? null : parseInt(selected, 10),
						};
					}),
				},
			});
			showToast('Speaker names saved', 'success');
			await loadSpeakerEditor();
			await loadData();
		} catch (err: any) {
			showToast(err.message || 'Failed to save speaker names', 'error');
		} finally {
			setSavingSpeakers(false);
		}
	}, [speakerEditor, editorSelections, recordingId, loadSpeakerEditor, loadData, showToast]);

	// Video time update
	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;

		const handleTimeUpdate = () => {
			const ms = Math.floor(video.currentTime * 1000);
			setCurrentTimeMs(ms);

			// Find active segment
			const active = segments.find((s) => ms >= s.start_time_ms && ms <= s.end_time_ms);
			if (active && active.id !== activeSegmentId) {
				setActiveSegmentId(active.id);
			}
		};

		video.addEventListener('timeupdate', handleTimeUpdate);
		return () => video.removeEventListener('timeupdate', handleTimeUpdate);
	}, [segments, activeSegmentId]);

	const handlePlayPause = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		if (video.paused) {
			video.play();
			setIsPlaying(true);
		} else {
			video.pause();
			setIsPlaying(false);
		}
	}, []);

	const handleMuteToggle = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		video.muted = !video.muted;
		setIsMuted(video.muted);
	}, []);

	const jumpToSegment = useCallback((segment: TranscriptSegment) => {
		const video = videoRef.current;
		if (!video) return;
		video.currentTime = segment.start_time_ms / 1000;
		video.play();
		setIsPlaying(true);
		setActiveSegmentId(segment.id);

		// Scroll segment into view
		const el = document.getElementById(`segment-${segment.id}`);
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}, []);

	const handleAddHighlight = useCallback(async () => {
		if (!selectedSegmentId || !highlightNote.trim()) return;
		setAddingHighlight(true);
		try {
			await apiCall(`/interviews/recordings/transcript/${selectedSegmentId}/highlight`, {
				method: 'POST',
				body: {
					note: highlightNote.trim(),
					timestamp_ms: currentTimeMs,
				},
			});
			showToast('Highlight added', 'success');
			setHighlightNote('');
			setSelectedSegmentId(null);
			await loadData();
		} catch (err: any) {
			showToast(err.message || 'Failed to add highlight', 'error');
		} finally {
			setAddingHighlight(false);
		}
	}, [selectedSegmentId, highlightNote, currentTimeMs, showToast, loadData]);

	const filteredSegments = segments.filter((s) => {
		if (!searchQuery) return true;
		const q = searchQuery.toLowerCase();
		return s.text.toLowerCase().includes(q) || s.speaker_identity.toLowerCase().includes(q);
	});

	const isRecruiter =
		user?.role === 'recruiter' ||
		user?.role === 'hiring_manager' ||
		user?.role === 'employer' ||
		user?.role === 'admin';

	if (loading) {
		return (
			<div className="space-y-4 px-4 sm:px-6">
				<div className="h-64 sm:h-96 rounded-xl bg-muted animate-pulse" />
				<div className="space-y-3">
					<Skeleton variant="list" />
					<Skeleton variant="list" />
					<Skeleton variant="list" />
				</div>
			</div>
		);
	}

	if (!recording || !playback) {
		return (
			<div className="px-4 sm:px-6">
				<EmptyState
					icon={FileAudio}
					title="Recording Not Found"
					description="The recording you are looking for does not exist or is not available for playback."
					action={{
						label: 'Back to Recordings',
						// S-D11 (#1913, privacy condition): non-recruiters never
						// get a recruiter-surface link — candidates go back to
						// their own interviews list.
						href: isRecruiter ? '/recruiter/recordings' : '/candidate/interviews',
					}}
				/>
			</div>
		);
	}

	return (
		<div className="space-y-4 px-4 sm:px-6">
			<ToastContainer toasts={toasts} onDismiss={dismissToast} />

			{/* Header */}
			<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-heading font-bold">Recording Playback</h1>
					<p className="text-muted-foreground text-sm">
						Started {new Date(recording.started_at).toLocaleString()} •{' '}
						{formatDuration(recording.duration_seconds)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Badge variant={recording.status === 'completed' ? 'success' : 'warning'}>
						{recording.status === 'completed' ? (
							<CheckCircle className="h-3 w-3 mr-1" />
						) : (
							<Loader2 className="h-3 w-3 mr-1 animate-spin" />
						)}
						{recording.status}
					</Badge>
					{recording.transcript.segment_count > 0 && (
						<Badge variant="secondary">
							<FileAudio className="h-3 w-3 mr-1" />
							{recording.transcript.segment_count} segments
						</Badge>
					)}
				</div>
			</div>

			{/* Main content: video + transcript */}
			<div className="flex flex-col lg:flex-row gap-4">
				{/* Video player */}
				<div className="flex-1 min-w-0">
					<Card className="overflow-hidden">
						<div className="relative bg-black aspect-video">
							<video
								ref={videoRef}
								src={playback.url}
								className="w-full h-full"
								controls={false}
								onPlay={() => setIsPlaying(true)}
								onPause={() => setIsPlaying(false)}
								onEnded={() => setIsPlaying(false)}
							/>
							{/* Custom controls overlay */}
							<div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex items-center gap-3">
								<Button
									variant="ghost"
									size="icon"
									onClick={handlePlayPause}
									className="text-white hover:bg-white/20 h-10 w-10"
								>
									{isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
								</Button>
								<Button
									variant="ghost"
									size="icon"
									onClick={handleMuteToggle}
									className="text-white hover:bg-white/20 h-10 w-10"
								>
									{isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
								</Button>
								<div className="flex-1">
									<div className="h-1 bg-white/30 rounded-full overflow-hidden">
										<div
											className="h-full bg-indigo-500 transition-all"
											style={{
												width: `${videoRef.current ? (videoRef.current.currentTime / (videoRef.current.duration || 1)) * 100 : 0}%`,
											}}
										/>
									</div>
								</div>
								<span className="text-white text-xs font-mono">
									{formatTimestamp(currentTimeMs)}
								</span>
							</div>
						</div>
					</Card>

					{/* Consent info */}
					{recording.consent.length > 0 && (
						<Card className="mt-4">
							<CardContent className="p-4">
								<h3 className="text-sm font-semibold mb-2">Recording Consent</h3>
								<div className="flex flex-wrap gap-2">
									{recording.consent.map((c) => (
										<Badge key={c.user_id} variant="success" className="text-xs">
											<CheckCircle className="h-3 w-3 mr-1" />
											{/* S-D11 (#1913, privacy condition): the candidate
											    view shows names only — a participant's email
											    is never the fallback (PRD §7: no data beyond
											    the names shown in the call). */}
											{isRecruiter ? c.name || c.email : c.name || 'Participant'}
										</Badge>
									))}
								</div>
							</CardContent>
						</Card>
					)}
				</div>

				{/* Transcript sidebar */}
				<div className="w-full lg:w-96 xl:w-[28rem] shrink-0">
					<Card className="h-full flex flex-col">
						<CardContent className="p-4 flex flex-col h-full">
							{/* Search */}
							<div className="relative mb-3">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									placeholder="Search transcript..."
									className="pl-9 min-h-[44px]"
								/>
							</div>

							{/* Segment count */}
							<div className="text-xs text-muted-foreground mb-2">
								{filteredSegments.length} of {segments.length} segments
							</div>

							{/* S-D09 (#1911, §3.8/FR-D13): standing estimate note +
							    labelling state banners — above the scrollable list,
							    visible without scrolling, whenever the API sent a
							    diarization block. Legacy payloads render neither. */}
							{diarization && (
								<div className="mb-3 space-y-2">
									<div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
										<p>Speaker names are detected automatically and can be wrong.</p>
										{diarization.corrected_by && diarization.corrected_at && (
											<p className="mt-1">
												{`Speaker names corrected by ${diarization.corrected_by} on ${new Date(
													diarization.corrected_at,
												).toLocaleDateString()}`}
											</p>
										)}
										{isRecruiter && diarization.status === 'complete' && (
											<a
												href="#speaker-names"
												className="mt-1 inline-block font-medium underline underline-offset-2"
											>
												Correct speaker names
											</a>
										)}
										{/* S-D11 (#1913, PRD §7/FR-D13): where the recruiter
										    sees the correction control, the candidate sees
										    the raise-it route — plain static text, no link,
										    no form, nothing carrying the recording id. */}
										{!isRecruiter && diarization.status === 'complete' && (
											<p className="mt-1">
												If a speaker name looks wrong, raise it with the hiring team.
											</p>
										)}
									</div>
									{(diarization.status === 'processing' || diarization.status === 'pending') && (
										<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
											Speaker labels are being prepared
										</div>
									)}
									{diarization.status === 'unavailable' && (
										<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
											Speaker labels unavailable for this recording
										</div>
									)}
								</div>
							)}

							{/* Segments list */}
							<div
								ref={transcriptRef}
								className="flex-1 overflow-y-auto space-y-2 min-h-[300px] max-h-[60vh] lg:max-h-none"
							>
								{filteredSegments.length === 0 ? (
									<div className="text-center py-8 text-muted-foreground text-sm">
										{searchQuery
											? 'No segments match your search.'
											: 'No transcript available yet.'}
									</div>
								) : (
									filteredSegments.map((segment, idx) => {
										const speakerIdx = speakerColorMap[segment.speaker_identity] ?? 0;
										const colors = getSpeakerColor(speakerIdx);
										const isActive = activeSegmentId === segment.id;
										// S-D09 (#1911, FR-D15/Rex ruling 2): coverage is a
										// per-segment fact. Uncovered post-feature segments
										// render NO speaker heading; every covered↔uncovered
										// transition renders its own boundary marker.
										// Legacy segments (field absent) render as before.
										const uncovered = segment.diarization_covered === false;
										const prev = idx > 0 ? filteredSegments[idx - 1] : null;
										const showStopMarker =
											prev !== null &&
											prev.diarization_covered === true &&
											segment.diarization_covered === false;
										const showResumeMarker =
											prev !== null &&
											prev.diarization_covered === false &&
											segment.diarization_covered === true;
										// Correction (PR #1936 review F3): the long stop text
										// is only true when no later segment is covered; at
										// an interior gap the marker must not claim the rest
										// is unlabelled when labels are about to resume.
										const labelsResumeLater =
											showStopMarker &&
											filteredSegments
												.slice(idx + 1)
												.some((s) => s.diarization_covered === true);

										return (
											<Fragment key={segment.id}>
												{showStopMarker && (
													<div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-2 text-center text-xs font-medium text-amber-800">
														{labelsResumeLater
															? 'Speaker labels stop here'
															: 'Speaker labels stop here — the rest of this transcript is unlabelled'}
													</div>
												)}
												{showResumeMarker && (
													<div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50 p-2 text-center text-xs font-medium text-emerald-800">
														Speaker labels resume here
													</div>
												)}
											<div
												id={`segment-${segment.id}`}
												className={`p-3 rounded-lg border cursor-pointer transition-all ${
													isActive && !uncovered
														? `${colors.bg} ${colors.border} ring-1 ring-indigo-300`
														: 'bg-card border-border hover:bg-muted/50'
												}`}
												onClick={() => jumpToSegment(segment)}
											>
												{uncovered ? (
													<div className="flex items-center gap-2 mb-1">
														<span className="text-xs text-muted-foreground ml-auto">
															{formatTimestamp(segment.start_time_ms)}
														</span>
													</div>
												) : (
													<div className="flex items-center gap-2 mb-1">
														<div className={`w-2 h-2 rounded-full ${colors.dot}`} />
														<span className={`text-xs font-semibold ${colors.text}`}>
															{segment.speaker_identity}
														</span>
														<span className="text-xs text-muted-foreground ml-auto">
															{formatTimestamp(segment.start_time_ms)}
														</span>
													</div>
												)}
												<p className="text-sm leading-relaxed">{segment.text}</p>

												{/* Highlights */}
												{segment.highlights && segment.highlights.length > 0 && (
													<div className="mt-2 space-y-1">
														{segment.highlights.map((h) => (
															<div
																key={h.id}
																className="text-xs p-1.5 rounded bg-yellow-50 border border-yellow-200 text-yellow-800"
															>
																<div className="flex items-center gap-1 mb-0.5">
																	<Highlighter className="h-3 w-3" />
																	<span className="font-medium">{h.created_by}</span>
																</div>
																{h.note}
															</div>
														))}
													</div>
												)}

												{/* Add highlight button (recruiters only) */}
												{isRecruiter && (
													<Button
														size="sm"
														variant="ghost"
														className="mt-1 h-7 text-xs text-muted-foreground hover:text-yellow-600"
														onClick={(e) => {
															e.stopPropagation();
															setSelectedSegmentId(segment.id);
														}}
													>
														<Highlighter className="h-3 w-3 mr-1" />
														Add Highlight
													</Button>
												)}
											</div>
											</Fragment>
										);
									})
								)}
							</div>
						</CardContent>
					</Card>
				</div>
			</div>

			{/* S-D09 (#1911, §3.8): Speaker names section — the target of the
			    "Correct speaker names" entry point. S-D10 (#1912) turns it
			    into the mapping editor for correctors; everyone else (and
			    any editor load failure) keeps the read-only list. */}
			{diarization && (
				<section id="speaker-names">
					<Card>
						<CardContent className="p-4">
							<h3 className="text-sm font-semibold mb-2">Speaker names</h3>
							{speakerEditor ? (
								<div className="space-y-4">
									{speakerEditor.speakers.map((spk) => (
										<div key={spk.speaker_number} className="space-y-1">
											<label
												htmlFor={`speaker-assign-${spk.speaker_number}`}
												className="text-sm font-medium"
											>
												{`Assign Speaker ${spk.speaker_number + 1} to`}
											</label>
											{spk.sample_turn && (
												<p className="text-sm text-muted-foreground">
													{`"${spk.sample_turn.text}" — ${formatTimestamp(spk.sample_turn.start_time_ms)}`}
												</p>
											)}
											<select
												id={`speaker-assign-${spk.speaker_number}`}
												className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
												value={editorSelections[spk.speaker_number] ?? ''}
												onChange={(e) =>
													setEditorSelections((prev) => ({
														...prev,
														[spk.speaker_number]: e.target.value,
													}))
												}
											>
												<option value="">Not assigned</option>
												{speakerEditor.participants.map((p) => (
													<option key={p.user_id} value={String(p.user_id)}>
														{`${p.name ?? 'Unknown'} (${p.role === 'candidate' ? 'Candidate' : 'Interviewer'})`}
													</option>
												))}
											</select>
										</div>
									))}
									<Button onClick={handleSaveSpeakers} disabled={savingSpeakers}>
										{savingSpeakers ? 'Saving…' : 'Save speaker names'}
									</Button>
								</div>
							) : diarization.speakers.length === 0 ? (
								<p className="text-sm text-muted-foreground">No speakers detected yet.</p>
							) : (
								<ul className="space-y-1">
									{diarization.speakers.map((spk) => (
										<li
											key={spk.speaker_number}
											className="flex items-center gap-2 text-sm"
										>
											<span className="font-medium">{spk.label}</span>
											<span className="text-xs text-muted-foreground">
												{spk.assigned ? 'Assigned' : 'Not assigned'}
											</span>
										</li>
									))}
								</ul>
							)}
						</CardContent>
					</Card>
				</section>
			)}

			{/* Highlight dialog */}
			<Dialog
				open={!!selectedSegmentId}
				onOpenChange={(open) => {
					if (!open) {
						setSelectedSegmentId(null);
						setHighlightNote('');
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Highlighter className="h-5 w-5 text-yellow-600" />
							Add Highlight
						</DialogTitle>
						<DialogDescription>
							Add a note to this transcript segment at {formatTimestamp(currentTimeMs)}.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-2">
						{selectedSegmentId && (
							<div className="p-3 bg-muted rounded-lg text-sm">
								{segments.find((s) => s.id === selectedSegmentId)?.text}
							</div>
						)}
						<div>
							<label className="text-sm font-medium mb-1.5 block">Note</label>
							<Textarea
								value={highlightNote}
								onChange={(e) => setHighlightNote(e.target.value)}
								placeholder="Enter your highlight note..."
								rows={3}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setSelectedSegmentId(null);
								setHighlightNote('');
							}}
							disabled={addingHighlight}
						>
							Cancel
						</Button>
						<Button
							onClick={handleAddHighlight}
							disabled={!highlightNote.trim() || addingHighlight}
						>
							{addingHighlight ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin mr-1" />
									Adding...
								</>
							) : (
								<>
									<Highlighter className="h-4 w-4 mr-1" />
									Add Highlight
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
