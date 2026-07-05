const pool = require('../lib/db');

async function up(client) {
	await client.query(`
		CREATE TABLE IF NOT EXISTS email_queue (
			id SERIAL PRIMARY KEY,
			recipient VARCHAR(255) NOT NULL,
			template_name VARCHAR(100),
			subject VARCHAR(500),
			body TEXT,
			html_body TEXT,
			metadata JSONB DEFAULT '{}',
			status VARCHAR(50) DEFAULT 'pending',
			retry_count INTEGER DEFAULT 0,
			error_message TEXT,
			created_at TIMESTAMP DEFAULT NOW(),
			sent_at TIMESTAMP,
			updated_at TIMESTAMP DEFAULT NOW()
		);
		
		CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status);
		CREATE INDEX IF NOT EXISTS idx_email_queue_created_at ON email_queue(created_at);
	`);
	console.log('Email queue table created');
}

async function down(client) {
	await client.query('DROP TABLE IF EXISTS email_queue');
	console.log('Email queue table dropped');
}

module.exports = { up, down };
