/**
 * sentry-scrub — #1180 item (2): pre-enablement hardening for Sentry.
 *
 * Sentry currently has NO DSN on any deployed service (dark everywhere),
 * but the init code exists. This `beforeSend` / `beforeSendTransaction`
 * guarantees a future DSN can never be set unsafely: no event leaves the
 * process carrying the GAP-J never-write classes — credentials, emails,
 * IP addresses, signed URLs, request bodies, or interview transcript /
 * CV free text.
 *
 * Contract (fail-closed; hardened after privacy-engineer BLOCK review):
 *  - Returns a scrubbed COPY; the input event is never mutated.
 *  - request.data (bodies), request.cookies and request.env (the
 *    process environment: DATABASE_URL, SMTP_PASS, …) are dropped
 *    outright — structurally, not by name list.
 *  - Headers are ALLOWLISTED (content-type, user-agent, accept, host,
 *    …): every other header's value is replaced with '[REDACTED]'.
 *  - Stacktrace frame `vars` and `context_line` values are never
 *    forwarded: locals are named for the app's convenience, not the
 *    scrubber's, so no name list can cover them.
 *  - In every URL string and in request.query_string, EVERY query-param
 *    value is redacted, whatever the param is called (access_token,
 *    X-Amz-Signature, sig, otp, or the next name); paths survive.
 *  - user.email, user.ip_address, user.username and user.name are
 *    removed. user.id SURVIVES by explicit decision: it is the internal
 *    correlation id support needs to find a user's errors; it is not a
 *    hash or fingerprint of anything (GAP-J R-3(c) bans those).
 *  - Any key whose canonical name matches the sensitive list (transcript,
 *    password, secret, token, cookie, authorization, apikey, email,
 *    resume, credential, privatekey, jwt, ssn, phone, session, signedurl,
 *    or exactly `cv`) has its value replaced with '[REDACTED]', any depth.
 *    Object KEYS that are themselves email-shaped are renamed '[REDACTED]'.
 *  - Any string, at any depth: email-shaped substrings, IPv4 addresses,
 *    Bearer/Basic credentials, JWTs, and URLs carrying a sensitive query
 *    param (signature / credential / token / secret / session / key /
 *    auth / sig / X-Amz-*) are redacted in place. `key<sep>value`
 *    credentials in free text are redacted for sep `=`, `:` and `%3D`,
 *    when the key is credential-bearing by component (token_id,
 *    secret_key, password_hash, session_id, …) — benign compounds
 *    (session_count, tokenizer_count) and token-count prose survive.
 *  - Free text: strings inside `breadcrumbs` and `extra` are replaced
 *    wholesale (any length — those fields are arbitrary app content,
 *    where transcript fragments and chunked fragments leak; numbers and
 *    booleans survive so the event stays debuggable). Everywhere else,
 *    strings longer than 100 chars are replaced wholesale: a long string
 *    in an error event is prose (transcript, CV, prompt), not an
 *    identifier. RESIDUAL RISKS, stated plainly: (a) a SHORT (<100 char)
 *    transcript fragment under an innocuous key outside breadcrumbs /
 *    extra (e.g. a terse exception message) cannot be detected by any
 *    pattern scrubber and may survive; (b) a token carried as a URL path
 *    segment after an innocuous segment name (not in TOKEN_PATH_PREV)
 *    may survive — replay recordings have the same class of residual
 *    for element attributes and page URLs (see client/src/main.tsx);
 *    that is why DSN enablement still requires the item-(3)
 *    vendor/retention review on #1180.
 *  - Unscrubbable events (circular graphs, runaway depth) are DROPPED
 *    (return null) — never passed through raw.
 *  - No hash of any redacted value is ever substituted (GAP-J R-3(c)):
 *    a hash is a stable identifier, not minimisation.
 *
 * Standalone module (no requires), following lib/erasureResultSanitizer.js.
 * Client mirror: client/src/lib/sentryScrub.ts (ponytail: deliberate small
 * duplication — Vite cannot import server CJS from lib/; keep them in sync).
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
const IPV6_RE =
	/\b(?:(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}|[0-9a-fA-F]{0,4}::[0-9a-fA-F:]{1,24})\b/g;
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

function isCredentialKey(key) {
	const parts = key
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.toLowerCase()
		.split(/[_\-\s]+/)
		.filter(Boolean);
	return (
		parts.some((p) => KV_SENSITIVE_COMPONENTS.has(p)) || parts[parts.length - 1] === 'session'
	);
}

function kvCredReplacer(match, quote, key, pre, sep, post, value) {
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
// Structural (not name-based) rules, per security review round 3:
// frame locals and source context lines can carry anything under any
// name — their VALUES are never forwarded.
const DROP_VALUE_KEYS = new Set(['vars', 'contextline', 'precontext', 'postcontext']);
// Prototype-safety (#1177 pattern): these keys are dropped from copies.
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Headers are ALLOWLISTED, not denylisted: a denylist misses the next
// custom auth header; an allowlist cannot.
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

function canonical(key) {
	return String(key)
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key) {
	const c = canonical(key);
	return SENSITIVE_EXACT.has(c) || SENSITIVE_SUBSTRINGS.some((s) => c.includes(s));
}

function isSensitiveHeader(key) {
	// Non-allowlisted headers are redacted wholesale (value never kept).
	return !HEADER_ALLOWLIST.has(canonical(key));
}

// Path segments after these names are bearer-equivalent in this app
// (routes/interviews.js `/screening/session/:token`, interview-sessions
// `/by-token/:token`, sandbox `/result/:token`) or in reset/invite links.
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

function isTokenShaped(seg) {
	return seg.length >= 12 && /^[A-Za-z0-9_-]+$/.test(seg) && /[A-Za-z]/.test(seg) && /\d/.test(seg);
}

function redactParamList(s) {
	return s
		.split('&')
		.map((p) => {
			const eq = p.indexOf('=');
			if (eq !== -1) return `${p.slice(0, eq)}=${REDACTED}`;
			return p.length >= 8 && isTokenShaped(p) ? REDACTED : p;
		})
		.join('&');
}

function redactUrl(url) {
	// Every query-param AND fragment-param VALUE is redacted, whatever
	// the param is called (OAuth implicit flow puts tokens in #fragments);
	// token-shaped path segments after token-named segments are redacted;
	// the rest of the path (route shape) survives for debuggability.
	let main = url;
	let frag = null;
	const h = url.indexOf('#');
	if (h !== -1) {
		frag = url.slice(h + 1);
		main = url.slice(0, h);
	}
	let query = null;
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

function scrubString(value) {
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

function scrubValue(value, depth, seen, inFreeTextZone) {
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
			const out = {};
			for (const [k, v] of Object.entries(value)) {
				if (DANGEROUS_KEYS.has(k)) continue;
				const outKey = EMAIL_RE.test(k) ? REDACTED : k;
				EMAIL_RE.lastIndex = 0;
				out[outKey] =
					DROP_VALUE_KEYS.has(canonical(k)) || isSensitiveKey(k)
						? REDACTED
						: scrubValue(v, depth + 1, seen, inFreeTextZone);
			}
			return out;
		} finally {
			seen.delete(value);
		}
	}
	// functions / symbols / bigint etc.: never forwarded
	return REDACTED;
}

function scrubRequest(req) {
	const out = {};
	for (const [rk, rv] of Object.entries(req)) {
		if (DANGEROUS_KEYS.has(rk)) continue;
		const c = canonical(rk);
		// bodies, cookies and the process env (DATABASE_URL, SMTP_PASS, …)
		// are never sent — env is dropped structurally, not by name list.
		if (c === 'data' || c === 'cookies' || c === 'env') continue;
		if (c === 'headers' && rv && typeof rv === 'object') {
			const headers = {};
			for (const [hk, hv] of Object.entries(rv)) {
				headers[hk] = isSensitiveHeader(hk) ? REDACTED : scrubValue(hv, 1, new Set(), false);
			}
			out[rk] = headers;
		} else if (c === 'querystring') {
			// Every value redacted, whatever the param is called — in the
			// string form AND the protocol's object / [key,value]-pair
			// forms (privacy F-13).
			if (typeof rv === 'string') {
				out[rk] = redactParamList(rv);
			} else if (Array.isArray(rv)) {
				out[rk] = rv.map((pair) =>
					Array.isArray(pair) && pair.length >= 2
						? [pair[0], REDACTED]
						: scrubValue(pair, 1, new Set(), false),
				);
			} else if (rv && typeof rv === 'object') {
				const qs = {};
				for (const qk of Object.keys(rv)) qs[qk] = REDACTED;
				out[rk] = qs;
			} else {
				out[rk] = scrubValue(rv, 1, new Set(), false);
			}
		} else {
			out[rk] = scrubValue(rv, 1, new Set(), false);
		}
	}
	return out;
}

function scrubUser(user) {
	const out = {};
	for (const [uk, uv] of Object.entries(user)) {
		if (DANGEROUS_KEYS.has(uk)) continue;
		if (USER_DROP_KEYS.has(canonical(uk))) continue;
		out[uk] = isSensitiveKey(uk) ? REDACTED : scrubValue(uv, 1, new Set(), false);
	}
	return out;
}

function scrubSentryEvent(event) {
	// SDK contract: beforeSend returns a valid event or null (drop).
	if (event === null || event === undefined || typeof event !== 'object') return null;
	try {
		const out = {};
		for (const [key, value] of Object.entries(event)) {
			if (DANGEROUS_KEYS.has(key)) continue;
			if (key === 'request' && value && typeof value === 'object') {
				out[key] = scrubRequest(value);
			} else if (key === 'user' && value && typeof value === 'object') {
				out[key] = scrubUser(value);
			} else if (key === 'breadcrumbs' || key === 'extra') {
				out[key] = scrubValue(value, 1, new Set(), true);
			} else if (isSensitiveKey(key)) {
				out[key] = REDACTED;
			} else {
				out[key] = scrubValue(value, 1, new Set(), false);
			}
		}
		return out;
	} catch {
		// Fail closed: an event we cannot prove clean is dropped, not sent.
		return null;
	}
}

module.exports = { scrubSentryEvent, REDACTED };
