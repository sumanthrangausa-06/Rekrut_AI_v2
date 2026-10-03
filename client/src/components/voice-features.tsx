import { Loader2, Mic, Play, Square, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiCall } from '@/lib/api';

export function VoiceFeatures() {
	const [text, setText] = useState('');
	const [audioUrl, setAudioUrl] = useState('');
	const [isPlaying, setIsPlaying] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [isRecording, setIsRecording] = useState(false);
	const [transcript, setTranscript] = useState('');

	const handleTTS = async () => {
		if (!text.trim()) return;
		setIsLoading(true);
		try {
			const data = await apiCall<{ success: boolean; audio_url: string }>('/voice/tts', {
				method: 'POST',
				body: { text, voice_id: 'f9fc912e-52f0-448a-8bfa-47e9ca75f25a' },
			});
			if (data.success) {
				setAudioUrl(data.audio_url);
			}
		} catch (err) {
			console.error('TTS failed:', err);
		} finally {
			setIsLoading(false);
		}
	};

	const handleSTT = async () => {
		setIsRecording(true);
		// TODO: Implement actual audio recording
		setTimeout(() => {
			setIsRecording(false);
			setTranscript('This is a sample transcription from Cartesia STT.');
		}, 3000);
	};

	return (
		<div className="space-y-6">
			<Card>
				<CardContent className="p-6 space-y-4">
					<h3 className="font-semibold flex items-center gap-2">
						<Volume2 className="h-5 w-5" /> Text to Speech
					</h3>
					<textarea
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder="Enter text to convert to speech..."
						className="w-full min-h-[100px] rounded-md border p-3 text-sm"
					/>
					<div className="flex gap-2">
						<Button onClick={handleTTS} disabled={isLoading || !text.trim()}>
							{isLoading ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Play className="h-4 w-4" />
							)}
							Generate Speech
						</Button>
						{audioUrl && (
							<Button variant="outline" onClick={() => setIsPlaying(!isPlaying)}>
								{isPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
								{isPlaying ? 'Stop' : 'Play'}
							</Button>
						)}
					</div>
					{audioUrl && <audio src={audioUrl} controls className="w-full" />}
				</CardContent>
			</Card>

			<Card>
				<CardContent className="p-6 space-y-4">
					<h3 className="font-semibold flex items-center gap-2">
						<Mic className="h-5 w-5" /> Speech to Text
					</h3>
					<Button onClick={handleSTT} disabled={isRecording}>
						{isRecording ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Mic className="h-4 w-4" />
						)}
						{isRecording ? 'Recording...' : 'Start Recording'}
					</Button>
					{transcript && <div className="rounded-md border p-3 text-sm bg-muted">{transcript}</div>}
				</CardContent>
			</Card>
		</div>
	);
}
