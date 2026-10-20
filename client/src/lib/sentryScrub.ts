/**
 * sentryScrub — #1180 item (2): client mirror of lib/sentry-scrub.js.
 *
 * ponytail: deliberate small duplication — Vite cannot import the server
 * CJS helper from lib/ into the browser bundle. Keep the two in sync;
 * the server suite (server/__tests__/lib/sentry-scrub-1180.test.js) pins
 * the shared contract, and the source pins pin this file's wiring.
 *
 * Same fail-closed contract: credentials, emails, IPs, signed URLs,
 * request bodies/env and transcript/CV free text never leave the browser
 * in a Sentry event. Unscrubbable events are dropped (null), never raw.
 */
const REDACTED = '[REDACTED]';
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const BASIC_RE = /\bBasic\s+[A-Za-z0-9+/=]+/gi;
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g;
const VENDOR_TOKEN_RE =
	/\b(?:ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|npm_[A-Za-z0-9]{16,}|SG\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|xox[baprs]-[A-Za-z0-9-]{8,}|AIza[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16})\b/g;
const PHONE_RE = /\+\d[\d\s()-]{7,}\d/g;
const CARD_RE = /\b\d{4} \d{4} \d{4} \d{4}\b/g;
const ENCODED_EMAIL_RE = /[A-Za-z0-9._+-]+%40[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi;
const URL_RE = /(?:https?:\/\/|\/)[^\s"']+/g;
const URI_USERINFO_RE = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s"']+@/gi;
const IPV6_RE = /\b(?:(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}|[0-9a-fA-F]{0,4}::[0-9a-fA-F:]{1,24})\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
// key<sep>value candidates in free text: sep is `=`, `:` or the
// URL-encoded `%3D` (any case); the key may be quoted (JSON style) and
// the value may be quoted. A candidate is redacted only when its key is
// credential-bearing BY COMPONENT (isCredentialKey) — a plain substring
// match over-redacts benign compounds (session_count, tokenizer_count).
const KV_CRED_RE =
	/(["']?)([A-Za-z][A-Za-z0-9_-]*)\1(\s*)(=|%3d|:)(\s*)(?!\/\/)("[^"]*"|'[^']*'|[^\s;&]+)/gi;
// Sensitive key COMPONENTS (split on _ / - / camelCase, exact match):
// session_id qualifies via `id`, secret_key via `key`, token_id via
// `id`. `session` is NOT sensitive by itself (session_count is a count,
// not a credential) — it qualifies only as the head (last) component,
// where the value IS a session (app_session, session: …).
const KV_SENSITIVE_COMPONENTS = new Set([
	'token',
	'secret',
	'password',
	'passwd',
	'pwd',
	'pw',
	'cookie',
	'sid',
	'apikey',
	'key',
	'hash',
	'id',
	'auth',
	'credential',
	'credentials',
	'otp',
	'pin',
	'jwt',
]);

function isCredentialKey(key: string): boolean {
	const parts = key
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.toLowerCase()
		.split(/[_\-\s]+/)
		.filter(Boolean);
	return (
		parts.some((p) => KV_SENSITIVE_COMPONENTS.has(p)) || parts[parts.length - 1] === 'session'
	);
}

function kvCredReplacer(
	match: string,
	quote: string,
	key: string,
	pre: string,
	sep: string,
	post: string,
	value: string,
): string {
	if (!isCredentialKey(key)) return match;
	const vq = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : '';
	return `${quote}${key}${quote}${pre}${sep}${post}${vq}${REDACTED}${vq}`;
}
const SK_KEY_RE = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+|\bsk-[A-Za-z0-9_-]{10,}/g;
const LONG_TEXT_LIMIT = 100;
const MAX_DEPTH = 8;

const SENSITIVE_SUBSTRINGS = [
	'transcript',
	'password',
	'secret',
	'token',
	'cookie',
	'authorization',
	'apikey',
	'email',
	'signedurl',
	'resume',
	'credential',
	'privatekey',
	'jwt',
	'ssn',
	'phone',
	'session',
	'bearer',
	'pass',
	'auth',
	'otp',
	'accesskey',
	'verification',
	'cardnumber',
	'iban',
	'private',
];
const SENSITIVE_EXACT = new Set(['cv', 'pwd', 'pin', 'key']);
const USER_DROP_KEYS = new Set(['email', 'ipaddress', 'username', 'name']);
const DROP_VALUE_KEYS = new Set(['vars', 'contextline', 'precontext', 'postcontext']);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const HEADER_ALLOWLIST = new Set([
	'contenttype',
	'contentlength',
	'useragent',
	'accept',
	'acceptencoding',
	'acceptlanguage',
	'host',
	'referer',
	'xrequestid',
]);

function canonical(key: string): string {
	return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
	const c = canonical(key);
	return SENSITIVE_EXACT.has(c) || SENSITIVE_SUBSTRINGS.some((s) => c.includes(s));
}

function isSensitiveHeader(key: string): boolean {
	return !HEADER_ALLOWLIST.has(canonical(key));
}

const TOKEN_PATH_PREV = new Set([
	'token',
	'bytoken',
	'session',
	'invite',
	'resetpassword',
	'reset',
	'verify',
	'magic',
	'magiclink',
	'result',
	'screening',
	'auth',
	'link',
	'callback',
]);

function isTokenShaped(seg: string): boolean {
	return seg.length >= 12 && /^[A-Za-z0-9_-]+$/.test(seg) && /[A-Za-z]/.test(seg) && /\d/.test(seg);
}

function redactParamList(s: string): string {
	return s
		.split('&')
		.map((p) => {
			const eq = p.indexOf('=');
			if (eq !== -1) return `${p.slice(0, eq)}=${REDACTED}`;
			return p.length >= 8 && isTokenShaped(p) ? REDACTED : p;
		})
		.join('&');
}

function redactUrl(url: string): string {
	let main = url;
	let frag: string | null = null;
	const h = url.indexOf('#');
	if (h !== -1) {
		frag = url.slice(h + 1);
		main = url.slice(0, h);
	}
	let query: string | null = null;
	let path = main;
	const q = main.indexOf('?');
	if (q !== -1) {
		query = main.slice(q + 1);
		path = main.slice(0, q);
	}
	const segs = path.split('/');
	for (let i = 1; i < segs.length; i++) {
		if (isTokenShaped(segs[i]) && TOKEN_PATH_PREV.has(canonical(segs[i - 1]))) segs[i] = REDACTED;
	}
	let out = segs.join('/');
	if (query !== null) out += `?${redactParamList(query)}`;
	if (frag !== null) out += `#${redactParamList(frag)}`;
	return out;
}

function scrubString(value: string): string {
	return value
		.replace(URL_RE, (url) => redactUrl(url))
		.replace(URI_USERINFO_RE, `$1${REDACTED}@`)
		.replace(SK_KEY_RE, REDACTED)
		.replace(BEARER_RE, `Bearer ${REDACTED}`)
		.replace(BASIC_RE, `Basic ${REDACTED}`)
		.replace(JWT_RE, REDACTED)
		.replace(VENDOR_TOKEN_RE, REDACTED)
		.replace(KV_CRED_RE, kvCredReplacer)
		.replace(CARD_RE, REDACTED)
		.replace(PHONE_RE, REDACTED)
		.replace(ENCODED_EMAIL_RE, REDACTED)
		.replace(SSN_RE, REDACTED)
		.replace(EMAIL_RE, REDACTED)
		.replace(IPV4_RE, REDACTED)
		.replace(IPV6_RE, REDACTED);
}

function scrubValue(value: unknown, depth: number, seen: Set<object>, inFreeTextZone: boolean): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === 'number' || typeof value === 'boolean') return value;
	if (depth > MAX_DEPTH) return REDACTED;
	if (typeof value === 'string') {
		if (inFreeTextZone || value.length > LONG_TEXT_LIMIT) return REDACTED;
		return scrubString(value);
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) throw new Error('circular');
		seen.add(value);
		try {
			return value.map((v) => scrubValue(v, depth + 1, seen, inFreeTextZone));
		} finally {
			seen.delete(value);
		}
	}
	if (typeof value === 'object') {
		if (seen.has(value)) throw new Error('circular');
		seen.add(value);
		try {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(value)) {
				if (DANGEROUS_KEYS.has(k)) continue;
				const isEmailKey = EMAIL_RE.test(k);
				EMAIL_RE.lastIndex = 0;
				out[isEmailKey ? REDACTED : k] =
					DROP_VALUE_KEYS.has(canonical(k)) || isSensitiveKey(k)
						? REDACTED
						: scrubValue(v, depth + 1, seen, inFreeTextZone);
			}
			return out;
		} finally {
			seen.delete(value);
		}
	}
	return REDACTED;
}

export function scrubSentryEvent<T>(event: T): T | null {
	if (event === null || event === undefined || typeof event !== 'object') return null;
	try {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(event)) {
			if (DANGEROUS_KEYS.has(key)) continue;
			if (key === 'request' && value && typeof value === 'object') {
				const req: Record<string, unknown> = {};
				for (const [rk, rv] of Object.entries(value)) {
					if (DANGEROUS_KEYS.has(rk)) continue;
					const c = canonical(rk);
					if (c === 'data' || c === 'cookies' || c === 'env') continue;
					if (c === 'headers' && rv && typeof rv === 'object') {
						const headers: Record<string, unknown> = {};
						for (const [hk, hv] of Object.entries(rv)) {
							headers[hk] = isSensitiveHeader(hk) ? REDACTED : scrubValue(hv, 1, new Set(), false);
						}
						req[rk] = headers;
					} else if (c === 'querystring') {
						if (typeof rv === 'string') {
							req[rk] = redactParamList(rv);
						} else if (Array.isArray(rv)) {
							req[rk] = rv.map((pair) =>
								Array.isArray(pair) && pair.length >= 2 ? [pair[0], REDACTED] : scrubValue(pair, 1, new Set(), false),
							);
						} else if (rv && typeof rv === 'object') {
							const qs: Record<string, unknown> = {};
							for (const qk of Object.keys(rv)) qs[qk] = REDACTED;
							req[rk] = qs;
						} else {
							req[rk] = scrubValue(rv, 1, new Set(), false);
						}
					} else {
						req[rk] = scrubValue(rv, 1, new Set(), false);
					}
				}
				out[key] = req;
			} else if (key === 'user' && value && typeof value === 'object') {
				const user: Record<string, unknown> = {};
				for (const [uk, uv] of Object.entries(value)) {
					if (DANGEROUS_KEYS.has(uk)) continue;
					if (USER_DROP_KEYS.has(canonical(uk))) continue;
					user[uk] = isSensitiveKey(uk) ? REDACTED : scrubValue(uv, 1, new Set(), false);
				}
				out[key] = user;
			} else if (key === 'breadcrumbs' || key === 'extra') {
				out[key] = scrubValue(value, 1, new Set(), true);
			} else if (isSensitiveKey(key)) {
				out[key] = REDACTED;
			} else {
				out[key] = scrubValue(value, 1, new Set(), false);
			}
		}
		return out as T;
	} catch {
		return null;
	}
}
