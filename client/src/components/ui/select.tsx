import * as React from 'react';
import { cn } from '@/lib/utils';

interface SelectProps {
	id?: string;
	value?: string;
	onValueChange?: (value: string) => void;
	onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
	onClick?: (e: React.MouseEvent<HTMLSelectElement>) => void;
	children: React.ReactNode;
	className?: string;
	disabled?: boolean;
	placeholder?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
	(
		{ id, value, onValueChange, onChange, onClick, children, className, disabled, placeholder },
		ref,
	) => {
		// If onValueChange is used, render as Radix-style dropdown
		if (onValueChange) {
			return (
				<div className={cn('relative', className)}>
					<select
						id={id}
						ref={ref}
						value={value}
						onChange={(e) => onValueChange(e.target.value)}
						className={cn(
							'flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
							className,
						)}
						disabled={disabled}
					>
						{placeholder && <option value="">{placeholder}</option>}
						{children}
					</select>
				</div>
			);
		}

		// Default: render as native select with onChange
		return (
			<select
				id={id}
				ref={ref}
				value={value}
				onChange={onChange}
				onClick={onClick}
				className={cn(
					'flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
					className,
				)}
				disabled={disabled}
			>
				{children}
			</select>
		);
	},
);
Select.displayName = 'Select';

function SelectTrigger({
	children,
	className,
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button type="button"
			className={cn(
				'flex h-10 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
				className,
			)}
			{...props}
		>
			{children}
			<span className="text-muted-foreground">▼</span>
		</button>
	);
}

function SelectValue({
	placeholder,
	children,
}: {
	placeholder?: string;
	children?: React.ReactNode;
}) {
	return <span className="text-sm">{children || placeholder}</span>;
}

function SelectContent({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<div
			className={cn(
				'absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md',
				className,
			)}
		>
			{children}
		</div>
	);
}

function SelectItem({
	value,
	children,
	className,
	onClick,
}: {
	value: string;
	children: React.ReactNode;
	className?: string;
	onClick?: () => void;
}) {
	return (
		<div
			className={cn(
				'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground',
				className,
			)}
			onClick={onClick}
			data-value={value}
		>
			{children}
		</div>
	);
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
