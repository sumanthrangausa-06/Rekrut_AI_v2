import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

// #1883 item 3 — the Sheet focus trap's list of "focusable" controls must be
// the controls a keyboard user can actually reach:
//  - NOT a hidden input, NOT a control inside a disabled fieldset, NOT
//    anything inside a hidden container, NOT a disabled button that happens
//    to carry a tabindex (the [tabindex] clause used to re-include it);
//  - AND it must include an editable text region (contenteditable), which
//    the old selector never matched — Tab skipped a real stop.
// Written from the keyboard user's expectations: the trap's boundaries
// (first/last) are where the trap acts, so the assertions sit there.
// On the pre-fix sheet every boundary assertion below is red.

function SheetWith({ children }: { children: React.ReactNode }) {
	return (
		<Sheet open={true} onOpenChange={vi.fn()}>
			<SheetHeader>
				<SheetTitle>Filters</SheetTitle>
				<SheetClose />
			</SheetHeader>
			<SheetContent>{children}</SheetContent>
		</Sheet>
	);
}

const closeBtn = () => screen.getByRole('button', { name: 'Close' });

describe('#1883 item 3 — Sheet focusable-selector edges', () => {
	it('Shift+Tab from the first control wraps to the contenteditable region when it is the last usable stop', () => {
		render(
			<SheetWith>
				<input type="hidden" />
				<div style={{ display: 'none' }}>
					<button type="button">Ghost action</button>
				</div>
				<fieldset disabled>
					<button type="button">Fieldset action</button>
				</fieldset>
				<button type="button" disabled tabIndex={0}>
					Disabled action
				</button>
				<button type="button">Real action</button>
				<div contentEditable suppressContentEditableWarning>
					Editable region
				</div>
			</SheetWith>,
		);
		closeBtn().focus();
		fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
		expect(document.activeElement?.textContent).toContain('Editable region');
	});

	it('Tab from the contenteditable region (last usable stop) wraps back to the first control', () => {
		const { container } = render(
			<SheetWith>
				<button type="button">Real action</button>
				<div contentEditable suppressContentEditableWarning>
					Editable region
				</div>
			</SheetWith>,
		);
		const editable = container.querySelector('[contenteditable]') as HTMLElement;
		editable.focus();
		expect(document.activeElement).toBe(editable);
		fireEvent.keyDown(document, { key: 'Tab' });
		expect(document.activeElement).toBe(closeBtn());
	});

	it('Shift+Tab wrap never lands on a control inside a hidden container', () => {
		render(
			<SheetWith>
				<button type="button">Real action</button>
				<div style={{ display: 'none' }}>
					<button type="button">Ghost action</button>
				</div>
				<button type="button" style={{ visibility: 'hidden' }}>
					Invisible action
				</button>
			</SheetWith>,
		);
		closeBtn().focus();
		fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Real action' }));
	});

	it('Shift+Tab wrap never lands on a control inside a disabled fieldset', () => {
		render(
			<SheetWith>
				<button type="button">Real action</button>
				<fieldset disabled>
					<button type="button">Fieldset action</button>
				</fieldset>
			</SheetWith>,
		);
		closeBtn().focus();
		fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Real action' }));
	});

	it('Shift+Tab wrap never lands on a hidden input', () => {
		render(
			<SheetWith>
				<button type="button">Real action</button>
				<input type="hidden" />
			</SheetWith>,
		);
		closeBtn().focus();
		fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Real action' }));
	});
});

describe('#1883 item 3 — reviewer delta (tabindex / visibility edges)', () => {
	it('Shift+Tab wrap never lands on a link the author removed from tab order (tabindex="-1")', () => {
		render(
			<SheetWith>
				<button type="button">Real action</button>
				<a href="/somewhere" tabIndex={-1}>
					Skipped link
				</a>
			</SheetWith>,
		);
		closeBtn().focus();
		fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Real action' }));
	});

	it('Shift+Tab wrap never lands on a visibility:collapse control', () => {
		render(
			<SheetWith>
				<button type="button">Real action</button>
				<button type="button" style={{ visibility: 'collapse' }}>
					Collapsed action
				</button>
			</SheetWith>,
		);
		closeBtn().focus();
		fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Real action' }));
	});

	it('a child that re-declares visibility:visible inside a hidden ancestor IS a stop; its undeclared sibling is not', () => {
		render(
			<SheetWith>
				<button type="button">Real action</button>
				<div style={{ visibility: 'hidden' }}>
					<button type="button">Still hidden</button>
					<button type="button" style={{ visibility: 'visible' }}>
						Override action
					</button>
				</div>
			</SheetWith>,
		);
		closeBtn().focus();
		fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Override action' }));
	});
});
