import { X } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

interface SheetProps {
	open?: boolean
	onOpenChange?: (open: boolean) => void
	children: React.ReactNode
	side?: 'left' | 'right' | 'top' | 'bottom'
	className?: string
}

const SheetContext = React.createContext<{ onClose: () => void }>({ onClose: () => {} })

function Sheet({ open, onOpenChange, children, side = 'right', className }: SheetProps) {
	React.useEffect(() => {
		if (open) document.body.style.overflow = 'hidden'
		else document.body.style.overflow = ''
		return () => {
			document.body.style.overflow = ''
		}
	}, [open])

	if (!open) return null

	const handleClose = () => onOpenChange?.(false)

	const sideClasses = {
		left: 'left-0 h-dvh w-full sm:w-96',
		right: 'right-0 h-dvh w-full sm:w-96',
		top: 'top-0 w-full h-dvh sm:h-auto sm:max-h-[80vh]',
		bottom: 'bottom-0 w-full h-dvh sm:h-auto sm:max-h-[80vh]',
	}

	const animateClasses = {
		left: 'animate-in slide-in-from-left',
		right: 'animate-in slide-in-from-right',
		top: 'animate-in slide-in-from-top',
		bottom: 'animate-in slide-in-from-bottom',
	}

	return (
		<div className='fixed inset-0 z-50'>
			<div className='fixed inset-0 bg-black/50' onClick={handleClose} />
			<div
				className={cn(
					'fixed z-50 bg-background shadow-lg border flex flex-col min-w-0 overflow-x-hidden',
					sideClasses[side],
					animateClasses[side],
					className,
				)}
			>
				<SheetContext.Provider value={{ onClose: handleClose }}>{children}</SheetContext.Provider>
			</div>
		</div>
	)
}

function SheetContent({ children, className }: { children: React.ReactNode; className?: string }) {
	return <div className={cn('flex-1 overflow-y-auto p-4 min-w-0', className)}>{children}</div>
}

function SheetHeader({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<div className={cn('flex items-center justify-between p-4 border-b', className)}>
			{children}
		</div>
	)
}

function SheetTitle({ children, className }: { children: React.ReactNode; className?: string }) {
	return <h2 className={cn('text-lg font-semibold', className)}>{children}</h2>
}

function SheetClose({ className }: { className?: string }) {
	const ctx = React.useContext(SheetContext)
	return (
		<button
			onClick={ctx.onClose}
			className={cn(
				'rounded-sm opacity-70 hover:opacity-100 transition-opacity min-h-[44px] min-w-[44px] flex items-center justify-center',
				className,
			)}
		>
			<X className='h-4 w-4' />
		</button>
	)
}

export { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle }
