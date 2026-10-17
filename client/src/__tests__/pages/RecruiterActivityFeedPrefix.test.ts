/**
 * #1221 (D8) — Recruiter dashboard activity feed must not double-prefix /api.
 *
 * apiCall (client/src/lib/api.ts) always fetches `/api${url}`, so callers
 * must pass a path WITHOUT the /api prefix. dashboard.tsx passed
 * '/api/recruiter/activity', producing /api/api/recruiter/activity → 404.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
	path.join(__dirname, '../../pages/recruiter/dashboard.tsx'),
	'utf8',
);

// Extract the first string argument of the apiCall that loads the activity feed.
function activityFeedArg(): string | null {
	const match = source.match(/apiCall<[^>]*>\(\s*'([^']*recruiter\/activity[^']*)'/);
	return match ? match[1] : null;
}

describe('#1221 recruiter activity feed — no double /api prefix', () => {
	it('passes the activity path without the /api prefix to apiCall', () => {
		expect(activityFeedArg()).toBe('/recruiter/activity');
	});

	it('constructed URL (apiCall prepends /api) is the real server route, not /api/api/…', () => {
		const arg = activityFeedArg();
		expect(arg).not.toBeNull();
		expect(`/api${arg}`).toBe('/api/recruiter/activity');
		expect(`/api${arg}`).not.toContain('/api/api/');
	});

	it('source contains no double-prefix-prone activity call', () => {
		expect(source).not.toContain("'/api/recruiter/activity'");
	});
});
