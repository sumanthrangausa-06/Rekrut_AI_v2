import { MessageCircle, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiCall } from '@/lib/api';
import type { KanbanApplication } from './kanban-card';

export interface OutreachAttempt {
	id: number;
	application_id: number;
	method: 'email' | 'linkedin' | 'phone' | 'other';
	message: string | null;
	status: 'pending' | 'sent' | 'replied' | 'follow_up' | 'no_response';
	created_at: string;
	updated_at: string;
}

interface OutreachModalProps {
	application: KanbanApplication | null;
	open: boolean;
	onClose: () => void;
}

const METHOD_LABELS: Record<string, string> = {
	email: 'Email',
	linkedin: 'LinkedIn',
	phone: 'Phone',
	other: 'Other',
};

const STATUS_LABELS: Record<string, string> = {
	pending: 'Pending',
	sent: 'Sent',
	replied: 'Replied',
	follow_up: 'Follow Up',
	no_response: 'No Response',
};

const TEMPLATES: Record<string, string> = {
	email:
		'Hi [Name], I recently applied for the [Role] position at [Company] and wanted to express my enthusiasm...',
	linkedin:
		"Hi [Name], I came across the [Role] opening at [Company] and applied. I'd love to connect...",
	phone: "Hi, I'm calling about my application for the [Role] position...",
	other: '',
};

export function OutreachModal({ application, open, onClose }: OutreachModalProps) {
	const [method, setMethod] = useState<string>('email');
	const [message, setMessage] = useState('');
	const [status, setStatus] = useState<string>('pending');
	const [attempts, setAttempts] = useState<OutreachAttempt[]>([]);
	const [loading, setLoading] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	// Load attempts when modal opens with a new application
	useEffect(() => {
		if (!application || !open) {
			setAttempts([]);
			return;
		}
		setLoading(true);
		apiCall<{ success: boolean; attempts: OutreachAttempt[] }>(
			`/candidate/outreach/${application.id}`,
		)
			.then((data) => setAttempts(data.attempts || []))
			.catch(() => setAttempts([]))
			.finally(() => setLoading(false));
	}, [application, open]);

	// Update message template when method changes (only if user hasn't typed yet or template matches)
	useEffect(() => {
		if (!open) return;
		const template = TEMPLATES[method] || '';
		// ponytail: always set template on method change for simplicity
		setMessage(template);
	}, [method, open]);

	const handleSubmit = async () => {
		if (!application) return;
		setSubmitting(true);
		try {
			const data = await apiCall<{ success: boolean; attempt: OutreachAttempt }>(
				'/candidate/outreach',
				{
					method: 'POST',
					body: JSON.stringify({
						application_id: application.id,
						method,
						message: message || null,
						status,
					}),
				},
			);
			if (data.attempt) {
				setAttempts((prev) => [data.attempt, ...prev]);
				setMessage(TEMPLATES[method] || '');
				setStatus('pending');
			}
		} catch (err: unknown) {
			alert(err instanceof Error ? err.message : 'Failed to create outreach attempt');
		} finally {
			setSubmitting(false);
		}
	};

	const handleDelete = async (id: number) => {
		if (!confirm('Delete this outreach attempt?')) return;
		try {
			await apiCall(`/candidate/outreach/${id}`, { method: 'DELETE' });
			setAttempts((prev) => prev.filter((a) => a.id !== id));
		} catch (err: unknown) {
			alert(err instanceof Error ? err.message : 'Failed to delete');
		}
	};

	const handleStatusChange = async (id: number, newStatus: string) => {
		try {
			const data = await apiCall<{ success: boolean; attempt: OutreachAttempt }>(
				`/candidate/outreach/${id}`,
				{
					method: 'PUT',
					body: JSON.stringify({ status: newStatus }),
				},
			);
			if (data.attempt) {
				setAttempts((prev) => prev.map((a) => (a.id === id ? data.attempt : a)));
			}
		} catch (err: unknown) {
			alert(err instanceof Error ? err.message : 'Failed to update status');
		}
	};

	if (!application) return null;

	return (
		<Dialog open={open} onClose={onClose} className="max-w-lg">
			<DialogHeader>
				<DialogTitle className="flex items-center gap-2">
					<MessageCircle className="h-5 w-5 text-indigo-600" />
					Start Outreach
				</DialogTitle>
				<DialogDescription>
					{application.title} at {application.company || application.posted_by_company || 'Company'}
				</DialogDescription>
			</DialogHeader>

			<div className="space-y-4">
				{/* Form */}
				<div className="space-y-3">
					<div>
						<label htmlFor="outreach-method" className="text-sm font-medium mb-1 block">
							Method
						</label>
						<Select id="outreach-method" value={method} onValueChange={setMethod}>
							<option value="email">Email</option>
							<option value="linkedin">LinkedIn</option>
							<option value="phone">Phone</option>
							<option value="other">Other</option>
						</Select>
					</div>

					<div>
						<label htmlFor="outreach-message" className="text-sm font-medium mb-1 block">
							Message
						</label>
						<Textarea
							id="outreach-message"
							value={message}
							onChange={(e) => setMessage(e.target.value)}
							placeholder={`Use the ${METHOD_LABELS[method]} template or write your own...`}
							rows={5}
						/>
					</div>

					<div>
						<label htmlFor="outreach-status" className="text-sm font-medium mb-1 block">
							Status
						</label>
						<Select id="outreach-status" value={status} onValueChange={setStatus}>
							<option value="pending">Pending</option>
							<option value="sent">Sent</option>
							<option value="replied">Replied</option>
							<option value="follow_up">Follow Up</option>
							<option value="no_response">No Response</option>
						</Select>
					</div>

					<Button onClick={handleSubmit} disabled={submitting} className="w-full gap-2">
						{submitting ? (
							<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
						) : (
							<Send className="h-4 w-4" />
						)}
						Log Outreach
					</Button>
				</div>

				{/* Timeline */}
				<div className="border-t pt-3">
					<h4 className="text-sm font-medium mb-2">Past Attempts ({attempts.length})</h4>
					{loading ? (
						<div className="flex items-center justify-center py-4">
							<div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
						</div>
					) : attempts.length === 0 ? (
						<p className="text-sm text-muted-foreground py-2">No outreach attempts logged yet.</p>
					) : (
						<div className="space-y-2 max-h-64 overflow-y-auto pr-1">
							{attempts.map((attempt) => (
								<div key={attempt.id} className="rounded-lg border bg-muted/30 p-3 text-sm">
									<div className="flex items-center justify-between mb-1">
										<span className="font-medium">{METHOD_LABELS[attempt.method]}</span>
										<div className="flex items-center gap-1">
											<Select
												value={attempt.status}
												onValueChange={(v) => handleStatusChange(attempt.id, v)}
												className="h-7 text-xs py-0 w-28"
											>
												{Object.entries(STATUS_LABELS).map(([k, label]) => (
													<option key={k} value={k}>
														{label}
													</option>
												))}
											</Select>
											<button
												type="button"
												onClick={() => handleDelete(attempt.id)}
												className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
												title="Delete"
											>
												<Trash2 className="h-3.5 w-3.5" />
											</button>
										</div>
									</div>
									{attempt.message && (
										<p className="text-xs text-muted-foreground line-clamp-3 mb-1">
											{attempt.message}
										</p>
									)}
									<p className="text-[10px] text-muted-foreground">
										{new Date(attempt.created_at).toLocaleDateString()}
									</p>
								</div>
							))}
						</div>
					)}
				</div>

				<Button variant="outline" onClick={onClose} className="w-full">
					Close
				</Button>
			</div>
		</Dialog>
	);
}
