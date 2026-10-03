/**
 * Content Security Policy middleware
 *
 * Applies a strict CSP to all responses.  Headers are delivered via
 * helmet.contentSecurityPolicy when helmet is present, otherwise we fall back
 * to a manual header setter.
 *
 * The policy is intentionally strict — inline scripts/styles must use nonces
 * or hashes, and 'unsafe-inline' is avoided where possible.
 */

function cspMiddleware(req, res, next) {
	const nonce = require('node:crypto').randomBytes(16).toString('base64');
	res.locals.cspNonce = nonce;

	const directives = {
		defaultSrc: ["'self'"],
		scriptSrc: [
			"'self'",
			// Vite dev server (development only)
			...(process.env.NODE_ENV !== 'production' ? ["'unsafe-eval'"] : []),
			// Allow scripts with a nonce (set on <script nonce="..."> tags)
			(_req, res) => `'nonce-${res.locals.cspNonce}'`,
			// Google OAuth (if used)
			'https://accounts.google.com',
			'https://apis.google.com',
		],
		styleSrc: [
			"'self'",
			"'unsafe-inline'", // Required for Tailwind / emotion / styled-components
			'https://fonts.googleapis.com',
		],
		imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
		fontSrc: ["'self'", 'https://fonts.gstatic.com'],
		connectSrc: [
			"'self'",
			// AI service endpoints
			process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com',
			// OAuth providers
			'https://www.googleapis.com',
			'https://api.linkedin.com',
			// Analytics (if added later)
		],
		frameSrc: [
			"'self'",
			// Jitsi Meet for video interviews
			'https://meet.jit.si',
			// OAuth popups
			'https://accounts.google.com',
		],
		objectSrc: ["'none'"],
		baseUri: ["'self'"],
		formAction: ["'self'"],
		frameAncestors: ["'none'"],
		upgradeInsecureRequests: [],
	};

	// Build the header string manually for maximum compatibility
	const directiveStrings = Object.entries(directives)
		.map(([key, values]) => {
			const resolvedValues = values
				.map((v) => {
					if (typeof v === 'function') {
						try {
							return v(req, res);
						} catch (_e) {
							return '';
						}
					}
					return v;
				})
				.filter(Boolean);
			if (resolvedValues.length === 0) return null;
			const kebabKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
			return `${kebabKey} ${resolvedValues.join(' ')}`;
		})
		.filter(Boolean);

	res.setHeader('Content-Security-Policy', directiveStrings.join('; '));

	// Additional security headers that complement CSP
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
	res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

	next();
}

module.exports = { cspMiddleware };
