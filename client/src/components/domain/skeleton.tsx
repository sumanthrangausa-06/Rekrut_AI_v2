import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type SkeletonProps = {
	count?: number;
	variant?: 'card' | 'list' | 'table' | 'text' | 'avatar';
	className?: string;
};

function CardSkeleton() {
	return (
		<Card className="overflow-hidden">
			<CardHeader className="pb-2">
				<div className="flex items-center gap-3">
					<div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
					<div className="space-y-2 flex-1">
						<div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
						<div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="h-3 w-full rounded bg-muted animate-pulse" />
				<div className="h-3 w-5/6 rounded bg-muted animate-pulse" />
				<div className="flex gap-1.5">
					<div className="h-5 w-16 rounded bg-muted animate-pulse" />
					<div className="h-5 w-20 rounded bg-muted animate-pulse" />
					<div className="h-5 w-14 rounded bg-muted animate-pulse" />
				</div>
			</CardContent>
		</Card>
	);
}

function ListSkeleton() {
	return (
		<div className="space-y-3">
			<div className="h-14 w-full rounded-lg bg-muted animate-pulse" />
			<div className="h-14 w-full rounded-lg bg-muted animate-pulse" />
			<div className="h-14 w-full rounded-lg bg-muted animate-pulse" />
		</div>
	);
}

function TableSkeleton() {
	return (
		<div className="space-y-2">
			<div className="h-8 w-full rounded bg-muted animate-pulse" />
			<div className="h-12 w-full rounded bg-muted animate-pulse" />
			<div className="h-12 w-full rounded bg-muted animate-pulse" />
			<div className="h-12 w-full rounded bg-muted animate-pulse" />
			<div className="h-12 w-full rounded bg-muted animate-pulse" />
		</div>
	);
}

function TextSkeleton() {
	return (
		<div className="space-y-2">
			<div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
			<div className="h-4 w-full rounded bg-muted animate-pulse" />
			<div className="h-4 w-5/6 rounded bg-muted animate-pulse" />
			<div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
		</div>
	);
}

function AvatarSkeleton() {
	return (
		<div className="flex items-center gap-3">
			<div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
			<div className="space-y-2">
				<div className="h-4 w-24 rounded bg-muted animate-pulse" />
				<div className="h-3 w-16 rounded bg-muted animate-pulse" />
			</div>
		</div>
	);
}

export function Skeleton({ count = 1, variant = 'card', className }: SkeletonProps) {
	const items = Array.from({ length: count });

	return (
		<div className={cn('space-y-4', className)}>
			{items.map((_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder
				<div key={i}>
					{variant === 'card' && <CardSkeleton />}
					{variant === 'list' && <ListSkeleton />}
					{variant === 'table' && <TableSkeleton />}
					{variant === 'text' && <TextSkeleton />}
					{variant === 'avatar' && <AvatarSkeleton />}
				</div>
			))}
		</div>
	);
}
