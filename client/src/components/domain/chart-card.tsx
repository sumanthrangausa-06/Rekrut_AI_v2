import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type ChartCardProps = {
	title: string
	value: string | number
	subtitle?: string
	trend?: 'up' | 'down' | 'neutral'
	trendValue?: string
	icon?: React.ReactNode
	className?: string
}

export function ChartCard({
	title,
	value,
	subtitle,
	trend,
	trendValue,
	icon,
	className,
}: ChartCardProps) {
	const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
	const trendColor =
		trend === 'up'
			? 'text-green-600 dark:text-green-400'
			: trend === 'down'
				? 'text-red-600 dark:text-red-400'
				: 'text-muted-foreground'

	return (
		<Card className={cn('overflow-hidden', className)}>
			<CardHeader className='pb-2 flex flex-row items-start justify-between'>
				<CardTitle className='text-sm font-medium text-muted-foreground'>{title}</CardTitle>
				{icon && <div className='text-muted-foreground'>{icon}</div>}
			</CardHeader>
			<CardContent>
				<div className='text-2xl font-bold tracking-tight'>{value}</div>
				{(trend || subtitle) && (
					<div className='flex items-center gap-1 mt-1 text-xs'>
						{trend && (
							<span className={cn('flex items-center gap-0.5 font-medium', trendColor)}>
								<TrendIcon className='h-3 w-3' />
								{trendValue}
							</span>
						)}
						{subtitle && <span className='text-muted-foreground'>{subtitle}</span>}
					</div>
				)}
			</CardContent>
		</Card>
	)
}
