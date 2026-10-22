import {
	extractSessionIdFromRequest,
	getConsentRedirect,
	isConsentErrorCode,
	shouldRedirectForConsentCode,
} from './consentErrorHandler';

const TOKEN_KEY = 'rekrutai_token';
const REFRESH_KEY = 'rekrutai_refresh';
const CSRF_TOKEN_KEY = 'rekrutai_csrf';

// Legacy keys from older versions — check in priority order and migrate
const LEGACY_TOKEN_KEYS = ['token', 'hireloop_token'];
const LEGACY_REFRESH_KEYS = ['refresh_token', 'hireloop_refresh'];

export function getToken(): string | null {
	// Check canonical key first
	let token = localStorage.getItem(TOKEN_KEY);
	if (token) return token;

	// Check legacy keys and migrate if found
	for (const key of LEGACY_TOKEN_KEYS) {
		token = localStorage.getItem(key);
		if (token) {
			// Migrate to canonical key
			localStorage.setItem(TOKEN_KEY, token);
			localStorage.removeItem(key);
			return token;
		}
	}

	return null;
}

export function getRefreshToken(): string | null {
	let refresh = localStorage.getItem(REFRESH_KEY);
	if (refresh) return refresh;

	for (const key of LEGACY_REFRESH_KEYS) {
		refresh = localStorage.getItem(key);
		if (refresh) {
			localStorage.setItem(REFRESH_KEY, refresh);
			localStorage.removeItem(key);
			return refresh;
		}
	}

	return null;
}

export function setTokens(accessToken: string, refreshToken: string) {
	localStorage.setItem(TOKEN_KEY, accessToken);
	localStorage.setItem(REFRESH_KEY, refreshToken);
	// Also set legacy keys for backward compatibility with other code
	localStorage.setItem('token', accessToken);
	localStorage.setItem('refresh_token', refreshToken);
	startAuthRefresh();
}

export function clearTokens() {
	stopAuthRefresh();
	localStorage.removeItem(TOKEN_KEY);
	localStorage.removeItem(REFRESH_KEY);
	// Clear legacy keys too
	for (const key of LEGACY_TOKEN_KEYS) {
		localStorage.removeItem(key);
	}
	for (const key of LEGACY_REFRESH_KEYS) {
		localStorage.removeItem(key);
	}
}

// CSRF token management — read from cookie directly (most reliable)
function getCsrfTokenFromCookie(): string | null {
	const match = document.cookie.match(/(^| )_csrf=([^;]+)/);
	return match ? decodeURIComponent(match[2]) : null;
}

async function getCsrfToken(): Promise<string | null> {
	// 1. Try cookie directly (avoids stale localStorage cache)
	const cookieToken = getCsrfTokenFromCookie();
	if (cookieToken) {
		localStorage.setItem(CSRF_TOKEN_KEY, cookieToken);
		return cookieToken;
	}

	// 2. Fallback to localStorage cache
	const cached = localStorage.getItem(CSRF_TOKEN_KEY);
	if (cached) return cached;

	// 3. Fetch from server (for environments where cookie isn't set yet)
	try {
		const res = await fetch('/csrf-token', { credentials: 'include' });
		if (res.ok) {
			const data = await res.json();
			if (data.csrfToken) {
				localStorage.setItem(CSRF_TOKEN_KEY, data.csrfToken);
				return data.csrfToken;
			}
		}
	} catch {
		// CSRF endpoint not critical for all requests
	}
	return null;
}
// Proactive token refresh — refresh at 80% of token lifetime before expiry
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

// Parse JWT payload without external library (base64url decode)
function parseJwtPayload(token: string): Record<string, unknown> | null {
	try {
		const base64Url = token.split('.')[1];
		if (!base64Url) return null;
		const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
		const jsonPayload = decodeURIComponent(
			atob(base64)
				.split('')
				.map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
				.join(''),
		);
		return JSON.parse(jsonPayload);
	} catch {
		return null;
	}
}

function getTokenExpiry(token: string): number | null {
	const payload = parseJwtPayload(token);
	if (!payload || typeof payload.exp !== 'number') return null;
	return payload.exp * 1000; // convert seconds to ms
}

const REFRESH_THRESHOLD = 0.8; // refresh at 80% of lifetime

export function startAuthRefresh() {
	clearProactiveRefresh();

	const token = getToken();
	if (!token) return;

	const expiry = getTokenExpiry(token);
	if (!expiry) return;

	const now = Date.now();
	const lifetime = expiry - now;
	if (lifetime <= 0) {
		// Token already expired — let reactive interceptor handle it
		console.warn('[auth] Access token already expired, skipping proactive refresh');
		return;
	}

	// Refresh at 80% of lifetime, but at least 30s before expiry
	const refreshIn = Math.min(Math.floor(lifetime * REFRESH_THRESHOLD), lifetime - 30_000);

	if (refreshIn <= 0) {
		// Very close to expiry — refresh immediately
		refreshAccessToken().then((newToken) => {
			if (newToken) startAuthRefresh();
		});
		return;
	}

	console.log(`[auth] Proactive refresh scheduled in ${Math.round(refreshIn / 1000)}s`);

	proactiveRefreshTimer = setTimeout(() => {
		refreshAccessToken().then((newToken) => {
			if (newToken) {
				startAuthRefresh();
			} else {
				// Proactive refresh failed — token may still be valid for a short time.
				// The reactive 401 interceptor in apiCall will catch real requests.
				console.warn('[auth] Proactive refresh failed; waiting for reactive interceptor');
			}
		});
	}, refreshIn);
}

export function stopAuthRefresh() {
	clearProactiveRefresh();
}

function clearProactiveRefresh() {
	if (proactiveRefreshTimer) {
		clearTimeout(proactiveRefreshTimer);
		proactiveRefreshTimer = null;
	}
}

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
	if (isRefreshing && refreshPromise) return refreshPromise;

	isRefreshing = true;
	refreshPromise = (async () => {
		try {
			const refreshToken = getRefreshToken();
			if (!refreshToken) return null;

			const res = await fetch('/api/auth/refresh', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-CSRF-Token': getCsrfTokenFromCookie() || localStorage.getItem(CSRF_TOKEN_KEY) || '',
				},
				body: JSON.stringify({ refreshToken }),
				credentials: 'include',
			});

			if (!res.ok) return null;

			const data = await res.json();
			if (data.accessToken && data.refreshToken) {
				setTokens(data.accessToken, data.refreshToken);
				return data.accessToken;
			}
			return null;
		} catch {
			return null;
		} finally {
			isRefreshing = false;
			refreshPromise = null;
		}
	})();

	return refreshPromise;
}

interface ApiCallOptions extends Omit<RequestInit, 'body'> {
	body?: unknown;
	isFormData?: boolean;
	skipAuthCheck?: boolean; // For login, register, forgot-password, reset-password
	// FR-A2 (#1602): bound the request. When set, the fetch aborts after
	// timeoutMs and apiCall throws a TIMEOUT-coded error instead of leaving
	// a spinner running forever. Unset = previous unbounded behaviour
	// (long-running calls like CV analysis keep their existing contract).
	timeoutMs?: number;
}

export async function apiCall<T = unknown>(url: string, options: ApiCallOptions = {}): Promise<T> {
	const { body, isFormData, headers: customHeaders, skipAuthCheck, method, timeoutMs, signal: callerSignal, ...rest } = options;
	const token = getToken();

	const headers: Record<string, string> = {
		...(customHeaders as Record<string, string>),
	};

	if (token && !skipAuthCheck) {
		headers.Authorization = `Bearer ${token}`;
	}

	if (!isFormData && body) {
		headers['Content-Type'] = 'application/json';
	}

	// Add CSRF token for state-changing requests
	const isStateChanging =
		method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH';
	if (isStateChanging) {
		const csrfToken = await getCsrfToken();
		if (csrfToken) {
			headers['X-CSRF-Token'] = csrfToken;
		}
	}

	// FR-A2 (#1602): a real AbortController bound when the caller sets
	// timeoutMs. The same signal covers the 401-refresh retry below, so the
	// bound applies to the whole call, not just the first attempt.
	const abortCtl = timeoutMs ? new AbortController() : undefined;
	const abortTimer = timeoutMs
		? setTimeout(() => abortCtl?.abort(), timeoutMs)
		: undefined;
	const fetchSignal = abortCtl?.signal ?? callerSignal;

	const fetchOptions: RequestInit = {
		...rest,
		method: method || 'GET',
		headers,
		body: isFormData ? (body as BodyInit) : body ? JSON.stringify(body) : undefined,
		credentials: 'include',
		signal: fetchSignal,
	};

	let res: Response;
	try {
		res = await fetch(`/api${url}`, fetchOptions);

		// If 401, try to refresh token (unless this is an auth endpoint)
		if (res.status === 401 && !skipAuthCheck) {
			const newToken = await refreshAccessToken();
			if (newToken) {
				headers.Authorization = `Bearer ${newToken}`;
				res = await fetch(`/api${url}`, { ...fetchOptions, headers });
			} else {
				clearTokens();
				window.location.href = '/login';
				throw new Error('Session expired');
			}
		}
	} catch (err) {
		if (abortCtl && err instanceof Error && err.name === 'AbortError') {
			const timeoutError = new Error(
				'This is taking longer than expected. Your work may already be saved — please retry.',
			) as Error & { code?: string };
			timeoutError.code = 'TIMEOUT';
			throw timeoutError;
		}
		throw err;
	} finally {
		if (abortTimer) clearTimeout(abortTimer);
	}

	// If 401 on auth endpoint, just throw the error without redirect
	if (res.status === 401 && skipAuthCheck) {
		throw new Error('Invalid credentials');
	}

	if (!res.ok) {
		// #1602: a non-JSON error body (e.g. a proxy error page while the
		// server was busy) previously surfaced as the bare string
		// "Request failed" with no next action. The fallback now says what
		// happened and what to do.
		const errorData = await res
			.json()
			.catch(() => ({ error: 'The server returned an unexpected response. Please try again.' }));
		const error = new Error(errorData.error || `Request failed: ${res.status}`);
		// Attach error code for programmatic handling (e.g., BLOCKED_EMAIL_DOMAIN)
		const code = errorData.code as string | undefined;
		(error as Error & { code?: string }).code = code;
		// Attach HTTP status for programmatic handling (e.g., S-073 graceful
		// degradation on 404 when a backend endpoint is not yet deployed).
		(error as Error & { status?: number }).status = res.status;

		// #1365: preserve the server's retry signal. Retryable failures are
		// thrown (never resolved), so without this a caller's
		// auto-retry-on-503 check can never see retryable/retryAfterMs —
		// e.g. routes/quick-practice.js 503 { retryable: true,
		// retryAfterMs: 3000 }. Attach only when the server actually sent
		// them; never invent a default.
		if (typeof errorData.retryable === 'boolean') {
			(error as Error & { retryable?: boolean }).retryable = errorData.retryable;
		}
		if (typeof errorData.retryAfterMs === 'number') {
			(error as Error & { retryAfterMs?: number }).retryAfterMs = errorData.retryAfterMs;
		}
		// #1606/#1602 (Phase A): preserve the fields a caller needs to offer
		// the honest recovery action — the saved session id when question
		// supply failed at start (resume instead of a dead end), and the
		// answerRecorded flag when a submission's answer is already durable
		// server-side (retry is navigation, not a re-submit).
		if (typeof errorData.sessionId === 'number') {
			(error as Error & { sessionId?: number }).sessionId = errorData.sessionId;
		}
		if (typeof errorData.answerRecorded === 'boolean') {
			(error as Error & { answerRecorded?: boolean }).answerRecorded = errorData.answerRecorded;
		}

		// Consent gate (S-011): redirect to consent screens on 403 consent errors.
		// CONSENT_WITHDRAWN is excluded — the caller shows an inline message instead.
		if (res.status === 403 && isConsentErrorCode(code) && shouldRedirectForConsentCode(code)) {
			const sessionId = extractSessionIdFromRequest(url, body);
			const redirect = getConsentRedirect(code, sessionId);
			if (redirect && typeof window !== 'undefined') {
				window.location.href = redirect;
				// Throw to stop the promise chain; the redirect is already in flight.
				throw error;
			}
		}

		// Flag withdrawn consent so callers can show an inline re-consent message
		// instead of redirecting (the withdrawal was intentional). S-064 (#714):
		// attach the consent type and broadcast an event so any page can render
		// the WithdrawnConsentRecovery UI without touching every catch block.
		if (res.status === 403 && code === 'CONSENT_WITHDRAWN') {
			const consentType = (errorData as { type?: string }).type ?? 'biometric';
			(error as Error & { isConsentWithdrawn?: boolean }).isConsentWithdrawn = true;
			(error as Error & { consentType?: string }).consentType = consentType;
			if (typeof window !== 'undefined') {
				window.dispatchEvent(
					new CustomEvent('consent-withdrawn', {
						detail: {
							consentType,
							sessionId: extractSessionIdFromRequest(url, body),
						},
					}),
				);
			}
		}

		throw error;
	}

	return res.json();
}

export type UserRole = 'candidate' | 'recruiter' | 'hiring_manager' | 'employer' | 'admin';

export interface User {
	id: number;
	email: string;
	name: string;
	role: UserRole;
	company_name?: string;
	company_id?: number | null;
	avatar_url?: string;
	subscriptionTier?: 'free' | 'pro';
	is_company_owner?: boolean;
	is_platform_admin?: boolean;
}

// ── Proctoring API helpers ──

export interface ProctoringSession {
	id: number;
	application_id: number;
	candidate_id: number;
	status: string;
	consent_given: boolean;
	consent_timestamp: string | null;
	started_at: string | null;
	ended_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface ProctoringEvent {
	id: number;
	event_type: string;
	severity: string;
	details: Record<string, unknown>;
	created_at: string;
}

export interface ProctoringFlag {
	id: number;
	flag_type: string;
	description: string;
	severity: string;
	review_decision: string;
	review_notes: string | null;
	reviewer_name: string | null;
	created_at: string;
}

export async function createProctoringSession(
	applicationId: number,
): Promise<{ success: boolean; session: ProctoringSession }> {
	return apiCall(`/proctoring/session`, {
		method: 'POST',
		body: { application_id: applicationId },
	});
}

export async function getProctoringSession(sessionId: number): Promise<{
	success: boolean;
	session: ProctoringSession & {
		candidate_name?: string;
		candidate_email?: string;
		job_title?: string | null;
	};
	events: ProctoringEvent[];
	flags: ProctoringFlag[];
}> {
	return apiCall(`/proctoring/session/${sessionId}`);
}

export async function giveProctoringConsent(
	sessionId: number,
): Promise<{ success: boolean; session: ProctoringSession }> {
	return apiCall(`/proctoring/session/${sessionId}/consent`, {
		method: 'POST',
		body: { consent_given: true },
	});
}

export async function completeProctoringSession(
	sessionId: number,
): Promise<{ success: boolean; session: ProctoringSession }> {
	return apiCall(`/proctoring/session/${sessionId}/complete`, { method: 'POST' });
}

export async function getProctoringFlags(
	status = 'pending',
	limit = 20,
	offset = 0,
): Promise<{
	success: boolean;
	flags: Array<Record<string, unknown>>;
	total: number;
	limit: number;
	offset: number;
}> {
	return apiCall(`/proctoring/flags?status=${status}&limit=${limit}&offset=${offset}`);
}

export async function reviewProctoringFlag(
	flagId: number,
	decision: 'approved' | 'rejected',
	notes = '',
): Promise<{
	success: boolean;
	flag: ProctoringFlag;
}> {
	return apiCall(`/proctoring/flags/${flagId}/review`, {
		method: 'POST',
		body: { decision, notes },
	});
}

export function isRecruiterRole(role: UserRole): boolean {
	return ['employer', 'recruiter', 'hiring_manager', 'admin'].includes(role);
}

export function getDashboardPath(user: User): string {
	// Platform admins bypass company join approval (users.role or user_roles RBAC table)
	if (user.role === 'admin' || user.is_platform_admin) return '/recruiter';
	// #1223: a known company owner is never awaiting join approval — they
	// ARE the approver, even if company_id has not been hydrated yet.
	if (user.is_company_owner) return '/recruiter';
	if (isRecruiterRole(user.role) && !user.company_id) {
		return '/recruiter/pending-approval';
	}
	return isRecruiterRole(user.role) ? '/recruiter' : '/candidate';
}

// ── Cross-tab token sync + proactive refresh on page load ──

if (typeof window !== 'undefined') {
	// Auto-start proactive refresh if a token already exists (e.g., page refresh)
	const existingToken = getToken();
	if (existingToken) {
		startAuthRefresh();
	}

	// Sync proactive refresh timer across tabs via localStorage events
	window.addEventListener('storage', (e) => {
		if (e.key === TOKEN_KEY) {
			if (e.newValue) {
				startAuthRefresh();
			} else {
				stopAuthRefresh();
			}
		}
	});
}

// ── Job Like / Dismiss (Swipe) API helpers ──

export async function likeJob(jobId: number): Promise<void> {
	await apiCall(`/candidate/jobs/${jobId}/like`, { method: 'POST' });
}

export async function unlikeJob(jobId: number): Promise<void> {
	await apiCall(`/candidate/jobs/${jobId}/like`, { method: 'DELETE' });
}

export async function getLikedJobs(): Promise<Array<Record<string, unknown>>> {
	const data = await apiCall<{ jobs: Array<Record<string, unknown>> }>('/candidate/jobs/liked');
	return data.jobs || [];
}

export async function dismissJob(jobId: number): Promise<void> {
	await apiCall(`/candidate/jobs/${jobId}/dismiss`, { method: 'POST' });
}

export async function restoreJob(jobId: number): Promise<void> {
	await apiCall(`/candidate/jobs/${jobId}/dismiss`, { method: 'DELETE' });
}

export async function getDismissedJobs(): Promise<Array<Record<string, unknown>>> {
	const data = await apiCall<{ jobs: Array<Record<string, unknown>> }>('/candidate/jobs/dismissed');
	return data.jobs || [];
}

// Type needed for liked/dismissed job responses
export interface JobActionResponse {
	success: boolean;
	jobs: Array<Record<string, unknown>>;
	liked_jobs?: Array<Record<string, unknown>>;
	dismissed_jobs?: Array<Record<string, unknown>>;
}

// ── Fit Score API helpers ──

export interface FitScoreBreakdown {
	skills: number;
	experience: number;
	location: number;
	salary: number;
	type: number;
}

export interface FitScoreEntry {
	job_id: number;
	fit_score: number;
	breakdown: FitScoreBreakdown;
}

export interface FitScoreResponse {
	success: boolean;
	scores: FitScoreEntry[];
}

export async function getFitScores(jobIds: number[]): Promise<FitScoreEntry[]> {
	if (jobIds.length === 0) return [];
	// Batch in chunks of 50
	const chunks: number[][] = [];
	for (let i = 0; i < jobIds.length; i += 50) {
		chunks.push(jobIds.slice(i, i + 50));
	}
	const results: FitScoreEntry[] = [];
	for (const chunk of chunks) {
		const data = await apiCall<FitScoreResponse>(
			`/candidate/jobs/fit-scores?job_ids=${chunk.join(',')}`,
		);
		if (data.scores) {
			results.push(...data.scores);
		}
	}
	return results;
}

export async function getFitScore(jobId: number): Promise<FitScoreEntry | null> {
	try {
		const data = await apiCall<FitScoreResponse>(`/candidate/jobs/${jobId}/fit-score`);
		return data.scores?.[0] ?? null;
	} catch {
		return null;
	}
}
