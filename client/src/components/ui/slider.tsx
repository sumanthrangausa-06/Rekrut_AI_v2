import * as React from 'react'
import { cn } from '@/lib/utils'

interface SliderProps {
	value?: number[]
	defaultValue?: number[]
	min?: number
	max?: number
	step?: number
	onValueChange?: (value: number[]) => void
	className?: string
	label?: string
	formatLabel?: (value: number) => string
}

const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
	(
		{
			className,
			value,
			defaultValue,
			min = 0,
			max = 100,
			step = 1,
			onValueChange,
			label,
			formatLabel,
		},
		ref,
	) => {
		const [internalValue, setInternalValue] = React.useState(defaultValue || [min])
		const currentValue = value || internalValue
		const singleValue = currentValue[0] ?? min

		const percentage = ((singleValue - min) / (max - min)) * 100

		const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
			const newValue = parseFloat(e.target.value)
			const newArr = [newValue]
			if (value === undefined) setInternalValue(newArr)
			onValueChange?.(newArr)
		}

		return (
			<div ref={ref} className={cn('w-full space-y-2', className)}>
				{label && (
					<div className='flex items-center justify-between'>
						<span className='text-sm font-medium'>{label}</span>
						<span className='text-sm text-muted-foreground'>
							{formatLabel ? formatLabel(singleValue) : singleValue}
						</span>
					</div>
				)}
				<div className='relative h-2 w-full'>
					<div className='absolute h-2 w-full rounded-full bg-secondary' />
					<div
						className='absolute h-2 rounded-full bg-primary'
						style={{ width: `${percentage}%` }}
					/>
					<input
						type='range'
						min={min}
						max={max}
						step={step}
						value={singleValue}
						onChange={handleChange}
						className='absolute inset-0 h-full w-full cursor-pointer opacity-0'
					/>
					<div
						className='absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow cursor-pointer'
						style={{ left: `calc(${percentage}% - 8px)` }}
					/>
				</div>
				<div className='flex justify-between text-xs text-muted-foreground'>
					<span>{formatLabel ? formatLabel(min) : min}</span>
					<span>{formatLabel ? formatLabel(max) : max}</span>
				</div>
			</div>
		)
	},
)
Slider.displayName = 'Slider'

export { Slider }
