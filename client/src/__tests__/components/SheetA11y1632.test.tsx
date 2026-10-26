import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

// #1632 — the shared Sheet primitive is every slide-in panel in the app
// (job filters, job detail drawer, mobile menu, interview layout,
// recruiter jobs). User journey, written from a keyboard / screen-reader
// user's expectations: opening a panel makes it a real dialog — announced
// by its title, focus moves inside, Tab never escapes to the page behind,
// Escape closes it, focus returns to the button they came from, and the
// icon-only close button has a name. On pristine dev the panel is a plain
// div with none of this, so every leg below is red first.

function Harness() {
	const [open, setOpen] = React.useState(false);
	return (
		<div>
			<button type="button" onClick={() => setOpen(true)}>
				Open filters
			</button>
			<Sheet open={open} onOpenChange={setOpen}>
				<SheetHeader>
					<SheetTitle>Filters</SheetTitle>
					<SheetClose />
				</SheetHeader>
				<SheetContent>
					<button type="button">First action</button>
					<button type="button">Last action</button>
				</SheetContent>
			</Sheet>
		</div>
	);
}

describe('#1632 Sheet dialog semantics + focus management', () => {
	it('renders as a modal dialog named by its SheetTitle', () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole('button', { name: 'Open filters' }));
		const dialog = screen.getByRole('dialog', { name: 'Filters' });
		expect(dialog).toHaveAttribute('aria-modal', 'true');
	});

	it('moves focus inside the panel on open', () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole('button', { name: 'Open filters' }));
		const dialog = screen.getByRole('dialog');
		expect(dialog.contains(document.activeElement)).toBe(true);
	});

	it('close button has the accessible name "Close"', () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole('button', { name: 'Open filters' }));
		expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
	});

	it('Tab from the last focusable wraps to the first; Shift+Tab from the first wraps to the last', () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole('button', { name: 'Open filters' }));
		const close = screen.getByRole('button', { name: 'Close' });
		const first = screen.getByRole('button', { name: 'First action' });
		const last = screen.getByRole('button', { name: 'Last action' });

		last.focus();
		fireEvent.keyDown(document, { key: 'Tab' });
		expect([close, first, last]).toContain(document.activeElement);
		expect(document.activeElement).toBe(close);

		close.focus();
		fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(last);
	});

	it('Escape closes the sheet', () => {
		const onOpenChange = vi.fn();
		render(
			<Sheet open={true} onOpenChange={onOpenChange}>
				<SheetHeader>
					<SheetTitle>Filters</SheetTitle>
					<SheetClose />
				</SheetHeader>
				<SheetContent>
					<button type="button">Only action</button>
				</SheetContent>
			</Sheet>,
		);
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it('returns focus to the trigger when the sheet closes', () => {
		render(<Harness />);
		const trigger = screen.getByRole('button', { name: 'Open filters' });
		trigger.focus();
		fireEvent.click(trigger);
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(document.activeElement).toBe(trigger);
	});

	it('renders nothing and traps nothing while closed', () => {
		const onOpenChange = vi.fn();
		render(
			<Sheet open={false} onOpenChange={onOpenChange}>
				<SheetHeader>
					<SheetTitle>Filters</SheetTitle>
				</SheetHeader>
			</Sheet>,
		);
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(onOpenChange).not.toHaveBeenCalled();
	});
});
