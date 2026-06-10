const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Agent Status Tracker
 *
 * Queries OpenClaw for subagent status and writes to a JSON file
 * that the backend can serve to the frontend dashboard.
 *
 * Run via: node scripts/update-agent-status.js
 * Or via cron: every 5 minutes
 */

const OUTPUT_FILE = path.join(__dirname, '../public/agent-status.json');
const SESSION_LOG_DIR = '/root/.openclaw/agents/main/sessions';

function getSubagentStatus() {
	try {
		// Try to get active subagents via openclaw CLI
		const output = execSync(
			'openclaw sessions list --active-minutes 180 --kinds subagent,acp --limit 50',
			{
				encoding: 'utf8',
				timeout: 10000,
				cwd: '/root/.openclaw/workspace',
			},
		);

		// Parse the output - it's a text format, so we'll extract what we can
		const lines = output.split('\n');

		return {
			timestamp: new Date().toISOString(),
			raw_output: output,
			lines: lines.length,
		};
	} catch (e) {
		return {
			timestamp: new Date().toISOString(),
			error: e.message,
			raw_output: null,
		};
	}
}

function scanSessionFiles() {
	const sessions = [];

	try {
		const files = fs.readdirSync(SESSION_LOG_DIR);

		for (const file of files) {
			if (!file.endsWith('.jsonl')) continue;

			const filePath = path.join(SESSION_LOG_DIR, file);
			const stat = fs.statSync(filePath);

			// Only recent sessions (last 24 hours)
			if (Date.now() - stat.mtime.getTime() > 24 * 60 * 60 * 1000) continue;

			try {
				const content = fs.readFileSync(filePath, 'utf8');
				const lines = content.split('\n').filter((l) => l.trim());

				if (lines.length === 0) continue;

				// Parse first line for session metadata
				const firstLine = JSON.parse(lines[0]);
				const lastLine = JSON.parse(lines[lines.length - 1]);

				sessions.push({
					sessionId: file.replace('.jsonl', ''),
					messageCount: lines.length,
					firstMessage: firstLine,
					lastMessage: lastLine,
					mtime: stat.mtime.toISOString(),
					size: stat.size,
				});
			} catch (_e) {
				// Skip unparseable files
			}
		}
	} catch (e) {
		console.error('Error scanning session files:', e.message);
	}

	return sessions;
}

function main() {
	console.log('Updating agent status...');

	const status = {
		generated_at: new Date().toISOString(),
		source: 'openclaw-subagent-tracker',
		version: '1.0.0',
	};

	// Try multiple methods to get data
	status.cli_status = getSubagentStatus();
	status.sessions = scanSessionFiles();

	// Ensure output directory exists
	const outputDir = path.dirname(OUTPUT_FILE);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	fs.writeFileSync(OUTPUT_FILE, JSON.stringify(status, null, 2));

	console.log(`Status written to ${OUTPUT_FILE}`);
	console.log(`Found ${status.sessions.length} sessions`);
	console.log(`CLI output: ${status.cli_status.raw_output ? 'success' : 'failed'}`);
}

main();
