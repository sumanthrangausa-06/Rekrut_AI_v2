/**
 * #1634 — behaviour tests for the Job Board URL-sync state machine and
 * the header Apply param builder. The #1634 addendum flagged the #1600
 * tests for pinning vocabulary instead of behaviour; these tests drive
 * the extracted pure helpers through the actual transition sequences:
 *
 *  SK-1: Header Apply with a keyword, while a stale ?skill= is on the
 *        board URL → the Apply params carry the header keyword and do
 *        NOT carry `skill` (so jobs.tsx's skill effect can never reset
 *        the search back to the stale skill). The open-job param `job`
 *        is preserved.
 *  SIG-1: Two filter states whose values differ only across a `|`
 *        boundary must produce different adoption signatures (the old
 *        join('|') collided them and skipped adoption).
 *  RE-1: Adoption tracker transitions: first sight adopts; same sig
 *        again (signal not yet stripped) does not re-adopt; after the
 *        signal is consumed/stripped, the SAME sig adopts again
 *        (post-strip re-entry after in-page divergence re-syncs).
 */
import { describe, expect, test } from 'vitest';
import {
	buildHeaderApplyParams,
	createUrlFilterAdoptionTracker,
	urlFilterSignature,
} from '@/lib/job-board-url';

const draft = {
	search: 'nurse',
	location: '',
	type: '',
	remote_type: '',
	experience_level: '',
	salary_min: '',
	salary_max: '',
};

describe('#1634 SK-1 — header Apply params', () => {
	test('header keyword survives: skill is not preserved, job is', () => {
		const current = new URLSearchParams('skill=React&job=42&filters=hdr1');
		const params = buildHeaderApplyParams(draft, current);
		expect(params.get('filters')).toBe('hdr1');
		expect(params.get('search')).toBe('nurse');
		expect(params.get('skill')).toBeNull();
		expect(params.get('job')).toBe('42');
	});

	test('empty draft produces no filter params (caller navigates to explicit clear)', () => {
		const empty = { ...draft, search: '' };
		const params = buildHeaderApplyParams(empty, new URLSearchParams('skill=React'));
		expect(params.get('filters')).toBeNull();
		expect(params.get('skill')).toBeNull();
		expect([...params.keys()]).toEqual([]);
	});

	test('no current params (off the board) → nothing preserved', () => {
		const params = buildHeaderApplyParams(draft, null);
		expect(params.get('search')).toBe('nurse');
		expect(params.get('job')).toBeNull();
	});
});

describe('#1634 SIG-1 — URL filter signature', () => {
	const base = {
		search: '',
		location: '',
		type: '',
		remote_type: '',
		experience_level: '',
		salary_min: '',
		salary_max: '',
	};
	test('values containing | cannot collide across field splits', () => {
		const a = urlFilterSignature({ ...base, search: 'a|b', location: 'c' });
		const b = urlFilterSignature({ ...base, search: 'a', location: 'b|c' });
		expect(a).not.toBe(b);
	});
	test('identical states produce identical signatures; different states differ', () => {
		expect(urlFilterSignature(base)).toBe(urlFilterSignature({ ...base }));
		expect(urlFilterSignature(base)).not.toBe(urlFilterSignature({ ...base, search: 'x' }));
	});
});

describe('#1634 RE-1 — adoption tracker transitions', () => {
	test('adopt → duplicate blocked → strip/consume → identical re-entry adopts again', () => {
		const tracker = createUrlFilterAdoptionTracker();
		const sig = urlFilterSignature({ ...draft });
		expect(tracker.shouldAdopt(sig)).toBe(true);
		tracker.record(sig);
		expect(tracker.shouldAdopt(sig)).toBe(false);
		tracker.consume();
		expect(tracker.shouldAdopt(sig)).toBe(true);
	});
	test('a different sig always adopts', () => {
		const tracker = createUrlFilterAdoptionTracker();
		tracker.record('sig-a');
		expect(tracker.shouldAdopt('sig-b')).toBe(true);
	});
});
