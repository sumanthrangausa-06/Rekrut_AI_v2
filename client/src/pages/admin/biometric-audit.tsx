/**
 * Biometric Audit Log Viewer — S-065 (#715).
 *
 * Read UI for the S-014 append-only biometric audit trail.
 * Access: admin + hiring_manager (enforced server-side at
 * GET /api/admin/biometric-audit; this page is routed behind a
 * role-aware guard in App.tsx).
 *
 * Privacy:
 * - The API returns display-level pseudonyms (candidate_ref); the raw
 *   candidate_id is never rendered.
 * - The read path performs no JOIN to users — no names/emails are
 *   available to this page by design.
 */
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { apiCall } from '@/lib/api';

export type AuditEntry = {
	id: number;
	accessed_at: string;
	user_id: number;
	user_role: string;
	action: 'view' | 'export' | 'delete' | 'purge';
	data_type: string;
	/** Display-level pseudonym (S-065). Raw candidate_id is never exposed. */
	candidate_ref: string;
	/** Only present for admin viewers (privacy review M1). */
	ip_address?: string | null;
};

type AuditResponse = {
	success: boolean;
	entries: AuditEntry[];
	total: number;
	limit: number;
	offset: number;
};

const ACTIONS = ['view', 'export', 'delete', 'purge'] as const;
const PAGE_SIZE = 50;

const ACTION_BADGE: Record<AuditEntry['action'], string> = {
	view: 'bg-blue-100 text-blue-800',
	export: 'bg-amber-100 text-amber-800',
	delete: 'bg-red-100 text-red-800',
	purge: 'bg-purple-100 text-purple-800',
};

export function BiometricAuditPage() {
	const [entries, setEntries] = useState<AuditEntry[]>([]);
	const [total, setTotal] = useState(0);
	const [offset, setOffset] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Filter inputs (applied on "Apply filters")
	const [candidateId, setCandidateId] = useState('');
	const [action, setAction] = useState('');
	const [dataType, setDataType] = useState('');
	const [startDate, setStartDate] = useState('');
	const [endDate, setEndDate] = useState('');

	const fetchEntries = useCallback(
		async (nextOffset: number) => {
			setLoading(true);
			setError(null);
			try {
				const params = new URLSearchParams({
					limit: String(PAGE_SIZE),
					offset: String(nextOffset),
				});
				if (candidateId.trim()) params.set('candidate_id', candidateId.trim());
				if (action) params.set('action', action);
				if (dataType.trim()) params.set('data_type', dataType.trim());
				if (startDate) params.set('start_date', startDate);
				if (endDate) params.set('end_date', endDate);

				const res = await apiCall<AuditResponse>(`/admin/biometric-audit?${params.toString()}`);
				setEntries(res.entries);
				setTotal(res.total);
				setOffset(nextOffset);
			} catch (e) {
				setError(e instanceof Error ? e.message : 'Failed to load audit entries');
				setEntries([]);
			} finally {
				setLoading(false);
			}
		},
		[action, candidateId, dataType, endDate, startDate],
	);

	useEffect(() => {
		fetchEntries(0);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const applyFilters = () => fetchEntries(0);

	// Clear re-fetches with empty filters (state updates are async, so fetch
	// directly rather than relying on the cleared state).
	const clearFilters = () => {
		setCandidateId('');
		setAction('');
		setDataType('');
		setStartDate('');
		setEndDate('');
		setLoading(true);
		setError(null);
		apiCall<AuditResponse>(`/admin/biometric-audit?limit=${PAGE_SIZE}&offset=0`)
			.then((res) => {
				setEntries(res.entries);
				setTotal(res.total);
				setOffset(0);
			})
			.catch((e: unknown) => {
				setError(e instanceof Error ? e.message : 'Failed to load audit entries');
				setEntries([]);
			})
			.finally(() => setLoading(false));
	};

	const hasNext = offset + PAGE_SIZE < total;
	const hasPrev = offset > 0;

	return (
		<div className="min-h-dvh-safe bg-slate-50 p-4 md:p-8">
			<div className="mx-auto max-w-6xl space-y-6">
				<div className="flex items-center gap-3">
					<ShieldCheck className="h-6 w-6 text-slate-700" />
					<div>
						<h1 className="text-xl font-semibold text-slate-900">Biometric Audit Log</h1>
						<p className="text-sm text-slate-500">
							Append-only record of biometric data access. Candidate references are
							pseudonymized.
						</p>
					</div>
				</div>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">Filters</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
							<div className="space-y-1.5">
								<Label htmlFor="audit-candidate">Candidate ID</Label>
								<Input
									id="audit-candidate"
									placeholder="e.g. 42"
									inputMode="numeric"
									value={candidateId}
									onChange={(e) => setCandidateId(e.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="audit-action">Action</Label>
								<select
									id="audit-action"
									aria-label="Action"
									value={action}
									onChange={(e) => setAction(e.target.value)}
									className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								>
									<option value="">All actions</option>
									{ACTIONS.map((a) => (
										<option key={a} value={a}>
											{a}
										</option>
									))}
								</select>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="audit-datatype">Data type</Label>
								<Input
									id="audit-datatype"
									placeholder="e.g. face_embedding"
									value={dataType}
									onChange={(e) => setDataType(e.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="audit-start">Start date</Label>
								<Input
									id="audit-start"
									type="date"
									value={startDate}
									onChange={(e) => setStartDate(e.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="audit-end">End date</Label>
								<Input
									id="audit-end"
									type="date"
									value={endDate}
									onChange={(e) => setEndDate(e.target.value)}
								/>
							</div>
						</div>
						<div className="mt-4 flex gap-2">
							<Button onClick={applyFilters}>Apply filters</Button>
							<Button variant="outline" onClick={clearFilters}>
								Clear
							</Button>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">
							Entries {total > 0 && <span className="font-normal text-slate-500">({total})</span>}
						</CardTitle>
					</CardHeader>
					<CardContent>
						{loading ? (
							<p className="py-8 text-center text-sm text-slate-500">Loading audit entries…</p>
						) : error ? (
							<p className="py-8 text-center text-sm text-red-600">
								Failed to load audit entries: {error}
							</p>
						) : entries.length === 0 ? (
							<p className="py-8 text-center text-sm text-slate-500">
								No audit entries match the current filters.
							</p>
						) : (
							<>
								<div className="overflow-x-auto">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Timestamp</TableHead>
												<TableHead>Actor</TableHead>
												<TableHead>Action</TableHead>
												<TableHead>Data type</TableHead>
												<TableHead>Candidate</TableHead>
												<TableHead>IP</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{entries.map((entry) => (
												<TableRow key={entry.id}>
													<TableCell className="whitespace-nowrap text-xs">
														{new Date(entry.accessed_at).toLocaleString()}
													</TableCell>
													<TableCell>
														<span className="text-xs text-slate-600">#{entry.user_id}</span>{' '}
														<Badge variant="outline" className="text-[10px]">
															{entry.user_role}
														</Badge>
													</TableCell>
													<TableCell>
														<Badge className={ACTION_BADGE[entry.action]}>{entry.action}</Badge>
													</TableCell>
													<TableCell className="text-xs">{entry.data_type}</TableCell>
													<TableCell className="font-mono text-xs">
														{entry.candidate_ref}
													</TableCell>
													<TableCell className="text-xs text-slate-500">
														{entry.ip_address ?? '—'}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
								<div className="mt-4 flex items-center justify-between">
									<p className="text-xs text-slate-500">
										Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
									</p>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											disabled={!hasPrev}
											onClick={() => fetchEntries(offset - PAGE_SIZE)}
										>
											Previous
										</Button>
										<Button
											variant="outline"
											size="sm"
											disabled={!hasNext}
											onClick={() => fetchEntries(offset + PAGE_SIZE)}
										>
											Next
										</Button>
									</div>
								</div>
							</>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
