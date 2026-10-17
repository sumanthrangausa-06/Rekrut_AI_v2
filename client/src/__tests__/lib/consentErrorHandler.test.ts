import { describe, expect, it } from 'vitest';

import {
	extractSessionIdFromRequest,
	getConsentRedirect,
	isConsentErrorCode,
	shouldRedirectForConsentCode,
} from '@/lib/consentErrorHandler';

describe('consentErrorHandler', () => {
	describe('isConsentErrorCode', () => {
		it('returns true for CONSENT_ prefixed codes', () => {
			expect(isConsentErrorCode('CONSENT_REQUIRED')).toBe(true);
			expect(isConsentErrorCode('CONSENT_VERSION_STALE')).toBe(true);
			expect(isConsentErrorCode('CONSENT_WITHDRAWN')).toBe(true);
			expect(isConsentErrorCode('CONSENT_SESSION_REQUIRED')).toBe(true);
			expect(isConsentErrorCode('CONSENT_CHECK_UNAVAILABLE')).toBe(true);
		});

		it('returns false for non-consent codes', () => {
			expect(isConsentErrorCode('BLOCKED_EMAIL_DOMAIN')).toBe(false);
			expect(isConsentErrorCode('UNAUTHORIZED')).toBe(false);
			expect(isConsentErrorCode('FORBIDDEN')).toBe(false);
		});

		it('returns false for undefined/null/empty', () => {
			expect(isConsentErrorCode(undefined)).toBe(false);
			expect(isConsentErrorCode('')).toBe(false);
		});
	});

	describe('extractSessionIdFromRequest', () => {
		it('extracts from /mock/:sessionId/ path params', () => {
			expect(extractSessionIdFromRequest('/api/mock/123/voice-respond')).toBe(123);
			expect(extractSessionIdFromRequest('/api/mock/456/end')).toBe(456);
		});

		it('extracts from query string', () => {
			expect(extractSessionIdFromRequest('/api/interviews/frames?sessionId=789')).toBe(789);
		});

		it('extracts from request body (sessionId field)', () => {
			expect(
				extractSessionIdFromRequest('/api/interviews/upload-video', { sessionId: 321 }),
			).toBe(321);
		});

		it('extracts from request body (interview_id field)', () => {
			expect(
				extractSessionIdFromRequest('/api/interviews/upload-video', { interview_id: 654 }),
			).toBe(654);
		});

		it('prefers body over URL when both present', () => {
			expect(
				extractSessionIdFromRequest('/api/mock/111/voice-respond', { sessionId: 222 }),
			).toBe(222);
		});

		it('returns null when no sessionId found', () => {
			expect(extractSessionIdFromRequest('/api/mock/analyze-frame')).toBe(null);
			expect(extractSessionIdFromRequest('/api/candidate/jobs')).toBe(null);
		});

		it('returns null for invalid sessionId values', () => {
			expect(extractSessionIdFromRequest('/api/mock/abc/voice-respond')).toBe(null);
			expect(extractSessionIdFromRequest('/api/mock/0/voice-respond')).toBe(null);
			expect(extractSessionIdFromRequest('/api/mock/-5/voice-respond')).toBe(null);
			expect(extractSessionIdFromRequest('/api/interviews/frames', { sessionId: 'xyz' })).toBe(
				null,
			);
		});
	});

	describe('shouldRedirectForConsentCode', () => {
		it('returns true for codes that trigger redirect', () => {
			expect(shouldRedirectForConsentCode('CONSENT_REQUIRED')).toBe(true);
			expect(shouldRedirectForConsentCode('CONSENT_VERSION_STALE')).toBe(true);
		});

		it('returns false for WITHDRAWN (inline message, not redirect)', () => {
			expect(shouldRedirectForConsentCode('CONSENT_WITHDRAWN')).toBe(false);
		});

		it('returns false for transient/unavailable errors', () => {
			expect(shouldRedirectForConsentCode('CONSENT_CHECK_UNAVAILABLE')).toBe(false);
			expect(shouldRedirectForConsentCode('CONSENT_SESSION_REQUIRED')).toBe(false);
		});

		it('returns false for non-consent codes', () => {
			expect(shouldRedirectForConsentCode('FORBIDDEN')).toBe(false);
			expect(shouldRedirectForConsentCode(undefined)).toBe(false);
		});
	});

	describe('getConsentRedirect', () => {
		it('CONSENT_REQUIRED redirects to consent screens with sessionId', () => {
			expect(getConsentRedirect('CONSENT_REQUIRED', 123)).toBe(
				'/interview/consent?sessionId=123',
			);
		});

		it('CONSENT_VERSION_STALE redirects with reason=stale', () => {
			expect(getConsentRedirect('CONSENT_VERSION_STALE', 456)).toBe(
				'/interview/consent?sessionId=456&reason=stale',
			);
		});

		it('redirects without sessionId when not available', () => {
			expect(getConsentRedirect('CONSENT_REQUIRED', null)).toBe('/interview/consent');
		});

		it('returns null for non-redirect codes', () => {
			expect(getConsentRedirect('CONSENT_WITHDRAWN', 123)).toBe(null);
			expect(getConsentRedirect('FORBIDDEN', 123)).toBe(null);
			expect(getConsentRedirect('CONSENT_CHECK_UNAVAILABLE', 123)).toBe(null);
		});
	});
});
