/**
 * #1445 — shared NO_PROXY handling for the provider proxy agents.
 *
 * https-proxy-agent 7.0.6 has no NO_PROXY support (measured at #1445
 * STOP 1: source grep zero hits; a request to a NO_PROXY-listed host
 * still CONNECTs through the proxy), so the SDK httpAgent family in
 * lib/ai-provider.js, lib/polsia-ai.js and lib/qp-provider.js bypassed
 * nothing. This module is the ONE shared implementation for that family
 * (the drift between the three forked copies is what produced
 * #1414/#1418/#1419). The raw-fetch path does NOT use this module:
 * ai-provider installs undici's EnvHttpProxyAgent as the global
 * dispatcher, which implements the same conventions itself.
 *
 * Matching follows the proxy-from-env / WHATWG conventions:
 *  - value from `no_proxy` ?? `NO_PROXY` (lowercase first, matching
 *    undici's EnvHttpProxyAgent and proxy-from-env);
 *  - comma/whitespace-separated list, case-insensitive;
 *  - an entry matches the host itself and any subdomain of it
 *    (leading `.` or `*.` on the entry is stripped);
 *  - `*` bypasses every host;
 *  - an entry with `:port` matches only that port;
 *  - a scheme prefix on an entry (`http://host`) is tolerated.
 * Nothing here logs the proxy URL or the NO_PROXY value (#1418 rule).
 */
const http = require('node:http');
const https = require('node:https');
const { HttpsProxyAgent } = require('https-proxy-agent');

function parseNoProxyEntry(raw) {
	let entry = String(raw).trim().toLowerCase();
	if (!entry) return null;
	entry = entry.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0];
	let hostname = entry;
	let port = 0;
	const ipv6WithPort = entry.match(/^\[(.+)\]:(\d+)$/);
	if (ipv6WithPort) {
		hostname = ipv6WithPort[1];
		port = parseInt(ipv6WithPort[2], 10);
	} else {
		const unbracketed = entry.replace(/^\[(.+)\]$/, '$1');
		const colonCount = (unbracketed.match(/:/g) || []).length;
		const parsed = colonCount === 1 && unbracketed.match(/^(.+):(\d+)$/);
		hostname = parsed ? parsed[1] : unbracketed;
		port = parsed ? parseInt(parsed[2], 10) : 0;
	}
	return { hostname: hostname.replace(/^\*?\./, ''), port };
}

function shouldBypassProxy(hostname, port) {
	const value = process.env.no_proxy ?? process.env.NO_PROXY ?? '';
	if (!value.trim()) return false;
	if (value.trim() === '*') return true;
	let host = String(hostname || '')
		.toLowerCase()
		.replace(/^\[(.+)\]$/, '$1');
	// A host argument may arrive as host:port (no separate port given);
	// strip the port only when there is exactly one colon (not IPv6).
	if ((host.match(/:/g) || []).length === 1) host = host.replace(/:\d*$/, '');
	const reqPort = port ? parseInt(port, 10) : 0;
	for (const raw of value.split(/[,\s]+/)) {
		const entry = parseNoProxyEntry(raw);
		if (!entry || !entry.hostname) continue;
		if (entry.hostname === '*') return true;
		if (entry.port && entry.port !== reqPort) continue;
		if (host === entry.hostname) return true;
		if (host.slice(-(entry.hostname.length + 1)) === `.${entry.hostname}`) return true;
	}
	return false;
}

// Direct agents handed back for bypassed hosts — agent-base's createSocket
// delegates to `addRequest` when connect() resolves to an Agent instance,
// which is the documented pass-through pattern for proxy agents.
const directHttpAgent = new http.Agent();
const directHttpsAgent = new https.Agent();

class NoProxyHttpsProxyAgent extends HttpsProxyAgent {
	async connect(req, opts) {
		if (shouldBypassProxy(opts.host, opts.port)) {
			return this.isSecureEndpoint(opts) ? directHttpsAgent : directHttpAgent;
		}
		return super.connect(req, opts);
	}
}

module.exports = { shouldBypassProxy, NoProxyHttpsProxyAgent };
