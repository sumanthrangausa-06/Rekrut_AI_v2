import React from 'react'
import * as React from 'react'
import { cn } from '@/lib/utils'

interface TooltipProps {
	children: React.ReactNode
	content: React.ReactNode
	side?: 'top' | 'bottom' | 'left' | 'right'
	className?: string
	delay?: number
}

function Tooltip({ children, content, side = 'top', className, delay = 300 }: TooltipProps) {
	const [visible, setVisible] = React.useState(false)
	const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
	const containerRef = React.useRef<HTMLDivElement>(null)

	const show = () => {
		if (timeoutRef.current) clearTimeout(timeoutRef.current)
		timeoutRef.current = setTimeout(() => setVisible(true), delay)
	}
	const hide = () => {
		if (timeoutRef.current) clearTimeout(timeoutRef.current)
		setVisible(false)
	}

	const sideClasses = {
		top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
		bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
		left: 'right-full top-1/2 -translate-y-1/2 mr-2',
		right: 'left-full top-1/2 -translate-y-1/2 ml-2',
	}

	const _arrowClasses = {
		top: 'top-full left-1/2 -translate-x-1/2 -mt-1 border-l-transparent border-r-transparent border-b-transparent',
		bottom:
			'bottom-full left-1/2 -translate-x-1/2 -mb-1 border-l-transparent border-r-transparent border-t-transparent',
		left: 'left-full top-1/2 -translate-y-1/2 -ml-1 border-t-transparent border-b-transparent border-r-transparent',
		right:
			'right-full top-1/2 -translate-y-1/2 -mr-1 border-t-transparent border-b-transparent border-l-transparent',
	}

	return (
		<div
			ref={containerRef}
			className='relative inline-flex'
			onMouseEnter={show}
			onMouseLeave={hide}
			onFocus={show}
			onBlur={hide}
		>
			{children}
			{visible && (
				<div className={cn('absolute z-50 max-w-xs', sideClasses[side], className)}>
					<div className='rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-lg'>
						{content}
					</div>
				</div>
			)}
		</div>
	)
}

export { Tooltip }
