/**
 * Notification Routes — Email notification management API
 *
 * Endpoints:
 * - POST /api/notifications/send - Send a notification
 * - POST /api/notifications/queue - Queue a notification for later
 * - GET /api/notifications/history - Get notification history
 * - GET /api/notifications/preferences - Get user preferences
 * - PUT /api/notifications/preferences - Update user preferences
 * - GET /api/notifications/templates - List templates
 * - POST /api/notifications/templates - Create template (admin)
 * - GET /api/notifications/stats - Get statistics (admin)
 * - POST /api/notifications/test - Send test email
 */

const express = require('express');
const _path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const emailService = require('../lib/email-service');

const router = express.Router();

// ─── Helper Middleware ─────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
	if (req.user.role !== 'admin') {
		return res.status(403).json({ error: 'Admin access required' });
	}
	next();
}

function requireRecruiter(req, res, next) {
	if (
		!req.user.company_id ||
		!['recruiter', 'hiring_manager', 'employer', 'admin'].includes(req.user.role)
	) {
		return res.status(403).json({ error: 'Recruiter access required' });
	}
	next();
}

// ─── Send Notification ─────────────────────────────────────────────────────

/**
 * POST /api/notifications/send
 * Send an email notification to a candidate or user
 *
 * Body:
 * - to: string (email address)
 * - template: string (template name)
 * - data: object (template variables)
 * - subject: string (optional override)
 * - body: string (optional override)
 * - user_id: number (optional, for logging)
 */
router.post('/send', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { to, template, data, subject, body, user_id, metadata } = req.body;

		if (!to) {
			return res.status(400).json({ error: 'Recipient email (to) is required' });
		}

		if (!template && !body) {
			return res.status(400).json({ error: 'Either template name or body is required' });
		}

		// Check if recipient user has notifications enabled
		if (user_id) {
			const canSend = await emailService.canSendToUser(user_id, template || 'custom');
			if (!canSend) {
				return res.status(200).json({
					success: false,
					skipped: true,
					reason: 'User has disabled this notification type',
				});
			}
		}

		let result;
		if (template) {
			// Use template
			result = await emailService.sendTemplatedEmail({
				to,
				templateName: template,
				templateData: data || {},
				userId: user_id,
				subject,
				body,
				metadata: { ...metadata, sent_by: req.user.id, company_id: req.user.company_id },
			});
		} else {
			// Custom email
			result = await emailService.sendCustomEmail({
				to,
				subject: subject || 'Notification from Rekrut AI',
				body,
				userId: user_id,
				metadata: { ...metadata, sent_by: req.user.id, company_id: req.user.company_id },
			});
		}

		res.json(result);
	} catch (err) {
		console.error('[notifications] Send error:', err.message);
		res.status(500).json({ error: 'Failed to send notification', message: err.message });
	}
});

// ─── Queue Notification ───────────────────────────────────────────────────

/**
 * POST /api/notifications/queue
 * Queue an email for later processing (useful for scheduled/batch notifications)
 */
router.post('/queue', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { to, type, template, data, user_id, priority, scheduled_for } = req.body;

		if (!to) {
			return res.status(400).json({ error: 'Recipient email (to) is required' });
		}

		const result = await emailService.queueEmail({
			to,
			type: type || 'custom',
			templateName: template,
			templateData: data,
			userId: user_id,
			priority: priority || 5,
			scheduledFor: scheduled_for ? new Date(scheduled_for) : new Date(),
		});

		res.json(result);
	} catch (err) {
		console.error('[notifications] Queue error:', err.message);
		res.status(500).json({ error: 'Failed to queue notification', message: err.message });
	}
});

// ─── Process Queue (Admin) ────────────────────────────────────────────────

/**
 * POST /api/notifications/process-queue
 * Process pending notifications from the queue
 */
router.post('/process-queue', authMiddleware, requireAdmin, async (req, res) => {
	try {
		const { batch_size } = req.body;
		const result = await emailService.processQueue(batch_size || 20);
		res.json({ success: true, ...result });
	} catch (err) {
		console.error('[notifications] Process queue error:', err.message);
		res.status(500).json({ error: 'Failed to process queue', message: err.message });
	}
});

// ─── Notification History ──────────────────────────────────────────────────

/**
 * GET /api/notifications/history
 * Get notification history for current user or company
 */
router.get('/history', authMiddleware, async (req, res) => {
	try {
		const { type, status, limit = 50, offset = 0, user_id, start_date, end_date } = req.query;

		let query = `
      SELECT nl.*, 
        u.name as recipient_name
      FROM notification_logs nl
      LEFT JOIN users u ON nl.user_id = u.id
      WHERE 1=1
    `;
		const params = [];
		let paramIdx = 1;

		// Filter by user (for candidates viewing their own notifications)
		if (req.user.role === 'candidate') {
			query += ` AND nl.user_id = $${paramIdx++}`;
			params.push(req.user.id);
		} else if (req.user.company_id && !user_id) {
			// For recruiters, filter by company via metadata
			query += ` AND nl.metadata->>'company_id' = $${paramIdx++}`;
			params.push(String(req.user.company_id));
		} else if (user_id) {
			query += ` AND nl.user_id = $${paramIdx++}`;
			params.push(parseInt(user_id, 10));
		}

		if (type) {
			query += ` AND nl.type = $${paramIdx++}`;
			params.push(type);
		}
		if (status) {
			query += ` AND nl.status = $${paramIdx++}`;
			params.push(status);
		}
		if (start_date) {
			query += ` AND nl.created_at >= $${paramIdx++}`;
			params.push(start_date);
		}
		if (end_date) {
			query += ` AND nl.created_at <= $${paramIdx++}`;
			params.push(end_date);
		}

		query += ` ORDER BY nl.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
		params.push(parseInt(limit, 10), parseInt(offset, 10));

		const result = await pool.query(query, params);

		// Get total count
		let countQuery = `SELECT COUNT(*) FROM notification_logs nl WHERE 1=1`;
		const countParams = [];
		let countIdx = 1;

		if (req.user.role === 'candidate') {
			countQuery += ` AND nl.user_id = $${countIdx++}`;
			countParams.push(req.user.id);
		} else if (req.user.company_id && !user_id) {
			countQuery += ` AND nl.metadata->>'company_id' = $${countIdx++}`;
			countParams.push(String(req.user.company_id));
		} else if (user_id) {
			countQuery += ` AND nl.user_id = $${countIdx++}`;
			countParams.push(parseInt(user_id, 10));
		}

		const countResult = await pool.query(countQuery, countParams);

		res.json({
			success: true,
			notifications: result.rows,
			total: parseInt(countResult.rows[0].count, 10),
			limit: parseInt(limit, 10),
			offset: parseInt(offset, 10),
		});
	} catch (err) {
		console.error('[notifications] History error:', err.message);
		res.status(500).json({ error: 'Failed to get notification history', message: err.message });
	}
});

// ─── User Preferences ──────────────────────────────────────────────────────

/**
 * GET /api/notifications/preferences
 * Get notification preferences for current user
 */
router.get('/preferences', authMiddleware, async (req, res) => {
	try {
		const result = await pool.query(
			`
      SELECT notification_type, email_enabled, in_app_enabled, sms_enabled, digest_enabled, digest_frequency
      FROM notification_preferences
      WHERE user_id = $1
      ORDER BY notification_type
    `,
			[req.user.id],
		);

		// If no preferences, return defaults
		if (result.rows.length === 0) {
			const defaults = [
				{ notification_type: 'application', email_enabled: true, in_app_enabled: true },
				{ notification_type: 'interview', email_enabled: true, in_app_enabled: true },
				{ notification_type: 'offer', email_enabled: true, in_app_enabled: true },
				{ notification_type: 'rejection', email_enabled: true, in_app_enabled: true },
				{ notification_type: 'assessment', email_enabled: true, in_app_enabled: true },
				{ notification_type: 'onboarding', email_enabled: true, in_app_enabled: true },
				{ notification_type: 'security', email_enabled: true, in_app_enabled: true },
				{ notification_type: 'digest', email_enabled: false, in_app_enabled: true },
			];
			return res.json({ success: true, preferences: defaults, is_default: true });
		}

		res.json({ success: true, preferences: result.rows, is_default: false });
	} catch (err) {
		console.error('[notifications] Preferences get error:', err.message);
		res.status(500).json({ error: 'Failed to get preferences', message: err.message });
	}
});

/**
 * PUT /api/notifications/preferences
 * Update notification preferences for current user
 */
router.put('/preferences', authMiddleware, async (req, res) => {
	try {
		const { preferences } = req.body;

		if (!preferences || !Array.isArray(preferences)) {
			return res.status(400).json({ error: 'preferences array is required' });
		}

		const results = [];
		for (const pref of preferences) {
			const {
				notification_type,
				email_enabled,
				in_app_enabled,
				sms_enabled,
				digest_enabled,
				digest_frequency,
			} = pref;

			const result = await pool.query(
				`
        INSERT INTO notification_preferences 
          (user_id, notification_type, email_enabled, in_app_enabled, sms_enabled, digest_enabled, digest_frequency, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (user_id, notification_type)
        DO UPDATE SET 
          email_enabled = $3, 
          in_app_enabled = $4, 
          sms_enabled = $5, 
          digest_enabled = $6, 
          digest_frequency = $7,
          updated_at = NOW()
        RETURNING *
      `,
				[
					req.user.id,
					notification_type,
					email_enabled,
					in_app_enabled,
					sms_enabled || false,
					digest_enabled || false,
					digest_frequency || 'immediate',
				],
			);

			results.push(result.rows[0]);
		}

		res.json({ success: true, preferences: results, updated: results.length });
	} catch (err) {
		console.error('[notifications] Preferences update error:', err.message);
		res.status(500).json({ error: 'Failed to update preferences', message: err.message });
	}
});

// ─── Templates ─────────────────────────────────────────────────────────────

/**
 * GET /api/notifications/templates
 * List available notification templates
 */
router.get('/templates', authMiddleware, async (req, res) => {
	try {
		const { type, include_system = 'true' } = req.query;

		let query =
			'SELECT id, name, type, subject_template, variables, is_system, is_active, created_at FROM notification_templates WHERE is_active = true';
		const params = [];

		if (type) {
			query += ' AND type = $1';
			params.push(type);
		}

		if (include_system !== 'true') {
			query += ' AND is_system = false';
		}

		query += ' ORDER BY is_system DESC, name ASC';

		const result = await pool.query(query, params);

		res.json({ success: true, templates: result.rows, total: result.rows.length });
	} catch (err) {
		console.error('[notifications] Templates list error:', err.message);
		res.status(500).json({ error: 'Failed to list templates', message: err.message });
	}
});

/**
 * GET /api/notifications/templates/:id
 * Get a specific template
 */
router.get('/templates/:id', authMiddleware, async (req, res) => {
	try {
		const result = await pool.query('SELECT * FROM notification_templates WHERE id = $1', [
			parseInt(req.params.id, 10),
		]);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Template not found' });
		}

		res.json({ success: true, template: result.rows[0] });
	} catch (err) {
		console.error('[notifications] Template get error:', err.message);
		res.status(500).json({ error: 'Failed to get template', message: err.message });
	}
});

/**
 * POST /api/notifications/templates
 * Create a custom template
 */
router.post('/templates', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { name, type, subject_template, body_template, html_template, variables } = req.body;

		if (!name || !type || !subject_template || !body_template) {
			return res
				.status(400)
				.json({ error: 'name, type, subject_template, and body_template are required' });
		}

		const result = await pool.query(
			`
      INSERT INTO notification_templates 
        (name, type, subject_template, body_template, html_template, variables, is_system)
      VALUES ($1, $2, $3, $4, $5, $6, false)
      RETURNING *
    `,
			[
				name,
				type,
				subject_template,
				body_template,
				html_template || null,
				JSON.stringify(variables || []),
			],
		);

		res.json({ success: true, template: result.rows[0] });
	} catch (err) {
		if (err.code === '23505') {
			return res.status(409).json({ error: 'Template with this name already exists' });
		}
		console.error('[notifications] Template create error:', err.message);
		res.status(500).json({ error: 'Failed to create template', message: err.message });
	}
});

/**
 * PUT /api/notifications/templates/:id
 * Update a template
 */
router.put('/templates/:id', authMiddleware, requireAdmin, async (req, res) => {
	try {
		const { name, type, subject_template, body_template, html_template, variables, is_active } =
			req.body;

		const result = await pool.query(
			`
      UPDATE notification_templates 
      SET 
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        subject_template = COALESCE($3, subject_template),
        body_template = COALESCE($4, body_template),
        html_template = COALESCE($5, html_template),
        variables = COALESCE($6, variables),
        is_active = COALESCE($7, is_active),
        updated_at = NOW()
      WHERE id = $8
      RETURNING *
    `,
			[
				name,
				type,
				subject_template,
				body_template,
				html_template,
				variables ? JSON.stringify(variables) : null,
				is_active,
				parseInt(req.params.id, 10),
			],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Template not found' });
		}

		res.json({ success: true, template: result.rows[0] });
	} catch (err) {
		console.error('[notifications] Template update error:', err.message);
		res.status(500).json({ error: 'Failed to update template', message: err.message });
	}
});

// ─── Statistics (Admin) ────────────────────────────────────────────────────

/**
 * GET /api/notifications/stats
 * Get notification statistics
 */
router.get('/stats', authMiddleware, requireAdmin, async (req, res) => {
	try {
		const { days = 30 } = req.query;
		const stats = await emailService.getStats(parseInt(days, 10));

		// Get queue stats
		const queueStats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM notification_queue
    `);

		res.json({
			success: true,
			email: stats,
			queue: queueStats.rows[0],
			config: emailService.getStatus(),
		});
	} catch (err) {
		console.error('[notifications] Stats error:', err.message);
		res.status(500).json({ error: 'Failed to get statistics', message: err.message });
	}
});

// ─── Test Email ────────────────────────────────────────────────────────────

/**
 * POST /api/notifications/test
 * Send a test email to verify configuration
 */
router.post('/test', authMiddleware, requireAdmin, async (req, res) => {
	try {
		const { to } = req.body;
		const testEmail = to || req.user.email;

		if (!testEmail) {
			return res.status(400).json({ error: 'Email address required' });
		}

		const result = await emailService.sendCustomEmail({
			to: testEmail,
			subject: 'Rekrut AI — Email Configuration Test',
			body: `Hello ${req.user.name || 'User'},

This is a test email from Rekrut AI to verify your email configuration.

Sent at: ${new Date().toISOString()}

If you received this email, your email service is properly configured!

Best regards,
Rekrut AI System`,
			userId: req.user.id,
			type: 'test',
			metadata: { test: true },
		});

		res.json({
			...result,
			config: emailService.getStatus(),
		});
	} catch (err) {
		console.error('[notifications] Test email error:', err.message);
		res.status(500).json({ error: 'Failed to send test email', message: err.message });
	}
});

// ─── Verify Configuration ──────────────────────────────────────────────────

/**
 * GET /api/notifications/verify
 * Verify email service configuration (admin only)
 */
router.get('/verify', authMiddleware, requireAdmin, async (_req, res) => {
	try {
		const result = await emailService.verifyConnection();
		res.json({
			...result,
			config: emailService.getStatus(),
		});
	} catch (err) {
		console.error('[notifications] Verify error:', err.message);
		res.status(500).json({ error: 'Verification failed', message: err.message });
	}
});

// ─── Quick Send Notifications (Integration Endpoints) ──────────────────────

/**
 * POST /api/notifications/quick/application-received
 * Quick endpoint to send application received notification
 */
router.post('/quick/application-received', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { candidate_id, job_id, assessment_required, assessment_deadline } = req.body;

		// Get candidate info
		const candResult = await pool.query(
			`
      SELECT u.id, u.name, u.email, j.title as job_title
      FROM users u
      CROSS JOIN jobs j
      WHERE u.id = $1 AND j.id = $2
    `,
			[candidate_id, job_id],
		);

		if (candResult.rows.length === 0) {
			return res.status(404).json({ error: 'Candidate or job not found' });
		}

		const candidate = candResult.rows[0];

		const result = await emailService.sendTemplatedEmail({
			to: candidate.email,
			templateName: 'application_received',
			templateData: {
				candidate_name: candidate.name,
				job_title: candidate.job_title,
				company_name: req.user.company_name || 'Our Company',
				assessment_required: assessment_required || false,
				assessment_deadline: assessment_deadline || '',
			},
			userId: candidate.id,
			metadata: { job_id, company_id: req.user.company_id },
		});

		res.json(result);
	} catch (err) {
		console.error('[notifications] Quick send error:', err.message);
		res.status(500).json({ error: 'Failed to send notification', message: err.message });
	}
});

/**
 * POST /api/notifications/quick/interview-scheduled
 * Quick endpoint to send interview scheduled notification
 */
router.post('/quick/interview-scheduled', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const {
			candidate_id,
			job_id,
			interview_date,
			interview_time,
			interview_location,
			interviewer_name,
			meeting_link,
		} = req.body;

		// Get candidate info
		const candResult = await pool.query(
			`
      SELECT u.id, u.name, u.email, j.title as job_title
      FROM users u
      CROSS JOIN jobs j
      WHERE u.id = $1 AND j.id = $2
    `,
			[candidate_id, job_id],
		);

		if (candResult.rows.length === 0) {
			return res.status(404).json({ error: 'Candidate or job not found' });
		}

		const candidate = candResult.rows[0];

		const result = await emailService.sendTemplatedEmail({
			to: candidate.email,
			templateName: 'interview_scheduled',
			templateData: {
				candidate_name: candidate.name,
				job_title: candidate.job_title,
				company_name: req.user.company_name || 'Our Company',
				interview_date,
				interview_time,
				interview_location: interview_location || 'Virtual',
				interviewer_name: interviewer_name || '',
				meeting_link: meeting_link || '',
				confirmation_link: `${process.env.FRONTEND_URL || 'https://rekrut.ai'}/interviews/confirm`,
			},
			userId: candidate.id,
			metadata: { job_id, company_id: req.user.company_id },
		});

		res.json(result);
	} catch (err) {
		console.error('[notifications] Interview scheduled error:', err.message);
		res.status(500).json({ error: 'Failed to send notification', message: err.message });
	}
});

/**
 * POST /api/notifications/quick/offer-extended
 * Quick endpoint to send offer notification
 */
router.post('/quick/offer-extended', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const {
			candidate_id,
			job_id,
			salary,
			work_location,
			start_date,
			benefits,
			offer_link,
			offer_deadline,
		} = req.body;

		// Get candidate info
		const candResult = await pool.query(
			`
      SELECT u.id, u.name, u.email, j.title as job_title
      FROM users u
      CROSS JOIN jobs j
      WHERE u.id = $1 AND j.id = $2
    `,
			[candidate_id, job_id],
		);

		if (candResult.rows.length === 0) {
			return res.status(404).json({ error: 'Candidate or job not found' });
		}

		const candidate = candResult.rows[0];

		const result = await emailService.sendTemplatedEmail({
			to: candidate.email,
			templateName: 'offer_extended',
			templateData: {
				candidate_name: candidate.name,
				job_title: candidate.job_title,
				company_name: req.user.company_name || 'Our Company',
				salary,
				work_location: work_location || 'Remote',
				start_date,
				benefits: benefits || '',
				offer_link: offer_link || `${process.env.FRONTEND_URL || 'https://rekrut.ai'}/offers`,
				offer_deadline: offer_deadline || '7 days',
			},
			userId: candidate.id,
			metadata: { job_id, company_id: req.user.company_id },
		});

		res.json(result);
	} catch (err) {
		console.error('[notifications] Offer extended error:', err.message);
		res.status(500).json({ error: 'Failed to send notification', message: err.message });
	}
});

// Cartesia TTS cache directory for voice notifications
const CARTESIA_VOICE_CACHE_DIR = '/tmp/cartesia-cache';
if (!fs.existsSync(CARTESIA_VOICE_CACHE_DIR)) {
	fs.mkdirSync(CARTESIA_VOICE_CACHE_DIR, { recursive: true });
}

// Emotion mapping for voice notifications
const EMOTION_CONFIG = {
	neutral: {
		/* no emotion override — use base voice */
	},
	enthusiastic: { speed: 1.1, emotion: ['happiness:high'] },
	calm: { speed: 0.9, emotion: ['calmness:high'] },
};

// Validate voice notification input
function validateVoiceInput(text, emotion) {
	if (!text || typeof text !== 'string') {
		return { valid: false, error: 'Text is required and must be a string' };
	}
	if (text.length > 500) {
		return { valid: false, error: 'Text must be under 500 characters (~30 seconds max)' };
	}
	if (emotion && !EMOTION_CONFIG[emotion]) {
		return {
			valid: false,
			error: `Emotion must be one of: ${Object.keys(EMOTION_CONFIG).join(', ')}`,
		};
	}
	return { valid: true };
}

// Generate a deterministic cache key from text + emotion
function getVoiceCacheKey(text, emotion) {
	const hash = crypto
		.createHash('sha256')
		.update(`${emotion || 'neutral'}:${text}`)
		.digest('hex')
		.slice(0, 24);
	return hash;
}

// Call Cartesia TTS API
async function generateCartesiaAudio(text, emotion) {
	const apiKey = process.env.CARTESIA_API_KEY;
	if (!apiKey) {
		throw new Error('Cartesia API key not configured');
	}

	const voice = {
		id: 'f786b574-daa5-4673-aa0c-cbe3e8534c02',
		mode: 'id',
	};

	const payload = {
		model_id: 'sonic-3.5',
		voice,
		transcript: text,
		output_format: { container: 'mp3', sample_rate: 24000 },
	};

	const emo = EMOTION_CONFIG[emotion];
	if (emo?.emotion) {
		payload.emotion = emo.emotion;
	}
	if (emo?.speed) {
		payload.speed = emo.speed;
	}

	const response = await fetch('https://api.cartesia.ai/tts/bytes', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
			'Cartesia-Version': '2026-03-01',
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const errText = await response.text().catch(() => 'Unknown error');
		console.error('[Cartesia TTS] HTTP', response.status, errText);
		throw new Error(`Cartesia TTS generation failed: ${response.status}`);
	}

	return Buffer.from(await response.arrayBuffer());
}

// ─── Voice Notifications ───────────────────────────────────────────────────

/**
 * POST /api/notifications/voice
 * Generate voice audio for a notification using Cartesia TTS
 *
 * Body:
 * - text: string (notification text, max ~500 chars for <30s)
 * - emotion: string ('neutral' | 'enthusiastic' | 'calm')
 */
router.post('/voice', authMiddleware, async (req, res) => {
	try {
		const { text, emotion = 'neutral' } = req.body;

		const validation = validateVoiceInput(text, emotion);
		if (!validation.valid) {
			return res.status(400).json({ error: validation.error });
		}

		const cacheKey = getVoiceCacheKey(text, emotion);
		const cacheFile = require('node:path').join(CARTESIA_VOICE_CACHE_DIR, `voice-${cacheKey}.mp3`);

		// If cached, return immediately
		if (fs.existsSync(cacheFile)) {
			return res.json({
				audioUrl: `/api/notifications/voice/${cacheKey}`,
				cached: true,
				id: cacheKey,
				emotion,
				textLength: text.length,
			});
		}

		// Generate audio via Cartesia
		const buffer = await generateCartesiaAudio(text, emotion);
		fs.writeFileSync(cacheFile, buffer);

		res.json({
			audioUrl: `/api/notifications/voice/${cacheKey}`,
			cached: false,
			id: cacheKey,
			emotion,
			textLength: text.length,
			fileSize: buffer.length,
		});
	} catch (err) {
		console.error('[notifications/voice] Generation error:', err.message);
		res.status(500).json({ error: 'Failed to generate voice audio', message: err.message });
	}
});

/**
 * GET /api/notifications/voice/:id
 * Serve cached voice audio MP3 file
 */
router.get('/voice/:id', authMiddleware, async (req, res) => {
	try {
		const { id } = req.params;

		// Validate id format (hex chars only, max 32 chars)
		if (!id || !/^[a-f0-9]{24,32}$/i.test(id)) {
			return res.status(400).json({ error: 'Invalid audio ID' });
		}

		const cacheFile = require('node:path').join(CARTESIA_VOICE_CACHE_DIR, `voice-${id}.mp3`);
		if (!fs.existsSync(cacheFile)) {
			return res
				.status(404)
				.json({ error: 'Audio not found. Generate it first via POST /api/notifications/voice' });
		}

		const stat = fs.statSync(cacheFile);
		res.setHeader('Content-Type', 'audio/mpeg');
		res.setHeader('Content-Length', stat.size);
		res.setHeader('Cache-Control', 'public, max-age=86400');
		const stream = fs.createReadStream(cacheFile);
		stream.pipe(res);
	} catch (err) {
		console.error('[notifications/voice] Serve error:', err.message);
		res.status(500).json({ error: 'Failed to serve audio file' });
	}
});

module.exports = router;
