import * as React from 'react';

// Body scroll locking is global state, so overlapping overlays have to share a
// single lock rather than each writing body styles directly. Without the count,
// closing one dialog releases the lock a still-open dialog depends on.
let lockCount = 0;
let savedScrollY = 0;

function applyLock() {
	savedScrollY = window.scrollY;
	const { style } = document.body;
	style.overflow = 'hidden';
	style.position = 'fixed';
	style.top = `-${savedScrollY}px`;
	style.width = '100%';
}

function releaseLock() {
	const { style } = document.body;
	style.overflow = '';
	style.position = '';
	style.top = '';
	style.width = '';
	window.scrollTo(0, savedScrollY);
}

/**
 * Freezes body scrolling while `locked` is true, preserving and restoring the
 * scroll position. Does nothing at all while unlocked, so mounting a closed
 * overlay never moves the page.
 */
export function useScrollLock(locked: boolean) {
	React.useEffect(() => {
		if (!locked) return;

		if (lockCount === 0) applyLock();
		lockCount += 1;

		return () => {
			lockCount -= 1;
			if (lockCount === 0) releaseLock();
		};
	}, [locked]);
}
