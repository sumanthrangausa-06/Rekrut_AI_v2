#!/usr/bin/env node
/**
 * Rekrut AI — Health Check Script (Issue #51)
 *
 * Pings /health and /api/health, logs results with timestamps,
 * exits with error code on failure (for cron/CI use).
 *
 * Usage:
 *   node scripts/health-check.js
 *   HEALTH_URL=https://rekrutai.co/health API_URL=https://rekrutai.co/api/health node scripts/health-check.js
 */

const http = require('node:http');
const https = require('node:https');

const HEALTH_URL = process.env.HEALTH_URL || 'http://localhost:3000/health';
const API_URL = process.env.API_URL || 'http://localhost:3000/api/health';
const TIMEOUT_MS = parseInt(process.env.HEALTH_TIMEOUT_MS || '10000', 10);

function fetchJson(url) {
	return new Promise((resolve, reject) => {
		const client = url.startsWith('https:') ? https : http;
		const start = Date.now();
		const req = client.get(url, { timeout: TIMEOUT_MS }, (res) => {
			let body = '';
			res.on('data', (chunk) => {
				body += chunk;
			});
			res.on('end', () => {
				const ms = Date.now() - start;
				let json = null;
				try {
					json = JSON.parse(body);
				} catch {
					/* ignore parse errors */
				}
				resolve({ statusCode: res.statusCode, ms, body: json, raw: body });
			});
		});
		req.on('error', reject);
		req.on('timeout', () => {
			req.destroy();
			reject(new Error(`Request timed out after ${TIMEOUT_MS}ms`));
		});
	});
}

function log(level, msg) {
	const ts = new Date().toISOString();
	console.log(`[${ts}] [${level.toUpperCase()}] ${msg}`);
}

async function check(name, url) {
	try {
		const res = await fetchJson(url);
		const ok = res.statusCode >= 200 && res.statusCode < 300;
		const healthy = ok && (res.body?.status === 'ok' || res.body?.db?.connected);
		const degraded = ok && res.body?.status === 'degraded';

		if (healthy) {
			log('ok', `${name}: HTTP ${res.statusCode} in ${res.ms}ms — status: ok`);
			return true;
		}
		if (degraded) {
			log('warn', `${name}: HTTP ${res.statusCode} in ${res.ms}ms — status: degraded`);
			if (res.body?.issues) {
				log('warn', `${name} issues: ${JSON.stringify(res.body.issues)}`);
			}
			return true; // degraded is not a failure for cron — still up
		}
		log('error', `${name}: HTTP ${res.statusCode} in ${res.ms}ms — unhealthy`);
		if (res.body) {
			log('error', `${name} body: ${JSON.stringify(res.body).slice(0, 500)}`);
		}
		return false;
	} catch (err) {
		log('error', `${name}: ${err.message}`);
		return false;
	}
}

async function main() {
	log('info', `Starting health check — HEALTH_URL=${HEALTH_URL}, API_URL=${API_URL}`);

	const results = await Promise.all([check('health', HEALTH_URL), check('api-health', API_URL)]);

	const allOk = results.every(Boolean);
	if (allOk) {
		log('info', 'All health checks passed.');
		process.exit(0);
	}
	log('error', 'One or more health checks failed.');
	process.exit(1);
}

main();
