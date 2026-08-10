/**
 * Prometheus Metrics Middleware
 *
 * Provides foundational Prometheus metrics for the Express server.
 * Phase 1 of observability implementation (Issue #144).
 *
 * Metrics exposed:
 *   - http_request_duration_seconds (Histogram) — request latency
 *   - http_requests_total (Counter) — total requests by method, route, status
 *   - http_errors_total (Counter) — 4xx/5xx errors by method, route, status
 *
 * GET /metrics returns the Prometheus scrape format.
 */

const client = require('prom-client');

// ─── Prometheus Registry ──────────────────────────────────────────────────
const register = new client.Registry();

// ─── Metric Definitions ───────────────────────────────────────────────────
const httpRequestDurationSeconds = new client.Histogram({
	name: 'http_request_duration_seconds',
	help: 'Duration of HTTP requests in seconds',
	labelNames: ['method', 'route', 'status_code'],
	buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
	registers: [register],
});

const httpRequestsTotal = new client.Counter({
	name: 'http_requests_total',
	help: 'Total number of HTTP requests',
	labelNames: ['method', 'route', 'status_code'],
	registers: [register],
});

const httpErrorsTotal = new client.Counter({
	name: 'http_errors_total',
	help: 'Total number of HTTP errors (4xx and 5xx)',
	labelNames: ['method', 'route', 'status_code'],
	registers: [register],
});

// ─── Middleware ───────────────────────────────────────────────────────────

/**
 * Express middleware that measures request duration and increments
 * request/error counters.  Place early in the middleware chain
 * (after CORS, before routes) for the most accurate timing.
 */
function prometheusMiddleware(req, res, next) {
	const start = process.hrtime.bigint();

	res.on('finish', () => {
		const duration = Number(process.hrtime.bigint() - start) / 1e9; // seconds
		const statusCode = res.statusCode.toString();
		const route = req.route?.path || req.path.replace(/\/\d+/g, '/:id');

		httpRequestDurationSeconds
			.labels(req.method, route, statusCode)
			.observe(duration);

		httpRequestsTotal
			.labels(req.method, route, statusCode)
			.inc();

		if (res.statusCode >= 400) {
			httpErrorsTotal
				.labels(req.method, route, statusCode)
				.inc();
		}
	});

	next();
}

// ─── Metrics Endpoint Handler ─────────────────────────────────────────────

/**
 * GET /metrics handler — returns the current registry output in
 * Prometheus text format.  Designed to be scraped by a Prometheus
 * server; keep this endpoint open (no auth required).
 */
async function metricsHandler(_req, res) {
	res.set('Content-Type', register.contentType);
	res.end(await register.metrics());
}

module.exports = {
	middleware: prometheusMiddleware,
	metricsHandler,
	register,
};
