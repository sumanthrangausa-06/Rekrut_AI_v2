const pool = require('./db');

/**
 * Simple database-backed email queue
 * Stores pending emails and processes them asynchronously
 */

class EmailQueue {
	constructor() {
		this.processing = false;
		this.interval = null;
	}

	/**
	 * Add an email to the queue
	 */
	async enqueue({ to, template, subject, body, html, metadata = {} }) {
		try {
			const result = await pool.query(
				`INSERT INTO email_queue (recipient, template_name, subject, body, html_body, metadata, status, created_at)
				 VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
				 RETURNING id`,
				[to, template, subject, body, html, JSON.stringify(metadata)],
			);
			return { id: result.rows[0].id, status: 'queued' };
		} catch (err) {
			console.error('[email-queue] Failed to enqueue:', err.message);
			throw err;
		}
	}

	/**
	 * Get pending emails (batch of 10)
	 */
	async getPending(limit = 10) {
		try {
			const result = await pool.query(
				`SELECT * FROM email_queue
				 WHERE status = 'pending'
				 ORDER BY created_at ASC
				 LIMIT $1
				 FOR UPDATE SKIP LOCKED`,
				[limit],
			);
			return result.rows;
		} catch (err) {
			console.error('[email-queue] Failed to get pending:', err.message);
			return [];
		}
	}

	/**
	 * Mark email as sent
	 */
	async markSent(id, sentAt = new Date()) {
		try {
			await pool.query(
				`UPDATE email_queue
				 SET status = 'sent', sent_at = $2, updated_at = NOW()
				 WHERE id = $1`,
				[id, sentAt],
			);
		} catch (err) {
			console.error('[email-queue] Failed to mark sent:', err.message);
		}
	}

	/**
	 * Mark email as failed
	 */
	async markFailed(id, error) {
		try {
			await pool.query(
				`UPDATE email_queue
				 SET status = 'failed', error_message = $2, retry_count = retry_count + 1, updated_at = NOW()
				 WHERE id = $1`,
				[id, error],
			);
		} catch (err) {
			console.error('[email-queue] Failed to mark failed:', err.message);
		}
	}

	/**
	 * Retry failed emails (max 3 retries)
	 */
	async retryFailed() {
		try {
			const result = await pool.query(
				`UPDATE email_queue
				 SET status = 'pending', updated_at = NOW()
				 WHERE status = 'failed' AND retry_count < 3
				 RETURNING id`,
			);
			return result.rows;
		} catch (err) {
			console.error('[email-queue] Failed to retry:', err.message);
			return [];
		}
	}

	/**
	 * Get queue statistics
	 */
	async getStats() {
		try {
			const result = await pool.query(
				`SELECT
					status,
					COUNT(*) as count
				 FROM email_queue
				 GROUP BY status`,
			);
			return result.rows.reduce((acc, row) => {
				acc[row.status] = parseInt(row.count, 10);
				return acc;
			}, {});
		} catch (err) {
			console.error('[email-queue] Failed to get stats:', err.message);
			return {};
		}
	}

	/**
	 * Start the queue processor (runs every 30 seconds)
	 */
	startProcessor(processorFn) {
		if (this.interval) return;
		
		this.processorFn = processorFn;
		this.interval = setInterval(() => this.processBatch(), 30000);
		console.log('[email-queue] Processor started (30s interval)');
	}

	/**
	 * Stop the queue processor
	 */
	stopProcessor() {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
			console.log('[email-queue] Processor stopped');
		}
	}

	/**
	 * Process a batch of pending emails
	 */
	async processBatch() {
		if (this.processing) return;
		this.processing = true;

		try {
			const pending = await this.getPending(10);
			if (pending.length === 0) return;

			console.log(`[email-queue] Processing ${pending.length} pending emails`);

			for (const email of pending) {
				try {
					await this.processorFn({
						id: email.id,
						to: email.recipient,
						subject: email.subject,
						body: email.body,
						html: email.html_body,
						metadata: JSON.parse(email.metadata || '{}'),
					});
					await this.markSent(email.id);
				} catch (err) {
					console.error(`[email-queue] Failed to send email ${email.id}:`, err.message);
					await this.markFailed(email.id, err.message);
				}
			}
		} catch (err) {
			console.error('[email-queue] Batch processing error:', err.message);
		} finally {
			this.processing = false;
		}
	}
}

module.exports = new EmailQueue();
