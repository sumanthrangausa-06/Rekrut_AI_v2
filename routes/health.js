const express = require('express');
const router = express.Router();

// GET /api/health — basic health check with DB connectivity
router.get('/', async (_req, res) => {
	const HEALTH_TIMEOUT_MS = 3000;
	let responded = false;

	const timeout = setTimeout(() => {
		if (!responded) {
			responded = true;
			res.status(200).json({
				status: 'degraded',
				timestamp: new Date().toISOString(),
				db: { connected: false, error: 'Health check timed out' },
				issues: { healthCheckTimeout: true },
			});
		}
	}, HEALTH_TIMEOUT_MS);

	try {
		const { runHealthCheck } = require('../lib/db-health');
		const health = await runHealthCheck();
		if (responded) return;
		clearTimeout(timeout);
		res.status(200).json({
			status: health.healthy ? 'ok' : 'degraded',
			timestamp: new Date().toISOString(),
			db: health.connection,
			tables: health.tables,
			pool: health.pool,
			env: health.env,
			issues: health.issues,
		});
	} catch (_err) {
		if (responded) return;
		clearTimeout(timeout);
		res.status(200).json({
			status: 'degraded',
			timestamp: new Date().toISOString(),
			db: { connected: false, error: 'Health check failed' },
			issues: { healthCheckError: true },
		});
	}
});

module.exports = router;
