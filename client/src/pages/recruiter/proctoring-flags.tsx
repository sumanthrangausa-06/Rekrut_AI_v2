import {
	AlertCircle,
	CheckCircle,
	Clock,
	Eye,
	Filter,
	Flag,
	Loader2,
	Search,
	Shield,
	User,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiCall } from '@/lib/api';

interface FlaggedSession {
	flag_id: number;
	flag_type: string;
	description: string;
	severity: string;
	review_decision: string;
	flagged_at: string;
	session_id: number;
	session_status: string;
	started_at: string | null;
	ended_at: string | null;
	candidate_id: number;
	candidate_name: string;
	candidate_email: string;
	job_id: number | null;
	job_title: string | null;
}

export function RecruiterProctoringFlagsPage() {
	const navigate = useNavigate();
	const [flags, setFlags] = useState<FlaggedSession[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [filterStatus, setFilterStatus] = useState('pending');
	const [searchQuery, setSearchQuery] = useState('');
	const [total, setTotal] = useState(0);
	const [offset, setOffset] = useState(0);
	const limit = 20;

	const loadFlags = useCallback(async () => {
		try {
			setLoading(true);
			const data = await apiCall<{
				success: boolean;
				flags: FlaggedSession[];
				total: number;
				limit: number;
				offset: number;
			}>(`/proctoring/flags?status=${filterStatus}&limit=${limit}&offset=${offset}`);
			setFlags(data.flags);
			setTotal(data.total);
		} catch (err: unknown) {
			setError(err.message || 'Failed to load flags');
		} finally {
			setLoading(false);
		}
	}, [filterStatus, offset]);

	useEffect(() => {
		setOffset(0);
	}, []);

	useEffect(() => {
		loadFlags();
	}, [loadFlags]);

	const filteredFlags = flags.filter((f) => {
		if (!searchQuery.trim()) return true;
		const q = searchQuery.toLowerCase();
		return (
			f.candidate_name?.toLowerCase().includes(q) ||
			f.candidate_email?.toLowerCase().includes(q) ||
			f.job_title?.toLowerCase().includes(q) ||
			f.flag_type.toLowerCase().includes(q)
		);
	});

	function severityBadge(severity: string) {
		switch (severity) {
			case 'high':
				return <Badge className="bg-red-100 text-red-700 border-red-200">High</Badge>;
			case 'medium':
				return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Medium</Badge>;
			default:
				return <Badge className="bg-slate-100 text-slate-600 border-slate-200">Low</Badge>;
		}
	}

	function decisionBadge(decision: string) {
		switch (decision) {
			case 'approved':
				return (
					<Badge className="bg-green-100 text-green-700 border-green-200">
						<CheckCircle className="w-3 h-3 mr-1" /> Approved
					</Badge>
				);
			case 'rejected':
				return (
					<Badge className="bg-red-100 text-red-700 border-red-200">
						<AlertCircle className="w-3 h-3 mr-1" /> Rejected
					</Badge>
				);
			default:
				return (
					<Badge className="bg-amber-100 text-amber-700 border-amber-200">
						<Clock className="w-3 h-3 mr-1" /> Pending
					</Badge>
				);
		}
	}

	return (
		<div className="p-4 sm:p-6 lg:p-8 space-y-6">
			{/* Header */}
			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold text-slate-900">Proctoring Review Queue</h1>
					<p className="text-sm text-slate-500 mt-1">
						Review flagged proctoring sessions. Never auto-reject — always human review.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Shield className="w-5 h-5 text-indigo-600" />
					<span className="text-sm font-medium text-indigo-700">
						{total} flagged session{total !== 1 ? 's' : ''} total
					</span>
				</div>
			</div>

			{/* Filters */}
			<Card>
				<CardContent className="p-4">
					<div className="flex flex-col sm:flex-row gap-3">
						<div className="relative flex-1">
							<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
							<Input
								placeholder="Search by candidate, job, or flag type..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-9"
							/>
						</div>
						<div className="flex items-center gap-2">
							<Filter className="w-4 h-4 text-slate-400" />
							<div className="flex rounded-lg border overflow-hidden">
								{[
									{ key: 'pending', label: 'Pending' },
									{ key: 'approved', label: 'Approved' },
									{ key: 'rejected', label: 'Rejected' },
									{ key: 'all', label: 'All' },
								].map((tab) => (
									<button type="button"
										key={tab.key}
										onClick={() => setFilterStatus(tab.key)}
										className={`px-3 py-1.5 text-sm font-medium transition-colors ${
											filterStatus === tab.key
												? 'bg-indigo-600 text-white'
												: 'bg-white text-slate-600 hover:bg-slate-50'
										}`}
									>
										{tab.label}
									</button>
								))}
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{error && (
				<div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-start gap-3">
					<AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
					{error}
				</div>
			)}

			{/* Flags list */}
			{loading ? (
				<div className="flex items-center justify-center py-16">
					<Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
				</div>
			) : filteredFlags.length === 0 ? (
				<Card>
					<CardContent className="p-12 text-center space-y-4">
						<Shield className="w-12 h-12 text-slate-300 mx-auto" />
						<h3 className="text-lg font-medium text-slate-900">No flagged sessions</h3>
						<p className="text-sm text-slate-500">
							{filterStatus === 'pending'
								? 'All clear! No sessions are awaiting review.'
								: 'No sessions match the current filter.'}
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="space-y-3">
					{filteredFlags.map((flag) => (
						<Card
							key={flag.flag_id}
							className="hover:shadow-md transition-shadow cursor-pointer"
							onClick={() => navigate(`/recruiter/proctoring/${flag.flag_id}`)}
						>
							<CardContent className="p-4 sm:p-5">
								<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
									<div className="flex-1 min-w-0 space-y-2">
										<div className="flex items-center gap-2 flex-wrap">
											{severityBadge(flag.severity)}
											{decisionBadge(flag.review_decision)}
											<Badge variant="outline" className="capitalize">
												<Flag className="w-3 h-3 mr-1" />
												{flag.flag_type.replace(/_/g, ' ')}
											</Badge>
										</div>
										<div className="flex items-center gap-4 text-sm text-slate-600">
											<span className="flex items-center gap-1">
												<User className="w-3.5 h-3.5" />
												{flag.candidate_name || flag.candidate_email}
											</span>
											{flag.job_title && (
												<span className="truncate max-w-[200px]">{flag.job_title}</span>
											)}
										</div>
										<p className="text-sm text-slate-500">{flag.description}</p>
									</div>
									<div className="flex items-center gap-3 text-xs text-slate-400 flex-shrink-0">
										<span className="flex items-center gap-1">
											<Clock className="w-3 h-3" />
											{new Date(flag.flagged_at).toLocaleDateString()}
										</span>
										<Eye className="w-4 h-4 text-indigo-600" />
									</div>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			{/* Pagination */}
			{!loading && total > limit && (
				<div className="flex items-center justify-between">
					<Button
						variant="outline"
						disabled={offset === 0}
						onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
					>
						Previous
					</Button>
					<span className="text-sm text-slate-500">
						{offset + 1}–{Math.min(offset + limit, total)} of {total}
					</span>
					<Button
						variant="outline"
						disabled={offset + limit >= total}
						onClick={() => setOffset((prev) => prev + limit)}
					>
						Next
					</Button>
				</div>
			)}
		</div>
	);
}
