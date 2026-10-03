import { CheckCircle, Clock, Mail, Shield, User, XCircle } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface JoinRequest {
	id: number;
	user_id: number;
	company_id: number;
	email: string;
	domain: string;
	status: 'pending' | 'approved' | 'rejected';
	requested_at: string;
	user_name: string;
	role?: string;
}

interface JoinRequestCardProps {
	request: JoinRequest;
	onApprove: (id: number) => void;
	onReject: (id: number) => void;
	isProcessing?: boolean;
}

function timeAgo(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);
	if (mins < 1) return 'Just now';
	if (mins < 60) return `${mins}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days === 1) return 'Yesterday';
	if (days < 7) return `${days} days ago`;
	return `${Math.floor(days / 7)}w ago`;
}

function formatDate(dateStr: string): string {
	const d = new Date(dateStr);
	return d.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

export function JoinRequestCard({
	request,
	onApprove,
	onReject,
	isProcessing,
}: JoinRequestCardProps) {
	const initials = request.user_name
		.split(' ')
		.map((n) => n[0])
		.join('')
		.toUpperCase()
		.slice(0, 2);

	const roleLabel = request.role || 'Recruiter';

	return (
		<Card className="overflow-hidden transition-shadow hover:shadow-md">
			<CardContent className="p-4 sm:p-5">
				<div className="flex flex-col sm:flex-row sm:items-start gap-4">
					{/* Avatar */}
					<Avatar size="lg" fallback={initials} seed={request.user_id}>
						<AvatarFallback className="bg-indigo-100 text-indigo-600">{initials}</AvatarFallback>
					</Avatar>

					{/* Info */}
					<div className="flex-1 min-w-0 space-y-1">
						<div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
							<h3 className="font-semibold text-base truncate">{request.user_name}</h3>
							<Badge
								variant="outline"
								className="w-fit text-xs border-amber-200 bg-amber-50 text-amber-700"
							>
								<Clock className="h-3 w-3 mr-1" />
								Pending
							</Badge>
						</div>

						<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
							<span className="flex items-center gap-1.5">
								<Mail className="h-3.5 w-3.5 shrink-0" />
								<span className="truncate">{request.email}</span>
							</span>
							<span className="flex items-center gap-1.5">
								<Shield className="h-3.5 w-3.5 shrink-0" />
								<span className="capitalize">{roleLabel}</span>
							</span>
							<span className="flex items-center gap-1.5">
								<User className="h-3.5 w-3.5 shrink-0" />
								<span className="truncate" title={formatDate(request.requested_at)}>
									{timeAgo(request.requested_at)}
								</span>
							</span>
						</div>

						<p className="text-xs text-muted-foreground/70">
							Requested on {formatDate(request.requested_at)}
						</p>
					</div>

					{/* Actions */}
					<div className="flex sm:flex-col gap-2 shrink-0 sm:ml-2">
						<Button
							size="sm"
							className={cn(
								'gap-1 min-h-[40px] bg-indigo-600 hover:bg-indigo-700',
								isProcessing && 'opacity-60 cursor-not-allowed',
							)}
							onClick={() => onApprove(request.id)}
							disabled={isProcessing}
						>
							<CheckCircle className="h-4 w-4" />
							Approve
						</Button>
						<Button
							variant="outline"
							size="sm"
							className={cn(
								'gap-1 min-h-[40px] border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700',
								isProcessing && 'opacity-60 cursor-not-allowed',
							)}
							onClick={() => onReject(request.id)}
							disabled={isProcessing}
						>
							<XCircle className="h-4 w-4" />
							Reject
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
