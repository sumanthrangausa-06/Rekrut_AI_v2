import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type EmptyStateProps = {
	icon: LucideIcon
	title: string
	description: string
	action?: {
		label: string
		onClick?: () => void
		href?: string
	}
	className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
	return (
		<div
			className={cn('flex flex-col items-center justify-center text-center py-12 px-4', className)}
		>
			<div className='flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-4'>
				<Icon className='h-8 w-8 text-muted-foreground' />
			</div>
			<h3 className='font-semibold text-lg mb-1'>{title}</h3>
			<p className='text-sm text-muted-foreground max-w-sm mb-4'>{description}</p>
			{action && (
				<Button size='sm' onClick={action.onClick} asChild={!!action.href}>
					{action.href ? <a href={action.href}>{action.label}</a> : action.label}
				</Button>
			)}
		</div>
	)
}
