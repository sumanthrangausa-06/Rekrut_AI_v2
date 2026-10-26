import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

// #1883 items 2 + 4 — latent hardening of the #1632 Sheet primitive, written
// from a keyboard user's expectations:
//  (2) if something inside the panel already used the Escape key (it called
//      preventDefault, the standard "I handled this" signal), the panel
//      itself must NOT also close — one keypress, one action.
//  (4) if focus is stranded outside the panel, Tab walks the user INTO the
//      panel at its first control and Shift+Tab (backwards) at its LAST —
//      the recovery direction must match the direction the user is moving.
// On the pre-fix sheet both legs are red: Escape ignores defaultPrevented,
// and the recovery branch always targets the first focusable.

function OpenSheet({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
	return (
		<Sheet open={true} onOpenChange={onOpenChange}>
			<SheetHeader>
				<SheetTitle>Filters</SheetTitle>
				<SheetClose />
			</SheetHeader>
			<SheetContent>
				<button type="button">First action</button>
				<button type="button">Last action</button>
			</SheetContent>
		</Sheet>
	);
}

describe('#1883 Sheet hardening — Escape guard + recovery direction', () => {
	it('Escape already consumed inside the panel (defaultPrevented) does NOT close the sheet', () => {
		const onOpenChange = vi.fn();
		render(<OpenSheet onOpenChange={onOpenChange} />);
		const inner = screen.getByRole('button', { name: 'First action' });
		inner.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') e.preventDefault();
		});
		fireEvent.keyDown(inner, { key: 'Escape' });
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
	});

	it('an unconsumed Escape still closes the sheet', () => {
		const onOpenChange = vi.fn();
		render(<OpenSheet onOpenChange={onOpenChange} />);
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it('Shift+Tab with focus stranded outside the panel lands on the LAST focusable', () => {
		const onOpenChange = vi.fn();
		render(<OpenSheet onOpenChange={onOpenChange} />);
		(document.activeElement as HTMLElement).blur();
		expect(document.activeElement).toBe(document.body);
		fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last action' }));
	});

	it('Tab with focus stranded outside the panel still lands on the FIRST focusable', () => {
		const onOpenChange = vi.fn();
		render(<OpenSheet onOpenChange={onOpenChange} />);
		(document.activeElement as HTMLElement).blur();
		expect(document.activeElement).toBe(document.body);
		fireEvent.keyDown(document, { key: 'Tab' });
		const dialog = screen.getByRole('dialog');
		expect(dialog.contains(document.activeElement)).toBe(true);
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
	});
});
