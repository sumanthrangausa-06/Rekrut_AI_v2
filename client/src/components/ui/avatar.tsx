import * as React from 'react'
import { getDiceBearAvatar, getUserAvatar } from '@/lib/avatar'
import { cn } from '@/lib/utils'

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
	src?: string | null
	alt?: string
	fallback?: string
	seed?: string | number // DiceBear seed — used when no src provided
	size?: 'sm' | 'md' | 'lg'
	useDiceBear?: boolean // Whether to use DiceBear fallback instead of initials
	user?: { id?: string | number; email?: string; name?: string; avatar_url?: string | null }
}

const sizeMap = {
	sm: 'h-8 w-8 text-xs',
	md: 'h-10 w-10 text-sm',
	lg: 'h-12 w-12 text-base',
}

function Avatar({
	src,
	alt,
	fallback,
	seed,
	size = 'md',
	useDiceBear = true,
	user,
	className,
	children,
	...props
}: AvatarProps) {
	const [imgError, setImgError] = React.useState(false)

	const initials = (fallback || '')
		.split(' ')
		.map((n) => n[0])
		.join('')
		.toUpperCase()
		.slice(0, 2)

	// ponytail: prefer getUserAvatar when user object is available
	const userSrc = user ? getUserAvatar(user) : null
	const effectiveSrc = userSrc || src

	// Generate DiceBear avatar if no src or useDiceBear is enabled
	const diceBearSrc = seed ? getDiceBearAvatar(String(seed)) : null
	const showSrc = effectiveSrc && !imgError ? effectiveSrc : useDiceBear ? diceBearSrc : null

	return (
		<div
			className={cn(
				'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted',
				sizeMap[size],
				className,
			)}
			{...props}
		>
			{showSrc ? (
				<img
					src={showSrc}
					alt={alt || fallback || ''}
					className='aspect-square h-full w-full object-cover'
					onError={() => setImgError(true)}
				/>
			) : (
				<span className='font-medium text-muted-foreground'>{initials || '?'}</span>
			)}
		</div>
	)
}

function AvatarFallback({ children, className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
	return (
		<span className={cn('font-medium text-muted-foreground', className)} {...props}>
			{children}
		</span>
	)
}

function AvatarImage({
	src,
	alt,
	className,
	fallbackSrc,
	...props
}: React.ImgHTMLAttributes<HTMLImageElement> & { fallbackSrc?: string }) {
	const [error, setError] = React.useState(false)
	const finalSrc = error && fallbackSrc ? fallbackSrc : src
	return (
		<img
			src={finalSrc}
			alt={alt}
			className={cn('aspect-square h-full w-full object-cover', className)}
			onError={() => setError(true)}
			{...props}
		/>
	)
}

export { Avatar, AvatarFallback, AvatarImage }
