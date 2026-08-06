import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export interface ScoreRingProps {
	score: number
	size?: 'sm' | 'md' | 'lg'
	showLabel?: boolean
	label?: string
	className?: string
	animate?: boolean
}

const SIZE_MAP = {
	sm: { ring: 40, stroke: 3.5, font: 'text-[10px]', labelFont: 'text-[9px]' },
	md: { ring: 56, stroke: 4, font: 'text-xs', labelFont: 'text-[10px]' },
	lg: { ring: 72, stroke: 5, font: 'text-sm', labelFont: 'text-xs' },
}

const COLOR_MAP = {
	green: {
		stroke: '#22c55e',
		strokeDark: '#4ade80',
		bg: 'bg-green-50 dark:bg-green-900/20',
		text: 'text-green-700 dark:text-green-400',
	},
	amber: {
		stroke: '#f59e0b',
		strokeDark: '#fbbf24',
		bg: 'bg-amber-50 dark:bg-amber-900/20',
		text: 'text-amber-700 dark:text-amber-400',
	},
	red: {
		stroke: '#ef4444',
		strokeDark: '#f87171',
		bg: 'bg-red-50 dark:bg-red-900/20',
		text: 'text-red-700 dark:text-red-400',
	},
}

function getColorKey(score: number): keyof typeof COLOR_MAP {
	if (score >= 80) return 'green'
	if (score >= 60) return 'amber'
	return 'red'
}

export function ScoreRing({
	score,
	size = 'md',
	showLabel = false,
	label,
	className,
	animate = true,
}: ScoreRingProps) {
	const [displayedScore, setDisplayedScore] = useState(animate ? 0 : score)
	const [hasAnimated, setHasAnimated] = useState(false)

	const { ring, stroke, font, labelFont } = SIZE_MAP[size]
	const colorKey = getColorKey(score)
	const colors = COLOR_MAP[colorKey]

	const radius = (ring - stroke) / 2
	const circumference = 2 * Math.PI * radius
	const clampedScore = Math.max(0, Math.min(100, score))
	const progress = circumference - (clampedScore / 100) * circumference

	// Animate from 0 to score on first mount
	useEffect(() => {
		if (!animate || hasAnimated) {
			setDisplayedScore(score)
			return
		}

		const duration = 800
		const startTime = performance.now()

		const tick = (now: number) => {
			const elapsed = now - startTime
			const progress = Math.min(elapsed / duration, 1)
			// Ease-out cubic
			const eased = 1 - Math.pow(1 - progress, 3)
			setDisplayedScore(Math.round(eased * score))
			if (progress < 1) {
				requestAnimationFrame(tick)
			} else {
				setHasAnimated(true)
			}
		}

		requestAnimationFrame(tick)
	}, [score, animate, hasAnimated])

	// Reset animation when score prop changes meaningfully
	useEffect(() => {
		if (score !== displayedScore && !hasAnimated) {
			setDisplayedScore(animate ? 0 : score)
		}
	}, [score])

	return (
		<div
			className={cn(
				'inline-flex flex-col items-center justify-center',
				className,
			)}
			role='img'
			aria-label={`Match score: ${score} percent`}
		>
			<div className='relative' style={{ width: ring, height: ring }}>
				<svg
					width={ring}
					height={ring}
					viewBox={`0 0 ${ring} ${ring}`}
					className='transform -rotate-90'
				>
					{/* Background track */}
					<circle
						cx={ring / 2}
						cy={ring / 2}
						r={radius}
						fill='none'
						stroke='currentColor'
						className='text-muted-foreground/15'
						strokeWidth={stroke}
					/>
					{/* Progress arc */}
					<circle
						cx={ring / 2}
						cy={ring / 2}
						r={radius}
						fill='none'
						stroke={colors.stroke}
						strokeWidth={stroke}
						strokeLinecap='round'
						strokeDasharray={circumference}
						strokeDashoffset={animate ? circumference - (displayedScore / 100) * circumference : progress}
						className='transition-[stroke-dashoffset] duration-75'
						style={{
							filter: `drop-shadow(0 0 2px ${colors.stroke}40)`,
						}}
					/>
				</svg>
				{/* Centered score text */}
				<div className='absolute inset-0 flex items-center justify-center'>
					<span className={cn('font-bold leading-none', font, colors.text)}>
						{displayedScore}
					</span>
				</div>
			</div>
			{showLabel && label && (
				<span className={cn('font-medium mt-0.5', labelFont, colors.text)}>{label}</span>
			)}
		</div>
	)
}
