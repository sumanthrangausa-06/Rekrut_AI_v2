// Conversational AI Screening — chat-thread UI like a real recruiter phone screen
// The AI conducts the interview conversationally: intro → background → experience
// deep-dive → motivation → logistics → candidate questions → close.

import {
	AlertCircle,
	Brain,
	Briefcase,
	Building2,
	CheckCircle,
	Loader2,
	Send,
	Shield,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { apiCall } from '@/lib/api';

interface ChatMessage {
	role: 'ai' | 'candidate';
	text: string;
	phase?: string;
	timestamp: string;
}

interface ScreeningData {
	job_title: string;
	company_name: string;
	status: string;
	expires_at?: string;
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

export function CandidateScreeningPage() {
	const { token } = useParams<{ token: string }>();
	const [screening, setScreening] = useState<ScreeningData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [started, setStarted] = useState(false);
	const [starting, setStarting] = useState(false);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState('');
	const [sending, setSending] = useState(false);
	const [aiTyping, setAiTyping] = useState(false);
	const [currentPhase, setCurrentPhase] = useState('intro');
	const [completed, setCompleted] = useState(false);
	const [completing, setCompleting] = useState(false);
	const chatEndRef = useRef<HTMLDivElement>(null);

	const scrollToBottom = useCallback(() => {
		setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
	}, []);

	const loadScreening = useCallback(async () => {
		try {
			const data = await apiCall<{ screening: ScreeningData }>(
				`/api/interviews/screening/session/${token}`,
			);
			const s = data.screening;
			setScreening({
				job_title: s.job_title,
				company_name: s.company_name,
				status: s.status,
				expires_at: s.expires_at,
			});
			if (s.status === 'completed') {
				setCompleted(true);
			} else if (s.status === 'in_progress') {
				setStarted(true);
			}
		} catch (err: any) {
			setError(err.message || 'Failed to load screening');
		} finally {
			setLoading(false);
		}
	}, [token]);

	useEffect(() => {
		loadScreening();
	}, [loadScreening]);

	useEffect(() => {
		scrollToBottom();
	}, [messages, scrollToBottom]);

	const handleStart = async () => {
		setStarting(true);
		setError('');
		try {
			const data = await apiCall<{
				success: boolean;
				ai_message: string;
				phase: string;
			}>(`/api/interviews/screening/session/${token}/start`, {
				method: 'POST',
			});
			setStarted(true);
			setCurrentPhase(data.phase || 'background');
			if (data.ai_message) {
				setMessages([
					{
						role: 'ai',
						text: data.ai_message,
						phase: 'intro',
						timestamp: new Date().toISOString(),
					},
				]);
			}
			scrollToBottom();
		} catch (err: any) {
			setError(err.message || 'Failed to start screening');
		} finally {
			setStarting(false);
		}
	};

	const handleSend = async () => {
		const text = input.trim();
		if (!text || sending || aiTyping) return;
		if (text.length < 5) {
			setError('Please give a bit more detail in your response.');
			return;
		}
		setError('');
		setSending(true);

		const candidateMsg: ChatMessage = {
			role: 'candidate',
			text,
			timestamp: new Date().toISOString(),
		};
		setMessages((prev) => [...prev, candidateMsg]);
		setInput('');
		scrollToBottom();

		setAiTyping(true);
		try {
			const data = await apiCall<{
				ai_message: string;
				action: string;
				phase: string;
				should_wrap_up: boolean;
			}>(`/api/interviews/screening/session/${token}/respond`, {
				method: 'POST',
				body: JSON.stringify({ response_text: text }),
			});

			setCurrentPhase(data.phase || currentPhase);
			setMessages((prev) => [
				...prev,
				{
					role: 'ai',
					text: data.ai_message,
					phase: data.phase,
					timestamp: new Date().toISOString(),
				},
			]);

			if (data.should_wrap_up || data.action === 'wrap_up') {
				setTimeout(() => handleComplete(), 1500);
			}
		} catch (err: any) {
			setError(err.message || 'Failed to send response. Please try again.');
			setMessages((prev) => prev.slice(0, -1));
		} finally {
			setSending(false);
			setAiTyping(false);
			scrollToBottom();
		}
	};

	const handleComplete = async () => {
		setCompleting(true);
		try {
			await apiCall(`/api/interviews/screening/session/${token}/complete`, {
				method: 'POST',
			});
			setCompleted(true);
		} catch (err: any) {
			setError(err.message || 'Failed to complete screening');
		} finally {
			setCompleting(false);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	if (loading) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (error && !screening) {
		return (
			<div className="min-h-screen flex items-center justify-center p-4">
				<Card className="max-w-md w-full">
					<CardContent className="pt-6 text-center">
						<AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
						<p className="text-lg font-medium mb-2">Unable to load screening</p>
						<p className="text-sm text-muted-foreground">{error}</p>
					</CardContent>
				</Card>
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
							hiring team will review your responses and be in touch soon.
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

						<div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg mb-4">
							<Shield className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
							<p className="text-xs text-blue-900 dark:text-blue-100">
								<strong>AI disclosure:</strong> This is a conversational screening
								conducted by AI. Your responses will be evaluated by AI and reviewed
								by a human recruiter. The AI will ask follow-up questions based on
								your answers, just like a real phone screen.
							</p>
						</div>

						<div className="space-y-2 text-sm text-muted-foreground mb-6">
							<div className="flex items-center gap-2">
								<Briefcase className="h-4 w-4" />
								<span>Takes about 15-20 minutes</span>
							</div>
							<div className="flex items-center gap-2">
								<Building2 className="h-4 w-4" />
								<span>Be specific — concrete examples with your personal contribution</span>
							</div>
						</div>

						{error && <p className="text-sm text-destructive mb-4">{error}</p>}

						<Button onClick={handleStart} disabled={starting} className="w-full">
							{starting ? (
								<>
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									Starting...
								</>
							) : (
								'Start Screening Interview'
							)}
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="min-h-screen flex flex-col bg-muted/30">
			<div className="sticky top-0 z-10 bg-background border-b">
				<div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="p-1.5 bg-primary/10 rounded-lg">
							<Brain className="h-5 w-5 text-primary" />
						</div>
						<div>
							<p className="text-sm font-medium">{screening?.job_title}</p>
							<p className="text-xs text-muted-foreground">{screening?.company_name}</p>
						</div>
					</div>
					{currentPhase && PHASE_LABELS[currentPhase] && (
						<Badge variant="secondary" className="text-xs">
							{PHASE_LABELS[currentPhase]}
						</Badge>
					)}
				</div>
			</div>

			<div className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-4">
				{messages.map((msg, i) => (
					<div
						key={i}
						className={`flex ${msg.role === 'candidate' ? 'justify-end' : 'justify-start'}`}
					>
						<div
							className={`max-w-[80%] rounded-2xl px-4 py-3 ${
								msg.role === 'candidate'
									? 'bg-primary text-primary-foreground rounded-br-md'
									: 'bg-background border rounded-bl-md shadow-sm'
							}`}
						>
							{msg.role === 'ai' && (
								<p className="text-xs font-medium text-muted-foreground mb-1">
									Maya · AI Recruiter
								</p>
							)}
							<p className="text-sm whitespace-pre-wrap">{msg.text}</p>
						</div>
					</div>
				))}

				{aiTyping && (
					<div className="flex justify-start">
						<div className="bg-background border rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
							<div className="flex items-center gap-1">
								<span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" />
								<span
									className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce"
									style={{ animationDelay: '0.15s' }}
								/>
								<span
									className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce"
									style={{ animationDelay: '0.3s' }}
								/>
							</div>
						</div>
					</div>
				)}

				<div ref={chatEndRef} />
			</div>

			<div className="sticky bottom-0 bg-background border-t">
				<div className="max-w-3xl mx-auto px-4 py-3">
					{error && <p className="text-xs text-destructive mb-2">{error}</p>}
					<div className="flex gap-2">
						<Textarea
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Type your response..."
							className="min-h-[44px] max-h-[120px] resize-none"
							disabled={sending || aiTyping || completing}
						/>
						<Button
							onClick={handleSend}
							disabled={!input.trim() || sending || aiTyping || completing}
							size="icon"
							className="shrink-0 h-11 w-11"
						>
							{sending ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Send className="h-4 w-4" />
							)}
						</Button>
					</div>
					<div className="flex justify-between items-center mt-2">
						<p className="text-xs text-muted-foreground">
							Press Enter to send · Shift+Enter for new line
						</p>
						<Button
							variant="ghost"
							size="sm"
							onClick={handleComplete}
							disabled={completing || messages.length < 2}
							className="text-xs"
						>
							{completing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
							End Interview
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
