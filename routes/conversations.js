// Conversations / Chat Routes (stub — Issue #114)
const express = require('express');
const { authMiddleware } = require('../lib/auth');

const router = express.Router();

// GET /api/conversations/:id/messages
router.get('/:id/messages', authMiddleware, async (req, res) => {
	res.json({ messages: [] });
});

module.exports = router;
