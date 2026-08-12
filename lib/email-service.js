/**
 * Email Service — Transactional email sending with templates, rate limiting, and error handling
 *
 * Supports:
 * - Brevo HTTP API (primary — bypasses Render SMTP block)
 * - Nodemailer SMTP fallback + major providers (SendGrid, Mailgun, SES, etc.)
 * - Template-based emails with variable interpolation
 * - Rate limiting to prevent abuse
 * - Retry logic with exponential backoff
 * - Email logging and tracking
 */

const nodemailer = require('nodemailer');
const fetch = require('node-fetch');
const pool = require('./db');
const fs = require('node:fs');
const path = require('node:path');
const { distributedRateLimiter } = require('./distributed-rate-limiter');

// ─── Configuration ────────────────────────────────────────────────────────
const CONFIG = {
	// Brevo HTTP API (primary)
	brevo: {
		apiKey: process.env.BREVO_API_KEY || '',
		apiUrl: 'https://api.brevo.com/v3/smtp/email',
	},
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
		address:
			process.env.SMTP_FROM_EMAIL ||
			process.env.EMAIL_FROM_ADDRESS ||
			process.env.SMTP_USER ||
			'noreply@rekrutai.co',
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
let isSmtpConfigured = false;

/**
 * Initialize nodemailer transporter
 * Returns true if SMTP is properly configured
 */
function initializeTransporter() {
	if (transporter) return isSmtpConfigured;

	// Check if SMTP credentials are available
	if (!CONFIG.smtp.auth.user || !CONFIG.smtp.auth.pass) {
		console.warn('[email-service] SMTP credentials not configured. SMTP fallback is disabled.');
		isSmtpConfigured = false;
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

		isSmtpConfigured = true;
		console.log(
			`[email-service] SMTP fallback transporter ready: ${CONFIG.smtp.host}:${CONFIG.smtp.port}`,
		);
		return true;
	} catch (err) {
		console.error('[email-service] Failed to initialize SMTP transporter:', err.message);
		isSmtpConfigured = false;
		return false;
	}
}

function isBrevoApiConfigured() {
	return !!CONFIG.brevo.apiKey;
}

function isEmailConfigured() {
	return isBrevoApiConfigured() || !!(CONFIG.smtp.auth.user && CONFIG.smtp.auth.pass);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
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

// ─── Email Validation ─────────────────────────────────────────────────────

/**
 * Validate and sanitize an email address.
 * Returns the sanitized email or null if invalid.
 * Prevents header injection by stripping control characters.
 */
function validateEmail(email) {
	if (!email || typeof email !== 'string') return null;
	// Strip control characters that could be used for header injection
	const sanitized = email.replace(/[\r\n\x00-\x1f\x7f]/g, '').trim();
	if (!sanitized) return null;
	// RFC 5322-ish regex (sufficient for practical validation)
	const emailRegex =
		/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
	if (!emailRegex.test(sanitized)) return null;
	return sanitized;
}

// ─── Template Rendering ────────────────────────────────────────────────────

/**
 * Escape HTML special characters to prevent XSS in email templates
 */
function escapeHtml(text) {
	if (text == null) return '';
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Simple mustache-style template renderer
 * Supports {{variable}}, {{#if condition}}...{{/if}}, {{#each array}}...{{/each}}
 *
 * @param {string} template - The template string
 * @param {Object} data - Data to interpolate
 * @param {boolean} isHtml - Whether the template is HTML (enables HTML escaping)
 */
function renderTemplate(template, data, isHtml = false) {
	if (!template) return '';

	const escapeFn = isHtml ? escapeHtml : (s) => String(s ?? '');
	let result = template;

	// Handle {{#each array}}...{{/each}}
	result = result.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, inner) => {
		const items = data[key];
		if (!Array.isArray(items)) return '';
		return items
			.map((item) => {
				let itemResult = inner;
				Object.entries(item).forEach(([k, v]) => {
					itemResult = itemResult.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), escapeFn(v));
				});
				// Remove any remaining unreplaced variables in the loop body
				itemResult = itemResult.replace(/\{\{[\w.]+\}\}/g, '');
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
		const replacement = escapeFn(value);
		result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), replacement);
	});

	// Remove any unreplaced template variables (unknown keys) with empty string
	result = result.replace(/\{\{[\w.]+\}\}/g, '');

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
	if (result.rows[0]) return result.rows[0];
	// Fallback to file-based template
	return await loadFileTemplate(templateName);
}

/**
 * Load a file-based template from templates/emails/ directory
 * Returns a template object compatible with DB template format
 */
async function loadFileTemplate(templateName) {
	try {
		const templateDir = path.join(process.cwd(), 'templates', 'emails');
		const htmlPath = path.join(templateDir, `${templateName}.html`);
		const txtPath = path.join(templateDir, `${templateName}.txt`);

		const htmlExists = fs.existsSync(htmlPath);
		const txtExists = fs.existsSync(txtPath);

		if (!htmlExists && !txtExists) {
			return null;
		}

		const htmlTemplate = htmlExists ? fs.readFileSync(htmlPath, 'utf-8') : null;
		const txtTemplate = txtExists ? fs.readFileSync(txtPath, 'utf-8') : null;

		// Extract subject from HTML title tag or first line of text
		let subject = 'Rekrut AI Notification';
		if (htmlTemplate) {
			const titleMatch = htmlTemplate.match(/<title>([^<]*)<\/title>/);
			if (titleMatch) subject = titleMatch[1].trim();
		} else if (txtTemplate) {
			const firstLine = txtTemplate.trim().split('\n')[0];
			if (firstLine) subject = firstLine;
		}

		return {
			id: null, // File-based templates have no DB id
			name: templateName,
			subject_template: subject,
			body_template: txtTemplate || '',
			html_template: htmlTemplate,
			is_active: true,
			type: 'transactional',
		};
	} catch (err) {
		console.error('[email-service] Failed to load file template:', err.message);
		return null;
	}
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

// ─── Send Transports ───────────────────────────────────────────────────────

/**
 * Send email via Brevo HTTP API (primary)
 */
async function sendViaBrevoApi({ to, subject, html, text }) {
	const body = {
		sender: {
			name: CONFIG.from.name,
			email: CONFIG.from.address,
		},
		to: [{ email: to }],
		subject,
		htmlContent: html,
		textContent: text || '',
	};

	const response = await fetch(CONFIG.brevo.apiUrl, {
		method: 'POST',
		headers: {
			'api-key': CONFIG.brevo.apiKey,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Brevo API error ${response.status}: ${errorText}`);
	}

	const result = await response.json();
	return {
		success: true,
		messageId: result.messageId || result.message_id || `brevo-${Date.now()}`,
		provider: 'brevo-api',
	};
}

/**
 * Send email via SMTP (fallback)
 */
async function sendViaSmtp({ to, subject, html, text }) {
	if (!initializeTransporter()) {
		throw new Error('SMTP not configured');
	}

	const info = await transporter.sendMail({
		from: `${CONFIG.from.name} <${CONFIG.from.address}>`,
		to,
		subject,
		text,
		html,
		headers: {
			'X-Priority': '3',
			'X-Mailer': 'Rekrut AI Notification System',
		},
	});

	return {
		success: true,
		messageId: info.messageId,
		provider: 'smtp',
	};
}

/**
 * Send email with retry:
 * 1. Try Brevo HTTP API first (3 attempts, 5s base exponential backoff)
 * 2. Fall back to SMTP
 */
async function sendWithRetry(sendOptions) {
	let lastError = null;

	// ─── Primary: Brevo HTTP API with retry ────────────────────────────
	if (isBrevoApiConfigured()) {
		for (let attempt = 1; attempt <= CONFIG.retry.maxAttempts; attempt++) {
			try {
				const result = await sendViaBrevoApi(sendOptions);
				return result;
			} catch (err) {
				lastError = err;
				console.error(
					`[email-service] Brevo API send attempt ${attempt}/${CONFIG.retry.maxAttempts} failed for ${sendOptions.to}:`,
					err.message,
				);

				if (attempt < CONFIG.retry.maxAttempts) {
					const delay = CONFIG.retry.delayMs * CONFIG.retry.backoffMultiplier ** (attempt - 1);
					console.log(`[email-service] Retrying in ${delay}ms...`);
					await sleep(delay);
				}
			}
		}
	}

	// ─── Fallback: SMTP ────────────────────────────────────────────────
	try {
		return await sendViaSmtp(sendOptions);
	} catch (err) {
		lastError = err;
		console.error(`[email-service] SMTP fallback failed for ${sendOptions.to}:`, err.message);
	}

	// ─── Neither transport succeeded ───────────────────────────────────
	throw lastError || new Error('No email transport configured');
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
	// Validate recipient email
	const sanitizedTo = validateEmail(to);
	if (!sanitizedTo) {
		console.warn('[email-service] Invalid or missing recipient email, skipping send');
		await logEmail({
			userId,
			email: to,
			type: templateName,
			subject: subject || templateName,
			body: body || '',
			status: 'skipped',
			errorMessage: 'Invalid recipient email address',
			metadata,
		});
		return { success: false, error: 'invalid_email_address' };
	}

	// Check if email is configured
	if (!isEmailConfigured()) {
		console.warn('[email-service] Email not configured (neither Brevo API nor SMTP), logging only');
		await logEmail({
			userId,
			email: sanitizedTo,
			type: templateName,
			subject: subject || templateName,
			body: body || 'Template not rendered',
			status: 'skipped',
			errorMessage: 'Email service not configured',
			metadata,
		});
		return { success: false, error: 'email_not_configured' };
	}

	// Check global rate limits
	const rateCheck = rateLimiter.checkLimit();
	if (!rateCheck.allowed) {
		console.warn(`[email-service] Global rate limit exceeded: ${rateCheck.reason}`);
		return { success: false, error: 'rate_limit_exceeded', reason: rateCheck.reason };
	}

	// Check per-user rate limit: max 5 emails per user per hour
	if (userId) {
		try {
			const userLimit = await distributedRateLimiter.checkLimit(
				`email:user:${userId}`,
				3600000, // 1 hour
				5,
			);
			if (!userLimit.allowed) {
				console.warn(`[email-service] Per-user rate limit exceeded for user ${userId}`);
				await logEmail({
					userId,
					email: sanitizedTo,
					type: templateName,
					subject: subject || templateName,
					body: body || '',
					status: 'skipped',
					errorMessage: `Per-user rate limit exceeded: ${userLimit.retryAfter}s remaining`,
					metadata,
				});
				return {
					success: false,
					error: 'user_rate_limit_exceeded',
					retryAfter: userLimit.retryAfter,
				};
			}
		} catch (rlErr) {
			console.error('[email-service] Per-user rate limit check failed:', rlErr.message);
			// Fail open - don't block if rate limiter errors
		}
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
			? renderTemplate(template.html_template, templateData, true)
			: textToHtml(finalBody);

		// Log the attempt
		const logId = await logEmail({
			userId,
			email: sanitizedTo,
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

		// Send email (Brevo API primary → SMTP fallback with retry)
		const result = await sendWithRetry({
			to: sanitizedTo,
			subject: finalSubject,
			html: htmlWithTracking,
			text: finalBody,
		});

		// Update log with success
		await updateEmailLog(logId, {
			status: 'sent',
			providerMessageId: result.messageId,
			sentAt: new Date(),
		});

		console.log(
			`[email-service] Email sent to ${sanitizedTo} via ${result.provider}: ${result.messageId}`,
		);

		return {
			success: true,
			messageId: result.messageId,
			provider: result.provider,
			logId,
		};
	} catch (err) {
		console.error(`[email-service] Failed to send email to ${sanitizedTo}:`, err.message);

		// Log failure
		await logEmail({
			userId,
			email: sanitizedTo,
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
	// Validate recipient email
	const sanitizedTo = validateEmail(to);
	if (!sanitizedTo) {
		console.warn('[email-service] Invalid or missing recipient email, skipping send');
		await logEmail({
			userId,
			email: to,
			type,
			subject,
			body,
			htmlBody: html,
			status: 'skipped',
			errorMessage: 'Invalid recipient email address',
			metadata,
		});
		return { success: false, error: 'invalid_email_address' };
	}

	// Check if email is configured
	if (!isEmailConfigured()) {
		console.warn('[email-service] Email not configured, logging only');
		await logEmail({
			userId,
			email: sanitizedTo,
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
			email: sanitizedTo,
			type,
			subject,
			body,
			htmlBody,
			status: 'pending',
			metadata,
		});

		// Send email (Brevo API primary → SMTP fallback with retry)
		const result = await sendWithRetry({
			to: sanitizedTo,
			subject,
			html: htmlBody,
			text: body,
		});

		// Update log
		await updateEmailLog(logId, {
			status: 'sent',
			providerMessageId: result.messageId,
			sentAt: new Date(),
		});

		console.log(
			`[email-service] Custom email sent to ${sanitizedTo} via ${result.provider}: ${result.messageId}`,
		);

		return { success: true, messageId: result.messageId, provider: result.provider, logId };
	} catch (err) {
		console.error(`[email-service] Failed to send custom email to ${sanitizedTo}:`, err.message);

		await logEmail({
			userId,
			email: sanitizedTo,
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
		configured: isEmailConfigured(),
		brevoApi: {
			configured: isBrevoApiConfigured(),
		},
		smtp: {
			configured: isSmtpConfigured,
			host: CONFIG.smtp.host,
			port: CONFIG.smtp.port,
		},
		fromAddress: CONFIG.from.address,
		rateLimit: CONFIG.rateLimit,
		currentRate: {
			perMinute: rateLimiter.minuteCount,
			perHour: rateLimiter.hourCount,
		},
		retry: CONFIG.retry,
	};
}

// ─── Verify Connection ────────────────────────────────────────────────────

/**
 * Verify email transports (Brevo API + SMTP)
 */
async function verifyConnection() {
	const results = { brevoApi: null, smtp: null };

	if (isBrevoApiConfigured()) {
		try {
			const response = await fetch('https://api.brevo.com/v3/account', {
				headers: { 'api-key': CONFIG.brevo.apiKey },
			});
			results.brevoApi = response.ok
				? { success: true, message: 'Brevo API key valid' }
				: { success: false, error: `HTTP ${response.status}` };
		} catch (err) {
			results.brevoApi = { success: false, error: err.message };
		}
	}

	if (initializeTransporter()) {
		try {
			await transporter.verify();
			results.smtp = { success: true, message: 'SMTP connection verified' };
		} catch (err) {
			results.smtp = { success: false, error: err.message };
		}
	}

	return results;
}

/**
 * Send email with queue fallback — if no transport available, queue for later
 */
async function sendEmailWithQueue({ to, template, subject, body, html, metadata = {} }) {
	// Try to send immediately if email is configured
	if (isEmailConfigured()) {
		try {
			return await sendTemplatedEmail({ to, templateName: template, templateData: metadata });
		} catch (err) {
			console.log('[email] Immediate send failed, queuing:', err.message);
		}
	}

	// Queue for later processing
	const emailQueue = require('./email-queue');
	return await emailQueue.enqueue({ to, template, subject, body, html, metadata });
}

// ─── Interview Reminder Processing ───────────────────────────────────────────
// Process due interview reminders and send emails
async function processInterviewReminders() {
	try {
		// Get reminders that are due and haven't been sent yet
		const dueReminders = await pool.query(
			`SELECT ir.id, ir.interview_id, ir.recipient_id, ir.reminder_type,
				si.scheduled_at, si.job_id, si.interview_type,
				u.email, u.name as candidate_name,
				j.title as job_title, c.name as company_name
			 FROM interview_reminders ir
			 JOIN scheduled_interviews si ON ir.interview_id = si.id
			 JOIN users u ON ir.recipient_id = u.id
			 JOIN jobs j ON si.job_id = j.id
			 JOIN companies c ON j.company_id = c.id
			 WHERE ir.send_at <= NOW()
			   AND ir.sent = false
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
				await pool.query('UPDATE interview_reminders SET sent = true WHERE id = $1', [reminder.id]);
			} catch (err) {
				console.error(`[email-service] Failed to send reminder ${reminder.id}:`, err.message);
			}
		}
	} catch (err) {
		console.error('[email-service] Interview reminder processing error:', err.message);
	}
}

// ─── Ownership Transfer Email ──────────────────────────────────────────────
/**
 * Send ownership transfer notification email to the new owner.
 * Fire-and-forget: failures are logged but not thrown.
 */
async function sendOwnershipTransferEmail({ to, name, companyName, userId, metadata }) {
	return sendEmailAsync({
		to,
		templateName: 'ownership_transferred',
		templateData: {
			name: name || 'there',
			companyName: companyName || 'your company',
		},
		userId,
		metadata,
	});
}

// ─── Export ────────────────────────────────────────────────────────────────

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

	// Ownership transfer
	sendOwnershipTransferEmail,
};
