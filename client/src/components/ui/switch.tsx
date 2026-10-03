import * as React from 'react';
import { cn } from '@/lib/utils';

interface SwitchProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	checked?: boolean;
	onCheckedChange?: (checked: boolean) => void;
	label?: string;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
	({ className, checked, onCheckedChange, label, ...props }, ref) => {
		return (
			<div className={cn('flex items-center gap-2', className)}>
				<button
					ref={ref}
					type="button"
					role="switch"
					aria-checked={checked}
					onClick={() => onCheckedChange?.(!checked)}
					className={cn(
						'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
						'disabled:cursor-not-allowed disabled:opacity-50',
						checked ? 'bg-primary' : 'bg-input',
						className,
					)}
					{...props}
				>
					<span
						className={cn(
							'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
							checked ? 'translate-x-5' : 'translate-x-0',
						)}
					/>
				</button>
				{label && <span className="text-sm font-medium">{label}</span>}
			</div>
		);
	},
);
Switch.displayName = 'Switch';

export { Switch };
