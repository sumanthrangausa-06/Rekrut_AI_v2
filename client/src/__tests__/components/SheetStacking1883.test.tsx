import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

// #1883 item 1 — modal stacking, written from a keyboard user's
// expectations when TWO Sheets are open at once (a lower panel and a
// top panel opened over it):
//  - one Escape closes ONLY the top panel — one keypress, one action;
//  - the Tab trap belongs to the top panel alone — the lower panel's
//    trap must not hijack keys the top panel would leave alone;
//  - closing a panel while another stays open returns focus INTO the
//    panel that remains, never to an element on the page behind it;
//  - a single panel behaves exactly as before (regression leg).
// On the pre-fix sheet every open panel installs its own document
// keydown handler and its own focus restoration, so the stacked legs
// below are red: both handlers fire on one Escape, the lower trap
// fights the top trap, and a closing panel's cleanup restores focus
// to wherever it happened to capture on open — outside the survivor.

function SheetBody({ title, prefix }: { title: string; prefix: string }) {
	return (
		<>
			<SheetHeader>
				<SheetTitle>{title}</SheetTitle>
				<SheetClose />
			</SheetHeader>
			<SheetContent>
				<button type="button">{`${prefix} first action`}</button>
				<button type="button">{`${prefix} middle action`}</button>
				<button type="button">{`${prefix} last action`}</button>
			</SheetContent>
		</>
	);
}

function StackedSheets({
	lowerOpen = true,
	upperOpen = true,
	onLowerChange = () => {},
	onUpperChange = () => {},
}: {
	lowerOpen?: boolean;
	upperOpen?: boolean;
	onLowerChange?: (open: boolean) => void;
	onUpperChange?: (open: boolean) => void;
}) {
	return (
		<div>
			<button type="button">Outside trigger</button>
			<Sheet open={lowerOpen} onOpenChange={onLowerChange}>
				<SheetBody title="Lower panel" prefix="Lower" />
			</Sheet>
			<Sheet open={upperOpen} onOpenChange={onUpperChange}>
				<SheetBody title="Upper panel" prefix="Upper" />
			</Sheet>
		</div>
	);
}

describe('#1883 item 1 — Sheet modal stacking', () => {
	it('(a) one Escape with two stacked sheets closes ONLY the top sheet', () => {
		const onLowerChange = vi.fn();
		const onUpperChange = vi.fn();
		render(<StackedSheets onLowerChange={onLowerChange} onUpperChange={onUpperChange} />);
		expect(screen.getAllByRole('dialog')).toHaveLength(2);

		fireEvent.keyDown(document, { key: 'Escape' });

		expect(onUpperChange).toHaveBeenCalledTimes(1);
		expect(onUpperChange).toHaveBeenCalledWith(false);
		expect(onLowerChange).not.toHaveBeenCalled();
	});

	it('(b) Tab on a middle control of the top sheet is not hijacked by the lower sheet trap', () => {
		render(<StackedSheets />);
		// "Upper first action" is neither the top panel's first focusable
		// (its Close button is) nor its last, so the TOP trap correctly
		// leaves a Tab press alone — focus stays where the user is.
		// The lower trap sees that focus as "stranded outside my panel"
		// and, on the pre-fix sheet, drags it into the lower panel; the
		// top trap then drags it to the top panel's first control. The
		// user ends up somewhere they never asked to go.
		const middle = screen.getByRole('button', { name: 'Upper first action' });
		middle.focus();
		expect(document.activeElement).toBe(middle);

		fireEvent.keyDown(document, { key: 'Tab' });

		expect(document.activeElement).toBe(middle);
	});

	it('(b2) the top sheet trap still wraps Tab from its last control to its first', () => {
		render(<StackedSheets />);
		const upperDialog = screen.getByRole('dialog', { name: 'Upper panel' });
		const last = screen.getByRole('button', { name: 'Upper last action' });
		last.focus();

		fireEvent.keyDown(document, { key: 'Tab' });

		expect(upperDialog.contains(document.activeElement)).toBe(true);
		expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Close' })[1]);
	});

	it('(c) closing the top sheet returns focus into the still-open lower sheet', () => {
		const { rerender } = render(<StackedSheets upperOpen={false} />);
		const lowerDialog = screen.getByRole('dialog', { name: 'Lower panel' });
		// The top sheet opens at a moment when focus sits on the page
		// behind both panels (stray focus — the state the existing trap
		// recovery branch exists for). Its captured "previously focused"
		// element is therefore OUTSIDE the lower panel, and a plain
		// restore-on-close would throw the keyboard user out of the
		// modal that is still open.
		screen.getByRole('button', { name: 'Outside trigger' }).focus();
		rerender(<StackedSheets upperOpen={true} />);
		const upperDialog = screen.getByRole('dialog', { name: 'Upper panel' });
		expect(upperDialog.contains(document.activeElement)).toBe(true);

		rerender(<StackedSheets upperOpen={false} />);

		expect(screen.queryByRole('dialog', { name: 'Upper panel' })).not.toBeInTheDocument();
		expect(lowerDialog.contains(document.activeElement)).toBe(true);
	});

	it('(c2) closing the lower sheet while the top stays open keeps focus inside the top sheet', () => {
		const { rerender } = render(<StackedSheets />);
		const upperDialog = screen.getByRole('dialog', { name: 'Upper panel' });
		expect(upperDialog.contains(document.activeElement)).toBe(true);

		rerender(<StackedSheets lowerOpen={false} />);

		expect(screen.queryByRole('dialog', { name: 'Lower panel' })).not.toBeInTheDocument();
		expect(upperDialog.contains(document.activeElement)).toBe(true);
	});

	it('(d) single sheet: open → Escape → focus returns to the trigger (unchanged)', () => {
		function SingleHarness() {
			const [open, setOpen] = React.useState(false);
			return (
				<div>
					<button type="button" onClick={() => setOpen(true)}>
						Open panel
					</button>
					<Sheet open={open} onOpenChange={setOpen}>
						<SheetBody title="Only panel" prefix="Only" />
					</Sheet>
				</div>
			);
		}
		render(<SingleHarness />);
		const trigger = screen.getByRole('button', { name: 'Open panel' });
		trigger.focus();
		fireEvent.click(trigger);
		const dialog = screen.getByRole('dialog', { name: 'Only panel' });
		expect(dialog.contains(document.activeElement)).toBe(true);

		fireEvent.keyDown(document, { key: 'Escape' });

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(document.activeElement).toBe(trigger);
	});
});
