/**
 * Email Notification Service — Rekrut AI
 *
 * Nodemailer-based transactional email service with in-memory queue
 * for non-blocking API sending. Handles 4 core notification types:
 *   1. New job application received (to recruiter)
 *   2. Interview scheduled (to candidate)
 *   3. Application status updated (to candidate)
 *   4. New recruiter message (to candidate)
 *
 * Environment variables required:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL
 */

const nodemailer = require('nodemailer');

// ─── Configuration ─────────────────────────────────────────────────────────

const CONFIG = {
	smtp: {
		host: process.env.SMTP_HOST || 'smtp.gmail.com',
		port: parseInt(process.env.SMTP_PORT || '587', 10),
		secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
		auth: {
			user: process.env.SMTP_USER || '',
			pass: process.env.SMTP_PASS || '',
		},
	},
	from: {
		name: process.env.EMAIL_FROM_NAME || 'Rekrut AI',
		address: process.env.FROM_EMAIL || process.env.SMTP_USER || 'noreply@rekrut.ai',
	},
	// In-memory queue settings
	queue: {
		maxRetries: 3,
		retryDelayMs: 5000,
		batchSize: 10,
		processIntervalMs: 30000, // 30 seconds
	},
	// Rate limiting (in-memory)
	rateLimit: {
		maxPerMinute: 60,
		maxPerHour: 500,
	},
};

// ─── Transporter ───────────────────────────────────────────────────────────

let transporter = null;
let isConfigured = false;

function getTransporter() {
	if (transporter) return transporter;

	if (!CONFIG.smtp.auth.user || !CONFIG.smtp.auth.pass) {
		console.warn('[email-service] SMTP credentials not configured. Set SMTP_USER and SMTP_PASS.');
		isConfigured = false;
		return null;
	}

	transporter = nodemailer.createTransport({
		host: CONFIG.smtp.host,
		port: CONFIG.smtp.port,
		secure: CONFIG.smtp.secure,
		auth: CONFIG.smtp.auth,
		connectionTimeout: 10000,
		socketTimeout: 10000,
		debug: process.env.NODE_ENV !== 'production',
		logger: process.env.NODE_ENV !== 'production',
	});

	isConfigured = true;
	console.log(`[email-service] SMTP ready: ${CONFIG.smtp.host}:${CONFIG.smtp.port}`);
	return transporter;
}

// ─── Rate Limiter (in-memory) ──────────────────────────────────────────────

const rateLimiter = {
	minuteCount: 0,
	hourCount: 0,
	lastMinuteReset: Date.now(),
	lastHourReset: Date.now(),

	check() {
		const now = Date.now();
		if (now - this.lastMinuteReset >= 60000) {
			this.minuteCount = 0;
			this.lastMinuteReset = now;
		}
		if (now - this.lastHourReset >= 3600000) {
			this.hourCount = 0;
			this.lastHourReset = now;
		}
		if (this.minuteCount >= CONFIG.rateLimit.maxPerMinute) {
			return { allowed: false, reason: 'minute_limit_exceeded' };
		}
		if (this.hourCount >= CONFIG.rateLimit.maxPerHour) {
			return { allowed: false, reason: 'hour_limit_exceeded' };
		}
		this.minuteCount++;
		this.hourCount++;
		return { allowed: true };
	},
};

// ─── In-Memory Queue ───────────────────────────────────────────────────────

const queue = [];
let isProcessing = false;
let processIntervalId = null;

function enqueue(item) {
	const job = {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
		...item,
		attempts: 0,
		status: 'pending',
		createdAt: new Date(),
		enqueuedAt: new Date(),
	};
	queue.push(job);
	console.log(`[email-queue] Enqueued job ${job.id} (${item.type})`);
	return job;
}

function getQueueStatus() {
	return {
		pending: queue.filter((j) => j.status === 'pending').length,
		processing: queue.filter((j) => j.status === 'processing').length,
		failed: queue.filter((j) => j.status === 'failed').length,
		sent: queue.filter((j) => j.status === 'sent').length,
		total: queue.length,
	};
}

function pruneQueue() {
	// Keep only last 1000 completed/failed jobs to prevent memory growth
	const completed = queue.filter((j) => j.status === 'sent' || j.status === 'failed');
	if (completed.length > 1000) {
		const toRemove = completed.slice(0, completed.length - 1000);
		for (const job of toRemove) {
			const idx = queue.indexOf(job);
			if (idx !== -1) queue.splice(idx, 1);
		}
	}
}

async function processQueue(batchSize = CONFIG.queue.batchSize) {
	if (isProcessing) return { skipped: true, reason: 'already_processing' };
	isProcessing = true;

	const results = { processed: 0, succeeded: 0, failed: 0 };
	const pending = queue.filter((j) => j.status === 'pending').slice(0, batchSize);

	for (const job of pending) {
		job.status = 'processing';
		job.attempts++;

		try {
			const result = await sendMail({
				to: job.to,
				subject: job.subject,
				html: job.html,
				text: job.text,
				});

			if (result.success) {
				job.status = 'sent';
				job.sentAt = new Date();
				job.messageId = result.messageId;
				results.succeeded++;
			} else {
				throw new Error(result.error || 'Send failed');
			}
		} catch (err) {
			console.error(`[email-queue] Job ${job.id} failed (attempt ${job.attempts}):`, err.message);
			if (job.attempts >= CONFIG.queue.maxRetries) {
				job.status = 'failed';
				job.error = err.message;
				results.failed++;
			} else {
				job.status = 'pending'; // Retry later
			}
		}
		results.processed++;
	}

	isProcessing = false;
	pruneQueue();
	return results;
}

function startQueueProcessor() {
	if (processIntervalId) return;
	processIntervalId = setInterval(() => {
		processQueue().catch((err) => {
			console.error('[email-queue] Background processing error:', err.message);
		});
	}, CONFIG.queue.processIntervalMs);
	console.log('[email-queue] Background processor started (30s interval)');
}

function stopQueueProcessor() {
	if (processIntervalId) {
		clearInterval(processIntervalId);
		processIntervalId = null;
	}
}

// Auto-start processor on module load
startQueueProcessor();

// ─── Core Send ───────────────────────────────────────────────────────────────

async function sendMail({ to, subject, html, text }) {
	const tp = getTransporter();
	if (!tp) {
		return { success: false, error: 'email_not_configured' };
	}

	const rateCheck = rateLimiter.check();
	if (!rateCheck.allowed) {
		return { success: false, error: 'rate_limit_exceeded', reason: rateCheck.reason };
	}

	try {
		const info = await tp.sendMail({
			from: `"${CONFIG.from.name}" <${CONFIG.from.address}>`,
			to,
			subject,
			text,
			html,
			headers: {
				'X-Mailer': 'Rekrut AI Email Service',
				'X-Priority': '3',
			},
		});

		console.log(`[email-service] Sent to ${to}: ${info.messageId}`);
		return { success: true, messageId: info.messageId };
	} catch (err) {
		console.error(`[email-service] Send failed to ${to}:`, err.message);
		return { success: false, error: 'send_failed', message: err.message };
	}
}

// ─── Templates ─────────────────────────────────────────────────────────────

function baseTemplate({ title, bodyHtml, actionText, actionUrl, footerText }) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .header { background: #1a73e8; padding: 32px 24px; text-align: center; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; font-weight: 600; }
    .content { padding: 32px 24px; color: #333; line-height: 1.6; font-size: 15px; }
    .content p { margin: 0 0 16px; }
    .action { margin: 24px 0; text-align: center; }
    .action a { display: inline-block; background: #1a73e8; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 14px; }
    .footer { padding: 20px 24px; background: #f8f9fa; text-align: center; font-size: 12px; color: #888; }
    .meta { margin-top: 16px; padding: 12px; background: #f0f4ff; border-radius: 6px; font-size: 13px; color: #555; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>Rekrut AI</h1></div>
    <div class="content">${bodyHtml}</div>
    ${actionUrl ? `<div class="action"><a href="${actionUrl}">${actionText || 'View in Dashboard'}</a></div>` : ''}
    <div class="footer">${footerText || 'Rekrut AI — Smart Hiring Platform'}<br>This is an automated notification. Please do not reply directly.</div>
  </div>
</body>
</html>`;
}

// 1. New job application received → Recruiter
function buildNewApplicationEmail({ recruiter_name, candidate_name, job_title, company_name, application_id, candidate_link, dashboard_url }) {
	const subject = `New Application: ${candidate_name} applied for ${job_title}`;
	const text = `Hi ${recruiter_name || 'Recruiter'},

Great news! ${candidate_name} has applied for the ${job_title} position at ${company_name || 'your company'}.

Application ID: ${application_id || 'N/A'}

You can review the candidate profile and application details in your recruiter dashboard.

View Candidate: ${candidate_link || dashboard_url || 'https://rekrut.ai/recruiter/dashboard'}

Rekrut AI Team`;

	const bodyHtml = `
      <p>Hi ${recruiter_name || 'Recruiter'},</p>
      <p>Great news! <strong>${candidate_name}</strong> has applied for the <strong>${job_title}</strong> position${company_name ? ` at <strong>${company_name}</strong>` : ''}.</p>
      <div class="meta">
        <strong>Application ID:</strong> ${application_id || 'N/A'}<br>
        <strong>Candidate:</strong> ${candidate_name}<br>
        <strong>Position:</strong> ${job_title}
      </div>
      <p>You can review the candidate profile and application details in your recruiter dashboard.</p>`;

	const html = baseTemplate({
		title: subject,
		bodyHtml,
		actionText: 'Review Candidate',
		actionUrl: candidate_link || dashboard_url || 'https://rekrut.ai/recruiter/dashboard',
	});

	return { subject, text, html };
}

// 2. Interview scheduled → Candidate
function buildInterviewScheduledEmail({ candidate_name, job_title, company_name, interview_date, interview_time, interview_location, interviewer_name, meeting_link, confirmation_link }) {
	const subject = `Interview Scheduled: ${job_title} at ${company_name || 'Rekrut AI'}`;
	const text = `Hi ${candidate_name},

Great news! Your interview for the ${job_title} position${company_name ? ` at ${company_name}` : ''} has been scheduled.

📅 Date: ${interview_date || 'TBD'}
🕐 Time: ${interview_time || 'TBD'}
📍 Location: ${interview_location || 'Virtual'}
${interviewer_name ? `👤 Interviewer: ${interviewer_name}\n` : ''}${meeting_link ? `🔗 Meeting Link: ${meeting_link}\n` : ''}
Please confirm your attendance:
${confirmation_link || 'https://rekrut.ai/dashboard'}

If you need to reschedule, please contact us at least 24 hours in advance.

Good luck!
Rekrut AI Team`;

	const bodyHtml = `
      <p>Hi ${candidate_name},</p>
      <p>Great news! Your interview for the <strong>${job_title}</strong> position${company_name ? ` at <strong>${company_name}</strong>` : ''} has been scheduled.</p>
      <div class="meta">
        <strong>📅 Date:</strong> ${interview_date || 'TBD'}<br>
        <strong>🕐 Time:</strong> ${interview_time || 'TBD'}<br>
        <strong>📍 Location:</strong> ${interview_location || 'Virtual'}<br>
        ${interviewer_name ? `<strong>👤 Interviewer:</strong> ${interviewer_name}<br>` : ''}
        ${meeting_link ? `<strong>🔗 Meeting Link:</strong> <a href="${meeting_link}">${meeting_link}</a><br>` : ''}
      </div>
      <p>Please confirm your attendance using the button below. If you need to reschedule, please contact us at least 24 hours in advance.</p>
      <p>Good luck! 🍀</p>`;

	const html = baseTemplate({
		title: subject,
		bodyHtml,
		actionText: 'Confirm Attendance',
		actionUrl: confirmation_link || 'https://rekrut.ai/dashboard',
	});

	return { subject, text, html };
}

// 3. Application status updated → Candidate
function buildStatusUpdateEmail({ candidate_name, job_title, company_name, old_status, new_status, feedback, dashboard_url }) {
	const subject = `Application Update: ${job_title}`;
	const text = `Hi ${candidate_name},

There has been an update on your application for the ${job_title} position${company_name ? ` at ${company_name}` : ''}.

Previous Status: ${old_status || 'Submitted'}
New Status: ${new_status}

${feedback ? `Feedback from the recruiter:\n${feedback}\n\n` : ''}You can view full details in your candidate dashboard:
${dashboard_url || 'https://rekrut.ai/dashboard'}

Rekrut AI Team`;

	const bodyHtml = `
      <p>Hi ${candidate_name},</p>
      <p>There has been an update on your application for the <strong>${job_title}</strong> position${company_name ? ` at <strong>${company_name}</strong>` : ''}.</p>
      <div class="meta">
        <strong>Previous Status:</strong> ${old_status || 'Submitted'}<br>
        <strong>New Status:</strong> ${new_status}<br>
      </div>
      ${feedback ? `<p><strong>Feedback from the recruiter:</strong></p><p style="background:#f8f9fa;padding:12px;border-radius:6px;">${feedback.replace(/\n/g, '<br>')}</p>` : ''}
      <p>You can view full details in your candidate dashboard.</p>`;

	const html = baseTemplate({
		title: subject,
		bodyHtml,
		actionText: 'View Application',
		actionUrl: dashboard_url || 'https://rekrut.ai/dashboard',
	});

	return { subject, text, html };
}

// 4. New recruiter message → Candidate
function buildNewMessageEmail({ candidate_name, recruiter_name, job_title, message_preview, message_url, company_name }) {
	const subject = `New Message from ${recruiter_name || 'Recruiter'}${company_name ? ` at ${company_name}` : ''}`;
	const text = `Hi ${candidate_name},

You have a new message from ${recruiter_name || 'a recruiter'}${company_name ? ` at ${company_name}` : ''}${job_title ? ` regarding the ${job_title} position` : ''}.

${message_preview ? `Message preview:\n"${message_preview}"\n\n` : ''}Reply in your dashboard:
${message_url || 'https://rekrut.ai/dashboard/messages'}

Rekrut AI Team`;

	const bodyHtml = `
      <p>Hi ${candidate_name},</p>
      <p>You have a new message from <strong>${recruiter_name || 'a recruiter'}</strong>${company_name ? ` at <strong>${company_name}</strong>` : ''}${job_title ? ` regarding the <strong>${job_title}</strong> position` : ''}.</p>
      ${message_preview ? `<div style="background:#f8f9fa;padding:16px;border-radius:8px;border-left:4px solid #1a73e8;margin:16px 0;"><p style="margin:0;font-style:italic;color:#555;">"${message_preview.replace(/\n/g, '<br>')}"</p></div>` : ''}
      <p>Click below to read the full message and reply.</p>`;

	const html = baseTemplate({
		title: subject,
		bodyHtml,
		actionText: 'Read Message',
		actionUrl: message_url || 'https://rekrut.ai/dashboard/messages',
	});

	return { subject, text, html };
}

// ─── Public API ────────────────────────────────────────────────────────────

async function sendNewApplicationNotification(to, data) {
	const { subject, text, html } = buildNewApplicationEmail(data);
	return sendMail({ to, subject, text, html });
}

async function sendInterviewScheduled(to, data) {
	const { subject, text, html } = buildInterviewScheduledEmail(data);
	return sendMail({ to, subject, text, html });
}

async function sendApplicationStatusUpdate(to, data) {
	const { subject, text, html } = buildStatusUpdateEmail(data);
	return sendMail({ to, subject, text, html });
}

async function sendNewRecruiterMessage(to, data) {
	const { subject, text, html } = buildNewMessageEmail(data);
	return sendMail({ to, subject, text, html });
}

// Queue variants for non-blocking API use
function queueNewApplicationNotification(to, data) {
	const { subject, text, html } = buildNewApplicationEmail(data);
	return enqueue({ to, subject, text, html, type: 'new_application' });
}

function queueInterviewScheduled(to, data) {
	const { subject, text, html } = buildInterviewScheduledEmail(data);
	return enqueue({ to, subject, text, html, type: 'interview_scheduled' });
}

function queueApplicationStatusUpdate(to, data) {
	const { subject, text, html } = buildStatusUpdateEmail(data);
	return enqueue({ to, subject, text, html, type: 'status_update' });
}

function queueNewRecruiterMessage(to, data) {
	const { subject, text, html } = buildNewMessageEmail(data);
	return enqueue({ to, subject, text, html, type: 'recruiter_message' });
}

// Verify SMTP connection
async function verifyConnection() {
	const tp = getTransporter();
	if (!tp) return { success: false, error: 'not_configured' };
	try {
		await tp.verify();
		return { success: true, message: 'SMTP connection verified' };
	} catch (err) {
		return { success: false, error: err.message };
	}
}

// Get service status
function getStatus() {
	return {
		configured: isConfigured,
		host: CONFIG.smtp.host,
		port: CONFIG.smtp.port,
		from: CONFIG.from.address,
		hasCredentials: !!(CONFIG.smtp.auth.user && CONFIG.smtp.auth.pass),
		queue: getQueueStatus(),
		rateLimit: {
			...CONFIG.rateLimit,
			currentMinute: rateLimiter.minuteCount,
			currentHour: rateLimiter.hourCount,
		},
	};
}

module.exports = {
	// Direct send
	sendNewApplicationNotification,
	sendInterviewScheduled,
	sendApplicationStatusUpdate,
	sendNewRecruiterMessage,

	// Queue (non-blocking)
	queueNewApplicationNotification,
	queueInterviewScheduled,
	queueApplicationStatusUpdate,
	queueNewRecruiterMessage,

	// Queue management
	getQueueStatus,
	processQueue,
	startQueueProcessor,
	stopQueueProcessor,

	// Health / config
	verifyConnection,
	getStatus,
	sendMail,

	// Exposed for testing / admin
	enqueue,
	queue,
};
