import React from 'react'
import type React from 'react'

export type LogoSize = 'sm' | 'md' | 'lg' | 'xl'

interface LogoProps {
	size?: LogoSize
	className?: string
}

const sizeMap: Record<LogoSize, number> = {
	sm: 24,
	md: 32,
	lg: 40,
	xl: 48,
}

export const Logo: React.FC<LogoProps> = ({ size = 'md', className = '' }) => {
	const s = sizeMap[size]
	const strokeWidth = s / 24

	return (
		<svg
			width={s}
			height={s}
			viewBox='0 0 48 48'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
			className={className}
			aria-label='Rekrut AI logo'
		>
			{/* Outer geometric R shape */}
			<path
				d='M8 40V8h14c5.523 0 10 4.477 10 10 0 3.5-1.8 6.6-4.5 8.4L34 40h-6l-5.5-11.5H14V40H8z'
				stroke='currentColor'
				strokeWidth={strokeWidth}
				strokeLinecap='round'
				strokeLinejoin='round'
				fill='none'
			/>

			{/* Inner horizontal bar of R */}
			<path
				d='M14 20.5h8c2.485 0 4.5-2.015 4.5-4.5S24.485 11.5 22 11.5H14v9z'
				stroke='currentColor'
				strokeWidth={strokeWidth}
				strokeLinecap='round'
				strokeLinejoin='round'
				fill='none'
			/>

			{/* AI circuit dot — top right node */}
			<circle cx='36' cy='12' r='2.5' stroke='currentColor' strokeWidth={strokeWidth} fill='none' />

			{/* AI circuit dot — middle right node */}
			<circle cx='40' cy='24' r='2' stroke='currentColor' strokeWidth={strokeWidth} fill='none' />

			{/* AI circuit dot — bottom right node */}
			<circle cx='36' cy='36' r='2.5' stroke='currentColor' strokeWidth={strokeWidth} fill='none' />

			{/* Circuit lines connecting nodes to the R */}
			<path
				d='M32 12h2M32 24h6M32 36h2'
				stroke='currentColor'
				strokeWidth={strokeWidth}
				strokeLinecap='round'
			/>

			{/* Vertical circuit backbone */}
			<path
				d='M36 14.5v5.5M36 26v8'
				stroke='currentColor'
				strokeWidth={strokeWidth}
				strokeLinecap='round'
			/>
		</svg>
	)
}

export default Logo
