import {
	AlertCircle,
	CheckCircle,
	Clock,
	Eye,
	LayoutGrid,
	MessageSquare,
	Plus,
	Settings,
	Trash2,
	Users,
	XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/domain/empty-state';
import { Skeleton } from '@/components/domain/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { apiCall } from '@/lib/api';

interface Panel {
	id: number;
	job_id: number;
	interview_session_id: number | null;
	status: string;
	created_at: string;
	job_title: string;
	joined_count: number;
	total_members: number;
}

interface Job {
	id: number;
	title: string;
}

interface InterviewSession {
	id: number;
	scheduled_at: string;
	candidate_name: string;
	candidate_email: string;
	job_title: string;
}

interface TeamMember {
	id: number;
	name: string;
	email: string;
	role: string;
}

const statusConfig: Record<
	string,
	{
		label: string;
		variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive';
		icon: React.ElementType;
	}
> = {
	active: { label: 'Active', variant: 'success', icon: CheckCircle },
	completed: { label: 'Completed', variant: 'default', icon: CheckCircle },
	cancelled: { label: 'Cancelled', variant: 'destructive', icon: XCircle },
};

export function RecruiterPanelsPage() {
	const navigate = useNavigate();
	const [panels, setPanels] = useState<Panel[]>([]);
	const [jobs, setJobs] = useState<Job[]>([]);
	const [selectedJobId, setSelectedJobId] = useState<string>('');
	const [loading, setLoading] = useState(true);
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

	// Create panel dialog
	const [showCreate, setShowCreate] = useState(false);
	const [createJobId, setCreateJobId] = useState('');
	const [createSessionId, setCreateSessionId] = useState('');
	const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
	const [creating, setCreating] = useState(false);

	// Available sessions and team for creation
	const [sessions, setSessions] = useState<InterviewSession[]>([]);
	const [team, setTeam] = useState<TeamMember[]>([]);
	const [loadingSessions, setLoadingSessions] = useState(false);

	// Delete confirmation
	const [showDelete, setShowDelete] = useState<Panel | null>(null);
	const [deleting, setDeleting] = useState(false);

	// View panel
	const [viewPanel, setViewPanel] = useState<Panel | null>(null);
	const [panelMembers, setPanelMembers] = useState<any[]>([]);
	const [loadingMembers, setLoadingMembers] = useState(false);

	useEffect(() => {
		if (message) {
			const t = setTimeout(() => setMessage(null), 4000);
			return () => clearTimeout(t);
		}
	}, [message]);

	const loadJobs = useCallback(async () => {
		try {
			const res = await apiCall<{ jobs: Job[] }>('/recruiter/jobs');
			setJobs(res.jobs || []);
		} catch (err) {
			console.error('Load jobs error:', err);
		}
	}, []);

	const loadPanels = useCallback(async (jobId: string) => {
		if (!jobId) {
			setPanels([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		try {
			const res = await apiCall<{ panels: Panel[]; total: number }>(`/panels/${jobId}`);
			setPanels(res.panels || []);
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Failed to load panels' });
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadJobs();
	}, [loadJobs]);

	useEffect(() => {
		if (selectedJobId) {
			loadPanels(selectedJobId);
		} else if (jobs.length > 0) {
			setSelectedJobId(String(jobs[0].id));
		} else {
			setLoading(false);
		}
	}, [selectedJobId, jobs, loadPanels]);

	// Load sessions and team when create dialog opens
	useEffect(() => {
		if (!showCreate) return;
		async function loadData() {
			setLoadingSessions(true);
			try {
				const [sessionsRes, teamRes] = await Promise.all([
					apiCall<{ interviews: InterviewSession[] }>(
						'/recruiter/interviews?upcoming_only=true',
					).catch(() => ({ interviews: [] })),
					apiCall<{ members: TeamMember[] }>('/company/team').catch(() => ({ members: [] })),
				]);
				setSessions(sessionsRes.interviews || []);
				setTeam(teamRes.members || []);
			} catch {
				// ignore
			} finally {
				setLoadingSessions(false);
			}
		}
		loadData();
	}, [showCreate]);

	async function createPanel() {
		if (!createJobId) return;
		setCreating(true);
		try {
			const res = await apiCall<{ panel: Panel }>('/panels', {
				method: 'POST',
				body: {
					job_id: parseInt(createJobId, 10),
					interview_session_id: createSessionId ? parseInt(createSessionId, 10) : null,
					member_user_ids: selectedMembers,
				},
			});
			setShowCreate(false);
			resetCreateForm();
			setMessage({ type: 'success', text: 'Panel created successfully' });
			// Reload panels for the created job
			setSelectedJobId(createJobId);
			await loadPanels(createJobId);
			// Navigate to the panel room
			if (res.panel?.id) {
				navigate(`/recruiter/panels/${res.panel.id}`);
			}
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Failed to create panel' });
		} finally {
			setCreating(false);
		}
	}

	function resetCreateForm() {
		setCreateJobId('');
		setCreateSessionId('');
		setSelectedMembers([]);
	}

	async function loadPanelMembers(panelId: number) {
		setLoadingMembers(true);
		try {
			const res = await apiCall<{ panel: { members: any[] } }>(`/panels/${panelId}`);
			setPanelMembers(res.panel?.members || []);
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Failed to load panel members' });
		} finally {
			setLoadingMembers(false);
		}
	}

	async function deletePanel() {
		if (!showDelete) return;
		setDeleting(true);
		try {
			await apiCall(`/panels/${showDelete.id}`, { method: 'DELETE' });
			setShowDelete(null);
			setMessage({ type: 'success', text: 'Panel deleted' });
			await loadPanels(selectedJobId);
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Failed to delete panel' });
		} finally {
			setDeleting(false);
		}
	}

	function toggleMember(userId: number) {
		setSelectedMembers((prev) =>
			prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
		);
	}

	const roleBadge: Record<string, { label: string; color: string }> = {
		lead: { label: 'Lead', color: 'bg-indigo-100 text-indigo-700' },
		panelist: { label: 'Panelist', color: 'bg-blue-100 text-blue-700' },
		hiring_manager: { label: 'Hiring Manager', color: 'bg-green-100 text-green-700' },
		observer: { label: 'Observer', color: 'bg-gray-100 text-gray-700' },
	};

	return (
		<div className="space-y-6 px-4 sm:px-6">
			{/* Toast */}
			{message && (
				<div
					className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
						message.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-destructive text-white'
					}`}
				>
					{message.type === 'success' ? (
						<CheckCircle className="h-4 w-4" />
					) : (
						<AlertCircle className="h-4 w-4" />
					)}
					{message.text}
				</div>
			)}

			{/* Header */}
			<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-heading font-bold">Interview Panels</h1>
					<p className="text-muted-foreground text-sm">
						Manage multi-interviewer panels with scorecards and shared notes
					</p>
				</div>
				<div className="flex gap-2 flex-wrap">
					<Button
						variant="outline"
						onClick={() => {
							const jobId = selectedJobId || (jobs[0]?.id ?? '');
							if (jobId) navigate(`/recruiter/jobs/${jobId}/panel-criteria`);
						}}
						className="min-h-[44px]"
					>
						<Settings className="h-4 w-4 mr-2" /> Criteria
					</Button>
					<Button onClick={() => setShowCreate(true)} className="min-h-[44px]">
						<Plus className="h-4 w-4 mr-2" /> Create Panel
					</Button>
				</div>
			</div>

			{/* Job selector */}
			<div className="flex items-center gap-3">
				<Label className="text-sm whitespace-nowrap">Job:</Label>
				<Select
					value={selectedJobId}
					onValueChange={(v) => setSelectedJobId(v)}
					className="max-w-sm min-h-[44px]"
				>
					<option value="">Select a job...</option>
					{jobs.map((j) => (
						<option key={j.id} value={j.id}>
							{j.title}
						</option>
					))}
				</Select>
			</div>

			{/* Stats */}
			{panels.length > 0 && (
				<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
					<Card>
						<CardContent className="p-4">
							<div className="flex items-center gap-3">
								<div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
									<LayoutGrid className="h-5 w-5" />
								</div>
								<div>
									<p className="text-2xl font-bold">{panels.length}</p>
									<p className="text-xs text-muted-foreground">Panels</p>
								</div>
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-4">
							<div className="flex items-center gap-3">
								<div className="p-2 rounded-lg bg-green-100 text-green-700">
									<CheckCircle className="h-5 w-5" />
								</div>
								<div>
									<p className="text-2xl font-bold">
										{panels.filter((p) => p.status === 'active').length}
									</p>
									<p className="text-xs text-muted-foreground">Active</p>
								</div>
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-4">
							<div className="flex items-center gap-3">
								<div className="p-2 rounded-lg bg-blue-100 text-blue-700">
									<Users className="h-5 w-5" />
								</div>
								<div>
									<p className="text-2xl font-bold">
										{panels.reduce((sum, p) => sum + (p.joined_count || 0), 0)}
									</p>
									<p className="text-xs text-muted-foreground">Joined Members</p>
								</div>
							</div>
						</CardContent>
					</Card>
				</div>
			)}

			{/* Panels list */}
			{loading ? (
				<div className="space-y-3">
					<Skeleton variant="list" />
					<Skeleton variant="list" />
					<Skeleton variant="list" />
				</div>
			) : panels.length === 0 ? (
				<EmptyState
					icon={Users}
					title="No panels yet"
					description={
						selectedJobId
							? 'Create a panel for this job to start collaborative interviewing.'
							: 'Select a job to view or create panels.'
					}
					action={
						selectedJobId
							? { label: 'Create Panel', onClick: () => setShowCreate(true) }
							: undefined
					}
				/>
			) : (
				<div className="space-y-3">
					{panels.map((panel) => {
						const config = statusConfig[panel.status] || statusConfig.active;
						const StatusIcon = config.icon;
						return (
							<Card key={panel.id} className="hover:shadow-sm transition-shadow">
								<CardContent className="p-4">
									<div className="flex flex-col sm:flex-row items-start gap-4">
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2 flex-wrap">
												<h3 className="font-semibold">Panel #{panel.id}</h3>
												<Badge variant={config.variant}>
													<StatusIcon className="h-3 w-3 mr-1" /> {config.label}
												</Badge>
											</div>
											<div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
												<span>{panel.job_title}</span>
												<span className="flex items-center gap-1">
													<Users className="h-3.5 w-3.5" />
													{panel.joined_count}/{panel.total_members} members
												</span>
												<span className="flex items-center gap-1">
													<Clock className="h-3.5 w-3.5" />
													{new Date(panel.created_at).toLocaleDateString()}
												</span>
											</div>
										</div>
										<div className="flex flex-wrap gap-2">
											<Button
												size="sm"
												variant="outline"
												onClick={() => {
													setViewPanel(panel);
													loadPanelMembers(panel.id);
												}}
												className="min-h-[44px]"
											>
												<Eye className="h-3.5 w-3.5 mr-1" /> View
											</Button>
											<Button
												size="sm"
												onClick={() => navigate(`/recruiter/panels/${panel.id}`)}
												className="min-h-[44px]"
											>
												<MessageSquare className="h-3.5 w-3.5 mr-1" /> Room
											</Button>
											<Button
												size="sm"
												variant="ghost"
												className="text-destructive min-h-[44px]"
												onClick={() => setShowDelete(panel)}
											>
												<Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
											</Button>
										</div>
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}

			{/* Create panel dialog */}
			<Dialog
				open={showCreate}
				onClose={() => {
					setShowCreate(false);
					resetCreateForm();
				}}
			>
				<DialogHeader>
					<DialogTitle>Create Interview Panel</DialogTitle>
					<DialogDescription>
						Select a job, optional interview session, and add team members
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 mt-4">
					<div>
						<Label>Job</Label>
						<Select value={createJobId} onValueChange={setCreateJobId} className="min-h-[44px]">
							<option value="">Select a job...</option>
							{jobs.map((j) => (
								<option key={j.id} value={j.id}>
									{j.title}
								</option>
							))}
						</Select>
					</div>

					<div>
						<Label>Interview Session (optional)</Label>
						<Select
							value={createSessionId}
							onValueChange={setCreateSessionId}
							className="min-h-[44px]"
						>
							<option value="">None — create standalone panel</option>
							{sessions.map((s) => (
								<option key={s.id} value={s.id}>
									{s.candidate_name} — {new Date(s.scheduled_at).toLocaleDateString()}
								</option>
							))}
						</Select>
						{loadingSessions && (
							<p className="text-xs text-muted-foreground mt-1">Loading sessions...</p>
						)}
						{sessions.length === 0 && !loadingSessions && (
							<p className="text-xs text-muted-foreground mt-1">
								No upcoming interview sessions found.
							</p>
						)}
					</div>

					<div>
						<Label>Team Members</Label>
						{loadingSessions ? (
							<div className="space-y-2 mt-2">
								<div className="h-10 w-full rounded bg-muted animate-pulse" />
								<div className="h-10 w-full rounded bg-muted animate-pulse" />
							</div>
						) : team.length === 0 ? (
							<p className="text-xs text-muted-foreground mt-1">
								No team members available. Add team members first.
							</p>
						) : (
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-h-60 overflow-y-auto">
								{team.map((member) => (
									<button type="button"
										key={member.id}
										onClick={() => toggleMember(member.id)}
										className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-colors min-h-[44px] ${
											selectedMembers.includes(member.id)
												? 'border-indigo-500 bg-indigo-50'
												: 'border-border hover:bg-muted/50'
										}`}
									>
										<div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-medium text-indigo-700 shrink-0">
											{member.name?.charAt(0)?.toUpperCase() || '?'}
										</div>
										<div className="flex-1 min-w-0">
											<p className="text-sm font-medium truncate">{member.name}</p>
											<p className="text-xs text-muted-foreground truncate">{member.email}</p>
										</div>
										{selectedMembers.includes(member.id) && (
											<CheckCircle className="h-4 w-4 text-indigo-600 shrink-0" />
										)}
									</button>
								))}
							</div>
						)}
					</div>

					<div className="flex gap-2 justify-end pt-2">
						<Button
							variant="outline"
							onClick={() => {
								setShowCreate(false);
								resetCreateForm();
							}}
							className="min-h-[44px]"
						>
							Cancel
						</Button>
						<Button
							onClick={createPanel}
							disabled={creating || !createJobId}
							className="min-h-[44px]"
						>
							{creating ? 'Creating...' : 'Create Panel'}
						</Button>
					</div>
				</div>
			</Dialog>

			{/* View panel members dialog */}
			<Dialog open={!!viewPanel} onClose={() => setViewPanel(null)}>
				<DialogHeader>
					<DialogTitle>Panel Members</DialogTitle>
					<DialogDescription>
						{viewPanel && `Panel #${viewPanel.id} — ${viewPanel.job_title}`}
					</DialogDescription>
				</DialogHeader>
				<div className="mt-4 space-y-2 max-h-[60vh] overflow-y-auto">
					{loadingMembers ? (
						<div className="space-y-2">
							<div className="h-12 w-full rounded bg-muted animate-pulse" />
							<div className="h-12 w-full rounded bg-muted animate-pulse" />
						</div>
					) : panelMembers.length === 0 ? (
						<p className="text-sm text-muted-foreground">No members in this panel.</p>
					) : (
						panelMembers.map((member: any) => {
							const role = roleBadge[member.role] || roleBadge.panelist;
							return (
								<div key={member.id} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
									<div className="h-9 w-9 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-medium text-indigo-700 shrink-0">
										{member.name?.charAt(0)?.toUpperCase() || '?'}
									</div>
									<div className="flex-1 min-w-0">
										<p className="text-sm font-medium">{member.name}</p>
										<p className="text-xs text-muted-foreground">{member.email}</p>
									</div>
									<Badge className={`text-xs ${role.color}`}>{role.label}</Badge>
									<Badge
										variant={member.status === 'joined' ? 'success' : 'secondary'}
										className="text-xs"
									>
										{member.status}
									</Badge>
								</div>
							);
						})
					)}
				</div>
				<div className="flex justify-end mt-4">
					<Button variant="outline" onClick={() => setViewPanel(null)} className="min-h-[44px]">
						Close
					</Button>
				</div>
			</Dialog>

			{/* Delete confirmation */}
			<Dialog open={!!showDelete} onClose={() => setShowDelete(null)}>
				<DialogHeader>
					<DialogTitle>Delete Panel</DialogTitle>
					<DialogDescription>
						Are you sure you want to delete panel #{showDelete?.id}? This action cannot be undone.
					</DialogDescription>
				</DialogHeader>
				<div className="flex gap-2 justify-end mt-4">
					<Button variant="outline" onClick={() => setShowDelete(null)} className="min-h-[44px]">
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={deletePanel}
						disabled={deleting}
						className="min-h-[44px]"
					>
						{deleting ? 'Deleting...' : 'Delete'}
					</Button>
				</div>
			</Dialog>
		</div>
	);
}
