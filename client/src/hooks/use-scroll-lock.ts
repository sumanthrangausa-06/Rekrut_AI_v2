import * as React from 'react';

// Body scroll locking is global state, so overlapping overlays have to share a
// single lock rather than each writing body styles directly. Without the count,
// closing one dialog releases the lock a still-open dialog depends on.
let lockCount = 0;
let savedScrollY = 0;
// Tracks whether the active lock was taken on iOS so releaseLock() undoes
// exactly what applyLock() did (the UA can't change mid-session).
let lockedOnIOS = false;

/**
 * iOS detection, same pattern as quick-practice.tsx. iPadOS 13+ reports
 * platform "MacIntel", so touch capability distinguishes it from a real Mac.
 * Guarded for SSR/test environments without navigator.
 */
function isIOS(): boolean {
	if (typeof navigator === 'undefined') return false;
	return (
		/iPad|iPhone|iPod/.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	);
}

function applyLock() {
	savedScrollY = window.scrollY;
	lockedOnIOS = isIOS();
	const { style } = document.body;
	style.overflow = 'hidden';
	style.width = '100%';
	if (lockedOnIOS) {
		// iOS: body{position:fixed} breaks touch scroll event delivery to
		// nested scroll containers (dialogs), so swipe gestures stop working
		// while programmatic scroll still works. overflow:hidden alone is
		// enough to freeze background scroll on iOS 13+.
		return;
	}
	style.position = 'fixed';
	style.top = `-${savedScrollY}px`;
}

function releaseLock() {
	const { style } = document.body;
	style.overflow = '';
	style.width = '';
	if (lockedOnIOS) {
		// No offset was applied, so the page is already at the right position.
		return;
	}
	style.position = '';
	style.top = '';
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
