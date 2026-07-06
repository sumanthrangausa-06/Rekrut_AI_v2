/**
 * Email Service — Transactional email sending with templates, rate limiting, and error handling
 *
 * Supports:
 * - Nodemailer SMTP + major providers (SendGrid, Mailgun, SES, etc.)
 * - Template-based emails with variable interpolation
 * - Rate limiting to prevent abuse
 * - Retry logic with exponential backoff
 * - Email logging and tracking
 */

const nodemailer = require('nodemailer');
const pool = require('./db');

// ─── Configuration ────────────────────────────────────────────────────────
const CONFIG = {
	// SMTP configuration from environment — Brevo recommended (updated 2026-06-12)
	smtp: {
		host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
		port: parseInt(process.env.SMTP_PORT || '587', 10),
		secure: process.env.SMTP_SECURE === 'true',
		auth: {
			user: process.env.SMTP_USER || process.env.EMAIL_USER || '',
			pass: process.env.SMTP_PASS || process.env.EMAIL_PASS || '',
		},
	},
	// Default sender info
	from: {
		name: process.env.SMTP_FROM_NAME || process.env.EMAIL_FROM_NAME || 'Rekrut AI',
		address: process.env.SMTP_FROM_EMAIL || process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER || 'noreply@rekrutai.co',
	},
	// Rate limiting
	rateLimit: {
		maxPerMinute: parseInt(process.env.EMAIL_RATE_LIMIT || '60', 10),
		maxPerHour: parseInt(process.env.EMAIL_RATE_LIMIT_HOUR || '500', 10),
	},
	// Retry configuration
	retry: {
		maxAttempts: parseInt(process.env.EMAIL_RETRY_ATTEMPTS || '3', 10),
		delayMs: parseInt(process.env.EMAIL_RETRY_DELAY || '5000', 10),
		backoffMultiplier: 2,
	},
};

// ─── Transporter Setup ────────────────────────────────────────────────────
let transporter = null;
let isConfigured = false;

/**
 * Initialize nodemailer transporter
 * Returns true if email is properly configured
 */
function initializeTransporter() {
	if (transporter) return isConfigured;

	// Check if SMTP credentials are available
	if (!CONFIG.smtp.auth.user || !CONFIG.smtp.auth.pass) {
		console.warn('[email-service] SMTP credentials not configured. Email sending is disabled.');
		console.warn('[email-service] Set SMTP_USER and SMTP_PASS environment variables.');
		isConfigured = false;
		return false;
	}

	try {
		transporter = nodemailer.createTransport({
			host: CONFIG.smtp.host,
			port: CONFIG.smtp.port,
			secure: CONFIG.smtp.secure,
			auth: CONFIG.smtp.auth,
			// Connection timeout settings
			connectionTimeout: 10000,
			socketTimeout: 10000,
			// Debug mode in development
			debug: process.env.NODE_ENV !== 'production',
			logger: process.env.NODE_ENV !== 'production',
		});

		isConfigured = true;
		console.log(
			`[email-service] Initialized SMTP transporter: ${CONFIG.smtp.host}:${CONFIG.smtp.port}`,
		);
		return true;
	} catch (err) {
		console.error('[email-service] Failed to initialize transporter:', err.message);
		isConfigured = false;
		return false;
	}
}

// ─── Rate Limiting ─────────────────────────────────────────────────────────
const rateLimiter = {
	minuteCount: 0,
	hourCount: 0,
	lastMinuteReset: Date.now(),
	lastHourReset: Date.now(),

	checkLimit() {
		const now = Date.now();

		// Reset minute counter
		if (now - this.lastMinuteReset >= 60000) {
			this.minuteCount = 0;
			this.lastMinuteReset = now;
		}

		// Reset hour counter
		if (now - this.lastHourReset >= 3600000) {
			this.hourCount = 0;
			this.lastHourReset = now;
		}

		// Check limits
		if (this.minuteCount >= CONFIG.rateLimit.maxPerMinute) {
			return { allowed: false, reason: 'minute_limit_exceeded' };
		}
		if (this.hourCount >= CONFIG.rateLimit.maxPerHour) {
			return { allowed: false, reason: 'hour_limit_exceeded' };
		}

		// Increment counters
		this.minuteCount++;
		this.hourCount++;

		return { allowed: true };
	},
};

// ─── Template Rendering ────────────────────────────────────────────────────

/**
 * Simple mustache-style template renderer
 * Supports {{variable}}, {{#if condition}}...{{/if}}, {{#each array}}...{{/each}}
 */
function renderTemplate(template, data) {
	if (!template) return '';

	let result = template;

	// Handle {{#each array}}...{{/each}}
	result = result.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, inner) => {
		const items = data[key];
		if (!Array.isArray(items)) return '';
		return items
			.map((item) => {
				let itemResult = inner;
				Object.entries(item).forEach(([k, v]) => {
					itemResult = itemResult.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v || ''));
				});
				return itemResult;
			})
			.join('');
	});

	// Handle {{#if condition}}...{{/if}}
	result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, inner) => {
		return data[key] ? inner : '';
	});

	// Handle simple {{variable}}
	Object.entries(data).forEach(([key, value]) => {
		const stringValue = String(value || '');
		result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), stringValue);
	});

	return result.trim();
}

/**
 * Get template from database
 */
async function getTemplate(templateName) {
	const result = await pool.query(
		'SELECT * FROM notification_templates WHERE name = $1 AND is_active = true',
		[templateName],
	);
	return result.rows[0] || null;
}

/**
 * Create HTML version of plain text email with basic formatting
 */
function textToHtml(text) {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\n/g, '<br>')
		.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
}

// ─── Email Logging ────────────────────────────────────────────────────────

/**
 * Log email to database
 */
async function logEmail({
	userId,
	email,
	templateId,
	type,
	subject,
	body,
	htmlBody,
	status,
	errorMessage,
	providerMessageId,
	metadata,
}) {
	try {
		const result = await pool.query(
			`
      INSERT INTO notification_logs 
        (user_id, email, template_id, type, subject, body, html_body, status, error_message, provider_message_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `,
			[
				userId,
				email,
				templateId,
				type,
				subject,
				body,
				htmlBody,
				status,
				errorMessage,
				providerMessageId,
				JSON.stringify(metadata || {}),
			],
		);

		return result.rows[0].id;
	} catch (err) {
		console.error('[email-service] Failed to log email:', err.message);
		return null;
	}
}

/**
 * Update email log status
 */
async function updateEmailLog(
	logId,
	{ status, errorMessage, providerMessageId, sentAt, deliveredAt },
) {
	try {
		await pool.query(
			`
      UPDATE notification_logs 
      SET status = $1, error_message = $2, provider_message_id = $3, 
          sent_at = COALESCE($4, sent_at), delivered_at = COALESCE($5, delivered_at)
      WHERE id = $6
    `,
			[status, errorMessage, providerMessageId, sentAt, deliveredAt, logId],
		);
	} catch (err) {
		console.error('[email-service] Failed to update email log:', err.message);
	}
}

// ─── Core Email Functions ──────────────────────────────────────────────────

/**
 * Fire-and-forget email helper — wraps sendTemplatedEmail with guaranteed
 * non-blocking error handling.  Email failures are logged but never thrown.
 *
 * @param {Object} options — same as sendTemplatedEmail
 */
async function sendEmailAsync(options) {
	try {
		return await sendTemplatedEmail(options);
	} catch (err) {
		console.error('[email-service] sendEmailAsync caught error (logged, not thrown):', err.message);
		// Log to DB for observability even if template wasn't found / SMTP down
		try {
			await logEmail({
				userId: options.userId,
				email: options.to,
				type: options.templateName || options.type || 'custom',
				subject: options.subject || options.templateName || 'unknown',
				body: options.body || '',
				status: 'failed',
				errorMessage: err.message,
				metadata: options.metadata,
			});
		} catch (logErr) {
			console.error('[email-service] Failed to log async email failure:', logErr.message);
		}
		return { success: false, error: err.message };
	}
}

/**
 * Send an email using a template
 *
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.templateName - Name of the template to use
 * @param {Object} options.templateData - Data to interpolate into template
 * @param {number} options.userId - Optional user ID for logging
 * @param {string} options.subject - Override subject (optional)
 * @param {string} options.body - Override body (optional)
 * @param {Object} options.metadata - Additional metadata to log
 */
async function sendTemplatedEmail({
	to,
	templateName,
	templateData,
	userId,
	subject,
	body,
	metadata,
}) {
	// Check if email is configured
	if (!initializeTransporter()) {
		console.warn('[email-service] Email not configured, logging only');
		await logEmail({
			userId,
			email: to,
			type: templateName,
			subject: subject || templateName,
			body: body || 'Template not rendered',
			status: 'skipped',
			errorMessage: 'Email service not configured',
			metadata,
		});
		return { success: false, error: 'email_not_configured' };
	}

	// Check rate limits
	const rateCheck = rateLimiter.checkLimit();
	if (!rateCheck.allowed) {
		console.warn(`[email-service] Rate limit exceeded: ${rateCheck.reason}`);
		return { success: false, error: 'rate_limit_exceeded', reason: rateCheck.reason };
	}

	try {
		// Get template
		const template = await getTemplate(templateName);
		if (!template) {
			console.error(`[email-service] Template not found: ${templateName}`);
			return { success: false, error: 'template_not_found' };
		}

		// Render subject and body
		const finalSubject = subject || renderTemplate(template.subject_template, templateData);
		const finalBody = body || renderTemplate(template.body_template, templateData);
		const htmlBody = template.html_template
			? renderTemplate(template.html_template, templateData)
			: textToHtml(finalBody);

		// Log the attempt
		const logId = await logEmail({
			userId,
			email: to,
			templateId: template.id,
			type: template.type,
			subject: finalSubject,
			body: finalBody,
			htmlBody,
			status: 'pending',
			metadata,
		});

		// Add tracking pixel to HTML body
		const trackingPixel = `<img src="${process.env.FRONTEND_URL || 'https://rekrutai.co'}/api/email/track/open/${logId}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;" />`;
		const htmlWithTracking = htmlBody + trackingPixel;

		// Send email
		const info = await transporter.sendMail({
			from: `${CONFIG.from.name} <${CONFIG.from.address}>`,
			to,
			subject: finalSubject,
			text: finalBody,
			html: htmlWithTracking,
			headers: {
				'X-Priority': '3',
				'X-Mailer': 'Rekrut AI Notification System',
			},
		});

		// Update log with success
		await updateEmailLog(logId, {
			status: 'sent',
			providerMessageId: info.messageId,
			sentAt: new Date(),
		});

		console.log(`[email-service] Email sent to ${to}: ${info.messageId}`);

		return {
			success: true,
			messageId: info.messageId,
			logId,
		};
	} catch (err) {
		console.error(`[email-service] Failed to send email to ${to}:`, err.message);

		// Log failure
		await logEmail({
			userId,
			email: to,
			type: templateName,
			subject: subject || templateName,
			body: body || '',
			status: 'failed',
			errorMessage: err.message,
			metadata,
		});

		return {
			success: false,
			error: 'send_failed',
			message: err.message,
		};
	}
}

/**
 * Send a custom email (no template)
 */
async function sendCustomEmail({ to, subject, body, html, userId, type = 'custom', metadata }) {
	// Check if email is configured
	if (!initializeTransporter()) {
		console.warn('[email-service] Email not configured, logging only');
		await logEmail({
			userId,
			email: to,
			type,
			subject,
			body,
			htmlBody: html,
			status: 'skipped',
			errorMessage: 'Email service not configured',
			metadata,
		});
		return { success: false, error: 'email_not_configured' };
	}

	// Check rate limits
	const rateCheck = rateLimiter.checkLimit();
	if (!rateCheck.allowed) {
		return { success: false, error: 'rate_limit_exceeded', reason: rateCheck.reason };
	}

	try {
		const htmlBody = html || textToHtml(body);

		// Log the attempt
		const logId = await logEmail({
			userId,
			email: to,
			type,
			subject,
			body,
			htmlBody,
			status: 'pending',
			metadata,
		});

		// Send email
		const info = await transporter.sendMail({
			from: `${CONFIG.from.name} <${CONFIG.from.address}>`,
			to,
			subject,
			text: body,
			html: htmlBody,
		});

		// Update log
		await updateEmailLog(logId, {
			status: 'sent',
			providerMessageId: info.messageId,
			sentAt: new Date(),
		});

		return { success: true, messageId: info.messageId, logId };
	} catch (err) {
		console.error(`[email-service] Failed to send custom email to ${to}:`, err.message);

		await logEmail({
			userId,
			email: to,
			type,
			subject,
			body,
			status: 'failed',
			errorMessage: err.message,
			metadata,
		});

		return { success: false, error: 'send_failed', message: err.message };
	}
}

/**
 * Queue an email for later processing (useful for batch operations)
 */
async function queueEmail({
	to,
	type,
	templateName,
	templateData,
	userId,
	priority = 5,
	scheduledFor = new Date(),
}) {
	try {
		// Get template ID if specified
		let templateId = null;
		if (templateName) {
			const template = await getTemplate(templateName);
			templateId = template?.id || null;
		}

		const result = await pool.query(
			`
      INSERT INTO notification_queue 
        (user_id, email, type, template_id, template_data, priority, scheduled_for)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `,
			[userId, to, type, templateId, JSON.stringify(templateData || {}), priority, scheduledFor],
		);

		return { success: true, queueId: result.rows[0].id };
	} catch (err) {
		console.error('[email-service] Failed to queue email:', err.message);
		return { success: false, error: 'queue_failed', message: err.message };
	}
}

/**
 * Process queued emails (call this from a cron job or worker)
 */
async function processQueue(batchSize = 20) {
	const result = {
		processed: 0,
		succeeded: 0,
		failed: 0,
		skipped: 0,
	};

	try {
		// Get pending emails that are due
		const queueResult = await pool.query(
			`
      SELECT nq.*, nt.name as template_name, nt.subject_template, nt.body_template
      FROM notification_queue nq
      LEFT JOIN notification_templates nt ON nq.template_id = nt.id
      WHERE nq.status = 'pending' 
        AND nq.scheduled_for <= NOW()
        AND nq.attempts < nq.max_attempts
      ORDER BY nq.priority, nq.scheduled_for
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `,
			[batchSize],
		);

		for (const item of queueResult.rows) {
			result.processed++;

			// Mark as processing
			await pool.query(
				'UPDATE notification_queue SET status = $1, attempts = attempts + 1 WHERE id = $2',
				['processing', item.id],
			);

			try {
				// Determine send method based on template
				let sendResult;
				if (item.template_name) {
					sendResult = await sendTemplatedEmail({
						to: item.email,
						templateName: item.template_name,
						templateData:
							typeof item.template_data === 'string'
								? JSON.parse(item.template_data)
								: item.template_data,
						userId: item.user_id,
						type: item.type,
					});
				} else {
					// Custom email from template_data
					const data =
						typeof item.template_data === 'string'
							? JSON.parse(item.template_data)
							: item.template_data;
					sendResult = await sendCustomEmail({
						to: item.email,
						subject: data.subject,
						body: data.body,
						html: data.html,
						userId: item.user_id,
						type: item.type,
					});
				}

				if (sendResult.success) {
					result.succeeded++;
					await pool.query(
						'UPDATE notification_queue SET status = $1, processed_at = NOW() WHERE id = $2',
						['sent', item.id],
					);
				} else {
					result.failed++;
					await pool.query(
						'UPDATE notification_queue SET status = $1, last_error = $2 WHERE id = $3',
						['failed', sendResult.error || sendResult.message, item.id],
					);
				}
			} catch (err) {
				result.failed++;
				await pool.query(
					'UPDATE notification_queue SET status = $1, last_error = $2 WHERE id = $3',
					['failed', err.message, item.id],
				);
			}
		}
	} catch (err) {
		console.error('[email-service] Queue processing error:', err.message);
	}

	return result;
}

// ─── Notification Preferences ─────────────────────────────────────────────

/**
 * Check if user has email notifications enabled for a type
 */
async function canSendToUser(userId, notificationType) {
	try {
		const result = await pool.query(
			`
      SELECT email_enabled FROM notification_preferences 
      WHERE user_id = $1 AND notification_type = $2
    `,
			[userId, notificationType],
		);

		// Default to enabled if no preference set
		if (result.rows.length === 0) return true;
		return result.rows[0].email_enabled;
	} catch (err) {
		console.error('[email-service] Failed to check preferences:', err.message);
		return true; // Default to enabled on error
	}
}

/**
 * Set user notification preference
 */
async function setPreference(userId, notificationType, emailEnabled) {
	try {
		await pool.query(
			`
      INSERT INTO notification_preferences (user_id, notification_type, email_enabled, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, notification_type) 
      DO UPDATE SET email_enabled = $3, updated_at = NOW()
    `,
			[userId, notificationType, emailEnabled],
		);

		return { success: true };
	} catch (err) {
		console.error('[email-service] Failed to set preference:', err.message);
		return { success: false, error: err.message };
	}
}

// ─── Analytics ────────────────────────────────────────────────────────────

/**
 * Get email statistics
 */
async function getStats(days = 30) {
	try {
		const result = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'skipped') as skipped,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL) as opened,
        COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) as clicked,
        COUNT(DISTINCT email) as unique_recipients
      FROM notification_logs
      WHERE created_at > NOW() - INTERVAL '${days} days'
    `);

		const byType = await pool.query(`
      SELECT type, COUNT(*) as count, 
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL) as opened
      FROM notification_logs
      WHERE created_at > NOW() - INTERVAL '${days} days'
      GROUP BY type
      ORDER BY count DESC
    `);

		return {
			summary: result.rows[0],
			byType: byType.rows,
		};
	} catch (err) {
		console.error('[email-service] Failed to get stats:', err.message);
		return { summary: {}, byType: [] };
	}
}

/**
 * Get configuration status (for health checks)
 */
function getStatus() {
	return {
		configured: isConfigured,
		host: CONFIG.smtp.host,
		port: CONFIG.smtp.port,
		hasCredentials: !!(CONFIG.smtp.auth.user && CONFIG.smtp.auth.pass),
		fromAddress: CONFIG.from.address,
		rateLimit: CONFIG.rateLimit,
		currentRate: {
			perMinute: rateLimiter.minuteCount,
			perHour: rateLimiter.hourCount,
		},
	};
}

// ─── Verify Connection ────────────────────────────────────────────────────

/**
 * Verify SMTP connection
 */
async function verifyConnection() {
	if (!initializeTransporter()) {
		return { success: false, error: 'not_configured' };
	}

	try {
		await transporter.verify();
		return { success: true, message: 'SMTP connection verified' };
	} catch (err) {
		return { success: false, error: err.message };
	}
}

/**
 * Send email with queue fallback — if SMTP not available, queue for later
 */
async function sendEmailWithQueue({ to, template, subject, body, html, metadata = {} }) {
	// Try to send immediately if SMTP is configured
	if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
		try {
			return await sendTemplatedEmail({ to, template, data: metadata });
		} catch (err) {
			console.log('[email] Immediate send failed, queuing:', err.message);
		}
	}
	
	// Queue for later processing
	const emailQueue = require('./email-queue');
	return await emailQueue.enqueue({ to, template, subject, body, html, metadata });
}

// ─── Export ────────────────────────────────────────────────────────────────


// ─── Interview Reminder Processing ───────────────────────────────────────────
// Process due interview reminders and send emails
async function processInterviewReminders() {
	try {
		// Get reminders that are due and haven't been sent yet
		const dueReminders = await pool.query(
			`SELECT ir.id, ir.interview_id, ir.recipient_id, ir.reminder_type,
				i.scheduled_at, i.job_id, i.interview_type,
				u.email, u.name as candidate_name,
				j.title as job_title, c.name as company_name
			 FROM interview_reminders ir
			 JOIN interviews i ON ir.interview_id = i.id
			 JOIN users u ON ir.recipient_id = u.id
			 JOIN jobs j ON i.job_id = j.id
			 JOIN companies c ON j.company_id = c.id
			 WHERE ir.send_at <= NOW()
			   AND ir.sent_at IS NULL
			 ORDER BY ir.send_at ASC
			 LIMIT 50`,
		);

		if (dueReminders.rows.length === 0) return;

		console.log(`[email-service] Processing ${dueReminders.rows.length} interview reminders`);

		for (const reminder of dueReminders.rows) {
			try {
				const templateData = {
					candidateName: reminder.candidate_name,
					jobTitle: reminder.job_title,
					companyName: reminder.company_name,
					interviewDate: new Date(reminder.scheduled_at).toLocaleDateString('en-US', {
						weekday: 'long',
						year: 'numeric',
						month: 'long',
						day: 'numeric',
						hour: '2-digit',
						minute: '2-digit',
						timeZoneName: 'short',
					}),
					reminderType: reminder.reminder_type === '1_day_before' ? '1 day' : '1 hour',
				};

				await sendTemplatedEmail({
					to: reminder.email,
					templateName: 'interview_reminder',
					templateData,
					userId: reminder.recipient_id,
					metadata: {
						interviewId: reminder.interview_id,
						reminderId: reminder.id,
						reminderType: reminder.reminder_type,
					},
				});

				// Mark reminder as sent
				await pool.query(
					'UPDATE interview_reminders SET sent_at = NOW() WHERE id = $1',
					[reminder.id],
				);
			} catch (err) {
				console.error(`[email-service] Failed to send reminder ${reminder.id}:`, err.message);
			}
		}
	} catch (err) {
		console.error('[email-service] Interview reminder processing error:', err.message);
	}
}

module.exports = {
	// Core functions
	sendTemplatedEmail,
	sendCustomEmail,
	queueEmail,
	processQueue,

	// Fire-and-forget wrapper
	sendEmailAsync,

	// Preferences
	canSendToUser,
	setPreference,

	// Templates
	getTemplate,
	renderTemplate,

	// Logging
	logEmail,
	updateEmailLog,

	// Stats
	getStats,
	getStatus,
	verifyConnection,

	// Initialize
	initializeTransporter,

	// Queue integration
	sendEmailWithQueue,

	// Interview reminders
	processInterviewReminders,
};
