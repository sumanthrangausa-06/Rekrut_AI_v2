// Voice Screening Interview — conversational AI recruiter with voice + video
// Adapted from mock-interview voice pattern, with screening-specific phases.

import {
	AlertCircle,
	Brain,
	CheckCircle,
	Loader2,
	Mic,
	MicOff,
	Video,
	VideoOff,
	Volume2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiCall, getToken } from '@/lib/api';

interface ScreeningData {
	job_title: string;
	company_name: string;
	status: string;
}

const PHASE_LABELS: Record<string, string> = {
	intro: 'Introduction',
	background: 'Background',
	experience: 'Experience',
	motivation: 'Motivation',
	logistics: 'Logistics',
	candidate_questions: 'Your Questions',
	close: 'Wrap-up',
};

export function VoiceScreeningPage() {
	const { token } = useParams<{ token: string }>();
	const [screening, setScreening] = useState<ScreeningData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [started, setStarted] = useState(false);
	const [starting, setStarting] = useState(false);

	// Voice state
	const [isRecording, setIsRecording] = useState(false);
	const [isPlaying, setIsPlaying] = useState(false);
	const [aiSpeaking, setAiSpeaking] = useState(false);
	const [transcript, setTranscript] = useState<Array<{ role: string; text: string }>>([]);
	const [currentPhase, setCurrentPhase] = useState('intro');
	const [completed, setCompleted] = useState(false);

	// Refs
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const [videoEnabled, setVideoEnabled] = useState(false);
	const streamRef = useRef<MediaStream | null>(null);

	const loadScreening = useCallback(async () => {
		try {
			const data = await apiCall<{ screening: ScreeningData }>(
				`/api/interviews/screening/session/${token}`,
			);
			setScreening({
				job_title: data.screening.job_title,
				company_name: data.screening.company_name,
				status: data.screening.status,
			});
			if (data.screening.status === 'completed') setCompleted(true);
			else if (data.screening.status === 'in_progress') setStarted(true);
		} catch (err: any) {
			setError(err.message || 'Failed to load screening');
		} finally {
			setLoading(false);
		}
	}, [token]);

	useEffect(() => {
		loadScreening();
		return () => {
			streamRef.current?.getTracks().forEach((t) => t.stop());
		};
	}, [loadScreening]);

	const startCamera = async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'user' },
				audio: true,
			});
			streamRef.current = stream;
			if (videoRef.current) {
				videoRef.current.srcObject = stream;
				await videoRef.current.play();
			}
			setVideoEnabled(true);
		} catch (err: any) {
			setError('Could not access camera/microphone: ' + err.message);
		}
	};

	const stopCamera = () => {
		streamRef.current?.getTracks().forEach((t) => t.stop());
		streamRef.current = null;
		setVideoEnabled(false);
	};

	const handleStart = async () => {
		setStarting(true);
		setError('');
		try {
			// Request mic access
			if (!streamRef.current) {
				await startCamera();
			}

			const data = await apiCall<{
				success: boolean;
				ai_message: string;
				phase: string;
				audio_url?: string;
			}>(`/api/interviews/screening/session/${token}/start`, {
				method: 'POST',
			});

			setStarted(true);
			setCurrentPhase(data.phase || 'background');
			setTranscript([{ role: 'ai', text: data.ai_message }]);

			// Play AI intro audio if available, otherwise use TTS
			if (data.audio_url) {
				playAudio(data.audio_url);
			} else {
				speakText(data.ai_message);
			}
		} catch (err: any) {
			setError(err.message || 'Failed to start screening');
		} finally {
			setStarting(false);
		}
	};

	const speakText = (text: string) => {
		if (!('speechSynthesis' in window)) return;
		setAiSpeaking(true);
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.rate = 1.0;
		utterance.onend = () => {
			setAiSpeaking(false);
			// Auto-start recording after AI finishes speaking
			startRecording();
		};
		window.speechSynthesis.speak(utterance);
	};

	const playAudio = (url: string) => {
		if (audioRef.current) {
			audioRef.current.src = url;
			audioRef.current.onended = () => {
				setIsPlaying(false);
				setAiSpeaking(false);
				startRecording();
			};
			audioRef.current.play();
			setIsPlaying(true);
			setAiSpeaking(true);
		}
	};

	const startRecording = async () => {
		try {
			let stream = streamRef.current;
			if (!stream) {
				stream = await navigator.mediaDevices.getUserMedia({ audio: true });
				streamRef.current = stream;
			}

			const recorder = new MediaRecorder(stream);
			audioChunksRef.current = [];

			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) audioChunksRef.current.push(e.data);
			};

			recorder.onstop = async () => {
				const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
				await sendAudio(audioBlob);
			};

			mediaRecorderRef.current = recorder;
			recorder.start();
			setIsRecording(true);
		} catch (err: any) {
			setError('Microphone access failed: ' + err.message);
		}
	};

	const stopRecording = () => {
		if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
			mediaRecorderRef.current.stop();
			setIsRecording(false);
		}
	};

	const sendAudio = async (audioBlob: Blob) => {
		setError('');
		try {
			const formData = new FormData();
			formData.append('audio', audioBlob, 'recording.webm');

			const res = await fetch(
				`/api/interviews/screening/session/${token}/respond-voice`,
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${getToken()}`,
					},
					body: formData,
				},
			);

			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Failed to process audio');

			// Add candidate transcript and AI response
			setTranscript((prev) => [
				...prev,
				{ role: 'candidate', text: data.transcribed_text },
				{ role: 'ai', text: data.ai_message },
			]);
			setCurrentPhase(data.phase || currentPhase);

			// Play AI response
			if (data.audio_url) {
				playAudio(data.audio_url);
			} else {
				speakText(data.ai_message);
			}

			if (data.should_wrap_up) {
				setTimeout(() => handleComplete(), 2000);
			}
		} catch (err: any) {
			setError(err.message || 'Failed to process audio. Please try again.');
			// Restart recording on error
			startRecording();
		}
	};

	const handleComplete = async () => {
		try {
			await apiCall(`/api/interviews/screening/session/${token}/complete`, {
				method: 'POST',
			});
			setCompleted(true);
			stopCamera();
			window.speechSynthesis.cancel();
		} catch (err: any) {
			setError(err.message || 'Failed to complete screening');
		}
	};

	if (loading) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (completed) {
		return (
			<div className="min-h-screen flex items-center justify-center p-4">
				<Card className="max-w-md w-full">
					<CardContent className="pt-6 text-center">
						<CheckCircle className="h-12 w-12 mx-auto text-green-600 mb-4" />
						<p className="text-lg font-medium mb-2">Screening Complete</p>
						<p className="text-sm text-muted-foreground">
							Thanks for completing the AI screening for {screening?.job_title}. The
							hiring team will review and be in touch soon.
						</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (!started) {
		return (
			<div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
				<Card className="max-w-lg w-full">
					<CardContent className="pt-6">
						<div className="flex items-center gap-3 mb-4">
							<div className="p-2 bg-primary/10 rounded-lg">
								<Brain className="h-6 w-6 text-primary" />
							</div>
							<div>
								<h1 className="text-lg font-semibold">AI Screening Interview</h1>
								<p className="text-sm text-muted-foreground">
									{screening?.job_title} at {screening?.company_name}
								</p>
							</div>
						</div>

						<div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg mb-4">
							<p className="text-xs text-blue-900 dark:text-blue-100">
								<strong>Voice screening:</strong> You'll have a natural voice
								conversation with our AI recruiter. Make sure your microphone works
								and you're in a quiet place. The AI will ask follow-up questions
								based on your answers.
							</p>
						</div>

						<div className="flex gap-2 mb-4">
							<Button
								variant={videoEnabled ? 'default' : 'outline'}
								onClick={videoEnabled ? stopCamera : startCamera}
								className="flex-1"
							>
								{videoEnabled ? (
									<VideoOff className="h-4 w-4 mr-2" />
								) : (
									<Video className="h-4 w-4 mr-2" />
								)}
								{videoEnabled ? 'Disable Video' : 'Enable Video'}
							</Button>
						</div>

						{videoEnabled && (
							<video
								ref={videoRef}
								className="w-full rounded-lg mb-4 bg-black"
								muted
								playsInline
							/>
						)}

						{error && <p className="text-sm text-destructive mb-4">{error}</p>}

						<Button onClick={handleStart} disabled={starting} className="w-full">
							{starting ? (
								<>
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									Starting...
								</>
							) : (
								<>
									<Mic className="h-4 w-4 mr-2" />
									Start Voice Screening
								</>
							)}
						</Button>
					</CardContent>
				</Card>
				<audio ref={audioRef} className="hidden" />
			</div>
		);
	}

	return (
		<div className="min-h-screen flex flex-col bg-muted/30">
			<div className="sticky top-0 z-10 bg-background border-b">
				<div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
					<div>
						<p className="text-sm font-medium">{screening?.job_title}</p>
						<p className="text-xs text-muted-foreground">{screening?.company_name}</p>
					</div>
					{PHASE_LABELS[currentPhase] && (
						<Badge variant="secondary">{PHASE_LABELS[currentPhase]}</Badge>
					)}
				</div>
			</div>

			<div className="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
				{videoEnabled && (
					<video
						ref={videoRef}
						className="w-48 h-36 rounded-lg mb-4 bg-black ml-auto"
						muted
						playsInline
						autoPlay
					/>
				)}

				<div className="space-y-4 mb-6 max-h-[400px] overflow-y-auto">
					{transcript.map((msg, i) => (
						<div
							key={i}
							className={`flex ${msg.role === 'candidate' ? 'justify-end' : 'justify-start'}`}
						>
							<div
								className={`max-w-[80%] rounded-2xl px-4 py-3 ${
									msg.role === 'candidate'
										? 'bg-primary text-primary-foreground'
										: 'bg-background border shadow-sm'
								}`}
							>
								{msg.role === 'ai' && (
									<p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
										<Volume2 className="h-3 w-3" /> Maya · AI Recruiter
									</p>
								)}
								<p className="text-sm">{msg.text}</p>
							</div>
						</div>
					))}
				</div>

				{error && <p className="text-sm text-destructive mb-4">{error}</p>}

				<div className="flex flex-col items-center gap-4">
					{aiSpeaking ? (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Volume2 className="h-4 w-4 animate-pulse" />
							Maya is speaking...
						</div>
					) : isRecording ? (
						<>
							<Button
								size="lg"
								variant="destructive"
								onClick={stopRecording}
								className="h-16 w-16 rounded-full"
							>
								<MicOff className="h-6 w-6" />
							</Button>
							<p className="text-sm text-muted-foreground animate-pulse">
								Recording... tap to stop and send
							</p>
						</>
					) : (
						<>
							<Button
								size="lg"
								onClick={startRecording}
								className="h-16 w-16 rounded-full"
							>
								<Mic className="h-6 w-6" />
							</Button>
							<p className="text-sm text-muted-foreground">
								Tap to speak your answer
							</p>
						</>
					)}

					<Button variant="ghost" size="sm" onClick={handleComplete}>
						End Interview
					</Button>
				</div>
			</div>
			<audio ref={audioRef} className="hidden" />
		</div>
	);
}
