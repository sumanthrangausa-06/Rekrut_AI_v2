import { X } from 'lucide-react';
import * as React from 'react';
import { useScrollLock } from '@/hooks/use-scroll-lock';
import { cn } from '@/lib/utils';

interface SheetProps {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	children: React.ReactNode;
	side?: 'left' | 'right' | 'top' | 'bottom';
	className?: string;
}

const SheetContext = React.createContext<{ onClose: () => void; titleId: string }>({
	onClose: () => {},
	titleId: '',
});

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])';

// #1883 item 3: a selector cannot express every "not actually focusable"
// case, so the queried list is filtered to what a keyboard user can reach:
// hidden inputs, disabled controls (including controls disabled by an
// ancestor fieldset — the disabled state lives on the fieldset, not the
// control, and re-inclusion via the [tabindex] clause), and anything
// hidden by itself or an ancestor up to the panel (hidden attribute or
// computed display/visibility). ponytail: the fieldset first-<legend>
// exception is not modelled — no Sheet consumer uses fieldset+legend;
// model it if one appears.
function isFocusableReachable(el: HTMLElement, panel: HTMLElement): boolean {
	if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
	if ('disabled' in el && (el as HTMLButtonElement).disabled) return false;
	if (el.closest('fieldset[disabled]')) return false;
	// An explicit negative tabindex removes the element from sequential
	// (Tab) navigation even when an element clause above matched it; the
	// trap list is the Tab order, so it must not contain such an element.
	// (Attribute check, not el.tabIndex: a contenteditable region has no
	// tabindex attribute and stays a stop.)
	const tabIndexAttr = el.getAttribute('tabindex');
	if (tabIndexAttr !== null && Number.parseInt(tabIndexAttr, 10) < 0) return false;
	// Visibility is inherited but overridable, so the element's OWN
	// computed value is the effective one (a visibility:visible child of a
	// hidden ancestor really is visible and focusable). Display is not
	// overridable that way, so display/hidden need the ancestor walk.
	const ownStyle = getComputedStyle(el);
	if (ownStyle.visibility === 'hidden' || ownStyle.visibility === 'collapse') return false;
	let node: HTMLElement | null = el;
	while (node) {
		if (node.hidden) return false;
		if (getComputedStyle(node).display === 'none') return false;
		if (node === panel) break;
		node = node.parentElement;
	}
	return true;
}

function Sheet({ open, onOpenChange, children, side = 'right', className }: SheetProps) {
	useScrollLock(Boolean(open));

	const titleId = React.useId();
	const panelRef = React.useRef<HTMLDivElement>(null);
	// Latest-callback ref so the focus effect depends only on `open` —
	// re-running it on a consumer re-render would reset the user's focus.
	const onOpenChangeRef = React.useRef(onOpenChange);
	onOpenChangeRef.current = onOpenChange;

	// #1632: dialog focus management for every Sheet consumer — move focus
	// into the panel on open, keep Tab cycling inside it, close on Escape,
	// and return focus to the element the user came from on close.
	React.useEffect(() => {
		if (!open) return;
		const panel = panelRef.current;
		if (!panel) return;

		const previouslyFocused = document.activeElement as HTMLElement | null;
		const focusables = () =>
			Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) =>
				isFocusableReachable(el, panel),
			);
		(focusables()[0] ?? panel).focus();

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				// #1883 item 2: an inner control that already consumed Escape
				// (preventDefault) owns this keypress — don't also close.
				if (event.defaultPrevented) return;
				onOpenChangeRef.current?.(false);
				return;
			}
			if (event.key !== 'Tab') return;
			const items = focusables();
			if (items.length === 0) {
				event.preventDefault();
				panel.focus();
				return;
			}
			const first = items[0];
			const last = items[items.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			} else if (!panel.contains(document.activeElement)) {
				// #1883 item 4: stray-focus recovery follows the user's
				// direction — Shift+Tab enters at the last focusable.
				event.preventDefault();
				(event.shiftKey ? last : first).focus();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('keydown', handleKeyDown);
			if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
		};
	}, [open]);

	if (!open) return null;

	const handleClose = () => onOpenChange?.(false);

	const sideClasses = {
		left: 'left-0 h-dvh w-full sm:w-96',
		right: 'right-0 h-dvh w-full sm:w-96',
		top: 'top-0 w-full h-dvh sm:h-auto sm:max-h-[80vh]',
		bottom: 'bottom-0 w-full h-dvh sm:h-auto sm:max-h-[80vh]',
	};

	const animateClasses = {
		left: 'animate-in slide-in-from-left',
		right: 'animate-in slide-in-from-right',
		top: 'animate-in slide-in-from-top',
		bottom: 'animate-in slide-in-from-bottom',
	};

	return (
		<div className="fixed inset-0 z-50">
			<div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={handleClose} />
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className={cn(
					'fixed z-50 bg-background shadow-lg border flex flex-col min-w-0 overflow-x-hidden',
					sideClasses[side],
					animateClasses[side],
					className,
				)}
			>
				<SheetContext.Provider value={{ onClose: handleClose, titleId }}>{children}</SheetContext.Provider>
			</div>
		</div>
	);
}

function SheetContent({ children, className }: { children: React.ReactNode; className?: string }) {
	return <div className={cn('flex-1 overflow-y-auto p-4 min-w-0', className)}>{children}</div>;
}

function SheetHeader({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<div className={cn('flex items-center justify-between p-4 border-b', className)}>
			{children}
		</div>
	);
}

function SheetTitle({ children, className }: { children: React.ReactNode; className?: string }) {
	const ctx = React.useContext(SheetContext);
	return (
		<h2 id={ctx.titleId || undefined} className={cn('text-lg font-semibold', className)}>
			{children}
		</h2>
	);
}

function SheetClose({ className }: { className?: string }) {
	const ctx = React.useContext(SheetContext);
	return (
		<button type="button"
			onClick={ctx.onClose}
			aria-label="Close"
			className={cn(
				'rounded-sm opacity-70 hover:opacity-100 transition-opacity min-h-[44px] min-w-[44px] flex items-center justify-center',
				className,
			)}
		>
			<X className="h-4 w-4" />
		</button>
	);
}

export { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle };
