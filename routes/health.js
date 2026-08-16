const express = require('express');
const router = express.Router();

// GET /api/health — basic health check (no auth required)
router.get('/', async (_req, res) => {
	try {
		// Simple DB connectivity check via existing pool if available
		const { pool } = require('../lib/db');
		if (pool) {
			await pool.query('SELECT 1');
		}
		res.status(200).json({
			status: 'ok',
			db: 'connected',
			timestamp: new Date().toISOString(),
		});
	} catch (_err) {
		res.status(200).json({
			status: 'ok',
			db: 'disconnected',
			timestamp: new Date().toISOString(),
		});
	}
});

module.exports = router;
