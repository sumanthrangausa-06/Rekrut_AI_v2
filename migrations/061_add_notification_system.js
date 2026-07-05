// Migration: Add notification system tables (templates, preferences, queue, logs)
// Required by: lib/email-service.js, routes/notifications.js
// Status: Backend code exists, tables needed for production deployment

const pool = require('../lib/db');

async function up() {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		// ─── notification_templates ──────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS notification_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'email',
        subject_template TEXT NOT NULL,
        body_template TEXT NOT NULL,
        html_template TEXT,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

		// ─── notification_preferences ──────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notification_type VARCHAR(50) NOT NULL,
        email_enabled BOOLEAN NOT NULL DEFAULT true,
        in_app_enabled BOOLEAN NOT NULL DEFAULT true,
        sms_enabled BOOLEAN NOT NULL DEFAULT false,
        digest_enabled BOOLEAN NOT NULL DEFAULT false,
        digest_frequency VARCHAR(20) NOT NULL DEFAULT 'daily',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, notification_type)
      )
    `);

		// ─── notification_queue ──────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS notification_queue (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        template_id INTEGER REFERENCES notification_templates(id) ON DELETE SET NULL,
        template_data JSONB NOT NULL DEFAULT '{}',
        priority INTEGER NOT NULL DEFAULT 5,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        last_error TEXT,
        scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

		// ─── notification_logs ───────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS notification_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        email VARCHAR(255) NOT NULL,
        template_id INTEGER REFERENCES notification_templates(id) ON DELETE SET NULL,
        type VARCHAR(50) NOT NULL,
        subject TEXT,
        body TEXT,
        html_body TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        error_message TEXT,
        provider_message_id VARCHAR(255),
        metadata JSONB NOT NULL DEFAULT '{}',
        sent_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        opened_at TIMESTAMPTZ,
        clicked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

		// ─── Seed default templates ────────────────────────────────────────────
		// Ensure description column exists (may be missing if table created by earlier migration)
		await client.query(`
      ALTER TABLE notification_templates ADD COLUMN IF NOT EXISTS description TEXT
    `);
		await client.query(`
      INSERT INTO notification_templates (name, type, subject_template, body_template, description)
      VALUES
        ('welcome_email', 'email',
         'Welcome to Rekrut AI, {{name}}!',
         'Hi {{name}},\n\nWelcome to Rekrut AI! Your account has been successfully created.\n\nGet started:\n• Complete your profile\n• Take a mock interview\n• Browse jobs matching your skills\n\nBest regards,\nThe Rekrut AI Team',
         'Welcome email sent after registration'),

        ('interview_scheduled', 'email',
         'Interview Scheduled: {{job_title}} at {{company_name}}',
         'Hi {{name}},\n\nYour interview for {{job_title}} at {{company_name}} has been scheduled.\n\nDetails:\nDate: {{interview_date}}\nTime: {{interview_time}}\nDuration: {{duration}}\nFormat: {{format}}\n\nPrepare well and good luck!\n\nRekrut AI Team',
         'Interview scheduling confirmation'),

        ('application_received', 'email',
         'Application Received: {{job_title}}',
         'Hi {{name}},\n\nYour application for {{job_title}} at {{company_name}} has been received.\n\nStatus: {{status}}\nApplied on: {{applied_date}}\n\nYou will be notified when the recruiter reviews your application.\n\nRekrut AI Team',
         'Application submission confirmation'),

        ('application_status_update', 'email',
         'Update on Your Application: {{job_title}}',
         'Hi {{name}},\n\nThere is an update on your application for {{job_title}} at {{company_name}}.\n\nNew Status: {{status}}\nUpdated: {{updated_at}}\n\n{{#if feedback}}Feedback:\n{{feedback}}\n{{/if}}\n\nRekrut AI Team',
         'Application status change notification'),

        ('assessment_invite', 'email',
         'Assessment Invitation: {{assessment_name}}',
         'Hi {{name}},\n\nYou have been invited to take an assessment: {{assessment_name}}.\n\nDeadline: {{deadline}}\nDuration: {{duration}}\n\nClick here to start: {{assessment_link}}\n\nRekrut AI Team',
         'Assessment invitation'),

        ('password_reset', 'email',
         'Reset Your Rekrut AI Password',
         'Hi {{name}},\n\nWe received a request to reset your password.\n\nReset link: {{reset_link}}\nThis link expires in {{expires_in}}.\n\nIf you did not request this, please ignore this email.\n\nRekrut AI Team',
         'Password reset request'),

        ('offer_received', 'email',
         'Congratulations! Offer from {{company_name}}',
         'Hi {{name}},\n\nGreat news! You have received an offer from {{company_name}}.\n\nPosition: {{job_title}}\nSalary: {{salary}}\nStart Date: {{start_date}}\n\nView and respond: {{offer_link}}\n\nCongratulations!\nRekrut AI Team',
         'Job offer notification')
      ON CONFLICT (name) DO NOTHING
    `);

		// ─── Indexes ───────────────────────────────────────────────────────────
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_queue_status 
        ON notification_queue(status, scheduled_for) WHERE status = 'pending'
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_logs_user 
        ON notification_logs(user_id, created_at DESC)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_logs_email 
        ON notification_logs(email, created_at DESC)
    `);

		await client.query('COMMIT');
		console.log('[migration 061] Notification tables created + templates seeded');
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('[migration 061] Error:', err.message);
		throw err;
	} finally {
		client.release();
	}
}

async function down() {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query('DROP TABLE IF EXISTS notification_logs CASCADE');
		await client.query('DROP TABLE IF EXISTS notification_queue CASCADE');
		await client.query('DROP TABLE IF EXISTS notification_preferences CASCADE');
		await client.query('DROP TABLE IF EXISTS notification_templates CASCADE');
		await client.query('COMMIT');
		console.log('[migration 061] Notification tables dropped');
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('[migration 061] Rollback error:', err.message);
		throw err;
	} finally {
		client.release();
	}
}

module.exports = { up, down };
