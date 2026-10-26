const pool = require('./db');

/**
 * Normalise a queue row's metadata to a plain object (#1520).
 * enqueue() JSON.stringify's metadata into a jsonb column, and node-pg
 * returns jsonb as an object — but legacy/other-driver rows can carry a
 * string, and the column can be null. Accept all three shapes; a
 * malformed string degrades to {} rather than throwing (the old
 * JSON.parse(email.metadata) threw "[object Object]" is not valid JSON
 * on every real object-shaped row).
 */
function normalizeMetadata(metadata) {
	if (!metadata) return {};
	if (typeof metadata === 'object') return metadata;
	if (typeof metadata === 'string') {
		try {
			const parsed = JSON.parse(metadata);
			return parsed && typeof parsed === 'object' ? parsed : {};
		} catch {
			return {};
		}
	}
	return {};
}

/**
 * Map a processBatch payload to sendTemplatedEmail's contract (#1520).
 * lib/email-service expects { templateName, templateData } — the shape
 * sendEmailWithQueue already uses — not the { template, data } keys
 * server.js's processorFn used to pass (templateName undefined →
 * logEmail failed on notification_logs.type NOT NULL). Exported as a
 * pure helper so the wiring contract is unit-testable without booting
 * server.js (STOP 1 §3).
 */
function toSendTemplatedEmailArgs(email) {
	const metadata = normalizeMetadata(email && email.metadata);
	return {
		to: email.to,
		templateName: email.template || metadata.template || 'custom',
		templateData: metadata,
	};
}

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
				// #1125 GAP-F send-time guard (STOP 1 §5.1): deleting
				// queued rows cannot stop a send already claimed into
				// memory, and legal-held rows survive erasure as
				// pending — so re-check immediately before sending:
				// (a) re-read the row — gone or no longer 'pending'
				// means erasure (or another sender) won the race, skip;
				// (b) resolve the recipient against users — tombstoned/
				// deleted, or not resolving to any live user, suppresses
				// the send. Suppression NEVER mutates the row (no
				// markSent/markFailed): K-5 held material stays
				// unaltered, and a suppressed held row stays pending and
				// re-suppresses on each pass until the hold resolves.
				// A guard lookup error also suppresses (fail-closed —
				// never send to a possibly-erased recipient).
				// §5.4 build-entry check: sendEmailWithQueue (the only
				// enqueue caller) has zero callers in the repo, so
				// clause (b) breaks no designed non-user flow.
				// #1161 Finding 4: the re-read also selects recipient,
				// and clause (b) — and the send below — act on the
				// FRESH recipient, not the getPending snapshot.
				let recipient = email.recipient;
				try {
					const fresh = await pool.query(
						'SELECT id, status, recipient FROM email_queue WHERE id = $1',
						[email.id],
					);
					if (!fresh.rows[0] || fresh.rows[0].status !== 'pending') {
						console.log(
							`[email-queue] Skipping email ${email.id}: row gone or no longer pending`,
						);
						continue;
					}
					recipient = fresh.rows[0].recipient;
					const userRes = await pool.query(
						'SELECT id, deleted_at FROM users WHERE email = $1',
						[recipient],
					);
					if (!userRes.rows.some((u) => !u.deleted_at)) {
						console.log(
							`[email-queue] Suppressing email ${email.id}: recipient is not a live user`,
						);
						continue;
					}
				} catch (guardErr) {
					console.error(
						`[email-queue] Guard check failed for email ${email.id} — suppressing (fail-closed):`,
						guardErr.message,
					);
					continue;
				}
				try {
					await this.processorFn({
						id: email.id,
						to: recipient,
						subject: email.subject,
						body: email.body,
						html: email.html_body,
						// #1520: template_name is its own column (enqueue
						// writes it there) — pass it through; metadata
						// arrives from pg as a jsonb object, so normalise
						// instead of JSON.parse (which threw on objects).
						template: email.template_name,
						metadata: normalizeMetadata(email.metadata),
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

const emailQueue = new EmailQueue();
emailQueue.normalizeMetadata = normalizeMetadata;
emailQueue.toSendTemplatedEmailArgs = toSendTemplatedEmailArgs;
module.exports = emailQueue;
