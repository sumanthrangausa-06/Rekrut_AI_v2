// Recruiter Screening Monitor — live session list with transcript and report view

import { Brain, CheckCircle, Clock, Loader2, Mic, User, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { apiCall } from '@/lib/api';

interface ScreeningSession {
	id: number;
	status: string;
	current_phase: string;
	overall_score: number | null;
	recommendation: string | null;
	job_title: string;
	candidate_name: string;
	candidate_email: string;
	template_title: string;
	invited_at: string;
	started_at: string | null;
	completed_at: string | null;
	exchange_count: number;
	transcript: Array<{
		role: string;
		text: string;
		timestamp: string;
		phase?: string;
	}>;
}

const PHASE_LABELS: Record<string, string> = {
	intro: 'Introduction',
	background: 'Background',
	experience: 'Experience',
	motivation: 'Motivation',
	logistics: 'Logistics',
	candidate_questions: 'Q&A',
	close: 'Wrap-up',
};

const STATUS_COLORS: Record<string, string> = {
	invited: 'bg-blue-100 text-blue-800',
	in_progress: 'bg-yellow-100 text-yellow-800',
	completed: 'bg-green-100 text-green-800',
	expired: 'bg-gray-100 text-gray-800',
};

export function ScreeningMonitorPage() {
	const [sessions, setSessions] = useState<ScreeningSession[]>([]);
	const [loading, setLoading] = useState(true);
	const [selected, setSelected] = useState<ScreeningSession | null>(null);
	const [showTranscript, setShowTranscript] = useState(false);

	const loadSessions = useCallback(async () => {
		try {
			const data = await apiCall<{ success: boolean; sessions: ScreeningSession[] }>(
				'/interviews/screening/sessions',
			);
			setSessions(data.sessions || []);
		} catch (err) {
			console.error('Failed to load sessions:', err);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadSessions();
		// Refresh every 30 seconds for live monitoring
		const interval = setInterval(loadSessions, 30000);
		return () => clearInterval(interval);
	}, [loadSessions]);

	if (loading) {
		return (
			<div className="flex items-center justify-center p-8">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold">AI Screening Monitor</h1>
				<p className="text-sm text-muted-foreground">
					Track candidate screening sessions, view transcripts, and review reports.
				</p>
			</div>

			{sessions.length === 0 ? (
				<Card>
					<CardContent className="pt-6 text-center">
						<Mic className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
						<p className="text-sm text-muted-foreground">
							No screening sessions yet. Send an AI screening from the applicant
							review page to get started.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4">
					{sessions.map((session) => (
						<Card key={session.id}>
							<CardContent className="p-4">
								<div className="flex items-start justify-between">
									<div className="flex-1">
										<div className="flex items-center gap-2 mb-1">
											<User className="h-4 w-4 text-muted-foreground" />
											<span className="font-medium">{session.candidate_name}</span>
											<Badge
												className={STATUS_COLORS[session.status] || 'bg-gray-100'}
											>
												{session.status.replace('_', ' ')}
											</Badge>
											{session.current_phase && session.status === 'in_progress' && (
												<Badge variant="outline">
													{PHASE_LABELS[session.current_phase] || session.current_phase}
												</Badge>
											)}
										</div>
										<p className="text-sm text-muted-foreground">
											{session.job_title} · {session.exchange_count} exchanges
										</p>
										{session.status === 'completed' && session.overall_score !== null && (
											<div className="flex items-center gap-2 mt-2">
												<Brain className="h-4 w-4 text-muted-foreground" />
												<span className="text-sm font-medium">
													Score: {session.overall_score}/100
												</span>
												{session.recommendation && (
													<Badge
														variant={
															session.recommendation === 'advance'
																? 'default'
																: session.recommendation === 'reject'
																	? 'destructive'
																	: 'secondary'
														}
													>
														{session.recommendation}
													</Badge>
												)}
											</div>
										)}
									</div>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => {
												setSelected(session);
												setShowTranscript(true);
											}}
										>
											View Transcript
										</Button>
									</div>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			{/* Transcript dialog */}
			<Dialog open={showTranscript} onClose={() => setShowTranscript(false)}>
				<DialogHeader>
					<DialogTitle>
						Screening Transcript — {selected?.candidate_name}
					</DialogTitle>
				</DialogHeader>
				<div className="max-h-[500px] overflow-y-auto space-y-3 mt-4">
					{selected?.transcript.map((msg, i) => (
						<div
							key={i}
							className={`flex ${msg.role === 'candidate' ? 'justify-end' : 'justify-start'}`}
						>
							<div
								className={`max-w-[80%] rounded-lg px-3 py-2 ${
									msg.role === 'candidate'
										? 'bg-primary text-primary-foreground'
										: 'bg-muted'
								}`}
							>
								<p className="text-xs font-medium opacity-70 mb-1">
									{msg.role === 'candidate' ? 'Candidate' : 'Maya (AI)'}
									{msg.phase && ` · ${PHASE_LABELS[msg.phase] || msg.phase}`}
								</p>
								<p className="text-sm">{msg.text}</p>
							</div>
						</div>
					))}
					{(!selected?.transcript || selected.transcript.length === 0) && (
						<p className="text-sm text-muted-foreground text-center">
							No transcript available yet.
						</p>
					)}
				</div>
			</Dialog>
		</div>
	);
}
