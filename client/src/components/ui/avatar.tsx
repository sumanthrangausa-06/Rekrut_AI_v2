import * as React from 'react'
import { cn } from '@/lib/utils'

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string | null
  alt?: string
  fallback?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeMap = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
}

function Avatar({ src, alt, fallback, size = 'md', className, children, ...props }: AvatarProps) {
  const [imgError, setImgError] = React.useState(false)

  const initials = (fallback || '')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted',
        sizeMap[size],
        className
      )}
      {...props}
    >
      {src && !imgError ? (
        <img
          src={src}
          alt={alt || fallback || ''}
          className="aspect-square h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="font-medium text-muted-foreground">{initials}</span>
      )}
    </div>
  )
}

function AvatarFallback({ children, className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('font-medium text-muted-foreground', className)} {...props}>{children}</span>
}

function AvatarImage({ src, alt, className, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  return <img src={src} alt={alt} className={cn('aspect-square h-full w-full object-cover', className)} {...props} />
}

export { Avatar, AvatarFallback, AvatarImage }
